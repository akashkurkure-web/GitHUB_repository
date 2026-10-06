from django.conf import settings
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db.models import Count, Q, Sum
from django.http import Http404
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.http import require_POST

from catalog.models import Product
from orders.models import Order, Payment

from .choices import SEGMENT_INFO
from .decorators import staff_required
from .forms import GrievanceForm, GrievanceUpdateForm
from .models import Grievance
from .notify import notify, send_email, staff_users

S = Order.Status


def home(request):
    return render(request, "core/home.html", {
        "products": Product.objects.filter(is_active=True).select_related("category").defer("image")[:4],
    })


def segment(request, key):
    info = SEGMENT_INFO.get(key)
    if not info:
        raise Http404
    products = Product.objects.filter(is_active=True, category__segment=key).defer("image")[:8]
    return render(request, "core/segment.html", {"key": key, "info": info, "products": products})


def page(request, name):
    templates = {
        "how-it-works": "core/how_it_works.html", "contact": "core/contact.html",
        "privacy": "legal/privacy.html", "terms": "legal/terms.html", "refunds": "legal/refunds.html",
        "shipping": "legal/shipping.html",
    }
    if name not in templates:
        raise Http404
    return render(request, templates[name], {
        "COMMISSION": settings.COMMISSION_PERCENT, "ADVANCE_THRESHOLD": int(settings.ADVANCE_THRESHOLD),
        "ADVANCE_PERCENT": settings.ADVANCE_PERCENT, "updated": "6 October 2026",
    })


def grievance(request):
    form = GrievanceForm(request.POST or None, initial={
        "name": request.user.get_full_name(), "email": request.user.email,
    } if request.user.is_authenticated else None)
    if request.method == "POST" and form.is_valid():
        g = form.save()
        send_email(g.email, f"Complaint {g.number} received",
                   f"Dear {g.name},\n\nWe have received your complaint '{g.subject}' (ref {g.number}). "
                   f"Our grievance officer will respond within 48 hours and aim to resolve it within one month.\n\n"
                   f"{settings.PORTAL_NAME}")
        if settings.COMPANY["grievance_email"]:
            send_email(settings.COMPANY["grievance_email"], f"New complaint {g.number}", f"{g.subject}\n\n{g.details}")
        notify(staff_users(), f"New complaint {g.number}", g.subject, "/grievances/")
        return render(request, "core/grievance_sent.html", {"g": g})
    return render(request, "legal/grievance.html", {"form": form})


@staff_required
def grievance_list(request):
    items = Grievance.objects.all()
    selected = None
    form = None
    if request.GET.get("id"):
        selected = get_object_or_404(Grievance, pk=request.GET["id"])
        form = GrievanceUpdateForm(request.POST or None, instance=selected)
        if request.method == "POST" and form.is_valid():
            g = form.save(commit=False)
            now = timezone.now()
            if g.status != Grievance.Status.OPEN and not g.acknowledged_at:
                g.acknowledged_at = now
            if g.status == Grievance.Status.RESOLVED and not g.resolved_at:
                g.resolved_at = now
            g.save()
            if "response" in form.changed_data and g.response:
                send_email(g.email, f"Update on your complaint {g.number}", g.response)
            messages.success(request, f"{g.number} updated.")
            return redirect(f"{request.path}?id={g.pk}")
    return render(request, "core/grievance_list.html", {"items": items, "selected": selected, "form": form})


@login_required
def dashboard(request):
    user = request.user
    if user.is_staff_member:
        return _staff_dashboard(request)
    if user.is_vendor:
        return _vendor_dashboard(request)
    return _customer_dashboard(request)


def _customer_dashboard(request):
    orders = Order.objects.filter(customer=request.user)
    return render(request, "core/dashboard_customer.html", {
        "kpi_open": orders.filter(status__in=Order.OPEN_STATUSES).count(),
        "kpi_action": orders.filter(status__in=[S.QUOTED, S.AWAITING_PAYMENT]).count(),
        "kpi_shipped": orders.filter(status=S.SHIPPED).count(),
        "kpi_delivered": orders.filter(status=S.DELIVERED).count(),
        "action_orders": orders.filter(status__in=[S.QUOTED, S.AWAITING_PAYMENT]),
        "recent": orders[:8],
    })


