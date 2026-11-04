from __future__ import annotations

import datetime as dt
import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.audit import audit
from ..core.security import ROLES, hash_password, new_token, require_owner, token_hash
from ..db import get_db
from ..models import AuditLog, LoginEvent, PasswordReset, User, UserSession, now
from .auth import user_out

router = APIRouter(prefix="/api/users", tags=["users"])


class NewUser(BaseModel):
    name: str
    email: str
    role: str = "accountant"


class PatchUser(BaseModel):
    name: str | None = None
    role: str | None = None
    is_active: bool | None = None


@router.get("")
def list_users(_: User = Depends(require_owner), db: Session = Depends(get_db)):
    return [user_out(u) for u in db.scalars(select(User).order_by(User.id))]


@router.post("")
def create_user(body: NewUser, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(422, "Enter a valid email")
    if body.role not in ROLES:
        raise HTTPException(422, "Role must be owner or accountant")
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "Someone already uses this email")
    u = User(email=email, name=body.name.strip(), role=body.role, password_hash=hash_password(secrets.token_urlsafe(24)),
             must_change_password=True)
    db.add(u)
    db.flush()
    link = _reset_link(db, u, hours=72)
    audit(db, owner, "create", "user", u.id, f"Added {u.role} {u.email}")
    db.commit()
    return {**user_out(u), "invite_token": link}


def _reset_link(db: Session, u: User, hours: int = 24) -> str:
    token = new_token()
    db.add(PasswordReset(user_id=u.id, token_hash=token_hash(token), expires_at=now() + dt.timedelta(hours=hours)))
    return token


@router.patch("/{uid}")
def patch_user(uid: int, body: PatchUser, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, "Not found")
    before = user_out(u)
    if body.role is not None:
        if body.role not in ROLES:
            raise HTTPException(422, "Role must be owner or accountant")
        if u.id == owner.id and body.role != "owner":
            raise HTTPException(422, "You cannot remove your own owner access")
        u.role = body.role
    if body.is_active is not None:
        if u.id == owner.id and not body.is_active:
            raise HTTPException(422, "You cannot switch off your own account")
        u.is_active = body.is_active
        if not u.is_active:
            for s in db.scalars(select(UserSession).where(UserSession.user_id == u.id)):
                s.revoked = True
    if body.name:
        u.name = body.name.strip()
    audit(db, owner, "update", "user", u.id, f"Updated {u.email}", before, user_out(u))
    db.commit()
    return user_out(u)


@router.post("/{uid}/reset-link")
def reset_link(uid: int, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, "Not found")
    token = _reset_link(db, u)
    audit(db, owner, "update", "user", u.id, f"Created a password reset link for {u.email}")
    db.commit()
    return {"token": token, "expires_in_hours": 24}


@router.get("/login-history")
def login_history(_: User = Depends(require_owner), db: Session = Depends(get_db)):
    rows = db.scalars(select(LoginEvent).order_by(LoginEvent.at.desc()).limit(200))
    return [{"at": r.at.isoformat(), "email": r.email, "success": r.success, "event": r.event, "ip": r.ip, "user_agent": r.user_agent}
            for r in rows]


@router.get("/audit")
def audit_log(entity_type: str | None = None, entity_id: str | None = None, page: int = 1, _: User = Depends(require_owner),
              db: Session = Depends(get_db)):
    q = select(AuditLog).order_by(AuditLog.at.desc())
    if entity_type:
        q = q.where(AuditLog.entity_type == entity_type)
    if entity_id:
        q = q.where(AuditLog.entity_id == entity_id)
    rows = db.scalars(q.offset((max(page, 1) - 1) * 50).limit(50))
    return [{"id": r.id, "at": r.at.isoformat(), "user": r.user_email, "action": r.action, "entity_type": r.entity_type,
             "entity_id": r.entity_id, "summary": r.summary, "before": r.before, "after": r.after} for r in rows]
