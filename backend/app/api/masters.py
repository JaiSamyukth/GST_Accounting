from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..core.audit import audit
from ..core.security import current_user, require_owner
from ..core.serialize import row
from ..db import get_db
from ..models import HsnCode, Party, TaxRate, User
from ..services.docs import get_business
from ..services.gst import SUPPLY_KINDS, LineInput, calc_document, classify_sales_doc, dec
from ..services.gstin import STATES, normalise_gstin, state_from_gstin, validate_gstin, validate_pan
from ..services.periods import fy_of, period_key, period_label, periods_for_fy

router = APIRouter(prefix="/api", tags=["settings"])

UQC = ["NOS", "KGS", "LTR", "MTR", "PCS", "BOX", "BAG", "PAC", "SET", "PLT", "OTH", "NA"]


class BusinessIn(BaseModel):
    legal_name: str = ""
    trade_name: str = ""
    gstin: str = ""
    pan: str = ""
    address: str = ""
    state_code: str = "33"
    jurisdiction: str = ""
    registration_type: str = "regular"
    filing_frequency: str = "monthly"
    fy_start_year: int = 2026
    phone: str = ""
    email: str = ""
    proprietor: str = ""
    invoice_prefix: str = ""
    b2cl_limit: Decimal = Decimal("100000")
    no_itc_scheme: bool = True
    round_off: bool = True
    default_price_mode: str = "exclusive"


@router.get("/business")
def get_biz(_: User = Depends(current_user), db: Session = Depends(get_db)):
    b = get_business(db)
    db.commit()
    return row(b)


@router.put("/business")
def put_biz(body: BusinessIn, u: User = Depends(require_owner), db: Session = Depends(get_db)):
    b = get_business(db)
    before = row(b)
    current = {k: getattr(b, k) for k in BusinessIn.model_fields}
    data = {**current, **body.model_dump(exclude_unset=True)}
    data["gstin"] = normalise_gstin(data["gstin"])
    data["pan"] = data["pan"].strip().upper()
    if data["gstin"]:
        if not (c := validate_gstin(data["gstin"])).ok:
            raise HTTPException(422, f"GSTIN: {c.error}")
        if data["gstin"][:2] != data["state_code"]:
            raise HTTPException(422, "The state does not match the first two digits of the GSTIN")
        if data["pan"] and data["gstin"][2:12] != data["pan"]:
            raise HTTPException(422, "The PAN does not match characters 3 to 12 of the GSTIN")
        data["pan"] = data["pan"] or data["gstin"][2:12]
    if data["pan"] and not (c := validate_pan(data["pan"])).ok:
        raise HTTPException(422, c.error)
    if data["state_code"] not in STATES:
        raise HTTPException(422, "Choose a valid state")
    if data["registration_type"] not in ("regular", "composition"):
        raise HTTPException(422, "Registration type must be regular or composition")
    if data["filing_frequency"] not in ("monthly", "quarterly"):
        raise HTTPException(422, "Filing frequency must be monthly or quarterly")
    if data["default_price_mode"] not in ("exclusive", "inclusive"):
        raise HTTPException(422, "Price mode must be exclusive or inclusive")
    for k, v in data.items():
        setattr(b, k, v.strip() if isinstance(v, str) else v)
    audit(db, u, "update", "business", 1, "Updated business and GST settings", before, row(b))
    db.commit()
    return row(b)


@router.get("/meta")
def meta(_: User = Depends(current_user), db: Session = Depends(get_db)):
    import datetime as dt
    b = get_business(db)
    today = dt.date.today()
    fy = fy_of(today)
    return {"states": [{"code": c, "name": n} for c, n in STATES.items()], "uqc": UQC, "supply_kinds": list(SUPPLY_KINDS),
            "rates": [row(r) for r in db.scalars(select(TaxRate).order_by(TaxRate.rate))],
            "current_fy": fy, "current_period": period_key(today, b.filing_frequency),
            "periods": [{"key": k, "label": period_label(k)} for k in periods_for_fy(fy, b.filing_frequency)],
            "previous_periods": [{"key": k, "label": period_label(k)} for k in periods_for_fy(f"{int(fy[:4]) - 1}-{fy[2:4]}", b.filing_frequency)]}


