"""Money rules in one place: commission, GST split and advance."""
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal

from django.conf import settings

PAISA = Decimal("0.01")


def _pct(name):
    return Decimal(str(getattr(settings, name)))


def selling_price(vendor_price):
    """Vendor price plus our commission, rounded up to the next whole rupee."""
    if vendor_price is None:
        return None
    raw = Decimal(vendor_price) * (1 + _pct("COMMISSION_PERCENT") / 100)
    return raw.quantize(Decimal("1"), rounding=ROUND_CEILING)


def _plain(d):
    """18.00 -> '18', 2.50 -> '2.5' (never scientific notation)."""
    text = f"{Decimal(d):f}"
    return text.rstrip("0").rstrip(".") if "." in text else text


def gst_split(taxable, ship_state, rate=None):
    """GST on a taxable amount: CGST + SGST inside our state, IGST for other states."""
    rate = Decimal(str(rate if rate is not None else settings.GST_PERCENT))
    taxable = Decimal(taxable or 0)
    total_tax = (taxable * rate / 100).quantize(PAISA, rounding=ROUND_HALF_UP)
    if not ship_state or ship_state == settings.HOME_STATE:
        half = (total_tax / 2).quantize(PAISA, rounding=ROUND_HALF_UP)
        return {"intra": True, "rate": rate, "half_rate": _plain(rate / 2), "cgst": half, "sgst": total_tax - half, "igst": Decimal("0"),
                "tax": total_tax}
    return {"intra": False, "rate": _plain(rate), "cgst": Decimal("0"), "sgst": Decimal("0"), "igst": total_tax,
            "tax": total_tax}


def advance_required(total):
    """Amount the customer must pay before production starts."""
    total = Decimal(total or 0)
    if total >= _pct("ADVANCE_THRESHOLD"):
        return (total * _pct("ADVANCE_PERCENT") / 100).quantize(Decimal("1"), rounding=ROUND_CEILING)
    return total
