import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { Api, apiError, money } from "../core/api";
import { chartDateLabel } from "../core/chart-data";
import { FeedbackState, LoadingState } from "../shared/ui";

interface BalanceDay { date: string; day_type: string; status: string; required_peak: number; loads: number; scheduled: string | null; paid_equivalents: string | null; total_payable: string | null; supplement: string | null; below_floor: boolean; production_per_equivalent_day: string | null; avg_wait_minutes: number | null; after_hours_unloads: number; planned_after_hours: number; }
interface Balance {
  period: { date_from: string; date_to: string }; origin: string; synthetic: boolean;
  indicators: { supplement_total: string | null; total_payable: string | null; days_with_bulletin: number; days_without_data: number; days_below_floor: number; days_below_floor_share: string | null; production_per_equivalent_day: string | null; floor_per_day: string; avg_paid_equivalents: string | null; avg_required_peak: string | null; avg_wait_minutes: number | null; after_hours_unloads: number };
  signal: { status: string; message: string };
  warehouse_costs: { warehouse: string | null; warehouse_name: string; total_payable: string; supplement: string; production: string }[];
  days: BalanceDay[]; limits: string[];
}
export interface BalanceFilters { date_from: string; date_to: string; origin: string; }
type Verdict = "falta" | "sobra" | "equilibrio";
interface Weekday { label: string; plural: string; days: number; required: number; paid: number; wait: number | null; supplement: number; afterHours: number; verdict: Verdict; }
interface Bar { date: string; x: number; height: number; y: number; paidY: number; verdict: Verdict; day: BalanceDay; }

const WEEKDAYS = [["segunda", "segundas"], ["terça", "terças"], ["quarta", "quartas"], ["quinta", "quintas"], ["sexta", "sextas"]];
// Mesmo limite de espera longa usado pelo sinal do servidor (analytics/staffing.py).
const LONG_WAIT = 60;
const VERDICT: Record<Verdict, string> = { falta: "Falta", sobra: "Sobra", equilibrio: "Equilíbrio" };
const CHART = { width: 800, height: 240, top: 16, bottom: 34, left: 36, right: 8 };

