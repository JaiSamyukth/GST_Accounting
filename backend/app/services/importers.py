"""Standardised imports: parse CSV/XLS/XLSX/JSON/ZIP, map columns, validate, preview, commit, roll back."""
from __future__ import annotations

import csv
import datetime as dt
import io
import json
import re
import zipfile
from collections import defaultdict
from decimal import Decimal, InvalidOperation

import xlrd
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import (Business, Gstr2bEntry, HsnCode, ImportBatch, Party, Purchase, ReturnPeriod, SalesDoc, TaxRate)
from .docs import build_purchase, build_sales, locked_period_for
from .gst import ZERO, money
from .gstin import STATES, normalise_gstin, state_from_gstin, validate_gstin
from .periods import fy_of, period_range
from .gst import inr

SCHEMA_VERSION = "dc-import-1.0"
TOL = Decimal("1.00")


def F(key, label, required=False, typ="text", aliases=(), help_=""):
    return {"key": key, "label": label, "required": required, "type": typ, "aliases": list(aliases), "help": help_}


TAX_FIELDS = [
    F("taxable_value", "Taxable value", True, "money", ("taxable", "taxable amount", "assessable value", "txval", "taxable value (₹)")),
    F("gst_rate", "GST rate", True, "rate", ("rate", "tax rate", "gst %", "rate (%)", "gst rate %", "rt")),
    F("cgst", "CGST", False, "money", ("central tax", "cgst amount", "central tax (₹)", "camt")),
    F("sgst", "SGST", False, "money", ("state tax", "state/ut tax", "sgst amount", "state/ut tax (₹)", "utgst", "samt")),
    F("igst", "IGST", False, "money", ("integrated tax", "igst amount", "integrated tax (₹)", "iamt")),
    F("cess", "Cess", False, "money", ("cess amount", "cess (₹)", "csamt")),
]
LINE_FIELDS = [
    F("description", "Description", False, "text", ("item", "particulars", "item description", "service", "goods/services")),
    F("hsn_sac", "HSN/SAC", False, "text", ("hsn", "sac", "hsn code", "sac code", "hsn/sac code")),
    F("qty", "Quantity", False, "number", ("quantity", "no of members", "members", "plates")),
    F("unit", "Unit (UQC)", False, "text", ("uqc", "uom", "unit of measure")),
    F("unit_price", "Rate per unit", False, "money", ("price", "unit price", "rate per unit", "per plate")),
    F("discount", "Discount", False, "money", ("discount amount",)),
]

