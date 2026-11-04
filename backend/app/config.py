"""Settings from environment variables. No credentials are hard-coded."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _bool(name: str, default: bool) -> bool:
    v = os.getenv(name)
    return default if v is None else v.lower() in ("1", "true", "yes", "on")


@dataclass
class Settings:
    database_url: str = field(default_factory=lambda: os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'data' / 'devcaters.db'}"))
    storage_backend: str = field(default_factory=lambda: os.getenv("STORAGE_BACKEND", "local"))  # local | supabase
    storage_dir: str = field(default_factory=lambda: os.getenv("STORAGE_DIR", str(BASE_DIR / "data" / "files")))
    supabase_url: str = field(default_factory=lambda: os.getenv("SUPABASE_URL", ""))
    supabase_service_key: str = field(default_factory=lambda: os.getenv("SUPABASE_SERVICE_KEY", ""))
    supabase_bucket: str = field(default_factory=lambda: os.getenv("SUPABASE_BUCKET", "documents"))
    session_hours: int = field(default_factory=lambda: int(os.getenv("SESSION_HOURS", "12")))
    cookie_secure: bool = field(default_factory=lambda: _bool("COOKIE_SECURE", False))
    cors_origins: list[str] = field(default_factory=lambda: [o for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o])
    max_upload_mb: int = field(default_factory=lambda: int(os.getenv("MAX_UPLOAD_MB", "20")))
    frontend_dist: str = field(default_factory=lambda: os.getenv("FRONTEND_DIST", str(BASE_DIR.parent / "frontend" / "dist")))
    gsp_provider: str = field(default_factory=lambda: os.getenv("GSP_PROVIDER", ""))


settings = Settings()
