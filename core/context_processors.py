from django.conf import settings

from .choices import SEGMENT_INFO


def portal(request):
    ctx = {
        "PORTAL_NAME": settings.PORTAL_NAME,
        "PORTAL_TAGLINE": settings.PORTAL_TAGLINE,
        "CURRENCY": settings.PORTAL_CURRENCY,
        "MAX_UPLOAD_MB": settings.MAX_UPLOAD_MB,
        "COMPANY": settings.COMPANY,
        "PAYMENTS_ENABLED": settings.PAYMENTS_ENABLED,
        "COMMISSION_PERCENT": settings.COMMISSION_PERCENT,
        "SEGMENT_INFO": SEGMENT_INFO,
        # Pages open to everyone use the portal shell when signed in and the website layout otherwise.
        "SHELL": "base.html" if request.user.is_authenticated else "layout_site.html",
    }
    if request.user.is_authenticated:
        ctx["unread_count"] = request.user.notifications.filter(is_read=False).count()
        ctx["recent_notifications"] = request.user.notifications.all()[:6]
    return ctx
