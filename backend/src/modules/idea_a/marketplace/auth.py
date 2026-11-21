import base64
import hashlib
import hmac
import os
import secrets
import time
from collections.abc import Callable, Coroutine, Mapping
from dataclasses import dataclass, field
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import BaseModel, SecretStr

COOKIE_NAME = "idea_a_session"
COOKIE_PATH = "/api/ideas/idea-a"
SESSION_SECONDS = 8 * 60 * 60
_KEY_LENGTH = 32
_SALT_LENGTH = 16
_MAX_PASSWORD_LENGTH = 1024
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def _encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii")


def _decode(encoded: str) -> bytes:
    return base64.b64decode(encoded, altchars=b"-_", validate=True)


def _derive(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(
        password.encode(errors="surrogatepass"),
        salt=salt,
        n=2**15,
        r=8,
        p=3,
        dklen=_KEY_LENGTH,
        maxmem=64 * 1024 * 1024,
    )


def make_password_hash(password: str) -> str:
    if not 1 <= len(password) <= _MAX_PASSWORD_LENGTH:
        raise ValueError("Use a password between 1 and 1024 characters.")
    salt = secrets.token_bytes(_SALT_LENGTH)
    return f"scrypt-v1.{_encode(salt)}.{_encode(_derive(password, salt))}"


@dataclass(frozen=True)
class DemoCredentials:
    email: str
    salt: bytes = field(repr=False)
    password_hash: bytes = field(repr=False)
    secret: bytes = field(repr=False)


def _load_credentials(environment: Mapping[str, str]) -> DemoCredentials | None:
    email = environment.get("IDEA_A_DEMO_EMAIL", "").strip().casefold()
    password_hash = environment.get("IDEA_A_DEMO_PASSWORD_HASH", "")
    secret = environment.get("IDEA_A_SESSION_SECRET", "").encode()
    if not email or len(secret) < _KEY_LENGTH:
        return None
    try:
        version, encoded_salt, encoded_key = password_hash.split(".")
        salt, key = _decode(encoded_salt), _decode(encoded_key)
    except ValueError:
        return None
    if version != "scrypt-v1" or len(salt) != _SALT_LENGTH or len(key) != _KEY_LENGTH:
        return None
    return DemoCredentials(email, salt, key, secret)


def _unauthenticated() -> HTTPException:
    return HTTPException(401, detail="Invalid credentials or session.")


def _check_origin(request: Request) -> None:
    origins = request.headers.getlist("origin")
    if not origins:
        # Non-browser clients may omit Origin. Browsers mark cross-origin fetches.
        if request.headers.get("sec-fetch-site") not in {"same-origin", "none", None}:
            raise HTTPException(403, detail="Cross-origin writes are forbidden.")
        return

    host = request.url.hostname
    if host is None:
        raise HTTPException(403, detail="Cross-origin writes are forbidden.")
    authority = f"[{host}]" if ":" in host else host
    try:
        port = request.url.port
    except ValueError:
        raise HTTPException(403, detail="Cross-origin writes are forbidden.") from None
    default_port = 443 if request.url.scheme == "https" else 80
    if port is not None and port != default_port:
        authority = f"{authority}:{port}"
    if origins != [f"{request.url.scheme}://{authority}"]:
        raise HTTPException(403, detail="Cross-origin writes are forbidden.")


class SessionUser(BaseModel):
    email: str


class LoginRequest(BaseModel):
    email: str
    password: SecretStr


class DemoAuth:
    def __init__(
        self,
        credentials: DemoCredentials | None,
        *,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._credentials = credentials
        self._clock = clock

    @classmethod
    def from_env(
        cls,
        environment: Mapping[str, str] | None = None,
        *,
        clock: Callable[[], float] = time.time,
    ) -> "DemoAuth":
        return cls(
            _load_credentials(os.environ if environment is None else environment),
            clock=clock,
        )

    def _signature(self, payload: str, credentials: DemoCredentials) -> str:
        # Bind tokens to the configured account and password hash so either rotation ends sessions.
        data = b"\0".join(
            (payload.encode(), credentials.email.encode(), credentials.password_hash)
        )
        return _encode(hmac.digest(credentials.secret, data, "sha256"))

    def login(self, email: str, password: str) -> tuple[SessionUser, str]:
        credentials = self._credentials
        if credentials is None:
            raise HTTPException(503, detail="Demo sign-in is unavailable.")
        valid_length = 1 <= len(password) <= _MAX_PASSWORD_LENGTH
        candidate = _derive(password if valid_length else "", credentials.salt)
        email_matches = hmac.compare_digest(
            email.strip().casefold().encode(errors="surrogatepass"),
            credentials.email.encode(),
        )
        password_matches = hmac.compare_digest(candidate, credentials.password_hash)
        if not (valid_length and email_matches and password_matches):
            raise _unauthenticated()
        payload = f"v1.{int(self._clock()) + SESSION_SECONDS}"
        token = f"{payload}.{self._signature(payload, credentials)}"
        return SessionUser(email=credentials.email), token

    def require_session(self, request: Request) -> SessionUser:
        token = request.cookies.get(COOKIE_NAME, "")
        credentials = self._credentials
        if credentials is None or not token or len(token) > 100:
            raise _unauthenticated()
        try:
            version, expiry, signature = token.split(".")
            expires_at = int(expiry)
        except ValueError:
            raise _unauthenticated() from None
        expected_signature = self._signature(f"{version}.{expiry}", credentials)
        if (
            version != "v1"
            or self._clock() >= expires_at
            or not hmac.compare_digest(signature.encode(), expected_signature.encode())
        ):
            raise _unauthenticated()
        if request.method not in _SAFE_METHODS:
            _check_origin(request)
        return SessionUser(email=credentials.email)


class _PrivateLoginRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def private_handler(request: Request) -> Response:
            try:
                return await handler(request)
            except RequestValidationError:
                # The default validation response may echo fields from the credential body.
                raise HTTPException(
                    422, detail="Provide an email and password."
                ) from None

        return private_handler


def auth_router(auth: DemoAuth) -> APIRouter:
    router = APIRouter(prefix="/auth", route_class=_PrivateLoginRoute)

    @router.post("/login")
    def login(
        payload: LoginRequest, request: Request, response: Response
    ) -> SessionUser:
        _check_origin(request)
        user, token = auth.login(payload.email, payload.password.get_secret_value())
        response.headers["Cache-Control"] = "no-store"
        response.set_cookie(
            COOKIE_NAME,
            token,
            max_age=SESSION_SECONDS,
            path=COOKIE_PATH,
            httponly=True,
            samesite="lax",
            secure=request.url.scheme == "https",
        )
        return user

    @router.get("/session")
    def session(request: Request, response: Response) -> SessionUser:
        response.headers["Cache-Control"] = "no-store"
        return auth.require_session(request)

    @router.post("/logout", status_code=204, response_class=Response)
    def logout(request: Request) -> Response:
        _check_origin(request)
        response = Response(status_code=204, headers={"Cache-Control": "no-store"})
        response.delete_cookie(
            COOKIE_NAME,
            path=COOKIE_PATH,
            httponly=True,
            samesite="lax",
            secure=request.url.scheme == "https",
        )
        return response

    return router
