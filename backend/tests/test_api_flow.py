import io
import json
import zipfile
from decimal import Decimal as D

from openpyxl import Workbook, load_workbook

from .conftest import GSTIN_KA, GSTIN_TN

CATER = {"description": "Outdoor catering, wedding lunch", "hsn_sac": "996334", "qty": "150", "unit": "NOS", "unit_price": "180", "gst_rate": "5"}


def sale(c, number, date="2026-10-15", **kw):
    body = {"number": number, "date": date, "party_name": "Maria Weddings", "lines": [CATER], **kw}
    r = c.post("/api/sales", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_csrf_header_required(client):
    from fastapi.testclient import TestClient
    from app.main import app
    raw = TestClient(app)
    raw.cookies = client.cookies
    assert raw.post("/api/sales", json={}).status_code == 403


def test_auth_roles_and_login_history(client):
    r = client.post("/api/users", json={"name": "Ravi", "email": "ca@x.in", "role": "accountant"})
    assert r.status_code == 200
    token = r.json()["invite_token"]
    assert client.post("/api/auth/reset", json={"token": token, "new_password": "short"}).status_code == 422
    assert client.post("/api/auth/reset", json={"token": token, "new_password": "accountant99"}).status_code == 200
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/login", json={"email": "ca@x.in", "password": "wrongwrong1"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "ca@x.in", "password": "accountant99"}).status_code == 200
    assert client.get("/api/users").status_code == 403  # accountant cannot manage users
    assert client.put("/api/business", json={}).status_code == 403
    assert client.get("/api/sales").status_code == 200
    client.post("/api/auth/logout")
    client.post("/api/auth/login", json={"email": "owner@devcaters.in", "password": "ownerpass123"})
    hist = client.get("/api/users/login-history").json()
    assert any(not h["success"] for h in hist)
    uid = [u for u in client.get("/api/users").json() if u["email"] == "ca@x.in"][0]["id"]
    assert client.patch(f"/api/users/{uid}", json={"is_active": False}).status_code == 200
    client.post("/api/auth/logout")
    assert client.post("/api/auth/login", json={"email": "ca@x.in", "password": "accountant99"}).status_code == 401


def test_gstin_validation_on_business_and_sales(client):
    r = client.put("/api/business", json={"gstin": "33AAPFU0939F1ZX", "state_code": "33"})
    assert r.status_code == 422 and "checksum" in r.json()["detail"]
    r = client.post("/api/sales", json={"number": "X1", "date": "2026-10-01", "party_name": "A", "party_gstin": "BAD", "lines": [CATER]})
    assert r.status_code == 422


def test_sales_classification_tax_and_duplicate(client):
    a = sale(client, "DC/26-27/001")
    assert a["section"] == "b2cs" and a["cgst"] == "675.00" and a["total"] == "28350.00"
    b = sale(client, "DC/26-27/002", party_gstin=GSTIN_TN)
    assert b["section"] == "b2b"
    c = sale(client, "DC/26-27/003", place_of_supply="29", lines=[{**CATER, "qty": "1000"}])
    assert c["section"] == "b2cl" and c["igst"] == "9000.00" and c["cgst"] == "0.00"
    r = client.post("/api/sales", json={"number": "DC/26-27/001", "date": "2026-10-15", "party_name": "X", "lines": [CATER]})
    assert r.status_code == 409
    assert client.get("/api/sales/next-number").json()["number"].endswith("004")
    lst = client.get("/api/sales", params={"period": "2026-10"}).json()
    assert lst["total"] == 3
    assert any(p["name"] == "Maria Weddings" for p in client.get("/api/parties", params={"kind": "customer"}).json())


def test_inclusive_pricing_and_live_calc(client):
    r = client.post("/api/gst/calculate", json={"lines": [{"qty": 1, "unit_price": "1050", "gst_rate": "5"}], "price_mode": "inclusive"})
    assert r.json()["taxable_value"] == "1000.00" and r.json()["total"] == "1050.00"


def test_gstr1_and_3b_full_month(client):
    sale(client, "DC/26-27/001")  # b2cs intra
    sale(client, "DC/26-27/002", party_gstin=GSTIN_TN)  # b2b
    sale(client, "DC/26-27/003", place_of_supply="29", lines=[{**CATER, "qty": "1000"}])  # b2cl
    sale(client, "DC/26-27/004", lines=[{"description": "Fresh fruit (exempt)", "hsn_sac": "0804", "qty": 1, "unit_price": 500, "gst_rate": 0, "supply_kind": "nil"}])
    r = client.post("/api/sales", json={"doc_type": "credit_note", "number": "CN/26-27/001", "date": "2026-10-20", "party_name": "Maria Weddings",
                                        "party_gstin": GSTIN_TN, "original_number": "DC/26-27/002", "lines": [{**CATER, "qty": "10"}]})
    assert r.status_code == 200 and r.json()["section"] == "cdnr"
    # purchases: one eligible intra, one inter, one RCM, one exempt
    p = client.post("/api/purchases", json={"number": "SMP/1", "date": "2026-10-05", "supplier_name": "Oil Traders", "supplier_gstin": GSTIN_TN,
                                            "lines": [{"description": "Oil", "hsn_sac": "1512", "qty": 10, "unit_price": 100, "gst_rate": 5}]})
    assert p.status_code == 200 and p.json()["lines"][0]["itc_eligible"] is True
    client.post("/api/purchases", json={"number": "KA/9", "date": "2026-10-06", "supplier_name": "Plates Co", "supplier_gstin": GSTIN_KA,
                                        "lines": [{"description": "Plates", "hsn_sac": "4823", "qty": 1, "unit_price": 1000, "gst_rate": 18}]})
    client.post("/api/purchases", json={"number": "VEG/1", "date": "2026-10-07", "supplier_name": "Market", "lines": [
        {"description": "Vegetables", "hsn_sac": "0709", "qty": 1, "unit_price": 3000, "gst_rate": 0, "supply_kind": "nil"}]})
    blocked = client.post("/api/purchases", json={"number": "CAR/1", "date": "2026-10-08", "supplier_name": "Car Co", "supplier_gstin": GSTIN_TN,
                                                  "category": "expense", "lines": [{"description": "Car service", "hsn_sac": "9987", "qty": 1, "unit_price": 1000, "gst_rate": 18}]})
    assert blocked.json()["lines"][0]["itc_eligible"] is False

    g1 = client.get("/api/returns/2026-10/gstr1").json()
    pl = g1["payload"]
    assert pl["fp"] == "102026"
    assert pl["b2b"][0]["ctin"] == GSTIN_TN and pl["b2b"][0]["inv"][0]["itms"][0]["itm_det"]["camt"] == 675.0
    assert pl["b2cl"][0]["pos"] == "29"
    assert pl["b2cs"][0]["txval"] == 27000.0 and "iamt" not in pl["b2cs"][0]
    assert pl["cdnr"][0]["nt"][0]["ntty"] == "C"
    assert pl["nil"]["inv"][0]["sply_ty"] == "INTRAB2C" and pl["nil"]["inv"][0]["nil_amt"] == 500.0
    assert {h["hsn_sc"] for h in pl["hsn"]["hsn_b2c"]} >= {"996334", "0804"}
    b2b_hsn = pl["hsn"]["hsn_b2b"][0]
    assert b2b_hsn["txval"] == 27000.0 - 1800.0  # invoice less credit note
    assert pl["doc_issue"]["doc_det"][0]["docs"][0]["totnum"] == 4

    g3 = client.get("/api/returns/2026-10/gstr3b").json()
    t = g3["tables"]
    a = t["3.1(a) Outward taxable supplies"]
    assert D(a["txval"]) == D("27000") * 2 + D("180000") - D("1800")
    assert D(a["igst"]) == D("9000")
    assert D(t["3.1(c) Nil rated and exempted"]["txval"]) == D("500")
    assert D(t["4A(5) All other ITC"]["cgst"]) == D("25") + D("90")
    assert D(t["4B(1) ITC reversed: rules 38, 42, 43 and section 17(5)"]["cgst"]) == D("90")
    assert D(t["4C Net ITC available"]["igst"]) == D("180")
    assert D(t["5 Exempt, nil and non-GST inward (intra-state)"]["txval"]) == D("3000")
    # compare matches
    cmp = client.get("/api/returns/2026-10/compare").json()
    assert all(D(r["difference"]) == 0 for r in cmp), cmp
    # downloads
    for ret in ("gstr1", "gstr3b"):
        for fmt in ("json", "xlsx", "pdf", "csv"):
            r = client.get(f"/api/returns/2026-10/{ret}.{fmt}")
            assert r.status_code == 200 and len(r.content) > 50, (ret, fmt)
    wb = load_workbook(io.BytesIO(client.get("/api/returns/2026-10/gstr1.xlsx").content))
    assert {"b2b", "b2cl", "b2cs", "hsn(b2b)", "docs"} <= set(wb.sheetnames)


def test_no_itc_scheme_defaults_purchases_ineligible(client):
    biz = client.get("/api/business").json()
    biz.update({"no_itc_scheme": True})
    for k in ("id", "created_at", "updated_at"):
        biz.pop(k)
    assert client.put("/api/business", json=biz).status_code == 200
    p = client.post("/api/purchases", json={"number": "S1", "date": "2026-10-05", "supplier_name": "Oil", "supplier_gstin": GSTIN_TN,
                                            "lines": [{"hsn_sac": "1512", "qty": 1, "unit_price": 100, "gst_rate": 5}]}).json()
    assert p["lines"][0]["itc_eligible"] is False and "without ITC" in p["lines"][0]["itc_reason"]
    r = client.patch(f"/api/itc/purchases/{p['id']}", json=[{"line_id": p["lines"][0]["id"], "itc_eligible": True}])
    assert r.json()["lines"][0]["itc_eligible"] is True


def test_period_filing_locks_and_audit(client):
    s = sale(client, "DC/26-27/001", party_gstin=GSTIN_TN)
    assert client.post("/api/returns/2026-10/filed", json={"ret": "gstr1", "arn": "AA3310260123456", "filed_on": "2026-11-10"}).status_code == 422
    assert client.post("/api/returns/2026-10/approve").status_code == 200
    assert client.post("/api/returns/2026-10/filed", json={"ret": "gstr1", "arn": "AA3310260123456", "filed_on": "2026-11-10"}).status_code == 200
    assert client.post("/api/returns/2026-10/filed", json={"ret": "gstr3b", "arn": "AA3310260987654", "filed_on": "2026-11-19"}).status_code == 200
    ov = client.get("/api/returns/2026-10").json()
    assert ov["locked"] and ov["period_record"]["snapshot"]["gstr1"]["b2b"]
    # edits blocked
    body = {"number": s["number"], "date": "2026-10-15", "party_name": "X", "lines": [CATER]}
    assert client.put(f"/api/sales/{s['id']}", json=body).status_code == 409
    assert client.post("/api/sales", json={**body, "number": "NEW1"}).status_code == 409
    # amendment allowed and reported in the open month
    am = client.post(f"/api/sales/{s['id']}/amend", json={**body, "party_gstin": GSTIN_TN, "lines": [{**CATER, "qty": "160"}]})
    assert am.status_code == 200, am.text
    period = am.json()["amend_period"]
    g1 = client.get(f"/api/returns/{period}/gstr1").json()["payload"]
    assert g1["b2ba"][0]["inv"][0]["oinum"] == "DC/26-27/001" and g1["b2ba"][0]["inv"][0]["inum"] == "DC/26-27/001"
    g3 = client.get(f"/api/returns/{period}/gstr3b").json()["tables"]["3.1(a) Outward taxable supplies"]
    assert D(g3["txval"]) == D("1800")  # only the difference of 10 plates
    # filed snapshot unchanged
    assert client.get("/api/returns/2026-10/gstr1").json()["payload"]["b2b"][0]["inv"][0]["val"] == 28350.0
    # unlock needs reason and is audited
    assert client.post("/api/returns/2026-10/unlock", json={"reason": ""}).status_code == 422
    assert client.post("/api/returns/2026-10/unlock", json={"reason": "CA asked to fix a typo"}).status_code == 200
    log = client.get("/api/users/audit").json()
    assert any(e["action"] == "unlock" for e in log) and any(e["action"] == "file" for e in log)


def test_tax_payment_setoff_in_3b(client):
    sale(client, "DC/26-27/001", party_gstin=GSTIN_TN)
    client.post("/api/purchases", json={"number": "KA/1", "date": "2026-10-06", "supplier_name": "Plates", "supplier_gstin": GSTIN_KA,
                                        "lines": [{"hsn_sac": "4823", "qty": 1, "unit_price": 5000, "gst_rate": 18}]})
    g3 = client.get("/api/returns/2026-10/gstr3b").json()
    pay = g3["payment"]
    assert D(pay["itc_used"]["igst"]["cgst"]) == D("675") and D(pay["itc_used"]["igst"]["sgst"]) == D("225")
    assert D(pay["cash"]["sgst"]) == D("450") and D(g3["net_payable"]) == D("450")


def _xlsx(rows):
    wb = Workbook()
    ws = wb.active
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_import_sales_csv_with_errors_mapping_commit_and_rollback(client):
    csv_text = ("Inv No,Bill Date,Party Name,GSTIN,Item,SAC,Members,Taxable,Rate,CGST,SGST,IGST\n"
                f"A/1,15-10-2026,Hotel Sangam,{GSTIN_TN},Lunch,996334,100,18000,5,450,450,0\n"
                "A/1,15-10-2026,Hotel Sangam,{g},Dinner,996334,50,9000,5,225,225,0\n".format(g=GSTIN_TN) +
                "A/2,16-10-2026,Walk in,,Lunch,996334,10,1800,5,10,10,0\n"  # wrong tax
                "A/3,32-10-2026,Walk in,,Lunch,996334,10,1800,5,45,45,0\n"  # bad date
                "A/4,16-10-2026,Walk in,33AAAAA0000A1Z0,Lunch,996334,10,1800,7,0,0,0\n")  # bad gstin + rate
    files = {"file": ("sales.csv", csv_text.encode(), "text/csv")}
    pv = client.post("/api/imports/preview", data={"kind": "sales"}, files=files).json()
    assert pv["mapping"]["number"] == "Inv No" and pv["mapping"]["party_gstin"] == "GSTIN" and pv["mapping"]["taxable_value"] == "Taxable"
    assert pv["valid_rows"] == 2 and pv["invalid_rows"] == 3
    errs = {r["row"]: r["errors"] for r in pv["rows"] if r["errors"]}
    assert "Tax should be" in errs[4][0] and "not a date" in errs[5][0]
    assert any("GSTIN" in e for e in errs[6]) and any("rate" in e.lower() for e in errs[6])
    rep = client.post("/api/imports/error-report", data={"kind": "sales"}, files=files)
    assert rep.status_code == 200 and b"Problems" in rep.content
    cm = client.post("/api/imports/commit", data={"kind": "sales"}, files=files)
    assert cm.status_code == 200, cm.text
    batch = cm.json()
    assert batch["rows_imported"] == 2 and batch["rows_skipped"] == 3
    inv = client.get("/api/sales", params={"q": "A/1"}).json()["rows"][0]
    assert inv["taxable_value"] == "27000.00" and inv["section"] == "b2b"
    # re-import finds duplicates
    pv2 = client.post("/api/imports/preview", data={"kind": "sales"}, files=files).json()
    assert pv2["valid_rows"] == 0
    assert client.post(f"/api/imports/{batch['id']}/rollback").status_code == 200
    assert client.get("/api/sales", params={"q": "A/1"}).json()["total"] == 0
    assert client.get("/api/imports").json()[0]["status"] == "rolled_back"


def test_import_xlsx_customers_and_custom_mapping(client):
    data = _xlsx([["Client", "Tax ID", "Mobile"], ["Hotel Sangam", GSTIN_TN, "9894191881"], ["Walk in", "", ""]])
    files = {"file": ("c.xlsx", data, "application/octet-stream")}
    pv = client.post("/api/imports/preview", data={"kind": "customers"}, files=files).json()
    assert pv["missing_required"] == ["Name"]
    m = json.dumps({"name": "Client", "gstin": "Tax ID", "phone": "Mobile"})
    cm = client.post("/api/imports/commit", data={"kind": "customers", "mapping": m}, files=files)
    assert cm.status_code == 200 and cm.json()["rows_imported"] == 2
    ps = client.get("/api/parties", params={"kind": "customer"}).json()
    assert any(p["gstin"] == GSTIN_TN and p["state_code"] == "33" for p in ps)


def test_gstr2b_json_zip_import_and_reconciliation(client):
    client.put("/api/business", json={**{k: v for k, v in client.get("/api/business").json().items() if k not in ("id", "created_at", "updated_at")}})
    for n, amt in (("SMP/1182", 100), ("SMP/1183", 200), ("SMP/1190", 50)):
        client.post("/api/purchases", json={"number": n, "date": "2026-10-05", "supplier_name": "Oil", "supplier_gstin": GSTIN_TN,
                                            "lines": [{"hsn_sac": "1512", "qty": 1, "unit_price": amt, "gst_rate": 18}]})
    doc = {"data": {"gstin": "33AAPFU0939F1Z2", "rtnprd": "102026", "docdata": {"b2b": [{"ctin": GSTIN_TN, "trdnm": "Oil", "inv": [
        {"inum": "SMP-1182", "dt": "05-10-2026", "val": 118, "typ": "R", "itcavl": "Y", "rev": "N", "items": [{"num": 1, "rt": 18, "txval": 100, "cgst": 9, "sgst": 9}]},
        {"inum": "SMP/1183", "dt": "05-10-2026", "val": 300, "typ": "R", "itcavl": "Y", "rev": "N", "items": [{"num": 1, "rt": 18, "txval": 250, "cgst": 22.5, "sgst": 22.5}]},
        {"inum": "SMP/2000", "dt": "06-10-2026", "val": 59, "typ": "R", "itcavl": "Y", "rev": "N", "items": [{"num": 1, "rt": 18, "txval": 50, "cgst": 4.5, "sgst": 4.5}]},
    ]}]}}}
    z = io.BytesIO()
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr("GSTR2B_102026.json", json.dumps(doc))
    files = {"file": ("2b.zip", z.getvalue(), "application/zip")}
    cm = client.post("/api/imports/commit", data={"kind": "gstr2b"}, files=files)
    assert cm.status_code == 200, cm.text
    r = client.get("/api/itc/recon/2026-10").json()
    s = r["summary"]
    assert s["matched"]["count"] == 1  # SMP-1182 normalised to SMP/1182
    assert s["mismatch"]["count"] == 1  # 1183 amount differs
    assert s["missing_in_2b"]["count"] == 1 and s["missing_in_books"]["count"] == 1
    g3 = client.get("/api/returns/2026-10/gstr3b").json()
    assert D(g3["deferred_itc"]["cgst"]) == D("4.5")


def test_reports_all_kinds_and_formats(client):
    sale(client, "DC/26-27/001", party_gstin=GSTIN_TN)
    for r in client.get("/api/reports").json():
        t = client.get(f"/api/reports/{r['key']}", params={"fy": "2026-27"})
        assert t.status_code == 200, (r, t.text)
        for fmt in ("csv", "xlsx", "pdf", "json"):
            e = client.get(f"/api/reports/{r['key']}/export", params={"fy": "2026-27", "fmt": fmt})
            assert e.status_code == 200, (r["key"], fmt, e.text)


def test_templates_documents_and_backup(client):
    for k in client.get("/api/imports/kinds").json():
        for fmt in ("csv", "xlsx"):
            assert client.get(f"/api/imports/template/{k['key']}.{fmt}").status_code == 200
    # the template round-trips through preview with no missing columns
    t = client.get("/api/imports/template/purchases.xlsx").content
    pv = client.post("/api/imports/preview", data={"kind": "purchases"}, files={"file": ("t.xlsx", t, "x")}).json()
    assert not pv["missing_required"] and pv["valid_rows"] == 1, pv
    s = sale(client, "DC/26-27/001")
    up = client.post("/api/documents", data={"entity_type": "sales", "entity_id": s["id"], "category": "sales_invoice"},
                     files={"file": ("bill.pdf", b"%PDF-1.4 test", "application/pdf")})
    assert up.status_code == 200
    assert client.post("/api/documents", data={"entity_type": "sales", "entity_id": s["id"]},
                       files={"file": ("bill.pdf", b"%PDF-1.4 test", "application/pdf")}).status_code == 409
    assert client.post("/api/documents", files={"file": ("x.exe", b"MZ", "application/x-msdownload")}).status_code == 422
    docs = client.get("/api/documents", params={"entity_type": "sales", "entity_id": s["id"]}).json()
    assert docs[0]["linked_to"].startswith("Invoice")
    assert client.get(f"/api/documents/{docs[0]['id']}/download").content.startswith(b"%PDF")
    z = zipfile.ZipFile(io.BytesIO(client.get("/api/backup").content))
    assert "sales_docs.json" in z.namelist() and "password_hash" not in z.read("users.json").decode()


def test_home_and_returns_list(client):
    sale(client, "DC/26-27/001")
    h = client.get("/api/home", params={"period": "2026-10"}).json()
    assert h["sales_count"] == 1 and D(h["output_tax"]) == D("1350")
    lst = client.get("/api/returns", params={"fy": "2026-27"}).json()
    assert lst[0]["period"] >= "2026-10"
    ov = client.get("/api/returns/2026-10").json()
    assert [s["key"] for s in ov["steps"]][:2] == ["sales", "purchases"]
