"""Build and validate sales and purchase documents. All amounts are computed here, server-side."""
from __future__ import annotations

import datetime as dt
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..models import Business, Purchase, PurchaseLine, ReturnPeriod, SalesDoc, SalesLine
from .gst import LineInput, calc_document, classify_sales_doc, dec, money
from .gstin import STATES, normalise_gstin, state_from_gstin, validate_gstin
from .periods import month_key, quarter_key

NO_ITC_REASON = "Outward supply taxed at 5% without ITC (Notification 11/2017-CT(Rate), entry 7)"
BLOCKED_CATEGORIES = {"expense": "Blocked under section 17(5) or not used for business"}
LINE_FIELDS = ("description", "hsn_sac", "qty", "unit", "unit_price", "discount", "gst_rate", "cess_rate", "supply_kind")


def get_business(db: Session) -> Business:
    b = db.get(Business, 1)
    if not b:
        b = Business(id=1)
        db.add(b)
        db.flush()
    return b


def locked_period_for(db: Session, d: dt.date) -> ReturnPeriod | None:
    return db.scalar(select(ReturnPeriod).where(ReturnPeriod.locked.is_(True),
                                                or_(ReturnPeriod.period == month_key(d), ReturnPeriod.period == quarter_key(d))))


def ensure_unlocked(db: Session, *dates: dt.date | None) -> None:
    for d in dates:
        if d and (p := locked_period_for(db, d)):
            raise HTTPException(409, f"{p.period} is filed and locked. The owner can unlock it from Returns if a change is really needed")


def _line_inputs(lines: list[dict]) -> list[LineInput]:
    if not lines:
        raise HTTPException(422, "Add at least one line")
    out = []
    for i, l in enumerate(lines, 1):
        try:
            qty = dec(l.get("qty"), "1")
            if qty <= 0:
                raise ValueError("Quantity must be more than zero")
            if dec(l.get("unit_price")) < 0:
                raise ValueError("Rate cannot be negative")
            out.append(LineInput(qty=qty, unit_price=dec(l.get("unit_price")), gst_rate=dec(l.get("gst_rate")),
                                 discount=dec(l.get("discount")), supply_kind=l.get("supply_kind") or "taxable",
                                 cess_rate=dec(l.get("cess_rate")), hsn_sac=(l.get("hsn_sac") or "").strip(),
                                 description=(l.get("description") or "").strip(), unit=(l.get("unit") or "NOS").strip().upper()))
        except (ValueError, ArithmeticError) as e:
            raise HTTPException(422, f"Line {i}: {e}") from e
    return out


def _check_hsn(code: str, i: int) -> None:
    if code and (not code.isdigit() or len(code) not in (4, 6, 8)):
        raise HTTPException(422, f"Line {i}: HSN/SAC should be 4, 6 or 8 digits")


def _check_gstin(g: str, label: str) -> None:
    if g and not (c := validate_gstin(g)).ok:
        raise HTTPException(422, f"{label}: {c.error}")


def _check_state(code: str, label: str) -> None:
    if code not in STATES:
        raise HTTPException(422, f"{label}: choose a valid state")


def build_sales(db: Session, doc: SalesDoc, data: dict) -> SalesDoc:
    b = get_business(db)
    doc.doc_type = data.get("doc_type") or doc.doc_type or "invoice"
    if doc.doc_type not in ("invoice", "credit_note", "debit_note"):
        raise HTTPException(422, "Unknown document type")
    doc.number = (data.get("number") or "").strip()
    if not doc.number:
        raise HTTPException(422, "Invoice number is required")
    if len(doc.number) > 16:
        raise HTTPException(422, "GST allows at most 16 characters in an invoice number")
    doc.date = data["date"]
    doc.party_id = data.get("party_id")
    doc.party_name = (data.get("party_name") or "").strip()
    if not doc.party_name:
        raise HTTPException(422, "Customer name is required")
    doc.party_gstin = normalise_gstin(data.get("party_gstin"))
    _check_gstin(doc.party_gstin, "Customer GSTIN")
    doc.party_address = data.get("party_address") or ""
    doc.party_state_code = data.get("party_state_code") or state_from_gstin(doc.party_gstin) or b.state_code
    doc.is_export = bool(data.get("is_export"))
    doc.export_with_igst = bool(data.get("export_with_igst"))
    doc.place_of_supply = "96" if doc.is_export else (data.get("place_of_supply") or doc.party_state_code or b.state_code)
    _check_state(doc.place_of_supply, "Place of supply")
    doc.reverse_charge = bool(data.get("reverse_charge"))
    doc.price_mode = data.get("price_mode") or b.default_price_mode
    doc.notes = data.get("notes") or ""
    doc.order_ref = (data.get("order_ref") or "").strip()
    doc.original_number = (data.get("original_number") or "").strip()
    doc.original_date = data.get("original_date")
    doc.note_reason = data.get("note_reason") or ""
    if doc.doc_type != "invoice" and not doc.original_number:
        raise HTTPException(422, "Credit and debit notes need the original invoice number")

    inputs = _line_inputs(data.get("lines") or [])
    for i, l in enumerate(inputs, 1):
        _check_hsn(l.hsn_sac, i)
        if doc.is_export and l.supply_kind == "taxable":
            l.supply_kind = "zero_rated"
        if doc.is_export and not doc.export_with_igst:
            l.gst_rate = Decimal("0")
    inter = doc.is_export or doc.place_of_supply != b.state_code
    res = calc_document(inputs, inclusive=doc.price_mode == "inclusive", inter_state=inter,
                        round_off=bool(data.get("round_off", b.round_off)))
    doc.lines.clear()
    db.flush()
    for pos, (inp, r) in enumerate(zip(inputs, res.lines)):
        doc.lines.append(SalesLine(position=pos, description=inp.description, hsn_sac=inp.hsn_sac, qty=inp.qty, unit=inp.unit,
                                   unit_price=inp.unit_price, discount=r.discount, gst_rate=r.gst_rate, cess_rate=inp.cess_rate,
                                   supply_kind=inp.supply_kind, taxable_value=r.taxable_value, cgst=r.cgst, sgst=r.sgst,
                                   igst=r.igst, cess=r.cess, total=r.total))
    for k in ("taxable_value", "cgst", "sgst", "igst", "cess", "round_off", "total"):
        setattr(doc, k, getattr(res, k))
    doc.section = classify_sales_doc(doc.doc_type, party_gstin=doc.party_gstin, inter_state=inter, total=doc.total,
                                     b2cl_limit=b.b2cl_limit, is_export=doc.is_export)
    return doc


