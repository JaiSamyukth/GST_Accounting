"""Tax periods. Monthly keys look like 2026-10; quarterly keys like 2026-Q3 (financial-year quarter, FY starting April 2026)."""
from __future__ import annotations

import calendar
import datetime as dt
import re

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def fy_of(d: dt.date) -> str:
    start = d.year if d.month >= 4 else d.year - 1
    return f"{start}-{str(start + 1)[2:]}"


def fy_range(fy: str) -> tuple[dt.date, dt.date]:
    start = int(fy[:4])
    return dt.date(start, 4, 1), dt.date(start + 1, 3, 31)


def month_key(d: dt.date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def quarter_key(d: dt.date) -> str:
    fy_start = d.year if d.month >= 4 else d.year - 1
    q = ((d.month - 4) % 12) // 3 + 1
    return f"{fy_start}-Q{q}"


def period_key(d: dt.date, frequency: str = "monthly") -> str:
    return quarter_key(d) if frequency == "quarterly" else month_key(d)


def period_range(key: str) -> tuple[dt.date, dt.date]:
    m = re.fullmatch(r"(\d{4})-(\d{2})", key)
    if m:
        y, mo = int(m[1]), int(m[2])
        if not 1 <= mo <= 12:
            raise ValueError("Bad month")
        return dt.date(y, mo, 1), dt.date(y, mo, calendar.monthrange(y, mo)[1])
    m = re.fullmatch(r"(\d{4})-Q([1-4])", key)
    if m:
        fy_start, q = int(m[1]), int(m[2])
        first_month = 4 + (q - 1) * 3
        y = fy_start if first_month <= 12 else fy_start + 1
        first_month = (first_month - 1) % 12 + 1
        last_month = first_month + 2
        return dt.date(y, first_month, 1), dt.date(y, last_month, calendar.monthrange(y, last_month)[1])
    raise ValueError(f"Unknown period {key}")


def months_in(key: str) -> list[str]:
    start, end = period_range(key)
    out, d = [], start
    while d <= end:
        out.append(month_key(d))
        d = (d.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    return out


def return_fp(key: str) -> str:
    """Return period as the portal writes it: MMYYYY of the last month."""
    end = period_range(key)[1]
    return f"{end.month:02d}{end.year}"


def period_label(key: str) -> str:
    start, end = period_range(key)
    if start.month == end.month:
        return f"{MONTHS[start.month - 1]} {start.year}"
    return f"{MONTHS[start.month - 1][:3]} to {MONTHS[end.month - 1][:3]} {end.year}"


def periods_for_fy(fy: str, frequency: str) -> list[str]:
    start = int(fy[:4])
    if frequency == "quarterly":
        return [f"{start}-Q{q}" for q in range(1, 5)]
    keys = []
    for i in range(12):
        mo = (3 + i) % 12 + 1
        y = start if mo >= 4 else start + 1
        keys.append(f"{y:04d}-{mo:02d}")
    return keys


def gstr1_due(key: str) -> dt.date:
    end = period_range(key)[1]
    nxt = end + dt.timedelta(days=1)
    return nxt.replace(day=13 if "Q" in key else 11)


def gstr3b_due(key: str) -> dt.date:
    end = period_range(key)[1]
    nxt = end + dt.timedelta(days=1)
    return nxt.replace(day=22 if "Q" in key else 20)
