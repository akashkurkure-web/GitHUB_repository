from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import LoginAttempt, User, VendorProfile


@admin.register(User)
class PortalUserAdmin(UserAdmin):
    list_display = ("username", "email", "first_name", "role", "vendor", "is_active", "date_joined")
    list_filter = ("role", "is_active")
    fieldsets = UserAdmin.fieldsets + (
        ("Portal", {"fields": ("role", "phone", "company", "gstin", "address", "city", "state", "pincode",
                               "vendor", "vendor_manager", "accepted_terms_at")}),
    )


admin.site.register(VendorProfile)
admin.site.register(LoginAttempt)
