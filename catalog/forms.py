from django import forms

from accounts.forms import StyledFormMixin
from orders.validators import IMAGE_EXTENSIONS

from .models import Category, Product


class ProductForm(StyledFormMixin, forms.ModelForm):
    image_file = forms.FileField(required=False, label="Photo (JPG, PNG or WEBP, up to 2 MB)")
    remove_image = forms.BooleanField(required=False, label="Remove current photo")

    class Meta:
        model = Product
        fields = ["category", "name", "sku", "short_description", "description", "dimensions", "vendor_price",
                  "price_override", "technology", "material", "colours", "lead_time_days", "min_quantity",
                  "hsn_code", "is_active"]
        widgets = {"description": forms.Textarea(attrs={"rows": 4})}

    def clean_image_file(self):
        f = self.cleaned_data.get("image_file")
        if f:
            if not any(f.name.lower().endswith(e) for e in IMAGE_EXTENSIONS):
                raise forms.ValidationError("Upload a JPG, PNG or WEBP image.")
            if f.size > 2 * 1024 * 1024:
                raise forms.ValidationError("The photo must be 2 MB or smaller.")
        return f

    def save(self, commit=True):
        product = super().save(commit=False)
        f = self.cleaned_data.get("image_file")
        if f:
            product.image = b"".join(f.chunks())
            product.image_type = f.content_type or "image/jpeg"
        elif self.cleaned_data.get("remove_image"):
            product.image, product.image_type = None, ""
        if commit:
            product.save()
        return product


class CategoryForm(StyledFormMixin, forms.ModelForm):
    class Meta:
        model = Category
        fields = ["name", "segment", "description", "icon", "sort_order"]