@router.post("/gstin/check")
def check_gstin(body: dict, _: User = Depends(current_user)):
    g = normalise_gstin(body.get("gstin"))
    c = validate_gstin(g)
    return {"gstin": g, "ok": c.ok, "error": c.error, "state_code": state_from_gstin(g) if c.ok else None,
            "pan": g[2:12] if c.ok else None}


# --------------------------------------------------------------------------- tax rates
class RateIn(BaseModel):
    rate: Decimal
    label: str = ""
    active: bool = True


@router.post("/tax-rates")
def add_rate(body: RateIn, u: User = Depends(require_owner), db: Session = Depends(get_db)):
    if not (0 <= body.rate <= 100):
        raise HTTPException(422, "Rate must be between 0 and 100")
    if db.scalar(select(TaxRate).where(TaxRate.rate == body.rate)):
        raise HTTPException(409, "This rate is already in the list")
    r = TaxRate(rate=body.rate, label=body.label, active=body.active)
    db.add(r)
    db.flush()
    audit(db, u, "create", "tax_rate", r.id, f"Added rate {body.rate}%")
    db.commit()
    return row(r)


@router.put("/tax-rates/{rid}")
def edit_rate(rid: int, body: RateIn, u: User = Depends(require_owner), db: Session = Depends(get_db)):
    r = db.get(TaxRate, rid)
    if not r:
        raise HTTPException(404, "Not found")
    before = row(r)
    r.label, r.active = body.label, body.active
    audit(db, u, "update", "tax_rate", r.id, f"Updated rate {r.rate}%", before, row(r))
    db.commit()
    return row(r)


# --------------------------------------------------------------------------- HSN / SAC
class HsnIn(BaseModel):
    code: str
    description: str
    is_service: bool = True
    default_rate: Decimal = Decimal("5")
    supply_kind: str = "taxable"
    uqc: str = "NA"
    itc_allowed: bool = False
    notes: str = ""
    active: bool = True


