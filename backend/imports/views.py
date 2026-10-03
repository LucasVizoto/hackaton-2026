from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsInternal

from .models import ImportBatch

QUALITY_LIMITS = [
    "Histórico documental não identifica caminhões físicos nem contém tempos medidos.",
    "Peso repetido por pedido e quantidade sem semântica confirmada não são somados como volume físico.",
    "RH contém presença global e pagamento de folha; não contém frações ou custo de boletim por armazém.",
    "Agosto e dezembro de 2025 ausentes não equivalem a zero; janeiro de 2025 é parcial.",
    "Há somente um exemplo de boletim; não foi reconstruída uma série histórica de produção.",
    "XMLs são amostra de formato; itens usam código do fornecedor e não são joined ao código interno.",
    "As hipóteses pendentes não possuem esclarecimento registrado da Cocapec.",
]


class QualityView(APIView):
    permission_classes = [IsAuthenticated, IsInternal]

    def get(self, request):
        batches = ImportBatch.objects.filter(active=True).order_by("kind")
        # Hash, paths, codes, names, original values and source rows are intentionally absent.
        return Response({"origin": "historico_importado", "batches": [{"kind": b.kind, "row_count": b.row_count, "importer_version": b.importer_version, "imported_at": b.imported_at, "summary": b.summary, "issues": b.issues} for b in batches], "limitations": QUALITY_LIMITS, "raw_data_exposed": False})
