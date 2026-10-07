from datetime import date
from decimal import Decimal

from django.conf import settings
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from accounts.models import LoginAttempt, User, VendorProfile
from catalog.models import Category, Product

from .models import InvoiceSequence, Message, Order, Payment
from .pricing import advance_required, gst_split, selling_price

S = Order.Status
PW = "Str0ng-pass-123"

SHIP = {
    "ship_name": "Priya Shah", "ship_phone": "9820012345", "ship_address": "12 Link Road",
    "ship_city": "Mumbai", "ship_state": "Maharashtra", "ship_pincode": "400053",
}


def make_user(username, role, **extra):
    u = User(username=username, email=f"{username}@example.com", first_name=username.title(), role=role, **extra)
    u.set_password(PW)
    u.save()
    return u


def stl_file(name="part.stl"):
    return SimpleUploadedFile(name, b"solid part\nendsolid part\n", content_type="model/stl")


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class PortalTestCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.vendor = VendorProfile.objects.create(company_name="Hidden Print Works", is_default=True)
        cls.owner = make_user("owner", User.Role.OWNER)
        cls.ops = make_user("ops", User.Role.OPS)
        cls.vm = make_user("vm", User.Role.VENDOR, vendor=cls.vendor, vendor_manager=True)
        cls.vs = make_user("vs", User.Role.VENDOR, vendor=cls.vendor)
        cls.cust = make_user("cust", User.Role.CUSTOMER)
        cls.other = make_user("other", User.Role.CUSTOMER)
        cat = Category.objects.create(name="Lamps", segment="decor")
        cls.product = Product.objects.create(category=cat, name="Lamp", sku="L1", short_description="A lamp",
                                             vendor_price=Decimal("1000"), colours="White, Black")

    def login(self, user):
        self.client.force_login(user)

    def custom_order(self, **kw):
        defaults = dict(customer=self.cust, title="Bracket", quantity=10, description="x", **SHIP)
        defaults.update(kw)
        return Order.objects.create(**defaults)


class PricingTests(TestCase):
    def test_commission_rounds_up(self):
        self.assertEqual(selling_price(Decimal("1000")), Decimal("1150"))
        self.assertEqual(selling_price(Decimal("999.99")), Decimal("1150"))

    def test_gst_split_by_state(self):
        intra = gst_split(Decimal("1000"), "Maharashtra")
        self.assertEqual((intra["cgst"], intra["sgst"], intra["igst"]), (Decimal("90"), Decimal("90"), 0))
        inter = gst_split(Decimal("1000"), "Karnataka")
        self.assertEqual((inter["cgst"], inter["igst"]), (0, Decimal("180.00")))

    def test_advance_only_for_large_orders(self):
        self.assertEqual(advance_required(Decimal("40000")), Decimal("40000"))
        self.assertEqual(advance_required(Decimal("60000")), Decimal("30000"))

    def test_invoice_numbers_follow_financial_year(self):
        self.assertEqual(InvoiceSequence.next_number(date(2026, 10, 6)), "INV/2026-27/0001")
        self.assertEqual(InvoiceSequence.next_number(date(2027, 3, 31)), "INV/2026-27/0002")
        self.assertEqual(InvoiceSequence.next_number(date(2027, 4, 1)), "INV/2027-28/0001")


