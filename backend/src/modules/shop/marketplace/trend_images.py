"""Resolve dish-specific preview images from cited publishers and public videos."""

import json
import re
from dataclasses import replace
from html.parser import HTMLParser
from time import monotonic
from urllib.parse import parse_qs, unquote, urljoin, urlsplit

import httpx

from .daily_discovery import DailyTrend

PUBLISHERS = {
    "naewna.com": {"naewna.com", "www.naewna.com", "storage-wp.naewna.com"},
    "food.trueid.net": {"food.trueid.net", "cms.dmpcdn.com"},
    "intrend.trueid.net": {"intrend.trueid.net", "cms.dmpcdn.com"},
    "wongnai.com": {"wongnai.com", "www.wongnai.com", "images.wongnai.com"},
    "thairath.co.th": {"thairath.co.th", "www.thairath.co.th", "static.thairath.co.th"},
    "bangkokpost.com": {
        "bangkokpost.com",
        "www.bangkokpost.com",
        "image.bangkokpost.com",
    },
    "nationthailand.com": {
        "nationthailand.com",
        "www.nationthailand.com",
        "media.nationthailand.com",
    },
    "sanook.com": {"sanook.com", "www.sanook.com", "s.isanook.com"},
    "kapook.com": {"www.kapook.com", "cooking.kapook.com", "img.kapook.com"},
    "mekhanews.com": {"mekhanews.com", "www.mekhanews.com", "media.mekhanews.com"},
}
IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png", ".webp", ".avif")
MAX_HTML_BYTES = 512 * 1024
IMAGE_BUDGET_SECONDS = 6.0


class PreviewParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.images: dict[str, str] = {}
        self.inline: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        fields = dict(attrs)
        if tag == "img" and (src := fields.get("data-src") or fields.get("src")):
            self.inline.append((src, fields.get("alt") or ""))
        if tag == "meta":
            key = fields.get("property") or fields.get("name")
            content = fields.get("content")
            if (
                key
                in (
                    "og:image:secure_url",
                    "og:image",
                    "twitter:image",
                    "og:title",
                    "twitter:title",
                )
                and content
            ):
                self.images.setdefault(key, content)


def _host(url: str) -> str | None:
    try:
        parsed = urlsplit(url)
        if (
            parsed.scheme == "https"
            and parsed.port in (None, 443)
            and parsed.username is None
        ):
            return parsed.hostname
    except ValueError:
        pass
    return None


def _related(title: str, trend: DailyTrend) -> bool:
    folded = title.casefold()
    if trend.name_th.strip() and trend.name_th.strip().casefold() in folded:
        return True
    words = set(re.findall(r"[a-z0-9]+", trend.name_en.casefold()))
    specific = words - {
        "a",
        "and",
        "the",
        "of",
        "in",
        "with",
        "thai",
        "food",
        "drink",
        "trend",
        "style",
        "popular",
        "viral",
    }
    title_words = set(re.findall(r"[a-z0-9]+", folded))
    return bool(specific) and specific.issubset(title_words)


def _video_preview(source_url: str, title: str, trend: DailyTrend) -> str | None:
    if not _related(title, trend):
        return None
    parsed = urlsplit(source_url)
    host = _host(source_url)
    video = ""
    if host in {"youtube.com", "www.youtube.com", "m.youtube.com"}:
        if parsed.path == "/watch":
            video = parse_qs(parsed.query).get("v", [""])[0]
        elif parsed.path.startswith("/shorts/"):
            video = parsed.path.removeprefix("/shorts/")
    elif host == "youtu.be":
        video = parsed.path.removeprefix("/")
    return (
        f"https://i.ytimg.com/vi/{video}/hqdefault.jpg"
        if re.fullmatch(r"[\w-]{11}", video, re.ASCII)
        else None
    )


