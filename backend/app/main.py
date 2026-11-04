from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from .api import auth, itc, masters, misc, returns, transactions, users
from .config import settings
from .db import Base, SessionLocal, engine
from .seed import seed

log = logging.getLogger("devcaters")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed(db)
    yield


def create_app() -> FastAPI:
    app = FastAPI(lifespan=lifespan, title="Dev Caters GST Accounting", version="1.0.0",
                  description="GST accounting for Dev Caters: sales, purchases, ITC, GSTR-1, GSTR-3B, reports, imports.")
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
                       allow_methods=["*"], allow_headers=["*"])

    @app.middleware("http")
    async def csrf_and_headers(request: Request, call_next):
        if request.url.path.startswith("/api/") and request.method in ("POST", "PUT", "PATCH", "DELETE"):
            if request.headers.get("x-requested-with") != "fetch":
                return JSONResponse({"detail": "Request blocked (missing X-Requested-With header)"}, status_code=403)
        resp = await call_next(request)
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("Referrer-Policy", "same-origin")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        if request.url.path.startswith("/api/"):
            resp.headers.setdefault("Cache-Control", "no-store")
        return resp

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        log.exception("Unhandled error on %s", request.url.path)
        return JSONResponse({"detail": "Something went wrong on the server. Nothing was saved. Try again"}, status_code=500)

    for r in (auth.router, users.router, masters.router, transactions.router, itc.router, returns.router, misc.router):
        app.include_router(r)

    @app.get("/api/health")
    def health():
        return {"ok": True}

    dist = Path(settings.frontend_dist)
    if dist.exists():
        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            if path.startswith("api/"):
                return JSONResponse({"detail": "Not found"}, status_code=404)
            f = (dist / path).resolve()
            if path and f.is_file() and dist.resolve() in f.parents:
                headers = {"Cache-Control": "public, max-age=31536000, immutable"} if path.startswith("assets/") else {}
                return FileResponse(f, headers=headers)
            return FileResponse(dist / "index.html", headers={"Cache-Control": "no-cache"})
    return app


app = create_app()
