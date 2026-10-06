import csv
import io
from datetime import date
from decimal import Decimal
from urllib.parse import quote

import segno
from django.conf import settings
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import PermissionDenied
from django.core.paginator import Paginator
from django.db import transaction
from django.db.models import Q, Sum
from django.http import Http404, HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from django.views.decorators.http import require_POST

from accounts.models import User, VendorProfile
from catalog.models import Product
from core.decorators import customer_required, owner_required, staff_required
from core.notify import absolute, notify, send_email, staff_users

from .forms import (
    CatalogOrderForm, CustomerRequestForm, GuestRequestForm, MessageForm, OwnerPriceForm, PaymentForm, PayoutForm,
    QCPhotoForm, QuoteForm, SendForPricingForm, StatusForm, UploadForm, VendorPriceForm, shipping_initial,
)
from .forms import ACCEPT
from .models import Message, Order, OrderFile, OrderItem, Payment, StatusEvent, VendorPayout
from .validators import file_kind
from .workflow import (
    allowed_transitions, can_view, change_status, decide_payment, payment_recorded, send_for_pricing,
    set_vendor_price, shipping_blocker,
)

S = Order.Status
A = StatusEvent.Audience


def visible_orders(user):
    qs = Order.objects.select_related("customer", "vendor")
    if user.is_staff_member:
        return qs
    if user.is_vendor:
        if not user.vendor_id:
            return qs.none()
        return qs.filter(vendor_id=user.vendor_id).filter(
            Q(status__in=Order.VENDOR_STATUSES) | Q(status=S.CANCELLED, confirmed_at__isnull=False))
    return qs.filter(customer=user)


def get_order(user, pk):
    order = get_object_or_404(Order.objects.select_related("customer", "vendor"), pk=pk)
    if not can_view(order, user):
        raise Http404
    return order


def _save_files(order, files, user):
    for f in files:
        OrderFile.from_upload(order, f, user, file_kind(f.name))


def _save_profile_defaults(user, data):
    """Remember the first delivery address so the next order is pre-filled."""
    if user.address:
        return
    user.address, user.city, user.state, user.pincode = (
        data["ship_address"], data["ship_city"], data["ship_state"], data["ship_pincode"])
    user.phone = user.phone or data["ship_phone"]
    user.company = user.company or data.get("bill_company", "")
    user.gstin = user.gstin or data.get("bill_gstin", "")
    user.save()


# --------------------------------------------------------------------------- ordering

@login_required
def create_catalog_order(request, slug):
    if not request.user.is_customer:
        messages.info(request, "Only customer accounts can place orders.")
        return redirect("catalog:detail", slug=slug)
    product = get_object_or_404(Product, slug=slug, is_active=True)
    form = CatalogOrderForm(request.POST or None, product=product, initial=shipping_initial(request.user))
    if request.method == "POST" and form.is_valid():
        data = form.cleaned_data
        qty = data["quantity"]
        with transaction.atomic():
            order = form.save(commit=False)
            order.customer = request.user
            order.order_type = Order.Type.CATALOG
            order.segment = product.category.segment
            order.title = product.name
            order.description = data["notes"]
            order.technology, order.material = product.technology, product.material
            order.price = product.price * qty
            order.vendor_price = product.vendor_price * qty
            order.vendor_lead_days = product.lead_time_days
            order.vendor = VendorProfile.default()
            order.status = S.AWAITING_PAYMENT
            order.save()
            OrderItem.objects.create(order=order, product=product, quantity=qty, unit_price=product.price,
                                     unit_vendor_price=product.vendor_price, colour=data["colour"])
            StatusEvent.objects.create(order=order, to_status=S.AWAITING_PAYMENT, actor=request.user,
                                       note="Order placed", audience=A.CUSTOMER)
            _save_profile_defaults(request.user, data)
        notify(staff_users(), f"New order {order.number}",
               f"{request.user.display_name} ordered {qty} x {product.name}.", order.get_absolute_url())
        messages.success(request, f"Order {order.number} placed. Please complete the payment to confirm it.")
        return redirect(order)
    return render(request, "orders/catalog_checkout.html", {"product": product, "form": form})


