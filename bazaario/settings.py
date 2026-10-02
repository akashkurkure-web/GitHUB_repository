"""
Bazaario Django settings.

Everything environment-specific comes from environment variables, so the same code runs
locally, in GitHub Codespaces, on Render and in Docker. See .env.example.
"""
import os
import secrets
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def env_bool(name, default=False):
    return os.environ.get(name, str(default)).strip().lower() in ('1', 'true', 'yes', 'on')


def env_list(name, default=''):
    return [v.strip() for v in os.environ.get(name, default).split(',') if v.strip()]


# DJANGO_PRODUCTION=1 switches on HTTPS-only cookies, HSTS and SSL redirect, and forces DEBUG off.
IS_PROD = env_bool('DJANGO_PRODUCTION', False)
DEBUG = False if IS_PROD else env_bool('DJANGO_DEBUG', True)
TESTING = env_bool('TESTING', False) or (len(sys.argv) > 1 and sys.argv[1] == 'test')

# A random key per process is safe for local/dev use (sessions reset on restart).
# Production must set DJANGO_SECRET_KEY so sessions survive restarts.
SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY') or secrets.token_urlsafe(50)

ALLOWED_HOSTS = env_list('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1,[::1],.app.github.dev,.onrender.com,testserver')
if os.environ.get('RENDER_EXTERNAL_HOSTNAME'):
    ALLOWED_HOSTS.append(os.environ['RENDER_EXTERNAL_HOSTNAME'])

# Origins allowed to POST (CSRF). Wildcards cover Codespaces and Render preview hosts.
CSRF_TRUSTED_ORIGINS = env_list(
    'DJANGO_CSRF_TRUSTED_ORIGINS', 'https://*.app.github.dev,https://*.onrender.com,http://localhost:8000,http://127.0.0.1:8000'
)

# Behind a TLS-terminating proxy (Render, Codespaces, Nginx) trust its forwarded headers.
TRUST_PROXY = env_bool('TRUST_PROXY', IS_PROD)
if TRUST_PROXY:
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    USE_X_FORWARDED_HOST = True

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'whitenoise.runserver_nostatic',
    'django.contrib.staticfiles',
    'store',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'store.middleware.SecurityHeadersMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'store.middleware.ApiErrorMiddleware',
]

ROOT_URLCONF = 'bazaario.urls'
WSGI_APPLICATION = 'bazaario.wsgi.application'

TEMPLATES = [{
    'BACKEND': 'django.template.backends.django.DjangoTemplates',
    'DIRS': [],
    'APP_DIRS': True,
    'OPTIONS': {'context_processors': [
        'django.template.context_processors.request',
        'django.contrib.auth.context_processors.auth',
        'django.contrib.messages.context_processors.messages',
    ]},
}]

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': os.environ.get('DB_FILE', str(BASE_DIR / 'data' / 'bazaario.sqlite3')),
        'OPTIONS': {'transaction_mode': 'IMMEDIATE', 'timeout': 20},
    }
}
Path(DATABASES['default']['NAME']).parent.mkdir(parents=True, exist_ok=True)

AUTH_USER_MODEL = 'store.User'

# Password storage: scrypt (memory-hard), with PBKDF2 kept for verifying legacy hashes.
PASSWORD_HASHERS = [
    'django.contrib.auth.hashers.ScryptPasswordHasher',
    'django.contrib.auth.hashers.PBKDF2PasswordHasher',
]
if TESTING:
    PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']  # speed only; never used outside tests
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', 'OPTIONS': {'min_length': 8}},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# ---- Sessions & cookies ----
SESSION_COOKIE_AGE = 7 * 24 * 3600
SESSION_SAVE_EVERY_REQUEST = False
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_SECURE = IS_PROD
SESSION_COOKIE_NAME = '__Host-sid' if IS_PROD else 'sid'
CSRF_COOKIE_SECURE = IS_PROD
CSRF_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_NAME = '__Host-csrftoken' if IS_PROD else 'csrftoken'
CSRF_HEADER_NAME = 'HTTP_X_CSRF_TOKEN'  # the storefront sends X-CSRF-Token
CSRF_FAILURE_VIEW = 'store.middleware.csrf_failure'

# ---- Security headers ----
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = 'strict-origin-when-cross-origin'
SECURE_CROSS_ORIGIN_OPENER_POLICY = 'same-origin'
X_FRAME_OPTIONS = 'DENY'
if IS_PROD:
    SECURE_SSL_REDIRECT = env_bool('DJANGO_SSL_REDIRECT', True)
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SECURE_REDIRECT_EXEMPT = [r'^api/health$']

DATA_UPLOAD_MAX_MEMORY_SIZE = 50 * 1024  # 50 KB request bodies

CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache', 'LOCATION': 'bazaario'}}

LANGUAGE_CODE = 'en-in'
TIME_ZONE = 'Asia/Kolkata'
USE_I18N = True
USE_TZ = True

# ---- Static files ----
# public/ holds the storefront (index.html, app.js, styles.css, fonts) and is served from "/".
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
WHITENOISE_ROOT = BASE_DIR / 'public'
WHITENOISE_INDEX_FILE = True
WHITENOISE_AUTOREFRESH = DEBUG
STORAGES = {
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': 'whitenoise.storage.CompressedStaticFilesStorage'},
}

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {'console': {'class': 'logging.StreamHandler'}},
    'root': {'handlers': ['console'], 'level': 'WARNING'},
    # Expected 4xx responses (bad input, auth failures) are noise in tests.
    'loggers': {'django.request': {'level': 'ERROR' if TESTING else 'WARNING'}},
}

# ---- Store business rules (money in paise: ₹1 = 100) ----
STORE = {
    'NAME': os.environ.get('STORE_NAME', 'Bazaario'),
    'FREE_SHIPPING_THRESHOLD': 49900,
    'SHIPPING_FEE': 4000,
    'COD_FEE': 0,
    'COD_MAX_ORDER': 5000000,
    'MAX_QTY_PER_ITEM': 10,
    'RETURN_WINDOW_DAYS': 10,
    'MAX_FAILED_LOGINS': 5,
    'LOCKOUT_SECONDS': 15 * 60,
    'AUTH_RATE_LIMIT': (1000 if TESTING else 20, 15 * 60),  # attempts per window (seconds) per IP
    'API_RATE_LIMIT': (100000 if TESTING else 300, 60),
    'ADMIN_EMAIL': os.environ.get('ADMIN_EMAIL', 'admin@bazaario.local'),
    'ADMIN_PASSWORD': os.environ.get('ADMIN_PASSWORD'),
}
