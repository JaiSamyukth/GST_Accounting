from decimal import Decimal as D

import pytest

from app.services.gst import LineInput, calc_line, calc_document, classify_sales_doc
from app.services.gstin import validate_gstin, gstin_checksum, state_from_gstin


def test_gstin_checksum_known_valid():
    assert validate_gstin("27AAPFU0939F1ZV").ok
    assert state_from_gstin("33AAPFU0939F1Z2") == "33"


def test_gstin_rejects_bad_checksum_and_format():
    assert not validate_gstin("27AAPFU0939F1ZA").ok
    assert not validate_gstin("27AAPFU0939F1Z").ok
    assert not validate_gstin("99AAPFU0939F1ZV").ok  # unknown state
    assert "checksum" in validate_gstin("27AAPFU0939F1ZA").error.lower()


def test_gstin_checksum_char():
    assert gstin_checksum("27AAPFU0939F1Z") == "V"


def test_intra_state_exclusive_splits_cgst_sgst():
    r = calc_line(LineInput(qty=D("100"), unit_price=D("250"), gst_rate=D("5")), inclusive=False, inter_state=False)
    assert r.taxable_value == D("25000.00")
    assert r.cgst == D("625.00") and r.sgst == D("625.00") and r.igst == D("0.00")
    assert r.total == D("26250.00")


def test_inter_state_uses_igst():
    r = calc_line(LineInput(qty=D("1"), unit_price=D("1000"), gst_rate=D("18")), inclusive=False, inter_state=True)
    assert r.igst == D("180.00") and r.cgst == D("0.00")


def test_discount_reduces_taxable_value():
    r = calc_line(LineInput(qty=D("10"), unit_price=D("100"), discount=D("100"), gst_rate=D("5")), inclusive=False, inter_state=False)
    assert r.taxable_value == D("900.00")
    assert r.cgst == D("22.50")


def test_inclusive_price_back_calculates_and_totals_match_gross():
    r = calc_line(LineInput(qty=D("1"), unit_price=D("1050"), gst_rate=D("5")), inclusive=True, inter_state=False)
    assert r.taxable_value == D("1000.00")
    assert r.cgst == D("25.00") and r.sgst == D("25.00")
    assert r.total == D("1050.00")


def test_inclusive_odd_amount_keeps_total_equal_gross():
    r = calc_line(LineInput(qty=D("3"), unit_price=D("333.33"), gst_rate=D("18")), inclusive=True, inter_state=False)
    assert r.total == D("999.99")
    assert r.cgst == r.sgst
    assert r.taxable_value + r.cgst + r.sgst == D("999.99")


@pytest.mark.parametrize("kind", ["exempt", "nil", "non_gst"])
def test_non_taxable_kinds_carry_no_tax(kind):
    r = calc_line(LineInput(qty=D("2"), unit_price=D("50"), gst_rate=D("5"), supply_kind=kind), inclusive=False, inter_state=False)
    assert r.gst_rate == D("0") and r.cgst == r.sgst == r.igst == D("0.00")
    assert r.total == D("100.00")


def test_half_up_rounding_to_paise():
    r = calc_line(LineInput(qty=D("1"), unit_price=D("10.10"), gst_rate=D("5")), inclusive=False, inter_state=False)
    # 10.10 * 2.5% = 0.2525 -> 0.25
    assert r.cgst == D("0.25")
    r = calc_line(LineInput(qty=D("1"), unit_price=D("10.30"), gst_rate=D("5")), inclusive=False, inter_state=False)
    # 0.2575 -> 0.26
    assert r.cgst == D("0.26")


def test_document_totals_and_rate_breakup_and_round_off():
    lines = [
        LineInput(qty=D("150"), unit_price=D("180"), gst_rate=D("5"), hsn_sac="996334"),
        LineInput(qty=D("1"), unit_price=D("1500.50"), gst_rate=D("5"), hsn_sac="996334"),
        LineInput(qty=D("1"), unit_price=D("500"), gst_rate=D("18"), hsn_sac="996601"),
    ]
    doc = calc_document(lines, inclusive=False, inter_state=False, round_off=True)
    assert doc.taxable_value == D("29000.50")
    assert doc.cgst == D("675.00") + D("37.51") + D("45.00")
    assert doc.by_rate[D("5")]["taxable_value"] == D("28500.50")
    assert doc.round_off == (doc.total - (doc.taxable_value + doc.cgst + doc.sgst + doc.igst + doc.cess))
    assert doc.total == doc.total.to_integral_value()


def test_classify_sales_doc():
    assert classify_sales_doc("invoice", party_gstin="33AAPFU0939F1Z2", inter_state=False, total=D("10"), b2cl_limit=D("100000")) == "b2b"
    assert classify_sales_doc("invoice", party_gstin="", inter_state=True, total=D("100001"), b2cl_limit=D("100000")) == "b2cl"
    assert classify_sales_doc("invoice", party_gstin="", inter_state=True, total=D("100000"), b2cl_limit=D("100000")) == "b2cs"
    assert classify_sales_doc("invoice", party_gstin="", inter_state=False, total=D("900000"), b2cl_limit=D("100000")) == "b2cs"
    assert classify_sales_doc("invoice", party_gstin="", inter_state=True, total=D("5"), b2cl_limit=D("1"), is_export=True) == "exp"
    assert classify_sales_doc("credit_note", party_gstin="33AAPFU0939F1Z2", inter_state=False, total=D("5"), b2cl_limit=D("1")) == "cdnr"
    assert classify_sales_doc("credit_note", party_gstin="", inter_state=True, total=D("150000"), b2cl_limit=D("100000")) == "cdnur"
    assert classify_sales_doc("credit_note", party_gstin="", inter_state=False, total=D("5"), b2cl_limit=D("1")) == "b2cs"
