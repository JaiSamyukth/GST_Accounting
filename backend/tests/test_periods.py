import datetime as dt

from app.services.periods import (fy_of, gstr1_due, month_key, months_in, period_label, period_range,
                                  periods_for_fy, quarter_key, return_fp)


def test_fy_and_keys():
    assert fy_of(dt.date(2026, 3, 31)) == "2025-26"
    assert fy_of(dt.date(2026, 4, 1)) == "2026-27"
    assert month_key(dt.date(2026, 10, 5)) == "2026-10"
    assert quarter_key(dt.date(2027, 2, 1)) == "2026-Q4"
    assert quarter_key(dt.date(2026, 4, 1)) == "2026-Q1"


def test_ranges_and_labels():
    assert period_range("2026-02") == (dt.date(2026, 2, 1), dt.date(2026, 2, 28))
    assert period_range("2026-Q3") == (dt.date(2026, 10, 1), dt.date(2026, 12, 31))
    assert period_range("2026-Q4") == (dt.date(2027, 1, 1), dt.date(2027, 3, 31))
    assert months_in("2026-Q4") == ["2027-01", "2027-02", "2027-03"]
    assert return_fp("2026-Q3") == "122026"
    assert period_label("2026-10") == "October 2026"
    assert periods_for_fy("2026-27", "monthly")[0] == "2026-04" and periods_for_fy("2026-27", "monthly")[-1] == "2027-03"
    assert gstr1_due("2026-10") == dt.date(2026, 11, 11)
