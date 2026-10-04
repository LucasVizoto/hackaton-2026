import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { IonButton } from "@ionic/angular/standalone";
import { Api, apiError, today } from "../core/api";
import { Catalog } from "../core/catalog";
import { EmptyState, FeedbackState, LoadingState, PageHeader } from "../shared/ui";

export interface RosterEntry { id: string; worker: string; registration: string; name: string; contract_type: string; date: string; warehouse: string | null; warehouse_name: string | null; period: string; activity: string; attendance: string; fraction: string; notes: string; }
interface RosterSlot { time: string; chapas: number; gas_forklifts: number; after_hours: boolean; warnings: string[]; }
export interface RosterDay {
  date: string; day_type: string; holiday: string | null; entries: RosterEntry[]; scheduled_equivalents: string; present_equivalents: string; absences: number;
  plan: { peak_chapas: number; peak_gas_forklifts: number; loads: number; person_hours: string; after_hours_loads: number; forklift_conflicts: number };
  slots: RosterSlot[]; season_target: { min: number; max: number; season: string }; balance: { status: string; message: string };
  bulletin: { id: string; status: string; equivalent_days: string | null } | null;
}
interface RosterWeek { period: { date_from: string; date_to: string }; origin: string; days: RosterDay[]; workers: { id: string; registration: string; name: string; contract_type: string }[]; rules: string[]; }

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const BALANCE_LABEL: Record<string, string> = { shortage: "Falta", attention: "Atenção", watch: "Acompanhar", ok: "Coberto", info: "Sábado", closed: "Sem expediente" };

