import { dateTime, originLabel } from './api';
import { chartDateLabel } from './chart-data';

const qualityLabels: Record<string, string> = {

        batches: "Lotes de importação",
        issues: "Pendências encontradas",
        row_count: "Linhas",
        kind: "Tipo",
        origin: "Origem",
        importer_version: "Versão do importador",
        imported_at: "Importado em",
        summary: "Resumo agregado",
        accepted_rows: "Linhas aceitas",
        pending_rows: "Linhas com pendências",
        rejected_rows: "Linhas rejeitadas",
        preserved_rows: "Linhas preservadas",
        limitations: "Limitações das fontes",
        raw_data_exposed: "Dados originais expostos",
        products: "Produtos",
        suppliers: "Fornecedores",
        workers: "Matrículas de chapas",
        movements: "Movimentações documentais",
        labor_days: "Presença diária de mão de obra",
        unique_products: "Produtos distintos",
        unique_product_depot_pairs: "Pares distintos de produto e depósito",
        unique_suppliers: "Fornecedores distintos",
        unique_workers: "Matrículas distintas",
        bulletins_imported: "Boletins importados",
        document_rows: "Linhas documentais",
        unique_orders: "Pedidos distintos",
        unique_document_receipts: "Recebimentos documentais distintos",
        first_date: "Primeira data",
        last_date: "Última data",
        orders_with_constant_reported_weight:
          "Pedidos com peso informado constante",
        trucks_identified: "Caminhões físicos identificados",
        measured_timestamps_available: "Horários medidos disponíveis",
        quantity_semantics_confirmed: "Significado da quantidade confirmado",
        weight_semantics_confirmed: "Significado do peso confirmado",
        observed_dates: "Datas observadas",
        observed_months: "Meses observados",
        missing_months_documented: "Meses ausentes documentados",
        half_days_available: "Meias diárias disponíveis",
        warehouse_allocation_available: "Distribuição por armazém disponível",
        bulletin_cost_available: "Custo de boletim disponível",
        missing_product_code: "Código de produto ausente",
        conflicting_product_attributes: "Atributos de produto conflitantes",
        duplicate_product_depot_rows: "Linhas de produto e depósito duplicadas",
        missing_weight: "Peso ausente",
        invalid_weight: "Peso inválido",
        missing_supplier_code: "Código de fornecedor ausente",
        missing_supplier_document: "Documento de fornecedor ausente",
        documents_shared_by_codes:
          "Documentos compartilhados por códigos de fornecedor",
        duplicate_worker_registration: "Matrículas de chapas duplicadas",
        missing_or_invalid_received_on:
          "Data de recebimento ausente ou inválida",
        missing_quantity: "Quantidade ausente",
        invalid_quantity: "Quantidade inválida",
        negative_quantity_preserved: "Quantidade negativa preservada",
        missing_invoice_key: "Chave de nota fiscal ausente",
        invalid_invoice_key: "Chave de nota fiscal inválida",
        missing_purchase_order: "Pedido de compra ausente",
        missing_receipt_number: "Número de recebimento ausente",
        missing_or_invalid_order_date: "Data do pedido ausente ou inválida",
        missing_or_invalid_document_date:
          "Data do documento ausente ou inválida",
        duplicate_day_preserved: "Datas duplicadas preservadas",
        coffee_workers_above_total: "Chapas na operação de café acima do total",
        product_missing_from_current_catalog:
          "Produto ausente do catálogo atual",
        product_depot_pair_missing_from_current_catalog:
          "Par de produto e depósito ausente do catálogo atual",
        supplier_missing_from_current_catalog:
          "Fornecedor ausente do catálogo atual",

baseline: "Pacote histórico instalado", catalog_links_checked: "Vínculos com os catálogos conferidos",
version: "Versão", files: "Arquivos", files_by_kind: "Arquivos por tipo", stock_rows: "Posições de estoque",
stock_missing_products: "Posições sem produto correspondente", worker_day_cells: "Células de presença e folha",
worker_day_usable_cells: "Células aproveitáveis", worker_day_issues: "Pendências de presença e folha",
invoice_keys: "Chaves fiscais distintas", invoices_ready: "Notas disponíveis", invoices_pending: "Notas pendentes",
depots: "Depósitos", equipment: "Equipamentos", bulletins: "Boletins", source_files: "Arquivos de origem",
rows: "Linhas", warnings: "Avisos", skipped_rows: "Linhas ignoradas", invalid_dates: "Datas inválidas",
missing_dates: "Datas ausentes", duplicate_dates: "Datas duplicadas", total_rows: "Total de linhas",
accepted: "Aceitas", pending: "Pendentes", rejected: "Rejeitadas", ready: "Disponíveis",
xml: "XML", pdf: "PDF", xlsx: "Planilhas", csv: "CSV", documents: "Documentos",
stock: "Estoque", worker_days: "Presença e folha", invoices: "Notas fiscais", completed_at: "Concluído em",
sheet: "Aba", month: "Mês", year: "Ano", count: "Quantidade", status: "Estado",
};
export function qualityLabel(key: string): string { return qualityLabels[key] ?? 'Informação adicional'; }
export function knownQualityField(key: string): boolean { return key in qualityLabels; }
export function qualityValue(value: unknown, field = ''): string {
  if (value === null || value === undefined) return 'Não disponível';
  if (field === 'origin') return originLabel(String(value));
  if (field === 'kind') return qualityLabel(String(value));
  if (['imported_at', 'completed_at', 'updated_at'].includes(field)) return dateTime(String(value));
  if (['first_date', 'last_date', 'reference_date'].includes(field)) return chartDateLabel(String(value));
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'object') {
    if (Array.isArray(value)) return value.map(item => qualityValue(item)).join(' · ') || 'Nenhum registro';
    if (field === 'issues' && !Object.keys(value).length) return 'Nenhuma pendência registrada';
    const known = Object.entries(value).filter(([key]) => knownQualityField(key));
    return known.map(([key, item]) => `${qualityLabel(key)}: ${qualityValue(item, key)}`).join(' · ') || 'Consulte os detalhes técnicos';
  }
  return String(value);
}
