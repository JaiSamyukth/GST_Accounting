from decimal import Decimal as D

from app.services.returns import set_off


def heads(i=0, c=0, s=0, cess=0):
    return {"igst": D(str(i)), "cgst": D(str(c)), "sgst": D(str(s)), "cess": D(str(cess))}


def test_igst_credit_used_first_against_igst_then_cgst_then_sgst():
    r = set_off(heads(100, 50, 50), heads(i=180))
    assert r["itc_used"]["igst"] == {"igst": D("100"), "cgst": D("50"), "sgst": D("30")}
    assert r["cash"] == heads(0, 0, 20)
    assert r["balance"] == heads(0, 0, 0)


def test_cgst_credit_cannot_pay_sgst():
    r = set_off(heads(0, 10, 100), heads(c=100))
    assert r["cash"]["sgst"] == D("100")
    assert r["cash"]["cgst"] == D("0")
    assert r["balance"]["cgst"] == D("90")


def test_cgst_credit_pays_igst_after_cgst():
    r = set_off(heads(40, 10, 0), heads(c=30, s=5))
    assert r["itc_used"]["cgst"] == {"igst": D("20"), "cgst": D("10"), "sgst": D("0")}
    assert r["itc_used"]["sgst"]["igst"] == D("5")
    assert r["cash"]["igst"] == D("15")


def test_cess_only_with_cess():
    r = set_off(heads(cess=10), heads(i=100, cess=4))
    assert r["cash"]["cess"] == D("6")
    assert r["balance"]["igst"] == D("100")
