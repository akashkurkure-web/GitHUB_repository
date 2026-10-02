"""Bazaario data model. All money is stored as integer paise (₹1 = 100 paise)."""
from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q
from django.utils import timezone


class UserManager(BaseUserManager):
    use_in_migrations = True

    def create_user(self, email, password=None, **extra):
        if not email:
            raise ValueError('Email is required')
        user = self.model(email=self.normalize_email(email).lower(), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra):
        extra.setdefault('is_staff', True)
        extra.setdefault('is_superuser', True)
        extra.setdefault('name', 'Store Admin')
        return self.create_user(email, password, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    """Customer or store admin. Signs in with email; admins are is_staff users."""
    email = models.EmailField(unique=True)
    name = models.CharField(max_length=60)
    phone = models.CharField(max_length=10, blank=True, default='')
    is_staff = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    failed_logins = models.PositiveSmallIntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    date_joined = models.DateTimeField(default=timezone.now)

    objects = UserManager()
    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['name']

    @property
    def role(self):
        return 'admin' if self.is_staff else 'customer'

    def __str__(self):
        return self.email


class Category(models.Model):
    slug = models.SlugField(unique=True)
    name = models.CharField(max_length=60)
    icon = models.CharField(max_length=8, default='')

    class Meta:
        verbose_name_plural = 'categories'
        ordering = ['id']

    def __str__(self):
        return self.name


class Product(models.Model):
    title = models.CharField(max_length=200)
    brand = models.CharField(max_length=60)
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name='products')
    description = models.TextField(blank=True, default='')
    features = models.JSONField(default=list, blank=True)
    price = models.PositiveIntegerField(help_text='Selling price in paise')
    mrp = models.PositiveIntegerField(help_text='MRP in paise')
    stock = models.PositiveIntegerField(default=0)
    rating_avg = models.FloatField(default=0)
    rating_count = models.PositiveIntegerField(default=0)
    sold_count = models.PositiveIntegerField(default=0)
    emoji = models.CharField(max_length=8, default='📦', help_text='Image placeholder')
    color = models.CharField(max_length=7, default='#e3e6e6')
    express = models.BooleanField(default=False)
    is_deal = models.BooleanField(default=False)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(price__gt=0), name='product_price_positive'),
            models.CheckConstraint(condition=Q(price__lte=models.F('mrp')), name='product_price_lte_mrp'),
        ]
        indexes = [models.Index(fields=['category', 'active'])]

    def __str__(self):
        return self.title


class Review(models.Model):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name='reviews')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='reviews')
    rating = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(5)])
    title = models.CharField(max_length=100)
    body = models.TextField(max_length=2000)
    verified = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['product', 'user'], name='one_review_per_user')]
        ordering = ['-created_at']


class CartItem(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='cart_items')
    product = models.ForeignKey(Product, on_delete=models.CASCADE)
    qty = models.PositiveSmallIntegerField()
    saved_for_later = models.BooleanField(default=False)
    added_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['user', 'product'], name='one_cart_line_per_product')]
        ordering = ['-added_at']


class WishlistItem(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='wishlist')
    product = models.ForeignKey(Product, on_delete=models.CASCADE)
    added_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['user', 'product'], name='one_wish_per_product')]
        ordering = ['-added_at']


class Address(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='addresses')
    full_name = models.CharField(max_length=60)
    phone = models.CharField(max_length=10)
    line1 = models.CharField(max_length=120)
    line2 = models.CharField(max_length=120, blank=True, default='')
    city = models.CharField(max_length=60)
    state = models.CharField(max_length=60)
    pincode = models.CharField(max_length=6)
    is_default = models.BooleanField(default=False)

    class Meta:
        verbose_name_plural = 'addresses'
        ordering = ['-is_default', '-id']


class Coupon(models.Model):
    PERCENT, FLAT = 'percent', 'flat'
    code = models.CharField(max_length=20, unique=True)
    kind = models.CharField(max_length=10, choices=[(PERCENT, 'Percent'), (FLAT, 'Flat')])
    value = models.PositiveIntegerField(help_text='Percent, or paise for flat coupons')
    max_discount = models.PositiveIntegerField(null=True, blank=True, help_text='Paise')
    min_order = models.PositiveIntegerField(default=0, help_text='Paise')
    active = models.BooleanField(default=True)
    description = models.CharField(max_length=200, blank=True, default='')

    def save(self, *args, **kwargs):
        self.code = self.code.upper()
        super().save(*args, **kwargs)

    def __str__(self):
        return self.code


class Order(models.Model):
    STATUSES = [(s, s.replace('_', ' ').title()) for s in
                ('placed', 'packed', 'shipped', 'delivered', 'cancelled', 'return_requested', 'returned')]
    PAYMENT_METHODS = [('cod', 'Cash on Delivery'), ('card', 'Card'), ('upi', 'UPI')]
    PAYMENT_STATUSES = [('pending', 'Pending'), ('paid', 'Paid'), ('refunded', 'Refunded')]

    order_no = models.CharField(max_length=24, unique=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='orders')
    status = models.CharField(max_length=20, choices=STATUSES, default='placed')
    subtotal = models.PositiveIntegerField()
    discount = models.PositiveIntegerField(default=0)
    shipping = models.PositiveIntegerField(default=0)
    total = models.PositiveIntegerField()
    coupon_code = models.CharField(max_length=20, blank=True, null=True)
    payment_method = models.CharField(max_length=4, choices=PAYMENT_METHODS)
    payment_status = models.CharField(max_length=10, choices=PAYMENT_STATUSES)
    payment_ref = models.CharField(max_length=60, blank=True, null=True)
    address = models.JSONField(help_text='Snapshot of the delivery address at order time')
    idempotency_key = models.CharField(max_length=64, blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    delivered_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [models.UniqueConstraint(fields=['user', 'idempotency_key'], name='order_idempotency',
                                               condition=Q(idempotency_key__isnull=False))]

    def __str__(self):
        return self.order_no


class OrderItem(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name='items')
    product = models.ForeignKey(Product, on_delete=models.PROTECT)
    title = models.CharField(max_length=200)
    emoji = models.CharField(max_length=8)
    price = models.PositiveIntegerField()
    qty = models.PositiveSmallIntegerField()


class AuditLog(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    action = models.CharField(max_length=60)
    detail = models.JSONField(null=True, blank=True)
    ip = models.CharField(max_length=64, blank=True, default='')
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ['-id']
