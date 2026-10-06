from django.contrib.auth import views as auth_views
from django.urls import path

from . import views

app_name = "accounts"

urlpatterns = [
    path("login/", views.PortalLoginView.as_view(), name="login"),
    path("logout/", auth_views.LogoutView.as_view(), name="logout"),
    path("signup/", views.signup, name="signup"),
    path("profile/", views.profile, name="profile"),
    path("password/", auth_views.PasswordChangeView.as_view(
        template_name="accounts/password_change.html", success_url="/accounts/profile/"), name="password_change"),
    path("password/reset/", views.PortalPasswordResetView.as_view(), name="password_reset"),
    path("password/reset/sent/", auth_views.PasswordResetDoneView.as_view(
        template_name="accounts/password_reset_done.html"), name="password_reset_done"),
    path("password/reset/<uidb64>/<token>/", views.PortalPasswordResetConfirmView.as_view(),
         name="password_reset_confirm"),
    path("customers/", views.customer_list, name="customer_list"),
    path("team/", views.team, name="team"),
    path("team/<int:pk>/toggle/", views.team_toggle, name="team_toggle"),
    path("vendors/", views.vendor_list, name="vendor_list"),
    path("vendors/new/", views.vendor_edit, name="vendor_create"),
    path("vendors/<int:pk>/", views.vendor_edit, name="vendor_edit"),
]