KINDS: dict[str, dict] = {
    "sales": {"label": "Sales invoices", "fields": [
        F("number", "Invoice number", True, "text", ("invoice no", "invoice number", "inv no", "bill no", "inum", "invoice no.")),
        F("date", "Invoice date", True, "date", ("date", "inv date", "bill date", "idt", "invoice date")),
        F("party_name", "Customer name", True, "text", ("customer", "party name", "party", "customer name", "receiver name", "name")),
        F("party_gstin", "Customer GSTIN", False, "gstin", ("gstin", "gstin/uin", "customer gstin", "gstin of recipient", "ctin", "gstin/uin of recipient")),
        F("party_address", "Customer address", False, "text", ("address",)),
        F("place_of_supply", "Place of supply", False, "state", ("pos", "place of supply", "state")),
        *LINE_FIELDS, *TAX_FIELDS,
        F("reverse_charge", "Reverse charge", False, "bool", ("rcm", "reverse charge", "rchrg")),
    ]},
    "notes": {"label": "Credit and debit notes", "fields": [
        F("number", "Note number", True, "text", ("note no", "note number", "nt_num", "credit note no", "debit note no")),
        F("note_type", "Note type", True, "notetype", ("type", "note type", "ntty", "document type")),
        F("date", "Note date", True, "date", ("date", "note date", "nt_dt")),
        F("original_number", "Original invoice number", True, "text", ("original invoice", "original invoice number", "invoice no", "against invoice")),
        F("original_date", "Original invoice date", False, "date", ("original invoice date", "invoice date")),
        F("party_name", "Customer name", True, "text", ("customer", "party", "party name", "customer name", "name")),
        F("party_gstin", "Customer GSTIN", False, "gstin", ("gstin", "customer gstin", "ctin")),
        F("place_of_supply", "Place of supply", False, "state", ("pos", "place of supply", "state")),
        F("hsn_sac", "HSN/SAC", False, "text", ("hsn", "sac")),
        F("description", "Reason / description", False, "text", ("reason", "description")),
        *TAX_FIELDS,
    ]},
    "purchases": {"label": "Purchase invoices", "fields": [
        F("supplier_name", "Supplier name", True, "text", ("supplier", "vendor", "party", "party name", "trade/legal name", "name of supplier", "trade name", "legal name")),
        F("supplier_gstin", "Supplier GSTIN", False, "gstin", ("gstin", "gstin of supplier", "supplier gstin", "ctin")),
        F("number", "Supplier invoice number", True, "text", ("invoice no", "invoice number", "bill no", "inum", "bill number", "invoice no.")),
        F("date", "Invoice date", True, "date", ("date", "bill date", "invoice date", "idt")),
        *LINE_FIELDS, *TAX_FIELDS,
        F("category", "Category", False, "text", ("purchase type", "category"), "inputs, input_services, capital_goods or expense"),
        F("itc_eligible", "ITC eligible", False, "bool", ("itc", "itc eligible", "eligible for itc", "itc availability")),
        F("reverse_charge", "Reverse charge", False, "bool", ("rcm", "reverse charge", "supply attract reverse charge")),
    ]},
    "customers": {"label": "Customers", "fields": [
        F("name", "Name", True, "text", ("customer", "customer name", "party name", "party")),
        F("gstin", "GSTIN", False, "gstin", ("gstin/uin", "gst no", "gst number")),
        F("address", "Address", False, "text", ()),
        F("state_code", "State", False, "state", ("state", "state code")),
        F("phone", "Phone", False, "text", ("mobile", "cell", "phone number", "contact")),
        F("email", "Email", False, "text", ("e-mail",)),
    ]},
    "suppliers": {"label": "Suppliers", "fields": [
        F("name", "Name", True, "text", ("supplier", "vendor", "supplier name", "party name")),
        F("gstin", "GSTIN", False, "gstin", ("gstin/uin", "gst no", "gst number")),
        F("address", "Address", False, "text", ()),
        F("state_code", "State", False, "state", ("state", "state code")),
        F("phone", "Phone", False, "text", ("mobile", "cell", "contact")),
    ]},
    "hsn": {"label": "HSN/SAC summary", "fields": [
        F("code", "HSN/SAC", True, "text", ("hsn", "sac", "hsn/sac", "hsn code", "hsn_sc")),
        F("description", "Description", True, "text", ("desc", "description of goods/services")),
        F("uqc", "UQC", False, "text", ("unit", "uom")),
        F("qty", "Quantity", False, "number", ("quantity", "total quantity")),
        F("taxable_value", "Taxable value", False, "money", ("taxable", "txval", "total taxable value")),
        F("default_rate", "Tax rate", True, "rate", ("rate", "gst rate", "rt")),
    ]},
    "payments": {"label": "Tax payments and adjustments", "fields": [
        F("period", "Tax period (YYYY-MM)", True, "period", ("period", "tax period", "month", "return period")),
        F("paid_on", "Payment date", False, "date", ("date", "payment date")),
        F("challan_ref", "Challan / CPIN", False, "text", ("cpin", "cin", "challan", "challan no", "reference")),
        F("paid_igst", "IGST paid", False, "money", ("igst", "integrated tax")),
        F("paid_cgst", "CGST paid", False, "money", ("cgst", "central tax")),
        F("paid_sgst", "SGST paid", False, "money", ("sgst", "state tax")),
        F("paid_cess", "Cess paid", False, "money", ("cess",)),
        F("interest", "Interest", False, "money", ()),
        F("late_fee", "Late fee", False, "money", ("late fees",)),
    ]},
    "gstr2b": {"label": "GSTR-2B (for ITC matching)", "fields": [
        F("supplier_gstin", "GSTIN of supplier", True, "gstin", ("gstin", "ctin", "supplier gstin")),
        F("supplier_name", "Trade/legal name", False, "text", ("trade/legal name", "trade name", "legal name", "supplier name", "trdnm")),
        F("number", "Invoice number", True, "text", ("invoice number", "invoice no", "note number", "inum")),
        F("doc_type", "Invoice type", False, "text", ("invoice type", "note type", "type")),
        F("date", "Invoice date", True, "date", ("invoice date", "note date", "dt")),
        F("taxable_value", "Taxable value", True, "money", ("taxable value (₹)", "txval", "taxable")),
        F("igst", "Integrated tax", False, "money", ("integrated tax (₹)", "igst")),
        F("cgst", "Central tax", False, "money", ("central tax (₹)", "cgst")),
        F("sgst", "State/UT tax", False, "money", ("state/ut tax (₹)", "sgst")),
        F("cess", "Cess", False, "money", ("cess (₹)",)),
        F("itc_available", "ITC availability", False, "bool", ("itc availability", "itcavl")),
        F("reverse_charge", "Reverse charge", False, "bool", ("supply attract reverse charge", "rev")),
    ]},
}

TEMPLATE_SAMPLES = {
    "sales": [["DC/26-27/044", "2026-10-15", "Maria Weddings LLP", "33AAPFU0939F1Z2", "Vasan Nagar, Trichy", "33",
               "Outdoor catering, wedding lunch", "996334", "150", "NOS", "180", "0", "27000", "5", "675", "675", "0", "0", "N"]],
    "notes": [["CN/26-27/001", "credit", "2026-10-20", "DC/26-27/044", "2026-10-15", "Maria Weddings LLP", "33AAPFU0939F1Z2", "33",
               "996334", "10 plates not served", "1800", "5", "45", "45", "0", "0"]],
    "purchases": [["Sri Murugan Provisions", "33AAPFU0939F1Z2", "SMP/1182", "2026-10-12", "Cooking oil 15 L", "1508", "15", "LTR", "160",
                   "0", "2400", "5", "60", "60", "0", "0", "inputs", "N", "N"]],
    "customers": [["Maria Weddings LLP", "33AAPFU0939F1Z2", "Vasan Nagar, Trichy", "33", "9894191881", ""]],
    "suppliers": [["Sri Murugan Provisions", "33AAPFU0939F1Z2", "Gandhi Market, Trichy", "33", ""]],
    "hsn": [["996334", "Outdoor catering services", "NA", "0", "0", "5"]],
    "payments": [["2026-10", "2026-11-18", "26113300012345", "0", "1250", "1250", "0", "0", "0"]],
    "gstr2b": [["33AAPFU0939F1Z2", "Sri Murugan Provisions", "SMP/1182", "R", "2026-10-12", "2400", "0", "60", "60", "0", "Y", "N"]],
}


