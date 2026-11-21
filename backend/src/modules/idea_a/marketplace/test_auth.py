from collections.abc import Iterator
from secrets import token_urlsafe

import pytest
from fastapi import APIRouter, Depends, FastAPI
from fastapi.testclient import TestClient

from .auth import (
    COOKIE_NAME,
    COOKIE_PATH,
    SESSION_SECONDS,
    DemoAuth,
    auth_router,
    make_password_hash,
)

EMAIL = "buyer@example.test"
PASSWORD = "test-only-demo-password"


@pytest.fixture(scope="module")
def auth_env() -> dict[str, str]:
    return {
        "IDEA_A_DEMO_EMAIL": EMAIL,
        "IDEA_A_DEMO_PASSWORD_HASH": make_password_hash(PASSWORD),
        "IDEA_A_SESSION_SECRET": token_urlsafe(32),
    }


def app_with_guard(auth: DemoAuth) -> FastAPI:
    app = FastAPI()
    app.include_router(auth_router(auth), prefix=COOKIE_PATH)
    marketplace = APIRouter()

    @marketplace.get("/shops/demo/feed/explanations")
    def explanations() -> dict[str, str]:
        return {"status": "stream"}

    @marketplace.post("/orders")
    def orders() -> dict[str, str]:
        return {"status": "saved"}

    app.include_router(
        marketplace,
        prefix=COOKIE_PATH,
        dependencies=[Depends(auth.require_session)],
    )

    @app.get("/api/health")
    @app.get("/api/ideas/idea-b/records")
    def open_route() -> dict[str, bool]:
        return {"ok": True}

    return app


@pytest.fixture
def setup(auth_env: dict[str, str]) -> Iterator[tuple[TestClient, list[float]]]:
    clock = [1_800_000_000.0]
    auth = DemoAuth.from_env(auth_env, clock=lambda: clock[0])
    with TestClient(app_with_guard(auth), base_url="https://demo.test") as client:
        yield client, clock


def login(client: TestClient, email: str = EMAIL, password: str = PASSWORD):
    return client.post(
        f"{COOKIE_PATH}/auth/login", json={"email": email, "password": password}
    )


def test_auth_session_covers_marketplace_and_preserves_open_routes(setup) -> None:
    client, _ = setup
    for path in ("/auth/session", "/shops/demo/feed/explanations"):
        assert client.get(f"{COOKIE_PATH}{path}").status_code == 401
    assert client.post(f"{COOKIE_PATH}/orders").status_code == 401
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/ideas/idea-b/records").status_code == 200

    signed_in = login(client, f" {EMAIL.upper()} ")
    assert signed_in.status_code == 200
    assert signed_in.json() == {"email": EMAIL}
    cookie = signed_in.headers["set-cookie"].lower()
    for attribute in (
        "httponly",
        "samesite=lax",
        "secure",
        f"path={COOKIE_PATH}",
        "max-age=28800",
    ):
        assert attribute in cookie
    assert client.get(f"{COOKIE_PATH}/auth/session").json() == {"email": EMAIL}
    assert client.get(f"{COOKIE_PATH}/shops/demo/feed/explanations").status_code == 200
    assert client.post(f"{COOKIE_PATH}/orders").status_code == 200
    logout = client.post(f"{COOKIE_PATH}/auth/logout")
    assert logout.status_code == 204
    assert "Max-Age=0" in logout.headers["set-cookie"]
    assert client.get(f"{COOKIE_PATH}/auth/session").status_code == 401
    assert client.post(f"{COOKIE_PATH}/auth/logout").status_code == 204


def test_cookie_tampering_and_expiration_close_the_session(setup) -> None:
    client, clock = setup
    assert login(client).status_code == 200
    original = client.cookies[COOKIE_NAME]
    first, last = original[-2:]
    replacement = "A" if first != "A" else "B"
    client.cookies.set(
        COOKIE_NAME,
        f"{original[:-2]}{replacement}{last}",
        domain="demo.test",
        path=COOKIE_PATH,
    )
    assert client.get(f"{COOKIE_PATH}/auth/session").status_code == 401

    client.cookies.set(COOKIE_NAME, original, domain="demo.test", path=COOKIE_PATH)
    clock[0] += SESSION_SECONDS - 1
    assert client.get(f"{COOKIE_PATH}/auth/session").status_code == 200
    clock[0] += 1
    assert client.get(f"{COOKIE_PATH}/auth/session").status_code == 401


def test_write_origin_checks_including_login_and_logout(setup) -> None:
    client, _ = setup
    bad = {"Origin": "https://other.test"}
    good = {"Origin": "https://demo.test"}
    credentials = {"email": EMAIL, "password": PASSWORD}
    assert (
        client.post(
            f"{COOKIE_PATH}/auth/login", headers=bad, json=credentials
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"{COOKIE_PATH}/auth/login", headers=good, json=credentials
        ).status_code
        == 200
    )
    assert client.post(f"{COOKIE_PATH}/orders", headers=bad).status_code == 403
    assert (
        client.post(
            f"{COOKIE_PATH}/orders", headers={"Sec-Fetch-Site": "cross-site"}
        ).status_code
        == 403
    )
    assert client.post(f"{COOKIE_PATH}/orders", headers=good).status_code == 200
    assert client.post(f"{COOKIE_PATH}/auth/logout", headers=bad).status_code == 403
    assert client.get(f"{COOKIE_PATH}/auth/session").status_code == 200


def test_invalid_credentials_and_validation_do_not_leak_input(setup) -> None:
    client, _ = setup
    wrong_email = login(client, "other@example.test")
    wrong_password = login(client, password="wrong")
    assert wrong_email.status_code == wrong_password.status_code == 401
    assert wrong_email.json() == wrong_password.json()
    malformed = client.post(f"{COOKIE_PATH}/auth/login", json={"password": PASSWORD})
    assert malformed.status_code == 422
    assert PASSWORD not in malformed.text


def test_missing_configuration_fails_closed_and_http_cookie_is_usable(auth_env) -> None:
    with TestClient(app_with_guard(DemoAuth.from_env({}))) as client:
        assert login(client).status_code == 503
        assert client.get(f"{COOKIE_PATH}/auth/session").status_code == 401
    with TestClient(app_with_guard(DemoAuth.from_env(auth_env))) as client:
        result = login(client)
        assert result.status_code == 200
        assert "; Secure" not in result.headers["set-cookie"]
        assert client.get(f"{COOKIE_PATH}/auth/session").status_code == 200