def request_quote(request):
    """Custom, mass-manufacturing and medical requests. Works for guests and signed-in customers."""
    user = request.user
    if user.is_authenticated and not user.is_customer:
        messages.info(request, "Quote requests are made from a customer account.")
        return redirect("core:dashboard")
    form_class = CustomerRequestForm if user.is_authenticated else GuestRequestForm
    initial = {"segment": request.GET.get("segment", "custom"), "quantity": 1, **shipping_initial(user)}
    form = form_class(request.POST or None, request.FILES or None, initial=initial)
    if request.method == "POST" and form.is_valid():
        data = form.cleaned_data
        created_account = False
        with transaction.atomic():
            if user.is_authenticated:
                customer = user
            else:
                customer = User.objects.filter(email__iexact=data["email"]).first()
                if customer and not customer.is_customer:
                    form.add_error("email", "This email belongs to a staff or vendor login. Use another email.")
                    return render(request, "orders/request_quote.html", {"form": form})
                if not customer:
                    first, _, last = data["name"].strip().partition(" ")
                    customer = User(username=data["email"], email=data["email"], first_name=first[:150],
                                    last_name=last[:150], phone=data["phone"], company=data.get("company", ""),
                                    role=User.Role.CUSTOMER, accepted_terms_at=timezone.now())
                    customer.set_unusable_password()
                    customer.save()
                    created_account = True
            order = form.save(commit=False)
            order.customer = customer
            order.order_type = Order.Type.CUSTOM
            order.status = S.NEW
            order.save()
            _save_files(order, data["files"], customer)
            StatusEvent.objects.create(order=order, to_status=S.NEW, actor=customer, audience=A.CUSTOMER,
                                       note="Request submitted" + ("" if user.is_authenticated else " without signing in"))
            _save_profile_defaults(customer, data)
        notify(staff_users(), f"New {order.get_segment_display().lower()} request {order.number}",
               f"{customer.display_name}: '{order.title}', qty {order.quantity}, {order.files.count()} file(s).",
               order.get_absolute_url())
        if created_account:
            _send_set_password_email(request, customer, order)
        else:
            send_email(customer.email, f"We received your request {order.number}",
                       f"Thank you. We have received '{order.title}' and will send you a quote soon.\n\n"
                       f"Track it here: {absolute(order.get_absolute_url())}")
        if user.is_authenticated:
            messages.success(request, f"Request {order.number} sent. We will review your files and send a quote.")
            return redirect(order)
        return render(request, "orders/request_sent.html", {"order": order, "created_account": created_account})
    return render(request, "orders/request_quote.html", {"form": form})


def _send_set_password_email(request, user, order):
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    link = absolute(reverse("accounts:password_reset_confirm", args=[uid, token]))
    send_email(user.email, f"We received your request {order.number}",
               f"Hello {user.first_name},\n\nThank you for your request '{order.title}' ({order.number}). "
               f"Our team will review it and send you a quote.\n\n"
               f"To track it and approve the quote online, set a password for your account here:\n{link}\n\n"
               f"{settings.PORTAL_NAME}")


# --------------------------------------------------------------------------- lists and detail

@login_required
def order_list(request):
    orders = visible_orders(request.user)
    q = request.GET.get("q", "").strip()
    status = request.GET.get("status", "")
    segment = request.GET.get("segment", "")
    scope = request.GET.get("scope", "")
    if q:
        filt = Q(number__icontains=q) | Q(title__icontains=q) | Q(tracking_number__icontains=q)
        if request.user.is_staff_member:
            filt |= (Q(customer__first_name__icontains=q) | Q(customer__last_name__icontains=q)
                     | Q(customer__email__icontains=q) | Q(customer__company__icontains=q) | Q(ship_phone__icontains=q))
        orders = orders.filter(filt)
    if status:
        orders = orders.filter(status=status)
    if segment:
        orders = orders.filter(segment=segment)
    if scope == "open":
        orders = orders.filter(status__in=Order.OPEN_STATUSES)
    elif scope == "closed":
        orders = orders.filter(status__in=Order.CLOSED_STATUSES)
    elif scope == "payments":
        orders = orders.filter(payments__status=Payment.Status.PENDING).distinct()
    page = Paginator(orders, 20).get_page(request.GET.get("page"))
    params = request.GET.copy()
    params.pop("page", None)
    return render(request, "orders/order_list.html", {
        "page": page, "q": q, "status": status, "segment": segment, "scope": scope,
        "statuses": S.choices, "querystring": params.urlencode(),
    })


