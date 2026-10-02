"""Bazaario Studio (store admin) API: dashboard, catalog, fulfilment, customers, coupons, audit."""
import json

from django.db import transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone

from ..models import AuditLog, Category, Coupon, Order, Product, User
from ..utils import HttpError, admin_required, audit, body, methods, ms, ok, v_int, v_str
from .orders import order_detail, restock

# Order fulfilment state machine.
TRANSITIONS = {
    'placed': ['packed', 'cancelled'],
    'packed': ['shipped', 'cancelled'],
    'shipped': ['delivered'],
    'delivered': [],
    'return_requested': ['returned', 'delivered'],
    'returned': [],
    'cancelled': [],
}


@methods('GET')
@admin_required
def stats(request):
    return ok({
        'revenue': Order.objects.exclude(status__in=['cancelled', 'returned']).aggregate(n=Sum('total'))['n'] or 0,
        'orders': Order.objects.count(),
        'pending': Order.objects.filter(status__in=['placed', 'packed', 'shipped', 'return_requested']).count(),
        'customers': User.objects.filter(is_staff=False).count(),
        'products': Product.objects.filter(active=True).count(),
        'lowStock': list(Product.objects.filter(active=True, stock__lt=20).order_by('stock')
                         .values('id', 'title', 'stock')[:10]),
    })


def read_product(d):
    price = v_int(d.get('price'), 'Price (₹)', 1, 10_000_000)
    mrp = v_int(d.get('mrp'), 'MRP (₹)', 1, 10_000_000)
    if price > mrp:
        raise HttpError(400, 'Selling price cannot be higher than MRP.')
    category_id = v_int(d.get('categoryId'), 'Category', 1)
    if not Category.objects.filter(id=category_id).exists():
        raise HttpError(400, 'Unknown category.')
    feats = d.get('features')
    feats = feats if isinstance(feats, list) else str(feats or '').split('\n')
    return {
        'title': v_str(d.get('title'), 'Title', 3, 200),
        'brand': v_str(d.get('brand'), 'Brand', 1, 60),
        'category_id': category_id,
        'description': v_str(d.get('description'), 'Description', max_len=4000, optional=True),
        'features': [str(f).strip()[:200] for f in feats if str(f).strip()][:15],
        'price': price * 100,
        'mrp': mrp * 100,
        'stock': v_int(d.get('stock'), 'Stock', 0, 1_000_000),
        'emoji': v_str(d.get('emoji'), 'Image placeholder', max_len=8, optional=True) or '📦',
        'color': v_str(d.get('color'), 'Colour', pattern=r'#[0-9a-fA-F]{6}', optional=True) or '#e3e6e6',
        'express': bool(d.get('express')),
        'is_deal': bool(d.get('isDeal')),
        'active': d.get('active') is not False,
    }


def admin_product(p):
    return {
        'id': p.id, 'title': p.title, 'brand': p.brand, 'category_id': p.category_id,
        'category_name': p.category.name, 'description': p.description, 'features': p.features,
        'price': p.price, 'mrp': p.mrp, 'stock': p.stock, 'emoji': p.emoji, 'color': p.color,
        'express': p.express, 'is_deal': p.is_deal, 'active': p.active,
        'rating_avg': p.rating_avg, 'rating_count': p.rating_count,
    }


@methods('GET', 'POST')
@admin_required
def products(request):
    if request.method == 'GET':
        q = request.GET.get('q', '')[:60]
        qs = Product.objects.select_related('category').order_by('-id')
        if q:
            qs = qs.filter(Q(title__icontains=q) | Q(brand__icontains=q))
        return ok({'products': [admin_product(p) for p in qs[:200]]})
    p = Product.objects.create(**read_product(body(request)))
    audit(request, 'admin.product_create', {'productId': p.id})
    return ok({'id': p.id}, status=201)


@methods('PUT', 'DELETE')
@admin_required
def product_detail(request, pid):
    if request.method == 'DELETE':
        # Soft delete keeps order history intact.
        Product.objects.filter(id=pid).update(active=False)
        audit(request, 'admin.product_deactivate', {'productId': pid})
        return ok()
    fields = read_product(body(request))
    if not Product.objects.filter(id=pid).update(**fields):
        raise HttpError(404, 'Product not found.')
    audit(request, 'admin.product_update', {'productId': pid})
    return ok()


