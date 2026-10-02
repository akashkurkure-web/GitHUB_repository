"""Sign-up, sign-in, sign-out, profile and password change."""
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.contrib.auth.hashers import check_password, make_password
from django.middleware.csrf import get_token
from django.utils import timezone

from ..models import User
from ..utils import (
    HttpError, audit, body, login_required, methods, ok, password_policy_error, public_user,
    rate_limited, v_email, v_phone, v_str,
)

STORE = settings.STORE
# Hashing a dummy password for unknown emails keeps response times equal (no user enumeration by timing).
_DUMMY = make_password('timing-equaliser-not-a-real-password-9')


@methods('GET')
def me(request):
    # The CSRF token is always returned so the storefront can make state-changing requests.
    user = public_user(request.user) if request.user.is_authenticated else None
    return ok({'user': user, 'csrfToken': get_token(request)})


@methods('POST')
@rate_limited('auth', 'AUTH_RATE_LIMIT')
def register(request):
    d = body(request)
    name = v_str(d.get('name'), 'Name', 2, 60)
    email = v_email(d.get('email'))
    phone = v_phone(d.get('phone'), optional=True)
    err = password_policy_error(d.get('password'))
    if err:
        raise HttpError(400, err)
    if User.objects.filter(email__iexact=email).exists():
        raise HttpError(409, 'An account with this email already exists. Please sign in.')
    user = User.objects.create_user(email=email, password=d['password'], name=name, phone=phone)
    login(request, user, backend='django.contrib.auth.backends.ModelBackend')
    audit(request, 'user.register')
    return ok({'user': public_user(user), 'csrfToken': get_token(request)}, status=201)


@methods('POST')
@rate_limited('auth', 'AUTH_RATE_LIMIT')
def login_view(request):
    d = body(request)
    email = d.get('email').strip().lower() if isinstance(d.get('email'), str) else ''
    password = d.get('password') if isinstance(d.get('password'), str) else ''
    generic = HttpError(401, 'Incorrect email or password.')
    if not email or not password or len(password) > 128:
        raise generic

    user = User.objects.filter(email__iexact=email).first()
    if not user:
        check_password(password, _DUMMY)  # equalise timing
        raise generic
    now = timezone.now()
    if user.locked_until and user.locked_until > now:
        raise HttpError(423, 'This account is temporarily locked after too many failed attempts. Try again later.')

    if authenticate(request, username=email, password=password) is None:
        user.failed_logins += 1
        if user.failed_logins >= STORE['MAX_FAILED_LOGINS']:
            user.failed_logins = 0
            user.locked_until = now + timedelta(seconds=STORE['LOCKOUT_SECONDS'])
            audit(request, 'user.locked', {'userId': user.id}, user=user)
        else:
            audit(request, 'user.login_failed', {'userId': user.id}, user=user)
        user.save(update_fields=['failed_logins', 'locked_until'])
        raise generic

    user.failed_logins = 0
    user.locked_until = None
    user.save(update_fields=['failed_logins', 'locked_until'])
    login(request, user)  # rotates the session key and CSRF token (prevents session fixation)
    audit(request, 'user.login')
    return ok({'user': public_user(user), 'csrfToken': get_token(request)})


@methods('POST')
def logout_view(request):
    if request.user.is_authenticated:
        audit(request, 'user.logout')
    logout(request)
    return ok({'ok': True, 'csrfToken': get_token(request)})


@methods('PATCH')
@login_required
def profile(request):
    d = body(request)
    request.user.name = v_str(d.get('name'), 'Name', 2, 60)
    request.user.phone = v_phone(d.get('phone'), optional=True)
    request.user.save(update_fields=['name', 'phone'])
    return ok({'user': public_user(request.user)})


@methods('POST')
@rate_limited('auth', 'AUTH_RATE_LIMIT')
@login_required
def change_password(request):
    d = body(request)
    current = d.get('currentPassword')
    if not isinstance(current, str) or not request.user.check_password(current):
        raise HttpError(400, 'Current password is incorrect.')
    err = password_policy_error(d.get('newPassword'))
    if err:
        raise HttpError(400, err)
    user = request.user
    user.set_password(d['newPassword'])
    user.save()
    # Changing the password invalidates every other session (Django ties sessions to the password hash);
    # keep this one signed in.
    update_session_auth_hash(request, user)
    request.session.cycle_key()
    audit(request, 'user.password_changed')
    return ok({'ok': True, 'csrfToken': get_token(request)})
