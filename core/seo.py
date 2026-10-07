"""robots.txt and sitemap.xml so search engines can find the public pages."""
from django.http import HttpResponse
from django.urls import reverse

from catalog.models import Product

from .choices import SEGMENT_INFO
from .context_processors import portal

PUBLIC_PAGES = ["how-it-works", "about", "contact", "terms", "privacy", "refunds", "shipping"]


def robots(request):
    base = portal(request)["SITE_URL"]
    body = "\n".join([
        "User-agent: *",
        "Disallow: /accounts/", "Disallow: /orders/", "Disallow: /dashboard/", "Disallow: /admin/",
        "Disallow: /notifications/", "Disallow: /status/", "Allow: /orders/request-quote/",
        f"Sitemap: {base}/sitemap.xml", "",
    ])
    return HttpResponse(body, content_type="text/plain")


def sitemap(request):
    base = portal(request)["SITE_URL"]
    paths = [reverse("core:home"), reverse("catalog:list"), reverse("orders:request_quote")]
    paths += [reverse("core:segment", args=[k]) for k in SEGMENT_INFO]
    paths += [reverse("core:page", args=[p]) for p in PUBLIC_PAGES]
    paths += [p.get_absolute_url() for p in Product.objects.filter(is_active=True).only("slug")]
    urls = "".join(f"<url><loc>{base}{p}</loc></url>" for p in paths)
    xml = f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>'
    return HttpResponse(xml, content_type="application/xml")
