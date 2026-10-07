from django.urls import path

from . import seo, status, views

app_name = "core"

urlpatterns = [
    path("", views.home, name="home"),
    path("status/", status.status, name="status"),
    path("robots.txt", seo.robots, name="robots"),
    path("sitemap.xml", seo.sitemap, name="sitemap"),
    path("demo-data/", views.demo_data, name="demo_data"),
    path("solutions/<slug:key>/", views.segment, name="segment"),
    path("grievance/", views.grievance, name="grievance"),
    path("grievances/", views.grievance_list, name="grievance_list"),
    path("dashboard/", views.dashboard, name="dashboard"),
    path("notifications/", views.notifications, name="notifications"),
    path("notifications/read/", views.notifications_read, name="notifications_read"),
    path("<slug:name>/", views.page, name="page"),
]
