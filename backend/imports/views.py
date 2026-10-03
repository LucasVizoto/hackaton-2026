from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsInternal

from .models import ImportBatch, SeedRun

QUALITY_LIMITS = [
    "Histórico documental não identifica caminhões físicos nem contém tempos medidos.",
    "Peso repetido por pedido e quantidade sem semântica confirmada não são somados como volume físico.",
    "RH contém presença global e pagamento de folha; não contém frações ou custo de boletim por armazém.",
    "Agosto e dezembro de 2025 ausentes não equivalem a zero; janeiro de 2025 é parcial.",
    "Há somente um exemplo de boletim; não foi reconstruída uma série histórica de produção.",
    "XMLs são documentos históricos; itens usam código do fornecedor, sem vínculo automático ao código interno.",
    "Posições de estoque não possuem data informada; valores de RH com datas inválidas ou conflitos permanecem pendentes.",
    "As hipóteses pendentes não possuem esclarecimento registrado da Cocapec.",
]


class QualityView(APIView):
    permission_classes = [IsAuthenticated, IsInternal]

    def get(self, request):
        batches = ImportBatch.objects.filter(active=True).order_by("kind")
        # Hash, paths, codes, names, original values and source rows are intentionally absent.
        baseline = SeedRun.objects.order_by("-completed_at").first()
        safe_fields = ("version", "files", "files_by_kind", "stock_rows", "stock_missing_products", "worker_day_cells",
                       "worker_day_usable_cells", "worker_day_issues", "invoice_keys", "invoices_ready",
                       "invoices_pending", "depots", "equipment", "bulletins")
        return Response({
            "origin": "historico_importado",
            "batches": [{"kind": b.kind, "row_count": b.row_count, "importer_version": b.importer_version,
                         "imported_at": b.imported_at, "summary": b.summary, "issues": b.issues} for b in batches],
            "baseline": {key: baseline.summary[key] for key in safe_fields if key in baseline.summary} if baseline else None,
            "limitations": QUALITY_LIMITS,
            "raw_data_exposed": False,
        })
