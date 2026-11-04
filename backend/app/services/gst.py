"""GST calculation engine. Pure functions on Decimal; no database access.

Rounding: each tax component is rounded half-up to the paisa per line.
Intra-state supplies split the rate equally into CGST and SGST; inter-state supplies carry IGST.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal

ZERO = Decimal("0.00")
PAISA = Decimal("0.01")
SUPPLY_KINDS = ("taxable", "exempt", "nil", "non_gst", "zero_rated")
NON_TAXABLE = ("exempt", "nil", "non_gst")


def money(value) -> Decimal:
    if value is None or value == "":
        return ZERO
    return Decimal(str(value)).quantize(PAISA, rounding=ROUND_HALF_UP)


def dec(value, default="0") -> Decimal:
    if value is None or value == "":
        return Decimal(default)
    return Decimal(str(value))


@dataclass
class LineInput:
    qty: Decimal = Decimal("1")
    unit_price: Decimal = Decimal("0")
    gst_rate: Decimal = Decimal("0")
    discount: Decimal = Decimal("0")
    supply_kind: str = "taxable"
    cess_rate: Decimal = Decimal("0")
    hsn_sac: str = ""
    description: str = ""
    unit: str = "NOS"


@dataclass
class LineResult:
    gross: Decimal
    discount: Decimal
    taxable_value: Decimal
    gst_rate: Decimal
    cgst: Decimal
    sgst: Decimal
    igst: Decimal
    cess: Decimal
    total: Decimal

    @property
    def tax(self) -> Decimal:
        return self.cgst + self.sgst + self.igst + self.cess


def _split(taxable: Decimal, rate: Decimal, inter_state: bool) -> tuple[Decimal, Decimal, Decimal]:
    if inter_state:
        return ZERO, ZERO, money(taxable * rate / 100)
    half = money(taxable * rate / 200)
    return half, half, ZERO


def calc_line(line: LineInput, *, inclusive: bool, inter_state: bool) -> LineResult:
    if line.supply_kind not in SUPPLY_KINDS:
        raise ValueError(f"Unknown supply kind {line.supply_kind}")
    rate = Decimal("0") if line.supply_kind in NON_TAXABLE else dec(line.gst_rate)
    if rate < 0 or rate > 100:
        raise ValueError("GST rate must be between 0 and 100")
    cess_rate = Decimal("0") if line.supply_kind in NON_TAXABLE else dec(line.cess_rate)
    gross = money(dec(line.qty) * dec(line.unit_price))
    discount = money(line.discount)
    if discount > gross:
        raise ValueError("Discount cannot exceed the line amount")
    net = gross - discount

    if inclusive and (rate or cess_rate):
        taxable = money(net * 100 / (100 + rate + cess_rate))
        cgst, sgst, igst = _split(taxable, rate, inter_state)
        cess = money(taxable * cess_rate / 100)
        # Absorb the paisa difference in taxable value so the line total equals what was charged.
        taxable = net - (cgst + sgst + igst + cess)
    else:
        taxable = net
        cgst, sgst, igst = _split(taxable, rate, inter_state)
        cess = money(taxable * cess_rate / 100)

    total = taxable + cgst + sgst + igst + cess
    return LineResult(gross, discount, taxable, rate, cgst, sgst, igst, cess, total)


@dataclass
class DocResult:
    lines: list[LineResult]
    taxable_value: Decimal = ZERO
    cgst: Decimal = ZERO
    sgst: Decimal = ZERO
    igst: Decimal = ZERO
    cess: Decimal = ZERO
    round_off: Decimal = ZERO
    total: Decimal = ZERO
    by_rate: dict = field(default_factory=dict)
    by_kind: dict = field(default_factory=dict)


def calc_document(lines: list[LineInput], *, inclusive: bool, inter_state: bool, round_off: bool = False) -> DocResult:
    results = [calc_line(l, inclusive=inclusive, inter_state=inter_state) for l in lines]
    doc = DocResult(lines=results)
    for inp, r in zip(lines, results):
        doc.taxable_value += r.taxable_value
        doc.cgst += r.cgst
        doc.sgst += r.sgst
        doc.igst += r.igst
        doc.cess += r.cess
        if inp.supply_kind in ("taxable", "zero_rated"):
            bucket = doc.by_rate.setdefault(r.gst_rate, {k: ZERO for k in ("taxable_value", "cgst", "sgst", "igst", "cess")})
            for k in bucket:
                bucket[k] += getattr(r, k)
        doc.by_kind[inp.supply_kind] = doc.by_kind.get(inp.supply_kind, ZERO) + r.taxable_value
    exact = doc.taxable_value + doc.cgst + doc.sgst + doc.igst + doc.cess
    doc.total = exact.quantize(Decimal("1"), rounding=ROUND_HALF_UP) if round_off else exact
    doc.total = money(doc.total)
    doc.round_off = doc.total - exact
    return doc


def classify_sales_doc(doc_type: str, *, party_gstin: str | None, inter_state: bool, total: Decimal,
                       b2cl_limit: Decimal, is_export: bool = False) -> str:
    """Return the GSTR-1 section a sales document belongs to."""
    registered = bool((party_gstin or "").strip())
    if doc_type == "invoice":
        if is_export:
            return "exp"
        if registered:
            return "b2b"
        if inter_state and total > b2cl_limit:
            return "b2cl"
        return "b2cs"
    # credit / debit notes
    if registered:
        return "cdnr"
    if is_export or (inter_state and total > b2cl_limit):
        return "cdnur"
    return "b2cs"


def inr(v) -> str:
    """Indian digit grouping: 123456.5 -> 1,23,456.50"""
    d = money(v)
    neg = d < 0
    whole, frac = f"{abs(d):.2f}".split(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join(groups + [tail])
    return ("-" if neg else "") + whole + "." + frac
