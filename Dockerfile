FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DJANGO_PRODUCTION=1 TRUST_PROXY=1 \
    DB_FILE=/app/data/bazaario.sqlite3
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY manage.py ./
COPY bazaario ./bazaario
COPY store ./store
COPY public ./public
RUN DJANGO_SECRET_KEY=build-only python manage.py collectstatic --noinput \
    && useradd --create-home app && mkdir -p /app/data && chown -R app:app /app
USER app
EXPOSE 8000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/health')" || exit 1
CMD ["sh", "-c", "python manage.py migrate --noinput && python manage.py seed && gunicorn bazaario.wsgi --bind 0.0.0.0:8000 --workers 3 --access-logfile -"]
