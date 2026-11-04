from __future__ import annotations

from sqlalchemy.orm import Session

from ..models import AuditLog, User
from .serialize import jsonable


def audit(db: Session, user: User | None, action: str, entity_type: str, entity_id="", summary: str = "",
          before: dict | None = None, after: dict | None = None) -> None:
    db.add(AuditLog(user_id=user.id if user else None, user_email=user.email if user else "system",
                    action=action, entity_type=entity_type, entity_id=str(entity_id or ""), summary=summary[:400],
                    before=jsonable(before) if before else None, after=jsonable(after) if after else None))