@methods('GET')
@admin_required
def orders(request):
    status = request.GET.get('status')
    qs = Order.objects.select_related('user')
    if status in TRANSITIONS:
        qs = qs.filter(status=status)
    rows = [{
        'id': o.id, 'order_no': o.order_no, 'status': o.status, 'total': o.total,
        'payment_method': o.payment_method, 'payment_status': o.payment_status,
        'created_at': ms(o.created_at), 'customer': o.user.name, 'email': o.user.email,
    } for o in qs[:200]]
    return ok({'orders': rows, 'transitions': TRANSITIONS})


@methods('GET', 'PATCH')
@admin_required
def order_detail_view(request, oid):
    if request.method == 'PATCH':
        nxt = str(body(request).get('status') or '')
        with transaction.atomic():
            o = Order.objects.select_for_update().filter(id=oid).first()
            if not o:
                raise HttpError(404, 'Order not found.')
            if nxt not in TRANSITIONS[o.status]:
                raise HttpError(400, f'Cannot move an order from "{o.status}" to "{nxt}".')
            if nxt == 'delivered' and o.payment_method == 'cod':
                o.payment_status = 'paid'
            if nxt in ('cancelled', 'returned') and o.payment_status == 'paid':
                o.payment_status = 'refunded'
            if nxt == 'delivered' and not o.delivered_at:
                o.delivered_at = timezone.now()
            o.status = nxt
            o.save()
            if nxt in ('cancelled', 'returned'):
                restock(o)
        audit(request, 'admin.order_status', {'orderId': oid, 'status': nxt})
    o = Order.objects.filter(id=oid).prefetch_related('items').first()
    if not o:
        raise HttpError(404, 'Order not found.')
    return ok({'order': order_detail(o), 'transitions': TRANSITIONS})


@methods('GET')
@admin_required
def users(request):
    rows = [{
        'id': u.id, 'name': u.name, 'email': u.email, 'phone': u.phone, 'role': u.role,
        'created_at': ms(u.date_joined), 'locked_until': ms(u.locked_until) or 0, 'orders': u.n_orders,
    } for u in User.objects.annotate(n_orders=Count('orders')).order_by('-id')[:200]]
    return ok({'users': rows})


@methods('GET', 'POST')
@admin_required
def coupons(request):
    if request.method == 'GET':
        return ok({'coupons': list(Coupon.objects.values(
            'code', 'kind', 'value', 'max_discount', 'min_order', 'active', 'description'))})
    d = body(request)
    code = v_str(d.get('code'), 'Code', 3, 20, r'[A-Za-z0-9]+').upper()
    kind = 'flat' if d.get('kind') == 'flat' else 'percent'
    value = (v_int(d.get('value'), 'Percent', 1, 90) if kind == 'percent'
             else v_int(d.get('value'), 'Amount (₹)', 1, 100000) * 100)
    max_d = v_int(d.get('maxDiscount'), 'Max discount (₹)', 1, 100000, optional=True)
    min_o = v_int(d.get('minOrder'), 'Minimum order (₹)', 0, 1_000_000, optional=True, default=0)
    Coupon.objects.update_or_create(code=code, defaults={
        'kind': kind, 'value': value, 'max_discount': max_d * 100 if max_d else None, 'min_order': min_o * 100,
        'description': v_str(d.get('description'), 'Description', max_len=200, optional=True), 'active': True,
    })
    audit(request, 'admin.coupon_upsert', {'code': code})
    return ok(status=201)


@methods('DELETE')
@admin_required
def coupon_detail(request, code):
    Coupon.objects.filter(code__iexact=code[:20]).update(active=False)
    audit(request, 'admin.coupon_disable', {'code': code[:20]})
    return ok()


@methods('GET')
@admin_required
def audit_log(request):
    rows = [{
        'id': a.id, 'action': a.action, 'detail': json.dumps(a.detail) if a.detail is not None else None,
        'ip': a.ip, 'created_at': ms(a.created_at), 'email': a.user.email if a.user else None,
    } for a in AuditLog.objects.select_related('user')[:200]]
    return ok({'entries': rows})