class GuestQuoteTests(PortalTestCase):
    def test_guest_request_creates_account_and_emails_password_link(self):
        data = {"name": "Ravi Kumar", "email": "Ravi@Example.com", "phone": "+91 98200 11111", "segment": "custom",
                "title": "Drone frame", "description": "Carbon look", "quantity": 2, "finish": "raw",
                "accept_terms": "on", "files": [stl_file()], **SHIP}
        r = self.client.post(reverse("orders:request_quote"), data)
        self.assertContains(r, "we have your request")
        user = User.objects.get(email="ravi@example.com")
        self.assertTrue(user.is_customer)
        self.assertFalse(user.has_usable_password())
        order = user.orders.get()
        self.assertEqual(order.status, S.NEW)
        self.assertEqual(order.files.count(), 1)
        self.assertEqual(order.ship_phone, "9820012345")
        self.assertTrue(any("/accounts/password/reset/" in m.body for m in mail.outbox))

    def test_medical_request_needs_acknowledgement(self):
        data = {"name": "Dr A", "email": "a@example.com", "phone": "9820011111", "segment": "medical",
                "title": "Skull model", "description": "Planning", "quantity": 1, "finish": "raw",
                "accept_terms": "on", "file_link": "https://drive.google.com/x", **SHIP}
        r = self.client.post(reverse("orders:request_quote"), data)
        self.assertEqual(r.status_code, 200)
        self.assertFalse(Order.objects.exists())
        data["medical_ack"] = "on"
        self.client.post(reverse("orders:request_quote"), data)
        self.assertEqual(Order.objects.get().segment, "medical")

    def test_terms_must_be_accepted(self):
        data = {"name": "X", "email": "x@example.com", "phone": "9820011111", "segment": "custom", "title": "t",
                "description": "d", "quantity": 1, "finish": "raw", "file_link": "https://x.example.com", **SHIP}
        self.client.post(reverse("orders:request_quote"), data)
        self.assertFalse(Order.objects.exists())

    def test_guest_cannot_claim_existing_account_by_signup(self):
        r = self.client.post(reverse("accounts:signup"), {
            "first_name": "Evil", "email": "cust@example.com", "phone": "9820011111", "password1": PW,
            "password2": PW, "accept_terms": "on"})
        self.assertContains(r, "already exists")


