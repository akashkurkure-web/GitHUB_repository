from django.contrib import admin

from .models import Category, Product


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ("name", "category", "vendor_price", "price", "is_active")
    list_filter = ("category", "is_active")
    search_fields = ("name", "sku")


admin.site.register(Category)
