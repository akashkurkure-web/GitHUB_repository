"""Django back office at /django-admin/ (complements the Bazaario Studio screens in the storefront)."""
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import Address, AuditLog, Category, Coupon, Order, OrderItem, Product, Review, User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ['-id']
    list_display = ['email', 'name', 'phone', 'is_staff', 'is_active', 'date_joined']
    search_fields = ['email', 'name', 'phone']
    fieldsets = [
        (None, {'fields': ['email', 'password']}),
        ('Profile', {'fields': ['name', 'phone']}),
        ('Security', {'fields': ['failed_logins', 'locked_until']}),
        ('Permissions', {'fields': ['is_active', 'is_staff', 'is_superuser', 'groups', 'user_permissions']}),
        ('Dates', {'fields': ['last_login', 'date_joined']}),
    ]
    add_fieldsets = [(None, {'classes': ['wide'], 'fields': ['email', 'name', 'password1', 'password2']})]


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ['name', 'slug']
    prepopulated_fields = {'slug': ['name']}


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ['title', 'brand', 'category', 'price', 'mrp', 'stock', 'is_deal', 'active']
    list_filter = ['category', 'active', 'is_deal', 'express']
    search_fields = ['title', 'brand']


class OrderItemInline(admin.TabularInline):
    model = OrderItem
    extra = 0
    readonly_fields = ['product', 'title', 'emoji', 'price', 'qty']


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ['order_no', 'user', 'status', 'total', 'payment_method', 'payment_status', 'created_at']
    list_filter = ['status', 'payment_method', 'payment_status']
    search_fields = ['order_no', 'user__email']
    inlines = [OrderItemInline]
    readonly_fields = ['order_no', 'user', 'subtotal', 'discount', 'shipping', 'total', 'payment_ref', 'address',
                       'idempotency_key', 'created_at', 'updated_at']


admin.site.register(Review)
admin.site.register(Coupon)
admin.site.register(Address)


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ['created_at', 'user', 'action', 'ip']
    list_filter = ['action']
    readonly_fields = ['user', 'action', 'detail', 'ip', 'created_at']

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
