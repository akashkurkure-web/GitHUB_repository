import mimetypes
import os
from decimal import Decimal

from django.conf import settings
from django.db import models, transaction
from django.db.models import Sum
from django.urls import reverse
from django.utils import timezone

from core.choices import FINISHES, MATERIALS, SEGMENTS, STATE_CHOICES, TECHNOLOGIES

from .pricing import advance_required, gst_split


class Order(models.Model):
    class Type(models.TextChoices):
        CATALOG = "catalog", "Catalogue order"
        CUSTOM = "custom", "Custom request"

    class Status(models.TextChoices):
        NEW = "new", "Request received"
        PRICING = "pricing", "Being priced"
        QUOTED = "quoted", "Quote sent"
        AWAITING_PAYMENT = "awaiting_payment", "Awaiting payment"
        CONFIRMED = "confirmed", "Confirmed"
        IN_PRODUCTION = "in_production", "In production"
        READY = "ready", "Packed, ready to ship"
        SHIPPED = "shipped", "Shipped"
        DELIVERED = "delivered", "Delivered"
        CANCELLED = "cancelled", "Cancelled"
        REJECTED = "rejected", "Not accepted"

    OPEN_STATUSES = [
        Status.NEW, Status.PRICING, Status.QUOTED, Status.AWAITING_PAYMENT, Status.CONFIRMED,
        Status.IN_PRODUCTION, Status.READY, Status.SHIPPED,
    ]
    CLOSED_STATUSES = [Status.DELIVERED, Status.CANCELLED, Status.REJECTED]
    # What the vendor can see: pricing requests and released production jobs.
    VENDOR_STATUSES = [
        Status.PRICING, Status.CONFIRMED, Status.IN_PRODUCTION, Status.READY, Status.SHIPPED, Status.DELIVERED,
    ]
    VENDOR_ACTIVE = [Status.CONFIRMED, Status.IN_PRODUCTION, Status.READY]

    BADGES = {
        "new": "secondary", "pricing": "info", "quoted": "warning", "awaiting_payment": "warning",
        "confirmed": "primary", "in_production": "indigo", "ready": "teal", "shipped": "teal",
        "delivered": "success", "cancelled": "dark", "rejected": "danger",
    }

    number = models.CharField(max_length=20, unique=True, editable=False, blank=True)
    customer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="orders")
    order_type = models.CharField(max_length=10, choices=Type.choices, default=Type.CUSTOM)
    segment = models.CharField(max_length=10, choices=SEGMENTS, default="custom")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.NEW, db_index=True)

    title = models.CharField("Project / item name", max_length=150)
    description = models.TextField(blank=True)
    technology = models.CharField(max_length=10, choices=TECHNOLOGIES, blank=True)
    material = models.CharField(max_length=20, choices=MATERIALS, blank=True)
    colour = models.CharField(max_length=40, blank=True)
    finish = models.CharField(max_length=10, choices=FINISHES, default="raw")
    quantity = models.PositiveIntegerField(default=1)
    required_by = models.DateField(null=True, blank=True)
    file_link = models.URLField("Link to large files", blank=True,
                                help_text="Google Drive, Dropbox or WeTransfer link for files above the upload limit")

    vendor = models.ForeignKey("accounts.VendorProfile", on_delete=models.SET_NULL, null=True, blank=True,
                               related_name="jobs")
    vendor_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True,
                                       help_text="Vendor's total price for this order, including delivery")
    vendor_lead_days = models.PositiveIntegerField(null=True, blank=True)
    vendor_note = models.CharField(max_length=500, blank=True)

    price = models.DecimalField("Price before GST", max_digits=12, decimal_places=2, null=True, blank=True)
    gst_percent = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal(settings.GST_PERCENT))
    quote_note = models.CharField(max_length=500, blank=True)
    quoted_at = models.DateTimeField(null=True, blank=True)
    quote_valid_until = models.DateField(null=True, blank=True)

    ship_name = models.CharField("Recipient name", max_length=120)
    ship_phone = models.CharField("Recipient phone", max_length=20)
    ship_address = models.TextField("Delivery address")
    ship_city = models.CharField("City", max_length=80)
    ship_state = models.CharField("State", max_length=60, choices=STATE_CHOICES)
    ship_pincode = models.CharField("PIN code", max_length=6)
    bill_company = models.CharField("Company name on invoice", max_length=150, blank=True)
    bill_gstin = models.CharField("Your GSTIN", max_length=15, blank=True)

    courier = models.CharField(max_length=60, blank=True)
    tracking_number = models.CharField("AWB / tracking number", max_length=80, blank=True)
    tracking_url = models.URLField(blank=True)
    shipped_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)

    invoice_number = models.CharField(max_length=30, blank=True)
    invoice_date = models.DateField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.number} - {self.title}"

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if not self.number:
            self.number = f"AK-{timezone.now():%y%m}-{self.pk:05d}"
            super().save(update_fields=["number"])

    def get_absolute_url(self):
        return reverse("orders:detail", args=[self.pk])

    # ----- money -------------------------------------------------------------
    @property
    def tax(self):
        return gst_split(self.price or 0, self.ship_state, self.gst_percent)

    @property
    def total(self):
        if self.price is None:
            return None
        return self.price + self.tax["tax"]

    @property
    def margin(self):
        if self.price is None or self.vendor_price is None:
            return None
        return self.price - self.vendor_price

    @property
    def amount_paid(self):
        return self.payments.filter(status=Payment.Status.APPROVED).aggregate(s=Sum("amount"))["s"] or Decimal("0")

    @property
    def amount_pending(self):
        return self.payments.filter(status=Payment.Status.PENDING).aggregate(s=Sum("amount"))["s"] or Decimal("0")

    @property
    def advance_due(self):
        return advance_required(self.total) if self.total is not None else None

    @property
    def balance(self):
        if self.total is None:
            return None
        return max(self.total - self.amount_paid, Decimal("0"))

    @property
    def needs_advance_only(self):
        return self.total is not None and self.advance_due < self.total

    @property
    def is_released(self):
        """Enough money received to start production."""
        return self.total is not None and self.amount_paid >= self.advance_due

    @property
    def is_fully_paid(self):
        return self.total is not None and self.amount_paid >= self.total

    @property
    def amount_to_pay_now(self):
        if self.total is None:
            return None
        target = self.total if self.is_released else self.advance_due
        return max(target - self.amount_paid, Decimal("0"))

    # ----- display -----------------------------------------------------------
    @property
    def badge(self):
        return self.BADGES.get(self.status, "secondary")

    @property
    def is_open(self):
        return self.status not in self.CLOSED_STATUSES

    @property
    def is_overdue(self):
        return bool(self.required_by and self.is_open and self.status != self.Status.SHIPPED
                    and self.required_by < timezone.localdate())

    @property
    def full_ship_address(self):
        return f"{self.ship_address}, {self.ship_city}, {self.ship_state} {self.ship_pincode}"

    def progress_steps(self):
        """Steps for the visual tracker: list of (label, state) with state done/current/todo."""
        S = self.Status
        position = {
            S.NEW: 0, S.PRICING: 0, S.QUOTED: 1, S.AWAITING_PAYMENT: 2, S.CONFIRMED: 3, S.IN_PRODUCTION: 4,
            S.READY: 4, S.SHIPPED: 5, S.DELIVERED: 6,
        }
        labels = ["Request", "Quote", "Payment", "Confirmed", "Production", "Shipped", "Delivered"]
        if self.order_type == self.Type.CATALOG:
            position = {**position, S.AWAITING_PAYMENT: 1, S.CONFIRMED: 2, S.IN_PRODUCTION: 3, S.READY: 3,
                        S.SHIPPED: 4, S.DELIVERED: 5}
            labels = ["Order placed", "Payment", "Confirmed", "Production", "Shipped", "Delivered"]
        current = position.get(self.status, -1)
        steps = []
        for i, label in enumerate(labels):
            done = i < current or self.status == S.DELIVERED
            steps.append((label, "done" if done else "current" if i == current else "todo"))
        return steps