class FullFlowTests(PortalTestCase):
    @override_settings(COMPANY={**settings.COMPANY, "gstin": "27AAACA1234A1Z5"})
    def test_custom_order_end_to_end(self):
        order = self.custom_order()
        # Ops sends to production for pricing
        self.login(self.ops)
        self.client.post(reverse("orders:send_for_pricing", args=[order.pk]), {"vendor": self.vendor.pk})
        order.refresh_from_db()
        self.assertEqual(order.status, S.PRICING)
        # Vendor staff cannot price; vendor manager can
        self.login(self.vs)
        self.assertEqual(self.client.post(reverse("orders:vendor_price", args=[order.pk]),
                                          {"vendor_price": "10000", "lead_days": 5}).status_code, 403)
        self.login(self.vm)
        self.client.post(reverse("orders:vendor_price", args=[order.pk]), {"vendor_price": "10000", "lead_days": 5})
        order.refresh_from_db()
        self.assertEqual(order.price, Decimal("11500"))
        self.assertEqual(order.total, Decimal("13570.00"))
        # Ops sends quote, customer accepts
        self.login(self.ops)
        self.client.post(reverse("orders:send_quote", args=[order.pk]), {"note": "Thanks"})
        self.login(self.cust)
        self.client.post(reverse("orders:status", args=[order.pk]), {"status": S.AWAITING_PAYMENT})
        order.refresh_from_db()
        self.assertEqual(order.status, S.AWAITING_PAYMENT)
        # Customer reports payment; ops cannot approve; owner approves -> confirmed
        self.client.post(reverse("orders:payment", args=[order.pk]), {
            "amount": "13570", "method": "upi", "reference": "UTR123", "paid_on": date.today().isoformat()})
        pay = Payment.objects.get()
        self.login(self.ops)
        self.assertEqual(self.client.post(reverse("orders:payment_decide", args=[pay.pk]),
                                          {"decision": "approve"}).status_code, 403)
        self.login(self.owner)
        self.client.post(reverse("orders:payment_decide", args=[pay.pk]), {"decision": "approve"})
        order.refresh_from_db()
        self.assertEqual(order.status, S.CONFIRMED)
        # Vendor produces and ships with AWB
        self.login(self.vs)
        for status in (S.IN_PRODUCTION, S.READY):
            self.client.post(reverse("orders:status", args=[order.pk]), {"status": status})
        r = self.client.post(reverse("orders:status", args=[order.pk]), {"status": S.SHIPPED})
        order.refresh_from_db()
        self.assertEqual(order.status, S.READY, "shipping without AWB must fail")
        self.client.post(reverse("orders:status", args=[order.pk]),
                         {"status": S.SHIPPED, "courier": "Delhivery", "tracking_number": "AWB1"})
        order.refresh_from_db()
        self.assertEqual(order.status, S.SHIPPED)
        self.assertTrue(order.invoice_number.startswith("INV/"))
        self.client.post(reverse("orders:status", args=[order.pk]), {"status": S.DELIVERED})
        order.refresh_from_db()
        self.assertEqual(order.status, S.DELIVERED)
        # Owner sees it in the vendor statement
        self.login(self.owner)
        r = self.client.get(reverse("orders:vendor_statement"))
        self.assertContains(r, order.number)
        self.assertEqual(r.context["vendor_total"], Decimal("10000"))

    def test_large_order_needs_only_advance_and_blocks_shipping_until_paid(self):
        order = self.custom_order(vendor=self.vendor, vendor_price=Decimal("60000"), price=Decimal("69000"),
                                  status=S.AWAITING_PAYMENT)
        self.assertTrue(order.needs_advance_only)
        Payment.objects.create(order=order, amount=order.advance_due, reference="A1", paid_on=date.today())
        self.login(self.owner)
        self.client.post(reverse("orders:payment_decide", args=[Payment.objects.get().pk]), {"decision": "approve"})
        order.refresh_from_db()
        self.assertEqual(order.status, S.CONFIRMED)
        order.status = S.READY
        order.save()
        self.login(self.vm)
        self.client.post(reverse("orders:status", args=[order.pk]),
                         {"status": S.SHIPPED, "courier": "DTDC", "tracking_number": "X1"})
        order.refresh_from_db()
        self.assertEqual(order.status, S.READY)

    def test_no_tax_invoice_number_before_gst_registration(self):
        order = self.custom_order(vendor=self.vendor, price=Decimal("100"), status=S.READY)
        Payment.objects.create(order=order, amount=order.total, reference="P", paid_on=date.today(), status="approved")
        self.login(self.vm)
        self.client.post(reverse("orders:status", args=[order.pk]),
                         {"status": S.SHIPPED, "courier": "DTDC", "tracking_number": "X1"})
        order.refresh_from_db()
        self.assertEqual((order.status, order.invoice_number), (S.SHIPPED, ""))
        self.login(self.cust)
        self.assertContains(self.client.get(reverse("orders:invoice", args=[order.pk])), "Proforma invoice")

    def test_catalog_order_prices_from_vendor_price(self):
        self.login(self.cust)
        r = self.client.post(reverse("orders:create_catalog", args=[self.product.slug]),
                             {"quantity": 2, "colour": "White", **SHIP})
        order = Order.objects.get()
        self.assertRedirects(r, order.get_absolute_url())
        self.assertEqual(order.status, S.AWAITING_PAYMENT)
        self.assertEqual(order.price, Decimal("2300"))
        self.assertEqual(order.vendor, self.vendor)


