"""Order status rules and the single place where a status changes.

Who may move an order where is defined in the three tables below and enforced on
the server, so a hidden button can never be forced through.
"""
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from core.notify import notify, owners, staff_users

from .models import InvoiceSequence, Order, Payment, StatusEvent
from .pricing import selling_price

S = Order.Status
A = StatusEvent.Audience

STAFF_TRANSITIONS = {
    S.NEW: [S.PRICING, S.REJECTED, S.CANCELLED],
    S.PRICING: [S.QUOTED, S.REJECTED, S.CANCELLED],
    S.QUOTED: [S.AWAITING_PAYMENT, S.PRICING, S.CANCELLED],
    S.AWAITING_PAYMENT: [S.CANCELLED],
    S.CONFIRMED: [S.IN_PRODUCTION, S.CANCELLED],
    S.IN_PRODUCTION: [S.READY, S.CANCELLED],
    S.READY: [S.SHIPPED],
    S.SHIPPED: [S.DELIVERED],
}
VENDOR_TRANSITIONS = {
    S.CONFIRMED: [S.IN_PRODUCTION],
    S.IN_PRODUCTION: [S.READY],
    S.READY: [S.SHIPPED],
    S.SHIPPED: [S.DELIVERED],
}
CUSTOMER_TRANSITIONS = {
    S.NEW: [S.CANCELLED],
    S.PRICING: [S.CANCELLED],
    S.QUOTED: [S.AWAITING_PAYMENT, S.CANCELLED],
    S.AWAITING_PAYMENT: [S.CANCELLED],
}

CUSTOMER_TEXT = {
    S.PRICING: "is with our production team for pricing",
    S.QUOTED: "has a quote ready for your approval",
    S.AWAITING_PAYMENT: "is waiting for your payment",
    S.CONFIRMED: "is confirmed and scheduled for production",
    S.IN_PRODUCTION: "is now being printed",
    S.READY: "has passed quality check and is packed",
    S.SHIPPED: "has been shipped",
    S.DELIVERED: "has been delivered",
    S.CANCELLED: "was cancelled",
    S.REJECTED: "could not be accepted",
}

QUOTE_VALID_DAYS = 15


def can_view(order, user):
    if user.is_staff_member:
        return True
    if user.is_vendor:
        if not user.vendor_id or order.vendor_id != user.vendor_id:
            return False
        # A cancelled job stays visible to the vendor only if it had been released to production.
        return order.status in Order.VENDOR_STATUSES or (order.status == S.CANCELLED and bool(order.confirmed_at))
    return order.customer_id == user.pk


def allowed_transitions(order, user):
    if user.is_staff_member:
        table = STAFF_TRANSITIONS
    elif user.is_vendor and user.vendor_id and order.vendor_id == user.vendor_id:
        table = VENDOR_TRANSITIONS
    elif user.is_customer and order.customer_id == user.pk:
        table = CUSTOMER_TRANSITIONS
    else:
        return []
    moves = list(table.get(order.status, []))
    if S.QUOTED in moves and order.price is None:
        moves.remove(S.QUOTED)
    if S.CANCELLED in moves and order.status in (S.CONFIRMED, S.IN_PRODUCTION) and not user.is_owner:
        moves.remove(S.CANCELLED)  # money and vendor work involved: owner decides
    return moves


def shipping_blocker(order, user):
    """Reason the order cannot ship yet, or ''."""
    if not order.is_fully_paid and not user.is_owner:
        return f"The balance of ₹{order.balance:,.2f} must be received and approved before dispatch."
    return ""


@transaction.atomic
def change_status(order, new_status, actor, note="", audience=A.ALL):
    old = order.status
    now = timezone.now()
    order.status = new_status
    if new_status == S.QUOTED:
        order.quoted_at = now
        order.quote_valid_until = timezone.localdate() + timedelta(days=QUOTE_VALID_DAYS)
    elif new_status == S.CONFIRMED and not order.confirmed_at:
        order.confirmed_at = now
    elif new_status == S.SHIPPED:
        order.shipped_at = order.shipped_at or now
        # Tax invoice numbers are issued only once the company is GST-registered.
        if not order.invoice_number and settings.COMPANY["gstin"]:
            order.invoice_date = timezone.localdate()
            order.invoice_number = InvoiceSequence.next_number(order.invoice_date)
    elif new_status == S.DELIVERED:
        order.delivered_at = now
    order.save()
    StatusEvent.objects.create(order=order, from_status=old, to_status=new_status, note=note[:500], actor=actor,
                               audience=audience)
    _notify(order, new_status, actor, note)
    return order


