"""Level 2 GST filing through a GST Suvidha Provider (GSP).

Direct filing needs a licensed GSP/ASP contract, API credentials and the taxpayer's EVC/DSC flow.
Ordinary GST portal credentials are not enough. Until a provider is configured this adapter only
reports its status; Level 1 (export JSON and upload on the portal) is the working path.
"""
from __future__ import annotations

from ..config import settings


class GspNotConfigured(Exception):
    pass


def status() -> dict:
    if not settings.gsp_provider:
        return {"configured": False, "provider": None,
                "message": "Direct filing is off. Download the JSON and upload it on the GST portal, or ask your accountant to. "
                           "To enable direct filing, a licensed GST Suvidha Provider must be contracted and its API keys added on the server."}
    return {"configured": True, "provider": settings.gsp_provider, "message": f"Connected to {settings.gsp_provider}"}


def submit(return_type: str, payload: dict) -> dict:
    raise GspNotConfigured(status()["message"])
