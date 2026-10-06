from django.contrib import messages
from django.db.models import Q
from django.http import Http404, HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.cache import cache_control

from core.decorators import owner_required
from orders.forms import CatalogOrderForm, shipping_initial

from .forms import CategoryForm, ProductForm
from .models import Category, Product


def _is_owner(user):
    return user.is_authenticated and user.is_owner


def product_list(request):
    products = Product.objects.select_related("category").defer("image")
    if not _is_owner(request.user):
        products = products.filter(is_active=True)
    category = request.GET.get("category")
    q = request.GET.get("q", "").strip()
    if category:
        products = products.filter(category__slug=category)
    if q:
        products = products.filter(Q(name__icontains=q) | Q(short_description__icontains=q) | Q(sku__icontains=q))
    return render(request, "catalog/product_list.html", {
        "products": products, "categories": Category.objects.all(), "active_category": category, "q": q,
    })


def product_detail(request, slug):
    product = get_object_or_404(Product.objects.select_related("category").defer("image"), slug=slug)
    if not product.is_active and not _is_owner(request.user):
        raise Http404
    form = None
    if request.user.is_authenticated and request.user.is_customer:
        form = CatalogOrderForm(product=product, initial=shipping_initial(request.user))
    related = Product.objects.filter(category=product.category, is_active=True).exclude(pk=product.pk).defer("image")[:3]
    return render(request, "catalog/product_detail.html", {"product": product, "form": form, "related": related})


@cache_control(max_age=3600, public=True)
def product_image(request, slug):
    product = get_object_or_404(Product, slug=slug)
    if not product.image_type or not product.image:
        raise Http404
    return HttpResponse(bytes(product.image), content_type=product.image_type)


@owner_required
def product_edit(request, slug=None):
    product = get_object_or_404(Product, slug=slug) if slug else None
    form = ProductForm(request.POST or None, request.FILES or None, instance=product)
    if request.method == "POST" and form.is_valid():
        product = form.save()
        messages.success(request, f"Product '{product.name}' saved.")
        return redirect(product.get_absolute_url())
    return render(request, "catalog/product_form.html", {"form": form, "product": product})


@owner_required
def category_manage(request):
    form = CategoryForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        form.save()
        messages.success(request, "Category added.")
        return redirect("catalog:categories")
    return render(request, "catalog/categories.html", {"form": form, "categories": Category.objects.all()})
