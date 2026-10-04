/** Painel da descarga (labor/views_unloads.py): cada etapa do dia é um caminhão num armazém. */
export type UnloadStage = "running" | "ready" | "waiting" | "done";
export interface UnloadAction { allowed: boolean; reason: string; }
export interface UnloadItem {
  visit: string; appointment: string; revision: number; sequence: number; stages: number;
  warehouse: string; warehouse_name: string; slot: string; supplier: string; vehicle_plate: string;
  packaging: string; packaging_label: string; stage: UnloadStage; waiting_reason: string;
  checked_in_at: string | null; checked_out_at: string | null; worker_count: number | null;
  needed_chapas: number; needed_gas_forklifts: number; estimated: boolean;
  crew: { id: string; name: string; registration: string }[]; equipment: { id: string; name: string }[];
  actions: Record<string, UnloadAction>;
}
export interface UnloadBoard {
  date: string; origin: string;
  summary: { running: number; ready: number; waiting: number; done: number; chapas_now: number; without_crew: number };
  items: UnloadItem[];
}

export const STAGES: { code: UnloadStage; title: string; empty: string }[] = [
  { code: "running", title: "Em descarga agora", empty: "Nenhum caminhão descarregando agora." },
  { code: "ready", title: "Prontas para entrar", empty: "Nenhuma descarga liberada esperando o armazém." },
  { code: "waiting", title: "Aguardando liberação", empty: "Nada aguardando portaria, Compras ou etapa anterior." },
  { code: "done", title: "Concluídas", empty: "Nenhuma descarga concluída ainda." },
];

export type UnloadStep = "crew" | "check-in" | "check-out" | "view";
/** A próxima ação de quem opera o armazém; quem só consulta sempre vê a equipe. */
export function nextStep(item: UnloadItem, canOperate: boolean): { step: UnloadStep; label: string } {
  if (!canOperate || item.stage === "done") return { step: "view", label: "Ver equipe" };
  if (item.stage === "running") {
    return item.actions["check-out"]?.allowed ? { step: "check-out", label: "Registrar saída" } : { step: "view", label: "Ver equipe" };
  }
  if (!item.crew.length) return { step: "crew", label: "Escalar equipe" };
  if (item.stage === "ready" && item.actions["check-in"]?.allowed) return { step: "check-in", label: "Registrar entrada" };
  return { step: "crew", label: "Ajustar equipe" };
}

/** Equipe frente ao sugerido pelo acondicionamento; o tom só reforça o texto. */
export function crewCoverage(item: UnloadItem): { text: string; tone: "ok" | "short" | "none" } {
  const count = item.stage === "done" && item.worker_count !== null ? item.worker_count : item.crew.length;
  const need = item.needed_chapas;
  const people = `${count} ${count === 1 ? "chapa" : "chapas"}`;
  if (!count) return { text: `Sem equipe · sugerido ${need}`, tone: item.stage === "done" ? "ok" : "none" };
  if (item.stage !== "done" && count < need) return { text: `${people} de ${need} sugeridos`, tone: "short" };
  return { text: item.stage === "done" ? `${people} na saída` : `${people} · sugerido ${need}`, tone: "ok" };
}

export function filterByWarehouse(items: readonly UnloadItem[], warehouse: string): UnloadItem[] {
  return warehouse ? items.filter(item => item.warehouse === warehouse) : [...items];
}

export function groupByStage(items: readonly UnloadItem[]) {
  return STAGES.map(stage => ({ ...stage, items: items.filter(item => item.stage === stage.code) }));
}

/** Armazéns presentes no dia, para o filtro mostrar só o que tem descarga. */
export function warehousesOf(items: readonly UnloadItem[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const item of items) seen.set(item.warehouse, item.warehouse_name);
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function clockTime(value: string | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