# ----------------------------------------------------------------------------------------- parsing
class ParseError(Exception):
    pass


def _clean_header(h) -> str:
    return re.sub(r"\s+", " ", str(h or "").replace("\n", " ")).strip()


def read_table(data: bytes, filename: str, kind: str) -> tuple[list[str], list[list], str]:
    """Return (headers, rows, detected_format)."""
    name = filename.lower()
    if name.endswith(".zip"):
        try:
            z = zipfile.ZipFile(io.BytesIO(data))
        except zipfile.BadZipFile as e:
            raise ParseError("The ZIP file is damaged") from e
        members = [m for m in z.namelist() if m.lower().endswith((".json", ".xlsx", ".xls", ".csv")) and not m.startswith("__MACOSX")]
        if not members:
            raise ParseError("The ZIP has no JSON, Excel or CSV file inside")
        inner = members[0]
        h, r, fmt = read_table(z.read(inner), inner, kind)
        return h, r, f"zip/{fmt}"
    if name.endswith(".json"):
        return _read_json(data, kind)
    if name.endswith(".csv") or name.endswith(".txt"):
        text = data.decode("utf-8-sig", errors="replace")
        try:
            dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
        except csv.Error:
            dialect = csv.excel
        rows = [r for r in csv.reader(io.StringIO(text), dialect) if any(c.strip() for c in r)]
        return _split_header(rows, kind, "csv")
    if name.endswith(".xlsx") or name.endswith(".xlsm"):
        try:
            wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        except Exception as e:
            raise ParseError("Could not open this Excel file. Save it again as .xlsx and retry") from e
        best = None
        for ws in wb.worksheets:
            rows = [list(r) for r in ws.iter_rows(values_only=True) if r and any(c not in (None, "") for c in r)]
            if not rows:
                continue
            h, body, _ = _split_header(rows, kind, "xlsx")
            score = _match_score(h, kind)
            if ws.title.strip().upper() in ("B2B", "SALES", "PURCHASES", kind.upper()):
                score += 2
            if best is None or score > best[0]:
                best = (score, h, body)
        if not best:
            raise ParseError("The workbook is empty")
        return best[1], best[2], "xlsx"
    if name.endswith(".xls"):
        try:
            book = xlrd.open_workbook(file_contents=data)
        except Exception as e:
            raise ParseError("Could not open this .xls file") from e
        sh = book.sheet_by_index(0)
        rows = []
        for i in range(sh.nrows):
            vals = []
            for j, c in enumerate(sh.row(i)):
                if c.ctype == xlrd.XL_CELL_DATE:
                    vals.append(xlrd.xldate.xldate_as_datetime(c.value, book.datemode))
                else:
                    vals.append(c.value)
            if any(v not in ("", None) for v in vals):
                rows.append(vals)
        return _split_header(rows, kind, "xls")
    raise ParseError("Use a CSV, XLS, XLSX, JSON or ZIP file")


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9%/]", "", s.lower())


def _match_score(headers: list[str], kind: str) -> int:
    return len(auto_map(headers, kind))


def _split_header(rows: list[list], kind: str, fmt: str):
    """Find the header row within the first 10 rows; merge a two-row header (portal downloads use them)."""
    if not rows:
        raise ParseError("The file has no rows")
    best_i, best_s = 0, -1
    for i, r in enumerate(rows[:10]):
        s = _match_score([_clean_header(c) for c in r], kind)
        if s > best_s:
            best_i, best_s = i, s
    header = [_clean_header(c) for c in rows[best_i]]
    body_start = best_i + 1
    if body_start < len(rows):
        nxt = [_clean_header(c) for c in rows[body_start]]
        width = max(len(header), len(nxt))
        header += [""] * (width - len(header))
        nxt += [""] * (width - len(nxt))
        combined = [n or h for h, n in zip(header, nxt)]
        if _match_score(combined, kind) > best_s:
            header, body_start = combined, body_start + 1
    header = [h or f"Column {i + 1}" for i, h in enumerate(header)]
    width = len(header)
    body = [list(r) + [None] * (width - len(r)) for r in rows[body_start:]]
    return header, [r[:width] for r in body], fmt


