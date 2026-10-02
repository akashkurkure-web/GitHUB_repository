"""Categories, product search with facets, product detail and reviews."""
import math

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Count, F, Q

from ..models import Category, Product, Review
from ..utils import HttpError, audit, body, login_required, methods, ok, product_card, ms, v_int, v_str

STORE = settings.STORE

SORTS = {
    'relevance': ['-is_deal', '-sold_count'],
    'price-asc': ['price'],
    'price-desc': ['-price'],
    'rating': ['-rating_avg', '-rating_count'],
    'newest': ['-created_at'],
}


@methods('GET')
def config(request):
    return ok({
        'storeName': STORE['NAME'],
        'freeShippingThreshold': STORE['FREE_SHIPPING_THRESHOLD'],
        'shippingFee': STORE['SHIPPING_FEE'],
        'maxQtyPerItem': STORE['MAX_QTY_PER_ITEM'],
        'returnWindowDays': STORE['RETURN_WINDOW_DAYS'],
    })


@methods('GET')
def health(request):
    return ok({'status': 'ok'})


@methods('GET')
def categories(request):
    return ok({'categories': list(Category.objects.values('id', 'slug', 'name', 'icon'))})


@methods('GET')
def products(request):
    g = request.GET
    q = g.get('q', '').strip()[:100]
    category = g.get('category', '')[:50]
    brands = [b for b in g.get('brand', '').split(',') if b][:20]
    sort = g.get('sort') if g.get('sort') in SORTS or g.get('sort') == 'discount' else 'relevance'
    min_price = v_int(g.get('min'), 'min', 0, 10_000_000, optional=True)
    max_price = v_int(g.get('max'), 'max', 0, 10_000_000, optional=True)
    min_rating = v_int(g.get('rating'), 'rating', 1, 4, optional=True)
    page = v_int(g.get('page'), 'page', 1, 1000, optional=True, default=1)
    page_size = v_int(g.get('limit'), 'limit', 1, 48, optional=True, default=12)

    qs = Product.objects.filter(active=True).select_related('category')
    for word in q.split()[:6]:
        qs = qs.filter(Q(title__icontains=word) | Q(brand__icontains=word) | Q(category__name__icontains=word))
    if category:
        qs = qs.filter(category__slug=category)
    if min_price is not None:
        qs = qs.filter(price__gte=min_price * 100)
    if max_price is not None:
        qs = qs.filter(price__lte=max_price * 100)
    if min_rating is not None:
        qs = qs.filter(rating_avg__gte=min_rating)
    if g.get('express') == '1':
        qs = qs.filter(express=True)
    if g.get('deals') == '1':
        qs = qs.filter(is_deal=True)
    if g.get('instock') == '1':
        qs = qs.filter(stock__gt=0)

    # Brand facet: same filters minus the brand filter itself.
    brand_facet = list(qs.values('brand').annotate(n=Count('id')).order_by('-n', 'brand')[:15])
    if brands:
        qs = qs.filter(brand__in=brands)

    if sort == 'discount':
        qs = qs.annotate(off=(F('mrp') - F('price')) * 1.0 / F('mrp')).order_by('-off')
    else:
        qs = qs.order_by(*SORTS[sort], 'id')
    total = qs.count()
    items = [product_card(p) for p in qs[(page - 1) * page_size: page * page_size]]
    return ok({'items': items, 'total': total, 'page': page, 'pageSize': page_size,
               'pages': max(1, math.ceil(total / page_size)), 'brands': brand_facet})


@methods('GET')
def suggest(request):
    q = request.GET.get('q', '').strip()[:60]
    if len(q) < 2:
        return ok({'suggestions': []})
    rows = (Product.objects.filter(active=True).filter(Q(title__icontains=q) | Q(brand__icontains=q))
            .order_by('-sold_count').values('id', 'title')[:8])
    return ok({'suggestions': list(rows)})


@methods('GET')
def product_detail(request, pid):
    p = Product.objects.select_related('category').filter(id=pid, active=True).first()
    if not p:
        raise HttpError(404, 'Product not found.')
    data = product_card(p)
    data.update(description=p.description, features=p.features)
    dist = list(Review.objects.filter(product=p).values('rating').annotate(n=Count('id')).order_by())
    reviews = [{
        'id': r.id, 'rating': r.rating, 'title': r.title, 'body': r.body, 'verified': r.verified,
        'created_at': ms(r.created_at), 'author': r.user.name,
    } for r in Review.objects.filter(product=p).select_related('user')[:20]]
    related = [product_card(r) for r in Product.objects.filter(category=p.category, active=True)
               .exclude(id=p.id).select_related('category').order_by('-sold_count')[:6]]
    can_review = (request.user.is_authenticated
                  and not Review.objects.filter(product=p, user=request.user).exists())
    return ok({'product': data, 'reviews': reviews, 'ratingDistribution': dist, 'related': related,
               'canReview': can_review})


@methods('POST')
@login_required
def create_review(request, pid):
    d = body(request)
    rating = v_int(d.get('rating'), 'Rating', 1, 5)
    title = v_str(d.get('title'), 'Review title', 3, 100)
    text = v_str(d.get('body'), 'Review', 10, 2000)
    if not Product.objects.filter(id=pid, active=True).exists():
        raise HttpError(404, 'Product not found.')
    # "Verified buyer" only when this customer has received the product.
    verified = request.user.orders.filter(
        items__product_id=pid, status__in=['delivered', 'return_requested', 'returned']).exists()
    try:
        with transaction.atomic():
            Review.objects.create(product_id=pid, user=request.user, rating=rating, title=title, body=text,
                                  verified=verified)
            p = Product.objects.select_for_update().get(id=pid)
            count = p.rating_count + 1
            p.rating_avg = round((p.rating_avg * p.rating_count + rating) / count, 1)
            p.rating_count = count
            p.save(update_fields=['rating_avg', 'rating_count'])
    except IntegrityError:
        raise HttpError(409, 'You have already reviewed this product.')
    audit(request, 'review.create', {'productId': pid})
    return ok({'ok': True, 'verified': verified}, status=201)