def build_purchase(db: Session, doc: Purchase, data: dict) -> Purchase:
    b = get_business(db)
    doc.doc_type = data.get("doc_type") or doc.doc_type or "invoice"
    if doc.doc_type not in ("invoice", "credit_note", "debit_note"):
        raise HTTPException(422, "Unknown document type")
    doc.number = (data.get("number") or "").strip()
    if not doc.number:
        raise HTTPException(422, "Supplier invoice number is required")
    doc.date = data["date"]
    doc.supplier_id = data.get("supplier_id")
    doc.supplier_name = (data.get("supplier_name") or "").strip()
    if not doc.supplier_name:
        raise HTTPException(422, "Supplier name is required")
    doc.supplier_gstin = normalise_gstin(data.get("supplier_gstin"))
    _check_gstin(doc.supplier_gstin, "Supplier GSTIN")
    doc.supplier_state_code = data.get("supplier_state_code") or state_from_gstin(doc.supplier_gstin) or b.state_code
    _check_state(doc.supplier_state_code, "Supplier state")
    doc.place_of_supply = data.get("place_of_supply") or b.state_code
    doc.reverse_charge = bool(data.get("reverse_charge"))
    doc.price_mode = data.get("price_mode") or "exclusive"
    doc.category = data.get("category") or "inputs"
    if doc.category not in ("inputs", "input_services", "capital_goods", "expense"):
        raise HTTPException(422, "Unknown purchase category")
    doc.notes = data.get("notes") or ""
    doc.original_number = (data.get("original_number") or "").strip()
    doc.original_date = data.get("original_date")
    doc.itc_period = data.get("itc_period") or month_key(doc.date)

    raw = data.get("lines") or []
    inputs = _line_inputs(raw)
    for i, l in enumerate(inputs, 1):
        _check_hsn(l.hsn_sac, i)
    inter = doc.supplier_state_code != doc.place_of_supply
    res = calc_document(inputs, inclusive=doc.price_mode == "inclusive", inter_state=inter,
                        round_off=bool(data.get("round_off", False)))
    doc.lines.clear()
    db.flush()
    for pos, (inp, r, src) in enumerate(zip(inputs, res.lines, raw)):
        eligible, reason = default_itc(b, doc.category, inp.supply_kind, r.tax)
        if src.get("itc_eligible") is not None and r.tax > 0:
            eligible = bool(src["itc_eligible"])
            reason = (src.get("itc_reason") or ("" if eligible else "Marked ineligible")).strip()
        doc.lines.append(PurchaseLine(position=pos, description=inp.description, hsn_sac=inp.hsn_sac, qty=inp.qty, unit=inp.unit,
                                      unit_price=inp.unit_price, discount=r.discount, gst_rate=r.gst_rate, cess_rate=inp.cess_rate,
                                      supply_kind=inp.supply_kind, taxable_value=r.taxable_value, cgst=r.cgst, sgst=r.sgst,
                                      igst=r.igst, cess=r.cess, total=r.total, itc_eligible=eligible, itc_reason=reason))
    for k in ("taxable_value", "cgst", "sgst", "igst", "cess", "round_off", "total"):
        setattr(doc, k, getattr(res, k))
    return doc


def default_itc(b: Business, category: str, supply_kind: str, tax: Decimal) -> tuple[bool, str]:
    if tax <= 0:
        return False, "No GST charged"
    if category in BLOCKED_CATEGORIES:
        return False, BLOCKED_CATEGORIES[category]
    if b.no_itc_scheme:
        return False, NO_ITC_REASON
    return True, ""


def doc_dict(doc, lines: bool = True) -> dict:
    from ..core.serialize import row
    d = row(doc)
    if lines:
        d["lines"] = [row(l) for l in doc.lines]
    return d


def itc_totals(p: Purchase) -> dict:
    out = {"eligible": {}, "ineligible": {}}
    for l in p.lines:
        bucket = out["eligible" if l.itc_eligible else "ineligible"]
        for k in ("igst", "cgst", "sgst", "cess"):
            bucket[k] = money(bucket.get(k, 0)) + l.__getattribute__(k)
    return out
