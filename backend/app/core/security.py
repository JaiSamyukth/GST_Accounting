"""Password hashing, server-side sessions in an httpOnly cookie, role checks."""
from __future__ import annotations

import datetime as dt
import hashlib
import secrets

import bcrypt
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import User, UserSession, now

COOKIE = "dc_session"
ROLES = ("owner", "accountant")


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode()[:72], bcrypt.gensalt(rounds=12)).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode()[:72], hashed.encode())
    except ValueError:
        return False


def password_problem(pw: str) -> str | None:
    if len(pw) < 10:
        return "Use at least 10 characters"
    if pw.isdigit() or pw.isalpha():
        return "Mix letters with numbers or symbols"
    return None


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_token() -> str:
    return secrets.token_urlsafe(32)


def create_session(db: Session, user: User, request: Request) -> str:
    token = new_token()
    db.add(UserSession(token_hash=token_hash(token), user_id=user.id,
                       expires_at=now() + dt.timedelta(hours=settings.session_hours),
                       ip=client_ip(request), user_agent=(request.headers.get("user-agent") or "")[:300]))
    return token


def client_ip(request: Request) -> str:
    return (request.client.host if request.client else "")[:64]


def _aware(t: dt.datetime) -> dt.datetime:
    return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)


def current_session(request: Request, db: Session = Depends(get_db)) -> UserSession:
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(401, "Please sign in")
    s = db.scalar(select(UserSession).where(UserSession.token_hash == token_hash(token)))
    if not s or s.revoked or _aware(s.expires_at) < now() or not s.user.is_active:
        raise HTTPException(401, "Your session has ended. Please sign in again")
    if (now() - _aware(s.last_seen)).total_seconds() > 60:
        s.last_seen = now()
        db.commit()
    return s


def current_user(s: UserSession = Depends(current_session)) -> User:
    return s.user


def require_owner(user: User = Depends(current_user)) -> User:
    if user.role != "owner":
        raise HTTPException(403, "Only the owner can do this")
    return user
