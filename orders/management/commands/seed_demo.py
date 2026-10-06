"""Demo data for trying the portal on a laptop. Never run this on the live site."""
from decimal import Decimal

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from accounts.models import User, VendorProfile
from catalog.models import Product
from orders.models import Order, OrderItem, Payment, StatusEvent
from orders.workflow import change_status, decide_payment, send_for_pricing, set_vendor_price

PASSWORD = "Demo@12345"
S = Order.Status


def user(username, role, first, last="", **extra):
    u, _ = User.objects.get_or_create(username=username, defaults={
        "email": f"{username}@example.com", "first_name": first, "last_name": last, "role": role, **extra})
    u.set_password(PASSWORD)
    u.save()
    return u


class Command(BaseCommand):
    help = "Load demo users and orders (local testing only)."

    def add_arguments(self, parser):
        parser.add_argument("--force", action="store_true", help="Allow running with DEBUG off")

    def handle(self, *args, **options):
        if not settings.DEBUG and not options["force"]:
            raise CommandError("Refusing to load demo data with DEBUG off. Use --force if you are sure.")
        call_command("setup_portal")
        vendor = VendorProfile.default()
        vendor.company_name, vendor.contact_person = "Demo Print Works", "Ravi"
        vendor.save()
        owner = user("owner", User.Role.OWNER, "Akash", "Owner", is_superuser=True)
        ops = user("ops", User.Role.OPS, "Neha", "Support")
        vm = user("vendor", User.Role.VENDOR, "Ravi", "Manager", vendor=vendor, vendor_manager=True)
        user("vendorstaff", User.Role.VENDOR, "Sunil", "Dispatch", vendor=vendor)
        cust = user("customer", User.Role.CUSTOMER, "Priya", "Shah", company="Shah Robotics", phone="9820012345",
                    address="12 Link Road, Andheri West", city="Mumbai", state="Maharashtra", pincode="400053")
        Product.objects.update(is_active=True)
        if Order.objects.exists():
            self.stdout.write("Orders already exist; users refreshed.")
            return
        ship = dict(ship_name="Priya Shah", ship_phone="9820012345", ship_address="12 Link Road, Andheri West",
                    ship_city="Mumbai", ship_state="Maharashtra", ship_pincode="400053", bill_company="Shah Robotics")

        def custom(title, segment, qty, **kw):
            o = Order.objects.create(customer=cust, title=title, segment=segment, quantity=qty,
                                     description="Demo request", **ship, **kw)
            StatusEvent.objects.create(order=o, to_status=S.NEW, actor=cust, audience="customer")
            return o

        custom("Robot arm gripper prototype", "custom", 2, material="PETG")
        o = custom("Sensor housing, batch of 500", "mass", 500, technology="MJF", material="NYLON")
        send_for_pricing(o, ops, vendor)
        set_vendor_price(o, vm, Decimal("60000"), 12, "Nylon PA12, dyed black")
        o = custom("Knee joint model for training", "medical", 1, technology="SLA")
        send_for_pricing(o, ops, vendor)
        set_vendor_price(o, vm, Decimal("4200"), 4)
        change_status(o, S.QUOTED, ops, "Total including GST", audience="customer")

        p = Product.objects.order_by("pk").first()
        o = Order.objects.create(customer=cust, order_type="catalog", segment="decor", title=p.name, quantity=2,
                                 price=p.price * 2, vendor_price=p.vendor_price * 2, vendor=vendor,
                                 status=S.AWAITING_PAYMENT, **ship)
        OrderItem.objects.create(order=o, product=p, quantity=2, unit_price=p.price, unit_vendor_price=p.vendor_price)
        pay = Payment.objects.create(order=o, amount=o.total, reference="UTR412345678901", paid_on=timezone.localdate(),
                                     recorded_by=cust)
        decide_payment(pay, owner, True)
        change_status(o, S.IN_PRODUCTION, vm)
        change_status(o, S.READY, vm)
        o.courier, o.tracking_number = "Delhivery", "DLV1234567890"
        change_status(o, S.SHIPPED, vm, "Delhivery, AWB DLV1234567890")
        change_status(o, S.DELIVERED, vm)
        self.stdout.write(self.style.SUCCESS(
            f"Demo ready. Logins (password {PASSWORD}): owner, ops, vendor, vendorstaff, customer"))
