"""Persisted outbound work; unknown delivery outcomes are never automatically repeated."""
from datetime import datetime, timedelta
from urllib.parse import quote

from django.conf import settings
from django.core.mail import EmailMessage
from django.db import transaction
from django.utils import timezone

from core.permissions import user_role
from receiving.models import Appointment, InternalNotification
from .models import OutboundDelivery
from .providers import ProviderUnavailable, json_request, require_configuration, notification_email_recipients


def deliver_email(payload):
    require_configuration("email")
    recipients = payload["recipients"]
    allowed = settings.DIGEST_EMAIL_RECIPIENTS
    if payload.get("kind") == "internal_notification":
        item = InternalNotification.objects.filter(pk=payload.get("notification_id")).first()
        if not item or item.recipient_role != payload.get("recipient_role"):
            raise ProviderUnavailable("invalid_notification")
        if item.acknowledged_at:
            raise ProviderUnavailable("notification_acknowledged")
        allowed = notification_email_recipients(item.recipient_role)
    if not isinstance(recipients, list) or not recipients or any(recipient not in allowed for recipient in recipients):
        raise ProviderUnavailable("recipient_not_configured")
    try:
        sent = EmailMessage(payload["subject"], payload["text"], settings.DEFAULT_FROM_EMAIL, recipients).send(fail_silently=False)
    except Exception:
        # SMTP can fail after the remote server accepted the message.
        raise ProviderUnavailable("email_delivery_unknown", uncertain=True) from None
    if sent != 1:
        raise ProviderUnavailable("email_not_sent")
    return "smtp_accepted"


@transaction.atomic
def deliver_calendar(payload):
    require_configuration("google_calendar")
    # Serializes competing calendar revisions and domain edits for this event.
    # A stale queue entry never exports a later appointment from another scope.
    appointment = Appointment.objects.select_for_update(of=("self",)).select_related("slot", "supplier").get(pk=payload["appointment"])
    if appointment.revision != payload.get("revision"):
        raise ProviderUnavailable("stale_appointment_revision")
    if payload.get("calendar_id", settings.GOOGLE_CALENDAR_ID) != settings.GOOGLE_CALENDAR_ID:
        raise ProviderUnavailable("calendar_configuration_changed")
    event_id = appointment.pk.hex
    base = "https://www.googleapis.com/calendar/v3/calendars/"+quote(settings.GOOGLE_CALENDAR_ID, safe="")+"/events"
    if appointment.operation_status in {"cancelled", "not_received"}:
        try:
            json_request(base+"/"+event_id, method="DELETE", token=settings.GOOGLE_CALENDAR_ACCESS_TOKEN)
        except ProviderUnavailable as error:
            if error.code not in {"http_404", "http_410"}:
                raise
        return event_id
    start = timezone.make_aware(datetime.combine(appointment.slot.date, datetime.strptime(appointment.slot.time, "%H:%M").time()))
    body = {
        "summary": f"Recebimento — {appointment.supplier.name}",
        "description": f"Reserva Cocapec {appointment.pk}. Revisão {appointment.revision}. "
                       "Marcador do horário agendado; duração de descarga desconhecida. Capacidade governada exclusivamente pelo aplicativo.",
        "start": {"dateTime": start.isoformat(), "timeZone": "America/Sao_Paulo"},
        "end": {"dateTime": (start+timedelta(minutes=1)).isoformat(), "timeZone": "America/Sao_Paulo"},
        "transparency": "transparent", "visibility": "private",
        "extendedProperties": {"private": {"cocapec_appointment": str(appointment.pk), "revision": str(appointment.revision)}},
    }

    def write(url, method, value):
        result = json_request(url, method=method, body=value, token=settings.GOOGLE_CALENDAR_ACCESS_TOKEN)
        if result.get("id") != event_id:
            raise ProviderUnavailable("calendar_unconfirmed_response", uncertain=True)

    try:
        write(base+"/"+event_id, "PUT", body)
    except ProviderUnavailable as error:
        if error.code != "http_404":
            raise
        try:
            write(base, "POST", {"id": event_id, **body})
        except ProviderUnavailable as create_error:
            if create_error.code != "http_409":
                raise
            write(base+"/"+event_id, "PUT", body)
    return event_id


def deliver_whatsapp(payload):
    require_configuration("whatsapp")
    if payload["recipient"] not in settings.WHATSAPP_RECIPIENTS:
        raise ProviderUnavailable("recipient_not_configured")
    data = json_request(
        "https://graph.facebook.com/"+quote(settings.WHATSAPP_API_VERSION, safe="")+"/"+quote(settings.WHATSAPP_PHONE_ID, safe="")+"/messages",
        method="POST", token=settings.WHATSAPP_TOKEN, body={
            "messaging_product": "whatsapp", "to": payload["recipient"], "type": "template",
            "template": {"name": settings.WHATSAPP_TEMPLATE, "language": {"code": settings.WHATSAPP_TEMPLATE_LANGUAGE},
                         "components": [{"type": "body", "parameters": [{"type": "text", "text": payload["text"]}]}]},
        },
    )
    messages = data.get("messages", [])
    if not messages or not messages[0].get("id"):
        raise ProviderUnavailable("missing_message_reference", uncertain=True)
    return messages[0]["id"]


ADAPTERS = {"email": deliver_email, "google_calendar": deliver_calendar, "whatsapp": deliver_whatsapp}


def dispatch_one(delivery_id):
    with transaction.atomic():
        item = OutboundDelivery.objects.select_for_update().get(pk=delivery_id)
        if item.status != "pending":
            return item.status
        if not item.created_by.is_active or user_role(item.created_by) not in {"management", "admin"}:
            item.status, item.error_code = "failed", "actor_no_longer_authorized"
            item.save(update_fields=["status", "error_code", "updated_at"])
            return item.status
        try:
            require_configuration(item.channel)
        except ProviderUnavailable:
            # Keep a disabled queue pending, rather than claiming or losing an attempted send.
            return "not_configured"
        item.status, item.attempts = "sending", item.attempts+1
        item.save(update_fields=["status", "attempts", "updated_at"])
    try:
        reference = ADAPTERS[item.channel](item.payload)
        if not reference:
            raise ProviderUnavailable("missing_delivery_reference", uncertain=True)
    except ProviderUnavailable as error:
        item.status, item.error_code = ("uncertain" if error.uncertain else "failed"), error.code
    except Exception:
        item.status, item.error_code = "uncertain", "unexpected_provider_outcome"
    else:
        item.status, item.error_code, item.provider_reference = "sent", "", reference
    item.save(update_fields=["status", "error_code", "provider_reference", "updated_at"])
    return item.status
