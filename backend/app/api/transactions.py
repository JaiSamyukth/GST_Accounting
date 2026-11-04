"""Sales (invoices, credit/debit notes) and purchases."""
from __future__ import annotations

import datetime as dt
import re
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..core.audit import audit
from ..core.security import current_user, require_owner
from ..db import get_db
from ..models import Document, Party, Purchase, SalesDoc, User
from ..services import exporters
from ..services.docs import build_purchase, build_sales, doc_dict, ensure_unlocked, get_business
from ..services.periods import fy_of, month_key
from ..services.reports import build as build_report
from .deps import date_range
from ..services.gst import inr

router = APIRouter(prefix="/api", tags=["transactions"])


class LineIn(BaseModel):
    description: str = ""
    hsn_sac: str = ""
    qty: Decimal = Decimal("1")
    unit: str = "NOS"
    unit_price: Decimal = Decimal("0")
    discount: Decimal = Decimal("0")
    gst_rate: Decimal = Decimal("0")
    cess_rate: Decimal = Decimal("0")
    supply_kind: str = "taxable"
    itc_eligible: bool | None = None
    itc_reason: str = ""


class SalesIn(BaseModel):
    doc_type: str = "invoice"
    number: str
    date: dt.date
    party_id: int | None = None
    party_name: str
    party_gstin: str = ""
    party_address: str = ""
    party_state_code: str | None = None
    place_of_supply: str | None = None
    reverse_charge: bool = False
    is_export: bool = False
    export_with_igst: bool = False
    price_mode: str | None = None
    round_off: bool | None = None
    notes: str = ""
    order_ref: str = ""
    original_number: str = ""
    original_date: dt.date | None = None
    note_reason: str = ""
    save_party: bool = True
    lines: list[LineIn]


class PurchaseIn(BaseModel):
    doc_type: str = "invoice"
    number: str
    date: dt.date
    supplier_id: int | None = None
    supplier_name: str
    supplier_gstin: str = ""
    supplier_state_code: str | None = None
    place_of_supply: str | None = None
    reverse_charge: bool = False
    price_mode: str = "exclusive"
    round_off: bool | None = None
    category: str = "inputs"
    itc_period: str | None = None
    notes: str = ""
    original_number: str = ""
    original_date: dt.date | None = None
    save_party: bool = True
    lines: list[LineIn]


def _payload(body: BaseModel) -> dict:
    d = body.model_dump()
    d["lines"] = [l for l in d["lines"]]
    if d.get("round_off") is None:
        d.pop("round_off")
    return d


def _remember_party(db: Session, kind: str, name: str, gstin: str, address: str, state: str) -> int | None:
    p = db.scalar(select(Party).where(Party.kind == kind, Party.name == name, Party.gstin == gstin))
    if not p:
        p = Party(kind=kind, name=name, gstin=gstin, address=address, state_code=state)
        db.add(p)
        db.flush()
    elif address and not p.address:
        p.address = address
    return p.id


def _future(d: dt.date):
    if d > dt.date.today() + dt.timedelta(days=1):
        raise HTTPException(422, "The date is in the future")


def _attachments(db: Session, entity: str, ids: list[int]) -> dict[int, int]:
    if not ids:
        return {}
    rows = db.execute(select(Document.entity_id, func.count(Document.id)).where(Document.entity_type == entity, Document.entity_id.in_(ids))
                      .group_by(Document.entity_id))
    return dict(rows.all())


# ------------------------------------------------------------------------------------------- sales
@router.get("/sales/next-number")
def next_number(doc_type: str = "invoice", _: User = Depends(current_user), db: Session = Depends(get_db)):
    b = get_business(db)
    fy = fy_of(dt.date.today())
    prefix = {"invoice": b.invoice_prefix or "", "credit_note": "CN/", "debit_note": "DN/"}[doc_type]
    stem = f"{prefix}{fy[2:4]}-{fy[5:]}/"
    nums = list(db.scalars(select(SalesDoc.number).where(SalesDoc.doc_type == doc_type, SalesDoc.number.startswith(stem))))
    n = max([int(m[1]) for x in nums if (m := re.search(r"(\d+)$", x[len(stem):]))] + [0]) + 1
    return {"number": f"{stem}{n:03d}"}


def _sales_query(start, end, q, section, doc_type, status):
    stmt = select(SalesDoc).where(SalesDoc.date >= start, SalesDoc.date <= end)
    if q:
        stmt = stmt.where(or_(SalesDoc.number.ilike(f"%{q}%"), SalesDoc.party_name.ilike(f"%{q}%"), SalesDoc.party_gstin.ilike(f"%{q}%"),
                              SalesDoc.order_ref.ilike(f"%{q}%")))
    if section == "b2b":
        stmt = stmt.where(SalesDoc.party_gstin != "")
    elif section == "b2c":
        stmt = stmt.where(SalesDoc.party_gstin == "")
    elif section:
        stmt = stmt.where(SalesDoc.section == section)
    if doc_type:
        stmt = stmt.where(SalesDoc.doc_type == doc_type)
    if status:
        stmt = stmt.where(SalesDoc.status == status)
    return stmt


