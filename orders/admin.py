from django.contrib import admin

from .models import InvoiceSequence, Message, Order, OrderFile, OrderItem, Payment, StatusEvent, VendorPayout


class ItemInline(admin.TabularInline):
    model = OrderItem
    extra = 0


class PaymentInline(admin.TabularInline):
    model = Payment
    extra = 0
    exclude = ("proof",)


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ("number", "title", "customer", "segment", "status", "price", "vendor_price", "created_at")
    list_filter = ("status", "segment", "order_type")
    search_fields = ("number", "title", "customer__email", "tracking_number")
    inlines = [ItemInline, PaymentInline]


@admin.register(OrderFile)
class OrderFileAdmin(admin.ModelAdmin):
    list_display = ("name", "order", "kind", "size", "uploaded_at")
    exclude = ("data",)


admin.site.register(StatusEvent)
admin.site.register(Message)
admin.site.register(VendorPayout)
admin.site.register(InvoiceSequence)
