from django.urls import path

from . import views

app_name = "orders"

urlpatterns = [
    path("", views.order_list, name="list"),
    path("request-quote/", views.request_quote, name="request_quote"),
    path("buy/<slug:slug>/", views.create_catalog_order, name="create_catalog"),
    path("export.csv", views.export_csv, name="export"),
    path("vendor-statement/", views.vendor_statement, name="vendor_statement"),
    path("files/<int:pk>/", views.download_file, name="download"),
    path("payments/<int:pk>/decide/", views.payment_decide, name="payment_decide"),
    path("payments/<int:pk>/proof/", views.payment_proof, name="payment_proof"),
    path("<int:pk>/", views.order_detail, name="detail"),
    path("<int:pk>/status/", views.order_status, name="status"),
    path("<int:pk>/send-for-pricing/", views.order_send_for_pricing, name="send_for_pricing"),
    path("<int:pk>/vendor-price/", views.order_vendor_price, name="vendor_price"),
    path("<int:pk>/price/", views.order_owner_price, name="owner_price"),
    path("<int:pk>/send-quote/", views.order_send_quote, name="send_quote"),
    path("<int:pk>/payment/", views.order_payment, name="payment"),
    path("<int:pk>/message/", views.order_message, name="message"),
    path("<int:pk>/upload/", views.order_upload, name="upload"),
    path("<int:pk>/invoice/", views.invoice, name="invoice"),
    path("<int:pk>/upi-qr.svg", views.upi_qr, name="upi_qr"),
]
