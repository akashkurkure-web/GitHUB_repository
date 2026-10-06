from django import forms

from accounts.forms import StyledFormMixin, clean_phone

from .models import Grievance


class GrievanceForm(StyledFormMixin, forms.ModelForm):
    class Meta:
        model = Grievance
        fields = ["name", "email", "phone", "order_number", "subject", "details"]
        labels = {"order_number": "Order number (if any)", "phone": "Mobile number (optional)"}
        widgets = {"details": forms.Textarea(attrs={"rows": 5})}

    def clean_phone(self):
        value = self.cleaned_data.get("phone")
        return clean_phone(value) if value else ""


class GrievanceUpdateForm(StyledFormMixin, forms.ModelForm):
    class Meta:
        model = Grievance
        fields = ["status", "response"]
        widgets = {"response": forms.Textarea(attrs={"rows": 4})}
