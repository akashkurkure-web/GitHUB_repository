from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone


class Notification(models.Model):
    """In-app notification shown in the bell menu of the top bar."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    title = models.CharField(max_length=150)
    message = models.CharField(max_length=300, blank=True)
    link = models.CharField(max_length=300, blank=True)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user} - {self.title}"


class Grievance(models.Model):
    """Complaint raised through the grievance page.

    Consumer Protection (E-Commerce) Rules 2020: acknowledge within 48 hours and
    resolve within one month of receipt.
    """

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        ACKNOWLEDGED = "acknowledged", "Acknowledged"
        RESOLVED = "resolved", "Resolved"

    number = models.CharField(max_length=20, unique=True, blank=True)
    name = models.CharField(max_length=120)
    email = models.EmailField()
    phone = models.CharField(max_length=20, blank=True)
    order_number = models.CharField(max_length=30, blank=True)
    subject = models.CharField(max_length=150)
    details = models.TextField()
    status = models.CharField(max_length=15, choices=Status.choices, default=Status.OPEN)
    response = models.TextField(blank=True, help_text="Sent to the complainant by email when saved")
    created_at = models.DateTimeField(auto_now_add=True)
    acknowledged_at = models.DateTimeField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.number} {self.subject}"

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if not self.number:
            self.number = f"GR-{timezone.now():%y%m}-{self.pk:04d}"
            super().save(update_fields=["number"])

    @property
    def ack_due(self):
        return self.created_at + timedelta(hours=48)

    @property
    def resolve_due(self):
        return self.created_at + timedelta(days=30)

    @property
    def is_late(self):
        now = timezone.now()
        if self.status == self.Status.OPEN:
            return now > self.ack_due
        if self.status == self.Status.ACKNOWLEDGED:
            return now > self.resolve_due
        return False
