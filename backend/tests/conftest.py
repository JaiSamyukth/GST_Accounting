import os
import tempfile

import pytest

_tmp = tempfile.mkdtemp()
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmp}/test.db")
os.environ["STORAGE_DIR"] = f"{_tmp}/files"
os.environ["FRONTEND_DIST"] = f"{_tmp}/nodist"

from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import seed  # noqa: E402

GSTIN_SELF = "33AAPFU0939F1Z2"  # Tamil Nadu
GSTIN_TN = "33ABCDE1234F1Z7"
GSTIN_KA = "29AAACB1234C1ZB"


class Client(TestClient):
    def request(self, method, url, **kw):
        kw.setdefault("headers", {})
        kw["headers"] = {"X-Requested-With": "fetch", **(kw["headers"] or {})}
        return super().request(method, url, **kw)


@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed(db)
    with Client(app) as c:
        r = c.post("/api/auth/setup", json={"name": "Maria", "email": "owner@devcaters.in", "password": "ownerpass123"})
        assert r.status_code == 200, r.text
        r = c.put("/api/business", json={"legal_name": "Maria Sangeetha C", "trade_name": "Dev Caters", "gstin": GSTIN_SELF,
                                          "state_code": "33", "address": "513 Vasan Nagar", "no_itc_scheme": False})
        assert r.status_code == 200, r.text
        yield c
