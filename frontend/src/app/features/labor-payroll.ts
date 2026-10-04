import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { IonButton } from "@ionic/angular/standalone";
import { Api, apiError, money, today } from "../core/api";
import { exportCsv } from "../core/workflow";
import { FeedbackState, LoadingState, MetricCard, PageHeader } from "../shared/ui";

interface Adjustment { id: string; worker: string; registration: string; name: string; reference_date: string; kind: string; kind_label: string; amount: string; reason: string; created_by: string; created_at: string; }
interface SettlementDay { date: string; weekday: number; status: string; holiday: boolean; bulletins: string[]; }
interface SettlementWorker { worker: string; registration: string; name: string; contract_type: string; days: Record<string, { value: string; fraction: string }>; equivalent_days: string; base_total: string; adjustments: Adjustment[]; adjustments_total: string; total: string; }
interface Settlement { period: { date_from: string; date_to: string; half: number; label: string }; origin: string; days: SettlementDay[]; workers: SettlementWorker[]; totals: { base: string; adjustments: string; total: string; days_without_data: number; draft_days: number }; notes: string[]; }
interface Rate { code: string; label: string; price: string; }
interface TariffTable { id: string; valid_from: string; floor_per_day: string; notes: string; approved_by: string; created_at: string; rates: Rate[]; }
interface Tariffs { date: string; current: { table: string | null; valid_from: string | null; floor_per_day: string; rates: Rate[] }; default_floor: string; tables: TariffTable[]; }

const STATUS: Record<string, string> = { fechado: "Fechado", rascunho: "Rascunho", sem_dado: "Sem dado", sem_expediente: "Sem expediente" };

