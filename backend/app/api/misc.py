"""Reports, imports, documents, home dashboard, backup."""
from __future__ import annotations

import datetime as dt
import io
import json
import zipfile

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..core.audit import audit
from ..core.security import current_user, require_owner
from ..core.serialize import jsonable, row
from ..db import Base, get_db
from ..models import AuditLog, Document, ImportBatch, Purchase, ReturnPeriod, SalesDoc, User
from ..services import exporters, importers
from ..services.docs import get_business
from ..services.periods import fy_of, gstr1_due, gstr3b_due, months_in, period_key, period_label, period_range
from ..services.reports import REPORTS, build as build_report
from ..services.returns import build_gstr3b
from ..services.storage import get_storage, sha256
from .deps import date_range

router = APIRouter(prefix="/api", tags=["reports, imports, documents"])


# ------------------------------------------------------------------------------------------- reports
@router.get("/reports")
def list_reports(_: User = Depends(current_user)):
    return [{"key": k, "title": v} for k, v in REPORTS.items()]


@router.get("/reports/{kind}")
def report(kind: str, rng=Depends(date_range), _: User = Depends(current_user), db: Session = Depends(get_db)):
    if kind not in REPORTS:
        raise HTTPException(404, "Unknown report")
    return jsonable(build_report(db, get_business(db), kind, *rng))


@router.get("/reports/{kind}/export")
def export_report(kind: str, fmt: str, rng=Depends(date_range), u: User = Depends(current_user), db: Session = Depends(get_db)):
    if kind not in REPORTS or fmt not in exporters.MEDIA:
        raise HTTPException(404, "Unknown report or format")
    b = get_business(db)
    t = build_report(db, b, kind, *rng)
    data = exporters.render(t, fmt, b.trade_name or b.legal_name or "Business", f"{rng[0]:%d %b %Y} to {rng[1]:%d %b %Y} · GSTIN {b.gstin}")
    audit(db, u, "export", "report", kind, f"Exported {REPORTS[kind]} as {fmt.upper()}")
    db.commit()
    return Response(data, media_type=exporters.MEDIA[fmt],
                    headers={"Content-Disposition": f'attachment; filename="{kind}-{rng[0]}-{rng[1]}.{fmt}"'})


# ------------------------------------------------------------------------------------------- imports
async def _read(file: UploadFile) -> bytes:
    data = await file.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"The file is larger than {settings.max_upload_mb} MB")
    if not data:
        raise HTTPException(422, "The file is empty")
    return data


@router.get("/imports/kinds")
def import_kinds(_: User = Depends(current_user)):
    return [{"key": k, "label": v["label"], "fields": [{x: f[x] for x in ("key", "label", "required", "type", "help")} for f in v["fields"]]}
            for k, v in importers.KINDS.items()]


@router.get("/imports/template/{kind}.{fmt}")
def import_template(kind: str, fmt: str, _: User = Depends(current_user)):
    if kind not in importers.KINDS or fmt not in ("csv", "xlsx"):
        raise HTTPException(404, "Unknown template")
    return Response(importers.template(kind, fmt), media_type=exporters.MEDIA[fmt],
                    headers={"Content-Disposition": f'attachment; filename="devcaters-{kind}-template.{fmt}"'})


def _parse(kind, data, filename, mapping_json, options_json, db):
    if kind not in importers.KINDS:
        raise HTTPException(422, "Choose what you are importing")
    try:
        headers, rows, fmt = importers.read_table(data, filename, kind)
    except importers.ParseError as e:
        raise HTTPException(422, str(e)) from e
    if len(rows) > 20000:
        raise HTTPException(422, "Split files above 20,000 rows")
    auto = importers.auto_map(headers, kind)
    mapping = {**auto, **{k: v for k, v in json.loads(mapping_json or "{}").items() if v is not None}}
    mapping = {k: v for k, v in mapping.items() if v in headers}
    options = json.loads(options_json or "{}")
    result = importers.validate(db, kind, headers, rows, mapping, options)
    return headers, rows, fmt, auto, mapping, options, result


