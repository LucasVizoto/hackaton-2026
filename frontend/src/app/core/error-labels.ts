const fields: Record<string, string> = {
  invoice: 'Nota fiscal', invoices: 'Notas fiscais', invoice_ids: 'Notas fiscais', invoice_item: 'Item da nota',
  supplier: 'Fornecedor', warehouse: 'Armazém', warehouse_ids: 'Destinos', visit_id: 'Etapa',
  vehicle_plate: 'Placa do veículo', tractor_plate: 'Placa do cavalo', driver_name: 'Motorista', carrier_name: 'Transportadora',
  date: 'Data', reference_date: 'Data de referência', date_from: 'Início do período', date_to: 'Fim do período',
  time: 'Horário', occurred_at: 'Data e hora do evento', packaging: 'Embalagem', file: 'Documento',
  number: 'Número da nota', access_key: 'Chave de acesso', reason: 'Motivo', notes: 'Observações',
  decision: 'Decisão', comparison_notes: 'Conferência de Compras', order_reference: 'Pedido',
  expected_revision: 'Versão do recebimento', revision: 'Versão do registro', target_revision: 'Versão do destino',
  participants: 'Equipe participante', worker: 'Pessoa', worker_count: 'Quantidade de pessoas', fraction: 'Fração de participação',
  equipment_ids: 'Equipamentos', resources_confirmed: 'Recursos confirmados', lines: 'Itens', category: 'Categoria',
  unloading: 'Descarga', removal: 'Remoção', transfer: 'Transferência', daily_services: 'Serviços de diária', quantity: 'Quantidade',
  observed_quantity: 'Quantidade observada', accepted_quantity: 'Quantidade aceita', rejected_quantity: 'Quantidade recusada',
  declared_quantity: 'Quantidade declarada', ordered_quantity: 'Quantidade confirmada', description: 'Descrição', unit: 'Unidade',
  discrepancy_reason: 'Motivo da divergência', decision_notes: 'Justificativa da decisão', purchase_order_line: 'Item do pedido',
  previous_receipt_line: 'Entrega anterior', previous_appointment: 'Recebimento anterior', resubmission_reason: 'Motivo da nova solicitação',
  origin: 'Origem dos dados', bulletin: 'Boletim', target_bulletin: 'Boletim de destino', rule_occurrences: 'Regras pendentes',
  resolution_type: 'Tipo de resolução', conflicting_bulletin: 'Boletim com participação conflitante',
  username: 'Usuário', password: 'Senha', signer_name: 'Responsável pela conferência', declaration: 'Declaração de conferência',
  registration: 'Matrícula', name: 'Nome', reference: 'Referência', confirmation_notes: 'Confirmação do comprador',
  attendance_state: 'Estado da presença', activity_type: 'Tipo de atividade', ready: 'Prontidão',
  idempotency_key: 'Identificação da solicitação', production_records: 'Fontes de produção', proposed_fraction: 'Fração proposta',
};
export function errorFieldLabel(key: string): string {
  return fields[key] ?? (/^\d+$/.test(key) ? `Item ${Number(key) + 1}` : 'Dados informados');
}
