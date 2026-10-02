"""Security headers, API rate limiting and JSON error handling."""
import logging

from django.conf import settings
from django.http import JsonResponse

from .utils import HttpError, client_ip, hit_rate_limit

log = logging.getLogger(__name__)

# Strict CSP: only same-origin scripts/styles/fonts, no inline script, no framing.
CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
])
# Django's own admin uses inline styles/scripts, so it gets a slightly relaxed policy.
ADMIN_CSP = CSP.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'").replace(
    "script-src 'self'", "script-src 'self' 'unsafe-inline'")


class SecurityHeadersMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        is_api = request.path.startswith('/api/')
        if is_api:
            limit, window = settings.STORE['API_RATE_LIMIT']
            if hit_rate_limit('api', client_ip(request), limit, window):
                return JsonResponse({'error': 'Too many requests. Please slow down.'}, status=429)
        response = self.get_response(request)
        response.setdefault('Content-Security-Policy', ADMIN_CSP if request.path.startswith('/django-admin/') else CSP)
        response.setdefault('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)')
        if is_api:
            response['Cache-Control'] = 'no-store'
        return response


class ApiErrorMiddleware:
    """Turns HttpError into {"error": ...} JSON; never leaks stack traces from the API."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if request.path.startswith('/api/') and response.status_code == 404 and not isinstance(response, JsonResponse):
            return JsonResponse({'error': 'Not found.'}, status=404)
        return response

    def process_exception(self, request, exc):
        if isinstance(exc, HttpError):
            return JsonResponse({'error': exc.message}, status=exc.status)
        if request.path.startswith('/api/'):
            log.exception('Unhandled API error')
            return JsonResponse({'error': 'Something went wrong. Please try again.'}, status=500)
        return None


def csrf_failure(request, reason=''):
    return JsonResponse({'error': 'Security token missing or invalid. Please refresh the page.'}, status=403)