@router.post("/imports/preview")
async def import_preview(kind: str = Form(...), file: UploadFile = File(...), mapping: str = Form("{}"), options: str = Form("{}"),
                         _: User = Depends(current_user), db: Session = Depends(get_db)):
    data = await _read(file)
    headers, rows, fmt, auto, mp, opts, result = _parse(kind, data, file.filename or "upload", mapping, options, db)
    recs = result["records"]
    show = [r for r in recs if r["_errors"]][:200] + [r for r in recs if not r["_errors"]][:100]
    show.sort(key=lambda r: r["_row"])
    return jsonable({"format": fmt, "headers": [h for h in headers if h != "_rtnprd"], "auto_mapping": auto, "mapping": mp,
                     "fields": [{x: f[x] for x in ("key", "label", "required", "type")} for f in importers.KINDS[kind]["fields"]],
                     "missing_required": result["missing_required"], "total_rows": len(recs), "valid_rows": result["valid_rows"],
                     "invalid_rows": result["invalid_rows"], "documents": result["groups"],
                     "rows": [{"row": r["_row"], "errors": r["_errors"], "warnings": r["_warnings"],
                               "values": {k: v for k, v in r.items() if not k.startswith("_")}} for r in show]})


@router.post("/imports/error-report")
async def import_errors(kind: str = Form(...), file: UploadFile = File(...), mapping: str = Form("{}"), options: str = Form("{}"),
                        _: User = Depends(current_user), db: Session = Depends(get_db)):
    data = await _read(file)
    headers, rows, *_rest, result = _parse(kind, data, file.filename or "upload", mapping, options, db)
    return Response(importers.error_report(result["records"], headers, rows), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="import-problems.csv"'})


@router.post("/imports/commit")
async def import_commit(kind: str = Form(...), file: UploadFile = File(...), mapping: str = Form("{}"), options: str = Form("{}"),
                        u: User = Depends(current_user), db: Session = Depends(get_db)):
    data = await _read(file)
    headers, rows, fmt, auto, mp, opts, result = _parse(kind, data, file.filename or "upload", mapping, options, db)
    if result["missing_required"]:
        raise HTTPException(422, f"Match these columns first: {', '.join(result['missing_required'])}")
    if not result["valid_rows"]:
        raise HTTPException(422, "No valid rows to import")
    try:
        batch = importers.commit(db, kind, file.filename or "upload", fmt, mp, result, u.id, opts)
        audit(db, u, "import", "import", batch.id, f"Imported {batch.rows_imported} rows of {importers.KINDS[kind]['label'].lower()} from {batch.filename}")
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(422, f"Nothing was imported: {e}") from e
    return jsonable(row(batch))


@router.get("/imports")
def import_history(_: User = Depends(current_user), db: Session = Depends(get_db)):
    return jsonable([row(b) for b in db.scalars(select(ImportBatch).order_by(ImportBatch.created_at.desc()).limit(100))])


@router.post("/imports/{bid}/rollback")
def import_rollback(bid: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    b = db.get(ImportBatch, bid)
    if not b:
        raise HTTPException(404, "Import not found")
    if b.status != "committed":
        raise HTTPException(409, "This import was already undone")
    try:
        importers.rollback(db, b)
    except ValueError as e:
        db.rollback()
        raise HTTPException(409, str(e)) from e
    audit(db, u, "rollback", "import", b.id, f"Undid import of {b.filename}")
    db.commit()
    return jsonable(row(b))


# ------------------------------------------------------------------------------------------- documents
ALLOWED = (".pdf", ".jpg", ".jpeg", ".png", ".webp", ".heic", ".xlsx", ".xls", ".csv", ".json", ".zip", ".doc", ".docx", ".txt")
CATEGORIES = ("sales_invoice", "purchase_invoice", "supplier_bill", "credit_note", "debit_note", "acknowledgement", "challan", "other")


@router.post("/documents")
async def upload_document(file: UploadFile = File(...), category: str = Form("other"), entity_type: str = Form(""),
                          entity_id: int | None = Form(None), note: str = Form(""), u: User = Depends(current_user),
                          db: Session = Depends(get_db)):
    name = (file.filename or "file").replace("/", "_").replace("\\", "_")[:200]
    if not name.lower().endswith(ALLOWED):
        raise HTTPException(422, "Upload a PDF, photo, Excel, CSV, JSON or ZIP file")
    if category not in CATEGORIES:
        category = "other"
    if entity_type not in ("", "sales", "purchase", "return"):
        raise HTTPException(422, "Unknown record type")
    data = await _read(file)
    digest = sha256(data)
    dup = db.scalar(select(Document).where(Document.sha256 == digest, Document.entity_type == entity_type, Document.entity_id == entity_id))
    if dup:
        raise HTTPException(409, f"This file is already attached ({dup.filename})")
    key = get_storage().put(data, name)
    d = Document(filename=name, content_type=file.content_type or "application/octet-stream", size=len(data), sha256=digest, storage_key=key,
                 category=category, entity_type=entity_type, entity_id=entity_id, note=note[:300], uploaded_by=u.id)
    db.add(d)
    db.flush()
    audit(db, u, "upload", "document", d.id, f"Uploaded {name}" + (f" to {entity_type} {entity_id}" if entity_type else ""))
    db.commit()
    return row(d)


@router.get("/documents")
def list_documents(entity_type: str | None = None, entity_id: int | None = None, category: str | None = None, q: str = "",
                   _: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = select(Document).order_by(Document.uploaded_at.desc())
    if entity_type is not None:
        stmt = stmt.where(Document.entity_type == entity_type)
    if entity_id is not None:
        stmt = stmt.where(Document.entity_id == entity_id)
    if category:
        stmt = stmt.where(Document.category == category)
    if q:
        stmt = stmt.where(Document.filename.ilike(f"%{q}%") | Document.note.ilike(f"%{q}%"))
    docs = list(db.scalars(stmt.limit(300)))
    labels = {}
    for d in docs:
        if d.entity_type == "sales" and d.entity_id:
            s = db.get(SalesDoc, d.entity_id)
            labels[d.id] = f"Invoice {s.number}" if s else ""
        elif d.entity_type == "purchase" and d.entity_id:
            p = db.get(Purchase, d.entity_id)
            labels[d.id] = f"Bill {p.number}, {p.supplier_name}" if p else ""
        elif d.entity_type == "return" and d.entity_id:
            r = db.get(ReturnPeriod, d.entity_id)
            labels[d.id] = f"Return {period_label(r.period)}" if r else ""
    return [{**row(d), "linked_to": labels.get(d.id, "")} for d in docs]


@router.get("/documents/{did}/download")
def download_document(did: int, _: User = Depends(current_user), db: Session = Depends(get_db)):
    d = db.get(Document, did)
    if not d:
        raise HTTPException(404, "Not found")
    try:
        data = get_storage().get(d.storage_key)
    except FileNotFoundError as e:
        raise HTTPException(404, "The file is missing from storage") from e
    inline = d.content_type in ("application/pdf", "image/jpeg", "image/png", "image/webp")
    return Response(data, media_type=d.content_type,
                    headers={"Content-Disposition": f'{"inline" if inline else "attachment"}; filename="{d.filename}"',
                             "X-Content-Type-Options": "nosniff"})


@router.delete("/documents/{did}")
def delete_document(did: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    d = db.get(Document, did)
    if not d:
        raise HTTPException(404, "Not found")
    if d.entity_type == "return" and u.role != "owner":
        raise HTTPException(403, "Only the owner can remove a filing acknowledgement")
    audit(db, u, "delete", "document", d.id, f"Removed {d.filename}", before=row(d))
    db.delete(d)
    db.commit()
    try:
        get_storage().delete(d.storage_key)
    except Exception:
        pass
    return {"ok": True}


# ------------------------------------------------------------------------------------------- home
@router.get("/home")
def home(period: str | None = None, u: User = Depends(current_user), db: Session = Depends(get_db)):
    b = get_business(db)
    today = dt.date.today()
    key = period or period_key(today, b.filing_frequency)
    start, end = period_range(key)
    rp = db.scalar(select(ReturnPeriod).where(ReturnPeriod.period == key))
    g3 = build_gstr3b(db, b, key, rp)
    sales = db.execute(select(func.count(SalesDoc.id), func.coalesce(func.sum(SalesDoc.total), 0))
                       .where(SalesDoc.date >= start, SalesDoc.date <= end, SalesDoc.status == "active", SalesDoc.doc_type == "invoice")).one()
    purchases = db.execute(select(func.count(Purchase.id), func.coalesce(func.sum(Purchase.total), 0))
                           .where(Purchase.itc_period.in_(months_in(key)), Purchase.status == "active", Purchase.doc_type == "invoice")).one()
    # previous period still to file?
    prev_end = start - dt.timedelta(days=1)
    prev_key = period_key(prev_end, b.filing_frequency)
    prev = db.scalar(select(ReturnPeriod).where(ReturnPeriod.period == prev_key))
    prev_has = db.scalar(select(func.count(SalesDoc.id)).where(SalesDoc.date >= period_range(prev_key)[0], SalesDoc.date <= prev_end))
    pending_prev = None
    if prev_has and (not prev or prev.gstr3b_status != "filed" or prev.gstr1_status != "filed"):
        pending_prev = {"period": prev_key, "label": period_label(prev_key), "gstr1_due": gstr1_due(prev_key), "gstr3b_due": gstr3b_due(prev_key),
                        "gstr1_status": prev.gstr1_status if prev else "open", "gstr3b_status": prev.gstr3b_status if prev else "open"}
    recent = db.scalars(select(AuditLog).where(AuditLog.entity_type.in_(("sales", "purchase", "return", "import"))).order_by(AuditLog.at.desc()).limit(8))
    setup_missing = [x for x, ok in (("GSTIN", bool(b.gstin)), ("legal name", bool(b.legal_name))) if not ok]
    return jsonable({"period": key, "label": period_label(key), "fy": fy_of(start), "start": start, "end": end,
                     "sales_count": sales[0], "sales_total": sales[1], "purchase_count": purchases[0], "purchase_total": purchases[1],
                     "output_tax": g3["output_tax"], "eligible_itc": g3["eligible_itc"], "net_payable": g3["net_payable"],
                     "gstr1_due": gstr1_due(key), "gstr3b_due": gstr3b_due(key),
                     "gstr1_status": rp.gstr1_status if rp else "open", "gstr3b_status": rp.gstr3b_status if rp else "open",
                     "pending_previous": pending_prev, "setup_missing": setup_missing, "has_2b": g3["has_2b"],
                     "recent": [{"at": r.at, "user": r.user_email, "summary": r.summary, "entity_type": r.entity_type, "entity_id": r.entity_id} for r in recent]})


# ------------------------------------------------------------------------------------------- backup
@router.get("/backup")
def backup(u: User = Depends(require_owner), db: Session = Depends(get_db)):
    """Full export of every table as JSON inside a ZIP (documents' files are not included)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, table in Base.metadata.tables.items():
            if name in ("sessions", "password_resets"):
                continue
            rows = [dict(r._mapping) for r in db.execute(table.select())]
            if name == "users":
                for r in rows:
                    r.pop("password_hash", None)
            z.writestr(f"{name}.json", json.dumps(jsonable(rows), indent=1, ensure_ascii=False))
        z.writestr("README.txt", f"Dev Caters GST Accounting backup, {dt.datetime.now():%Y-%m-%d %H:%M}. One JSON file per table.")
    audit(db, u, "export", "backup", "", "Downloaded a full data backup")
    db.commit()
    return Response(buf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="devcaters-backup-{dt.date.today()}.zip"'})
