"""Bag (cart), save-for-later, guest-bag merge, wishlist and address book."""
from django.conf import settings
from django.db import transaction

from ..models import Address, CartItem, Product, WishlistItem
from ..pricing import quote
from ..utils import HttpError, body, login_required, methods, ok, v_int, v_phone, v_pincode, v_str

STORE = settings.STORE
MAX_QTY = STORE['MAX_QTY_PER_ITEM']


def cart_view(user, coupon=None):
    q = quote(user, coupon)
    saved = [{
        'product_id': c.product_id, 'qty': c.qty, 'title': c.product.title, 'price': c.product.price,
        'mrp': c.product.mrp, 'stock': c.product.stock, 'emoji': c.product.emoji, 'color': c.product.color,
    } for c in CartItem.objects.filter(user=user, saved_for_later=True).select_related('product')]
    return {**q, 'saved': saved, 'count': sum(l['qty'] for l in q['lines']),
            'freeShippingThreshold': STORE['FREE_SHIPPING_THRESHOLD']}


def active_product(pid):
    p = Product.objects.filter(id=pid, active=True).first()
    if not p:
        raise HttpError(404, 'Product not found.')
    return p


@methods('GET', 'POST')
@login_required
def cart(request):
    if request.method == 'GET':
        return ok(cart_view(request.user))
    d = body(request)
    pid = v_int(d.get('productId'), 'Product', 1)
    qty = v_int(d.get('qty'), 'Quantity', 1, MAX_QTY, optional=True, default=1)
    p = active_product(pid)
    item = CartItem.objects.filter(user=request.user, product=p).first()
    new_qty = (item.qty if item else 0) + qty
    if new_qty > MAX_QTY:
        raise HttpError(400, f'You can buy at most {MAX_QTY} units of this item.')
    if new_qty > p.stock:
        raise HttpError(400, f'Only {p.stock} left in stock.' if p.stock else 'This item is currently out of stock.')
    CartItem.objects.update_or_create(user=request.user, product=p,
                                      defaults={'qty': new_qty, 'saved_for_later': False})
    return ok(cart_view(request.user), status=201)


@methods('PATCH', 'DELETE')
@login_required
def cart_item(request, pid):
    if request.method == 'DELETE':
        CartItem.objects.filter(user=request.user, product_id=pid).delete()
        return ok(cart_view(request.user))
    item = CartItem.objects.filter(user=request.user, product_id=pid).select_related('product').first()
    if not item:
        raise HttpError(404, 'Item is not in your bag.')
    d = body(request)
    if 'savedForLater' in d:
        item.saved_for_later = bool(d['savedForLater'])
    if 'qty' in d:
        qty = v_int(d['qty'], 'Quantity', 1, MAX_QTY)
        p = active_product(pid)
        if qty > p.stock:
            raise HttpError(400, f'Only {p.stock} left in stock.')
        item.qty = qty
    item.save()
    return ok(cart_view(request.user))


@methods('POST')
@login_required
def cart_merge(request):
    """Merge the guest (signed-out) bag into the account after sign-in."""
    items = body(request).get('items')
    for it in (items if isinstance(items, list) else [])[:50]:
        if not isinstance(it, dict):
            continue
        try:
            pid, qty = int(it.get('productId')), int(it.get('qty'))
        except (TypeError, ValueError):
            continue
        if qty < 1:
            continue
        p = Product.objects.filter(id=pid, active=True, stock__gt=0).first()
        if not p:
            continue
        cap = min(p.stock, MAX_QTY)
        existing = CartItem.objects.filter(user=request.user, product=p).first()
        merged = min(cap, max(existing.qty if existing else 0, qty))
        CartItem.objects.update_or_create(user=request.user, product=p, defaults={'qty': merged})
    return ok(cart_view(request.user))


@methods('POST')
@login_required
def cart_coupon(request):
    code = v_str(body(request).get('code'), 'Coupon code', 3, 20, r'[A-Za-z0-9]+')
    return ok(cart_view(request.user, code))


# ---------------- Wishlist ----------------
@methods('GET', 'POST')
@login_required
def wishlist(request):
    if request.method == 'GET':
        items = [{
            'id': w.product.id, 'title': w.product.title, 'brand': w.product.brand, 'price': w.product.price,
            'mrp': w.product.mrp, 'stock': w.product.stock, 'rating_avg': w.product.rating_avg,
            'rating_count': w.product.rating_count, 'emoji': w.product.emoji, 'color': w.product.color,
            'express': w.product.express, 'is_deal': w.product.is_deal,
        } for w in WishlistItem.objects.filter(user=request.user, product__active=True).select_related('product')]
        return ok({'items': items})
    p = active_product(v_int(body(request).get('productId'), 'Product', 1))
    WishlistItem.objects.get_or_create(user=request.user, product=p)
    return ok(status=201)


@methods('DELETE')
@login_required
def wishlist_item(request, pid):
    WishlistItem.objects.filter(user=request.user, product_id=pid).delete()
    return ok()


# ---------------- Addresses ----------------
INDIAN_STATES = [
    'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
    'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
    'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
    'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
    'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
]
ADDRESS_FIELDS = ('id', 'full_name', 'phone', 'line1', 'line2', 'city', 'state', 'pincode', 'is_default')


def read_address(d):
    state = v_str(d.get('state'), 'State', max_len=60)
    if state not in INDIAN_STATES:
        raise HttpError(400, 'Please choose a valid state.')
    return {
        'full_name': v_str(d.get('fullName'), 'Full name', 2, 60),
        'phone': v_phone(d.get('phone')),
        'line1': v_str(d.get('line1'), 'Address line 1', 3, 120),
        'line2': v_str(d.get('line2'), 'Address line 2', max_len=120, optional=True),
        'city': v_str(d.get('city'), 'City', 2, 60),
        'state': state,
        'pincode': v_pincode(d.get('pincode')),
    }


@methods('GET')
@login_required
def states(request):
    return ok({'states': INDIAN_STATES})


@methods('GET', 'POST')
@login_required
def addresses(request):
    mine = Address.objects.filter(user=request.user)
    if request.method == 'GET':
        return ok({'addresses': list(mine.values(*ADDRESS_FIELDS))})
    d = body(request)
    fields = read_address(d)
    if mine.count() >= 20:
        raise HttpError(400, 'You can save up to 20 addresses.')
    make_default = not mine.exists() or bool(d.get('isDefault'))
    with transaction.atomic():
        if make_default:
            mine.update(is_default=False)
        a = Address.objects.create(user=request.user, is_default=make_default, **fields)
    return ok({'id': a.id}, status=201)


@methods('PUT', 'DELETE')
@login_required
def address_detail(request, aid):
    # Ownership enforced in every query (prevents IDOR).
    mine = Address.objects.filter(user=request.user)
    if request.method == 'DELETE':
        mine.filter(id=aid).delete()
        return ok()
    d = body(request)
    fields = read_address(d)
    with transaction.atomic():
        a = mine.filter(id=aid).first()
        if not a:
            raise HttpError(404, 'Address not found.')
        if d.get('isDefault'):
            mine.update(is_default=False)
            fields['is_default'] = True
        for k, val in fields.items():
            setattr(a, k, val)
        a.save()
    return ok()
