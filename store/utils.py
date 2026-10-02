"""Shared helpers: JSON I/O, validation, rate limiting, audit logging and serialisation."""
import functools
import json
import re

from django.conf import settings
from django.core.cache import cache
from django.http import JsonResponse

from .models import AuditLog

STORE = settings.STORE


class HttpError(Exception):
    """Raise anywhere in a view to return {"error": message} with the given status."""

    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def ok(data=None, status=200):
    return JsonResponse(data if data is not None else {'ok': True}, status=status, json_dumps_params={'ensure_ascii': False})


def body(request):
    """Parsed JSON body (always a dict)."""
    if not request.body:
        return {}
    try:
        data = json.loads(request.body)
    except (ValueError, UnicodeDecodeError):
        raise HttpError(400, 'Malformed request.')
    if not isinstance(data, dict):
        raise HttpError(400, 'Malformed request.')
    return data


def methods(*allowed):
    """Restrict a view to the given HTTP methods (JSON 405 otherwise)."""
    def deco(fn):
        @functools.wraps(fn)
        def wrapper(request, *a, **kw):
            if request.method not in allowed:
                raise HttpError(405, 'Method not allowed.')
            return fn(request, *a, **kw)
        return wrapper
    return deco


def login_required(fn):
    @functools.wraps(fn)
    def wrapper(request, *a, **kw):
        if not request.user.is_authenticated:
            raise HttpError(401, 'Please sign in to continue.')
        return fn(request, *a, **kw)
    return wrapper


def admin_required(fn):
    @functools.wraps(fn)
    def wrapper(request, *a, **kw):
        if not request.user.is_authenticated:
            raise HttpError(401, 'Please sign in to continue.')
        if not request.user.is_staff:
            raise HttpError(403, 'You do not have access to this area.')
        return fn(request, *a, **kw)
    return wrapper


# ---------------- Client IP & rate limiting ----------------
def client_ip(request):
    if settings.TRUST_PROXY:
        fwd = request.META.get('HTTP_X_FORWARDED_FOR', '')
        if fwd:
            return fwd.split(',')[0].strip()[:64]
    return request.META.get('REMOTE_ADDR', '')[:64]


def hit_rate_limit(bucket, key, limit, window):
    """Fixed-window counter in the cache. Returns True when the limit is exceeded."""
    cache_key = f'rl:{bucket}:{key}'
    added = cache.add(cache_key, 1, window)
    if added:
        return False
    try:
        count = cache.incr(cache_key)
    except ValueError:  # expired between add and incr
        cache.set(cache_key, 1, window)
        return False
    return count > limit


def rate_limited(bucket, setting):
    """Per-IP rate limit for sensitive endpoints (e.g. sign-in)."""
    def deco(fn):
        @functools.wraps(fn)
        def wrapper(request, *a, **kw):
            limit, window = STORE[setting]
            if hit_rate_limit(bucket, client_ip(request), limit, window):
                raise HttpError(429, 'Too many attempts. Please try again in a few minutes.')
            return fn(request, *a, **kw)
        return wrapper
    return deco


def audit(request, action, detail=None, user=None):
    u = user or (request.user if request.user.is_authenticated else None)
    AuditLog.objects.create(user=u, action=action, detail=detail, ip=client_ip(request))


# ---------------- Validation ----------------
def v_str(val, field, min_len=1, max_len=200, pattern=None, optional=False):
    if val is None or val == '':
        if optional:
            return ''
        raise HttpError(400, f'{field} is required.')
    if not isinstance(val, str):
        raise HttpError(400, f'{field} must be text.')
    s = val.strip()
    if not (min_len <= len(s) <= max_len):
        raise HttpError(400, f'{field} must be {min_len}-{max_len} characters.')
    if pattern and not re.fullmatch(pattern, s):
        raise HttpError(400, f'{field} is not valid.')
    return s


def v_int(val, field, lo=None, hi=None, optional=False, default=None):
    if val is None or val == '':
        if optional:
            return default
        raise HttpError(400, f'{field} is required.')
    if isinstance(val, bool):
        raise HttpError(400, f'{field} must be a whole number.')
    try:
        n = int(str(val))
    except (TypeError, ValueError):
        raise HttpError(400, f'{field} must be a whole number.')
    if (lo is not None and n < lo) or (hi is not None and n > hi):
        raise HttpError(400, f'{field} must be a whole number between {lo} and {hi}.')
    return n


EMAIL_RE = r"[^\s@<>()]+@[^\s@<>()]+\.[A-Za-z]{2,}"
PHONE_RE = r'[6-9]\d{9}'
PIN_RE = r'[1-9]\d{5}'


def v_email(val):
    return v_str(val, 'Email', max_len=254, pattern=EMAIL_RE).lower()


def v_phone(val, optional=False):
    return v_str(val, 'Mobile number', 10, 10, PHONE_RE, optional)


def v_pincode(val):
    return v_str(val, 'PIN code', 6, 6, PIN_RE)


def password_policy_error(pw):
    if not isinstance(pw, str) or len(pw) < 8:
        return 'Password must be at least 8 characters.'
    if len(pw) > 128:
        return 'Password must be at most 128 characters.'
    if not re.search(r'[A-Za-z]', pw) or not re.search(r'\d', pw):
        return 'Password must contain letters and numbers.'
    return None


# ---------------- Serialisation (shapes match the storefront's expectations) ----------------
def ms(dt):
    """Datetime -> epoch milliseconds (what the JavaScript front end expects)."""
    return int(dt.timestamp() * 1000) if dt else None


def product_card(p):
    return {
        'id': p.id, 'title': p.title, 'brand': p.brand, 'price': p.price, 'mrp': p.mrp, 'stock': p.stock,
        'rating_avg': p.rating_avg, 'rating_count': p.rating_count, 'sold_count': p.sold_count,
        'emoji': p.emoji, 'color': p.color, 'express': p.express, 'is_deal': p.is_deal,
        'category': p.category.slug, 'category_name': p.category.name,
    }


def public_user(u):
    return {'id': u.id, 'name': u.name, 'email': u.email, 'phone': u.phone or '', 'role': u.role}
