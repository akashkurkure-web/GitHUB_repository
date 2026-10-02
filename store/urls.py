"""REST-style JSON API consumed by the storefront (public/app.js)."""
from django.urls import path

from .views import admin_api, auth, catalog, orders, shopping

urlpatterns = [
    path('health', catalog.health),
    path('config', catalog.config),
    # Auth
    path('auth/me', auth.me),
    path('auth/register', auth.register),
    path('auth/login', auth.login_view),
    path('auth/logout', auth.logout_view),
    path('auth/profile', auth.profile),
    path('auth/change-password', auth.change_password),
    # Catalog
    path('categories', catalog.categories),
    path('products', catalog.products),
    path('products/suggest', catalog.suggest),
    path('products/<int:pid>', catalog.product_detail),
    path('products/<int:pid>/reviews', catalog.create_review),
    # Bag, wishlist, addresses
    path('cart', shopping.cart),
    path('cart/merge', shopping.cart_merge),
    path('cart/coupon', shopping.cart_coupon),
    path('cart/<int:pid>', shopping.cart_item),
    path('wishlist', shopping.wishlist),
    path('wishlist/<int:pid>', shopping.wishlist_item),
    path('addresses/states', shopping.states),
    path('addresses', shopping.addresses),
    path('addresses/<int:aid>', shopping.address_detail),
    # Checkout & orders
    path('checkout/quote', orders.checkout_quote),
    path('orders', orders.orders),
    path('orders/<int:oid>', orders.order_view),
    path('orders/<int:oid>/cancel', orders.order_cancel),
    path('orders/<int:oid>/return', orders.order_return),
    # Bazaario Studio (admin)
    path('admin/stats', admin_api.stats),
    path('admin/products', admin_api.products),
    path('admin/products/<int:pid>', admin_api.product_detail),
    path('admin/orders', admin_api.orders),
    path('admin/orders/<int:oid>', admin_api.order_detail_view),
    path('admin/users', admin_api.users),
    path('admin/coupons', admin_api.coupons),
    path('admin/coupons/<str:code>', admin_api.coupon_detail),
    path('admin/audit', admin_api.audit_log),
]