class OrderItem(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT)
    quantity = models.PositiveIntegerField(default=1)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    unit_vendor_price = models.DecimalField(max_digits=10, decimal_places=2)
    colour = models.CharField(max_length=40, blank=True)

    @property
    def line_total(self):
        return self.unit_price * self.quantity


class OrderFile(models.Model):
    """A design file or photo, stored in the database (Vercel has no permanent disk)."""

    class Kind(models.TextChoices):
        MODEL = "model", "3D model"
        DRAWING = "drawing", "Drawing / reference"
        QC_PHOTO = "qc_photo", "Quality-check photo"
        OTHER = "other", "Other"

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="files")
    name = models.CharField(max_length=255)
    size = models.PositiveBigIntegerField(default=0)
    content_type = models.CharField(max_length=100, blank=True)
    data = models.BinaryField()
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.MODEL)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["uploaded_at"]

    def __str__(self):
        return self.name

    @property
    def extension(self):
        return os.path.splitext(self.name)[1].lstrip(".").upper()

    @classmethod
    def from_upload(cls, order, upload, user, kind):
        data = b"".join(upload.chunks())
        ctype = upload.content_type or mimetypes.guess_type(upload.name)[0] or "application/octet-stream"
        return cls.objects.create(order=order, name=os.path.basename(upload.name)[:255], size=len(data),
                                  content_type=ctype[:100], data=data, kind=kind, uploaded_by=user)


