from __future__ import annotations

import datetime as dt
from decimal import Decimal

from sqlalchemy import inspect


def jsonable(v):
    if isinstance(v, Decimal):
        return format(v, "f")
    if isinstance(v, (dt.date, dt.datetime)):
        return v.isoformat()
    if isinstance(v, dict):
        return {str(k): jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [jsonable(x) for x in v]
    return v


def row(obj, exclude: tuple[str, ...] = ()) -> dict:
    return {c.key: jsonable(getattr(obj, c.key)) for c in inspect(obj).mapper.column_attrs if c.key not in exclude}