@router.get("/sales")
def list_sales(rng=Depends(date_range), q: str = "", section: str = "", doc_type: str = "", status: str = "",
               page: int = 1, size: int = Query(50, le=200), _: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = _sales_query(*rng, q, section, doc_type, status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    sums = db.execute(stmt.where(SalesDoc.status == "active", SalesDoc.doc_type == "invoice").with_only_columns(
        func.coalesce(func.sum(SalesDoc.taxable_value), 0), func.coalesce(func.sum(SalesDoc.cgst + SalesDoc.sgst + SalesDoc.igst + SalesDoc.cess), 0),
        func.coalesce(func.sum(SalesDoc.total), 0))).one()
    rows = list(db.scalars(stmt.order_by(SalesDoc.date.desc(), SalesDoc.id.desc()).offset((max(page, 1) - 1) * size).limit(size)))
    att = _attachments(db, "sales", [r.id for r in rows])
    return {"total": total, "page": page, "size": size,
            "sums": {"taxable_value": str(sums[0]), "tax": str(sums[1]), "total": str(sums[2])},
            "rows": [{**doc_dict(r, lines=False), "attachments": att.get(r.id, 0)} for r in rows]}


@router.get("/sales/export")
def export_sales(fmt: str, rng=Depends(date_range), _: User = Depends(current_user), db: Session = Depends(get_db)):
    b = get_business(db)
    t = build_report(db, b, "sales", *rng)
    return _file(exporters.render(t, fmt, b.trade_name or b.legal_name, f"{rng[0]:%d %b %Y} to {rng[1]:%d %b %Y}"), f"sales-{rng[0]}-{rng[1]}", fmt)


def _file(data: bytes, name: str, fmt: str) -> Response:
    return Response(data, media_type=exporters.MEDIA[fmt], headers={"Content-Disposition": f'attachment; filename="{name}.{fmt}"'})


@router.get("/sales/{sid}")
def get_sale(sid: int, _: User = Depends(current_user), db: Session = Depends(get_db)):
    d = db.get(SalesDoc, sid)
    if not d:
        raise HTTPException(404, "Invoice not found")
    out = doc_dict(d)
    if d.amends_id:
        o = db.get(SalesDoc, d.amends_id)
        out["amends"] = {"id": o.id, "number": o.number, "date": o.date.isoformat()} if o else None
    if d.amended_by_id:
        out["amended_by"] = d.amended_by_id
    return out


@router.post("/sales")
def create_sale(body: SalesIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    _future(body.date)
    ensure_unlocked(db, body.date)
    data = _payload(body)
    d = SalesDoc(created_by=u.id)
    build_sales(db, d, data)
    if body.save_party and not body.party_id:
        d.party_id = _remember_party(db, "customer", d.party_name, d.party_gstin, d.party_address, d.party_state_code)
    db.add(d)
    try:
        db.flush()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(409, f"Number {body.number} is already used") from e
    audit(db, u, "create", "sales", d.id, f"Created {d.doc_type.replace('_', ' ')} {d.number} for ₹{inr(d.total)}", after=doc_dict(d))
    db.commit()
    return doc_dict(d)


@router.put("/sales/{sid}")
def update_sale(sid: int, body: SalesIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    d = db.get(SalesDoc, sid)
    if not d:
        raise HTTPException(404, "Invoice not found")
    if d.status != "active":
        raise HTTPException(409, "Cancelled invoices cannot be edited")
    _future(body.date)
    ensure_unlocked(db, d.date, body.date)
    before = doc_dict(d)
    build_sales(db, d, _payload(body))
    try:
        db.flush()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(409, f"Number {body.number} is already used") from e
    audit(db, u, "update", "sales", d.id, f"Edited {d.doc_type.replace('_', ' ')} {d.number}", before, doc_dict(d))
    db.commit()
    return doc_dict(d)


@router.post("/sales/{sid}/cancel")
def cancel_sale(sid: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    d = db.get(SalesDoc, sid)
    if not d:
        raise HTTPException(404, "Invoice not found")
    ensure_unlocked(db, d.date)
    d.status = "cancelled"
    audit(db, u, "cancel", "sales", d.id, f"Cancelled {d.doc_type.replace('_', ' ')} {d.number}")
    db.commit()
    return doc_dict(d)


@router.post("/sales/{sid}/amend")
def amend_sale(sid: int, body: SalesIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    """Correct an invoice from a filed period. The correction is reported as an amendment in the current open period."""
    o = db.get(SalesDoc, sid)
    if not o:
        raise HTTPException(404, "Invoice not found")
    if o.amended_by_id:
        raise HTTPException(409, "This invoice already has an amendment. Amend that one instead")
    b = get_business(db)
    data = _payload(body)
    data["number"] = data["number"] or o.number
    d = SalesDoc(created_by=u.id, amends_id=o.id, amend_period=month_key(dt.date.today()))
    # amendments share the original number, so use a suffix internally
    build_sales(db, d, data)
    if d.number == o.number:
        d.number = f"{o.number}~A"
    db.add(d)
    db.flush()
    o.amended_by_id = d.id
    o.status = "amended"
    audit(db, u, "amend", "sales", o.id, f"Amended {o.number} (reported in {d.amend_period})", doc_dict(o), doc_dict(d))
    db.commit()
    return doc_dict(d)


# ------------------------------------------------------------------------------------------- purchases
@router.get("/purchases")
def list_purchases(rng=Depends(date_range), q: str = "", category: str = "", itc: str = "", recon: str = "", status: str = "",
                   page: int = 1, size: int = Query(50, le=200), _: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = select(Purchase).where(Purchase.date >= rng[0], Purchase.date <= rng[1])
    if q:
        stmt = stmt.where(or_(Purchase.number.ilike(f"%{q}%"), Purchase.supplier_name.ilike(f"%{q}%"), Purchase.supplier_gstin.ilike(f"%{q}%")))
    if category:
        stmt = stmt.where(Purchase.category == category)
    if recon:
        stmt = stmt.where(Purchase.recon_status == recon)
    if status:
        stmt = stmt.where(Purchase.status == status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = list(db.scalars(stmt.options(selectinload(Purchase.lines)).order_by(Purchase.date.desc(), Purchase.id.desc())
                           .offset((max(page, 1) - 1) * size).limit(size)))
    att = _attachments(db, "purchase", [r.id for r in rows])
    out = []
    for r in rows:
        elig = sum((l.igst + l.cgst + l.sgst + l.cess for l in r.lines if l.itc_eligible), Decimal(0))
        tax = r.igst + r.cgst + r.sgst + r.cess
        if itc == "eligible" and not elig:
            continue
        if itc == "ineligible" and elig == tax:
            continue
        out.append({**doc_dict(r, lines=False), "itc_eligible_amount": str(elig), "attachments": att.get(r.id, 0)})
    sums = db.execute(stmt.where(Purchase.status == "active", Purchase.doc_type == "invoice").with_only_columns(
        func.coalesce(func.sum(Purchase.taxable_value), 0), func.coalesce(func.sum(Purchase.cgst + Purchase.sgst + Purchase.igst + Purchase.cess), 0),
        func.coalesce(func.sum(Purchase.total), 0))).one()
    return {"total": total, "page": page, "size": size, "rows": out,
            "sums": {"taxable_value": str(sums[0]), "tax": str(sums[1]), "total": str(sums[2])}}


@router.get("/purchases/export")
def export_purchases(fmt: str, rng=Depends(date_range), _: User = Depends(current_user), db: Session = Depends(get_db)):
    b = get_business(db)
    t = build_report(db, b, "purchases", *rng)
    return _file(exporters.render(t, fmt, b.trade_name or b.legal_name, f"{rng[0]:%d %b %Y} to {rng[1]:%d %b %Y}"), f"purchases-{rng[0]}-{rng[1]}", fmt)


@router.get("/purchases/{pid}")
def get_purchase(pid: int, _: User = Depends(current_user), db: Session = Depends(get_db)):
    p = db.get(Purchase, pid)
    if not p:
        raise HTTPException(404, "Bill not found")
    return doc_dict(p)


@router.post("/purchases")
def create_purchase(body: PurchaseIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    _future(body.date)
    ensure_unlocked(db, body.date)
    p = Purchase(created_by=u.id)
    build_purchase(db, p, _payload(body))
    if body.save_party and not body.supplier_id:
        p.supplier_id = _remember_party(db, "supplier", p.supplier_name, p.supplier_gstin, "", p.supplier_state_code)
    db.add(p)
    try:
        db.flush()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(409, f"Bill {body.number} from this supplier is already recorded") from e
    audit(db, u, "create", "purchase", p.id, f"Recorded bill {p.number} from {p.supplier_name} for ₹{inr(p.total)}", after=doc_dict(p))
    db.commit()
    return doc_dict(p)


@router.put("/purchases/{pid}")
def update_purchase(pid: int, body: PurchaseIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    p = db.get(Purchase, pid)
    if not p:
        raise HTTPException(404, "Bill not found")
    if p.status != "active":
        raise HTTPException(409, "Cancelled bills cannot be edited")
    _future(body.date)
    ensure_unlocked(db, p.date, body.date)
    before = doc_dict(p)
    build_purchase(db, p, _payload(body))
    p.recon_status = "pending"
    try:
        db.flush()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(409, f"Bill {body.number} from this supplier is already recorded") from e
    audit(db, u, "update", "purchase", p.id, f"Edited bill {p.number}", before, doc_dict(p))
    db.commit()
    return doc_dict(p)


@router.post("/purchases/{pid}/cancel")
def cancel_purchase(pid: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    p = db.get(Purchase, pid)
    if not p:
        raise HTTPException(404, "Bill not found")
    ensure_unlocked(db, p.date)
    p.status = "cancelled"
    audit(db, u, "cancel", "purchase", p.id, f"Cancelled bill {p.number} from {p.supplier_name}")
    db.commit()
    return doc_dict(p)
