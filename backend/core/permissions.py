from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission


def canonical_role(value):
    # Keep persisted team roles intact while sharing one authorization policy.
    return "gatehouse" if value == "portaria" else value


def user_role(user):
    if user.is_superuser:
        return "admin"
    profile = getattr(user, "profile", None)
    return canonical_role(profile.role) if profile else ""


def require_role(user, *roles):
    if user_role(user) not in (*map(canonical_role, roles), "admin"):
        raise PermissionDenied("Seu perfil não permite esta ação.")


class IsInternal(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user.is_authenticated
            and user_role(request.user) in {"purchasing", "warehouse", "management", "admin"}
        )


class HasProfile(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user.is_authenticated and user_role(request.user))


role = user_role
require_roles = require_role


def require_supplier_booking(user):
    """Creation belongs only to a linked supplier, including for administrators."""
    if user_role(user) != "supplier" or not user.profile.supplier_id:
        raise PermissionDenied("Somente Fornecedor vinculado pode criar agendamentos.")
