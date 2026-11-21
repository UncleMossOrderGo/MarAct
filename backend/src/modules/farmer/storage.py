"""PostgreSQL storage for hosted farms. Local demos can keep their existing SQLite store."""
import os
import sqlite3

import psycopg

from backend.src.shared.db import database_url


def postgres() -> bool:
    return os.getenv("FARMER_STORAGE") == "postgres"


class FarmConnection(psycopg.Connection):
    def execute(self, query, params=None, **kwargs):
        # Farm queries use SQLite's parameter marker in both stores.
        return super().execute(query.replace("?", "%s"), params, **kwargs)


def pg_connect():
    return FarmConnection.connect(database_url(), options="-csearch_path=maract_farmer")


def lock_writer(db):
    if isinstance(db, sqlite3.Connection):
        db.execute("BEGIN IMMEDIATE")
    else:
        db.execute("SELECT pg_advisory_xact_lock(428911)")
