"""First-start setup for serverless hosting (Vercel), where nobody can open a terminal.

On a cold start it applies pending database migrations (under a PostgreSQL
advisory lock so two instances never migrate at once), creates the owner login
from OWNER_EMAIL / OWNER_PASSWORD if no owner exists yet, and loads the starter
categories. Everything is idempotent and cheap when there is nothing to do.
"""
import logging

from django.conf import settings
from django.core.management import call_command
from django.db import connection

log = logging.getLogger(__name__)
LOCK_ID = 727274  # arbitrary, constant

# Result of the last start-up run, shown on the /status/ page.
STATE = {"ran": False, "ok": None, "error": ""}


def _pooled():
    return connection.settings_dict.get("DISABLE_SERVER_SIDE_CURSORS", False)


def run():
    if not settings.AUTO_MIGRATE:
        return
    STATE["ran"] = True
    try:
        # Session advisory locks are unreliable through a transaction pooler, so
        # they are only used on a direct connection.
        if connection.vendor == "postgresql" and not _pooled():
            with connection.cursor() as cur:
                cur.execute("SELECT pg_advisory_lock(%s)", [LOCK_ID])
            try:
                _setup()
            finally:
                with connection.cursor() as cur:
                    cur.execute("SELECT pg_advisory_unlock(%s)", [LOCK_ID])
        else:
            _setup()
        STATE.update(ok=True, error="")
    except Exception as exc:
        log.exception("Start-up setup failed")
        STATE.update(ok=False, error=f"{type(exc).__name__}: {exc}")
    finally:
        connection.close()


def _setup():
    from django.db.migrations.executor import MigrationExecutor

    executor = MigrationExecutor(connection)
    if executor.migration_plan(executor.loader.graph.leaf_nodes()):
        log.info("Applying database migrations")
        call_command("migrate", interactive=False, verbosity=1)
    call_command("setup_portal")
