from django.conf import settings
from django.core.management.base import BaseCommand

from accounts.models import User, VendorProfile
from catalog.models import Category, Product

CATEGORIES = [
    ("Lamps and lighting", "decor", "lamp", 1, "Lamp shades, night lamps and lithophanes"),
    ("Planters and vases", "decor", "flower1", 2, "Planters, vases and desk greenery"),
    ("Idols and figurines", "decor", "stars", 3, "Idols, miniatures and collectibles"),
    ("Name plates and gifts", "decor", "gift", 4, "Personalised name plates, keychains and gifts"),
    ("Industrial parts", "mass", "gear", 5, "Jigs, fixtures, enclosures and spare parts"),
    ("Prototypes", "custom", "rulers", 6, "Concept and functional prototypes"),
    ("Medical models", "medical", "heart-pulse", 7, "Anatomical and planning models"),
]

# Draft products so the owner sees how the shop looks. They stay hidden from
# customers until the owner sets real vendor prices and ticks "Published".
SAMPLES = [
    ("Lamps and lighting", "Spiral table lamp shade", "DEC-LAMP-01", "Parametric spiral shade for E27 bulbs",
     "20 x 20 x 22 cm", 900, "White, Warm white, Black"),
    ("Planters and vases", "Geometric desk planter", "DEC-PLNT-01", "Faceted planter with drainage tray",
     "12 x 12 x 11 cm", 350, "White, Terracotta, Sage green"),
    ("Idols and figurines", "Ganesha idol, matte finish", "DEC-IDOL-01", "Detailed idol printed in fine resin",
     "8 x 6 x 12 cm", 650, "Gold, Ivory, Bronze"),
    ("Name plates and gifts", "Custom house name plate", "DEC-NAME-01", "Raised-letter name plate, your text",
     "30 x 10 cm", 800, "Black on white, Gold on black"),
]


class Command(BaseCommand):
    help = "Create the owner login, starter categories and draft products (safe to run repeatedly)."

    def handle(self, *args, **options):
        if settings.OWNER_EMAIL and settings.OWNER_PASSWORD and not User.objects.filter(role=User.Role.OWNER).exists():
            email = settings.OWNER_EMAIL.strip().lower()
            owner = User(username=email, email=email, first_name="Owner", role=User.Role.OWNER, is_superuser=True)
            owner.set_password(settings.OWNER_PASSWORD)
            owner.save()
            self.stdout.write(f"Owner login created for {email}")
        if not VendorProfile.objects.exists():
            VendorProfile.objects.create(company_name="Production partner", is_default=True,
                                         notes="Edit with the vendor's real details before go-live.")
        for name, seg, icon, order, desc in CATEGORIES:
            Category.objects.get_or_create(name=name, defaults={
                "segment": seg, "icon": icon, "sort_order": order, "description": desc})
        if not Product.objects.exists():
            for cat, name, sku, short, dims, vendor_price, colours in SAMPLES:
                Product.objects.create(
                    category=Category.objects.get(name=cat), name=name, sku=sku, short_description=short,
                    dimensions=dims, vendor_price=vendor_price, colours=colours, is_active=False,
                    description="Sample product. Replace the photo, price and text, then tick Published.")