class StatusEvent(models.Model):
    """Audit trail: every status change with who did it and why."""

    class Audience(models.TextChoices):
        ALL = "all", "Customer and vendor"
        CUSTOMER = "customer", "Customer and staff"
        VENDOR = "vendor", "Vendor and staff"
        STAFF = "staff", "Staff only"

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="events")
    from_status = models.CharField(max_length=20, blank=True)
    to_status = models.CharField(max_length=20)
    note = models.CharField(max_length=500, blank=True)
    audience = models.CharField(max_length=10, choices=Audience.choices, default=Audience.ALL)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    @property
    def to_label(self):
        return Order.Status(self.to_status).label

    @property
    def badge(self):
        return Order.BADGES.get(self.to_status, "secondary")


class Message(models.Model):
    """Conversation on an order. Customers and the vendor never see each other's channel."""

    class Channel(models.TextChoices):
        CUSTOMER = "customer", "With customer"
        VENDOR = "vendor", "With vendor"
        INTERNAL = "internal", "Internal note"

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="messages")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    channel = models.CharField(max_length=10, choices=Channel.choices, default=Channel.CUSTOMER)
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]


class Payment(models.Model):
    """Money received offline (UPI, bank transfer). Recorded by staff or the customer, approved by the owner."""

    class Method(models.TextChoices):
        UPI = "upi", "UPI"
        NEFT = "neft", "NEFT / RTGS / IMPS"
        CHEQUE = "cheque", "Cheque"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        PENDING = "pending", "Waiting for approval"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="payments")
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    method = models.CharField(max_length=10, choices=Method.choices, default=Method.UPI)
    reference = models.CharField("UTR / reference number", max_length=60)
    paid_on = models.DateField()
    proof = models.BinaryField(null=True, blank=True)
    proof_name = models.CharField(max_length=255, blank=True)
    proof_type = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    note = models.CharField(max_length=300, blank=True)
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")
    decided_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name="+")
    decided_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    @property
    def badge(self):
        return {"pending": "warning", "approved": "success", "rejected": "danger"}[self.status]


class InvoiceSequence(models.Model):
    """Gapless invoice numbers per financial year, as GST rules require."""

    financial_year = models.CharField(max_length=7, unique=True)
    last_number = models.PositiveIntegerField(default=0)

    @classmethod
    def next_number(cls, on_date):
        start = on_date.year if on_date.month >= 4 else on_date.year - 1
        fy = f"{start}-{str(start + 1)[-2:]}"
        with transaction.atomic():
            seq, _ = cls.objects.select_for_update().get_or_create(financial_year=fy)
            seq.last_number += 1
            seq.save(update_fields=["last_number"])
        return f"INV/{fy}/{seq.last_number:04d}"


class VendorPayout(models.Model):
    """A month-end settlement paid to the vendor."""

    vendor = models.ForeignKey("accounts.VendorProfile", on_delete=models.PROTECT, related_name="payouts")
    period = models.DateField(help_text="First day of the month this payment settles")
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    reference = models.CharField("UTR / reference", max_length=60)
    paid_on = models.DateField()
    vendor_invoice_number = models.CharField(max_length=40, blank=True)
    note = models.CharField(max_length=300, blank=True)
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-period", "-paid_on"]
