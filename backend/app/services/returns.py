"""GSTR-1 and GSTR-3B preparation from the books."""
from __future__ import annotations

import datetime as dt
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session, selectinload

from ..models import Business, Gstr2bEntry, ItcAdjustment, Purchase, ReturnPeriod, SalesDoc
from .gst import ZERO, money
from .gstin import validate_gstin
from .periods import months_in, period_range, return_fp
from .gst import inr

SCHEMA_VERSION = "gstr1-2025.05 / gstr3b-2024.01"
HEADS = ("igst", "cgst", "sgst", "cess")
T = ("txval", "iamt", "camt", "samt", "csamt")


def _z() -> dict:
    return {k: ZERO for k in HEADS}


def _d(d: dt.date) -> str:
    return d.strftime("%d-%m-%Y")


def _n(x: Decimal) -> float:
    """Portal JSON wants numbers, rounded to 2 places."""
    return float(money(x))


def sales_in(db: Session, key: str) -> list[SalesDoc]:
    start, end = period_range(key)
    q = (select(SalesDoc).options(selectinload(SalesDoc.lines))
         .where(or_(and_(SalesDoc.amends_id.is_(None), SalesDoc.status.in_(("active", "amended")), SalesDoc.date >= start, SalesDoc.date <= end),
                    and_(SalesDoc.amends_id.is_not(None), SalesDoc.status == "active", SalesDoc.amend_period.in_(months_in(key) + [key]))))
         .order_by(SalesDoc.date, SalesDoc.number))
    return list(db.scalars(q))


def purchases_in(db: Session, key: str) -> list[Purchase]:
    q = (select(Purchase).options(selectinload(Purchase.lines))
         .where(Purchase.status == "active", Purchase.itc_period.in_(months_in(key)))
         .order_by(Purchase.date))
    return list(db.scalars(q))


def num(doc) -> str:
    return doc.number.removesuffix("~A")


def _sign(doc) -> int:
    return -1 if doc.doc_type == "credit_note" else 1


def _items(doc) -> list[dict]:
    by_rate: dict[Decimal, dict] = {}
    for l in doc.lines:
        if l.supply_kind not in ("taxable", "zero_rated"):
            continue
        b = by_rate.setdefault(l.gst_rate, {k: ZERO for k in T})
        b["txval"] += l.taxable_value
        b["iamt"] += l.igst
        b["camt"] += l.cgst
        b["samt"] += l.sgst
        b["csamt"] += l.cess
    return [{"num": i, "itm_det": {"txval": _n(v["txval"]), "rt": float(rt), "iamt": _n(v["iamt"]), "camt": _n(v["camt"]),
                                   "samt": _n(v["samt"]), "csamt": _n(v["csamt"])}}
            for i, (rt, v) in enumerate(sorted(by_rate.items()), 1)]


def _taxable_any(doc) -> bool:
    return any(l.supply_kind in ("taxable", "zero_rated") for l in doc.lines)


