"""
Django settings for the 3D printing sales portal.

Every environment-specific value comes from environment variables (or a local
.env file), so the same code runs on a laptop, in VS Code and on Vercel.
"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv(path):
    """Minimal .env reader so python-dotenv is not a hard dependency."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv(BASE_DIR / ".env")


def env(name, default=""):
    return os.environ.get(name, default)


def env_bool(name, default=False):
    return env(name, str(default)).lower() in ("1", "true", "yes", "on")


def env_list(name, default=""):
    return [v.strip() for v in env(name, default).split(",") if v.strip()]


ON_VERCEL = bool(env("VERCEL"))

SECRET_KEY = env("DJANGO_SECRET_KEY", "dev-only-insecure-key-change-me")
DEBUG = env_bool("DJANGO_DEBUG", not ON_VERCEL)
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,0.0.0.0,testserver")
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS")

# Vercel: accept the project's *.vercel.app addresses and any custom domain listed above.
if ON_VERCEL:
    ALLOWED_HOSTS.append(".vercel.app")
    for var in ("VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL"):
        host = env(var)
        if host:
            ALLOWED_HOSTS.append(host)
            CSRF_TRUSTED_ORIGINS.append(f"https://{host}")
    CSRF_TRUSTED_ORIGINS.append("https://*.vercel.app")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.humanize",
    "core",
    "accounts",
    "catalog",
    "orders",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
                "core.context_processors.portal",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# Database: SQLite on a laptop; PostgreSQL whenever a Postgres connection string
# is present. Vercel/Neon integrations name it differently depending on the
# prefix chosen (DATABASE_URL, POSTGRES_URL, STORAGE_URL, ...), so any variable
# holding a postgres:// URL is accepted. A direct (unpooled) connection is
# preferred because migrations and advisory locks need a real session.
def _find_database_url():
    preferred = ["DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING", "DATABASE_URL", "POSTGRES_URL"]
    for name in preferred:
        if env(name):
            return name, env(name)
    candidates = sorted(
        (name for name, value in os.environ.items()
         if name.endswith(("_URL", "_URL_UNPOOLED", "_URL_NON_POOLING"))
         and value.startswith(("postgres://", "postgresql://"))),
        key=lambda n: (not n.endswith(("_UNPOOLED", "_NON_POOLING")), n))
    return (candidates[0], env(candidates[0])) if candidates else ("", "")


DATABASE_SOURCE, DATABASE_URL = _find_database_url()
if DATABASE_URL:
    import dj_database_url

    DATABASES = {"default": dj_database_url.parse(DATABASE_URL, conn_max_age=0 if ON_VERCEL else 600,
                                                  ssl_require=env_bool("DATABASE_SSL", ON_VERCEL))}
    # Connection poolers (PgBouncer, Neon "-pooler" hosts) cannot keep server-side cursors.
    DATABASES["default"]["DISABLE_SERVER_SIDE_CURSORS"] = "pooler" in DATABASES["default"].get("HOST", "")
else:
    DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "db.sqlite3"}}

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LOGIN_URL = "accounts:login"
LOGIN_REDIRECT_URL = "core:dashboard"
LOGOUT_REDIRECT_URL = "core:home"

LANGUAGE_CODE = "en-in"
TIME_ZONE = env("DJANGO_TIME_ZONE", "Asia/Kolkata")
USE_I18N = True
USE_TZ = True

# Static files are served by WhiteNoise straight from the source folders, so no
# collectstatic step is needed on Vercel.
STATIC_URL = "static/"
STATICFILES_DIRS = [BASE_DIR / "static"]
STATIC_ROOT = None if ON_VERCEL else BASE_DIR / "staticfiles"
WHITENOISE_USE_FINDERS = True
WHITENOISE_AUTOREFRESH = DEBUG
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Uploaded design files and images are stored inside the database (Vercel has no
# permanent disk). Vercel rejects request bodies above 4.5 MB, so the default
# per-file limit is 4 MB; customers can share larger files as a link.
MAX_UPLOAD_MB = float(env("MAX_UPLOAD_MB", "4"))
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024

# ---------------------------------------------------------------------------
# Business settings (all changeable from Vercel > Settings > Environment Variables)
# ---------------------------------------------------------------------------
PORTAL_NAME = env("PORTAL_NAME", "Akriti 3D")
PORTAL_TAGLINE = env("PORTAL_TAGLINE", "3D printing for industry, design and everyday life")
PORTAL_CURRENCY = "₹"
COMMISSION_PERCENT = env("COMMISSION_PERCENT", "15")
GST_PERCENT = env("GST_PERCENT", "18")
ADVANCE_THRESHOLD = env("ADVANCE_THRESHOLD", "50000")
ADVANCE_PERCENT = env("ADVANCE_PERCENT", "50")
HOME_STATE = env("COMPANY_STATE", "Maharashtra")

COMPANY = {
    "legal_name": env("COMPANY_LEGAL_NAME", ""),
    "address": env("COMPANY_ADDRESS", "Mumbai, Maharashtra, India"),
    "state": HOME_STATE,
    "gstin": env("COMPANY_GSTIN", ""),
    "cin": env("COMPANY_CIN", ""),
    "pan": env("COMPANY_PAN", ""),
    "email": env("SUPPORT_EMAIL", "support@example.com"),
    "phone": env("SUPPORT_PHONE", ""),
    "whatsapp": env("SUPPORT_WHATSAPP", ""),
    "hours": env("SUPPORT_HOURS", "Mon to Sat, 10 am to 7 pm"),
    "grievance_officer": env("GRIEVANCE_OFFICER_NAME", ""),
    "grievance_email": env("GRIEVANCE_OFFICER_EMAIL", ""),
    "grievance_phone": env("GRIEVANCE_OFFICER_PHONE", ""),
}
BANK = {
    "account_name": env("BANK_ACCOUNT_NAME", ""),
    "account_number": env("BANK_ACCOUNT_NUMBER", ""),
    "ifsc": env("BANK_IFSC", ""),
    "bank_name": env("BANK_NAME", ""),
    "upi_id": env("UPI_ID", ""),
}
# Payments are switched on automatically once bank or UPI details exist. Until
# then the site runs in "quote only" mode (Phase 0 in the blueprint).
PAYMENTS_ENABLED = bool(BANK["upi_id"] or BANK["account_number"])

# First owner account, created automatically on first start if no owner exists.
OWNER_EMAIL = env("OWNER_EMAIL", "")
OWNER_PASSWORD = env("OWNER_PASSWORD", "")
AUTO_MIGRATE = env_bool("AUTO_MIGRATE", ON_VERCEL)

# Login protection: lock an account for 15 minutes after 5 failed attempts.
LOGIN_MAX_ATTEMPTS = 5
LOGIN_LOCK_MINUTES = 15

# Email: printed to the log unless SMTP settings are supplied.
EMAIL_BACKEND = env("EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = env("EMAIL_HOST", "")
EMAIL_PORT = int(env("EMAIL_PORT", "587"))
EMAIL_HOST_USER = env("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", True)
EMAIL_TIMEOUT = 10
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", f"{PORTAL_NAME} <no-reply@example.com>")
SITE_URL = env("SITE_URL", f"https://{env('VERCEL_PROJECT_PRODUCTION_URL')}" if env("VERCEL_PROJECT_PRODUCTION_URL") else "http://127.0.0.1:8000")

SESSION_COOKIE_AGE = 60 * 60 * 24 * 7
SESSION_COOKIE_HTTPONLY = True
X_FRAME_OPTIONS = "DENY"
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "INFO"},
}
