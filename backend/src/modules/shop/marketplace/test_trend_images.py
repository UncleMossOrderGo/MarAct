from .trend_images import preview_image


def test_preview_requires_a_supported_publisher_and_image_host():
    article = "https://www.wongnai.com/articles/thai-desserts"
    preview = (
        '<meta property="og:image" content="https://images.wongnai.com/trend.webp?a=1">'
    )
    assert (
        preview_image(article, preview) == "https://images.wongnai.com/trend.webp?a=1"
    )
    assert preview_image("https://example.com/today", preview) is None
    assert (
        preview_image(article, preview.replace("images.wongnai.com", "example.com"))
        is None
    )
    assert preview_image(article, preview.replace("https:", "http:")) is None


def test_source_photo_requires_the_specific_dish_and_skips_brand_artwork():
    from .daily_discovery import DailyTrend

    trend = DailyTrend(
        "milk-tea", "Milk tea", "ชานม", "drink", "rising", "", "", 0.5, ()
    )
    article = "https://www.wongnai.com/articles/tea"
    preview = (
        '<meta property="og:image" content="https://images.wongnai.com/glass.webp">'
    )
    for title in ("Milk market prices", "Upcoming Thai food festival"):
        assert (
            preview_image(
                article,
                preview + f'<meta property="og:title" content="{title}">',
                trend,
            )
            is None
        )
    dish = preview + '<meta property="og:title" content="Thai milk tea recipes">'
    assert (
        preview_image(article, dish, trend) == "https://images.wongnai.com/glass.webp"
    )
    assert (
        preview_image(article, dish.replace("glass.webp", "brand-logo.webp"), trend)
        is None
    )


def test_cited_video_thumbnail_only_for_matching_dish():
    from .daily_discovery import DailySource, DailyTrend
    from .trend_images import attach_source_images

    def resolve(title):
        source = DailySource("https://www.youtube.com/shorts/Abc-123_Zxy", title)
        trend = DailyTrend(
            "milk-tea", "Milk tea", "ชานม", "drink", "rising", "", "", 0.5, (source,)
        )
        return attach_source_images((trend,))[0].image_key

    assert (
        resolve("Making milk tea in Bangkok")
        == "https://i.ytimg.com/vi/Abc-123_Zxy/hqdefault.jpg"
    )
    assert resolve("Thai food festival") is None


def test_tiktok_oembed_uses_matching_video_metadata_and_trusted_image_host(monkeypatch):
    import httpx

    from .daily_discovery import DailySource, DailyTrend
    from .trend_images import attach_source_images

    photo = "https://p16-sign-sg.tiktokcdn.com/covers/tea.image?sig=123"
    metadata = {
        "title": "Making ชานม in Bangkok",
        "type": "video",
        "thumbnail_url": photo,
    }
    response = httpx.Response(200, json=metadata)
    hits = []

    def handle(request):
        hits.append(request)
        return response

    real_client = httpx.Client
    monkeypatch.setattr(
        httpx,
        "Client",
        lambda **kwargs: real_client(transport=httpx.MockTransport(handle), **kwargs),
    )

    def resolve(url):
        source = DailySource(url, "Thai review")
        trend = DailyTrend(
            "milk-tea", "Milk tea", "ชานม", "drink", "rising", "", "", 0.5, (source,)
        )
        return attach_source_images((trend,))[0].image_key

    post = "https://www.tiktok.com/@cook/video/1234567891234567890"
    assert resolve(post + "?lang=th") == photo
    assert len(hits) == 1
    assert hits[0].url.host == "www.tiktok.com"
    assert hits[0].url.path == "/oembed"
    assert hits[0].url.params["url"] == post
    assert resolve("https://www.tiktok.com/@cook") is None
    assert len(hits) == 1

    for payload in (
        {**metadata, "title": "Local festival"},
        {**metadata, "thumbnail_url": "https://cdn.tiktokcdn.com.example.org/tea.jpg"},
        {**metadata, "thumbnail_url": photo.replace("https:", "http:")},
        {**metadata, "title": "X" * 35_000},
        {"type": "video"},
    ):
        response = httpx.Response(200, json=payload)
        assert resolve(post) is None
    response = httpx.Response(302, headers={"location": "https://example.org/redirect"})
    assert resolve(post) is None
    assert hits[-1].url.host == "www.tiktok.com"
    response = httpx.Response(
        200, content=b"broken json", headers={"content-type": "application/json"}
    )
    assert resolve(post) is None


def test_article_with_several_dishes_uses_the_named_photo():
    from .daily_discovery import DailyTrend

    trend = DailyTrend(
        "banoffee-latte",
        "Banoffee Latte",
        "บานอฟฟี่ลาเต้",
        "drink",
        "rising",
        "",
        "",
        0.5,
        (),
    )
    article = "https://www.naewna.com/n/women/menu/"
    src = "https://storage-wp.naewna.com/2026/11/013-Banoffee-Latte.jpg"
    html = f'<meta property="og:title" content="Seasonal menu"><img src="/cover.jpg"><img src="{src}">'
    assert preview_image(article, html, trend) == src
    assert (
        preview_image(article, html.replace("Banoffee-Latte", "Coffee"), trend) is None
    )
