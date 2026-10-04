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

/** Mantém apenas chegadas pendentes, da mais antiga (maior espera) para a mais recente. */
export function applyPending(rows: Arrival[], message: GateMessage): Arrival[] {
  const others = rows.filter(row => row.id !== message.arrival.id);
  const next = message.event === "created" && message.arrival.decision === "pending" ? [...others, message.arrival] : others;
  return next.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

/** Replays events observed while the paginated snapshot was loading. Decisions are final. */
export function reconcilePending(snapshot: Arrival[], messages: Iterable<GateMessage>): Arrival[] {
  const events = [...messages];
  const decided = new Set(snapshot.filter(row => row.decision !== "pending").map(row => row.id));
  for (const message of events) {
    if (message.event !== "created" || message.arrival.decision !== "pending") decided.add(message.arrival.id);
  }
  const rows = new Map(snapshot.filter(row => row.decision === "pending" && !decided.has(row.id)).map(row => [row.id, row]));
  for (const message of events) {
    if (!decided.has(message.arrival.id)) rows.set(message.arrival.id, message.arrival);
  }
  return [...rows.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}