def _read_json(data: bytes, kind: str):
    try:
        doc = json.loads(data.decode("utf-8-sig"))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise ParseError("This is not valid JSON") from e
    rows: list[dict] = []
    if isinstance(doc, list):
        rows = [r for r in doc if isinstance(r, dict)]
        fmt = "json/records"
    elif kind == "gstr2b" or ("data" in doc and "docdata" in (doc.get("data") or {})):
        d = doc.get("data", doc)
        dd = d.get("docdata", {})
        for grp in dd.get("b2b", []):
            for inv in grp.get("inv", []):
                rows.append(_2b_row(grp, inv, inv.get("inum"), inv.get("dt"), inv.get("typ", "R"), inv.get("items", [])))
        for grp in dd.get("cdnr", []):
            for nt in grp.get("nt", []):
                rows.append(_2b_row(grp, nt, nt.get("ntnum"), nt.get("dt"), "C" if nt.get("typ") == "C" else "D", nt.get("items", [])))
        fmt = "json/gstr2b"
        if d.get("rtnprd"):
            for r in rows:
                r["_rtnprd"] = d["rtnprd"]
    elif kind in ("sales", "notes") and any(k in doc for k in ("b2b", "b2cl", "cdnr")):
        for grp in doc.get("b2b", []):
            for inv in grp.get("inv", []):
                for it in inv.get("itms", []):
                    d_ = it.get("itm_det", {})
                    rows.append({"number": inv.get("inum"), "date": inv.get("idt"), "party_name": grp.get("ctin"),
                                 "party_gstin": grp.get("ctin"), "place_of_supply": inv.get("pos"), "taxable_value": d_.get("txval"),
                                 "gst_rate": d_.get("rt"), "igst": d_.get("iamt"), "cgst": d_.get("camt"), "sgst": d_.get("samt"),
                                 "cess": d_.get("csamt"), "reverse_charge": inv.get("rchrg"), "hsn_sac": ""})
        for grp in doc.get("b2cl", []):
            for inv in grp.get("inv", []):
                for it in inv.get("itms", []):
                    d_ = it.get("itm_det", {})
                    rows.append({"number": inv.get("inum"), "date": inv.get("idt"), "party_name": "Unregistered customer",
                                 "place_of_supply": grp.get("pos"), "taxable_value": d_.get("txval"), "gst_rate": d_.get("rt"),
                                 "igst": d_.get("iamt"), "cess": d_.get("csamt")})
        for grp in doc.get("cdnr", []):
            for nt in grp.get("nt", []):
                for it in nt.get("itms", []):
                    d_ = it.get("itm_det", {})
                    rows.append({"number": nt.get("nt_num"), "note_type": nt.get("ntty"), "date": nt.get("nt_dt"),
                                 "original_number": nt.get("inum") or nt.get("nt_num"), "party_name": grp.get("ctin"),
                                 "party_gstin": grp.get("ctin"), "place_of_supply": nt.get("pos"), "taxable_value": d_.get("txval"),
                                 "gst_rate": d_.get("rt"), "igst": d_.get("iamt"), "cgst": d_.get("camt"), "sgst": d_.get("samt"),
                                 "cess": d_.get("csamt")})
        if kind == "sales":
            rows = [r for r in rows if "note_type" not in r]
        else:
            rows = [r for r in rows if "note_type" in r]
        fmt = "json/gstr1"
    else:
        for v in doc.values():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                rows = v
                break
        fmt = "json/records"
    if not rows:
        raise ParseError("No records found in this JSON file")
    headers: list[str] = []
    for r in rows:
        for k in r:
            if k not in headers:
                headers.append(k)
    return headers, [[r.get(h) for h in headers] for r in rows], fmt


def _2b_row(grp, inv, num, date, typ, items):
    tot = defaultdict(lambda: Decimal(0))
    for it in items:
        for k_src, k in (("txval", "taxable_value"), ("igst", "igst"), ("cgst", "cgst"), ("sgst", "sgst"), ("cess", "cess")):
            tot[k] += Decimal(str(it.get(k_src) or 0))
    return {"supplier_gstin": grp.get("ctin"), "supplier_name": grp.get("trdnm", ""), "number": num, "date": date, "doc_type": typ,
            **{k: str(v) for k, v in tot.items()}, "itc_available": inv.get("itcavl", "Y"), "reverse_charge": inv.get("rev", "N")}


def auto_map(headers: list[str], kind: str) -> dict[str, str]:
    """Map application field key -> file header."""
    out: dict[str, str] = {}
    used = set()
    for f in KINDS[kind]["fields"]:
        names = [_norm(f["key"]), _norm(f["label"]), *[_norm(a) for a in f["aliases"]]]
        for h in headers:
            if h in used or not h:
                continue
            if _norm(h) in names:
                out[f["key"]] = h
                used.add(h)
                break
    return out


# ----------------------------------------------------------------------------------------- value conversion
MONTHS3 = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def parse_date(v) -> dt.date:
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    if isinstance(v, (int, float)) and 20000 < v < 80000:  # Excel serial
        return dt.date(1899, 12, 30) + dt.timedelta(days=int(v))
    s = str(v or "").strip()
    if not s:
        raise ValueError("date is empty")
    s = s.split("T")[0].split(" ")[0] if re.match(r"\d{4}-\d{2}-\d{2}[T ]", s) else s
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y", "%d-%m-%y", "%d/%m/%y", "%d-%b-%Y", "%d %b %Y", "%d-%b-%y", "%b %d, %Y"):
        try:
            return dt.datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    raise ValueError(f"'{s}' is not a date. Use DD-MM-YYYY")


def parse_money(v) -> Decimal:
    if v is None or (isinstance(v, str) and not v.strip()):
        return ZERO
    s = str(v).replace(",", "").replace("₹", "").replace("Rs.", "").replace("Rs", "").strip()
    neg = s.startswith("(") and s.endswith(")")
    try:
        d = Decimal(s.strip("()"))
    except InvalidOperation as e:
        raise ValueError(f"'{v}' is not a number") from e
    return money(-d if neg else d)


