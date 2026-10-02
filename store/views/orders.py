"""Checkout quote, payment, placing / cancelling / returning orders."""
import re
import secrets
from datetime import datetime, timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import F
from django.db.models.functions import Greatest
from django.utils import timezone

from ..models import Address, CartItem, Order, OrderItem, Product
from ..pricing import quote
from ..utils import HttpError, audit, body, login_required, methods, ms, ok, v_int, v_str

STORE = settings.STORE
COUPON_RE = r'[A-Za-z0-9]+'


# ---------- Payment (mock gateway: validates input, never stores full card data) ----------
def luhn(num):
    total, dbl = 0, False
    for ch in reversed(num):
        d = int(ch)
        if dbl:
            d *= 2
            if d > 9:
                d -= 9
        total += d
        dbl = not dbl
    return total % 10 == 0


def process_payment(method, payment, total):
    payment = payment if isinstance(payment, dict) else {}
    if method == 'cod':
        if total > STORE['COD_MAX_ORDER']:
            raise HttpError(400, 'Cash on Delivery is not available for orders above ₹50,000.')
        return 'pending', None
    if method == 'card':
        number = re.sub(r'[\s-]', '', str(payment.get('cardNumber', '')))
        expiry = str(payment.get('expiry', ''))
        cvv = str(payment.get('cvv', ''))
        if not re.fullmatch(r'\d{12,19}', number) or not luhn(number):
            raise HttpError(400, 'Please enter a valid card number.')
        m = re.fullmatch(r'(0[1-9]|1[0-2])/(\d{2})', expiry)
        if not m:
            raise HttpError(400, 'Card expiry must be in MM/YY format.')
        month, year = int(m.group(1)), 2000 + int(m.group(2))
        exp_end = datetime(year + (month == 12), month % 12 + 1, 1, tzinfo=timezone.get_current_timezone())
        if exp_end <= timezone.now():
            raise HttpError(400, 'This card has expired.')
        if not re.fullmatch(r'\d{3,4}', cvv):
            raise HttpError(400, 'Please enter a valid CVV.')
        # Only a masked reference is kept. In production, use a PCI-DSS compliant gateway
        # (Razorpay / PayU / Stripe) with client-side tokenisation so card data never reaches this server.
        return 'paid', f'CARD-xxxx{number[-4:]}-{secrets.token_hex(4).upper()}'
    if method == 'upi':
        vpa = str(payment.get('upiId', ''))
        if not re.fullmatch(r'[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}', vpa):
            raise HttpError(400, 'Please enter a valid UPI ID (e.g. name@bank).')
        return 'paid', f'UPI-{secrets.token_hex(5).upper()}'
    raise HttpError(400, 'Please choose a payment method.')


def new_order_no():
    return f"BZ{timezone.localdate():%Y%m%d}-{secrets.randbelow(9_000_000) + 1_000_000}"


def read_coupon(d):
    return v_str(d.get('coupon'), 'Coupon code', max_len=20, pattern=COUPON_RE) if d.get('coupon') else None


def order_summary(o):
    return {
        'id': o.id, 'order_no': o.order_no, 'status': o.status, 'total': o.total,
        'payment_method': o.payment_method, 'payment_status': o.payment_status,
        'created_at': ms(o.created_at), 'delivered_at': ms(o.delivered_at),
        'items': [{'product_id': i.product_id, 'title': i.title, 'emoji': i.emoji, 'price': i.price, 'qty': i.qty}
                  for i in o.items.all()],
    }


def order_detail(o):
    data = order_summary(o)
    data.update(subtotal=o.subtotal, discount=o.discount, shipping=o.shipping, coupon_code=o.coupon_code,
                payment_ref=o.payment_ref, address=o.address)
    return data


def restock(order):
    for it in order.items.all():
        Product.objects.filter(id=it.product_id).update(
            stock=F('stock') + it.qty, sold_count=Greatest(F('sold_count') - it.qty, 0))


@methods('POST')
@login_required
def checkout_quote(request):
    d = body(request)
    return ok(quote(request.user, read_coupon(d), d.get('paymentMethod')))


@methods('GET', 'POST')
@login_required
def orders(request):
    if request.method == 'GET':
        qs = Order.objects.filter(user=request.user).prefetch_related('items')[:100]
        return ok({'orders': [order_summary(o) for o in qs]})
    return place_order(request)