def _action_buttons(order, user, transitions):
    """One-click buttons for customers and vendors: (status, label, style, icon, needs confirm)."""
    out = []
    for t in transitions:
        if t == S.AWAITING_PAYMENT:
            out.append((t, "Accept quote", "success", "check2-circle", False))
        elif t == S.CANCELLED:
            out.append((t, "Cancel" if user.is_customer else "Cancel order", "outline-danger", "x-circle", True))
        elif t == S.IN_PRODUCTION:
            out.append((t, "Start production", "primary", "play-circle", False))
        elif t == S.READY:
            out.append((t, "Printing and QC done, packed", "primary", "box-seam", False))
        elif t == S.DELIVERED:
            out.append((t, "Mark delivered", "success", "check2-all", False))
    return out


@login_required
def order_detail(request, pk):
    order = get_order(request.user, pk)
    user = request.user
    transitions = allowed_transitions(order, user)
    chat = order.messages.select_related("author")
    if user.is_customer:
        chat = chat.filter(channel=Message.Channel.CUSTOMER)
    elif user.is_vendor:
        chat = chat.filter(channel=Message.Channel.VENDOR)
    events = order.events.select_related("actor")
    if user.is_customer:
        events = events.filter(audience__in=[A.ALL, A.CUSTOMER])
    elif user.is_vendor:
        events = events.filter(audience__in=[A.ALL, A.VENDOR])
    files = order.files.defer("data").select_related("uploaded_by")
    ctx = {
        "order": order,
        "items": order.items.select_related("product"),
        "files": files,
        "events": events,
        "chat": chat,
        "message_form": MessageForm(initial={"channel": Message.Channel.CUSTOMER}),
        "upload_form": UploadForm(),
        "upload_accept": ACCEPT,
        "transitions": transitions,
        "show_prices": not user.is_vendor,
        "show_vendor_price": user.sees_vendor_price,
        "payments": order.payments.select_related("recorded_by", "decided_by").defer("proof") if not user.is_vendor else [],
        "BANK": settings.BANK,
    }
    if user.is_staff_member:
        ctx["status_form"] = StatusForm(transitions=transitions, initial={
            "courier": order.courier, "tracking_number": order.tracking_number, "tracking_url": order.tracking_url})
        if order.status == S.NEW:
            ctx["pricing_form"] = SendForPricingForm(initial={"vendor": order.vendor or VendorProfile.default()})
        if order.status in (S.PRICING, S.QUOTED) and order.price is not None:
            ctx["quote_form"] = QuoteForm()
        if user.is_owner and order.status in (S.NEW, S.PRICING, S.QUOTED):
            ctx["vendor_price_form"] = VendorPriceForm(initial={
                "vendor_price": order.vendor_price, "lead_days": order.vendor_lead_days, "note": order.vendor_note})
            ctx["owner_price_form"] = OwnerPriceForm(initial={"price": order.price})
    else:
        ctx["action_buttons"] = _action_buttons(order, user, transitions)
    if user.is_vendor and user.vendor_manager and order.status == S.PRICING:
        ctx["vendor_price_form"] = VendorPriceForm(initial={
            "vendor_price": order.vendor_price, "lead_days": order.vendor_lead_days, "note": order.vendor_note})
    if user.is_vendor and S.SHIPPED in transitions:
        ctx["ship_form"] = StatusForm(transitions=[S.SHIPPED], initial={"status": S.SHIPPED})
        ctx["ship_blocker"] = shipping_blocker(order, user)
        ctx["qc_form"] = QCPhotoForm()
    if user.is_vendor and order.status in (S.IN_PRODUCTION, S.READY):
        ctx["qc_form"] = QCPhotoForm()
    if (user.is_customer or user.is_staff_member) and order.total is not None and not order.is_fully_paid \
            and order.status in (S.AWAITING_PAYMENT, S.CONFIRMED, S.IN_PRODUCTION, S.READY, S.SHIPPED, S.DELIVERED):
        ctx["payment_form"] = PaymentForm(initial={"amount": order.amount_to_pay_now, "paid_on": timezone.localdate()})
    if user.is_staff_member and order.status == S.READY:
        ctx["ship_blocker"] = shipping_blocker(order, user)
    return render(request, "orders/order_detail.html", ctx)


