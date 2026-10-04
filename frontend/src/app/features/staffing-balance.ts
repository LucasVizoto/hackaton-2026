import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { Api, apiError, money } from "../core/api";
import { FeedbackState, LoadingState, MetricCard } from "../shared/ui";

interface BalanceDay { date: string; day_type: string; status: string; required_peak: number; loads: number; scheduled: string | null; paid_equivalents: string | null; total_payable: string | null; supplement: string | null; below_floor: boolean; production_per_equivalent_day: string | null; avg_wait_minutes: number | null; after_hours_unloads: number; planned_after_hours: number; }
interface Balance {
  period: { date_from: string; date_to: string }; origin: string; synthetic: boolean;
  indicators: { supplement_total: string | null; total_payable: string | null; days_with_bulletin: number; days_without_data: number; days_below_floor: number; days_below_floor_share: string | null; production_per_equivalent_day: string | null; floor_per_day: string; avg_paid_equivalents: string | null; avg_required_peak: string | null; avg_wait_minutes: number | null; after_hours_unloads: number };
  signal: { status: string; message: string };
  warehouse_costs: { warehouse: string | null; warehouse_name: string; total_payable: string; supplement: string; production: string }[];
  days: BalanceDay[]; limits: string[];
}
export interface BalanceFilters { date_from: string; date_to: string; origin: string; }

const SIGNAL: Record<string, string> = { sobra: "Sinal de sobra", falta: "Sinal de falta", atencao: "Atenção", equilibrio: "Equilíbrio", sem_dado: "Sem dado" };

