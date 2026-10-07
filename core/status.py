"""A plain health page at /status/ so the site owner can see why the site is down
without opening server logs. It never shows passwords or connection strings."""
import html
import re

from django.conf import settings
from django.db import connection
from django.http import HttpResponse

from . import bootstrap


def _redact(text):
    text = re.sub(r"://[^@\s/]+@", "://***@", str(text))
    return re.sub(r"(password\s*=\s*)\S+", r"\1***", text, flags=re.I)[:400]


def status(request):
    rows = []
    db = settings.DATABASES["default"]
    is_pg = "postgresql" in db["ENGINE"]
    rows.append(("Database setting found", bool(settings.DATABASE_URL),
                 settings.DATABASE_SOURCE or "none: connect a Neon database and name it DATABASE_URL"))
    rows.append(("Database type", is_pg or not settings.ON_VERCEL, "PostgreSQL" if is_pg else "SQLite"))
    try:
        with connection.cursor() as cur:
            cur.execute("SELECT 1")
        rows.append(("Database connection", True, "connected"))
        from django.db.migrations.executor import MigrationExecutor
        executor = MigrationExecutor(connection)
        pending = len(executor.migration_plan(executor.loader.graph.leaf_nodes()))
        rows.append(("Database tables", pending == 0, "up to date" if pending == 0 else f"{pending} steps pending"))
        if pending == 0:
            from accounts.models import User
            has_owner = User.objects.filter(role=User.Role.OWNER).exists()
            rows.append(("Owner login", has_owner, "created" if has_owner else
                         "missing: set OWNER_EMAIL and OWNER_PASSWORD, then redeploy"))
    except Exception as exc:
        rows.append(("Database connection", False, _redact(f"{type(exc).__name__}: {exc}")))
    if bootstrap.STATE["ran"]:
        rows.append(("Start-up setup", bootstrap.STATE["ok"], _redact(bootstrap.STATE["error"]) or "done"))
    rows.append(("Secret key set", settings.SECRET_KEY != "dev-only-insecure-key-change-me",
                 "yes" if settings.SECRET_KEY != "dev-only-insecure-key-change-me" else "missing: set DJANGO_SECRET_KEY"))
    try:
        connection.close()
    except Exception:
        pass

    ok = all(r[1] for r in rows)
    body = "".join(
        f"<tr><td>{'✅' if good else '❌'}</td><th>{html.escape(name)}</th><td>{html.escape(str(detail))}</td></tr>"
        for name, good, detail in rows)
    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Site status</title><style>body{{font-family:system-ui,sans-serif;margin:0;padding:16px;background:#f4f6fb;color:#1e293b}}
table{{border-collapse:collapse;width:100%;max-width:640px;background:#fff}}td,th{{padding:10px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top;word-break:break-word}}</style></head>
<body><h1>{'All good' if ok else 'Needs attention'}</h1><table>{body}</table></body></html>"""
    return HttpResponse(page, status=200 if ok else 503)
