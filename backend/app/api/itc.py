from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..core.audit import audit
from ..core.security import current_user
from ..core.serialize import jsonable, row
from ..db import get_db
from ..models import Gstr2bEntry, ItcAdjustment, Purchase, PurchaseLine, User
from ..services.docs import doc_dict, ensure_unlocked
from ..services.periods import months_in, period_range
from ..services.recon import reconcile

router = APIRouter(prefix="/api/itc", tags=["itc"])
RULES = {"rule42": "Rule 42 (common inputs for exempt and taxable supplies)", "rule43": "Rule 43 (capital goods)",
         "sec17_5": "Section 17(5) blocked credit", "rule37": "Rule 37 (supplier not paid within 180 days)",
         "rule38": "Rule 38", "others": "Other"}


class AdjIn(BaseModel):
    period: str
    kind: str = "reversal"
    rule: str = "others"
    igst: Decimal = Decimal(0)
    cgst: Decimal = Decimal(0)
    sgst: Decimal = Decimal(0)
    cess: Decimal = Decimal(0)
    note: str = ""


@router.get("/rules")
def rules(_: User = Depends(current_user)):
    return RULES


@router.get("/adjustments")
def list_adj(period: str | None = None, _: User = Depends(current_user), db: Session = Depends(get_db)):
    q = select(ItcAdjustment).order_by(ItcAdjustment.created_at.desc())
    if period:
        q = q.where(ItcAdjustment.period.in_(months_in(period) + [period]))
    return [row(a) for a in db.scalars(q)]


@router.post("/adjustments")
def add_adj(body: AdjIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    try:
        start, _ = period_range(body.period)
    except ValueError as e:
        raise HTTPException(422, "Choose a period") from e
    ensure_unlocked(db, start)
    if body.kind not in ("reversal", "reclaim") or body.rule not in RULES:
        raise HTTPException(422, "Choose the type of adjustment")
    if any(v < 0 for v in (body.igst, body.cgst, body.sgst, body.cess)) or not any((body.igst, body.cgst, body.sgst, body.cess)):
        raise HTTPException(422, "Enter the tax amounts (positive numbers)")
    a = ItcAdjustment(**body.model_dump(), created_by=u.id)
    db.add(a)
    db.flush()
    audit(db, u, "create", "itc_adjustment", a.id, f"ITC {body.kind} under {RULES[body.rule]} for {body.period}", after=row(a))
    db.commit()
    return row(a)


@router.delete("/adjustments/{aid}")
def del_adj(aid: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    a = db.get(ItcAdjustment, aid)
    if not a:
        raise HTTPException(404, "Not found")
    ensure_unlocked(db, period_range(a.period)[0])
    audit(db, u, "delete", "itc_adjustment", a.id, f"Removed ITC {a.kind} for {a.period}", before=row(a))
    db.delete(a)
    db.commit()
    return {"ok": True}


@router.get("/recon/{period}")
def recon(period: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    try:
        period_range(period)
    except ValueError as e:
        raise HTTPException(404, "Unknown period") from e
    return jsonable(reconcile(db, period, persist=True))


@router.get("/gstr2b")
def list_2b(period: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    return [row(e) for e in db.scalars(select(Gstr2bEntry).where(Gstr2bEntry.period.in_(months_in(period))).order_by(Gstr2bEntry.supplier_name))]


class LineItc(BaseModel):
    line_id: int
    itc_eligible: bool
    itc_reason: str = ""


@router.patch("/purchases/{pid}")
def set_line_itc(pid: int, body: list[LineItc], u: User = Depends(current_user), db: Session = Depends(get_db)):
    p = db.get(Purchase, pid)
    if not p:
        raise HTTPException(404, "Bill not found")
    ensure_unlocked(db, p.date)
    before = doc_dict(p)
    lines = {l.id: l for l in p.lines}
    for x in body:
        l = lines.get(x.line_id)
        if not l:
            raise HTTPException(422, "Line not found on this bill")
        if x.itc_eligible and l.cgst + l.sgst + l.igst + l.cess == 0:
            raise HTTPException(422, "There is no GST on this line to claim")
        l.itc_eligible = x.itc_eligible
        l.itc_reason = x.itc_reason.strip() or ("" if x.itc_eligible else "Marked ineligible")
    audit(db, u, "update", "purchase", p.id, f"Changed ITC eligibility on bill {p.number}", before, doc_dict(p))
    db.commit()
    return doc_dict(p)
