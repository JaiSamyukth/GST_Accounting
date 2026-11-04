"""The twelve GST reports, each returned as a table {title, columns, rows, totals}."""
from __future__ import annotations

import datetime as dt
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..models import Business, Purchase, SalesDoc
from .gst import ZERO
from .gstin import STATES
from .periods import MONTHS, month_key, period_key
from .recon import reconcile
from .returns import build_gstr1, build_gstr3b

M = "money"
TAXCOLS = [{"key": "taxable_value", "label": "Taxable value", "type": M}, {"key": "cgst", "label": "CGST", "type": M},
           {"key": "sgst", "label": "SGST", "type": M}, {"key": "igst", "label": "IGST", "type": M}, {"key": "cess", "label": "Cess", "type": M}]
TAXKEYS = ("taxable_value", "cgst", "sgst", "igst", "cess")

REPORTS = {
    "sales": "Monthly sales report",
    "purchases": "Monthly purchase report",
    "gst_collected": "GST collected",
    "gst_paid": "GST paid on purchases",
    "output_liability": "Output GST liability",
    "itc": "Input tax credit",
    "itc_recon": "ITC reconciliation with GSTR-2B",
    "hsn": "HSN/SAC summary",
    "rate_wise": "GST rate-wise summary",
    "gstr1": "GSTR-1 summary",
    "gstr3b": "GSTR-3B summary",
    "net_payable": "Monthly net tax payable",
}


def _sales(db, start, end):
    return list(db.scalars(select(SalesDoc).options(selectinload(SalesDoc.lines))
                           .where(SalesDoc.status == "active", SalesDoc.date >= start, SalesDoc.date <= end)
                           .order_by(SalesDoc.date, SalesDoc.number)))


def _purchases(db, start, end):
    return list(db.scalars(select(Purchase).options(selectinload(Purchase.lines))
                           .where(Purchase.status == "active", Purchase.date >= start, Purchase.date <= end).order_by(Purchase.date)))


def _sign(d):
    return -1 if d.doc_type == "credit_note" else 1


def _totals(rows, keys):
    return {k: sum((r.get(k) or ZERO for r in rows), ZERO) for k in keys}


def _mlabel(k: str) -> str:
    y, m = k.split("-")
    return f"{MONTHS[int(m) - 1][:3]} {y}"


DOC_LABEL = {"invoice": "Invoice", "credit_note": "Credit note", "debit_note": "Debit note"}


