from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone

from core.choices import STATE_CHOICES


class User(AbstractUser):
    """Everyone who signs in. The role decides which portal and which data they see.

    owner          Akash: everything, including vendor prices, margin, payment approval, settlement
    ops            Sales and support staff: enquiries, quotes, orders, record payments; never sees vendor price or margin
    vendor         Print partner staff; `vendor_manager` also sees and enters vendor prices
    customer       Buyers (self sign-up, or created from a guest quote request)
    """

    class Role(models.TextChoices):
        CUSTOMER = "customer", "Customer"
        VENDOR = "vendor", "Vendor"
        OPS = "ops", "Sales and ops"
        OWNER = "owner", "Owner"

    role = models.CharField(max_length=20, choices=Role.choices, default=Role.CUSTOMER)
    phone = models.CharField(max_length=20, blank=True)
    company = models.CharField(max_length=150, blank=True)
    gstin = models.CharField("GSTIN", max_length=15, blank=True, help_text="For a GST invoice in your company's name")
    address = models.TextField(blank=True, help_text="Default delivery address")
    city = models.CharField(max_length=80, blank=True)
    state = models.CharField(max_length=60, choices=STATE_CHOICES, blank=True)
    pincode = models.CharField(max_length=6, blank=True)
    vendor = models.ForeignKey("VendorProfile", on_delete=models.SET_NULL, null=True, blank=True, related_name="members")
    vendor_manager = models.BooleanField(default=False, help_text="Vendor user who can see and enter vendor prices")
    accepted_terms_at = models.DateTimeField(null=True, blank=True)

    def save(self, *args, **kwargs):
        if self.is_superuser:
            self.role = self.Role.OWNER
        self.is_staff = self.role == self.Role.OWNER  # only the owner may open /admin
        super().save(*args, **kwargs)

    @property
    def is_owner(self):
        return self.role == self.Role.OWNER

    @property
    def is_ops(self):
        return self.role == self.Role.OPS

    @property
    def is_staff_member(self):
        return self.role in (self.Role.OPS, self.Role.OWNER)

    @property
    def is_vendor(self):
        return self.role == self.Role.VENDOR

    @property
    def is_customer(self):
        return self.role == self.Role.CUSTOMER

    @property
    def sees_vendor_price(self):
        return self.is_owner or (self.is_vendor and self.vendor_manager)

    @property
    def role_label(self):
        if self.is_vendor:
            return "Vendor manager" if self.vendor_manager else "Vendor staff"
        return self.get_role_display()

    @property
    def display_name(self):
        return self.get_full_name() or self.username

    @property
    def initials(self):
        parts = self.display_name.split()
        return (parts[0][0] + (parts[1][0] if len(parts) > 1 else "")).upper() if parts else "?"


class VendorProfile(models.Model):
    """The print partner. Hidden from customers: they only ever see our brand."""

    company_name = models.CharField(max_length=150)
    contact_person = models.CharField(max_length=120, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    address = models.TextField(blank=True, help_text="Workshop / pickup address")
    gstin = models.CharField("GSTIN", max_length=15, blank=True)
    pan = models.CharField("PAN", max_length=10, blank=True)
    udyam_number = models.CharField("Udyam number", max_length=25, blank=True,
                                    help_text="If registered as a micro or small enterprise (MSMED Act 45-day payment rule)")
    bank_account_name = models.CharField(max_length=120, blank=True)
    bank_account_number = models.CharField(max_length=30, blank=True)
    bank_ifsc = models.CharField("IFSC", max_length=11, blank=True)
    technologies = models.CharField(max_length=100, blank=True, help_text="e.g. FDM, SLA")
    materials = models.CharField(max_length=250, blank=True)
    max_build_size = models.CharField(max_length=60, blank=True, help_text="e.g. 300 x 300 x 400 mm")
    is_active = models.BooleanField(default=True)
    is_default = models.BooleanField(default=True, help_text="New jobs go to this vendor automatically")
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-is_default", "company_name"]

    def __str__(self):
        return self.company_name

    @classmethod
    def default(cls):
        return cls.objects.filter(is_active=True).order_by("-is_default", "pk").first()


class LoginAttempt(models.Model):
    """Failed sign-ins, used to lock an account after repeated guesses."""

    username = models.CharField(max_length=150, db_index=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    @classmethod
    def recent_failures(cls, username):
        since = timezone.now() - timedelta(minutes=settings.LOGIN_LOCK_MINUTES)
        return cls.objects.filter(username__iexact=username, created_at__gte=since).count()