def parse_number(v) -> Decimal:
    if v is None or (isinstance(v, str) and not v.strip()):
        return Decimal(0)
    try:
        return Decimal(str(v).replace(",", "").strip())
    except InvalidOperation as e:
        raise ValueError(f"'{v}' is not a number") from e


def parse_bool(v) -> bool:
    return str(v or "").strip().lower() in ("y", "yes", "true", "1", "eligible", "available")


_STATE_BY_NAME = {_norm(n): c for c, n in STATES.items()}


def parse_state(v) -> str:
    s = str(v or "").strip()
    if not s:
        return ""
    m = re.match(r"^(\d{1,2})", s)
    if m and m[1].zfill(2) in STATES:
        return m[1].zfill(2)
    n = _norm(re.sub(r"^\d+\s*-\s*", "", s))
    if n in _STATE_BY_NAME:
        return _STATE_BY_NAME[n]
    raise ValueError(f"'{s}' is not a state or state code")


def _convert(field: dict, raw):
    t = field["type"]
    if t == "date":
        return None if raw in (None, "") and not field["required"] else parse_date(raw)
    if t == "money":
        return parse_money(raw)
    if t in ("number",):
        return parse_number(raw)
    if t == "rate":
        if raw in (None, "") and not field["required"]:
            return None
        r = parse_number(str(raw).replace("%", ""))
        if Decimal(0) < r < 1:
            r = r * 100  # 0.05 -> 5
        return r.normalize() if r == r.to_integral() else r
    if t == "bool":
        return parse_bool(raw)
    if t == "gstin":
        return normalise_gstin(str(raw or ""))
    if t == "state":
        return parse_state(raw)
    if t == "notetype":
        s = str(raw or "").strip().lower()
        if s.startswith("c"):
            return "credit_note"
        if s.startswith("d"):
            return "debit_note"
        raise ValueError("note type must be Credit or Debit")
    if t == "period":
        s = str(raw or "").strip()
        if isinstance(raw, (dt.date, dt.datetime)):
            return f"{raw.year:04d}-{raw.month:02d}"
        m = re.match(r"^(\d{4})-(\d{1,2})$", s) or None
        if m:
            return f"{m[1]}-{int(m[2]):02d}"
        m = re.match(r"^(\d{2})(\d{4})$", s)
        if m:
            return f"{m[2]}-{m[1]}"
        raise ValueError("period must look like 2026-10")
    v = "" if raw is None else str(raw).strip()
    if isinstance(raw, float) and raw.is_integer():
        v = str(int(raw))
    return v


# ----------------------------------------------------------------------------------------- validation
def validate(db: Session, kind: str, headers: list[str], rows: list[list], mapping: dict[str, str], options: dict) -> dict:
    b = db.get(Business, 1)
    fields = KINDS[kind]["fields"]
    hidx = {h: i for i, h in enumerate(headers)}
    rates = {r.rate.normalize() for r in db.scalars(select(TaxRate).where(TaxRate.active.is_(True)))}
    today = dt.date.today()
    fy = options.get("fy")
    missing_required = [f["label"] for f in fields if f["required"] and not mapping.get(f["key"])]
    records, seen = [], {}
    for n, raw in enumerate(rows, start=2):
        rec, errs, warns = {"_row": n}, [], []
        for f in fields:
            h = mapping.get(f["key"])
            val = raw[hidx[h]] if h in hidx else None
            try:
                rec[f["key"]] = _convert(f, val)
            except ValueError as e:
                errs.append(f"{f['label']}: {e}")
                rec[f["key"]] = None
            if f["required"] and (rec.get(f["key"]) in (None, "")) and not any(f["label"] in e for e in errs):
                errs.append(f"{f['label']} is missing")
        if "_rtnprd" in headers and kind == "gstr2b":
            rec["_rtnprd"] = raw[hidx["_rtnprd"]]
        # GSTIN
        for gk in ("party_gstin", "supplier_gstin", "gstin"):
            if rec.get(gk) and not (c := validate_gstin(rec[gk])).ok:
                errs.append(f"GSTIN {rec[gk]}: {c.error}")
        # dates
        if isinstance(rec.get("date"), dt.date):
            if rec["date"] > today:
                errs.append("Date is in the future")
            elif fy and fy_of(rec["date"]) != fy:
                warns.append(f"Date is outside financial year {fy}")
        # rate + tax consistency
        if "gst_rate" in rec and rec.get("gst_rate") is not None:
            if rates and rec["gst_rate"].normalize() not in rates:
                errs.append(f"GST rate {rec['gst_rate']}% is not in your rate list (Settings)")
            elif rec.get("taxable_value") is not None and not errs:
                _check_tax(rec, b, kind, errs)
        if kind in ("sales", "notes", "purchases") and rec.get("taxable_value") is not None and rec["taxable_value"] < 0:
            errs.append("Taxable value cannot be negative. Use a credit note")
        if kind == "sales" and rec.get("unit_price") and rec.get("qty") and rec.get("taxable_value") is not None:
            gross = money(rec["qty"] * rec["unit_price"]) - (rec.get("discount") or ZERO)
            if abs(gross - rec["taxable_value"]) > TOL:
                errs.append(f"Quantity x rate less discount is ₹{inr(gross)}, but taxable value is ₹{inr(rec['taxable_value'])}")
        rec["_errors"], rec["_warnings"] = errs, warns
        records.append(rec)

    # duplicates in file (by document key) and in database
    _duplicates(db, kind, records, b)
    groups = _group(kind, records)
    valid = sum(1 for r in records if not r["_errors"])
    return {"missing_required": missing_required, "records": records, "groups": len(groups),
            "valid_rows": valid, "invalid_rows": len(records) - valid}


