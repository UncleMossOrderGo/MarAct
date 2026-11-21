"""Buyer-facing views of published farm produce."""
import json
from contextlib import closing

from fastapi import APIRouter, HTTPException

from . import router as farm

router = APIRouter()


@router.get("/marketplace")
def marketplace():
    with closing(farm.connect()) as db:
        return [{"farmId": key, "profile": state["profile"], "listings": state["listings"]}
                for key, raw in db.execute("SELECT id,state FROM farm ORDER BY id")
                if (state := json.loads(raw))["listings"]]


@router.get("/marketplace/photos/{key}")
def published_photo(key: str):
    with closing(farm.connect()) as db:
        for (raw,) in db.execute("SELECT state FROM farm"):
            if any(key in lot["photos"] for lot in json.loads(raw)["listings"]):
                return farm.image_file(key)
    raise HTTPException(404)