def build(db: Session, b: Business, kind: str, start: dt.date, end: dt.date) -> dict:
    title = REPORTS[kind]
    if kind == "sales":
        rows = [{"date": d.date, "number": d.number, "type": DOC_LABEL[d.doc_type], "party": d.party_name, "gstin": d.party_gstin,
                 "pos": STATES.get(d.place_of_supply, d.place_of_supply), "section": d.section.upper(),
                 **{k: _sign(d) * getattr(d, k) for k in TAXKEYS}, "total": _sign(d) * d.total} for d in _sales(db, start, end)]
        cols = [{"key": "date", "label": "Date", "type": "date"}, {"key": "number", "label": "Number"}, {"key": "type", "label": "Type"},
                {"key": "party", "label": "Customer"}, {"key": "gstin", "label": "GSTIN"}, {"key": "pos", "label": "Place of supply"},
                {"key": "section", "label": "GSTR-1"}, *TAXCOLS, {"key": "total", "label": "Total", "type": M}]
        return {"title": title, "columns": cols, "rows": rows, "totals": _totals(rows, (*TAXKEYS, "total"))}

    if kind == "purchases":
        rows = []
        for p in _purchases(db, start, end):
            elig = sum((l.cgst + l.sgst + l.igst + l.cess for l in p.lines if l.itc_eligible), ZERO)
            rows.append({"date": p.date, "number": p.number, "type": DOC_LABEL[p.doc_type], "party": p.supplier_name, "gstin": p.supplier_gstin,
                         "category": p.category.replace("_", " "), **{k: _sign(p) * getattr(p, k) for k in TAXKEYS},
                         "total": _sign(p) * p.total, "itc": _sign(p) * elig, "recon": p.recon_status.replace("_", " ")})
        cols = [{"key": "date", "label": "Date", "type": "date"}, {"key": "number", "label": "Bill number"}, {"key": "type", "label": "Type"},
                {"key": "party", "label": "Supplier"}, {"key": "gstin", "label": "GSTIN"}, {"key": "category", "label": "Category"}, *TAXCOLS,
                {"key": "total", "label": "Total", "type": M}, {"key": "itc", "label": "Eligible ITC", "type": M}, {"key": "recon", "label": "2B status"}]
        return {"title": title, "columns": cols, "rows": rows, "totals": _totals(rows, (*TAXKEYS, "total", "itc"))}

    if kind in ("gst_collected", "gst_paid"):
        docs = _sales(db, start, end) if kind == "gst_collected" else _purchases(db, start, end)
        by: dict[str, dict] = defaultdict(lambda: {k: ZERO for k in TAXKEYS})
        for d in docs:
            r = by[month_key(d.date)]
            for k in TAXKEYS:
                r[k] += _sign(d) * getattr(d, k)
        rows = [{"month": _mlabel(m), **v, "total_tax": v["cgst"] + v["sgst"] + v["igst"] + v["cess"]} for m, v in sorted(by.items())]
        cols = [{"key": "month", "label": "Month"}, *TAXCOLS, {"key": "total_tax", "label": "Total GST", "type": M}]
        return {"title": title, "columns": cols, "rows": rows, "totals": _totals(rows, (*TAXKEYS, "total_tax"))}

    if kind in ("output_liability", "rate_wise"):
        by = defaultdict(lambda: {k: ZERO for k in TAXKEYS})
        for d in _sales(db, start, end):
            for l in d.lines:
                k = (month_key(d.date) if kind == "output_liability" else "", l.supply_kind, l.gst_rate)
                for f in TAXKEYS:
                    by[k][f] += _sign(d) * getattr(l, f)
        rows = [{"month": _mlabel(k[0]) if k[0] else "", "kind": k[1].replace("_", " "), "rate": f"{k[2]:g}%", **v,
                 "total_tax": v["cgst"] + v["sgst"] + v["igst"] + v["cess"]} for k, v in sorted(by.items())]
        cols = ([{"key": "month", "label": "Month"}] if kind == "output_liability" else []) + [
            {"key": "kind", "label": "Supply type"}, {"key": "rate", "label": "GST rate"}, *TAXCOLS, {"key": "total_tax", "label": "Total GST", "type": M}]
        t = {"title": title, "columns": cols, "rows": rows, "totals": _totals(rows, (*TAXKEYS, "total_tax"))}
        if kind == "rate_wise":
            pby = defaultdict(lambda: {k: ZERO for k in TAXKEYS})
            for p in _purchases(db, start, end):
                for l in p.lines:
                    for f in TAXKEYS:
                        pby[(l.supply_kind, l.gst_rate)][f] += _sign(p) * getattr(l, f)
            for (kind_, rate), v in sorted(pby.items()):
                rows.append({"kind": f"purchases, {kind_.replace('_', ' ')}", "rate": f"{rate:g}%", **v,
                             "total_tax": v["cgst"] + v["sgst"] + v["igst"] + v["cess"]})
            t["totals"] = None
        return t

    if kind == "itc":
        by = defaultdict(lambda: {"eligible": ZERO, "ineligible": ZERO, "igst": ZERO, "cgst": ZERO, "sgst": ZERO, "cess": ZERO})
        reasons = defaultdict(lambda: ZERO)
        for p in _purchases(db, start, end):
            r = by[p.itc_period or month_key(p.date)]
            for l in p.lines:
                tax = _sign(p) * (l.cgst + l.sgst + l.igst + l.cess)
                if l.itc_eligible:
                    r["eligible"] += tax
                    for k in ("igst", "cgst", "sgst", "cess"):
                        r[k] += _sign(p) * getattr(l, k)
                else:
                    r["ineligible"] += tax
                    if tax:
                        reasons[l.itc_reason or "Not specified"] += tax
        rows = [{"month": _mlabel(m), **v} for m, v in sorted(by.items())]
        cols = [{"key": "month", "label": "ITC month"}, {"key": "igst", "label": "Eligible IGST", "type": M},
                {"key": "cgst", "label": "Eligible CGST", "type": M}, {"key": "sgst", "label": "Eligible SGST", "type": M},
                {"key": "cess", "label": "Eligible cess", "type": M}, {"key": "eligible", "label": "Eligible total", "type": M},
                {"key": "ineligible", "label": "Ineligible", "type": M}]
        return {"title": title, "columns": cols, "rows": rows, "totals": _totals(rows, ("igst", "cgst", "sgst", "cess", "eligible", "ineligible")),
                "extra": {"ineligible_reasons": [{"reason": k, "amount": v} for k, v in reasons.items()]}}

    if kind == "itc_recon":
        rows = []
        for key in _periods(b, start, end):
            r = reconcile(db, key, persist=False)
            for x in r["rows"]:
                rows.append({"period": key, **{k: x[k] for k in ("status", "supplier_name", "supplier_gstin", "number", "portal_number",
                                                                 "date", "books_tax", "portal_tax", "note")}})
                rows[-1]["status"] = rows[-1]["status"].replace("_", " ")
        cols = [{"key": "period", "label": "Period"}, {"key": "status", "label": "Status"}, {"key": "supplier_name", "label": "Supplier"},
                {"key": "supplier_gstin", "label": "GSTIN"}, {"key": "number", "label": "Bill no. (books)"},
                {"key": "portal_number", "label": "Bill no. (2B)"}, {"key": "date", "label": "Date", "type": "date"},
                {"key": "books_tax", "label": "Tax in books", "type": M}, {"key": "portal_tax", "label": "Tax in 2B", "type": M},
                {"key": "note", "label": "Note"}]
        return {"title": title, "columns": cols, "rows": rows, "totals": None}

    if kind == "hsn":
        by = defaultdict(lambda: {"qty": Decimal(0), **{k: ZERO for k in TAXKEYS}, "desc": ""})
        for d in _sales(db, start, end):
            for l in d.lines:
                r = by[(l.hsn_sac or "missing", l.unit, l.gst_rate)]
                r["desc"] = r["desc"] or l.description
                r["qty"] += _sign(d) * l.qty
                for f in TAXKEYS:
                    r[f] += _sign(d) * getattr(l, f)
        rows = [{"hsn": k[0], "desc": v["desc"], "uqc": k[1], "rate": f"{k[2]:g}%", **v} for k, v in sorted(by.items())]
        cols = [{"key": "hsn", "label": "HSN/SAC"}, {"key": "desc", "label": "Description"}, {"key": "uqc", "label": "UQC"},
                {"key": "qty", "label": "Quantity", "type": "number"}, {"key": "rate", "label": "Rate"}, *TAXCOLS]
        return {"title": title, "columns": cols, "rows": rows, "totals": _totals(rows, TAXKEYS)}

    if kind == "gstr1":
        rows = []
        for key in _periods(b, start, end):
            g = build_gstr1(db, b, key)
            for s in g["sections"]:
                rows.append({"period": key, "section": s["label"], "count": s["count"], **{k: s[k] for k in TAXKEYS}})
            if any(g["nil"].values()):
                rows.append({"period": key, "section": "Nil, exempt and non-GST (8)", "count": "",
                             "taxable_value": sum(g["nil"].values(), ZERO), "cgst": ZERO, "sgst": ZERO, "igst": ZERO, "cess": ZERO})
        cols = [{"key": "period", "label": "Period"}, {"key": "section", "label": "Section"}, {"key": "count", "label": "Documents", "type": "number"}, *TAXCOLS]
        return {"title": title, "columns": cols, "rows": rows, "totals": None}

    if kind == "gstr3b":
        rows = []
        for key in _periods(b, start, end):
            g = build_gstr3b(db, b, key)
            for label, v in g["tables"].items():
                rows.append({"period": key, "table": label, "taxable_value": v.get("txval"), "igst": v.get("igst"), "cgst": v.get("cgst"),
                             "sgst": v.get("sgst"), "cess": v.get("cess")})
        cols = [{"key": "period", "label": "Period"}, {"key": "table", "label": "Table"}, {"key": "taxable_value", "label": "Taxable value", "type": M},
                {"key": "igst", "label": "IGST", "type": M}, {"key": "cgst", "label": "CGST", "type": M}, {"key": "sgst", "label": "SGST", "type": M},
                {"key": "cess", "label": "Cess", "type": M}]
        return {"title": title, "columns": cols, "rows": rows, "totals": None}

    if kind == "net_payable":
        rows = []
        for key in _periods(b, start, end):
            g = build_gstr3b(db, b, key)
            p = g["payment"]
            rows.append({"period": key, "output_tax": g["output_tax"], "itc": g["eligible_itc"],
                         "itc_used": sum((v for src in p["itc_used"].values() for v in src.values()), ZERO),
                         "cash": g["net_payable"], "carry": sum(p["closing_credit"].values(), ZERO)})
        cols = [{"key": "period", "label": "Period"}, {"key": "output_tax", "label": "Output tax", "type": M},
                {"key": "itc", "label": "Net ITC", "type": M}, {"key": "itc_used", "label": "ITC used", "type": M},
                {"key": "cash", "label": "Pay in cash", "type": M}, {"key": "carry", "label": "Credit carried forward", "type": M}]
        return {"title": title, "columns": cols, "rows": rows, "totals": _totals(rows, ("output_tax", "itc_used", "cash"))}

    raise KeyError(kind)


def _periods(b: Business, start: dt.date, end: dt.date) -> list[str]:
    keys, d = [], start
    while d <= end:
        k = period_key(d, b.filing_frequency)
        if k not in keys:
            keys.append(k)
        d = (d.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    return keys