def _check_tax(rec: dict, b: Business, kind: str, errs: list[str]) -> None:
    rate = rec["gst_rate"]
    tv = rec["taxable_value"]
    if kind == "gstr2b":
        return
    if kind == "purchases":
        inter = (state_from_gstin(rec.get("supplier_gstin")) or b.state_code) != b.state_code
    else:
        pos = rec.get("place_of_supply") or state_from_gstin(rec.get("party_gstin")) or b.state_code
        inter = pos != b.state_code
    given = {k: rec.get(k) or ZERO for k in ("cgst", "sgst", "igst")}
    if not any(given.values()):
        return  # tax not supplied: it will be calculated
    exp_total = money(tv * rate / 100)
    if inter and (given["cgst"] or given["sgst"]):
        errs.append("Inter-state supply should carry IGST, not CGST/SGST (check place of supply)")
    elif not inter and given["igst"]:
        errs.append("Intra-state supply should carry CGST and SGST, not IGST (check place of supply)")
    elif abs(sum(given.values(), ZERO) - exp_total) > TOL:
        errs.append(f"Tax should be about ₹{inr(exp_total)} at {rate}% on ₹{inr(tv)}, file says ₹{inr(sum(given.values(), ZERO))}")


def _doc_key(kind, r):
    if kind == "purchases":
        return (r.get("supplier_gstin") or r.get("supplier_name") or "", str(r.get("number") or "").upper())
    if kind == "notes":
        return (r.get("note_type"), str(r.get("number") or "").upper())
    if kind in ("sales",):
        return ("invoice", str(r.get("number") or "").upper())
    if kind in ("customers", "suppliers"):
        return (r.get("gstin") or "", str(r.get("name") or "").upper())
    if kind == "hsn":
        return (r.get("code"),)
    if kind == "gstr2b":
        return (r.get("supplier_gstin"), str(r.get("number") or "").upper(), r.get("date"))
    if kind == "payments":
        return (r.get("period"),)
    return (r["_row"],)


def _group(kind, records):
    g = defaultdict(list)
    for r in records:
        g[_doc_key(kind, r)].append(r)
    return g


def _duplicates(db: Session, kind: str, records: list[dict], b: Business) -> None:
    groups = _group(kind, records)
    if kind in ("customers", "suppliers", "hsn", "payments"):
        for k, rs in groups.items():
            for r in rs[1:]:
                r["_errors"].append(f"Duplicate of row {rs[0]['_row']}")
    if kind in ("sales", "notes"):
        nums = {k[1] for k in groups}
        dtype = {"sales": ["invoice"], "notes": ["credit_note", "debit_note"]}[kind]
        existing = {n.upper() for n in db.scalars(select(SalesDoc.number).where(SalesDoc.doc_type.in_(dtype)))} if nums else set()
        for k, rs in groups.items():
            if k[1] in existing:
                for r in rs:
                    r["_errors"].append(f"{k[1]} already exists in your books")
            heads = {(r.get("date"), r.get("party_name"), r.get("party_gstin")) for r in rs}
            if len(heads) > 1:
                for r in rs:
                    r["_errors"].append("Rows of the same invoice have different date or customer")
    if kind == "purchases":
        existing = {(g or "", n.upper()) for g, n in db.execute(select(Purchase.supplier_gstin, Purchase.number))}
        existing |= {(n_, num.upper()) for n_, num in db.execute(select(Purchase.supplier_name, Purchase.number))}
        for k, rs in groups.items():
            if k in existing:
                for r in rs:
                    r["_errors"].append(f"Bill {k[1]} from this supplier is already recorded")
    if kind == "gstr2b":
        for k, rs in groups.items():
            for r in rs[1:]:
                r["_errors"].append(f"Duplicate of row {rs[0]['_row']}")
    if kind == "customers" or kind == "suppliers":
        pk = "customer" if kind == "customers" else "supplier"
        existing = {(g or "", n.upper()) for g, n in db.execute(select(Party.gstin, Party.name).where(Party.kind == pk))}
        for k, rs in groups.items():
            if k in existing:
                for r in rs:
                    r["_errors"].append("Already in your list")
    if kind == "hsn":
        existing = set(db.scalars(select(HsnCode.code)))
        for k, rs in groups.items():
            if k[0] in existing:
                for r in rs:
                    r["_warnings"].append("Code exists and will be updated")