# --------------------------------------------------------------------------- actions

@login_required
@require_POST
def order_status(request, pk):
    order = get_order(request.user, pk)
    transitions = allowed_transitions(order, request.user)
    form = StatusForm(request.POST, transitions=transitions)
    if not form.is_valid():
        for errs in form.errors.values():
            for e in errs:
                messages.error(request, e)
        return redirect(order)
    new = form.cleaned_data["status"]
    note = form.cleaned_data["note"]
    if new == S.SHIPPED:
        blocker = shipping_blocker(order, request.user)
        if blocker:
            messages.error(request, blocker)
            return redirect(order)
        order.courier = form.cleaned_data["courier"]
        order.tracking_number = form.cleaned_data["tracking_number"]
        order.tracking_url = form.cleaned_data["tracking_url"]
        note = note or f"{order.courier}, AWB {order.tracking_number}"
    audience = A.ALL
    if new in (S.PRICING,):
        audience = A.STAFF
    if request.user.is_customer and new == S.AWAITING_PAYMENT:
        note = note or "Quote accepted"
    change_status(order, new, request.user, note, audience=audience)
    messages.success(request, f"{order.number} is now '{order.get_status_display()}'.")
    return redirect(order)


@staff_required
@require_POST
def order_send_for_pricing(request, pk):
    order = get_object_or_404(Order, pk=pk, status=S.NEW)
    form = SendForPricingForm(request.POST)
    if form.is_valid():
        send_for_pricing(order, request.user, form.cleaned_data["vendor"], form.cleaned_data["note"])
        messages.success(request, f"{order.number} sent to production for pricing.")
    return redirect(order)


@login_required
@require_POST
def order_vendor_price(request, pk):
    order = get_order(request.user, pk)
    user = request.user
    allowed = user.is_owner or (user.is_vendor and user.vendor_manager and order.status == S.PRICING)
    if not allowed or order.status not in (S.NEW, S.PRICING, S.QUOTED):
        raise PermissionDenied
    form = VendorPriceForm(request.POST)
    if form.is_valid():
        if not order.vendor:
            order.vendor = VendorProfile.default()
        set_vendor_price(order, user, form.cleaned_data["vendor_price"], form.cleaned_data["lead_days"],
                         form.cleaned_data["note"])
        messages.success(request, "Price saved." + (" Our team will send the quote." if user.is_vendor else ""))
    else:
        messages.error(request, "Please enter a valid price and lead time.")
    return redirect(order)


@owner_required
@require_POST
def order_owner_price(request, pk):
    order = get_object_or_404(Order, pk=pk, status__in=[S.NEW, S.PRICING, S.QUOTED])
    form = OwnerPriceForm(request.POST)
    if form.is_valid():
        order.price = form.cleaned_data["price"]
        order.save(update_fields=["price", "updated_at"])
        StatusEvent.objects.create(order=order, from_status=order.status, to_status=order.status, actor=request.user,
                                   audience=A.STAFF, note=f"Customer price set to ₹{order.price:,.2f}")
        messages.success(request, "Customer price updated.")
    return redirect(order)


