"""Database models. Money columns are NUMERIC(14,2)."""
from __future__ import annotations

import datetime as dt
from decimal import Decimal

from sqlalchemy import (JSON, Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text,
                        UniqueConstraint, func)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

Money = Numeric(14, 2)
Rate = Numeric(6, 3)


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def zero():
    return Decimal("0.00")


class TimeStamped:
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


# ---------------------------------------------------------------- users & access
class User(TimeStamped, Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(20))  # owner | accountant
    password_hash: Mapped[str] = mapped_column(String(200))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    tutorial_done: Mapped[bool] = mapped_column(Boolean, default=False)


class UserSession(Base):
    __tablename__ = "sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    last_seen: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now)
    ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(300), default="")
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    user: Mapped[User] = relationship()


class LoginEvent(Base):
    __tablename__ = "login_history"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    email: Mapped[str] = mapped_column(String(200))
    success: Mapped[bool] = mapped_column(Boolean)
    event: Mapped[str] = mapped_column(String(30), default="login")  # login | logout | reset
    ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(300), default="")
    at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now)


class PasswordReset(Base):
    __tablename__ = "password_resets"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(String(128), unique=True)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    used: Mapped[bool] = mapped_column(Boolean, default=False)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    user_email: Mapped[str] = mapped_column(String(200), default="")
    action: Mapped[str] = mapped_column(String(40))
    entity_type: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[str] = mapped_column(String(40), default="")
    summary: Mapped[str] = mapped_column(String(400), default="")
    before: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSON, nullable=True)


# ---------------------------------------------------------------- configuration & masters
class Business(TimeStamped, Base):
    __tablename__ = "business"
    id: Mapped[int] = mapped_column(primary_key=True)
    legal_name: Mapped[str] = mapped_column(String(200), default="")
    trade_name: Mapped[str] = mapped_column(String(200), default="")
    gstin: Mapped[str] = mapped_column(String(15), default="")
    pan: Mapped[str] = mapped_column(String(10), default="")
    address: Mapped[str] = mapped_column(Text, default="")
    state_code: Mapped[str] = mapped_column(String(2), default="33")
    jurisdiction: Mapped[str] = mapped_column(String(200), default="")
    registration_type: Mapped[str] = mapped_column(String(30), default="regular")  # regular | composition
    filing_frequency: Mapped[str] = mapped_column(String(20), default="monthly")  # monthly | quarterly
    fy_start_year: Mapped[int] = mapped_column(Integer, default=2026)
    phone: Mapped[str] = mapped_column(String(60), default="")
    email: Mapped[str] = mapped_column(String(200), default="")
    proprietor: Mapped[str] = mapped_column(String(200), default="")
    invoice_prefix: Mapped[str] = mapped_column(String(20), default="DC/")
    b2cl_limit: Mapped[Decimal] = mapped_column(Money, default=Decimal("100000.00"))
    no_itc_scheme: Mapped[bool] = mapped_column(Boolean, default=True)
    round_off: Mapped[bool] = mapped_column(Boolean, default=True)
    default_price_mode: Mapped[str] = mapped_column(String(10), default="exclusive")