# ----------------------------------------------------------------------------------------- commit
def _line_from(r: dict) -> dict:
    qty = r.get("qty") or Decimal(1)
    tv = r.get("taxable_value") or ZERO
    price = r.get("unit_price")
    disc = r.get("discount") or ZERO
    if not price:
        price = ((tv + disc) / qty).quantize(Decimal("0.0001"))
        gross = money(qty * price)
        if gross < tv + disc:
            price += Decimal("0.0001")
            gross = money(qty * price)
        disc = gross - tv
    rate = r.get("gst_rate") or Decimal(0)
    kind = "taxable" if rate > 0 else (r.get("supply_kind") or "nil")
    return {"description": r.get("description") or "", "hsn_sac": r.get("hsn_sac") or "", "qty": qty, "unit": r.get("unit") or "NOS",
            "unit_price": price, "discount": disc, "gst_rate": rate, "supply_kind": kind,
            **({"itc_eligible": r["itc_eligible"]} if r.get("_itc_given") else {})}


def commit(db: Session, kind: str, filename: str, fmt: str, mapping: dict, result: dict, user_id: int | None, options: dict) -> ImportBatch:
    b = db.get(Business, 1)
    records = result["records"]
    groups = _group(kind, records)
    batch = ImportBatch(kind=kind, filename=filename, schema_version=f"{SCHEMA_VERSION} ({fmt})", rows_total=len(records),
                        mapping=mapping, created_by=user_id)
    db.add(batch)
    db.flush()
    created: dict[str, list] = defaultdict(list)
    errors = [{"row": r["_row"], "errors": r["_errors"]} for r in records if r["_errors"]]
    imported = 0
    for key, rs in groups.items():
        if any(r["_errors"] for r in rs):
            continue  # whole document skipped when any of its rows is invalid
        first = rs[0]
        if kind in ("sales", "notes"):
            pos = first.get("place_of_supply") or state_from_gstin(first.get("party_gstin")) or b.state_code
            data = {"doc_type": first.get("note_type") or "invoice", "number": first["number"], "date": first["date"],
                    "party_name": first["party_name"], "party_gstin": first.get("party_gstin") or "",
                    "party_address": first.get("party_address") or "", "place_of_supply": pos,
                    "reverse_charge": bool(first.get("reverse_charge")), "price_mode": "exclusive", "round_off": False,
                    "original_number": first.get("original_number") or "", "original_date": first.get("original_date"),
                    "lines": [_line_from(r) for r in rs]}
            ensure = locked_period_for(db, first["date"])
            if ensure:
                errors.append({"row": first["_row"], "errors": [f"Period {ensure.period} is filed and locked"]})
                continue
            doc = SalesDoc(import_batch_id=batch.id)
            build_sales(db, doc, data)
            db.add(doc)
            db.flush()
            created["sales_docs"].append(doc.id)
        elif kind == "purchases":
            for r in rs:
                r["_itc_given"] = mapping.get("itc_eligible") is not None
            data = {"doc_type": "invoice", "number": first["number"], "date": first["date"], "supplier_name": first["supplier_name"],
                    "supplier_gstin": first.get("supplier_gstin") or "", "reverse_charge": bool(first.get("reverse_charge")),
                    "category": (first.get("category") or "inputs").strip().lower().replace(" ", "_") or "inputs",
                    "lines": [_line_from(r) for r in rs]}
            if data["category"] not in ("inputs", "input_services", "capital_goods", "expense"):
                data["category"] = "inputs"
            if locked_period_for(db, first["date"]):
                errors.append({"row": first["_row"], "errors": ["This month is filed and locked"]})
                continue
            doc = Purchase(import_batch_id=batch.id)
            build_purchase(db, doc, data)
            db.add(doc)
            db.flush()
            created["purchases"].append(doc.id)
        elif kind in ("customers", "suppliers"):
            p = Party(kind=kind[:-1], name=first["name"], gstin=first.get("gstin") or "", address=first.get("address") or "",
                      state_code=first.get("state_code") or state_from_gstin(first.get("gstin")) or b.state_code,
                      phone=first.get("phone") or "", email=first.get("email") or "", import_batch_id=batch.id)
            db.add(p)
            db.flush()
            created["parties"].append(p.id)
        elif kind == "hsn":
            h = db.scalar(select(HsnCode).where(HsnCode.code == first["code"]))
            if h:
                created["hsn_updated"].append({"id": h.id, "before": {"description": h.description, "uqc": h.uqc, "default_rate": str(h.default_rate)}})
            else:
                h = HsnCode(code=first["code"], is_service=first["code"].startswith("99"))
                db.add(h)
            h.description = first["description"]
            h.uqc = first.get("uqc") or "NA"
            h.default_rate = first["default_rate"]
            db.flush()
            if not created["hsn_updated"] or created["hsn_updated"][-1]["id"] != h.id:
                created["hsn"].append(h.id)
        elif kind == "payments":
            rp = db.scalar(select(ReturnPeriod).where(ReturnPeriod.period == first["period"]))
            if not rp:
                start, _ = period_range(first["period"])
                rp = ReturnPeriod(period=first["period"], fy=fy_of(start))
                db.add(rp)
                db.flush()
                created["periods"].append(rp.id)
            fields_ = ("paid_igst", "paid_cgst", "paid_sgst", "paid_cess", "interest", "late_fee", "challan_ref", "paid_on")
            created["payment_before"].append({"id": rp.id, **{k: str(getattr(rp, k)) if getattr(rp, k) is not None else None for k in fields_}})
            for k in fields_:
                if first.get(k) not in (None, ""):
                    setattr(rp, k, first[k])
        elif kind == "gstr2b":
            period = options.get("period") or (lambda p: f"{p[2:]}-{p[:2]}" if p else None)(first.get("_rtnprd"))
            if not period:
                period = f"{first['date'].year:04d}-{first['date'].month:02d}"
            dtp = str(first.get("doc_type") or "R").strip().upper()
            e = Gstr2bEntry(period=period, supplier_gstin=first["supplier_gstin"], supplier_name=first.get("supplier_name") or "",
                            doc_type="credit_note" if dtp.startswith("C") else "debit_note" if dtp.startswith("D") else "invoice",
                            number=first["number"], date=first["date"], taxable_value=first["taxable_value"],
                            igst=first.get("igst") or ZERO, cgst=first.get("cgst") or ZERO, sgst=first.get("sgst") or ZERO,
                            cess=first.get("cess") or ZERO, itc_available=first.get("itc_available", True) if mapping.get("itc_available") else True,
                            reverse_charge=bool(first.get("reverse_charge")), import_batch_id=batch.id)
            db.add(e)
            db.flush()
            created["gstr2b"].append(e.id)
        imported += len(rs)
    batch.rows_imported = imported
    batch.rows_skipped = len(records) - imported
    batch.errors = errors
    batch.created_ids = dict(created)
    return batch


