"""Local grower sign-in for Farmer Studio and existing LINE farms."""
import hashlib
import hmac
import secrets
from contextlib import closing

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from backend.src.modules.marketplace.router import Account, buyer_session, market

from . import router as farm

router = APIRouter(dependencies=[Depends(farm.require_studio_host)])


class Credentials(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=8, max_length=128)
    create_account: bool = Field(default=False, alias="register")


def password_hash(password, salt):
    return hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)


def add_account(db, name, password, identity):
    salt = secrets.token_bytes(16)
    db.execute("INSERT INTO farmer_account(login, farm_id, salt, digest) VALUES (?,?,?,?)",
               (name, identity, salt, password_hash(password, salt)))


@router.post("/session")
def sign_in(body: Credentials, request: Request, response: Response):
    name = body.name.strip().casefold()
    if not name:
        raise HTTPException(422, "กรุณาระบุชื่อบัญชี")
    with closing(farm.connect()) as db, db:
        farm.lock_writer(db)
        account = db.execute("SELECT farm_id,salt,digest FROM farmer_account WHERE login=?", (name,)).fetchone()
        if body.create_account:
            if account:
                raise HTTPException(409, "มีผู้ใช้ชื่อบัญชีนี้แล้ว")
            identity = farm.new_farm(db, body.name.strip())
            add_account(db, name, body.password, identity)
        else:
            expected = password_hash(body.password, account[1] if account else bytes(16))
            if not account or not hmac.compare_digest(expected, account[2]):
                raise HTTPException(401, "ชื่อบัญชีหรือรหัสผ่านไม่ถูกต้อง")
            identity = account[0]
        farm.start_session(db, identity, request, response)
    return {"signedIn": True}


@router.post("/logout")
def sign_out(request: Request, response: Response):
    with closing(farm.connect()) as db, db:
        db.execute("DELETE FROM owner WHERE session=?", (farm.digest(request.cookies.get("maract_farm_owner", "")),))
    response.delete_cookie("maract_farm_owner", path=farm.COOKIE_PATH)
    return {"signedIn": False}

@router.post("/profile-session")
def profile_session(body: Account, request: Request, response: Response):
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "กรุณาระบุชื่อบัญชี")
    with market(request) as cur, closing(farm.connect()) as db, db:
        farm.lock_writer(db)
        account = db.execute("SELECT farm_id,salt,digest FROM farmer_account WHERE login=?", (name.casefold(),)).fetchone()
        cur.execute("SELECT 1 FROM idea_c_buyers WHERE name=%s", (name,))
        has_buyer = bool(cur.fetchone())
        if body.create_account and (account or has_buyer):
            raise HTTPException(409, "มีผู้ใช้ชื่อบัญชีนี้แล้ว")
        if not body.create_account and not (account or has_buyer):
            raise HTTPException(401, "ชื่อบัญชีหรือรหัสผ่านไม่ถูกต้อง")
        if account and not hmac.compare_digest(password_hash(body.password, account[1]), account[2]):
            raise HTTPException(401, "ชื่อบัญชีหรือรหัสผ่านไม่ถูกต้อง")
        result = buyer_session(cur, Account(name=name, password=body.password, register=not has_buyer), request, response)
        identity = account[0] if account else farm.new_farm(db, name)
        if not account:
            add_account(db, name.casefold(), body.password, identity)
        farm.start_session(db, identity, request, response)
    return result
