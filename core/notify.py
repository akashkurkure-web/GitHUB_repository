import logging

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail

from .models import Notification

log = logging.getLogger(__name__)


def absolute(link):
    if not link or link.startswith("http"):
        return link
    return settings.SITE_URL.rstrip("/") + link


def send_email(to, subject, body):
    """Send one email; failures are logged and never break the action that triggered it."""
    if not to:
        return
    try:
        send_mail(f"[{settings.PORTAL_NAME}] {subject}", body, settings.DEFAULT_FROM_EMAIL, [to], fail_silently=False)
    except Exception:
        log.exception("Email to %s failed", to)


def notify(users, title, message="", link=""):
    """Create an in-app notification and send an email to each user."""
    seen = set()
    for user in users:
        if user is None or user.pk in seen or not user.is_active:
            continue
        seen.add(user.pk)
        Notification.objects.create(user=user, title=title[:150], message=message[:300], link=link)
        if user.email:
            send_email(user.email, title, f"{message}\n\nOpen: {absolute(link)}")


def staff_users():
    User = get_user_model()
    return User.objects.filter(role__in=[User.Role.OPS, User.Role.OWNER], is_active=True)


def owners():
    User = get_user_model()
    return User.objects.filter(role=User.Role.OWNER, is_active=True)