def _tiktok_preview(
    client: httpx.Client, url: str, trend: DailyTrend, deadline: float
) -> str | None:
    path = urlsplit(url).path
    if not re.fullmatch(r"/@[a-zA-Z0-9_.]+/video/[0-9]{1,24}/?", path):
        return None
    remaining = deadline - monotonic()
    if remaining <= 0:
        return None
    with client.stream(
        "GET",
        "https://www.tiktok.com/oembed",
        params={"url": f"https://www.tiktok.com{path.rstrip('/')}"},
        timeout=min(2.0, remaining),
    ) as response:
        if (
            response.status_code != 200
            or "application/json" not in response.headers.get("content-type", "")
        ):
            return None
        body = bytearray()
        for chunk in response.iter_bytes(chunk_size=2048):
            if len(body) + len(chunk) > 32_768 or monotonic() >= deadline:
                return None
            body.extend(chunk)
    data = json.loads(body)
    if not isinstance(data, dict) or data.get("type") != "video":
        return None
    title, image = data.get("title"), data.get("thumbnail_url")
    if (
        not isinstance(title, str)
        or not _related(title, trend)
        or not isinstance(image, str)
    ):
        return None
    host = _host(image)
    if host and host.endswith(
        (".tiktokcdn.com", ".tiktokcdn-us.com", ".tiktokcdn-eu.com")
    ):
        return image
    return None


def preview_image(
    article: str, html: str, trend: DailyTrend | None = None
) -> str | None:
    host = _host(article)
    if host is None:
        return None
    allowed = PUBLISHERS.get(host.removeprefix("www."))
    if allowed is None or host not in allowed:
        return None
    parser = PreviewParser()
    parser.feed(html)
    if trend:
        for src, alt in parser.inline:
            url = urljoin(article, src)
            path = unquote(urlsplit(url).path)
            if _host(url) not in allowed or not path.lower().endswith(IMAGE_SUFFIXES):
                continue
            filename = path.rsplit("/", 1)[-1].rsplit(".", 1)[0]
            if re.search(
                r"(?:^|[ _.-])(?:logo|favicon|placeholder|default)(?:$|[ _.-])",
                filename,
                re.IGNORECASE,
            ):
                continue
            # Publishers often number a photo and use the dish's menu name as its filename.
            menu_name = re.sub(r"^\d+[ _.-]+", "", filename)
            menu_name = re.sub(r"[ _.-]+", " ", menu_name).strip().casefold()
            # A two-word menu name can also appear with its drink category appended.
            named_drink = (
                len(menu_name.split()) >= 2
                and trend.kind == "drink"
                and trend.name_en.casefold()
                in {f"{menu_name} cocoa", f"{menu_name} coffee", f"{menu_name} tea"}
            )
            if _related(alt, trend) or _related(menu_name, trend) or named_drink:
                return url
    if trend and not _related(
        parser.images.get("og:title") or parser.images.get("twitter:title", ""), trend
    ):
        return None
    for key in ("og:image:secure_url", "og:image", "twitter:image"):
        if value := parser.images.get(key):
            url = urljoin(article, value)
            path = urlsplit(url).path.lower()
            if re.search(
                r"(?:^|[/_.-])(?:logo|favicon|placeholder|default)(?:$|[/_.-])", path
            ):
                continue
            if _host(url) in allowed and path.endswith(IMAGE_SUFFIXES):
                return url
    return None


def attach_source_images(trends: tuple[DailyTrend, ...]) -> tuple[DailyTrend, ...]:
    deadline = monotonic() + IMAGE_BUDGET_SECONDS
    results = []
    pages: dict[str, str] = {}
    with httpx.Client(follow_redirects=False, trust_env=False) as client:
        for trend in trends:
            image = trend.image_key
            for source in trend.sources:
                host = _host(source.url)
                remaining = deadline - monotonic()
                if image or remaining <= 0:
                    break
                if image := _video_preview(source.url, source.title, trend):
                    break
                try:
                    if host in {"www.tiktok.com", "tiktok.com", "m.tiktok.com"}:
                        image = _tiktok_preview(client, source.url, trend, deadline)
                        continue
                    if host is None or host not in PUBLISHERS.get(
                        host.removeprefix("www."), set()
                    ):
                        continue
                    if source.url in pages:
                        image = preview_image(source.url, pages[source.url], trend)
                        continue
                    with client.stream(
                        "GET", source.url, timeout=min(2.0, remaining)
                    ) as response:
                        if (
                            response.status_code != 200
                            or "text/html"
                            not in response.headers.get("content-type", "")
                        ):
                            continue
                        html = bytearray()
                        for chunk in response.iter_bytes():
                            html.extend(chunk[: MAX_HTML_BYTES - len(html)])
                            if len(html) >= MAX_HTML_BYTES or monotonic() >= deadline:
                                break
                        pages[source.url] = html.decode("utf-8", errors="replace")
                        image = preview_image(source.url, pages[source.url], trend)
                except (httpx.HTTPError, ValueError):
                    continue
            results.append(replace(trend, image_key=image))
    return tuple(results)
