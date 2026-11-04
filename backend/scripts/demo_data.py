"""Fill an empty install with a believable month of Dev Caters data, for trying the app out.

Usage: python -m scripts.demo_data http://127.0.0.1:8000 owner@example.com password
"""
import sys

import httpx

base, email, pw = sys.argv[1], sys.argv[2], sys.argv[3]
c = httpx.Client(base_url=base, headers={"X-Requested-With": "fetch"})
if c.get("/api/auth/status").json()["needs_setup"]:
    c.post("/api/auth/setup", json={"name": "Maria Sangeetha", "email": email, "password": pw}).raise_for_status()
else:
    c.post("/api/auth/login", json={"email": email, "password": pw}).raise_for_status()
c.put("/api/business", json={"legal_name": "C. Maria Sangeetha", "trade_name": "Dev Caters", "gstin": "33AAPFU0939F1Z2",
                              "state_code": "33", "address": "513, Vasan Nagar, Trichy 620 102", "jurisdiction": "Tiruchirappalli"}).raise_for_status()
CAT = "996334"
sales = [
    ("2026-10-02", "Sangam Hotels Pvt Ltd", "33ABCDE1234F1Z7", [("Afternoon meals, staff function", 120, 220)]),
    ("2026-10-05", "Arokiasamy family", "", [("Morning tiffin, engagement", 150, 120), ("Afternoon meals", 150, 260), ("Transport charge", 1, 1500)]),
    ("2026-10-11", "St. Joseph's College", "33AAACB1234C1Z1", [("Night dinner, alumni meet", 300, 240), ("Service charge", 1, 3000)]),
    ("2026-10-18", "Raman family", "", [("Afternoon meals, wedding", 400, 280), ("Night dinner, reception", 350, 300)]),
    ("2026-10-24", "Bengaluru Events Co", "29AAACB1234C1ZB", [("Outdoor catering, conference lunch", 200, 650)]),
    ("2026-11-02", "Lakshmi family", "", [("Morning tiffin, housewarming", 80, 110)]),
]
from app.services.gstin import gstin_checksum  # noqa: E402
for i, (d, name, g, lines) in enumerate(sales, 1):
    if g:
        g = g[:14] + gstin_checksum(g[:14])
    r = c.post("/api/sales", json={"number": f"DC/26-27/{40 + i:03d}", "date": d, "party_name": name, "party_gstin": g, "party_address": "Trichy",
                                   "lines": [{"description": a, "hsn_sac": CAT, "qty": q, "unit_price": p, "gst_rate": 5} for a, q, p in lines]})
    r.raise_for_status()
bills = [
    ("2026-10-03", "Sri Murugan Provisions", "33ABCDE1234F1Z7", "SMP/1182", [("Sunflower oil 15 L tins", "1512", 4, 2100, 5), ("Rice 25 kg bags", "1006", 10, 1450, 5)]),
    ("2026-10-04", "Gandhi Market vegetables", "", "GM-77", [("Vegetables", "0709", 1, 18500, 0)]),
    ("2026-10-09", "Indane commercial LPG", "33AAACI1681G1ZN", "IOC/88341", [("19 kg cylinders", "2711", 6, 1650, 18)]),
    ("2026-10-15", "Paper plate traders", "33AAPFU0939F1Z2", "PPT/312", [("Areca plates", "4823", 2000, 2.5, 5)]),
]
for d, name, g, no, lines in bills:
    if g:
        g = g[:14] + gstin_checksum(g[:14])
    c.post("/api/purchases", json={"number": no, "date": d, "supplier_name": name, "supplier_gstin": g,
                                   "lines": [{"description": a, "hsn_sac": h, "qty": q, "unit_price": p, "gst_rate": rt, "supply_kind": "taxable" if rt else "nil"}
                                             for a, h, q, p, rt in lines]}).raise_for_status()
print("demo data loaded")