class PrivacyTests(PortalTestCase):
    def setUp(self):
        self.order = self.custom_order(vendor=self.vendor, vendor_price=Decimal("1000"), price=Decimal("1150"),
                                       status=S.CONFIRMED, bill_company="Secret Robotics")
        Message.objects.create(order=self.order, author=self.cust, body="Customer-only note", channel="customer")
        Message.objects.create(order=self.order, author=self.ops, body="Internal margin talk", channel="internal")

    def test_vendor_never_sees_customer_identity_or_selling_price(self):
        self.login(self.vs)
        r = self.client.get(self.order.get_absolute_url())
        self.assertEqual(r.status_code, 200)
        html = r.content.decode()
        for secret in ("cust@example.com", "Secret Robotics", "1,150", "1,357", "Customer-only note", "Internal margin"):
            self.assertNotIn(secret, html)
        self.assertIn("Priya Shah", html)  # recipient name is needed to ship
        self.assertEqual(self.client.get(reverse("orders:invoice", args=[self.order.pk])).status_code, 404)

    def test_vendor_staff_does_not_see_vendor_price_but_manager_does(self):
        self.login(self.vs)
        self.assertNotIn("1,000.00", self.client.get(self.order.get_absolute_url()).content.decode())
        self.login(self.vm)
        self.assertIn("1,000.00", self.client.get(self.order.get_absolute_url()).content.decode())

    def test_customer_never_sees_vendor(self):
        self.login(self.cust)
        html = self.client.get(self.order.get_absolute_url()).content.decode()
        self.assertNotIn("Hidden Print Works", html)
        self.assertNotIn("Internal margin", html)

    def test_ops_does_not_see_vendor_price_or_margin(self):
        self.login(self.ops)
        html = self.client.get(self.order.get_absolute_url()).content.decode()
        self.assertNotIn("Our margin", html)
        self.assertNotIn("Vendor price", html)
        self.assertNotIn("Vendor price", self.client.get(reverse("orders:export")).content.decode())

    def test_other_customer_cannot_open_order_or_files(self):
        self.login(self.other)
        self.assertEqual(self.client.get(self.order.get_absolute_url()).status_code, 404)

    def test_vendor_cannot_see_unreleased_orders(self):
        new = self.custom_order(vendor=self.vendor, status=S.QUOTED)
        self.login(self.vm)
        self.assertEqual(self.client.get(new.get_absolute_url()).status_code, 404)

    def test_only_owner_manages_team_and_products(self):
        self.login(self.ops)
        self.assertEqual(self.client.get(reverse("accounts:team")).status_code, 403)
        self.assertEqual(self.client.get(reverse("catalog:create")).status_code, 403)
        self.assertEqual(self.client.get("/admin/").status_code, 302)


class LoginTests(PortalTestCase):
    def test_login_with_email_and_lockout(self):
        r = self.client.post(reverse("accounts:login"), {"username": "cust@example.com", "password": PW})
        self.assertEqual(r.status_code, 302)
        self.client.logout()
        for _ in range(5):
            self.client.post(reverse("accounts:login"), {"username": "cust@example.com", "password": "wrong"})
        self.assertEqual(LoginAttempt.objects.count(), 5)
        r = self.client.post(reverse("accounts:login"), {"username": "cust@example.com", "password": PW})
        self.assertContains(r, "Too many failed attempts")


class PublicPagesTests(PortalTestCase):
    def test_public_pages_load(self):
        for url in ["/", "/solutions/medical/", "/terms/", "/privacy/", "/refunds/", "/shipping/", "/grievance/",
                    "/how-it-works/", "/contact/", "/catalog/", self.product.get_absolute_url(),
                    reverse("orders:request_quote")]:
            self.assertEqual(self.client.get(url).status_code, 200, url)

    def test_draft_products_hidden_from_public(self):
        self.product.is_active = False
        self.product.save()
        self.assertEqual(self.client.get(self.product.get_absolute_url()).status_code, 404)

    def test_grievance_is_acknowledged_by_email(self):
        self.client.post(reverse("core:grievance"), {"name": "A", "email": "a@example.com", "subject": "Late",
                                                     "details": "Parcel late"})
        self.assertTrue(any("received" in m.subject for m in mail.outbox))


class DemoDataButtonTests(TestCase):
    def test_owner_can_load_and_remove_demo_data(self):
        from accounts.models import User

        owner = User.objects.create_user("realowner", "boss@akriti.in", "Strong#Pass1", role=User.Role.OWNER)
        self.client.force_login(owner)
        r = self.client.post("/demo-data/", {"action": "load"}, follow=True)
        self.assertContains(r, "Demo data loaded")
        self.assertContains(r, "Remove")
        self.assertFalse(User.objects.filter(username="owner").exists())
        self.assertEqual(Order.objects.count(), 4)
        r = self.client.post("/demo-data/", {"action": "remove"}, follow=True)
        self.assertContains(r, "Demo data removed (4 orders")
        self.assertEqual(Order.objects.count(), 0)
        self.assertTrue(User.objects.filter(pk=owner.pk).exists())

    def test_non_owner_cannot_load_demo_data(self):
        from accounts.models import User

        ops = User.objects.create_user("ops1", "ops@akriti.in", "Strong#Pass1", role=User.Role.OPS)
        self.client.force_login(ops)
        self.assertEqual(self.client.post("/demo-data/", {"action": "load"}).status_code, 403)
        self.assertEqual(Order.objects.count(), 0)
