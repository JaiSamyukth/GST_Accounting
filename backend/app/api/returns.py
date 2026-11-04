from __future__ import annotations

import datetime as dt
import json
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.audit import audit
from ..core.security import current_user, require_owner
from ..core.serialize import jsonable, row
from ..db import get_db
from ..models import Document, Gstr2bEntry, Purchase, ReturnPeriod, SalesDoc, User, now
from ..services import exporters, gsp
from ..services.docs import get_business
from ..services.periods import (fy_of, gstr1_due, gstr3b_due, months_in, period_label, period_range, periods_for_fy)
from ..services.recon import reconcile
from ..services.returns import build_gstr1, build_gstr3b, compare_1_vs_3b
from ..services.gst import inr

router = APIRouter(prefix="/api/returns", tags=["returns"])


def _valid_key(key: str) -> str:
    try:
        period_range(key)
    except ValueError as e:
        raise HTTPException(404, "Unknown period") from e
    return key


def get_period(db: Session, key: str, create: bool = True) -> ReturnPeriod | None:
    _valid_key(key)
    rp = db.scalar(select(ReturnPeriod).where(ReturnPeriod.period == key))
    if not rp and create:
        rp = ReturnPeriod(period=key, fy=fy_of(period_range(key)[0]))
        db.add(rp)
        db.flush()
    return rp


def _status_row(db: Session, b, key: str) -> dict:
    rp = get_period(db, key, create=False)
    start, end = period_range(key)
    sales = db.scalar(select(func.count(SalesDoc.id)).where(SalesDoc.date >= start, SalesDoc.date <= end, SalesDoc.status == "active"))
    purchases = db.scalar(select(func.count(Purchase.id)).where(Purchase.itc_period.in_(months_in(key)), Purchase.status == "active"))
    if rp and rp.locked and rp.snapshot:
        figs = rp.snapshot.get("figures", {})
    else:
        g3 = build_gstr3b(db, b, key, rp)
        figs = {"output_tax": g3["output_tax"], "eligible_itc": g3["eligible_itc"], "net_payable": g3["net_payable"]}
    today = dt.date.today()
    return {"period": key, "label": period_label(key), "fy": fy_of(start), "start": start, "end": end,
            "sales_count": sales, "purchase_count": purchases,
            "gstr1_status": rp.gstr1_status if rp else "open", "gstr3b_status": rp.gstr3b_status if rp else "open",
            "gstr1_due": gstr1_due(key), "gstr3b_due": gstr3b_due(key), "locked": bool(rp and rp.locked),
            "gstr1_arn": rp.gstr1_arn if rp else "", "gstr3b_arn": rp.gstr3b_arn if rp else "",
            "gstr1_filed_on": rp.gstr1_filed_on if rp else None, "gstr3b_filed_on": rp.gstr3b_filed_on if rp else None,
            "tax_paid": (rp.paid_igst + rp.paid_cgst + rp.paid_sgst + rp.paid_cess) if rp else Decimal(0),
            "overdue": (end < today and (not rp or rp.gstr3b_status != "filed") and gstr3b_due(key) < today),
            "future": start > today, **figs}


@router.get("")
def list_periods(fy: str | None = None, _: User = Depends(current_user), db: Session = Depends(get_db)):
    b = get_business(db)
    fy = fy or fy_of(dt.date.today())
    today = dt.date.today()
    keys = [k for k in periods_for_fy(fy, b.filing_frequency) if period_range(k)[0] <= today]
    return jsonable([_status_row(db, b, k) for k in reversed(keys)])


@router.get("/gsp-status")
def gsp_status(_: User = Depends(current_user)):
    return gsp.status()


