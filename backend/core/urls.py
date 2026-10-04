from django.urls import path

from .views import LoginView, LogoutView, MeView, SwitchUserView, UserListView

urlpatterns = [
    path("login/", LoginView.as_view()),
    path("logout/", LogoutView.as_view()),
    path("me/", MeView.as_view()),
    path("users/", UserListView.as_view()),
    path("switch/", SwitchUserView.as_view()),
]