# ------------------------------------------------------------------------------------------- GSTR-1
def build_gstr1(db: Session, b: Business, key: str) -> dict:
    docs = sales_in(db, key)
    originals = {d.id: d for d in db.scalars(select(SalesDoc).where(SalesDoc.id.in_([x.amends_id for x in docs if x.amends_id])))}
    b2b, b2ba, cdnr, cdnra = defaultdict(list), defaultdict(list), defaultdict(list), defaultdict(list)
    b2cl, b2cla = defaultdict(list), defaultdict(list)
    b2cs: dict[tuple, dict] = {}
    exp: dict[str, list] = defaultdict(list)
    cdnur: list = []
    nil = {k: {"expt_amt": ZERO, "nil_amt": ZERO, "ngsup_amt": ZERO} for k in ("INTRB2B", "INTRB2C", "INTRAB2B", "INTRAB2C")}
    hsn = {"b2b": {}, "b2c": {}}
    counts: dict[str, int] = defaultdict(int)
    totals: dict[str, dict] = defaultdict(lambda: {k: ZERO for k in ("taxable_value", *HEADS, "total")})
    issues: list[dict] = []
    numbers: dict[str, list[str]] = defaultdict(list)
    cancelled = list(db.scalars(select(SalesDoc.number).where(SalesDoc.status == "cancelled", SalesDoc.date >= period_range(key)[0],
                                                               SalesDoc.date <= period_range(key)[1])))

    for d in docs:
        inter = d.is_export or d.place_of_supply != b.state_code
        sign = _sign(d)
        sec = d.section
        amended = bool(d.amends_id)
        if not amended:
            numbers[d.doc_type].append(num(d))
        label = f"{d.doc_type.replace('_', ' ')} {d.number}"

        # validations
        if d.party_gstin and not validate_gstin(d.party_gstin).ok:
            issues.append({"level": "error", "doc_id": d.id, "message": f"{label}: customer GSTIN is not valid"})
        for l in d.lines:
            if not l.hsn_sac:
                issues.append({"level": "error" if sec in ("b2b", "cdnr") else "warning", "doc_id": d.id,
                               "message": f"{label}: a line has no HSN/SAC code"})
                break
        if d.total == 0:
            issues.append({"level": "warning", "doc_id": d.id, "message": f"{label}: total is zero"})
        if d.doc_type != "invoice" and not d.original_number:
            issues.append({"level": "error", "doc_id": d.id, "message": f"{label}: original invoice number is missing"})

        # nil / exempt / non-GST (Table 8)
        for l in d.lines:
            if l.supply_kind in ("exempt", "nil", "non_gst"):
                k = ("INTR" if inter else "INTRA") + ("B2B" if d.party_gstin else "B2C")
                fld = {"exempt": "expt_amt", "nil": "nil_amt", "non_gst": "ngsup_amt"}[l.supply_kind]
                nil[k][fld] += sign * l.taxable_value

        # HSN summary (Table 12)
        if not amended:
            bucket = hsn["b2b" if d.party_gstin else "b2c"]
            for l in d.lines:
                key_h = (l.hsn_sac or "NA", l.gst_rate, l.unit or "NA")
                h = bucket.setdefault(key_h, {"desc": l.description, "qty": Decimal("0"), "txval": ZERO, "iamt": ZERO, "camt": ZERO, "samt": ZERO, "csamt": ZERO})
                h["qty"] += sign * l.qty
                h["txval"] += sign * l.taxable_value
                h["iamt"] += sign * l.igst
                h["camt"] += sign * l.cgst
                h["samt"] += sign * l.sgst
                h["csamt"] += sign * l.cess

        if not _taxable_any(d):
            counts["nil"] += 1
            continue

        tag = sec + ("a" if amended else "")
        counts[tag] += 1
        t = totals[tag]
        tx = [l for l in d.lines if l.supply_kind in ("taxable", "zero_rated")]
        t["taxable_value"] += sum((l.taxable_value for l in tx), ZERO)
        for k in HEADS:
            t[k] += sum((getattr(l, k) for l in tx), ZERO)
        t["total"] += d.total

        orig = originals.get(d.amends_id) if amended else None
        amend_keys = {"oinum": orig.number, "oidt": _d(orig.date)} if orig else {}
        if sec == "b2b":
            inv = {"inum": num(d), "idt": _d(d.date), "val": _n(d.total), "pos": d.place_of_supply,
                   "rchrg": "Y" if d.reverse_charge else "N", "inv_typ": "R", "itms": _items(d), **amend_keys}
            (b2ba if amended else b2b)[d.party_gstin].append(inv)
        elif sec == "b2cl":
            inv = {"inum": num(d), "idt": _d(d.date), "val": _n(d.total), "itms": _items(d), **amend_keys}
            (b2cla if amended else b2cl)[d.place_of_supply].append(inv)
        elif sec == "exp":
            typ = "WPAY" if d.export_with_igst else "WOPAY"
            exp[typ].append({"inum": num(d), "idt": _d(d.date), "val": _n(d.total),
                             "itms": [{"txval": i["itm_det"]["txval"], "rt": i["itm_det"]["rt"], "iamt": i["itm_det"]["iamt"],
                                       "csamt": i["itm_det"]["csamt"]} for i in _items(d)]})
        elif sec == "cdnr":
            nt = {"ntty": "C" if d.doc_type == "credit_note" else "D", "nt_num": num(d), "nt_dt": _d(d.date), "val": _n(d.total),
                  "pos": d.place_of_supply, "rchrg": "Y" if d.reverse_charge else "N", "inv_typ": "R", "itms": _items(d)}
            if orig:
                nt.update({"ont_num": orig.number, "ont_dt": _d(orig.date)})
            (cdnra if amended else cdnr)[d.party_gstin].append(nt)
        elif sec == "cdnur":
            cdnur.append({"typ": "EXPWP" if d.is_export and d.export_with_igst else "EXPWOP" if d.is_export else "B2CL",
                          "ntty": "C" if d.doc_type == "credit_note" else "D", "nt_num": num(d), "nt_dt": _d(d.date),
                          "val": _n(d.total), "pos": d.place_of_supply, "itms": _items(d)})
        else:  # b2cs (including small unregistered notes, signed)
            for l in tx:
                k = ("INTER" if inter else "INTRA", d.place_of_supply, l.gst_rate)
                row_ = b2cs.setdefault(k, {k2: ZERO for k2 in T})
                row_["txval"] += sign * l.taxable_value
                row_["iamt"] += sign * l.igst
                row_["camt"] += sign * l.cgst
                row_["samt"] += sign * l.sgst
                row_["csamt"] += sign * l.cess

    # numbering checks
    for dt_, nums in numbers.items():
        if len(nums) != len(set(nums)):
            issues.append({"level": "error", "message": f"Duplicate {dt_.replace('_', ' ')} numbers in this period"})

    def doc_issue() -> dict:
        det = []
        for num, dt_ in ((1, "invoice"), (4, "debit_note"), (5, "credit_note")):
            nums = sorted(numbers.get(dt_, []))
            if not nums:
                continue
            canc = len([c for c in cancelled]) if dt_ == "invoice" else 0
            det.append({"doc_num": num, "docs": [{"num": 1, "from": nums[0], "to": nums[-1], "totnum": len(nums) + canc,
                                                   "cancel": canc, "net_issue": len(nums)}]})
        return {"doc_det": det}

    def hsn_rows(bucket):
        return [{"num": i, "hsn_sc": k[0], "desc": v["desc"][:30], "user_desc": v["desc"][:30], "uqc": k[2], "qty": float(v["qty"]),
                 "rt": float(k[1]), "txval": _n(v["txval"]), "iamt": _n(v["iamt"]), "camt": _n(v["camt"]),
                 "samt": _n(v["samt"]), "csamt": _n(v["csamt"])}
                for i, (k, v) in enumerate(sorted(bucket.items()), 1)]

    payload = {"gstin": b.gstin, "fp": return_fp(key), "version": "GST3.2", "hash": "hash"}
    if b2b:
        payload["b2b"] = [{"ctin": g, "inv": v} for g, v in sorted(b2b.items())]
    if b2ba:
        payload["b2ba"] = [{"ctin": g, "inv": v} for g, v in sorted(b2ba.items())]
    if b2cl:
        payload["b2cl"] = [{"pos": p, "inv": v} for p, v in sorted(b2cl.items())]
    if b2cla:
        payload["b2cla"] = [{"pos": p, "inv": v} for p, v in sorted(b2cla.items())]
    if b2cs:
        payload["b2cs"] = [{"sply_ty": k[0], "pos": k[1], "typ": "OE", "rt": float(k[2]), **{f: _n(v[f]) for f in T}}
                           for k, v in sorted(b2cs.items())]
        for r in payload["b2cs"]:
            if r["sply_ty"] == "INTRA":
                r.pop("iamt")
            else:
                r.pop("camt")
                r.pop("samt")
    if exp:
        payload["exp"] = [{"exp_typ": t, "inv": v} for t, v in exp.items()]
    if cdnr:
        payload["cdnr"] = [{"ctin": g, "nt": v} for g, v in sorted(cdnr.items())]
    if cdnra:
        payload["cdnra"] = [{"ctin": g, "nt": v} for g, v in sorted(cdnra.items())]
    if cdnur:
        payload["cdnur"] = cdnur
    nil_rows = [{"sply_ty": k, **{f: _n(v[f]) for f in v}} for k, v in nil.items() if any(v.values())]
    if nil_rows:
        payload["nil"] = {"inv": nil_rows}
    if hsn["b2b"] or hsn["b2c"]:
        payload["hsn"] = {"hsn_b2b": hsn_rows(hsn["b2b"]), "hsn_b2c": hsn_rows(hsn["b2c"])}
    di = doc_issue()
    if di["doc_det"]:
        payload["doc_issue"] = di

    b2cs_total = {"taxable_value": ZERO, **{k: ZERO for k in HEADS}}
    for v in b2cs.values():
        b2cs_total["taxable_value"] += v["txval"]
        b2cs_total["igst"] += v["iamt"]
        b2cs_total["cgst"] += v["camt"]
        b2cs_total["sgst"] += v["samt"]
        b2cs_total["cess"] += v["csamt"]
    totals["b2cs"].update(b2cs_total)
    if not b.gstin:
        issues.insert(0, {"level": "error", "message": "Business GSTIN is missing. Add it in Settings"})

    sections = []
    names = {"b2b": "B2B invoices (4A)", "b2ba": "B2B amendments (9A)", "b2cl": "B2C large (5)", "b2cla": "B2C large amendments (9A)",
             "b2cs": "B2C small (7)", "exp": "Exports (6A)", "cdnr": "Credit/debit notes, registered (9B)",
             "cdnra": "Note amendments (9C)", "cdnur": "Credit/debit notes, unregistered (9B)"}
    for k, label in names.items():
        if counts.get(k) or (k == "b2cs" and b2cs):
            sections.append({"key": k, "label": label, "count": counts.get(k, 0), **totals[k]})
    nil_tot = {f: sum((v[f] for v in nil.values()), ZERO) for f in ("expt_amt", "nil_amt", "ngsup_amt")}
    return {"period": key, "schema_version": SCHEMA_VERSION, "payload": payload, "sections": sections, "nil": nil_tot,
            "hsn": {"b2b": hsn_rows(hsn["b2b"]), "b2c": hsn_rows(hsn["b2c"])}, "issues": issues, "doc_count": len(docs)}


