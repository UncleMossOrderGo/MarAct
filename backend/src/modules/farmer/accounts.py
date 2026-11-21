"""Local grower sign-in for Farmer Studio and existing LINE farms."""
import hashlib
import hmac
import secrets
from contextlib import closing

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from . import router as farm

router = APIRouter(dependencies=[Depends(farm.require_local_demo)])


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
        db.execute("BEGIN IMMEDIATE")
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