def _notify(order, status, actor, note):
    link = order.get_absolute_url()
    label = Order.Status(status).label
    recipients = []
    if status in CUSTOMER_TEXT:
        text = f"Your order {order.number} ({order.title}) {CUSTOMER_TEXT[status]}."
        if note and status in (S.QUOTED, S.CANCELLED, S.REJECTED, S.SHIPPED):
            text += f" {note}"
        if not actor or actor.pk != order.customer_id:
            notify([order.customer], f"{order.number}: {label}", text, link)
    vendor_users = list(order.vendor.members.filter(is_active=True)) if order.vendor else []
    if status == S.CONFIRMED:
        notify(vendor_users, f"New production job {order.number}",
               f"'{order.title}', quantity {order.quantity}. Please start production.", link)
    elif status == S.CANCELLED and order.confirmed_at:
        recipients += vendor_users
    if not actor or not actor.is_staff_member:
        recipients += list(staff_users())
    recipients = [u for u in recipients if not actor or u.pk != actor.pk]
    notify(recipients, f"{order.number}: {label}", f"{order.title}: {label}. {note}".strip(), link)


@transaction.atomic
def send_for_pricing(order, actor, vendor, note=""):
    order.vendor = vendor
    order.save(update_fields=["vendor"])
    change_status(order, S.PRICING, actor, note or "Sent to production for pricing", audience=A.STAFF)
    managers = vendor.members.filter(is_active=True, vendor_manager=True)
    notify(managers, f"Price needed: {order.number}",
           f"Please quote for '{order.title}', quantity {order.quantity}. {note}".strip(), order.get_absolute_url())


@transaction.atomic
def set_vendor_price(order, actor, vendor_price, lead_days, note=""):
    order.vendor_price = vendor_price
    order.vendor_lead_days = lead_days
    order.vendor_note = note
    order.price = selling_price(vendor_price)
    order.save()
    StatusEvent.objects.create(order=order, from_status=order.status, to_status=order.status, actor=actor,
                               audience=A.VENDOR, note=f"Vendor price entered, {lead_days} day(s) lead time")
    if actor.is_vendor:
        notify(staff_users(), f"Price ready: {order.number}",
               f"Production has priced '{order.title}'. Review and send the quote.", order.get_absolute_url())


@transaction.atomic
def decide_payment(payment, actor, approve, note=""):
    payment.status = Payment.Status.APPROVED if approve else Payment.Status.REJECTED
    payment.decided_by = actor
    payment.decided_at = timezone.now()
    if note:
        payment.note = note[:300]
    payment.save()
    order = payment.order
    if approve:
        notify([order.customer], f"Payment received for {order.number}",
               f"We have received ₹{payment.amount:,.2f} (ref {payment.reference}). Thank you.", order.get_absolute_url())
        if order.status == S.AWAITING_PAYMENT and order.is_released:
            msg = "Advance received" if not order.is_fully_paid else "Payment received"
            change_status(order, S.CONFIRMED, actor, f"{msg}. Released to production.")
    else:
        notify([order.customer], f"Payment not verified for {order.number}",
               f"We could not match the payment with reference {payment.reference}. {note}".strip(),
               order.get_absolute_url())
    notify([u for u in staff_users() if u.pk != actor.pk], f"Payment {payment.get_status_display().lower()}: {order.number}",
           f"₹{payment.amount:,.2f}, ref {payment.reference}", order.get_absolute_url())


def payment_recorded(payment):
    order = payment.order
    notify(owners(), f"Approve payment: {order.number}",
           f"₹{payment.amount:,.2f} by {payment.get_method_display()}, ref {payment.reference}. Check the bank statement and approve.",
           order.get_absolute_url() + "#payments")
