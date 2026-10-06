from django import forms
from django.utils import timezone

from accounts.forms import StyledFormMixin, TermsMixin, clean_gstin, clean_phone, clean_pincode
from accounts.models import VendorProfile
from core.choices import STATE_CHOICES

from .models import Message, Order, Payment, VendorPayout
from .validators import ALLOWED_EXTENSIONS, validate_design_file, validate_image

ACCEPT = ",".join(sorted(ALLOWED_EXTENSIONS))
SHIP_FIELDS = ["ship_name", "ship_phone", "ship_address", "ship_city", "ship_state", "ship_pincode",
               "bill_company", "bill_gstin"]


class MultipleFileInput(forms.ClearableFileInput):
    allow_multiple_selected = True


class MultipleFileField(forms.FileField):
    def __init__(self, *args, **kwargs):
        kwargs.setdefault("widget", MultipleFileInput(attrs={"accept": ACCEPT}))
        super().__init__(*args, **kwargs)

    def clean(self, data, initial=None):
        single = super().clean
        files = data if isinstance(data, (list, tuple)) else ([data] if data else [])
        if not files:
            if self.required:
                raise forms.ValidationError("Please attach at least one design file.")
            return []
        cleaned, errors = [], []
        for f in files:
            try:
                f = single(f, initial)
                validate_design_file(f)
                cleaned.append(f)
            except forms.ValidationError as e:
                errors.extend(e.messages)
        if errors:
            raise forms.ValidationError(errors)
        return cleaned


def _future_date(value):
    if value and value < timezone.localdate():
        raise forms.ValidationError("The date cannot be in the past.")
    return value


class ShippingMixin:
    """Validation shared by every form that collects a delivery address."""

    def _setup_shipping(self):
        if "ship_state" in self.fields:
            self.fields["ship_state"] = forms.ChoiceField(
                label="State", choices=[("", "Choose state")] + STATE_CHOICES,
                widget=forms.Select(attrs={"class": "form-select"}))
        if "ship_address" in self.fields:
            self.fields["ship_address"].widget = forms.Textarea(
                attrs={"rows": 2, "class": "form-control", "placeholder": "House / building, street, area"})

    def clean_ship_phone(self):
        return clean_phone(self.cleaned_data.get("ship_phone"))

    def clean_ship_pincode(self):
        return clean_pincode(self.cleaned_data.get("ship_pincode"))

    def clean_bill_gstin(self):
        return clean_gstin(self.cleaned_data.get("bill_gstin"))

    def clean_required_by(self):
        return _future_date(self.cleaned_data.get("required_by"))


def shipping_initial(user):
    if not user or not user.is_authenticated:
        return {}
    return {
        "ship_name": user.get_full_name(), "ship_phone": user.phone, "ship_address": user.address,
        "ship_city": user.city, "ship_state": user.state, "ship_pincode": user.pincode,
        "bill_company": user.company, "bill_gstin": user.gstin,
    }