def rollback(db: Session, batch: ImportBatch) -> dict:
    ids = batch.created_ids or {}
    for sid in ids.get("sales_docs", []):
        d = db.get(SalesDoc, sid)
        if d:
            if locked_period_for(db, d.date):
                raise ValueError(f"Invoice {d.number} is in a filed, locked period")
            db.delete(d)
    for pid in ids.get("purchases", []):
        p = db.get(Purchase, pid)
        if p:
            if locked_period_for(db, p.date):
                raise ValueError(f"Bill {p.number} is in a filed, locked period")
            db.delete(p)
    for pid in ids.get("parties", []):
        p = db.get(Party, pid)
        if p:
            db.delete(p)
    for hid in ids.get("hsn", []):
        h = db.get(HsnCode, hid)
        if h:
            db.delete(h)
    for u in ids.get("hsn_updated", []):
        h = db.get(HsnCode, u["id"])
        if h:
            h.description, h.uqc, h.default_rate = u["before"]["description"], u["before"]["uqc"], Decimal(u["before"]["default_rate"])
    for eid in ids.get("gstr2b", []):
        e = db.get(Gstr2bEntry, eid)
        if e:
            db.delete(e)
    for before in reversed(ids.get("payment_before", [])):
        rp = db.get(ReturnPeriod, before["id"])
        if rp:
            for k, v in before.items():
                if k == "id":
                    continue
                if k in ("challan_ref",):
                    setattr(rp, k, v or "")
                elif k == "paid_on":
                    setattr(rp, k, dt.date.fromisoformat(v) if v else None)
                else:
                    setattr(rp, k, Decimal(v) if v else ZERO)
    for pid in ids.get("periods", []):
        rp = db.get(ReturnPeriod, pid)
        if rp and not rp.locked:
            db.delete(rp)
    batch.status = "rolled_back"
    batch.rolled_back_at = dt.datetime.now(dt.timezone.utc)
    return {"ok": True}


# ----------------------------------------------------------------------------------------- templates & error report
def template(kind: str, fmt: str) -> bytes:
    fields = KINDS[kind]["fields"]
    headers = [f["label"] for f in fields]
    sample = TEMPLATE_SAMPLES.get(kind, [])
    if fmt == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(headers)
        for r in sample:
            w.writerow(r)
        return ("﻿" + buf.getvalue()).encode()
    wb = Workbook()
    ws = wb.active
    ws.title = re.sub(r"[\\/*?:\[\]]", " ", KINDS[kind]["label"])[:31]
    ws.append(headers)
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="1D2B6B")
    for r in sample:
        ws.append(r)
    for i, f in enumerate(fields, 1):
        ws.column_dimensions[ws.cell(1, i).column_letter].width = max(14, len(f["label"]) + 4)
    guide = wb.create_sheet("How to fill")
    guide.append(["Column", "Required", "Type", "Notes"])
    for c in guide[1]:
        c.font = Font(bold=True)
    notes = {"date": "DD-MM-YYYY or YYYY-MM-DD", "money": "Number, no currency sign needed", "rate": "5 for 5%",
             "gstin": "15 characters, checked automatically", "state": "State code (33) or name (Tamil Nadu)", "bool": "Y or N",
             "notetype": "Credit or Debit", "period": "YYYY-MM, for example 2026-10", "number": "Number", "text": ""}
    for f in fields:
        guide.append([f["label"], "Yes" if f["required"] else "", f["type"], f["help"] or notes.get(f["type"], "")])
    guide.column_dimensions["A"].width = 28
    guide.column_dimensions["D"].width = 50
    guide.append([])
    guide.append([f"Template version {SCHEMA_VERSION}. One row per line item; repeat the invoice number on each row of the same invoice."])
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def error_report(records: list[dict], headers: list[str], rows: list[list]) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Row", "Problems", *headers])
    for r in records:
        if r["_errors"]:
            w.writerow([r["_row"], "; ".join(r["_errors"]), *[("" if v is None else v) for v in rows[r["_row"] - 2]]])
    return ("﻿" + buf.getvalue()).encode()
