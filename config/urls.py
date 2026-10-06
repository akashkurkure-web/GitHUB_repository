from django.conf import settings
from django.contrib import admin
from django.urls import include, path

admin.site.site_header = f"{settings.PORTAL_NAME} Administration"
admin.site.site_title = settings.PORTAL_NAME
admin.site.index_title = "Back-office"

urlpatterns = [
    path("admin/", admin.site.urls),
    path("accounts/", include("accounts.urls")),
    path("catalog/", include("catalog.urls")),
    path("orders/", include("orders.urls")),
    path("", include("core.urls")),
]
