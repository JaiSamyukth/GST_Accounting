"""Write report tables to CSV, XLSX, JSON and PDF."""
from __future__ import annotations

import csv
import datetime as dt
import io
import json
import re
from decimal import Decimal

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from ..core.serialize import jsonable

INK = colors.HexColor("#1D2B6B")
MEDIA = {"csv": "text/csv", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
         "json": "application/json", "pdf": "application/pdf"}


def _cell(v, typ):
    if v is None:
        return ""
    if typ in ("money", "number", "percent") and not isinstance(v, (int, float, Decimal)):
        try:
            return Decimal(str(v))
        except Exception:
            return v
    return v


def _fmt_inr(v: Decimal) -> str:
    neg = v < 0
    s = f"{abs(v):.2f}"
    whole, frac = s.split(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join(groups + [tail])
    return ("-" if neg else "") + whole + "." + frac


def to_csv(table: dict) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([c["label"] for c in table["columns"]])
    for r in table["rows"]:
        w.writerow([jsonable(r.get(c["key"])) if r.get(c["key"]) is not None else "" for c in table["columns"]])
    if table.get("totals"):
        w.writerow([jsonable(table["totals"].get(c["key"], "Total" if i == 0 else "")) for i, c in enumerate(table["columns"])])
    return ("﻿" + buf.getvalue()).encode()


def to_xlsx(tables: list[dict] | dict) -> bytes:
    tables = tables if isinstance(tables, list) else [tables]
    wb = Workbook()
    wb.remove(wb.active)
    for t in tables:
        ws = wb.create_sheet(re.sub(r"[\\/*?:\[\]]", " ", t.get("sheet") or t["title"])[:31])
        ws.append([c["label"] for c in t["columns"]])
        for c in ws[1]:
            c.font = Font(bold=True, color="FFFFFF")
            c.fill = PatternFill("solid", fgColor="1D2B6B")
            c.alignment = Alignment(vertical="center", wrap_text=True)
        for r in t["rows"]:
            ws.append([_xl(r.get(c["key"]), c.get("type")) for c in t["columns"]])
        if t.get("totals"):
            ws.append([_xl(t["totals"].get(c["key"], "Total" if i == 0 else None), c.get("type")) for i, c in enumerate(t["columns"])])
            for c in ws[ws.max_row]:
                c.font = Font(bold=True)
        for i, c in enumerate(t["columns"], 1):
            ws.column_dimensions[get_column_letter(i)].width = max(12, min(40, len(c["label"]) + 4))
            if c.get("type") == "money":
                for cell in ws.iter_cols(min_col=i, max_col=i, min_row=2):
                    for x in cell:
                        x.number_format = "#,##,##0.00"
        ws.freeze_panes = "A2"
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def _xl(v, typ):
    v = _cell(v, typ)
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (dt.date, dt.datetime)):
        return v
    if typ == "date" and isinstance(v, str) and v:
        try:
            return dt.date.fromisoformat(v)
        except ValueError:
            return v
    return v


def to_json(table: dict) -> bytes:
    return json.dumps(jsonable({"title": table["title"], "columns": table["columns"], "rows": table["rows"],
                                "totals": table.get("totals")}), indent=2, ensure_ascii=False).encode()


def to_pdf(tables: list[dict] | dict, business_name: str, subtitle: str = "") -> bytes:
    tables = tables if isinstance(tables, list) else [tables]
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=12 * mm, rightMargin=12 * mm, topMargin=12 * mm, bottomMargin=12 * mm,
                            title=tables[0]["title"], author=business_name)
    ss = getSampleStyleSheet()
    h = ss["Title"].clone("h", textColor=INK, alignment=0, fontSize=16, spaceAfter=2)
    sub = ss["Normal"].clone("s", textColor=colors.HexColor("#4A5280"), fontSize=9)
    cell = ss["Normal"].clone("c", fontSize=7.5, leading=9)
    story = []
    for t in tables:
        story += [Paragraph(f"{business_name}: {t['title']}", h), Paragraph(subtitle or "", sub), Spacer(1, 4 * mm)]
        cols = t["columns"]
        data = [[Paragraph(f"<b>{c['label']}</b>", cell) for c in cols]]
        for r in t["rows"]:
            data.append([Paragraph(_pdf_val(r.get(c["key"]), c.get("type")), cell) for c in cols])
        if t.get("totals"):
            data.append([Paragraph(f"<b>{_pdf_val(t['totals'].get(c['key'], 'Total' if i == 0 else ''), c.get('type'))}</b>", cell)
                         for i, c in enumerate(cols)])
        if len(data) == 1:
            data.append([Paragraph("No records in this range", cell)] + [""] * (len(cols) - 1))
        tbl = Table(data, repeatRows=1)
        style = [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E7E9F3")), ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#C7CBE0")),
                 ("VALIGN", (0, 0), (-1, -1), "TOP")]
        for i, c in enumerate(cols):
            if c.get("type") in ("money", "number", "percent"):
                style.append(("ALIGN", (i, 0), (i, -1), "RIGHT"))
        tbl.setStyle(TableStyle(style))
        story += [tbl, Spacer(1, 8 * mm)]
    story.append(Paragraph(f"Generated {dt.datetime.now().strftime('%d %b %Y, %H:%M')}. Check figures with your accountant before filing.", sub))
    doc.build(story)
    return buf.getvalue()


def _pdf_val(v, typ) -> str:
    v = _cell(v, typ)
    if v is None or v == "":
        return ""
    if isinstance(v, Decimal) and typ == "money":
        return _fmt_inr(v)
    if isinstance(v, (dt.date, dt.datetime)):
        return v.strftime("%d-%m-%Y")
    if typ == "date" and isinstance(v, str):
        try:
            return dt.date.fromisoformat(v[:10]).strftime("%d-%m-%Y")
        except ValueError:
            return v
    return str(v).replace("&", "&amp;").replace("<", "&lt;")


def render(table_or_tables, fmt: str, business_name: str, subtitle: str = "") -> bytes:
    if fmt == "csv":
        return to_csv(table_or_tables if isinstance(table_or_tables, dict) else table_or_tables[0])
    if fmt == "xlsx":
        return to_xlsx(table_or_tables)
    if fmt == "json":
        t = table_or_tables
        if isinstance(t, list):
            return json.dumps([json.loads(to_json(x)) for x in t], indent=2, ensure_ascii=False).encode()
        return to_json(t)
    if fmt == "pdf":
        return to_pdf(table_or_tables, business_name, subtitle)
    raise ValueError("Unsupported format")
