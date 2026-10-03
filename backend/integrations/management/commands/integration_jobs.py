"""Configure your scheduler to run this command. No task is installed or sent implicitly."""
from datetime import date

from django.conf import settings
from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError

from core.permissions import user_role
from receiving.models import Appointment, InternalNotification
from integrations.models import OutboundDelivery
from integrations.outbound import dispatch_one
from integrations.providers import configuration, notification_email_recipients
from integrations.views import analytics_context


class Command(BaseCommand):
    help = "Prepara resumos, alertas e agenda; --send despacha somente o lote pendente do ator, origem e período informados."

    def add_arguments(self, parser):
        parser.add_argument("--actor", required=True)
        parser.add_argument("--date-from", type=date.fromisoformat, required=True)
        parser.add_argument("--date-to", type=date.fromisoformat, required=True)
        parser.add_argument("--origin", choices=["operacional_registrado", "demo_sintetico"], default="operacional_registrado")
        parser.add_argument("--send", action="store_true")

    def handle(self, *args, **options):
        actor = User.objects.filter(username=options["actor"], is_active=True).first()
        if not actor or user_role(actor) not in {"management", "admin"}:
            raise CommandError("Use uma conta ativa de Gestão/Administrador para gerar o resumo autorizado.")
        first, last = options["date_from"], options["date_to"]
        if first > last or (last-first).days+1 > 366:
            raise CommandError("Período inválido; máximo 366 dias.")
        filters = {"date_from": first, "date_to": last, "origin": options["origin"]}
        scope = {"actor_id": actor.pk, "origin": options["origin"], "date_from": str(first), "date_to": str(last)}
        prepared = []

        def enqueue(key, channel, payload):
            item, _ = OutboundDelivery.objects.get_or_create(dedupe_key=key, defaults={
                "channel": channel, "created_by": actor, "payload": {**payload, "scope": scope}})
            # Keep old unscoped work and another actor's work untouched. Changing
            # command arguments is never authorization to send the entire backlog.
            if item.created_by_id == actor.pk and item.payload.get("scope") == scope:
                prepared.append(item.pk)

        context = analytics_context(actor, filters)
        summary = context["financial_summary"]
        text = (f"Cocapec | {first} a {last} | {options['origin']}\n"
                f"Recebimentos concluídos: {context['received_loads']}\n"
                f"Produção: {summary['display']['production']}; apurado: {summary['display']['total_payable']}; "
                f"complemento: {summary['display']['supplement']}\n"
                "Valores ausentes permanecem indisponíveis. Apuração de boletim, não pagamento RH. Consulte o painel para cobertura e fontes.")
        key = f"digest:{options['origin']}:{first}:{last}"
        if settings.DIGEST_EMAIL_RECIPIENTS:
            enqueue(key+":email", "email", {"subject": "Resumo gerencial Cocapec", "text": text, "recipients": settings.DIGEST_EMAIL_RECIPIENTS})
        for recipient in settings.WHATSAPP_RECIPIENTS:
            enqueue(key+":wa:"+recipient, "whatsapp", {"text": text, "recipient": recipient})
        if configuration()["google_calendar"]:
            for appointment in Appointment.objects.filter(origin=options["origin"], slot__date__range=(first, last)):
                enqueue(f"calendar:{appointment.pk}:{appointment.revision}", "google_calendar", {
                    "appointment": str(appointment.pk), "revision": appointment.revision, "calendar_id": settings.GOOGLE_CALENDAR_ID})
        for notification in InternalNotification.objects.filter(
            appointment__origin=options["origin"], appointment__slot__date__range=(first, last), acknowledged_at__isnull=True,
        ).select_related("appointment__slot"):
            recipients = notification_email_recipients(notification.recipient_role)
            if recipients:
                enqueue(f"notification:{notification.pk}:email", "email", {
                    "kind": "internal_notification", "notification_id": str(notification.pk),
                    "recipient_role": notification.recipient_role, "recipients": recipients,
                    "subject": "Aviso de recebimento Cocapec", "text": notification.message+"\n"
                    +f"Recebimento: {notification.appointment_id}; data reservada: {notification.appointment.slot.date}. "
                    +"Consulte o aplicativo para detalhes e confirmação de leitura.",
                })
        outcomes = {}
        if options["send"]:
            for item in OutboundDelivery.objects.filter(pk__in=prepared, created_by=actor, status="pending").order_by("created_at", "id")[:500]:
                result = dispatch_one(item.pk)
                outcomes[result] = outcomes.get(result, 0)+1
        self.stdout.write(str({"queued_in_scope": OutboundDelivery.objects.filter(pk__in=prepared, status="pending").count(), "outcomes": outcomes,
                               "note": "Resultado desconhecido ou em envio não será reenviado automaticamente."}))