@staff_required
@require_POST
def order_send_quote(request, pk):
    order = get_object_or_404(Order, pk=pk, status__in=[S.PRICING, S.QUOTED])
    if order.price is None:
        messages.error(request, "The order has no price yet.")
        return redirect(order)
    form = QuoteForm(request.POST)
    note = form.data.get("note", "")[:400]
    total = order.total
    msg = f"Total ₹{total:,.2f} including GST."
    if order.needs_advance_only:
        msg += f" Advance of ₹{order.advance_due:,.2f} to start production, balance before dispatch."
    if order.vendor_lead_days:
        msg += f" Dispatch in about {order.vendor_lead_days} working days after payment."
    change_status(order, S.QUOTED, request.user, f"{msg} {note}".strip(), audience=A.CUSTOMER)
    messages.success(request, f"Quote sent to {order.customer.display_name}.")
    return redirect(order)


@login_required
@require_POST
def order_payment(request, pk):
    order = get_order(request.user, pk)
    if not (request.user.is_staff_member or request.user.is_customer):
        raise PermissionDenied
    form = PaymentForm(request.POST, request.FILES)
    if not form.is_valid():
        for field, errs in form.errors.items():
            for e in errs:
                messages.error(request, f"{form.fields[field].label if field in form.fields else ''}: {e}".lstrip(": "))
        return redirect(order.get_absolute_url() + "#payments")
    payment = form.save(commit=False)
    payment.order = order
    payment.recorded_by = request.user
    proof = form.cleaned_data.get("proof_file")
    if proof:
        payment.proof = b"".join(proof.chunks())
        payment.proof_name = proof.name[:255]
        payment.proof_type = (proof.content_type or "application/octet-stream")[:100]
    payment.save()
    payment_recorded(payment)
    messages.success(request, "Payment details recorded. It will be confirmed once matched with the bank statement.")
    return redirect(order.get_absolute_url() + "#payments")


@owner_required
@require_POST
def payment_decide(request, pk):
    payment = get_object_or_404(Payment.objects.select_related("order"), pk=pk, status=Payment.Status.PENDING)
    approve = request.POST.get("decision") == "approve"
    decide_payment(payment, request.user, approve, request.POST.get("note", ""))
    messages.success(request, f"Payment {'approved' if approve else 'rejected'}.")
    return redirect(payment.order.get_absolute_url() + "#payments")


@login_required
def payment_proof(request, pk):
    payment = get_object_or_404(Payment.objects.select_related("order"), pk=pk)
    order = get_order(request.user, payment.order_id)
    if request.user.is_vendor or not payment.proof:
        raise Http404
    resp = HttpResponse(bytes(payment.proof), content_type=payment.proof_type or "application/octet-stream")
    resp["Content-Disposition"] = f'attachment; filename="{order.number}-payment-{payment.pk}"'
    return resp


@login_required
@require_POST
def order_message(request, pk):
    order = get_order(request.user, pk)
    user = request.user
    form = MessageForm(request.POST)
    if not form.is_valid():
        return redirect(order.get_absolute_url() + "#messages")
    if user.is_customer:
        channel = Message.Channel.CUSTOMER
    elif user.is_vendor:
        channel = Message.Channel.VENDOR
    else:
        channel = form.cleaned_data["channel"] or Message.Channel.CUSTOMER
        if channel == Message.Channel.VENDOR and not order.vendor:
            messages.error(request, "This order has no vendor yet.")
            return redirect(order.get_absolute_url() + "#messages")
    body = form.cleaned_data["body"]
    Message.objects.create(order=order, author=user, body=body, channel=channel)
    recipients = list(staff_users())
    if channel == Message.Channel.CUSTOMER:
        recipients.append(order.customer)
    elif channel == Message.Channel.VENDOR:
        recipients += list(order.vendor.members.filter(is_active=True))
    recipients = [u for u in recipients if u.pk != user.pk]
    sender = settings.PORTAL_NAME if (user.is_staff_member and channel == Message.Channel.CUSTOMER) else user.display_name
    if user.is_vendor:
        sender = "Production"
    notify(recipients, f"New message on {order.number}", f"{sender}: {body[:200]}",
           order.get_absolute_url() + "#messages")
    return redirect(order.get_absolute_url() + "#messages")