# ------------------------------------------------------------------------------------------- GSTR-3B
def set_off(liability: dict, credit: dict) -> dict:
    """Utilise ITC per section 49 / rule 88A. Returns ITC used per credit head, cash payable and closing credit."""
    liab = {k: Decimal(liability.get(k, 0)) for k in HEADS}
    cred = {k: Decimal(credit.get(k, 0)) for k in HEADS}
    used = {"igst": {"igst": Decimal(0), "cgst": Decimal(0), "sgst": Decimal(0)},
            "cgst": {"igst": Decimal(0), "cgst": Decimal(0), "sgst": Decimal(0)},
            "sgst": {"igst": Decimal(0), "cgst": Decimal(0), "sgst": Decimal(0)},
            "cess": {"cess": Decimal(0)}}
    order = {"igst": ("igst", "cgst", "sgst"), "cgst": ("cgst", "igst"), "sgst": ("sgst", "igst")}
    for src in ("igst", "cgst", "sgst"):
        for tgt in order[src]:
            amt = min(cred[src], liab[tgt])
            if amt > 0:
                used[src][tgt] += amt
                cred[src] -= amt
                liab[tgt] -= amt
    amt = min(cred["cess"], liab["cess"])
    used["cess"]["cess"] = amt
    cred["cess"] -= amt
    liab["cess"] -= amt
    return {"itc_used": used, "cash": liab, "balance": cred}


