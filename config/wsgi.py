import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

application = get_wsgi_application()

from core import bootstrap  # noqa: E402

bootstrap.run()

# Vercel's Python runtime looks for a variable called `app`.
app = application
