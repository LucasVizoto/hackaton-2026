/** Formats API numbers for display without changing form values or calculations. */
export function decimal(value: unknown, maximumFractionDigits = 6, minimumFractionDigits = 0): string {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !value.trim())) return "Não disponível";
  const number = Number(value);
  if (!Number.isFinite(number)) return "Não disponível";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits, minimumFractionDigits }).format(number);
}

const operationLabels: Record<string, string> = {
  waiting: 'Agendado', scheduled: 'Agendado', arrived: 'No pátio', in_progress: 'Em descarga', unloading: 'Em descarga',
  completed: 'Descarga concluída', cancelled: 'Cancelado', not_received: 'Não recebido',
};
export function operationLabel(value: string): string { return operationLabels[value] ?? 'Estado não reconhecido'; }
const occurrenceLabels: Record<string, string> = {
  EARLY_LEAVE: 'Saída antecipada', OVERTIME: 'Horas extras', SPECIAL_DAILY: 'Diária especial',
  FRACTION: 'Fração sem regra definida', OTHER: 'Outra regra pendente',
};
export function occurrenceLabel(value: string): string { return occurrenceLabels[value] ?? 'Regra pendente'; }