@login_required
@require_POST
def order_upload(request, pk):
    order = get_order(request.user, pk)
    if request.user.is_vendor:
        form = QCPhotoForm(request.POST, request.FILES)
        if form.is_valid():
            OrderFile.from_upload(order, form.cleaned_data["photo"], request.user, OrderFile.Kind.QC_PHOTO)
            messages.success(request, "Photo uploaded.")
        else:
            for e in form.errors.get("photo", []):
                messages.error(request, e)
        return redirect(order.get_absolute_url() + "#files")
    form = UploadForm(request.POST, request.FILES)
    if form.is_valid():
        _save_files(order, form.cleaned_data["files"], request.user)
        messages.success(request, f"{len(form.cleaned_data['files'])} file(s) uploaded.")
    else:
        for e in form.errors.get("files", []):
            messages.error(request, e)
    return redirect(order.get_absolute_url() + "#files")


@login_required
def download_file(request, pk):
    f = get_object_or_404(OrderFile.objects.only("order_id"), pk=pk)
    get_order(request.user, f.order_id)
    f = OrderFile.objects.get(pk=pk)
    resp = HttpResponse(bytes(f.data), content_type="application/octet-stream")
    resp["Content-Disposition"] = f'attachment; filename="{f.name}"'
    return resp


@login_required
def invoice(request, pk):
    order = get_order(request.user, pk)
    if request.user.is_vendor or order.price is None:
        raise Http404
    tax = order.tax
    items = list(order.items.select_related("product"))
    lines = [{
        "description": f"{i.product.name}{' (' + i.colour + ')' if i.colour else ''}",
        "hsn": i.product.hsn_code, "qty": i.quantity, "rate": i.unit_price, "amount": i.line_total,
    } for i in items] or [{
        "description": f"{order.title}: 3D printed parts as per approved design", "hsn": "",
        "qty": order.quantity, "rate": (order.price / order.quantity).quantize(Decimal("0.01")), "amount": order.price,
    }]
    is_tax_invoice = bool(order.invoice_number and settings.COMPANY["gstin"])
    return render(request, "orders/invoice.html", {
        "order": order, "tax": tax, "lines": lines, "is_tax_invoice": is_tax_invoice,
        "is_proforma": not is_tax_invoice and order.status not in (S.NEW, S.PRICING, S.QUOTED), "BANK": settings.BANK,
        "today": timezone.localdate(),
    })


@login_required
def upi_qr(request, pk):
    order = get_order(request.user, pk)
    upi = settings.BANK["upi_id"]
    if not upi or request.user.is_vendor or order.amount_to_pay_now is None:
        raise Http404
    payee = settings.COMPANY["legal_name"] or settings.PORTAL_NAME
    uri = f"upi://pay?pa={quote(upi)}&pn={quote(payee)}&am={order.amount_to_pay_now:.2f}&cu=INR&tn={quote(order.number)}"
    buf = io.BytesIO()
    segno.make(uri, error="m").save(buf, kind="svg", scale=5, border=2)
    return HttpResponse(buf.getvalue(), content_type="image/svg+xml")


# --------------------------------------------------------------------------- reports

@staff_required
def export_csv(request):
    owner = request.user.is_owner
    response = HttpResponse(content_type="text/csv")
    response["Content-Disposition"] = f'attachment; filename="orders-{timezone.localdate()}.csv"'
    writer = csv.writer(response)
    head = ["Order", "Created", "Type", "Segment", "Status", "Customer", "Email", "Phone", "Company", "GSTIN",
            "Title", "Qty", "Price before GST", "GST", "Total", "Paid", "Ship state", "Courier", "AWB",
            "Invoice", "Delivered"]
    if owner:
        head += ["Vendor", "Vendor price", "Margin"]
    writer.writerow(head)
    for o in Order.objects.select_related("customer", "vendor"):
        row = [o.number, timezone.localtime(o.created_at).strftime("%Y-%m-%d"), o.get_order_type_display(),
               o.get_segment_display(), o.get_status_display(), o.customer.display_name, o.customer.email,
               o.ship_phone, o.bill_company, o.bill_gstin, o.title, o.quantity, o.price or "",
               o.tax["tax"] if o.price is not None else "", o.total or "", o.amount_paid, o.ship_state, o.courier,
               o.tracking_number, o.invoice_number,
               timezone.localtime(o.delivered_at).strftime("%Y-%m-%d") if o.delivered_at else ""]
        if owner:
            row += [o.vendor.company_name if o.vendor else "", o.vendor_price or "", o.margin or ""]
        writer.writerow(row)
    return response


