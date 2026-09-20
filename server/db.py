import json
import os
import threading
from typing import Any

DB_PATH = os.path.join(os.path.dirname(__file__), "database.json")

_lock = threading.Lock()

DEFAULT_DB = {
    "users": [],
    "images": [],
    "rois": [],
    "access_requests": []
}


def _read() -> dict:
    if not os.path.exists(DB_PATH):
        _write(DEFAULT_DB)
        return DEFAULT_DB
    with open(DB_PATH, "r") as f:
        return json.load(f)


def _write(data: dict):
    with open(DB_PATH, "w") as f:
        json.dump(data, f, indent=2)


class DatabaseManager:
    def get(self, table: str) -> list:
        with _lock:
            return _read().get(table, [])

    def insert(self, table: str, record: dict):
        with _lock:
            db = _read()
            db[table].append(record)
            _write(db)

    def find_one(self, table: str, **kwargs) -> Any:
        for record in self.get(table):
            if all(record.get(k) == v for k, v in kwargs.items()):
                return record
        return None

    def update_one(self, table: str, match: dict, updates: dict):
        with _lock:
            db = _read()
            for record in db[table]:
                if all(record.get(k) == v for k, v in match.items()):
                    record.update(updates)
                    break
            _write(db)

    def find_all(self, table: str, **kwargs) -> list:
        return [r for r in self.get(table) if all(r.get(k) == v for k, v in kwargs.items())]


db = DatabaseManager()