function dayVerdict(day: BalanceDay): Verdict {
  const paid = Number(day.paid_equivalents ?? 0);
  if (day.required_peak > paid || (day.avg_wait_minutes ?? 0) >= LONG_WAIT || day.after_hours_unloads > 0) return "falta";
  return day.below_floor ? "sobra" : "equilibrio";
}
function list(names: string[]) { return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`; }
const number = (value: number, digits = 1) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(value);

@Component({
  selector: "app-staffing-balance",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FeedbackState, LoadingState],
  styles: [`
    :host { display: block; }
    .answer { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card); padding: 28px; border-left: 6px solid var(--blue); }
    .answer.sobra { border-left-color: var(--blue); } .answer.falta, .answer.misto { border-left-color: var(--danger); }
    .eyebrow { margin: 0 0 6px; font: 600 13px/1.4 var(--font-body); color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
    .verdict { margin: 0 0 10px; font: 700 34px/1.15 var(--font-heading); letter-spacing: -.03em; }
    .verdict .accent-sobra { color: var(--blue); } .verdict .accent-falta { color: var(--danger); }
    .lead { max-width: 75ch; margin: 0; font-size: 17px; }
    .numbers { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin: 24px 0 0; padding: 0; list-style: none; }
    .numbers li { border-top: 1px solid var(--line); padding-top: 14px; }
    .numbers strong { display: block; font: 700 28px/1.2 var(--font-heading); letter-spacing: -.025em; font-variant-numeric: tabular-nums; }
    .numbers span { display: block; font-size: 13px; color: var(--muted); }
    .numbers .label { color: var(--text); font-weight: 600; margin-bottom: 2px; }
    .week { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin: 16px 0 0; padding: 0; list-style: none; }
    .week li { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card); padding: 16px; border-top: 4px solid var(--line); }
    .week li.falta { border-top-color: var(--danger); } .week li.sobra { border-top-color: var(--blue); } .week li.equilibrio { border-top-color: var(--success); }
    .week h3 { margin: 0 0 8px; font-size: 16px; text-transform: capitalize; }
    .chip { display: inline-block; padding: 3px 10px; border-radius: var(--radius-full); font: 600 13px/1.4 var(--font-body); margin-bottom: 10px; }
    .chip.falta { background: var(--danger-soft); color: var(--danger); } .chip.sobra { background: var(--info-soft); color: var(--blue); } .chip.equilibrio { background: var(--success-soft); color: var(--success); }
    .week dl { margin: 0; display: grid; gap: 4px; font-size: 13px; }
    .week dl div { display: flex; justify-content: space-between; gap: 8px; } .week dt { color: var(--muted); } .week dd { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; }
    .action { margin: 16px 0 0; padding: 16px 18px; border-radius: var(--radius-control); background: var(--info-soft); color: var(--text); max-width: none; }
    .action strong { color: var(--blue); }
    .chart { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card); padding: 24px; }
    .chart h2 { font-size: 20px; margin-bottom: 4px; }
    .legend { display: flex; flex-wrap: wrap; gap: 8px 20px; list-style: none; padding: 0; margin: 14px 0 4px; font-size: 13px; }
    .legend li { display: flex; align-items: center; gap: 8px; }
    .swatch { width: 14px; height: 14px; border-radius: 3px; } .swatch.falta { background: var(--danger); } .swatch.sobra { background: var(--blue); } .swatch.equilibrio { background: var(--success); }
    .swatch.paid { height: 0; width: 22px; border-top: 3px solid var(--text); border-radius: 0; }
    .scroll { overflow-x: auto; } svg { display: block; width: 100%; min-width: 560px; }
    svg text { font-size: 12px; fill: var(--muted); font-family: var(--font-body); }
    .grid { stroke: var(--line); } .bar.falta { fill: var(--danger); } .bar.sobra { fill: var(--blue); } .bar.equilibrio { fill: var(--success); }
    .paid { stroke: var(--text); stroke-width: 3; stroke-linecap: round; }
    td.missing { color: var(--warning); font-style: italic; } tr.weekend td { color: var(--muted); }
    @media (max-width: 900px) { .numbers { grid-template-columns: repeat(2, minmax(0, 1fr)); } .week { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); } }
    @media (max-width: 600px) { .week { grid-template-columns: 1fr; } .answer { padding: 20px; } .verdict { font-size: 27px; } .numbers strong { font-size: 23px; } }
  `],
  template: `<section aria-labelledby="balance-title">
  @if (error()) { <div app-feedback tone="error">{{ error() }}</div> }
  @if (busy() && !data()) { <app-loading-state label="Cruzando agenda, escala e boletins…" /> }
  @if (data(); as b) {
    <article class="answer" [class]="'answer ' + tone()">
      <p class="eyebrow" id="balance-title">Sobra ou falta chapa?</p>
      @if (b.indicators.days_with_bulletin) {
        <h2 class="verdict">
          @if (mixed()) { <span class="accent-sobra">Sobra no total</span>, <span class="accent-falta">falta nos picos</span> }
          @else if (b.signal.status === "sobra") { <span class="accent-sobra">Sobra chapa</span> }
          @else if (b.signal.status === "falta") { <span class="accent-falta">Falta chapa</span> }
          @else if (b.signal.status === "atencao") { Equipe no limite }
          @else { Equipe em equilíbrio }
        </h2>
        <p class="lead">{{ lead() }}</p>
        <ul class="numbers">
          <li><span class="label">Complemento pago</span><strong>{{ money(b.indicators.supplement_total) }}</strong><span>Piso pago sem produção · {{ percent(b.indicators.days_below_floor_share) }} dos dias</span></li>
          <li><span class="label">Chapas pagos × necessários</span><strong>{{ decimal(b.indicators.avg_paid_equivalents) }} × {{ decimal(b.indicators.avg_required_peak) }}</strong><span>Média por dia × pico da agenda</span></li>
          <li><span class="label">Espera do caminhão</span><strong>{{ b.indicators.avg_wait_minutes === null ? "—" : b.indicators.avg_wait_minutes + " min" }}</strong><span>Chegada até o início da descarga</span></li>
          <li><span class="label">Descargas após 17h</span><strong>{{ b.indicators.after_hours_unloads }}</strong><span>Sinal de equipe curta no pico</span></li>
        </ul>
      } @else {
        <h2 class="verdict">Sem base para responder</h2>
        <p class="lead">Não há boletins fechados nesta origem e período. Escolha outro período ou a origem “Demonstração sintética”.</p>
      }
    </article>

    @if (weekdays().length) {
      <section class="section" aria-labelledby="week-title">
        <h2 id="week-title">Onde está a sobra e onde está a falta</h2>
        <p class="muted">Média por dia da semana no período. Falta: pico acima da equipe paga, espera de {{ longWait }} min ou mais ou descarga após 17h. Sobra: complemento em metade dos dias ou mais.</p>
        <ul class="week">
          @for (w of weekdays(); track w.label) {
            <li [class]="w.verdict"><h3>{{ w.label }}</h3><span class="chip" [class]="'chip ' + w.verdict">{{ verdictLabel(w.verdict) }}</span>
              <dl>
                <div><dt>Pico exigido</dt><dd>{{ num(w.required) }}</dd></div>
                <div><dt>Chapas pagos</dt><dd>{{ num(w.paid) }}</dd></div>
                <div><dt>Espera</dt><dd>{{ w.wait === null ? "—" : num(w.wait, 0) + " min" }}</dd></div>
                <div><dt>Complemento</dt><dd>{{ money(w.supplement) }}</dd></div>
              </dl>
            </li>
          }
        </ul>
        @if (recommendation(); as text) { <p class="action"><strong>O que fazer: </strong>{{ text }}</p> }
      </section>

      <section class="chart section" aria-labelledby="daily-title">
        <h2 id="daily-title">Necessidade × equipe paga, dia a dia</h2>
        <p class="field-help">Barra: pico de chapas exigido pela agenda. Traço: chapas pagos no boletim. A cor mostra o diagnóstico do dia.</p>
        <ul class="legend" aria-label="Legenda"><li><span class="swatch falta"></span>Falta</li><li><span class="swatch sobra"></span>Sobra (complemento)</li><li><span class="swatch equilibrio"></span>Equilíbrio</li><li><span class="swatch paid"></span>Chapas pagos</li></ul>
        <div class="scroll" tabindex="0" role="region" aria-label="Gráfico diário; role horizontalmente em telas estreitas">
          <svg [attr.viewBox]="'0 0 ' + chart.width + ' ' + chart.height" role="img" aria-labelledby="daily-svg-title">
            <title id="daily-svg-title">Pico exigido e chapas pagos por dia útil com boletim fechado</title>
            @for (tick of drawing().ticks; track tick.value) {
              <line [attr.x1]="chart.left" [attr.x2]="chart.width - chart.right" [attr.y1]="tick.y" [attr.y2]="tick.y" class="grid" />
              <text [attr.x]="chart.left - 8" [attr.y]="tick.y + 4" text-anchor="end">{{ tick.value }}</text>
            }
            @for (bar of drawing().bars; track bar.date) {
              <rect [attr.x]="bar.x" [attr.y]="bar.y" [attr.width]="drawing().barWidth" [attr.height]="bar.height" rx="3" [class]="'bar ' + bar.verdict"><title>{{ date(bar.date) }} · pico {{ bar.day.required_peak }} · pagos {{ bar.day.paid_equivalents }} · espera {{ bar.day.avg_wait_minutes ?? "—" }} min · complemento {{ money(bar.day.supplement) }}</title></rect>
              <line [attr.x1]="bar.x - 3" [attr.x2]="bar.x + drawing().barWidth + 3" [attr.y1]="bar.paidY" [attr.y2]="bar.paidY" class="paid" />
              @if ($first || $index % drawing().labelEvery === 0) { <text [attr.x]="bar.x + drawing().barWidth / 2" [attr.y]="chart.height - 12" text-anchor="middle">{{ date(bar.date) }}</text> }
            }
          </svg>
        </div>
      </section>
    }

    @if (b.warehouse_costs.length) {
      <section class="section panel" aria-labelledby="warehouse-cost-title">
        <h2 id="warehouse-cost-title">Custo da mão de obra por armazém</h2>
        <div class="table-wrap" tabindex="0" role="region" aria-labelledby="warehouse-cost-title"><table><thead><tr><th>Armazém</th><th class="numeric">Produção</th><th class="numeric">Complemento</th><th class="numeric">Custo</th></tr></thead>
          <tbody>@for (row of b.warehouse_costs; track row.warehouse_name) { <tr><td>{{ row.warehouse_name }}</td><td class="numeric">{{ money(row.production) }}</td><td class="numeric">{{ money(row.supplement) }}</td><td class="numeric"><strong>{{ money(row.total_payable) }}</strong></td></tr> }</tbody></table></div>
        <p class="field-help">O boletim é um por dia; o custo é dividido pela participação de cada armazém na produção. Mão de obra sem encargos e sem equipamentos.</p>
      </section>
    }

    <details class="section"><summary>Dia a dia em tabela e limites da análise</summary>
      <div class="table-wrap" tabindex="0" role="region" aria-label="Sobra ou falta por dia"><table><thead><tr><th>Dia</th><th class="numeric">Pico exigido</th><th class="numeric">Escalados</th><th class="numeric">Pagos (diárias)</th><th class="numeric">Produção/diária</th><th class="numeric">Complemento</th><th class="numeric">Espera</th><th class="numeric">Após expediente</th></tr></thead>
        <tbody>@for (day of b.days; track day.date) { <tr [class.weekend]="day.day_type !== 'workday'">
          <td>{{ date(day.date) }}</td><td class="numeric">{{ day.required_peak }}</td><td class="numeric">{{ day.scheduled ?? "—" }}</td>
          @if (day.status === "fechado") { <td class="numeric">{{ day.paid_equivalents }}</td><td class="numeric">{{ money(day.production_per_equivalent_day) }}</td><td class="numeric">{{ money(day.supplement) }}</td> }
          @else { <td class="missing" colspan="3">{{ day.status === "rascunho" ? "boletim em rascunho" : "sem dado" }}</td> }
          <td class="numeric">{{ day.avg_wait_minutes === null ? "—" : day.avg_wait_minutes + " min" }}</td><td class="numeric">{{ day.after_hours_unloads }}</td>
        </tr> }</tbody></table></div>
      <p class="field-help">Sinal do servidor: {{ b.signal.message }} Produção por diária no período: {{ money(b.indicators.production_per_equivalent_day) }} (piso {{ money(b.indicators.floor_per_day) }}). Dias úteis sem boletim: {{ b.indicators.days_without_data }}.</p>
      <ul class="field-help">@for (limit of b.limits; track limit) { <li>{{ limit }}</li> }</ul>
      <p class="field-help"><a routerLink="/escala">Abrir a escala</a> · <a routerLink="/boletins" [queryParams]="{ visao: 'quinzena' }">Acerto da quinzena</a></p>
    </details>
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
  date = chartDateLabel;
  num = number;
  chart = CHART;
  longWait = LONG_WAIT;
  private generation = 0;
  private closedWorkdays = computed(() => (this.data()?.days ?? []).filter(day => day.status === "fechado" && day.day_type === "workday"));
  weekdays = computed<Weekday[]>(() => {
    const groups = new Map<number, BalanceDay[]>();
    for (const day of this.closedWorkdays()) {
      const index = new Date(`${day.date}T12:00:00`).getDay() - 1;
      if (index >= 0 && index < 5) groups.set(index, [...(groups.get(index) ?? []), day]);
    }
    return [...groups.entries()].sort(([a], [b]) => a - b).map(([index, days]) => {
      const avg = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
      const waits = days.flatMap(day => day.avg_wait_minutes === null ? [] : [day.avg_wait_minutes]);
      const required = avg(days.map(day => day.required_peak));
      const paid = avg(days.map(day => Number(day.paid_equivalents ?? 0)));
      const wait = waits.length ? avg(waits) : null;
      const afterHours = days.reduce((sum, day) => sum + day.after_hours_unloads, 0);
      const below = days.filter(day => day.below_floor).length;
      const verdict: Verdict = required > paid || (wait ?? 0) >= LONG_WAIT || afterHours / days.length >= 0.5 ? "falta"
        : below / days.length >= 0.5 ? "sobra" : "equilibrio";
      return { label: WEEKDAYS[index][0], plural: WEEKDAYS[index][1], days: days.length, required, paid, wait,
        supplement: days.reduce((sum, day) => sum + Number(day.supplement ?? 0), 0), afterHours, verdict };
    });
  });
  private named = (verdict: Verdict) => this.weekdays().filter(w => w.verdict === verdict);
  mixed = computed(() => this.data()?.signal.status === "sobra" && this.named("falta").length > 0);
  tone = computed(() => this.mixed() ? "misto" : this.data()?.signal.status ?? "");
  lead = computed(() => {
    const b = this.data();
    if (!b) return "";
    const sobra = this.named("sobra"), falta = this.named("falta");
    const parts: string[] = [];
    if (sobra.length) parts.push(`Às ${list(sobra.map(w => w.plural))}, a equipe paga fica acima do que a agenda pede e o piso vira complemento.`);
    if (falta.length) parts.push(`Às ${list(falta.map(w => w.plural))}, a agenda concentra caminhões: o pico passa da equipe, o caminhão espera e a descarga invade o fim do expediente.`);
    if (!parts.length) parts.push(b.signal.message);
    return parts.join(" ");
  });
  recommendation = computed(() => {
    const sobra = this.named("sobra"), falta = this.named("falta");
    if (!sobra.length || !falta.length) return "";
    const slack = sobra.reduce((sum, w) => sum + (w.paid - w.required), 0) / sobra.length;
    const cost = sobra.reduce((sum, w) => sum + w.supplement, 0);
    const peak = Math.max(...falta.map(w => w.required));
    return `antes de contratar, redistribua a agenda. Nos dias de sobra há em média ${number(slack)} chapas acima do pico, `
      + `e o complemento somou ${money(cost)} no período. Mover cargas batidas das ${list(falta.map(w => w.plural))} `
      + `para as ${list(sobra.map(w => w.plural))} reduz o pico (hoje ${number(peak)} chapas) e a espera, com a mesma equipe.`;
  });
  drawing = computed(() => {
    const days = this.closedWorkdays();
    const { width, height, top, bottom, left, right } = CHART;
    const max = Math.max(4, ...days.map(day => Math.max(day.required_peak, Number(day.paid_equivalents ?? 0))));
    const scaleMax = Math.ceil(max / 4) * 4;
    const plot = height - top - bottom;
    const y = (value: number) => top + plot - value / scaleMax * plot;
    const step = days.length ? (width - left - right) / days.length : 0;
    const barWidth = Math.max(4, Math.min(28, step * 0.62));
    const bars: Bar[] = days.map((day, index) => ({
      date: day.date, day, verdict: dayVerdict(day),
      x: left + index * step + (step - barWidth) / 2,
      y: y(day.required_peak), height: top + plot - y(day.required_peak),
      paidY: y(Number(day.paid_equivalents ?? 0)),
    }));
    const ticks = Array.from({ length: 5 }, (_, i) => ({ value: scaleMax / 4 * i, y: y(scaleMax / 4 * i) }));
    return { bars, ticks, barWidth, labelEvery: Math.max(1, Math.ceil(days.length / 10)) };
  });
  constructor() {
    effect(() => { const filters = this.filters(); if (filters) void this.load(filters); });
  }
  verdictLabel(value: Verdict) { return VERDICT[value]; }
  decimal(value: string | null) { return value === null ? "—" : number(Number(value)); }
  percent(value: string | null) { return value === null ? "—" : new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 0 }).format(Number(value)); }
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