def place_order(request):
    d = body(request)
    address_id = v_int(d.get('addressId'), 'Delivery address', 1)
    method = str(d.get('paymentMethod') or '')
    coupon = read_coupon(d)
    idem = (v_str(d.get('idempotencyKey'), 'Idempotency key', 8, 64, r'[A-Za-z0-9-]+')
            if d.get('idempotencyKey') else None)

    # Double-click / retry protection: the same key returns the order already placed.
    if idem:
        prior = Order.objects.filter(user=request.user, idempotency_key=idem).first()
        if prior:
            return ok({'orderId': prior.id, 'orderNo': prior.order_no, 'duplicate': True})

    address = Address.objects.filter(id=address_id, user=request.user).first()
    if not address:
        raise HttpError(400, 'Please choose a delivery address.')

    try:
        with transaction.atomic():
            q = quote(request.user, coupon, method)
            if not q['lines']:
                raise HttpError(400, 'Your bag is empty.')
            for l in q['lines']:
                if not l['active']:
                    raise HttpError(409, f'"{l["title"]}" is no longer available. Please remove it from your bag.')
                if l['qty'] > l['stock']:
                    raise HttpError(409, f'Only {l["stock"]} unit(s) of "{l["title"]}" left. Please update your bag.')
            pay_status, pay_ref = process_payment(method, d.get('payment'), q['total'])
            order = Order.objects.create(
                order_no=new_order_no(), user=request.user, status='placed', subtotal=q['subtotal'],
                discount=q['discount'], shipping=q['shipping'] + q['codFee'], total=q['total'],
                coupon_code=q['coupon'], payment_method=method, payment_status=pay_status, payment_ref=pay_ref,
                address={'fullName': address.full_name, 'phone': address.phone, 'line1': address.line1,
                         'line2': address.line2, 'city': address.city, 'state': address.state,
                         'pincode': address.pincode},
                idempotency_key=idem,
            )
            for l in q['lines']:
                OrderItem.objects.create(order=order, product_id=l['product_id'], title=l['title'],
                                         emoji=l['emoji'], price=l['price'], qty=l['qty'])
                # Conditional decrement guards against overselling under concurrency.
                updated = Product.objects.filter(id=l['product_id'], stock__gte=l['qty']).update(
                    stock=F('stock') - l['qty'], sold_count=F('sold_count') + l['qty'])
                if updated != 1:
                    raise HttpError(409, f'"{l["title"]}" just went out of stock.')
            CartItem.objects.filter(user=request.user, saved_for_later=False).delete()
    except IntegrityError:
        prior = Order.objects.filter(user=request.user, idempotency_key=idem).first() if idem else None
        if prior:
            return ok({'orderId': prior.id, 'orderNo': prior.order_no, 'duplicate': True})
        raise
    result = {'orderId': order.id, 'orderNo': order.order_no, 'total': order.total}
    audit(request, 'order.place', result)
    return ok(result, status=201)


def own_order(request, oid):
    o = Order.objects.filter(id=oid, user=request.user).prefetch_related('items').first()
    if not o:
        raise HttpError(404, 'Order not found.')
    return o


@methods('GET')
@login_required
def order_view(request, oid):
    return ok({'order': order_detail(own_order(request, oid))})


@methods('POST')
@login_required
def order_cancel(request, oid):
    with transaction.atomic():
        o = own_order(request, oid)
        if o.status not in ('placed', 'packed'):
            raise HttpError(400, 'This order can no longer be cancelled.')
        o.status = 'cancelled'
        if o.payment_status == 'paid':
            o.payment_status = 'refunded'
        o.save()
        restock(o)
    audit(request, 'order.cancel', {'orderId': oid})
    return ok({'order': order_detail(own_order(request, oid))})


@methods('POST')
@login_required
def order_return(request, oid):
    o = own_order(request, oid)
    if o.status != 'delivered':
        raise HttpError(400, 'Only delivered orders can be returned.')
    if o.delivered_at and timezone.now() - o.delivered_at > timedelta(days=STORE['RETURN_WINDOW_DAYS']):
        raise HttpError(400, f'The {STORE["RETURN_WINDOW_DAYS"]}-day return window for this order has closed.')
    o.status = 'return_requested'
    o.save()
    audit(request, 'order.return_request', {'orderId': oid})
    return ok({'order': order_detail(o)})
