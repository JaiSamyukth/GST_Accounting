"""Document storage: local disk (default) or Supabase Storage."""
from __future__ import annotations

import hashlib
import uuid
from pathlib import Path

import httpx

from ..config import settings


class LocalStorage:
    def __init__(self, root: str):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def put(self, data: bytes, filename: str) -> str:
        key = f"{uuid.uuid4().hex}{Path(filename).suffix.lower()[:10]}"
        (self.root / key).write_bytes(data)
        return key

    def get(self, key: str) -> bytes:
        p = (self.root / key).resolve()
        if self.root.resolve() not in p.parents:
            raise FileNotFoundError(key)
        return p.read_bytes()

    def delete(self, key: str) -> None:
        (self.root / key).unlink(missing_ok=True)


class SupabaseStorage:
    def __init__(self):
        self.base = f"{settings.supabase_url.rstrip('/')}/storage/v1/object/{settings.supabase_bucket}"
        self.headers = {"Authorization": f"Bearer {settings.supabase_service_key}", "apikey": settings.supabase_service_key}

    def put(self, data: bytes, filename: str) -> str:
        key = f"{uuid.uuid4().hex}{Path(filename).suffix.lower()[:10]}"
        r = httpx.post(f"{self.base}/{key}", content=data, headers=self.headers, timeout=60)
        r.raise_for_status()
        return key

    def get(self, key: str) -> bytes:
        r = httpx.get(f"{self.base}/{key}", headers=self.headers, timeout=60)
        if r.status_code == 404:
            raise FileNotFoundError(key)
        r.raise_for_status()
        return r.content

    def delete(self, key: str) -> None:
        httpx.request("DELETE", f"{self.base}/{key}", headers=self.headers, timeout=60)


def get_storage():
    if settings.storage_backend == "supabase":
        return SupabaseStorage()
    return LocalStorage(settings.storage_dir)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