class CatalogOrderForm(StyledFormMixin, ShippingMixin, forms.ModelForm):
    colour = forms.ChoiceField(required=False)
    notes = forms.CharField(required=False, widget=forms.Textarea(attrs={"rows": 2}),
                            label="Personalisation or notes")

    class Meta:
        model = Order
        fields = ["quantity", "colour", "required_by"] + SHIP_FIELDS
        widgets = {"required_by": forms.DateInput(attrs={"type": "date"})}

    def __init__(self, *args, product=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.product = product
        self._setup_shipping()
        colours = product.colour_list if product else []
        self.fields["colour"].choices = [(c, c) for c in colours] or [("", "Standard")]
        self.fields["colour"].widget.attrs["class"] = "form-select"
        if product:
            self.fields["quantity"].min_value = product.min_quantity
            self.fields["quantity"].widget.attrs["min"] = product.min_quantity
            self.fields["quantity"].initial = product.min_quantity

    def clean_quantity(self):
        qty = self.cleaned_data["quantity"]
        if self.product and qty < self.product.min_quantity:
            raise forms.ValidationError(f"Minimum order quantity is {self.product.min_quantity}.")
        if qty > 10000:
            raise forms.ValidationError("For more than 10,000 pieces please send a mass manufacturing request.")
        return qty


class CustomRequestForm(StyledFormMixin, ShippingMixin, forms.ModelForm):
    files = MultipleFileField(label="Design files", required=False,
                              help_text="STL, OBJ, 3MF, STEP, IGES, or drawings and photos (PDF, DXF, DWG, PNG, JPG).")

    class Meta:
        model = Order
        fields = ["segment", "title", "description", "quantity", "technology", "material", "colour", "finish",
                  "required_by", "file_link"] + SHIP_FIELDS
        labels = {"segment": "Type of job", "title": "Project name", "technology": "Preferred technology",
                  "required_by": "Needed by (optional)"}
        widgets = {
            "description": forms.Textarea(attrs={
                "rows": 4, "placeholder": "What is the part for? Size, tolerances, strength, colour, finish, anything we should know."}),
            "required_by": forms.DateInput(attrs={"type": "date"}),
        }
        help_texts = {"technology": "Not sure? Leave it blank and we'll recommend one."}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._setup_shipping()
        self.fields["segment"].choices = [c for c in self.fields["segment"].choices if c[0] != "decor"]
        self.fields["technology"].required = False
        self.fields["material"].required = False
        self.fields["technology"].choices = [("", "Not sure, recommend one")] + self.fields["technology"].choices[1:]
        self.fields["material"].choices = [("", "Not sure, recommend one")] + self.fields["material"].choices[1:]
        self.fields["description"].required = True
        self.fields["files"].widget.attrs["class"] = "form-control"

    def clean(self):
        data = super().clean()
        if not data.get("files") and not data.get("file_link") and not self.errors.get("files"):
            self.add_error("files", "Attach at least one file, or paste a link to your files below.")
        return data


class GuestRequestForm(TermsMixin, CustomRequestForm):
    """A quote request from someone without an account. An account is created for them."""

    name = forms.CharField(label="Your name", max_length=120)
    email = forms.EmailField(label="Email")
    phone = forms.CharField(label="Mobile number", max_length=20)
    company = forms.CharField(label="Company (optional)", max_length=150, required=False)
    medical_ack = forms.BooleanField(
        required=False,
        label="I understand that printed models are for planning, training, demonstration or prototyping only, "
              "and are not medical devices for use in or on a patient.")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for name in ("name", "email", "phone", "company", "accept_terms", "medical_ack"):
            w = self.fields[name].widget
            w.attrs.setdefault("class", "form-check-input" if isinstance(w, forms.CheckboxInput) else "form-control")

    def clean_phone(self):
        return clean_phone(self.cleaned_data.get("phone"))

    def clean_email(self):
        return self.cleaned_data["email"].strip().lower()

    def clean(self):
        data = super().clean()
        if data.get("segment") == "medical" and not data.get("medical_ack"):
            self.add_error("medical_ack", "Please confirm this to send a medical enquiry.")
        return data


class MedicalAckMixin(forms.Form):
    medical_ack = GuestRequestForm.base_fields["medical_ack"]


class CustomerRequestForm(MedicalAckMixin, CustomRequestForm):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["medical_ack"].widget.attrs["class"] = "form-check-input"

    def clean(self):
        data = super().clean()
        if data.get("segment") == "medical" and not data.get("medical_ack"):
            self.add_error("medical_ack", "Please confirm this to send a medical enquiry.")
        return data


class SendForPricingForm(StyledFormMixin, forms.Form):
    vendor = forms.ModelChoiceField(queryset=VendorProfile.objects.filter(is_active=True), empty_label=None)
    note = forms.CharField(required=False, max_length=400, label="Instructions for production",
                           widget=forms.Textarea(attrs={"rows": 2}))


class VendorPriceForm(StyledFormMixin, forms.Form):
    vendor_price = forms.DecimalField(min_value=0, max_digits=12, decimal_places=2,
                                      label="Your total price for this order (₹, before GST, including delivery)")
    lead_days = forms.IntegerField(min_value=1, max_value=120, label="Working days to dispatch")
    note = forms.CharField(required=False, max_length=400, label="Notes (material, assumptions)",
                           widget=forms.Textarea(attrs={"rows": 2}))


class OwnerPriceForm(StyledFormMixin, forms.Form):
    price = forms.DecimalField(min_value=0, max_digits=12, decimal_places=2, label="Customer price before GST (₹)")


class QuoteForm(StyledFormMixin, forms.Form):
    note = forms.CharField(required=False, max_length=400, label="Message to customer",
                           widget=forms.Textarea(attrs={"rows": 2}))


class StatusForm(StyledFormMixin, forms.Form):
    status = forms.ChoiceField(label="Move to")
    note = forms.CharField(required=False, max_length=400, label="Note")
    courier = forms.CharField(required=False, max_length=60, label="Courier")
    tracking_number = forms.CharField(required=False, max_length=80, label="AWB / tracking number")
    tracking_url = forms.URLField(required=False, label="Tracking link (optional)")

    def __init__(self, *args, transitions=(), **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["status"].choices = [("", "Choose next step...")] + [(s, Order.Status(s).label) for s in transitions]

    def clean(self):
        data = super().clean()
        if data.get("status") == Order.Status.SHIPPED:
            if not data.get("courier"):
                self.add_error("courier", "Enter the courier name.")
            if not data.get("tracking_number"):
                self.add_error("tracking_number", "Enter the AWB / tracking number.")
        if data.get("status") in (Order.Status.CANCELLED, Order.Status.REJECTED) and not data.get("note"):
            self.add_error("note", "Please give a reason.")
        return data


class PaymentForm(StyledFormMixin, forms.ModelForm):
    proof_file = forms.FileField(required=False, label="Payment screenshot (optional)")

    class Meta:
        model = Payment
        fields = ["amount", "method", "reference", "paid_on", "note"]
        widgets = {"paid_on": forms.DateInput(attrs={"type": "date"})}
        labels = {"note": "Note (optional)"}

    def clean_paid_on(self):
        value = self.cleaned_data["paid_on"]
        if value > timezone.localdate():
            raise forms.ValidationError("The payment date cannot be in the future.")
        return value

    def clean_amount(self):
        value = self.cleaned_data["amount"]
        if value <= 0:
            raise forms.ValidationError("Enter the amount paid.")
        return value

    def clean_proof_file(self):
        f = self.cleaned_data.get("proof_file")
        if f:
            validate_image(f)
        return f


class MessageForm(StyledFormMixin, forms.Form):
    body = forms.CharField(widget=forms.Textarea(attrs={"rows": 2, "placeholder": "Write a message..."}), label="")
    channel = forms.ChoiceField(choices=Message.Channel.choices, required=False, label="Send to")


class UploadForm(forms.Form):
    files = MultipleFileField(label="Add files")


class QCPhotoForm(forms.Form):
    photo = forms.FileField(label="Quality-check photo")

    def clean_photo(self):
        f = self.cleaned_data["photo"]
        validate_image(f)
        return f


class PayoutForm(StyledFormMixin, forms.ModelForm):
    class Meta:
        model = VendorPayout
        fields = ["amount", "reference", "paid_on", "vendor_invoice_number", "note"]
        widgets = {"paid_on": forms.DateInput(attrs={"type": "date"})}
