"""GSTIN / PAN validation and Indian state codes."""
from __future__ import annotations

import re
from dataclasses import dataclass

STATES: dict[str, str] = {
    "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
    "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
    "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
    "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
    "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
    "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka",
    "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
    "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
    "96": "Foreign Country", "97": "Other Territory",
}

_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
_GSTIN_RE = re.compile(r"^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]Z[0-9A-Z]$")
_PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")


@dataclass
class Check:
    ok: bool
    error: str = ""


def gstin_checksum(first14: str) -> str:
    total = 0
    for i, ch in enumerate(first14.upper()):
        product = _CHARS.index(ch) * (2 if i % 2 else 1)
        total += product // 36 + product % 36
    return _CHARS[(36 - total % 36) % 36]


def normalise_gstin(value: str | None) -> str:
    return (value or "").strip().upper().replace(" ", "")


def validate_gstin(value: str | None) -> Check:
    g = normalise_gstin(value)
    if len(g) != 15:
        return Check(False, "GSTIN must be 15 characters")
    if not _GSTIN_RE.match(g):
        return Check(False, "GSTIN format is not valid (2-digit state, PAN, entity number, Z, check digit)")
    if g[:2] not in STATES:
        return Check(False, f"Unknown state code {g[:2]}")
    if not _PAN_RE.match(g[2:12]):
        return Check(False, "Characters 3 to 12 of the GSTIN must be a valid PAN")
    if gstin_checksum(g[:14]) != g[14]:
        return Check(False, "GSTIN checksum does not match. Check for a typing mistake")
    return Check(True)


def validate_pan(value: str | None) -> Check:
    p = (value or "").strip().upper()
    return Check(True) if _PAN_RE.match(p) else Check(False, "PAN must look like ABCDE1234F")


def state_from_gstin(value: str | None) -> str | None:
    g = normalise_gstin(value)
    return g[:2] if len(g) >= 2 and g[:2] in STATES else None
