/** Input validation keeps document identifiers and decimal values lossless. */
export function invoiceNumber(value: string): string {
  const number = value.trim();
  if (!/^[1-9]\d{0,8}$/.test(number)) throw new Error("Informe o número da NF com 1 a 9 dígitos, sem letras, sinais ou casas decimais.");
  return number;
}
export function quantity(value: unknown, precision = 4): string {
  const raw = String(value ?? "").trim();
  if (!new RegExp(`^\\d+(?:[.,]\\d{1,${precision}})?$`).test(raw))
    throw new Error(`Informe uma quantidade não negativa com até ${precision} casas decimais, sem separador de milhar.`);
  return raw.replace(",", ".");
}
export interface AvailableAction { code: string; allowed: boolean; reason: string; }
export function allowed(actions: readonly AvailableAction[] | undefined, code: string): boolean {
  return actions?.some(action => action.code === code && action.allowed === true) === true;
}
export interface AvailableSlot { time: string; eligible: boolean; reason: string; used_units?: number; available_units?: number; can_machine_implement?: boolean; }
export function revalidatedTime(previous:string, slots:readonly AvailableSlot[]):string { return slots.some(slot=>slot.eligible===true && slot.time.slice(0,5)===previous) ? previous : ""; }
export function uploadIdentity(file: Pick<File, "name" | "size" | "lastModified">, supplier: string, number: string): string {
  return JSON.stringify([file.name, file.size, file.lastModified, supplier, number]);
}
export function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}
export function exportCsv(filename: string, rows: readonly (readonly unknown[])[]): void {
  const blob = new Blob(["\uFEFF", rows.map(row => row.map(csvCell).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
