from django.urls import path

from . import views

app_name = "catalog"

urlpatterns = [
    path("", views.product_list, name="list"),
    path("new/", views.product_edit, name="create"),
    path("categories/", views.category_manage, name="categories"),
    path("<slug:slug>/", views.product_detail, name="detail"),
    path("<slug:slug>/edit/", views.product_edit, name="edit"),
    path("<slug:slug>/image/", views.product_image, name="image"),
]