@router.get("/hsn")
def list_hsn(q: str = "", _: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = select(HsnCode).order_by(HsnCode.code)
    if q:
        stmt = stmt.where(or_(HsnCode.code.startswith(q), HsnCode.description.ilike(f"%{q}%")))
    return [row(h) for h in db.scalars(stmt)]


def _valid_hsn(body: HsnIn, db: Session):
    code = body.code.strip()
    if not code.isdigit() or len(code) not in (4, 6, 8):
        raise HTTPException(422, "HSN/SAC must be 4, 6 or 8 digits")
    if body.supply_kind not in SUPPLY_KINDS:
        raise HTTPException(422, "Unknown supply type")
    if not db.scalar(select(TaxRate).where(TaxRate.rate == body.default_rate)):
        raise HTTPException(422, f"{body.default_rate}% is not in your rate list")
    return code


@router.post("/hsn")
def add_hsn(body: HsnIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    code = _valid_hsn(body, db)
    if db.scalar(select(HsnCode).where(HsnCode.code == code)):
        raise HTTPException(409, "This code already exists")
    h = HsnCode(**{**body.model_dump(), "code": code})
    db.add(h)
    db.flush()
    audit(db, u, "create", "hsn", h.id, f"Added HSN/SAC {code}")
    db.commit()
    return row(h)


@router.put("/hsn/{hid}")
def edit_hsn(hid: int, body: HsnIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    h = db.get(HsnCode, hid)
    if not h:
        raise HTTPException(404, "Not found")
    code = _valid_hsn(body, db)
    before = row(h)
    for k, v in {**body.model_dump(), "code": code}.items():
        setattr(h, k, v)
    audit(db, u, "update", "hsn", h.id, f"Updated HSN/SAC {code}", before, row(h))
    db.commit()
    return row(h)


# --------------------------------------------------------------------------- parties
class PartyIn(BaseModel):
    kind: str
    name: str
    gstin: str = ""
    address: str = ""
    state_code: str = ""
    phone: str = ""
    email: str = ""
    active: bool = True


@router.get("/parties")
def list_parties(kind: str | None = None, q: str = "", include_inactive: bool = False, _: User = Depends(current_user),
                 db: Session = Depends(get_db)):
    stmt = select(Party).order_by(Party.name)
    if kind:
        stmt = stmt.where(Party.kind == kind)
    if not include_inactive:
        stmt = stmt.where(Party.active.is_(True))
    if q:
        stmt = stmt.where(or_(Party.name.ilike(f"%{q}%"), Party.gstin.ilike(f"%{q}%"), Party.phone.ilike(f"%{q}%")))
    return [row(p) for p in db.scalars(stmt.limit(500))]


def _party_data(body: PartyIn, db: Session) -> dict:
    if body.kind not in ("customer", "supplier"):
        raise HTTPException(422, "Kind must be customer or supplier")
    if not body.name.strip():
        raise HTTPException(422, "Name is required")
    data = body.model_dump()
    data["name"] = data["name"].strip()
    data["gstin"] = normalise_gstin(data["gstin"])
    if data["gstin"] and not (c := validate_gstin(data["gstin"])).ok:
        raise HTTPException(422, f"GSTIN: {c.error}")
    data["state_code"] = data["state_code"] or state_from_gstin(data["gstin"]) or get_business(db).state_code
    if data["gstin"] and data["gstin"][:2] != data["state_code"]:
        raise HTTPException(422, "The state does not match the GSTIN")
    if data["state_code"] not in STATES:
        raise HTTPException(422, "Choose a valid state")
    return data


@router.post("/parties")
def add_party(body: PartyIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    data = _party_data(body, db)
    if db.scalar(select(Party).where(Party.kind == data["kind"], Party.name == data["name"], Party.gstin == data["gstin"])):
        raise HTTPException(409, f"This {data['kind']} is already in your list")
    p = Party(**data)
    db.add(p)
    db.flush()
    audit(db, u, "create", "party", p.id, f"Added {p.kind} {p.name}")
    db.commit()
    return row(p)


@router.put("/parties/{pid}")
def edit_party(pid: int, body: PartyIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    p = db.get(Party, pid)
    if not p:
        raise HTTPException(404, "Not found")
    before = row(p)
    for k, v in _party_data(body, db).items():
        setattr(p, k, v)
    audit(db, u, "update", "party", p.id, f"Updated {p.kind} {p.name}", before, row(p))
    db.commit()
    return row(p)


# --------------------------------------------------------------------------- live calculation (preview only)
class CalcIn(BaseModel):
    kind: str = "sales"
    price_mode: str = "exclusive"
    place_of_supply: str | None = None
    supplier_state_code: str | None = None
    party_gstin: str = ""
    is_export: bool = False
    export_with_igst: bool = False
    doc_type: str = "invoice"
    round_off: bool | None = None
    lines: list[dict]


@router.post("/gst/calculate")
def calculate(body: CalcIn, _: User = Depends(current_user), db: Session = Depends(get_db)):
    b = get_business(db)
    try:
        inputs = [LineInput(qty=dec(l.get("qty"), "1") or 1, unit_price=dec(l.get("unit_price")), gst_rate=dec(l.get("gst_rate")),
                            discount=dec(l.get("discount")), supply_kind=l.get("supply_kind") or "taxable",
                            cess_rate=dec(l.get("cess_rate"))) for l in body.lines]
        if body.kind == "sales" and body.is_export:
            for l in inputs:
                if l.supply_kind == "taxable":
                    l.supply_kind = "zero_rated"
                if not body.export_with_igst:
                    l.gst_rate = Decimal(0)
        if body.kind == "sales":
            inter = body.is_export or (body.place_of_supply or b.state_code) != b.state_code
        else:
            inter = (body.supplier_state_code or b.state_code) != (body.place_of_supply or b.state_code)
        ro = b.round_off if body.round_off is None else body.round_off
        if body.kind != "sales" and body.round_off is None:
            ro = False
        res = calc_document(inputs, inclusive=body.price_mode == "inclusive", inter_state=inter, round_off=ro)
    except (ValueError, ArithmeticError) as e:
        raise HTTPException(422, str(e)) from e
    section = classify_sales_doc(body.doc_type, party_gstin=body.party_gstin, inter_state=inter, total=res.total,
                                 b2cl_limit=b.b2cl_limit, is_export=body.is_export) if body.kind == "sales" else None
    from ..core.serialize import jsonable
    return jsonable({"inter_state": inter, "section": section, "lines": [r.__dict__ for r in res.lines],
                     **{k: getattr(res, k) for k in ("taxable_value", "cgst", "sgst", "igst", "cess", "round_off", "total")},
                     "by_rate": [{"rate": k, **v} for k, v in sorted(res.by_rate.items())]})
