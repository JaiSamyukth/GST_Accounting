"""Match purchase records with GSTR-2B."""
from __future__ import annotations

import re
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Gstr2bEntry, Purchase
from .gst import ZERO
from .periods import months_in
from .gst import inr

TOLERANCE = Decimal("1.00")


def norm_no(n: str) -> str:
    s = re.sub(r"[^A-Z0-9]", "", (n or "").upper())
    return re.sub(r"(?<![0-9])0+(?=[0-9])", "", s)


def _tax(x) -> Decimal:
    return x.igst + x.cgst + x.sgst + x.cess


def reconcile(db: Session, key: str, persist: bool = True) -> dict:
    months = months_in(key)
    books = [p for p in db.scalars(select(Purchase).where(Purchase.status == "active", Purchase.itc_period.in_(months)))
             if p.supplier_gstin and not p.reverse_charge]
    portal = list(db.scalars(select(Gstr2bEntry).where(Gstr2bEntry.period.in_(months))))
    idx: dict[tuple, list[Gstr2bEntry]] = {}
    for e in portal:
        idx.setdefault((e.supplier_gstin, norm_no(e.number), e.doc_type), []).append(e)
    used: set[int] = set()
    rows = []
    for p in books:
        cand = [e for e in idx.get((p.supplier_gstin, norm_no(p.number), p.doc_type), []) if e.id not in used]
        probable = False
        if not cand:  # fall back: same supplier, same tax, same date
            cand = [e for e in portal if e.id not in used and e.supplier_gstin == p.supplier_gstin
                    and abs(_tax(e) - _tax(p)) <= TOLERANCE and e.date == p.date]
            probable = bool(cand)
        if not cand:
            status, e = "missing_in_2b", None
        else:
            e = cand[0]
            used.add(e.id)
            diffs = []
            if abs(e.taxable_value - p.taxable_value) > TOLERANCE:
                diffs.append(f"taxable value differs by ₹{inr(e.taxable_value - p.taxable_value)}")
            if abs(_tax(e) - _tax(p)) > TOLERANCE:
                diffs.append(f"tax differs by ₹{inr(_tax(e) - _tax(p))}")
            if e.date and e.date != p.date:
                diffs.append(f"date in 2B is {e.date.isoformat()}")
            if not e.itc_available:
                diffs.append("2B says ITC not available")
            status = "mismatch" if diffs else ("probable" if probable else "matched")
        if persist:
            p.recon_status = status
        rows.append({"status": status, "purchase_id": p.id, "entry_id": e.id if e else None,
                     "supplier_gstin": p.supplier_gstin, "supplier_name": p.supplier_name, "number": p.number,
                     "date": p.date, "books_taxable": p.taxable_value, "books_tax": _tax(p),
                     "portal_number": e.number if e else "", "portal_taxable": e.taxable_value if e else None,
                     "portal_tax": _tax(e) if e else None,
                     "note": "" if not e else ("; ".join(diffs) if status == "mismatch" else ("number differs, matched on amount and date" if probable else ""))})
    for e in portal:
        if e.id not in used:
            rows.append({"status": "missing_in_books", "purchase_id": None, "entry_id": e.id, "supplier_gstin": e.supplier_gstin,
                         "supplier_name": e.supplier_name, "number": "", "date": e.date, "books_taxable": None, "books_tax": None,
                         "portal_number": e.number, "portal_taxable": e.taxable_value, "portal_tax": _tax(e),
                         "note": "In GSTR-2B but not in your purchases. Add the bill if you received it"})
    summary = {s: {"count": 0, "tax": ZERO} for s in ("matched", "probable", "mismatch", "missing_in_2b", "missing_in_books")}
    for r in rows:
        summary[r["status"]]["count"] += 1
        summary[r["status"]]["tax"] += r["books_tax"] if r["books_tax"] is not None else (r["portal_tax"] or ZERO)
    if persist:
        db.commit()
    return {"period": key, "has_2b": bool(portal), "summary": summary, "rows": rows}
