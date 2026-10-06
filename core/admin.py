from django.contrib import admin

from .models import Grievance, Notification

admin.site.register(Notification)


@admin.register(Grievance)
class GrievanceAdmin(admin.ModelAdmin):
    list_display = ("number", "subject", "name", "status", "created_at")
    list_filter = ("status",)