def _vendor_dashboard(request):
    user = request.user
    jobs = Order.objects.filter(vendor_id=user.vendor_id) if user.vendor_id else Order.objects.none()
    month_start = timezone.localdate().replace(day=1)
    ctx = {
        "pricing": jobs.filter(status=S.PRICING).order_by("created_at"),
        "new_jobs": jobs.filter(status=S.CONFIRMED).order_by("confirmed_at"),
        "active": jobs.filter(status__in=[S.IN_PRODUCTION, S.READY]).order_by("required_by", "confirmed_at"),
        "kpi_pricing": jobs.filter(status=S.PRICING).count(),
        "kpi_new": jobs.filter(status=S.CONFIRMED).count(),
        "kpi_production": jobs.filter(status=S.IN_PRODUCTION).count(),
        "kpi_ready": jobs.filter(status=S.READY).count(),
        "recent_shipped": jobs.filter(status__in=[S.SHIPPED, S.DELIVERED]).order_by("-shipped_at")[:6],
    }
    if user.vendor_manager:
        ctx["month_payable"] = jobs.filter(status=S.DELIVERED, delivered_at__date__gte=month_start).aggregate(
            s=Sum("vendor_price"))["s"] or 0
    return render(request, "core/dashboard_vendor.html", ctx)


def _staff_dashboard(request):
    user = request.user
    today = timezone.localdate()
    month_start = today.replace(day=1)
    orders = Order.objects.all()
    counts = dict(orders.values_list("status").annotate(c=Count("id")))
    pipeline = [(v, l, counts.get(v, 0), Order.BADGES[v]) for v, l in S.choices if v not in Order.CLOSED_STATUSES]
    biggest = max([c for _, _, c, _ in pipeline] + [1])
    delivered = orders.filter(status=S.DELIVERED, delivered_at__date__gte=month_start)
    ctx = {
        "kpi_new": counts.get(S.NEW, 0),
        "kpi_pricing": counts.get(S.PRICING, 0),
        "kpi_quoted": counts.get(S.QUOTED, 0) + counts.get(S.AWAITING_PAYMENT, 0),
        "kpi_production": counts.get(S.CONFIRMED, 0) + counts.get(S.IN_PRODUCTION, 0) + counts.get(S.READY, 0),
        "kpi_payments": Payment.objects.filter(status=Payment.Status.PENDING).count(),
        "kpi_overdue": orders.filter(status__in=Order.OPEN_STATUSES, required_by__lt=today).exclude(
            status=S.SHIPPED).count(),
        "kpi_sales": delivered.aggregate(s=Sum("price"))["s"] or 0,
        "pipeline": [(v, l, c, b, round(c * 100 / biggest)) for v, l, c, b in pipeline],
        "needs_attention": orders.filter(
            Q(status=S.NEW) | Q(status=S.PRICING, vendor_price__isnull=False)
        ).select_related("customer")[:10],
        "pending_payments": Payment.objects.filter(status=Payment.Status.PENDING).select_related("order")[:10],
        "grievances": Grievance.objects.exclude(status=Grievance.Status.RESOLVED)[:5],
        "recent": orders.select_related("customer")[:8],
    }
    if user.is_owner:
        vendor_cost = delivered.aggregate(s=Sum("vendor_price"))["s"] or 0
        ctx["kpi_margin"] = ctx["kpi_sales"] - vendor_cost
    return render(request, "core/dashboard_staff.html", ctx)


@login_required
def notifications(request):
    return render(request, "core/notifications.html", {"items": request.user.notifications.all()[:100]})


@login_required
@require_POST
def notifications_read(request):
    request.user.notifications.filter(is_read=False).update(is_read=True)
    nxt = request.POST.get("next") or ""
    return redirect(nxt if nxt.startswith("/") and not nxt.startswith("//") else "core:notifications")
