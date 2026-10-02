from django.contrib import admin
from django.urls import include, path

admin.site.site_header = 'Bazaario back office'
admin.site.site_title = 'Bazaario'

urlpatterns = [
    path('api/', include('store.urls')),
    path('django-admin/', admin.site.urls),
]