def _heads_of(lines, sign=1) -> dict:
    out = _z()
    for l in lines:
        for k in HEADS:
            out[k] += sign * getattr(l, k)
    return out


def _add(a: dict, b_: dict) -> dict:
    return {k: a.get(k, ZERO) + b_.get(k, ZERO) for k in set(a) | set(b_)}


def build_gstr3b(db: Session, b: Business, key: str, period: ReturnPeriod | None = None) -> dict:
    docs = sales_in(db, key)
    purchases = purchases_in(db, key)
    has_2b = db.scalar(select(Gstr2bEntry.id).where(Gstr2bEntry.period.in_(months_in(key))).limit(1)) is not None
    adjustments = list(db.scalars(select(ItcAdjustment).where(ItcAdjustment.period.in_(months_in(key) + [key]))))

    osup = {"txval": ZERO, **_z()}
    zero = {"txval": ZERO, **_z()}
    nil_ex = {"txval": ZERO}
    nongst = {"txval": ZERO}
    unreg: dict[str, dict] = defaultdict(lambda: {"txval": ZERO, "iamt": ZERO})
    rcm_out_note = ZERO
    entries = []
    for d in docs:
        entries.append((d, _sign(d)))
        if d.amends_id:  # report only the difference between the amended and the original document
            o = db.get(SalesDoc, d.amends_id)
            if o:
                entries.append((o, -_sign(o)))
    for d, s in entries:
        inter = d.is_export or d.place_of_supply != b.state_code
        for l in d.lines:
            if d.reverse_charge and l.supply_kind == "taxable":
                rcm_out_note += s * l.taxable_value
                continue
            if l.supply_kind == "taxable":
                osup["txval"] += s * l.taxable_value
                for k in HEADS:
                    osup[k] += s * getattr(l, k)
                if inter and not d.party_gstin:
                    unreg[d.place_of_supply]["txval"] += s * l.taxable_value
                    unreg[d.place_of_supply]["iamt"] += s * l.igst
            elif l.supply_kind == "zero_rated":
                zero["txval"] += s * l.taxable_value
                for k in HEADS:
                    zero[k] += s * getattr(l, k)
            elif l.supply_kind in ("nil", "exempt"):
                nil_ex["txval"] += s * l.taxable_value
            else:
                nongst["txval"] += s * l.taxable_value

    rcm_in = {"txval": ZERO, **_z()}
    itc_all_other = _z()
    itc_rcm = _z()
    inelig_17_5 = _z()
    deferred = _z()
    deferred_docs = []
    inward_exempt = {"inter": ZERO, "intra": ZERO}
    inward_nongst = {"inter": ZERO, "intra": ZERO}
    for p in purchases:
        s = _sign(p)
        inter = p.supplier_state_code != p.place_of_supply
        missing = has_2b and not p.reverse_charge and p.recon_status == "missing_in_2b"
        for l in p.lines:
            if l.supply_kind in ("exempt", "nil"):
                inward_exempt["inter" if inter else "intra"] += s * l.taxable_value
                continue
            if l.supply_kind == "non_gst":
                inward_nongst["inter" if inter else "intra"] += s * l.taxable_value
                continue
            tax = {k: s * getattr(l, k) for k in HEADS}
            if p.reverse_charge:
                rcm_in["txval"] += s * l.taxable_value
                rcm_in = _add(rcm_in, tax)
                if l.itc_eligible:
                    itc_rcm = _add(itc_rcm, tax)
                else:
                    inelig_17_5 = _add(inelig_17_5, tax)
                    itc_rcm = _add(itc_rcm, tax)
                continue
            if missing:
                deferred = _add(deferred, tax)
                continue
            itc_all_other = _add(itc_all_other, tax)
            if not l.itc_eligible:
                inelig_17_5 = _add(inelig_17_5, tax)
        if has_2b and p.recon_status == "missing_in_2b" and not p.reverse_charge:
            deferred_docs.append({"id": p.id, "number": p.number, "supplier": p.supplier_name})

    rev_rule = _z()
    rev_other = _z()
    reclaim = _z()
    for a in adjustments:
        t = {k: getattr(a, k) for k in HEADS}
        if a.kind == "reclaim":
            reclaim = _add(reclaim, t)
        elif a.rule in ("rule42", "rule43", "sec17_5", "rule38"):
            rev_rule = _add(rev_rule, t)
        else:
            rev_other = _add(rev_other, t)
    rev_4b1 = _add(inelig_17_5, rev_rule)
    itc_avl_total = _add(itc_rcm, itc_all_other)
    itc_net = {k: itc_avl_total[k] - rev_4b1[k] - rev_other[k] for k in HEADS}

    # 6.1 payment: RCM liability must be paid in cash; other liability can use ITC
    other_liab = {k: osup[k] + zero[k] for k in HEADS}
    so = set_off(other_liab, {k: max(itc_net[k], ZERO) for k in HEADS})
    cash = {k: so["cash"][k] + rcm_in[k] for k in HEADS}
    interest = period.interest if period else ZERO
    late_fee = period.late_fee if period else ZERO

    def tx(d):
        return {"txval": _n(d.get("txval", ZERO)), "iamt": _n(d["igst"]), "camt": _n(d["cgst"]), "samt": _n(d["sgst"]), "csamt": _n(d["cess"])}

    def tx4(d):
        return {"iamt": _n(d["igst"]), "camt": _n(d["cgst"]), "samt": _n(d["sgst"]), "csamt": _n(d["cess"])}

    zero4 = tx4(_z())
    payload = {
        "gstin": b.gstin, "ret_period": return_fp(key),
        "sup_details": {"osup_det": tx(osup), "osup_zero": {k: v for k, v in tx(zero).items() if k not in ("camt", "samt")},
                        "osup_nil_exmp": {"txval": _n(nil_ex["txval"])}, "isup_rev": tx(rcm_in),
                        "osup_nongst": {"txval": _n(nongst["txval"])}},
        "inter_sup": {"unreg_details": [{"pos": p_, "txval": _n(v["txval"]), "iamt": _n(v["iamt"])} for p_, v in sorted(unreg.items())],
                      "comp_details": [], "uin_details": []},
        "itc_elg": {
            "itc_avl": [{"ty": "IMPG", **zero4}, {"ty": "IMPS", **zero4}, {"ty": "ISRC", **tx4(itc_rcm)}, {"ty": "ISD", **zero4},
                        {"ty": "OTH", **tx4(itc_all_other)}],
            "itc_rev": [{"ty": "RUL", **tx4(rev_4b1)}, {"ty": "OTH", **tx4(rev_other)}],
            "itc_net": tx4(itc_net),
            "itc_inelg": [{"ty": "RUL", **tx4(reclaim)}, {"ty": "OTH", **zero4}],
        },
        "inward_sup": {"isup_details": [{"ty": "GST", "inter": _n(inward_exempt["inter"]), "intra": _n(inward_exempt["intra"])},
                                        {"ty": "NONGST", "inter": _n(inward_nongst["inter"]), "intra": _n(inward_nongst["intra"])}]},
        "intr_ltfee": {"intr_details": {"iamt": 0, "camt": 0, "samt": 0, "csamt": 0, "intr": _n(interest)},
                       "ltfee_details": {"cgst": _n(late_fee / 2), "sgst": _n(late_fee - late_fee / 2)}},
    }
    output_tax = sum((osup[k] + zero[k] + rcm_in[k] for k in HEADS), ZERO)
    net_itc = sum(itc_net.values(), ZERO)
    return {
        "period": key, "schema_version": SCHEMA_VERSION, "payload": payload, "has_2b": has_2b,
        "tables": {
            "3.1(a) Outward taxable supplies": {"txval": osup["txval"], **{k: osup[k] for k in HEADS}},
            "3.1(b) Zero rated supplies": {"txval": zero["txval"], **{k: zero[k] for k in HEADS}},
            "3.1(c) Nil rated and exempted": {"txval": nil_ex["txval"]},
            "3.1(d) Inward supplies on reverse charge": {"txval": rcm_in["txval"], **{k: rcm_in[k] for k in HEADS}},
            "3.1(e) Non-GST outward supplies": {"txval": nongst["txval"]},
            "4A(3) ITC on reverse charge inward": itc_rcm,
            "4A(5) All other ITC": itc_all_other,
            "4B(1) ITC reversed: rules 38, 42, 43 and section 17(5)": rev_4b1,
            "4B(2) ITC reversed: others": rev_other,
            "4C Net ITC available": itc_net,
            "4D(1) ITC reclaimed": reclaim,
            "5 Exempt, nil and non-GST inward (inter-state)": {"txval": inward_exempt["inter"] + inward_nongst["inter"]},
            "5 Exempt, nil and non-GST inward (intra-state)": {"txval": inward_exempt["intra"] + inward_nongst["intra"]},
        },
        "payment": {"liability": {k: other_liab[k] + rcm_in[k] for k in HEADS}, "rcm_cash": {k: rcm_in[k] for k in HEADS},
                    "itc_used": so["itc_used"], "cash": cash, "closing_credit": so["balance"],
                    "interest": interest, "late_fee": late_fee,
                    "cash_total": sum(cash.values(), ZERO) + interest + late_fee},
        "output_tax": output_tax, "eligible_itc": net_itc,
        "net_payable": sum(cash.values(), ZERO),
        "deferred_itc": deferred, "deferred_docs": deferred_docs,
        "notes": ([f"Outward supplies on which the customer pays tax (reverse charge): ₹{inr(money(rcm_out_note))} taxable, not in 3.1(a)"]
                  if rcm_out_note else []) + ([] if has_2b else ["GSTR-2B has not been imported for this period, so ITC is taken from your purchase records. Import 2B to confirm it"]),
    }


