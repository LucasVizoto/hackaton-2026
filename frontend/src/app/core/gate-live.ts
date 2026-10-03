import { Injectable, inject, signal } from "@angular/core";
import { Api } from "./api";

export interface Arrival {
  id: string;
  vehicle_plate: string;
  tractor_plate: string;
  driver_name: string;
  invoice_number: string;
  created_at: string;
  decision: "pending" | "authorized" | "rejected";
  decided_at: string | null;
  seen_at: string | null;
  created_by_name: string;
}

export interface GateMessage {
  event: "created" | "authorized" | "rejected";
  arrival: Arrival;
}

@Injectable({ providedIn: "root" })
export class GateLive {
  private api = inject(Api);
  private socket?: WebSocket;
  private stopped = true;
  private attempt = 0;
  readonly last = signal<GateMessage | null>(null);

  connect() {
    this.stopped = false;
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;
    const token = this.api.token();
    if (!token || typeof location === "undefined") return;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/ws/gate/?token=${encodeURIComponent(token)}`);
    this.socket = socket;
    socket.onopen = () => {
      this.attempt = 0;
    };
    socket.onmessage = (event) => {
      try {
        this.last.set(JSON.parse(String(event.data)) as GateMessage);
      } catch {
        /* Ignora um quadro que não seja o aviso de chegada. */
      }
    };
    socket.onclose = () => {
      if (this.socket === socket) this.socket = undefined;
      if (this.stopped) return;
      this.attempt += 1;
      window.setTimeout(() => this.connect(), Math.min(10000, 1000 * this.attempt));
    };
  }

  close() {
    this.stopped = true;
    this.socket?.close();
    this.socket = undefined;
    this.last.set(null);
  }
}
