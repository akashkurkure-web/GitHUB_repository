from django.conf import settings
from django.contrib import messages
from django.contrib.auth import login
from django.contrib.auth import views as auth_views
from django.contrib.auth.decorators import login_required
from django.core.paginator import Paginator
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse_lazy
from django.views.decorators.http import require_POST

from core.decorators import owner_required, staff_required
from orders.models import Order

from .forms import (
    CustomerSignupForm, LoginForm, PortalPasswordResetForm, PortalSetPasswordForm, ProfileForm, TeamUserForm,
    VendorProfileForm,
)
from .models import LoginAttempt, User, VendorProfile


class PortalLoginView(auth_views.LoginView):
    template_name = "accounts/login.html"
    authentication_form = LoginForm
    redirect_authenticated_user = True

    def form_valid(self, form):
        LoginAttempt.objects.filter(username__iexact=self.request.POST.get("username", "")).delete()
        return super().form_valid(form)


class PortalPasswordResetView(auth_views.PasswordResetView):
    template_name = "accounts/password_reset.html"
    email_template_name = "accounts/email/password_reset.txt"
    subject_template_name = "accounts/email/password_reset_subject.txt"
    form_class = PortalPasswordResetForm
    success_url = reverse_lazy("accounts:password_reset_done")
    extra_email_context = {"PORTAL_NAME": settings.PORTAL_NAME}


class PortalPasswordResetConfirmView(auth_views.PasswordResetConfirmView):
    template_name = "accounts/password_reset_confirm.html"
    form_class = PortalSetPasswordForm
    success_url = reverse_lazy("accounts:login")
    post_reset_login = False

    def form_valid(self, form):
        messages.success(self.request, "Your password is set. Please sign in.")
        return super().form_valid(form)


def signup(request):
    if request.user.is_authenticated:
        return redirect("core:dashboard")
    form = CustomerSignupForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        user = form.save()
        login(request, user, backend="django.contrib.auth.backends.ModelBackend")
        messages.success(request, f"Welcome, {user.first_name}! Your account is ready.")
        return redirect(request.GET.get("next") or "core:dashboard")
    return render(request, "accounts/signup.html", {"form": form})


@login_required
def profile(request):
    form = ProfileForm(request.POST or None, instance=request.user)
    if request.method == "POST" and form.is_valid():
        form.save()
        messages.success(request, "Profile updated.")
        return redirect("accounts:profile")
    return render(request, "accounts/profile.html", {"form": form})


@staff_required
def customer_list(request):
    q = request.GET.get("q", "").strip()
    customers = User.objects.filter(role=User.Role.CUSTOMER).annotate(
        order_count=Count("orders"),
        open_count=Count("orders", filter=Q(orders__status__in=Order.OPEN_STATUSES)),
    ).order_by("-date_joined")
    if q:
        customers = customers.filter(Q(first_name__icontains=q) | Q(last_name__icontains=q) | Q(email__icontains=q)
                                     | Q(company__icontains=q) | Q(phone__icontains=q))
    page = Paginator(customers, 25).get_page(request.GET.get("page"))
    return render(request, "accounts/customer_list.html", {"page": page, "q": q})


@owner_required
def team(request):
    form = TeamUserForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        user = form.save()
        messages.success(request, f"Login created for {user.display_name} ({user.role_label}).")
        return redirect("accounts:team")
    people = User.objects.exclude(role=User.Role.CUSTOMER).select_related("vendor").order_by("role", "first_name")
    return render(request, "accounts/team.html", {"form": form, "people": people})


@owner_required
@require_POST
def team_toggle(request, pk):
    person = get_object_or_404(User.objects.exclude(role=User.Role.CUSTOMER), pk=pk)
    if person == request.user:
        messages.error(request, "You cannot deactivate your own login.")
    else:
        person.is_active = not person.is_active
        person.save(update_fields=["is_active"])
        messages.success(request, f"{person.display_name} is now {'active' if person.is_active else 'deactivated'}.")
    return redirect("accounts:team")


@owner_required
def vendor_list(request):
    vendors = VendorProfile.objects.annotate(
        open_jobs=Count("jobs", filter=Q(jobs__status__in=Order.VENDOR_ACTIVE)),
        total_jobs=Count("jobs", filter=Q(jobs__status__in=[Order.Status.SHIPPED, Order.Status.DELIVERED])),
    )
    return render(request, "accounts/vendor_list.html", {"vendors": vendors})


@owner_required
def vendor_edit(request, pk=None):
    vendor = get_object_or_404(VendorProfile, pk=pk) if pk else None
    form = VendorProfileForm(request.POST or None, instance=vendor)
    if request.method == "POST" and form.is_valid():
        vendor = form.save()
        if vendor.is_default:
            VendorProfile.objects.exclude(pk=vendor.pk).update(is_default=False)
        messages.success(request, f"{vendor.company_name} saved.")
        return redirect("accounts:vendor_list")
    members = vendor.members.all() if vendor else []
    return render(request, "accounts/vendor_edit.html", {"form": form, "vendor": vendor, "members": members})
