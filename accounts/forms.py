import re

from django import forms
from django.conf import settings
from django.contrib.auth.forms import AuthenticationForm, PasswordResetForm, SetPasswordForm
from django.contrib.auth.password_validation import validate_password
from django.utils import timezone

from core.choices import STATE_CHOICES

from .models import LoginAttempt, User, VendorProfile

PHONE_RE = re.compile(r"^[6-9]\d{9}$")
GSTIN_RE = re.compile(r"^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
PIN_RE = re.compile(r"^[1-9]\d{5}$")


def clean_phone(value):
    digits = re.sub(r"\D", "", value or "")
    if digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    if digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]
    if not PHONE_RE.match(digits):
        raise forms.ValidationError("Enter a 10-digit Indian mobile number.")
    return digits


def clean_gstin(value):
    value = (value or "").strip().upper()
    if value and not GSTIN_RE.match(value):
        raise forms.ValidationError("This does not look like a valid 15-character GSTIN.")
    return value


def clean_pincode(value):
    value = (value or "").strip()
    if not PIN_RE.match(value):
        raise forms.ValidationError("Enter a 6-digit PIN code.")
    return value


class StyledFormMixin:
    """Adds Bootstrap classes to every widget."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for field in self.fields.values():
            widget = field.widget
            if isinstance(widget, forms.CheckboxInput):
                widget.attrs.setdefault("class", "form-check-input")
            elif isinstance(widget, forms.CheckboxSelectMultiple):
                continue
            elif isinstance(widget, (forms.Select, forms.SelectMultiple)):
                widget.attrs.setdefault("class", "form-select")
            else:
                widget.attrs.setdefault("class", "form-control")


class TermsMixin(forms.Form):
    accept_terms = forms.BooleanField(
        label="I agree to the Terms of use and the Privacy policy, and consent to my details being used to process my orders.",
    )


class LoginForm(StyledFormMixin, AuthenticationForm):
    username = forms.CharField(label="Email or username", max_length=254,
                               widget=forms.TextInput(attrs={"autofocus": True, "autocomplete": "username",
                                                             "autocapitalize": "none", "autocorrect": "off",
                                                             "spellcheck": "false"}))

    def clean(self):
        username = (self.cleaned_data.get("username") or "").strip()
        if username and LoginAttempt.recent_failures(username) >= settings.LOGIN_MAX_ATTEMPTS:
            raise forms.ValidationError(
                f"Too many failed attempts. Please wait {settings.LOGIN_LOCK_MINUTES} minutes or reset your password.")
        # Accept the email address as well as the username, ignoring capital letters
        # (phone keyboards often turn "customer" into "Customer").
        if "@" in username:
            match = User.objects.filter(email__iexact=username).first()
        else:
            match = User.objects.filter(username__iexact=username).first()
        if match:
            self.cleaned_data["username"] = match.username
        try:
            return super().clean()
        except forms.ValidationError:
            LoginAttempt.objects.create(username=username[:150], ip=_ip(self.request))
            raise


def _ip(request):
    if not request:
        return None
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    return (forwarded.split(",")[0].strip() or request.META.get("REMOTE_ADDR")) or None


class CustomerSignupForm(StyledFormMixin, TermsMixin, forms.ModelForm):
    password1 = forms.CharField(label="Password", widget=forms.PasswordInput(attrs={"autocomplete": "new-password"}),
                                help_text="At least 8 characters, not only numbers.")
    password2 = forms.CharField(label="Confirm password", widget=forms.PasswordInput(attrs={"autocomplete": "new-password"}))

    class Meta:
        model = User
        fields = ["first_name", "last_name", "email", "phone", "company", "gstin"]
        labels = {"phone": "Mobile number"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["first_name"].required = True
        self.fields["email"].required = True
        self.fields["phone"].required = True
        self.order_fields(["first_name", "last_name", "email", "phone", "company", "gstin", "password1", "password2",
                           "accept_terms"])

    def clean_email(self):
        email = self.cleaned_data["email"].strip().lower()
        if User.objects.filter(email__iexact=email).exists():
            raise forms.ValidationError(
                "An account with this email already exists. Sign in, or use 'Forgot password' to set a password "
                "(for example if you sent us a quote request without an account).")
        return email

    def clean_phone(self):
        return clean_phone(self.cleaned_data["phone"])

    def clean_gstin(self):
        return clean_gstin(self.cleaned_data.get("gstin"))

    def clean(self):
        data = super().clean()
        p1, p2 = data.get("password1"), data.get("password2")
        if p1 and p2 and p1 != p2:
            self.add_error("password2", "The two passwords do not match.")
        elif p1:
            try:
                validate_password(p1, User(email=data.get("email"), first_name=data.get("first_name", "")))
            except forms.ValidationError as e:
                self.add_error("password1", e)
        return data

    def save(self, commit=True):
        user = User(username=self.cleaned_data["email"])
        for f in self.Meta.fields:
            setattr(user, f, self.cleaned_data.get(f, ""))
        user.role = User.Role.CUSTOMER
        user.set_password(self.cleaned_data["password1"])
        user.accepted_terms_at = timezone.now()
        user.save()
        return user


class ProfileForm(StyledFormMixin, forms.ModelForm):
    class Meta:
        model = User
        fields = ["first_name", "last_name", "email", "phone", "company", "gstin", "address", "city", "state", "pincode"]
        widgets = {"address": forms.Textarea(attrs={"rows": 2})}
        labels = {"phone": "Mobile number", "pincode": "PIN code"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["state"].choices = [("", "Choose state")] + STATE_CHOICES
        if not self.instance.is_customer:
            for name in ("company", "gstin", "address", "city", "state", "pincode"):
                self.fields.pop(name)

    def clean_email(self):
        email = self.cleaned_data["email"].strip().lower()
        if User.objects.filter(email__iexact=email).exclude(pk=self.instance.pk).exists():
            raise forms.ValidationError("Another account already uses this email.")
        return email

    def clean_phone(self):
        value = self.cleaned_data.get("phone")
        return clean_phone(value) if value else ""

    def clean_gstin(self):
        return clean_gstin(self.cleaned_data.get("gstin"))

    def clean_pincode(self):
        value = self.cleaned_data.get("pincode")
        return clean_pincode(value) if value else ""


class TeamUserForm(StyledFormMixin, forms.ModelForm):
    """Owner creates staff and vendor logins. Nobody can sign up as staff or vendor."""

    KIND_CHOICES = [
        ("ops", "Sales and ops staff (no vendor prices or margin)"),
        ("owner", "Owner (full access)"),
        ("vendor_manager", "Vendor manager (sees vendor prices, enters quotes)"),
        ("vendor_staff", "Vendor staff (production and dispatch only, no prices)"),
    ]
    kind = forms.ChoiceField(label="Access", choices=KIND_CHOICES)
    vendor = forms.ModelChoiceField(queryset=VendorProfile.objects.filter(is_active=True), required=False,
                                    help_text="Required for vendor users")
    password = forms.CharField(widget=forms.PasswordInput(attrs={"autocomplete": "new-password"}),
                               help_text="Share it privately; they can change it after signing in.")

    class Meta:
        model = User
        fields = ["first_name", "last_name", "email", "phone"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["first_name"].required = True
        self.fields["email"].required = True

    def clean_email(self):
        email = self.cleaned_data["email"].strip().lower()
        if User.objects.filter(email__iexact=email).exists():
            raise forms.ValidationError("A user with this email already exists.")
        return email

    def clean(self):
        data = super().clean()
        if data.get("kind", "").startswith("vendor") and not data.get("vendor"):
            self.add_error("vendor", "Choose which vendor this person works for.")
        if data.get("password"):
            try:
                validate_password(data["password"])
            except forms.ValidationError as e:
                self.add_error("password", e)
        return data

    def save(self, commit=True):
        user = super().save(commit=False)
        kind = self.cleaned_data["kind"]
        user.username = user.email
        user.role = {"ops": User.Role.OPS, "owner": User.Role.OWNER}.get(kind, User.Role.VENDOR)
        if user.role == User.Role.VENDOR:
            user.vendor = self.cleaned_data["vendor"]
            user.vendor_manager = kind == "vendor_manager"
        user.set_password(self.cleaned_data["password"])
        user.save()
        return user


class VendorProfileForm(StyledFormMixin, forms.ModelForm):
    class Meta:
        model = VendorProfile
        exclude = ["created_at"]
        widgets = {"address": forms.Textarea(attrs={"rows": 2}), "notes": forms.Textarea(attrs={"rows": 2})}

    def clean_gstin(self):
        return clean_gstin(self.cleaned_data.get("gstin"))


class PortalSetPasswordForm(StyledFormMixin, SetPasswordForm):
    pass


class PortalPasswordResetForm(StyledFormMixin, PasswordResetForm):
    """Also sends the link to customers created from a guest quote request (no password yet)."""

    def get_users(self, email):
        return User.objects.filter(email__iexact=email, is_active=True)