function monday(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
function addDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

@Component({
  selector: "app-staff-roster",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, IonButton, EmptyState, FeedbackState, LoadingState, PageHeader],
  styles: [`
    .roster th, .roster td { vertical-align: top; }
    .roster td.cell { min-width: 112px; }
    .roster select { width: 100%; min-width: 96px; }
    .roster .day-head { min-width: 150px; white-space: normal; }
    .roster .day-head small { display: block; color: var(--muted); font-weight: 400; line-height: 1.4; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; background: var(--surface-subtle); color: var(--muted); }
    .badge.shortage { background: var(--danger-soft); color: var(--danger); }
    .badge.attention, .badge.watch { background: var(--warning-soft); color: var(--warning); }
    .badge.ok { background: var(--info-soft); color: var(--blue); }
    .cell.absent select:first-child { text-decoration: line-through; }
    .cell.present { background: var(--info-soft); }
    .slot-warn { color: var(--warning); display: block; font-size: 12px; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin-bottom: 16px; }
    .toolbar label { display: grid; gap: 4px; font-size: 13px; }
    .muted-row td { color: var(--muted); }
  `],
  template: `<div class="page">
  <app-page-header title="Escala dos chapas" subtitle="Quem trabalha em cada dia, comparado ao que a agenda exige ao mesmo tempo. O pagamento continua sendo o boletim do dia." />
  @if (error()) { <div app-feedback tone="error">{{ error() }}</div> }
  @if (success()) { <div app-feedback tone="success">{{ success() }}</div> }
  <div class="toolbar" role="group" aria-label="Semana da escala">
    <ion-button fill="outline" (click)="move(-7)" [disabled]="busy()">Semana anterior</ion-button>
    <label>Semana de<input type="date" [ngModel]="weekStart()" (ngModelChange)="pick($event)" /></label>
    <ion-button fill="outline" (click)="move(7)" [disabled]="busy()">Próxima semana</ion-button>
    <label>Origem<select [ngModel]="origin()" (ngModelChange)="origin.set($event); load()">
      <option value="operacional_registrado">Operação registrada</option><option value="demo_sintetico">Demonstração sintética</option></select></label>
    @if (canEdit()) {
      <label>Armazém de referência para novas escalas<select [ngModel]="warehouse()" (ngModelChange)="warehouse.set($event)">
        <option value="">Sem armazém fixo</option>@for (w of catalog.warehouses(); track w.id) { <option [value]="w.id">{{ w.name }}</option> }</select></label>
      <ion-button fill="outline" (click)="copyPrevious()" [disabled]="busy()">Repetir semana anterior</ion-button>
    }
    <label class="check"><input type="checkbox" [ngModel]="onlyScheduled()" (ngModelChange)="onlyScheduled.set($event)" />Só quem está escalado</label>
  </div>
  @if (origin() === "demo_sintetico") { <p class="notice synthetic">Dados de demonstração: nunca se misturam com a operação real.</p> }
  @if (busy() && !week()) { <app-loading-state label="Carregando escala e agenda da semana…" /> }
  @if (week(); as w) {
    <div class="table-wrap" tabindex="0" role="region" aria-label="Escala por pessoa e dia">
      <table class="roster">
        <thead><tr><th>Pessoa</th>
          @for (day of w.days; track day.date) {
            <th class="day-head">{{ label(day.date) }}
              <span class="badge" [class]="'badge ' + day.balance.status">{{ balanceLabel(day.balance.status) }}</span>
              @if (day.day_type === "workday") {
                <small>Agenda: pico de {{ day.plan.peak_chapas }} chapas · {{ day.plan.peak_gas_forklifts }} empilh. · {{ day.plan.loads }} cargas</small>
              }
              <small>Escalados: {{ day.scheduled_equivalents }} diárias · alvo {{ day.season_target.min }}{{ day.season_target.max !== day.season_target.min ? "–" + day.season_target.max : "" }}</small>
              @if (day.absences) { <small>{{ day.absences }} falta(s)</small> }
              @if (day.plan.after_hours_loads) { <small class="slot-warn">Carga pode passar do expediente</small> }
              @if (day.plan.forklift_conflicts) { <small class="slot-warn">Conflito de empilhadeira</small> }
              @if (day.bulletin; as b) { <small><a [routerLink]="['/boletins', b.id]">Boletim {{ b.status === "CLOSED" ? "fechado" : "em rascunho" }}</a></small> }
              @else if (canEdit() && day.entries.length && day.day_type !== "sunday") { <small><a routerLink="/boletins/novo" [queryParams]="{ data: day.date, escala: 1, origem: origin() }">Criar boletim pela escala</a></small> }
            </th>
          }
        </tr></thead>
        <tbody>
          @for (person of rows(); track person.id) {
            <tr>
              <th scope="row">{{ person.registration }} · {{ person.name }}@if (person.contract_type === "TERCEIRIZADO") { <small class="table-cell-secondary">Terceirizado</small> }</th>
              @for (day of w.days; track day.date) {
                @let entry = cell(person.id, day.date);
                <td class="cell" [class.present]="entry?.attendance === 'PRESENT'" [class.absent]="entry?.attendance === 'ABSENT'">
                  @if (day.day_type === "sunday" || day.day_type === "holiday") { <span class="muted">—</span> }
                  @else if (canEdit()) {
                    <select [ngModel]="entry?.period ?? ''" (ngModelChange)="setPeriod(person.id, day.date, $event)" [disabled]="busy()" [attr.aria-label]="'Escala de ' + person.name + ' em ' + label(day.date)">
                      <option value="">Folga</option><option value="FULL">Integral</option><option value="MORNING">Manhã (½)</option><option value="AFTERNOON">Tarde (½)</option></select>
                    @if (entry) {
                      <select [ngModel]="entry.attendance" (ngModelChange)="setAttendance(entry, $event)" [disabled]="busy()" [attr.aria-label]="'Presença de ' + person.name + ' em ' + label(day.date)">
                        <option value="PLANNED">Escalado</option><option value="PRESENT">Presente</option><option value="ABSENT">Falta</option></select>
                    }
                  } @else if (entry) { {{ periodLabel(entry.period) }} · {{ attendanceLabel(entry.attendance) }} } @else { <span class="muted">Folga</span> }
                </td>
              }
            </tr>
          } @empty { <tr class="muted-row"><td [attr.colspan]="w.days.length + 1">Nenhuma pessoa {{ onlyScheduled() ? "escalada nesta semana" : "ativa cadastrada" }}.</td></tr> }
        </tbody>
      </table>
    </div>
    <section class="panel section">
      <h2>Necessidade da agenda por horário</h2>
      <p class="muted">Pessoas e empilhadeiras a gás exigidas ao mesmo tempo pelas descargas agendadas, pelas normas do PRD (ou pelos tempos reais, quando há amostra). O limite vale para a cooperativa inteira.</p>
      <div class="table-wrap" tabindex="0" role="region" aria-label="Necessidade por horário">
        <table><thead><tr><th>Horário</th>@for (day of w.days; track day.date) { <th>{{ label(day.date) }}</th> }</tr></thead>
          <tbody>@for (time of times; track time) { <tr><th scope="row">{{ time }}</th>
            @for (day of w.days; track day.date) { @let slot = slotOf(day, time); <td>
              @if (slot && slot.chapas) { {{ slot.chapas }} chapas · {{ slot.gas_forklifts }} empilh.
                @for (warning of slot.warnings; track warning) { <span class="slot-warn">{{ warning }}</span> } } @else { <span class="muted">—</span> }
            </td> }
          </tr> }</tbody></table>
      </div>
      <ul class="field-help">@for (rule of w.rules; track rule) { <li>{{ rule }}</li> }</ul>
      <p class="field-help">A agenda mostra só caminhões de fornecedor; o carregamento ao cooperado usa a mesma equipe. Por isso a escala sinaliza falta, mas sobra só se conclui pelo complemento do boletim (painel de Gestão).</p>
    </section>
    @if (!w.workers.length) { <div app-empty-state>Cadastre chapas em Pessoas para montar a escala.</div> }
  }
</div>`,
})
export class StaffRoster implements OnInit {
  readonly api = inject(Api);
  readonly catalog = inject(Catalog);
  readonly times = ["08:00", "10:00", "13:00", "15:00"];
  weekStart = signal(monday(today()));
  origin = signal("operacional_registrado");
  warehouse = signal("");
  onlyScheduled = signal(false);
  week = signal<RosterWeek | null>(null);
  busy = signal(false);
  error = signal("");
  success = signal("");
  canEdit = computed(() => this.api.can("warehouse"));
  private index = computed(() => {
    const map = new Map<string, RosterEntry>();
    for (const day of this.week()?.days ?? []) for (const entry of day.entries) map.set(`${entry.worker}|${entry.date}`, entry);
    return map;
  });
  rows = computed(() => {
    const week = this.week();
    if (!week) return [];
    const scheduled = new Set(week.days.flatMap(day => day.entries.map(entry => entry.worker)));
    const known = new Map(week.workers.map(worker => [worker.id, worker]));
    for (const day of week.days) for (const entry of day.entries) if (!known.has(entry.worker)) known.set(entry.worker, { id: entry.worker, registration: entry.registration, name: entry.name, contract_type: entry.contract_type });
    return [...known.values()].filter(worker => !this.onlyScheduled() || scheduled.has(worker.id)).sort((a, b) => a.registration.localeCompare(b.registration));
  });
  async ngOnInit() {
    await this.catalog.load().catch(e => this.error.set(apiError(e)));
    await this.load();
  }
  label(date: string) { const d = new Date(`${date}T12:00:00`); return `${WEEKDAYS[(d.getDay() + 6) % 7]} ${date.slice(8, 10)}/${date.slice(5, 7)}`; }
  balanceLabel(status: string) { return BALANCE_LABEL[status] ?? status; }
  periodLabel(value: string) { return ({ FULL: "Integral", MORNING: "Manhã", AFTERNOON: "Tarde" } as Record<string, string>)[value] ?? value; }
  attendanceLabel(value: string) { return ({ PLANNED: "Escalado", PRESENT: "Presente", ABSENT: "Falta" } as Record<string, string>)[value] ?? value; }
  cell(worker: string, date: string) { return this.index().get(`${worker}|${date}`); }
  slotOf(day: RosterDay, time: string) { return day.slots.find(slot => slot.time === time); }
  pick(value: string) { if (value) { this.weekStart.set(monday(value)); void this.load(); } }
  move(days: number) { this.weekStart.set(addDays(this.weekStart(), days)); void this.load(); }
  async load() {
    this.busy.set(true);
    this.error.set("");
    try {
      const query = new URLSearchParams({ date_from: this.weekStart(), date_to: addDays(this.weekStart(), 5), origin: this.origin() });
      this.week.set(await this.api.get<RosterWeek>(`roster/?${query}`));
    } catch (e) { this.error.set(apiError(e)); } finally { this.busy.set(false); }
  }
  private async run(action: () => Promise<unknown>, message: string) {
    this.busy.set(true);
    this.error.set("");
    this.success.set("");
    try { await action(); this.success.set(message); } catch (e) { this.error.set(apiError(e)); } finally { this.busy.set(false); }
    await this.load();
  }
  async setPeriod(worker: string, date: string, period: string) {
    const entry = this.cell(worker, date);
    if (!period) { if (entry) await this.run(() => this.api.delete(`roster/${entry.id}/`), "Folga registrada."); return; }
    await this.run(() => this.api.post("roster/", { worker, date, origin: this.origin(), period, warehouse: entry?.warehouse ?? (this.warehouse() || null) }), "Escala atualizada.");
  }
  async setAttendance(entry: RosterEntry, attendance: string) {
    await this.run(() => this.api.patch(`roster/${entry.id}/`, { attendance }), attendance === "ABSENT" ? "Falta registrada." : "Presença atualizada.");
  }
  async copyPrevious() {
    await this.run(async () => {
      const result = await this.api.post<{ created: number; skipped: number }>("roster/copy-week/", { source_week_start: addDays(this.weekStart(), -7), target_week_start: this.weekStart(), origin: this.origin() });
      if (!result.created) throw new Error("Nada a copiar: a semana anterior está vazia ou já foi repetida.");
    }, "Semana anterior repetida, sem sobrescrever o que já estava escalado.");
  }
}