@router.get("/{key}")
def overview(key: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    b = get_business(db)
    _valid_key(key)
    rp = get_period(db, key, create=False)
    g1 = build_gstr1(db, b, key)
    g3 = build_gstr3b(db, b, key, rp)
    has_2b = g3["has_2b"]
    recon = reconcile(db, key, persist=False) if has_2b else None
    errors = [i for i in g1["issues"] if i["level"] == "error"]
    status = _status_row(db, b, key)
    steps = [
        {"key": "sales", "label": "Record sales", "done": status["sales_count"] > 0, "detail": f"{status['sales_count']} invoices and notes"},
        {"key": "purchases", "label": "Record purchases", "done": status["purchase_count"] > 0, "detail": f"{status['purchase_count']} bills"},
        {"key": "itc", "label": "Match purchases with GSTR-2B", "done": has_2b and recon and recon["summary"]["missing_in_2b"]["count"] == 0
         and recon["summary"]["mismatch"]["count"] == 0, "detail": "GSTR-2B imported" if has_2b else "GSTR-2B not imported yet"},
        {"key": "gstr1", "label": "Check GSTR-1", "done": not errors, "detail": f"{len(errors)} problems to fix" if errors else "No problems found"},
        {"key": "gstr3b", "label": "Check GSTR-3B", "done": True, "detail": f"Pay ₹{inr(g3['net_payable'])} in cash"},
        {"key": "approve", "label": "Approve", "done": bool(rp and rp.approved_at), "detail": "Owner signs off the figures"},
        {"key": "file", "label": "File on the GST portal", "done": bool(rp and rp.gstr1_status == "filed" and rp.gstr3b_status == "filed"),
         "detail": "Upload the JSON, pay, file"},
        {"key": "arn", "label": "Save ARN and acknowledgement", "done": bool(rp and rp.gstr1_arn and rp.gstr3b_arn), "detail": ""},
    ]
    docs = list(db.scalars(select(Document).where(Document.entity_type == "return", Document.entity_id == (rp.id if rp else -1))))
    return jsonable({**status, "steps": steps, "issues": g1["issues"], "gstr1_sections": g1["sections"], "gstr3b": g3,
                     "compare": compare_1_vs_3b(g1, g3), "recon": recon["summary"] if recon else None,
                     "period_record": row(rp) if rp else None, "documents": [row(d) for d in docs], "gsp": gsp.status()})


@router.get("/{key}/gstr1")
def gstr1(key: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    return jsonable(build_gstr1(db, get_business(db), _valid_key(key)))


@router.get("/{key}/gstr3b")
def gstr3b(key: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    return jsonable(build_gstr3b(db, get_business(db), _valid_key(key), get_period(db, key, create=False)))


def _g1_tables(g1: dict) -> list[dict]:
    m = "money"
    tax = [{"key": "taxable_value", "label": "Taxable value", "type": m}, {"key": "igst", "label": "IGST", "type": m},
           {"key": "cgst", "label": "CGST", "type": m}, {"key": "sgst", "label": "SGST", "type": m}, {"key": "cess", "label": "Cess", "type": m}]
    out = [{"title": "GSTR-1 summary", "sheet": "Summary", "columns": [{"key": "label", "label": "Section"}, {"key": "count", "label": "Documents", "type": "number"}, *tax],
            "rows": g1["sections"], "totals": None}]
    p = g1["payload"]
    rows = []
    for grp in p.get("b2b", []):
        for inv in grp["inv"]:
            for it in inv["itms"]:
                d = it["itm_det"]
                rows.append({"ctin": grp["ctin"], "inum": inv["inum"], "idt": inv["idt"], "val": inv["val"], "pos": inv["pos"], "rchrg": inv["rchrg"],
                             "rt": d["rt"], "txval": d["txval"], "iamt": d["iamt"], "camt": d["camt"], "samt": d["samt"], "csamt": d["csamt"]})
    out.append({"title": "b2b", "columns": [{"key": "ctin", "label": "GSTIN/UIN of Recipient"}, {"key": "inum", "label": "Invoice Number"},
                {"key": "idt", "label": "Invoice date"}, {"key": "val", "label": "Invoice Value", "type": m}, {"key": "pos", "label": "Place Of Supply"},
                {"key": "rchrg", "label": "Reverse Charge"}, {"key": "rt", "label": "Rate", "type": "number"}, {"key": "txval", "label": "Taxable Value", "type": m},
                {"key": "iamt", "label": "Integrated Tax", "type": m}, {"key": "camt", "label": "Central Tax", "type": m},
                {"key": "samt", "label": "State/UT Tax", "type": m}, {"key": "csamt", "label": "Cess Amount", "type": m}], "rows": rows})
    rows = []
    for grp in p.get("b2cl", []):
        for inv in grp["inv"]:
            for it in inv["itms"]:
                d = it["itm_det"]
                rows.append({"inum": inv["inum"], "idt": inv["idt"], "val": inv["val"], "pos": grp["pos"], "rt": d["rt"], "txval": d["txval"], "iamt": d["iamt"], "csamt": d["csamt"]})
    out.append({"title": "b2cl", "columns": [{"key": "inum", "label": "Invoice Number"}, {"key": "idt", "label": "Invoice date"},
                {"key": "val", "label": "Invoice Value", "type": m}, {"key": "pos", "label": "Place Of Supply"}, {"key": "rt", "label": "Rate", "type": "number"},
                {"key": "txval", "label": "Taxable Value", "type": m}, {"key": "iamt", "label": "Integrated Tax", "type": m}, {"key": "csamt", "label": "Cess Amount", "type": m}], "rows": rows})
    out.append({"title": "b2cs", "columns": [{"key": "sply_ty", "label": "Type"}, {"key": "pos", "label": "Place Of Supply"}, {"key": "rt", "label": "Rate", "type": "number"},
                {"key": "txval", "label": "Taxable Value", "type": m}, {"key": "iamt", "label": "Integrated Tax", "type": m}, {"key": "camt", "label": "Central Tax", "type": m},
                {"key": "samt", "label": "State/UT Tax", "type": m}, {"key": "csamt", "label": "Cess Amount", "type": m}], "rows": p.get("b2cs", [])})
    rows = []
    for grp in p.get("cdnr", []):
        for nt in grp["nt"]:
            for it in nt["itms"]:
                d = it["itm_det"]
                rows.append({"ctin": grp["ctin"], "nt_num": nt["nt_num"], "nt_dt": nt["nt_dt"], "ntty": nt["ntty"], "val": nt["val"], "pos": nt["pos"],
                             "rt": d["rt"], "txval": d["txval"], "iamt": d["iamt"], "camt": d["camt"], "samt": d["samt"], "csamt": d["csamt"]})
    for nt in p.get("cdnur", []):
        for it in nt["itms"]:
            d = it["itm_det"]
            rows.append({"ctin": f"Unregistered ({nt['typ']})", "nt_num": nt["nt_num"], "nt_dt": nt["nt_dt"], "ntty": nt["ntty"], "val": nt["val"],
                         "pos": nt["pos"], "rt": d["rt"], "txval": d["txval"], "iamt": d["iamt"], "camt": d.get("camt", 0), "samt": d.get("samt", 0), "csamt": d["csamt"]})
    out.append({"title": "cdnr", "sheet": "cdnr+cdnur", "columns": [{"key": "ctin", "label": "GSTIN/UIN of Recipient"}, {"key": "nt_num", "label": "Note Number"},
                {"key": "nt_dt", "label": "Note Date"}, {"key": "ntty", "label": "Note Type"}, {"key": "val", "label": "Note Value", "type": m},
                {"key": "pos", "label": "Place Of Supply"}, {"key": "rt", "label": "Rate", "type": "number"}, {"key": "txval", "label": "Taxable Value", "type": m},
                {"key": "iamt", "label": "Integrated Tax", "type": m}, {"key": "camt", "label": "Central Tax", "type": m},
                {"key": "samt", "label": "State/UT Tax", "type": m}, {"key": "csamt", "label": "Cess Amount", "type": m}], "rows": rows})
    nil = p.get("nil", {}).get("inv", [])
    names = {"INTRB2B": "Inter-State supplies to registered persons", "INTRAB2B": "Intra-State supplies to registered persons",
             "INTRB2C": "Inter-State supplies to unregistered persons", "INTRAB2C": "Intra-State supplies to unregistered persons"}
    out.append({"title": "exemp", "columns": [{"key": "desc", "label": "Description"}, {"key": "nil_amt", "label": "Nil Rated Supplies", "type": m},
                {"key": "expt_amt", "label": "Exempted (other than nil rated/non GST supply)", "type": m}, {"key": "ngsup_amt", "label": "Non-GST Supplies", "type": m}],
                "rows": [{"desc": names[r["sply_ty"]], **r} for r in nil]})
    hcols = [{"key": "hsn_sc", "label": "HSN"}, {"key": "desc", "label": "Description"}, {"key": "uqc", "label": "UQC"}, {"key": "qty", "label": "Total Quantity", "type": "number"},
             {"key": "rt", "label": "Rate", "type": "number"}, {"key": "txval", "label": "Taxable Value", "type": m}, {"key": "iamt", "label": "Integrated Tax Amount", "type": m},
             {"key": "camt", "label": "Central Tax Amount", "type": m}, {"key": "samt", "label": "State/UT Tax Amount", "type": m}, {"key": "csamt", "label": "Cess Amount", "type": m}]
    out.append({"title": "hsn(b2b)", "columns": hcols, "rows": g1["hsn"]["b2b"]})
    out.append({"title": "hsn(b2c)", "columns": hcols, "rows": g1["hsn"]["b2c"]})
    di = []
    for d in p.get("doc_issue", {}).get("doc_det", []):
        name = {1: "Invoices for outward supply", 4: "Debit Note", 5: "Credit Note"}[d["doc_num"]]
        for x in d["docs"]:
            di.append({"nature": name, **x})
    out.append({"title": "docs", "columns": [{"key": "nature", "label": "Nature of Document"}, {"key": "from", "label": "Sr. No. From"}, {"key": "to", "label": "Sr. No. To"},
                {"key": "totnum", "label": "Total Number", "type": "number"}, {"key": "cancel", "label": "Cancelled", "type": "number"}], "rows": di})
    return out


def _g3_tables(g3: dict) -> list[dict]:
    m = "money"
    rows = [{"table": k, "txval": v.get("txval"), "igst": v.get("igst"), "cgst": v.get("cgst"), "sgst": v.get("sgst"), "cess": v.get("cess")}
            for k, v in g3["tables"].items()]
    pay = g3["payment"]
    prow = []
    for head in ("igst", "cgst", "sgst", "cess"):
        used = {src: pay["itc_used"][src].get(head, 0) for src in pay["itc_used"]}
        prow.append({"head": head.upper(), "liability": pay["liability"][head], "by_igst": used.get("igst"), "by_cgst": used.get("cgst"),
                     "by_sgst": used.get("sgst"), "by_cess": used.get("cess"), "cash": pay["cash"][head]})
    return [{"title": "GSTR-3B", "sheet": "GSTR-3B", "columns": [{"key": "table", "label": "Table"}, {"key": "txval", "label": "Taxable value", "type": m},
             {"key": "igst", "label": "IGST", "type": m}, {"key": "cgst", "label": "CGST", "type": m}, {"key": "sgst", "label": "SGST", "type": m},
             {"key": "cess", "label": "Cess", "type": m}], "rows": rows},
            {"title": "6.1 Payment of tax", "sheet": "Payment", "columns": [{"key": "head", "label": "Tax"}, {"key": "liability", "label": "Tax payable", "type": m},
             {"key": "by_igst", "label": "Paid with IGST credit", "type": m}, {"key": "by_cgst", "label": "Paid with CGST credit", "type": m},
             {"key": "by_sgst", "label": "Paid with SGST credit", "type": m}, {"key": "by_cess", "label": "Paid with cess credit", "type": m},
             {"key": "cash", "label": "Pay in cash", "type": m}], "rows": prow}]


@router.get("/{key}/{ret}.{fmt}")
def download(key: str, ret: str, fmt: str, u: User = Depends(current_user), db: Session = Depends(get_db)):
    b = get_business(db)
    _valid_key(key)
    if ret not in ("gstr1", "gstr3b") or fmt not in ("json", "xlsx", "pdf", "csv"):
        raise HTTPException(404, "Unknown download")
    data = build_gstr1(db, b, key) if ret == "gstr1" else build_gstr3b(db, b, key, get_period(db, key, create=False))
    name = f"{ret.upper()}_{b.gstin or 'GSTIN'}_{data['payload'].get('fp') or data['payload'].get('ret_period')}"
    if fmt == "json":
        body = json.dumps(data["payload"], indent=1, ensure_ascii=False).encode()
    else:
        tables = _g1_tables(jsonable(data)) if ret == "gstr1" else _g3_tables(data)
        body = exporters.render(tables, fmt, b.trade_name or b.legal_name, f"{period_label(key)} · GSTIN {b.gstin} · schema {data['schema_version']}")
    audit(db, u, "export", "return", key, f"Downloaded {ret.upper()} {fmt.upper()} for {key}")
    db.commit()
    return Response(body, media_type=exporters.MEDIA[fmt], headers={"Content-Disposition": f'attachment; filename="{name}.{fmt}"'})


@router.get("/{key}/compare")
def compare(key: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    b = get_business(db)
    return jsonable(compare_1_vs_3b(build_gstr1(db, b, _valid_key(key)), build_gstr3b(db, b, key)))


@router.post("/{key}/approve")
def approve(key: str, u: User = Depends(require_owner), db: Session = Depends(get_db)):
    b = get_business(db)
    rp = get_period(db, key)
    g1 = build_gstr1(db, b, key)
    errors = [i for i in g1["issues"] if i["level"] == "error"]
    if errors:
        raise HTTPException(422, f"Fix {len(errors)} problem(s) in GSTR-1 first: {errors[0]['message']}")
    rp.approved_by, rp.approved_at = u.id, now()
    if rp.gstr1_status == "open":
        rp.gstr1_status = "approved"
    if rp.gstr3b_status == "open":
        rp.gstr3b_status = "approved"
    audit(db, u, "approve", "return", key, f"Approved returns for {key}")
    db.commit()
    return {"ok": True}


class Filed(BaseModel):
    ret: str
    arn: str
    filed_on: dt.date


@router.post("/{key}/filed")
def mark_filed(key: str, body: Filed, u: User = Depends(current_user), db: Session = Depends(get_db)):
    b = get_business(db)
    rp = get_period(db, key)
    if body.ret not in ("gstr1", "gstr3b"):
        raise HTTPException(422, "Return must be gstr1 or gstr3b")
    arn = body.arn.strip().upper()
    if not (10 <= len(arn) <= 20) or not arn.isalnum():
        raise HTTPException(422, "ARN looks wrong. It is usually 15 letters and numbers, like AA331126012345X")
    if not rp.approved_at:
        raise HTTPException(422, "The owner has to approve this period before it is marked as filed")
    before = row(rp)
    setattr(rp, f"{body.ret}_status", "filed")
    setattr(rp, f"{body.ret}_arn", arn)
    setattr(rp, f"{body.ret}_filed_on", body.filed_on)
    if rp.gstr1_status == "filed" and rp.gstr3b_status == "filed":
        g1 = build_gstr1(db, b, key)
        g3 = build_gstr3b(db, b, key, rp)
        rp.snapshot = jsonable({"gstr1": g1["payload"], "gstr1_sections": g1["sections"], "gstr3b": g3["payload"],
                                "figures": {"output_tax": g3["output_tax"], "eligible_itc": g3["eligible_itc"], "net_payable": g3["net_payable"]}})
        rp.output_tax, rp.eligible_itc, rp.net_payable = g3["output_tax"], g3["eligible_itc"], g3["net_payable"]
        rp.locked = True
    audit(db, u, "file", "return", key, f"Marked {body.ret.upper()} for {key} as filed, ARN {arn}", before, row(rp))
    db.commit()
    return row(rp)


class Payment(BaseModel):
    paid_igst: Decimal = Decimal(0)
    paid_cgst: Decimal = Decimal(0)
    paid_sgst: Decimal = Decimal(0)
    paid_cess: Decimal = Decimal(0)
    interest: Decimal = Decimal(0)
    late_fee: Decimal = Decimal(0)
    challan_ref: str = ""
    paid_on: dt.date | None = None
    notes: str = ""


@router.post("/{key}/payment")
def record_payment(key: str, body: Payment, u: User = Depends(current_user), db: Session = Depends(get_db)):
    rp = get_period(db, key)
    if any(v < 0 for v in (body.paid_igst, body.paid_cgst, body.paid_sgst, body.paid_cess, body.interest, body.late_fee)):
        raise HTTPException(422, "Amounts cannot be negative")
    before = row(rp)
    for k, v in body.model_dump().items():
        setattr(rp, k, v)
    audit(db, u, "update", "return", key, f"Recorded tax payment for {key}", before, row(rp))
    db.commit()
    return row(rp)


@router.post("/{key}/unlock")
def unlock(key: str, body: dict, u: User = Depends(require_owner), db: Session = Depends(get_db)):
    rp = get_period(db, key)
    reason = (body.get("reason") or "").strip()
    if len(reason) < 5:
        raise HTTPException(422, "Write why this filed period is being unlocked")
    rp.locked = False
    audit(db, u, "unlock", "return", key, f"Unlocked filed period {key}: {reason}")
    db.commit()
    return row(rp)


@router.post("/{key}/lock")
def lock(key: str, u: User = Depends(require_owner), db: Session = Depends(get_db)):
    rp = get_period(db, key)
    rp.locked = True
    audit(db, u, "lock", "return", key, f"Locked period {key}")
    db.commit()
    return row(rp)


@router.post("/{key}/submit")
def submit(key: str, _: User = Depends(require_owner)):
    try:
        gsp.submit("gstr1", {})
    except gsp.GspNotConfigured as e:
        raise HTTPException(501, str(e)) from e
