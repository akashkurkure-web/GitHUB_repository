"""Server-side source of truth for bag totals. Client-sent prices are never trusted."""
from django.conf import settings

from .models import CartItem, Coupon
from .utils import HttpError

STORE = settings.STORE


def cart_lines(user):
    items = (CartItem.objects.filter(user=user, saved_for_later=False)
             .select_related('product').order_by('-added_at'))
    return [{
        'product_id': c.product_id, 'qty': c.qty, 'title': c.product.title, 'price': c.product.price,
        'mrp': c.product.mrp, 'stock': c.product.stock, 'emoji': c.product.emoji, 'color': c.product.color,
        'active': c.product.active, 'express': c.product.express,
    } for c in items]


def coupon_discount(code, subtotal):
    if not code:
        return 0, None
    c = Coupon.objects.filter(code__iexact=str(code).strip(), active=True).first()
    if not c:
        raise HttpError(400, 'This coupon code is not valid.')
    if subtotal < c.min_order:
        raise HttpError(400, f'Add items worth ₹{(c.min_order - subtotal) / 100:.2f} more to use {c.code}.')
    discount = subtotal * c.value // 100 if c.kind == Coupon.PERCENT else c.value
    if c.max_discount:
        discount = min(discount, c.max_discount)
    return min(discount, subtotal), c.code.upper()


def quote(user, coupon=None, payment_method=None):
    lines = cart_lines(user)
    subtotal = sum(l['price'] * l['qty'] for l in lines)
    mrp_total = sum(l['mrp'] * l['qty'] for l in lines)
    discount, code = coupon_discount(coupon, subtotal)
    shipping = 0 if subtotal == 0 or subtotal >= STORE['FREE_SHIPPING_THRESHOLD'] else STORE['SHIPPING_FEE']
    cod_fee = STORE['COD_FEE'] if payment_method == 'cod' else 0
    total = subtotal - discount + shipping + cod_fee
    return {
        'lines': lines, 'subtotal': subtotal, 'mrpTotal': mrp_total, 'savings': mrp_total - subtotal + discount,
        'discount': discount, 'coupon': code, 'shipping': shipping, 'codFee': cod_fee, 'total': total,
    }
