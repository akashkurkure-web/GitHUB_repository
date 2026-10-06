from django.core.validators import MinValueValidator
from django.db import models
from django.urls import reverse
from django.utils.text import slugify

from core.choices import MATERIALS, SEGMENTS, TECHNOLOGIES
from orders.pricing import selling_price


class Category(models.Model):
    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=110, unique=True, blank=True)
    segment = models.CharField(max_length=10, choices=SEGMENTS, default="decor")
    description = models.CharField(max_length=250, blank=True)
    icon = models.CharField(max_length=40, default="box", help_text="Bootstrap icon name, e.g. lamp, gear, gift")
    sort_order = models.PositiveSmallIntegerField(default=10)

    class Meta:
        ordering = ["sort_order", "name"]
        verbose_name_plural = "categories"

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)


class Product(models.Model):
    """A fixed-price item customers can order straight away (mainly home decor)."""

    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="products")
    name = models.CharField(max_length=150)
    slug = models.SlugField(max_length=170, unique=True, blank=True)
    sku = models.CharField("SKU", max_length=40, unique=True)
    short_description = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    dimensions = models.CharField(max_length=80, blank=True, help_text="e.g. 12 x 12 x 20 cm")
    vendor_price = models.DecimalField(
        max_digits=10, decimal_places=2, validators=[MinValueValidator(0)],
        help_text="What the vendor charges us per piece. The customer price adds our commission automatically.")
    price_override = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(0)],
        help_text="Optional: a rounded customer price (before GST) instead of the automatic one")
    technology = models.CharField(max_length=10, choices=TECHNOLOGIES, default="FDM")
    material = models.CharField(max_length=20, choices=MATERIALS, default="PLA")
    colours = models.CharField(max_length=150, blank=True, help_text="Comma-separated, e.g. White, Black, Terracotta")
    lead_time_days = models.PositiveIntegerField(default=5)
    min_quantity = models.PositiveIntegerField(default=1)
    hsn_code = models.CharField("HSN code", max_length=8, blank=True, help_text="Printed on the tax invoice")
    image = models.BinaryField(null=True, blank=True, editable=False)
    image_type = models.CharField(max_length=40, blank=True, editable=False)
    is_active = models.BooleanField("Published", default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["category__sort_order", "name"]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.name) or "product"
            slug, n = base, 2
            while Product.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                slug, n = f"{base}-{n}", n + 1
            self.slug = slug
        super().save(*args, **kwargs)

    def get_absolute_url(self):
        return reverse("catalog:detail", args=[self.slug])

    @property
    def price(self):
        """Customer price per piece, before GST."""
        if self.price_override is not None:
            return self.price_override
        return selling_price(self.vendor_price)

    @property
    def margin(self):
        return self.price - self.vendor_price

    @property
    def colour_list(self):
        return [c.strip() for c in self.colours.split(",") if c.strip()]

    @property
    def has_image(self):
        return bool(self.image_type)