def _month(request):
    try:
        y, m = map(int, request.GET.get("month", "").split("-"))
        return date(y, m, 1)
    except ValueError:
        today = timezone.localdate()
        return date(today.year, today.month, 1)


def _next_month(d):
    return date(d.year + (d.month == 12), d.month % 12 + 1, 1)


@login_required
def vendor_statement(request):
    user = request.user
    if user.is_owner:
        vendor = get_object_or_404(VendorProfile, pk=request.GET.get("vendor")) if request.GET.get("vendor") \
            else VendorProfile.default()
    elif user.is_vendor and user.vendor_manager:
        vendor = user.vendor
    else:
        raise PermissionDenied
    if not vendor:
        messages.info(request, "Add your vendor first.")
        return redirect("accounts:vendor_list")
    start = _month(request)
    end = _next_month(start)
    orders = Order.objects.filter(vendor=vendor, status=S.DELIVERED, delivered_at__date__gte=start,
                                  delivered_at__date__lt=end).order_by("delivered_at")
    vendor_total = orders.aggregate(s=Sum("vendor_price"))["s"] or Decimal("0")
    payouts = VendorPayout.objects.filter(vendor=vendor, period=start)
    paid = payouts.aggregate(s=Sum("amount"))["s"] or Decimal("0")
    form = PayoutForm(request.POST or None, initial={"amount": vendor_total - paid, "paid_on": timezone.localdate()})
    if request.method == "POST":
        if not user.is_owner:
            raise PermissionDenied
        if form.is_valid():
            payout = form.save(commit=False)
            payout.vendor, payout.period, payout.recorded_by = vendor, start, user
            payout.save()
            notify(vendor.members.filter(vendor_manager=True, is_active=True), "Payment sent",
                   f"₹{payout.amount:,.2f} for {start:%B %Y}, ref {payout.reference}.",
                   reverse("orders:vendor_statement") + f"?month={start:%Y-%m}")
            messages.success(request, "Payout recorded.")
            return redirect(reverse("orders:vendor_statement") + f"?month={start:%Y-%m}&vendor={vendor.pk}")
    if request.GET.get("format") == "csv":
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="vendor-statement-{start:%Y-%m}.csv"'
        w = csv.writer(response)
        w.writerow(["Order", "Item", "Qty", "Delivered", "Vendor price"] + (["Our price", "Margin"] if user.is_owner else []))
        for o in orders:
            w.writerow([o.number, o.title, o.quantity, timezone.localtime(o.delivered_at).date(), o.vendor_price]
                       + ([o.price, o.margin] if user.is_owner else []))
        w.writerow(["Total", "", "", "", vendor_total])
        return response
    months = [start]
    for _ in range(11):
        prev = months[-1]
        months.append(date(prev.year - (prev.month == 1), (prev.month - 2) % 12 + 1, 1))
    return render(request, "orders/vendor_statement.html", {
        "vendor": vendor, "orders": orders, "vendor_total": vendor_total, "payouts": payouts, "paid": paid,
        "due": vendor_total - paid, "start": start, "pay_by": date(end.year, end.month, 7), "form": form,
        "months": months, "vendors": VendorProfile.objects.all() if user.is_owner else None,
        "our_total": orders.aggregate(s=Sum("price"))["s"] or Decimal("0"),
    })