class TaxRate(Base):
    __tablename__ = "tax_rates"
    id: Mapped[int] = mapped_column(primary_key=True)
    rate: Mapped[Decimal] = mapped_column(Rate)
    label: Mapped[str] = mapped_column(String(120), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class HsnCode(Base):
    __tablename__ = "hsn_codes"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(8), unique=True, index=True)
    description: Mapped[str] = mapped_column(String(300))
    is_service: Mapped[bool] = mapped_column(Boolean, default=True)
    default_rate: Mapped[Decimal] = mapped_column(Rate, default=Decimal("5"))
    supply_kind: Mapped[str] = mapped_column(String(20), default="taxable")
    uqc: Mapped[str] = mapped_column(String(10), default="NA")
    itc_allowed: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str] = mapped_column(Text, default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Party(TimeStamped, Base):
    __tablename__ = "parties"
    __table_args__ = (UniqueConstraint("kind", "name", "gstin", name="uq_party"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(10), index=True)  # customer | supplier
    name: Mapped[str] = mapped_column(String(200))
    gstin: Mapped[str] = mapped_column(String(15), default="")
    address: Mapped[str] = mapped_column(Text, default="")
    state_code: Mapped[str] = mapped_column(String(2), default="33")
    phone: Mapped[str] = mapped_column(String(60), default="")
    email: Mapped[str] = mapped_column(String(200), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    import_batch_id: Mapped[int | None] = mapped_column(ForeignKey("import_batches.id", ondelete="SET NULL"), nullable=True)


# ---------------------------------------------------------------- transactions
class LineMixin:
    id: Mapped[int] = mapped_column(primary_key=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    description: Mapped[str] = mapped_column(String(300), default="")
    hsn_sac: Mapped[str] = mapped_column(String(8), default="")
    qty: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=Decimal("1"))
    unit: Mapped[str] = mapped_column(String(10), default="NOS")
    unit_price: Mapped[Decimal] = mapped_column(Numeric(14, 4), default=Decimal("0"))
    discount: Mapped[Decimal] = mapped_column(Money, default=zero)
    gst_rate: Mapped[Decimal] = mapped_column(Rate, default=Decimal("0"))
    cess_rate: Mapped[Decimal] = mapped_column(Rate, default=Decimal("0"))
    supply_kind: Mapped[str] = mapped_column(String(20), default="taxable")
    taxable_value: Mapped[Decimal] = mapped_column(Money, default=zero)
    cgst: Mapped[Decimal] = mapped_column(Money, default=zero)
    sgst: Mapped[Decimal] = mapped_column(Money, default=zero)
    igst: Mapped[Decimal] = mapped_column(Money, default=zero)
    cess: Mapped[Decimal] = mapped_column(Money, default=zero)
    total: Mapped[Decimal] = mapped_column(Money, default=zero)


class DocMixin(TimeStamped):
    id: Mapped[int] = mapped_column(primary_key=True)
    doc_type: Mapped[str] = mapped_column(String(20), default="invoice")  # invoice | credit_note | debit_note
    date: Mapped[dt.date] = mapped_column(Date, index=True)
    place_of_supply: Mapped[str] = mapped_column(String(2), default="33")
    reverse_charge: Mapped[bool] = mapped_column(Boolean, default=False)
    price_mode: Mapped[str] = mapped_column(String(10), default="exclusive")
    taxable_value: Mapped[Decimal] = mapped_column(Money, default=zero)
    cgst: Mapped[Decimal] = mapped_column(Money, default=zero)
    sgst: Mapped[Decimal] = mapped_column(Money, default=zero)
    igst: Mapped[Decimal] = mapped_column(Money, default=zero)
    cess: Mapped[Decimal] = mapped_column(Money, default=zero)
    round_off: Mapped[Decimal] = mapped_column(Money, default=zero)
    total: Mapped[Decimal] = mapped_column(Money, default=zero)
    notes: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | cancelled
    created_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    original_number: Mapped[str] = mapped_column(String(40), default="")
    original_date: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    note_reason: Mapped[str] = mapped_column(String(200), default="")


class SalesDoc(DocMixin, Base):
    __tablename__ = "sales_docs"
    __table_args__ = (UniqueConstraint("doc_type", "number", name="uq_sales_number"),)
    number: Mapped[str] = mapped_column(String(40), index=True)
    party_id: Mapped[int | None] = mapped_column(ForeignKey("parties.id", ondelete="SET NULL"), nullable=True)
    party_name: Mapped[str] = mapped_column(String(200), default="")
    party_gstin: Mapped[str] = mapped_column(String(15), default="")
    party_address: Mapped[str] = mapped_column(Text, default="")
    party_state_code: Mapped[str] = mapped_column(String(2), default="33")
    is_export: Mapped[bool] = mapped_column(Boolean, default=False)
    export_with_igst: Mapped[bool] = mapped_column(Boolean, default=False)
    section: Mapped[str] = mapped_column(String(10), default="b2cs")  # GSTR-1 section
    amends_id: Mapped[int | None] = mapped_column(ForeignKey("sales_docs.id", ondelete="SET NULL"), nullable=True)
    amended_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    amend_period: Mapped[str] = mapped_column(String(10), default="", index=True)  # period an amendment is reported in
    order_ref: Mapped[str] = mapped_column(String(40), default="")
    import_batch_id: Mapped[int | None] = mapped_column(ForeignKey("import_batches.id", ondelete="SET NULL"), nullable=True)
    lines: Mapped[list["SalesLine"]] = relationship(back_populates="doc", cascade="all, delete-orphan", order_by="SalesLine.position")


class SalesLine(LineMixin, Base):
    __tablename__ = "sales_lines"
    doc_id: Mapped[int] = mapped_column(ForeignKey("sales_docs.id", ondelete="CASCADE"), index=True)
    doc: Mapped[SalesDoc] = relationship(back_populates="lines")


class Purchase(DocMixin, Base):
    __tablename__ = "purchases"
    __table_args__ = (UniqueConstraint("supplier_gstin", "supplier_name", "number", "doc_type", name="uq_purchase_number"),)
    number: Mapped[str] = mapped_column(String(40), index=True)  # supplier's invoice number
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("parties.id", ondelete="SET NULL"), nullable=True)
    supplier_name: Mapped[str] = mapped_column(String(200), default="")
    supplier_gstin: Mapped[str] = mapped_column(String(15), default="")
    supplier_state_code: Mapped[str] = mapped_column(String(2), default="33")
    category: Mapped[str] = mapped_column(String(30), default="inputs")  # inputs | input_services | capital_goods | expense
    itc_period: Mapped[str] = mapped_column(String(10), default="", index=True)  # YYYY-MM the ITC is claimed in
    recon_status: Mapped[str] = mapped_column(String(20), default="pending")
    import_batch_id: Mapped[int | None] = mapped_column(ForeignKey("import_batches.id", ondelete="SET NULL"), nullable=True)
    lines: Mapped[list["PurchaseLine"]] = relationship(back_populates="doc", cascade="all, delete-orphan", order_by="PurchaseLine.position")


class PurchaseLine(LineMixin, Base):
    __tablename__ = "purchase_lines"
    doc_id: Mapped[int] = mapped_column(ForeignKey("purchases.id", ondelete="CASCADE"), index=True)
    itc_eligible: Mapped[bool] = mapped_column(Boolean, default=False)
    itc_reason: Mapped[str] = mapped_column(String(200), default="")
    doc: Mapped[Purchase] = relationship(back_populates="lines")


class ItcAdjustment(TimeStamped, Base):
    __tablename__ = "itc_adjustments"
    id: Mapped[int] = mapped_column(primary_key=True)
    period: Mapped[str] = mapped_column(String(10), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # reversal | reclaim
    rule: Mapped[str] = mapped_column(String(20))  # rule42 | rule43 | sec17_5 | rule37 | others
    igst: Mapped[Decimal] = mapped_column(Money, default=zero)
    cgst: Mapped[Decimal] = mapped_column(Money, default=zero)
    sgst: Mapped[Decimal] = mapped_column(Money, default=zero)
    cess: Mapped[Decimal] = mapped_column(Money, default=zero)
    note: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[int | None] = mapped_column(Integer, nullable=True)


class Gstr2bEntry(Base):
    __tablename__ = "gstr2b_entries"
    id: Mapped[int] = mapped_column(primary_key=True)
    period: Mapped[str] = mapped_column(String(10), index=True)
    supplier_gstin: Mapped[str] = mapped_column(String(15), index=True)
    supplier_name: Mapped[str] = mapped_column(String(200), default="")
    doc_type: Mapped[str] = mapped_column(String(20), default="invoice")
    number: Mapped[str] = mapped_column(String(40))
    date: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    taxable_value: Mapped[Decimal] = mapped_column(Money, default=zero)
    igst: Mapped[Decimal] = mapped_column(Money, default=zero)
    cgst: Mapped[Decimal] = mapped_column(Money, default=zero)
    sgst: Mapped[Decimal] = mapped_column(Money, default=zero)
    cess: Mapped[Decimal] = mapped_column(Money, default=zero)
    itc_available: Mapped[bool] = mapped_column(Boolean, default=True)
    reverse_charge: Mapped[bool] = mapped_column(Boolean, default=False)
    import_batch_id: Mapped[int | None] = mapped_column(ForeignKey("import_batches.id", ondelete="CASCADE"), nullable=True)


# ---------------------------------------------------------------- returns
class ReturnPeriod(TimeStamped, Base):
    __tablename__ = "return_periods"
    id: Mapped[int] = mapped_column(primary_key=True)
    period: Mapped[str] = mapped_column(String(10), unique=True)  # 2026-10 or 2026-Q3
    fy: Mapped[str] = mapped_column(String(9))  # 2026-27
    gstr1_status: Mapped[str] = mapped_column(String(20), default="open")  # open | approved | filed
    gstr3b_status: Mapped[str] = mapped_column(String(20), default="open")
    gstr1_arn: Mapped[str] = mapped_column(String(40), default="")
    gstr1_filed_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    gstr3b_arn: Mapped[str] = mapped_column(String(40), default="")
    gstr3b_filed_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    approved_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    approved_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    output_tax: Mapped[Decimal] = mapped_column(Money, default=zero)
    eligible_itc: Mapped[Decimal] = mapped_column(Money, default=zero)
    net_payable: Mapped[Decimal] = mapped_column(Money, default=zero)
    snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # frozen figures when filed
    paid_igst: Mapped[Decimal] = mapped_column(Money, default=zero)
    paid_cgst: Mapped[Decimal] = mapped_column(Money, default=zero)
    paid_sgst: Mapped[Decimal] = mapped_column(Money, default=zero)
    paid_cess: Mapped[Decimal] = mapped_column(Money, default=zero)
    interest: Mapped[Decimal] = mapped_column(Money, default=zero)
    late_fee: Mapped[Decimal] = mapped_column(Money, default=zero)
    challan_ref: Mapped[str] = mapped_column(String(60), default="")
    paid_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    locked: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str] = mapped_column(Text, default="")


# ---------------------------------------------------------------- documents & imports
class Document(Base):
    __tablename__ = "documents"
    id: Mapped[int] = mapped_column(primary_key=True)
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(120), default="application/octet-stream")
    size: Mapped[int] = mapped_column(Integer, default=0)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    storage_key: Mapped[str] = mapped_column(String(300))
    category: Mapped[str] = mapped_column(String(40), default="other")
    entity_type: Mapped[str] = mapped_column(String(30), default="")  # sales | purchase | return | ""
    entity_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    note: Mapped[str] = mapped_column(String(300), default="")
    uploaded_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    uploaded_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now)


class ImportBatch(Base):
    __tablename__ = "import_batches"
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(30))
    filename: Mapped[str] = mapped_column(String(255))
    schema_version: Mapped[str] = mapped_column(String(60), default="")
    status: Mapped[str] = mapped_column(String(20), default="committed")  # committed | rolled_back
    rows_total: Mapped[int] = mapped_column(Integer, default=0)
    rows_imported: Mapped[int] = mapped_column(Integer, default=0)
    rows_skipped: Mapped[int] = mapped_column(Integer, default=0)
    mapping: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    errors: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_ids: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now)
    rolled_back_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