@Component({
  selector: "app-labor-payroll",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, IonButton, FeedbackState, LoadingState, MetricCard, PageHeader],
  styles: [`
    .settlement td.missing { color: var(--warning); font-style: italic; }
    .settlement td.off { color: var(--muted); }
    .settlement th.day { min-width: 64px; text-align: right; }
    .settlement td.value { text-align: right; white-space: nowrap; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin-bottom: 16px; }
    .toolbar label { display: grid; gap: 4px; font-size: 13px; }
    .rates { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px 16px; }
    .rates label { display: grid; gap: 4px; font-size: 13px; }
  `],
  template: `<div [class.page]="!embedded()">
  @if (!embedded()) {
  <app-page-header title="Acerto da quinzena" subtitle="Soma dos valores diários de cada chapa no período (1 a 15 e 16 ao fim do mês), mais os ajustes lançados.">
    <div actions class="actions"><ion-button fill="outline" [disabled]="!data()" (click)="export()">Exportar acerto</ion-button><ion-button fill="outline" (click)="print()">Imprimir</ion-button></div>
  </app-page-header>
  } @else {
  <p class="muted">Soma dos valores de cada chapa na quinzena (1 a 15 e 16 ao fim do mês), mais os ajustes. É o resumo para conferir com o RH.</p>
  }
  @if (error()) { <div app-feedback tone="error">{{ error() }}</div> }
  @if (success()) { <div app-feedback tone="success">{{ success() }}</div> }
  <div class="toolbar">
    <ion-button fill="outline" (click)="shift(-1)" [disabled]="busy()">Quinzena anterior</ion-button>
    <label>Data dentro da quinzena<input type="date" [ngModel]="date()" (ngModelChange)="date.set($event); load()" /></label>
    <ion-button fill="outline" (click)="shift(1)" [disabled]="busy()">Próxima quinzena</ion-button>
    @if (embedded()) { <ion-button fill="outline" [disabled]="!data()" (click)="export()">Exportar acerto</ion-button> }
    <label>Origem<select [ngModel]="origin()" (ngModelChange)="origin.set($event); load()"><option value="operacional_registrado">Operação registrada</option><option value="demo_sintetico">Demonstração sintética</option></select></label>
  </div>
  @if (busy() && !data()) { <app-loading-state label="Somando boletins e ajustes…" /> }
  @if (data(); as s) {
    <h2>{{ s.period.label }}</h2>
    <div class="metric-grid">
      <app-metric-card label="Apurado nos boletins" [value]="money(s.totals.base)" hint="Parcelas dos boletins fechados" tone="brand" />
      <app-metric-card label="Ajustes" [value]="money(s.totals.adjustments)" hint="Lançamentos com motivo, fora do boletim" />
      <app-metric-card label="Total do acerto" [value]="money(s.totals.total)" hint="Apurado não é pago: o pagamento é do RH" />
      <app-metric-card label="Dias úteis sem dado" [value]="s.totals.days_without_data" [hint]="s.totals.draft_days + ' dia(s) com boletim em rascunho'" [tone]="s.totals.days_without_data ? 'warning' : 'default'" />
    </div>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Acerto por pessoa e dia">
      <table class="settlement"><thead><tr><th>Pessoa</th>@for (day of s.days; track day.date) { <th class="day" [title]="statusLabel(day.status)">{{ day.date.slice(8, 10) }}/{{ day.date.slice(5, 7) }}<small class="table-cell-secondary">{{ statusLabel(day.status) }}</small></th> }<th class="numeric">Diárias</th><th class="numeric">Boletins</th><th class="numeric">Ajustes</th><th class="numeric">Total</th></tr></thead>
        <tbody>@for (person of s.workers; track person.worker) { <tr>
          <th scope="row"><a [routerLink]="['/pessoas', person.worker]" [queryParams]="{ date_from: s.period.date_from, date_to: s.period.date_to, origin: s.origin }">{{ person.registration }} · {{ person.name }}</a></th>
          @for (day of s.days; track day.date) {
            @let value = person.days[day.date];
            @if (value) { <td class="value">{{ money(value.value) }}@if (value.fraction !== "1.0") { <small class="table-cell-secondary">meia</small> }</td> }
            @else if (day.status === "sem_dado" || day.status === "rascunho") { <td class="missing" title="Dia sem boletim fechado: sem dado, nunca R$ 0">sem dado</td> }
            @else { <td class="off">—</td> }
          }
          <td class="numeric">{{ person.equivalent_days }}</td><td class="numeric">{{ money(person.base_total) }}</td><td class="numeric">{{ money(person.adjustments_total) }}</td><td class="numeric"><strong>{{ money(person.total) }}</strong></td>
        </tr> } @empty { <tr><td [attr.colspan]="s.days.length + 5" class="muted">Nenhum boletim fechado ou ajuste nesta quinzena.</td></tr> }</tbody>
      </table>
    </div>
    @if (adjustments().length) {
      <section class="panel section"><h2>Ajustes da quinzena</h2>
        <div class="table-wrap" tabindex="0" role="region" aria-label="Ajustes individuais"><table><thead><tr><th>Dia</th><th>Pessoa</th><th>Tipo</th><th class="numeric">Valor</th><th>Motivo</th><th>Lançado por</th>@if (api.can("warehouse")) { <th><span class="sr-only">Ações</span></th> }</tr></thead>
          <tbody>@for (a of adjustments(); track a.id) { <tr><td>{{ a.reference_date }}</td><td>{{ a.registration }} · {{ a.name }}</td><td>{{ a.kind_label }}</td><td class="numeric">{{ money(a.amount) }}</td><td class="wrap">{{ a.reason }}</td><td>{{ a.created_by }}</td>
            @if (api.can("warehouse")) { <td><button type="button" class="remove" (click)="cancel(a)" [disabled]="busy()">Cancelar</button></td> }</tr> }</tbody></table></div>
        <p class="field-help">Ajustes não mudam produção, piso nem complemento do boletim. Para lançar, abra o boletim do dia.</p>
      </section>
    }
    <ul class="field-help">@for (note of s.notes; track note) { <li>{{ note }}</li> }</ul>
  }

  <section class="panel section">
    <h2>Tarifas e piso vigentes</h2>
    @if (tariffs(); as t) {
      <p class="muted">Em {{ t.date }}: piso de {{ money(t.current.floor_per_day) }} por diária · {{ t.current.valid_from ? "tabela vigente desde " + t.current.valid_from : "tabela padrão do regulamento" }}. Cada boletim usa a tabela vigente na sua data; um reajuste nunca muda um dia já fechado (corrigir exige reabrir o boletim com motivo).</p>
      <div class="table-wrap" tabindex="0" role="region" aria-label="Tarifas vigentes"><table><thead><tr><th>Tipo de item</th><th class="numeric">Tarifa por unidade</th></tr></thead><tbody>@for (rate of t.current.rates; track rate.code) { <tr><td>{{ rate.label }}</td><td class="numeric">R$ {{ rate.price }}</td></tr> }</tbody></table></div>
      @if (t.tables.length) {
        <details class="section"><summary>Histórico de reajustes ({{ t.tables.length }})</summary><ul>@for (table of t.tables; track table.id) { <li>Desde {{ table.valid_from }} · piso {{ money(table.floor_per_day) }} · aprovado por {{ table.approved_by }}{{ table.notes ? " · " + table.notes : "" }}</li> }</ul></details>
      }
      @if (api.can("management")) {
        <details class="section"><summary>Registrar reajuste aprovado</summary>
          <form (ngSubmit)="createTariff()" class="section">
            <div class="toolbar"><label>Vigente a partir de<input type="date" name="valid_from" [(ngModel)]="draft.valid_from" required /></label>
              <label>Piso por diária (R$)<input type="text" inputmode="decimal" name="floor" [(ngModel)]="draft.floor_per_day" required /></label>
              <label>Aprovação / observação<input type="text" name="notes" [(ngModel)]="draft.notes" /></label></div>
            <div class="rates">@for (rate of t.current.rates; track rate.code) { <label>{{ rate.label }}<input type="text" inputmode="decimal" [name]="'rate-' + rate.code" [(ngModel)]="draft.rates[rate.code]" required /></label> }</div>
            <div class="actions section"><ion-button type="submit" [disabled]="busy()">Registrar tabela</ion-button></div>
          </form>
        </details>
      }
    } @else { <app-loading-state label="Carregando tarifas…" /> }
  </section>
</div>`,
})
export class LaborPayroll implements OnInit {
  readonly api = inject(Api);
  embedded = input(false);
  date = signal(today());
  origin = signal("operacional_registrado");
  data = signal<Settlement | null>(null);
  tariffs = signal<Tariffs | null>(null);
  busy = signal(false);
  error = signal("");
  success = signal("");
  money = money;
  draft: { valid_from: string; floor_per_day: string; notes: string; rates: Record<string, string> } = { valid_from: today(), floor_per_day: "", notes: "", rates: {} };
  adjustments = computed(() => (this.data()?.workers ?? []).flatMap(worker => worker.adjustments).sort((a, b) => a.reference_date.localeCompare(b.reference_date)));
  async ngOnInit() { await Promise.all([this.load(), this.loadTariffs()]); }
  statusLabel(value: string) { return STATUS[value] ?? value; }
  shift(direction: number) {
    const current = this.data()?.period;
    const base = new Date(`${direction < 0 ? current?.date_from ?? this.date() : current?.date_to ?? this.date()}T12:00:00`);
    base.setDate(base.getDate() + direction);
    this.date.set(base.toISOString().slice(0, 10));
    void this.load();
  }
  async load() {
    this.busy.set(true);
    this.error.set("");
    try { this.data.set(await this.api.get<Settlement>(`settlements/fortnight/?${new URLSearchParams({ date: this.date(), origin: this.origin() })}`)); }
    catch (e) { this.error.set(apiError(e)); } finally { this.busy.set(false); }
  }
  async loadTariffs() {
    try {
      const result = await this.api.get<Tariffs>(`tariff-tables/?date=${today()}`);
      this.tariffs.set(result);
      this.draft = { valid_from: today(), floor_per_day: result.current.floor_per_day, notes: "", rates: Object.fromEntries(result.current.rates.map(rate => [rate.code, rate.price])) };
    } catch (e) { this.error.set(apiError(e)); }
  }
  async cancel(adjustment: Adjustment) {
    const reason = window.prompt(`Motivo do cancelamento do ajuste de ${adjustment.name}:`);
    if (!reason?.trim()) return;
    this.busy.set(true);
    try { await this.api.post(`labor-adjustments/${adjustment.id}/cancel/`, { reason }); this.success.set("Ajuste cancelado com motivo."); await this.load(); }
    catch (e) { this.error.set(apiError(e)); } finally { this.busy.set(false); }
  }
  async createTariff() {
    this.busy.set(true);
    this.error.set("");
    try {
      const rates = Object.fromEntries(Object.entries(this.draft.rates).map(([code, price]) => [code, String(price).replace(",", ".")]));
      await this.api.post("tariff-tables/", { ...this.draft, floor_per_day: this.draft.floor_per_day.replace(",", "."), rates });
      this.success.set("Reajuste registrado. Dias já fechados não mudam.");
      await this.loadTariffs();
    } catch (e) { this.error.set(apiError(e)); } finally { this.busy.set(false); }
  }
  export() {
    const s = this.data();
    if (!s) return;
    exportCsv(`acerto-${s.period.date_from}-${s.period.date_to}.csv`, [
      ["Matrícula", "Pessoa", ...s.days.map(day => day.date), "Diárias", "Apurado nos boletins", "Ajustes", "Total"],
      ...s.workers.map(person => [person.registration, person.name, ...s.days.map(day => person.days[day.date]?.value ?? (["sem_dado", "rascunho"].includes(day.status) ? "sem dado" : "")), person.equivalent_days, person.base_total, person.adjustments_total, person.total]),
    ]);
  }
  print() { window.print(); }
}
