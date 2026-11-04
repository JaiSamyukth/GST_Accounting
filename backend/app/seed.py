"""Default configuration for a new install. Every value is editable in Settings; the CA should confirm rates."""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Business, HsnCode, TaxRate

RATES = [("0", "Nil / exempt"), ("5", "5% (outdoor catering without ITC, most food inputs)"), ("12", "12% (older periods)"),
         ("18", "18% (catering at specified premises, most services and goods)"), ("28", "28% (older periods)"), ("40", "40% (special rate)")]

HSN = [
    ("996334", "Outdoor catering services", True, "5", "taxable", "NA",
     "Standalone outdoor catering: 5% without ITC (Notification 11/2017-CT(Rate) entry 7). 18% with ITC only at specified premises. Confirm with your CA."),
    ("996337", "Other contract food services (canteen, mess)", True, "5", "taxable", "NA", "Confirm rate with your CA."),
    ("996331", "Services provided by restaurants and eating places", True, "5", "taxable", "NA", "Confirm rate with your CA."),
    ("0702", "Tomatoes, fresh", False, "0", "nil", "KGS", "Fresh vegetables are nil-rated."),
    ("0709", "Other vegetables, fresh", False, "0", "nil", "KGS", "Fresh vegetables are nil-rated."),
    ("0401", "Milk, fresh", False, "0", "nil", "LTR", ""),
    ("1006", "Rice", False, "5", "taxable", "KGS", "Pre-packaged and labelled rice is 5%; loose rice is nil-rated."),
    ("1512", "Sunflower / cotton-seed oil", False, "5", "taxable", "LTR", ""),
    ("0910", "Ginger, turmeric and spices", False, "5", "taxable", "KGS", ""),
    ("2711", "LPG (commercial cylinders)", False, "18", "taxable", "NOS", ""),
    ("4823", "Paper plates and cups", False, "5", "taxable", "NOS", "Rate changed in 2025. Confirm with your CA."),
]


def seed(db: Session) -> None:
    if not db.get(Business, 1):
        db.add(Business(id=1, trade_name="Dev Caters", address="513, Vasan Nagar, Trichy 620 102", state_code="33",
                        proprietor="C. Maria Sangeetha", phone="98941 91881, 98949 88950"))
    if not db.scalar(select(TaxRate.id).limit(1)):
        for r, label in RATES:
            db.add(TaxRate(rate=Decimal(r), label=label))
    if not db.scalar(select(HsnCode.id).limit(1)):
        for code, desc, svc, rate, kind, uqc, notes in HSN:
            db.add(HsnCode(code=code, description=desc, is_service=svc, default_rate=Decimal(rate), supply_kind=kind, uqc=uqc, notes=notes))
    db.commit()
