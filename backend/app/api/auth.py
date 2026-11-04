from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..core.audit import audit
from ..core.security import (COOKIE, create_session, current_session, current_user, client_ip, hash_password,
                             password_problem, require_owner, token_hash, verify_password)
from ..db import get_db
from ..models import LoginEvent, PasswordReset, User, UserSession, now

router = APIRouter(prefix="/api/auth", tags=["auth"])


class Login(BaseModel):
    email: str
    password: str


class Setup(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=200)
    password: str


class ChangePw(BaseModel):
    current_password: str
    new_password: str


class Reset(BaseModel):
    token: str
    new_password: str


class MePatch(BaseModel):
    tutorial_done: bool | None = None
    name: str | None = None


def user_out(u: User) -> dict:
    return {"id": u.id, "email": u.email, "name": u.name, "role": u.role, "is_active": u.is_active,
            "must_change_password": u.must_change_password, "tutorial_done": u.tutorial_done}


def _set_cookie(resp: Response, token: str) -> None:
    resp.set_cookie(COOKIE, token, httponly=True, samesite="lax", secure=settings.cookie_secure,
                    max_age=settings.session_hours * 3600, path="/")


@router.get("/status")
def status(request: Request, db: Session = Depends(get_db)):
    """Setup state, plus the signed-in user when the session cookie is valid (no 401 for a signed-out visitor)."""
    user = None
    try:
        user = user_out(current_session(request, db).user)
    except HTTPException:
        pass
    return {"needs_setup": not db.scalar(select(func.count(User.id))), "user": user}


@router.post("/setup")
def setup(body: Setup, request: Request, response: Response, db: Session = Depends(get_db)):
    if db.scalar(select(func.count(User.id))):
        raise HTTPException(409, "Setup is already done. Sign in instead")
    if p := password_problem(body.password):
        raise HTTPException(422, p)
    u = User(email=body.email.strip().lower(), name=body.name.strip(), role="owner", password_hash=hash_password(body.password))
    db.add(u)
    db.flush()
    audit(db, u, "create", "user", u.id, "Owner account created at first setup")
    _set_cookie(response, create_session(db, u, request))
    db.commit()
    return user_out(u)


@router.post("/login")
def login(body: Login, request: Request, response: Response, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    u = db.scalar(select(User).where(User.email == email))
    ip, ua = client_ip(request), (request.headers.get("user-agent") or "")[:300]
    recent_fail = db.scalar(select(func.count(LoginEvent.id)).where(LoginEvent.email == email, LoginEvent.success.is_(False),
                                                                    LoginEvent.at > now() - dt.timedelta(minutes=15)))
    if recent_fail >= 8:
        raise HTTPException(429, "Too many wrong attempts. Wait 15 minutes and try again")
    if not u or not verify_password(body.password, u.password_hash) or not u.is_active:
        db.add(LoginEvent(user_id=u.id if u else None, email=email, success=False, ip=ip, user_agent=ua))
        db.commit()
        raise HTTPException(401, "That email and password do not match" if not u or u.is_active else "This account is switched off. Ask the owner")
    db.add(LoginEvent(user_id=u.id, email=email, success=True, ip=ip, user_agent=ua))
    _set_cookie(response, create_session(db, u, request))
    db.commit()
    return user_out(u)


@router.post("/logout")
def logout(response: Response, s: UserSession = Depends(current_session), db: Session = Depends(get_db)):
    s.revoked = True
    db.add(LoginEvent(user_id=s.user_id, email=s.user.email, success=True, event="logout"))
    db.commit()
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(u: User = Depends(current_user)):
    return user_out(u)


@router.patch("/me")
def patch_me(body: MePatch, u: User = Depends(current_user), db: Session = Depends(get_db)):
    if body.tutorial_done is not None:
        u.tutorial_done = body.tutorial_done
    if body.name:
        u.name = body.name.strip()[:120]
    db.commit()
    return user_out(u)


@router.post("/change-password")
def change_password(body: ChangePw, s: UserSession = Depends(current_session), db: Session = Depends(get_db)):
    u = s.user
    if not verify_password(body.current_password, u.password_hash):
        raise HTTPException(422, "Current password is wrong")
    if p := password_problem(body.new_password):
        raise HTTPException(422, p)
    u.password_hash = hash_password(body.new_password)
    u.must_change_password = False
    for other in db.scalars(select(UserSession).where(UserSession.user_id == u.id, UserSession.id != s.id)):
        other.revoked = True
    audit(db, u, "update", "user", u.id, "Changed own password")
    db.commit()
    return {"ok": True}


@router.post("/reset")
def reset(body: Reset, db: Session = Depends(get_db)):
    pr = db.scalar(select(PasswordReset).where(PasswordReset.token_hash == token_hash(body.token)))
    if not pr or pr.used or (pr.expires_at if pr.expires_at.tzinfo else pr.expires_at.replace(tzinfo=dt.timezone.utc)) < now():
        raise HTTPException(422, "This reset link has expired. Ask the owner for a new one")
    if p := password_problem(body.new_password):
        raise HTTPException(422, p)
    u = db.get(User, pr.user_id)
    u.password_hash = hash_password(body.new_password)
    u.must_change_password = False
    pr.used = True
    for s in db.scalars(select(UserSession).where(UserSession.user_id == u.id)):
        s.revoked = True
    db.add(LoginEvent(user_id=u.id, email=u.email, success=True, event="reset"))
    audit(db, u, "update", "user", u.id, "Password reset with link")
    db.commit()
    return {"ok": True}


@router.get("/sessions")
def my_sessions(s: UserSession = Depends(current_session), db: Session = Depends(get_db)):
    rows = db.scalars(select(UserSession).where(UserSession.user_id == s.user_id, UserSession.revoked.is_(False),
                                                UserSession.expires_at > now()).order_by(UserSession.last_seen.desc()))
    return [{"id": r.id, "created_at": r.created_at.isoformat(), "last_seen": r.last_seen.isoformat(), "ip": r.ip,
             "user_agent": r.user_agent, "current": r.id == s.id} for r in rows]


@router.delete("/sessions/{sid}")
def end_session(sid: int, s: UserSession = Depends(current_session), db: Session = Depends(get_db)):
    r = db.get(UserSession, sid)
    if not r or r.user_id != s.user_id:
        raise HTTPException(404, "Not found")
    r.revoked = True
    db.commit()
    return {"ok": True}
