import { Arrival, GateMessage } from "./gate-live";

/** Minutos de espera na portaria a partir dos quais o alerta sobe de nível. */
export const WAIT_WARNING_MINUTES = 15;
export const WAIT_CRITICAL_MINUTES = 30;

export type WaitLevel = 0 | 1 | 2;

export function waitMinutes(createdAt: string, now: number): number {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return 0;
  return Math.max(0, Math.floor((now - created) / 60000));
}

export function waitLevel(minutes: number): WaitLevel {
  if (minutes >= WAIT_CRITICAL_MINUTES) return 2;
  if (minutes >= WAIT_WARNING_MINUTES) return 1;
  return 0;
}

export function waitLabel(minutes: number): string {
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `há ${hours} h ${rest} min` : `há ${hours} h`;
}

/** Etapa que o alerta acompanha: o evento que coloca a chegada na fila e a decisão que a mantém lá. */
export interface AlertStage { event: GateMessage["event"]; decision: Arrival["decision"]; }
/** Armazém: chegadas avisadas pela portaria e ainda pendentes. */
export const WAREHOUSE_STAGE: AlertStage = { event: "created", decision: "pending" };
/** Compras: ocorrências abertas pelo Armazém aguardando aprovação ou recusa. */
export const OCCURRENCE_STAGE: AlertStage = { event: "occurrence", decision: "occurrence" };

/** O evento coloca (ou mantém) a chegada na fila da etapa. */
export function entersStage(message: GateMessage, stage: AlertStage = WAREHOUSE_STAGE): boolean {
  return message.event === stage.event && message.arrival.decision === stage.decision;
}

/** Mantém apenas chegadas da etapa, da mais antiga (maior espera) para a mais recente. */
export function applyPending(rows: Arrival[], message: GateMessage, stage: AlertStage = WAREHOUSE_STAGE): Arrival[] {
  const others = rows.filter(row => row.id !== message.arrival.id);
  const next = entersStage(message, stage) ? [...others, message.arrival] : others;
  return next.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

/** Replays events observed while the paginated snapshot was loading. Leaving the stage is final. */
export function reconcilePending(snapshot: Arrival[], messages: Iterable<GateMessage>, stage: AlertStage = WAREHOUSE_STAGE): Arrival[] {
  const events = [...messages];
  const decided = new Set(snapshot.filter(row => row.decision !== stage.decision).map(row => row.id));
  for (const message of events) {
    if (!entersStage(message, stage)) decided.add(message.arrival.id);
  }
  const rows = new Map(snapshot.filter(row => row.decision === stage.decision && !decided.has(row.id)).map(row => [row.id, row]));
  for (const message of events) {
    if (!decided.has(message.arrival.id)) rows.set(message.arrival.id, message.arrival);
  }
  return [...rows.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}