@Component({
  selector: "app-staffing-balance",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FeedbackState, LoadingState, MetricCard],
  styles: [`
    .signal { padding: 14px 18px; border-radius: var(--radius-control); margin: 12px 0 4px; background: var(--surface-subtle); }
    .signal.sobra, .signal.atencao { background: var(--warning-soft); color: var(--warning); }
    .signal.falta { background: var(--danger-soft); color: var(--danger); }
    .signal.equilibrio { background: var(--info-soft); color: var(--blue); }
    td.missing { color: var(--warning); font-style: italic; }
    tr.weekend td { color: var(--muted); }
  `],
  template: `<section class="section">
  <h2>Chapas: sobra ou falta</h2>
  <p class="muted">Cruza o que a agenda exigia (normas por tipo de carga), quem foi escalado e o que o boletim do dia pagou. O complemento é o sinal mais confiável de sobra; a agenda aponta quando e onde.</p>
  @if (error()) { <div app-feedback tone="error">{{ error() }}</div> }
  @if (busy() && !data()) { <app-loading-state label="Cruzando agenda, escala e boletins…" /> }
  @if (data(); as b) {
    @if (b.synthetic) { <p class="notice synthetic">Dados de demonstração: não representam a operação da Cocapec.</p> }
    <div class="signal" [class]="'signal ' + b.signal.status" role="status"><strong>{{ signalLabel(b.signal.status) }}.</strong> {{ b.signal.message }}</div>
    <div class="metric-grid">
      <app-metric-card label="Complemento pago" [value]="money(b.indicators.supplement_total)" hint="Pago sem produção correspondente" tone="warning" />
      <app-metric-card label="Dias abaixo do piso" [value]="percent(b.indicators.days_below_floor_share)" [hint]="b.indicators.days_below_floor + ' de ' + b.indicators.days_with_bulletin + ' dias com boletim'" />
      <app-metric-card label="Produção por diária" [value]="money(b.indicators.production_per_equivalent_day)" [hint]="'Piso: ' + money(b.indicators.floor_per_day)" tone="brand" />
      <app-metric-card label="Chapas: exigidos × pagos" [value]="(b.indicators.avg_required_peak ?? '—') + ' × ' + (b.indicators.avg_paid_equivalents ?? '—')" hint="Média do pico da agenda × diárias do boletim" tone="info" />
      <app-metric-card label="Espera do caminhão" [value]="b.indicators.avg_wait_minutes === null ? 'Não disponível' : b.indicators.avg_wait_minutes + ' min'" hint="Início da descarga − chegada" />
      <app-metric-card label="Descargas após o expediente" [value]="b.indicators.after_hours_unloads" hint="Falta ou agenda mal distribuída" />
      <app-metric-card label="Dias úteis sem dado" [value]="b.indicators.days_without_data" hint="Sem boletim: nunca contado como R$ 0" />
      <app-metric-card label="Custo apurado" [value]="money(b.indicators.total_payable)" hint="Mão de obra do boletim, sem encargos" />
    </div>
    @if (b.warehouse_costs.length) {
      <h3>Custo por armazém</h3>
      <div class="table-wrap" tabindex="0" role="region" aria-label="Custo por armazém"><table><thead><tr><th>Armazém</th><th class="numeric">Produção</th><th class="numeric">Complemento</th><th class="numeric">Custo</th></tr></thead>
        <tbody>@for (row of b.warehouse_costs; track row.warehouse_name) { <tr><td>{{ row.warehouse_name }}</td><td class="numeric">{{ money(row.production) }}</td><td class="numeric">{{ money(row.supplement) }}</td><td class="numeric"><strong>{{ money(row.total_payable) }}</strong></td></tr> }</tbody></table></div>
      <p class="field-help">O boletim é único por dia: o custo é dividido pela participação de cada armazém na produção. Dia sem produção (sábado de organização) fica como não atribuído.</p>
    }
    <details class="section"><summary>Dia a dia</summary>
      <div class="table-wrap" tabindex="0" role="region" aria-label="Sobra ou falta por dia"><table><thead><tr><th>Dia</th><th class="numeric">Pico exigido</th><th class="numeric">Escalados</th><th class="numeric">Pagos (diárias)</th><th class="numeric">Produção/diária</th><th class="numeric">Complemento</th><th class="numeric">Espera</th><th class="numeric">Após expediente</th></tr></thead>
        <tbody>@for (day of b.days; track day.date) { <tr [class.weekend]="day.day_type !== 'workday'">
          <td>{{ day.date }}</td><td class="numeric">{{ day.required_peak }}</td><td class="numeric">{{ day.scheduled ?? "—" }}</td>
          @if (day.status === "fechado") { <td class="numeric">{{ day.paid_equivalents }}</td><td class="numeric">{{ money(day.production_per_equivalent_day) }}</td><td class="numeric">{{ money(day.supplement) }}</td> }
          @else { <td class="missing" colspan="3">{{ day.status === "rascunho" ? "boletim em rascunho" : "sem dado" }}</td> }
          <td class="numeric">{{ day.avg_wait_minutes === null ? "—" : day.avg_wait_minutes + " min" }}</td><td class="numeric">{{ day.after_hours_unloads }}</td>
        </tr> }</tbody></table></div>
    </details>
    <ul class="field-help">@for (limit of b.limits; track limit) { <li>{{ limit }}</li> }</ul>
    <p class="field-help"><a routerLink="/escala">Abrir a escala</a> · <a routerLink="/boletins" [queryParams]="{ visao: 'quinzena' }">Acerto da quinzena</a></p>
  }
</section>`,
})
export class StaffingBalance {
  private api = inject(Api);
  filters = input<BalanceFilters | null>(null);
  data = signal<Balance | null>(null);
  busy = signal(false);
  error = signal("");
  money = money;
  private generation = 0;
  constructor() {
    effect(() => { const filters = this.filters(); if (filters) void this.load(filters); });
  }
  signalLabel(value: string) { return SIGNAL[value] ?? value; }
  percent(value: string | null) { return value === null ? "Não disponível" : new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 0 }).format(Number(value)); }
  private async load(filters: BalanceFilters) {
    const generation = ++this.generation;
    this.busy.set(true);
    this.error.set("");
    try {
      // O cruzamento dia a dia aceita até 93 dias; períodos maiores usam os últimos 93.
      const end = new Date(`${filters.date_to}T12:00:00`);
      const earliest = new Date(end.getTime() - 92 * 86400000).toISOString().slice(0, 10);
      const date_from = filters.date_from < earliest ? earliest : filters.date_from;
      const result = await this.api.get<Balance>(`analytics/staffing-balance/?${new URLSearchParams({ ...filters, date_from })}`);
      if (generation === this.generation) this.data.set(result);
    } catch (e) { if (generation === this.generation) { this.data.set(null); this.error.set(apiError(e)); } }
    finally { if (generation === this.generation) this.busy.set(false); }
  }
}
