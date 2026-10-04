from django.contrib.auth import authenticate, get_user_model
from django.db import connection
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.authtoken.models import Token
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import AllowAny
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .models import UserProfile
from .permissions import HasProfile, user_role


def switchable_users():
    return (
        get_user_model().objects.filter(is_active=True)
        .filter(Q(is_superuser=True) | Q(profile__role__in=[role for role, _ in UserProfile.ROLES]))
        .select_related("profile")
        .order_by("username", "id")
    )


def user_payload(user, request=None):
    profile = getattr(user, "profile", None)
    role = user_role(user)
    if role == "gatehouse" and request and request.path.startswith("/api/v1/"):
        role = "portaria"
    return {
        "id": user.id,
        "username": user.username,
        "role": role,
        "supplier_id": str(profile.supplier_id) if profile and profile.supplier_id else None,
    }


class LoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def get_authenticate_header(self, request):
        return "Token"

    def post(self, request):
        user = authenticate(
            request, username=request.data.get("username"), password=request.data.get("password")
        )
        if user is None or not user_role(user):
            raise AuthenticationFailed("Credenciais inválidas ou usuário sem perfil.")
        token, _ = Token.objects.get_or_create(user=user)
        return Response({"token": token.key, "user": user_payload(user, request)})


class LogoutView(APIView):
    def post(self, request):
        Token.objects.filter(user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    def get(self, request):
        return Response(user_payload(request.user, request))


class UserListView(APIView):
    permission_classes = [HasProfile]

    def get(self, request):
        users = switchable_users()
        search = request.query_params.get("search", "").strip()
        if search:
            users = users.filter(username__icontains=search)
        pagination = PageNumberPagination()
        page = pagination.paginate_queryset(users, request, view=self)
        return pagination.get_paginated_response([user_payload(user, request) for user in page])


class SwitchUserSerializer(serializers.Serializer):
    user_id = serializers.IntegerField(min_value=1, max_value=9223372036854775807)


class SwitchUserView(APIView):
    permission_classes = [HasProfile]

    def post(self, request):
        serializer = SwitchUserSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = get_object_or_404(switchable_users(), pk=serializer.validated_data["user_id"])
        token, _ = Token.objects.get_or_create(user=user)
        return Response({"token": token.key, "user": user_payload(user, request)})


class HealthView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        return Response({"status": "ok", "database": "postgresql"})
