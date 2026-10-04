export interface DailyCost {
  date: string;
  production: string | null;
  total_payable: string | null;
  supplement: string | null;
  bulletin_count: number;
}
export interface WeeklySupplement {
  period: { date_from: string; date_to: string };
  closed_bulletins: number;
  leaders: string[];
  groups: { warehouse: string; warehouse_name: string; supplement: string; bulletin_count: number; covered_dates: string[] }[];
}
export interface WarehouseWait {
  warehouse: string;
  warehouse_name: string;
  average_minutes: number | null;
  valid_records: number;
  excluded_records: number;
}

export function waitLeaders(rows: readonly WarehouseWait[] | null | undefined): WarehouseWait[] {
  const measured = (rows ?? []).filter(row => row.valid_records > 0 && row.average_minutes !== null && Number.isFinite(row.average_minutes) && row.average_minutes >= 0);
  const maximum = Math.max(...measured.map(row => row.average_minutes!));
  return measured.filter(row => row.average_minutes === maximum);
}

export function waitDuration(minutes: number): string {
  const rounded = Math.round(minutes);
  return rounded >= 60 ? `${Math.floor(rounded / 60)}h ${String(rounded % 60).padStart(2, "0")}m` : `${rounded} min`;
}

/** Numbers are used only for drawing; monetary aggregation stays on the server. */
export function costChart(series: readonly DailyCost[]) {
  const valid = (row: DailyCost) => row.bulletin_count > 0 && [row.production, row.total_payable, row.supplement].every(value =>
    typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0);
  const measured = series.filter(valid);
  const maximum = Math.max(1, ...measured.flatMap(row => [Number(row.production), Number(row.total_payable)]));
  const x = (index: number) => series.length === 1 ? 432 : 88 + index / (series.length - 1) * 688;
  const y = (value: number) => 210 - value / maximum * 176;
  const segments: { points: { row: DailyCost; x: number; productionY: number; payableY: number }[]; production: string; payable: string; area: string }[] = [];
  let points: (typeof segments)[number]["points"] = [];
  const flush = () => {
    if (!points.length) return;
    const path = (key: "productionY" | "payableY") => points.map((p, index) => `${index ? "L" : "M"}${p.x},${p[key]}`).join(" ");
    const production = path("productionY"), payable = path("payableY");
    const area = points.length > 1 ? `${payable} ${[...points].reverse().map(p => `L${p.x},${p.productionY}`).join(" ")} Z` : "";
    segments.push({ points, production, payable, area });
    points = [];
  };
  series.forEach((row, index) => {
    if (!valid(row)) { flush(); return; }
    points.push({ row, x: x(index), productionY: y(Number(row.production)), payableY: y(Number(row.total_payable)) });
  });
  flush();
  const indices = [...new Set([0, Math.floor((series.length - 1) / 2), series.length - 1])].filter(index => index >= 0 && index < series.length);
  return { segments, measuredDays: measured.length,
    ticks: [0, .5, 1].map(fraction => ({ value: maximum * fraction, y: y(maximum * fraction) })),
    dates: indices.map(index => ({ date: series[index].date, x: x(index) })),
  };
}

export function managementPeriodError(from: string, to: string): string {
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!validDate(from) || !validDate(to)) return "Informe datas válidas para o início e o fim do período.";
  if (from > to) return "A data inicial deve preceder a final.";
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 366 * 6) return "Selecione um período de até seis anos.";
  return "";
}
