import { Injectable, inject, signal } from "@angular/core";
import { Api } from "./api";

export interface Arrival {
  id: string;
  vehicle_plate: string;
  tractor_plate: string;
  driver_name: string;
  invoice_number: string;
  created_at: string;
  decision: "pending" | "occurrence" | "authorized" | "rejected";
  decided_at: string | null;
  seen_at: string | null;
  created_by_name: string;
  appointment?: string | null;
  occurrence_at?: string | null;
}

/** Aviso interno (ex.: Armazém encaminhou divergência para Compras) entregue pelo mesmo canal em tempo real. */
export interface LiveNotice {
  id: string;
  appointment: string;
  kind: string;
  message: string;
  created_at: string;
  acknowledged_at: string | null;
  vehicle_plate: string;
  driver_name: string;
  supplier_name: string;
}

export interface GateMessage {
  event: "created" | "occurrence" | "authorized" | "rejected";
  arrival: Arrival;
}

@Injectable({ providedIn: "root" })
export class GateLive {
  private api = inject(Api);
  private socket?: WebSocket;
  private stopped = true;
  private connecting = false;
  private generation = 0;
  private attempt = 0;
  private retry?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setTimeout>;
  readonly status = signal<"idle" | "connecting" | "connected" | "disconnected">("idle");
  readonly refreshed = signal(0);
  readonly last = signal<GateMessage | null>(null);
  readonly notice = signal<LiveNotice | null>(null);

  async connect() {
    if (this.connecting || this.retry || (this.socket && this.socket.readyState <= WebSocket.OPEN)) return;
    if (!this.api.token() || typeof location === "undefined") return;
    this.stopped = false;
    this.connecting = true;
    const generation = this.generation;
    if (this.attempt === 0) this.status.set("connecting");
    try {
      const url = await this.api.websocketUrl();
      if (this.stopped || generation !== this.generation) return;
      const socket = new WebSocket(url);
      this.socket = socket;
      socket.onopen = () => {
        if (this.socket !== socket) return;
        this.attempt = 0;
        this.status.set("connected");
        this.refreshed.update(value => value + 1);
        this.armWatchdog(socket);
      };
      socket.onmessage = event => {
        if (this.socket !== socket) return;
        this.armWatchdog(socket);
        try {
          const message = JSON.parse(String(event.data));
          if (message.event === "heartbeat") this.refreshed.update(value => value + 1);
          if (["created", "occurrence", "authorized", "rejected"].includes(message.event) && message.arrival?.id) {
            this.last.set(message as GateMessage);
          }
          if (message.event === "notification" && message.notification?.id) this.notice.set(message.notification as LiveNotice);
        } catch { /* Invalid frames never change the persisted view. */ }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (this.socket !== socket) return;
        this.socket = undefined;
        clearTimeout(this.watchdog);
        this.scheduleRetry();
      };
    } catch {
      if (generation === this.generation && !this.stopped) this.scheduleRetry();
    } finally {
      if (generation === this.generation) this.connecting = false;
    }
  }

  private armWatchdog(socket: WebSocket) {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => socket.close(), 25000);
  }

  private scheduleRetry() {
    if (this.stopped || this.retry) return;
    this.status.set("disconnected");
    this.retry = setTimeout(() => {
      this.retry = undefined;
      void this.connect();
    }, Math.min(10000, 1000 * ++this.attempt));
  }

  close() {
    this.stopped = true;
    this.generation++;
    this.connecting = false;
    clearTimeout(this.retry);
    clearTimeout(this.watchdog);
    this.retry = undefined;
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
    this.last.set(null);
    this.notice.set(null);
    this.status.set("idle");
  }
}
