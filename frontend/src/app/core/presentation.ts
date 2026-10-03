/** Formats API numbers for display without changing form values or calculations. */
export function decimal(value: unknown, maximumFractionDigits = 6, minimumFractionDigits = 0): string {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !value.trim())) return "Não disponível";
  const number = Number(value);
  if (!Number.isFinite(number)) return "Não disponível";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits, minimumFractionDigits }).format(number);
}
