import { DestroyRef, inject, Injectable, signal } from "@angular/core";
import { HttpErrorResponse } from "@angular/common/http";
import { Api, apiError } from "./api";

export interface LogisticsSnapshot {
  origin: "operacional_registrado";
  reference_date: string;
  timezone: string;
  generated_at: string;
  period: { date_from: string; date_to: string };
  summary: { received_today: number; driver_entries_today: number; trucks_in_queue: number };
  loads_by_date: { date: string; count: number }[];
  loads_by_warehouse: { warehouse: string; warehouse_name: string; count: number }[];
  coverage: { driver_entries_without_name: number; completed_without_destination: number; destination_associations: number };
}

/** Scoped to the page so a previous session cannot leave cached operational counts. */
@Injectable()
export class LogisticsState {
  private api = inject(Api);
  private controller?: AbortController;
  readonly snapshot = signal<LogisticsSnapshot | null>(null);
  readonly busy = signal(false);
  readonly error = signal("");
  constructor() { inject(DestroyRef).onDestroy(() => this.controller?.abort()); }
  async load() {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set("");
    const controller = this.controller = new AbortController();
    try { this.snapshot.set(await this.api.get<LogisticsSnapshot>("analytics/logistics/", controller.signal)); }
    catch (error) {
      if (!controller.signal.aborted) this.error.set(
        error instanceof HttpErrorResponse && (error.status === 0 || error.status >= 500)
          ? "Não foi possível consultar os indicadores. Use Atualizar para tentar novamente."
          : apiError(error),
      );
    }
    finally { this.busy.set(false); }
  }
}
