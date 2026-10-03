export interface ChartItem {
  label: string;
  value: number;
}

/** Reads measured counts only. An absent measurement never becomes a zero bar. */
export function chartItems(
  source: unknown,
  labelKey: string,
  formatLabel: (value: string) => string = (value) => value,
): ChartItem[] {
  if (!Array.isArray(source)) return [];
  return source.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    const label = row[labelKey];
    const value = row["count"];
    if (
      typeof label !== "string" ||
      !label.trim() ||
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0
    ) return [];
    return [{ label: formatLabel(label), value }];
  });
}

export function chartDateLabel(date: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return parts ? `${parts[3]}/${parts[2]}/${parts[1]}` : date;
}

/** Top-level null is explicit unavailability and takes precedence over a summary. */
export function operationalMetric(
  source: Record<string, unknown> | null,
  key: string,
): number | null {
  if (!source) return null;
  const summary = source["summary"];
  const value = Object.hasOwn(source, key)
    ? source[key]
    : summary && typeof summary === "object" && !Array.isArray(summary)
      ? (summary as Record<string, unknown>)[key]
      : null;
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}
