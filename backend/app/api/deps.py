from __future__ import annotations

import datetime as dt

from fastapi import HTTPException, Query

from ..services.periods import fy_range, period_range


def date_range(from_: str | None = Query(None, alias="from"), to: str | None = None, fy: str | None = None,
               period: str | None = None) -> tuple[dt.date, dt.date]:
    try:
        if period:
            return period_range(period)
        if fy:
            return fy_range(fy)
        start = dt.date.fromisoformat(from_) if from_ else dt.date(2000, 1, 1)
        end = dt.date.fromisoformat(to) if to else dt.date(2100, 1, 1)
    except ValueError as e:
        raise HTTPException(422, "Dates must look like 2026-10-31") from e
    if start > end:
        raise HTTPException(422, "The start date is after the end date")
    return start, end
