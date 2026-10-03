from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission


def user_role(user):
    if user.is_superuser:
        return "admin"
    profile = getattr(user, "profile", None)
    return profile.role if profile else ""


def require_role(user, *roles):
    if user_role(user) not in (*roles, "admin"):
        raise PermissionDenied("Seu perfil não permite esta ação.")


class IsInternal(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user.is_authenticated and user_role(request.user) in {"purchasing", "warehouse", "management", "admin"})


class HasProfile(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user.is_authenticated and user_role(request.user))


role = user_role
require_roles = require_role