def compare_1_vs_3b(g1: dict, g3: dict) -> list[dict]:
    """Compare outward figures of GSTR-1 with 3.1 of GSTR-3B, by tax head."""
    out_1 = {"taxable_value": ZERO, **_z()}
    for s in g1["sections"]:
        if s["key"].endswith("a"):
            continue
        sign = 1
        for k in out_1:
            v = s.get(k, ZERO)
            if s["key"] in ("cdnr", "cdnur"):
                continue
            out_1[k] += sign * v
    # notes: count credit (-) and debit (+) from payload
    for grp in g1["payload"].get("cdnr", []):
        for nt in grp["nt"]:
            sgn = -1 if nt["ntty"] == "C" else 1
            for it in nt["itms"]:
                d = it["itm_det"]
                out_1["taxable_value"] += sgn * Decimal(str(d["txval"]))
                out_1["igst"] += sgn * Decimal(str(d["iamt"]))
                out_1["cgst"] += sgn * Decimal(str(d["camt"]))
                out_1["sgst"] += sgn * Decimal(str(d["samt"]))
                out_1["cess"] += sgn * Decimal(str(d["csamt"]))
    for nt in g1["payload"].get("cdnur", []):
        sgn = -1 if nt["ntty"] == "C" else 1
        for it in nt["itms"]:
            d = it["itm_det"]
            out_1["taxable_value"] += sgn * Decimal(str(d["txval"]))
            out_1["igst"] += sgn * Decimal(str(d["iamt"]))
            out_1["cess"] += sgn * Decimal(str(d["csamt"]))
    a = g3["tables"]["3.1(a) Outward taxable supplies"]
    z = g3["tables"]["3.1(b) Zero rated supplies"]
    rows = []
    for k, label in (("taxable_value", "Taxable value"), ("igst", "IGST"), ("cgst", "CGST"), ("sgst", "SGST"), ("cess", "Cess")):
        three = (a["txval"] + z["txval"]) if k == "taxable_value" else (a[k] + z[k])
        one = money(out_1[k])
        rows.append({"head": label, "gstr1": one, "gstr3b": money(three), "difference": money(one - three)})
    return rows
