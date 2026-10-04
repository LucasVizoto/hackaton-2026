"""Operational logistics counts; gate notices and synthetic records are not passages."""

from datetime import datetime, time, timedelta

from django.db.models import Count, Exists, OuterRef, Q
from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsInternal
from receiving.models import Appointment, WarehouseVisit


class LogisticsView(APIView):
    permission_classes = [IsInternal]

    def get(self, request):
        now = timezone.now()
        today = timezone.localdate(now)
        first_day = today - timedelta(days=6)
        zone = timezone.get_current_timezone()
        start = timezone.make_aware(datetime.combine(first_day, time.min), zone)
        day_start = timezone.make_aware(datetime.combine(today, time.min), zone)
        end = timezone.make_aware(datetime.combine(today + timedelta(days=1), time.min), zone)
        base = Appointment.objects.filter(origin="operacional_registrado")
        completed = base.filter(
            operation_status="completed", finished_at__gte=start, finished_at__lt=end,
        )
        days = dict(completed.annotate(day=TruncDate("finished_at", tzinfo=zone))
                    .values("day").annotate(count=Count("id")).order_by("day")
                    .values_list("day", "count"))
        destinations = list(WarehouseVisit.objects.filter(appointment__in=completed)
                            .values("warehouse_id", "warehouse__name", "warehouse__code")
                            .annotate(count=Count("appointment_id", distinct=True))
                            .order_by("warehouse__code", "warehouse_id"))
        entries = base.filter(gate_checked_in_at__gte=day_start, gate_checked_in_at__lt=end)
        entry_counts = entries.aggregate(
            identified=Count("id", filter=Q(driver_name__regex=r"\S")),
            unidentified=Count("id", filter=~Q(driver_name__regex=r"\S")),
        )
        started_visits = WarehouseVisit.objects.filter(appointment_id=OuterRef("pk")).filter(
            Q(checked_in_at__isnull=False) | Q(started_at__isnull=False),
        )
        queue = base.filter(
            gate_checked_in_at__isnull=False, gate_checked_out_at__isnull=True,
            operation_status__in=["waiting", "arrived"], started_at__isnull=True,
        ).alias(has_started_visit=Exists(started_visits)).filter(has_started_visit=False)
        return Response({
            "origin": "operacional_registrado",
            "reference_date": today.isoformat(),
            "timezone": str(zone),
            "generated_at": now.isoformat(),
            "period": {"date_from": first_day.isoformat(), "date_to": today.isoformat()},
            "summary": {
                "received_today": days.get(today, 0),
                "driver_entries_today": entry_counts["identified"],
                "trucks_in_queue": queue.count(),
            },
            "loads_by_date": [
                {"date": (day := first_day + timedelta(days=index)).isoformat(),
                 "count": days.get(day, 0)}
                for index in range(7)
            ],
            "loads_by_warehouse": [
                {"warehouse": str(row["warehouse_id"]), "warehouse_name": row["warehouse__name"],
                 "count": row["count"]}
                for row in destinations
            ],
            "coverage": {
                "driver_entries_without_name": entry_counts["unidentified"],
                "completed_without_destination": completed.filter(visits__isnull=True).count(),
                "destination_associations": sum(row["count"] for row in destinations),
            },
        })
