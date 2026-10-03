import { Component, computed, inject, input, OnInit, output, signal } from "@angular/core";
import { NgTemplateOutlet } from "@angular/common";
import { RouterLink } from "@angular/router";
import { Api, apiError } from "../core/api";
import { openReceivingReport, ReceivingReportRow } from "./receiving-report";
import { Status } from "../shared/ui";

export interface ScheduleVisit {
  warehouse: string;
  warehouse_name: string;
}
export interface ScheduleItem {
  id: string;
  supplier: string;
  supplier_name: string;
  date: string;
  time: string;
  packaging: string;
  vehicle_plate: string;
  invoice?: string;
  invoice_number?: string;
  purchase_status: string;
  operation_status: string;
  capacity_reserved?: boolean;
  divergence_reported_at?: string | null;
  visits?: ScheduleVisit[];
  slot?: { date: string; time: string };
}
export interface ScheduleRange {
  from: string;
  to: string;
  origin: string;
}
type View = "day" | "week" | "month";
interface Column {
  id: string;
  name: string;
  code?: string;
  iso?: string;
  today?: boolean;
}

const SLOTS = [
  { time: "08:00", label: "08h" },
  { time: "10:00", label: "10h" },
  { time: "13:00", label: "13h" },
  { time: "15:00", label: "15h" },
];
const WEEKDAYS = 5;

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}
function iso(value: Date) {
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}
function parseIso(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}
function addDays(value: Date, amount: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + amount);
  return next;
}
function startOfWeek(value: Date) {
  const day = value.getDay();
  return addDays(value, day === 0 ? -6 : 1 - day);
}
function isWeekend(value: string) {
  const day = parseIso(value).getDay();
  return day === 0 || day === 6;
}
// Receiving happens Monday to Friday: on weekends "today" means the next Monday.
function nextReceivingDay(value = startOfDay(new Date())) {
  const day = value.getDay();
  return day === 6 ? addDays(value, 2) : day === 0 ? addDays(value, 1) : value;
}
function packaging(value: string) {
  return (
    (
      {
        batida: "Batida",
        paletizada: "Paletizada",
        big_bag: "Big bag",
        maquina_implemento: "Máquina ou implemento",
      } as Record<string, string>
    )[value] ?? value
  );
}
function weekdayLabel(day: Date) {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).format(day);
}

@Component({
  standalone: true,
  selector: "app-schedule-calendar",
  imports: [NgTemplateOutlet, RouterLink, Status],
  template: `
    <section class="cal" [attr.aria-busy]="busy()">
      <div class="cal-bar">
        <div class="cal-nav">
          <button type="button" class="icon-button" (click)="step(-1)" [attr.aria-label]="stepLabel(-1)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6 9 12l6 6" /></svg>
          </button>
          <button type="button" class="cal-today" (click)="goToday()">Hoje</button>
          <button type="button" class="icon-button" (click)="step(1)" [attr.aria-label]="stepLabel(1)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
          </button>
          <h2 class="cal-heading" aria-live="polite">{{ heading() }}</h2>
        </div>
        <div class="cal-views" role="tablist" aria-label="Período exibido">
          @for (item of views; track item.id) {
            <button
              type="button"
              role="tab"
              [class.is-active]="view() === item.id"
              [attr.aria-selected]="view() === item.id"
              (click)="setView(item.id)"
            >
              {{ item.label }}
            </button>
          }
        </div>
      </div>
      <div class="cal-bar">
        <div class="cal-chips" role="group" aria-label="Filtrar por situação">
          @for (chip of chips(); track chip.id) {
            <button
              type="button"
              class="cal-chip"
              [class.is-active]="status() === chip.id"
              [attr.aria-pressed]="status() === chip.id"
              (click)="status.set(chip.id)"
            >
              {{ chip.label }} <span class="cal-chip-count">{{ chipCount(chip.id) }}</span>
            </button>
          }
        </div>
        <div class="cal-side">
          @if (showDestinationFilter()) {
            <label class="cal-select">
              Destino
              <select [value]="moega()" (change)="setMoega($event)">
                <option value="">Todos os armazéns</option>
                @for (warehouse of warehouses(); track warehouse.id) {
                  <option [value]="warehouse.id">{{ warehouse.name }}</option>
                }
                <option value="unassigned">Sem destino definido</option>
              </select>
            </label>
          }
          @if (showOriginFilter()) {
            <label class="cal-select">
              Origem
              <select [value]="origin()" (change)="setOrigin($event)">
                <option value="">Todas</option>
                <option value="operacional_registrado">Operação registrada</option>
                <option value="demo_sintetico">Demonstração sintética</option>
              </select>
            </label>
          }
          @if (view() === "day" && printable().length) {
            <button type="button" class="cal-print" (click)="printDay()" [disabled]="printBusy()">
              {{ printBusy() ? "Preparando…" : "Imprimir o dia" }}
            </button>
          }
        </div>
      </div>
      <p class="cal-util">
        <strong>{{ utilization().used }} de {{ utilization().capacity }}</strong> vagas ocupadas {{ utilization().scope }}
      </p>
      @if (printError()) {
        <p class="cal-empty" role="alert">{{ printError() }}</p>
      }
      @if (busy() && !appointments().length) {
        <p class="cal-empty" role="status">Carregando os horários deste período…</p>
      } @else if (view() === "month") {
        <div class="cal-month" role="grid" aria-label="Calendário mensal">
          @for (name of weekNames; track name) {
            <div class="cal-weekday" role="columnheader">{{ name }}</div>
          }
          @for (day of monthDays(); track day.iso) {
            <button
              type="button"
              class="cal-day"
              role="gridcell"
              [class.is-outside]="!day.inMonth"
              [class.is-weekend]="day.weekend"
              [class.is-today]="day.today"
              [disabled]="day.weekend"
              [attr.aria-label]="day.label + (day.count ? ', ' + day.count + ' caminhões' : ', sem caminhões')"
              (click)="openDay(day.iso)"
            >
              <span class="cal-day-number">{{ day.number }}</span>
              @if (day.count) {
                <span class="cal-day-count">{{ day.count }} {{ day.count === 1 ? "caminhão" : "caminhões" }}</span>
              }
              @for (item of day.items; track item.id) {
                <span [class]="'cal-mini ' + tone(item)">{{ slotLabel(itemTime(item)) }} · {{ item.supplier_name }}</span>
              }
            </button>
          }
        </div>
      } @else if (view() === "day" && weekend(anchorIso())) {
        <div class="cal-empty-box">
          <p>Não há recebimento aos sábados e domingos.</p>
          <button type="button" class="cal-today" (click)="goToday()">Ver o próximo dia útil</button>
        </div>
      } @else {
        <div class="table-wrap cal-scroll" tabindex="0" role="region" [attr.aria-label]="view() === 'day' ? 'Agenda do dia' : 'Agenda da semana'">
          <table class="cal-table" [class.is-day]="view() === 'day'">
            <caption class="sr-only">{{ heading() }}</caption>
            <thead>
              <tr>
                <th scope="col"><span class="sr-only">Horário</span></th>
                @for (column of columns(); track column.id) {
                  <th scope="col" [class.is-today]="column.today">
                    <strong>{{ column.name }}</strong>
                    @if (column.code) {
                      <small>{{ column.code }}</small>
                    }
                  </th>
                }
              </tr>
            </thead>
            <tbody>
              @for (slot of slots; track slot.time) {
                <tr>
                  <th scope="row">
                    <strong>{{ slot.label }}</strong>
                    @if (!freeInCells()) {
                      <span class="cal-row-free">{{ freeText(anchorIso(), slot.time) }}</span>
                    }
                  </th>
                  @for (column of columns(); track column.id) {
                    <td [class.is-today]="column.today">
                      @for (item of cell(column, slot.time); track item.id) {
                        <ng-container *ngTemplateOutlet="card; context: { $implicit: item }" />
                      }
                      @if (freeInCells()) {
                        <ng-container *ngTemplateOutlet="free; context: { day: column.iso || anchorIso(), time: slot.time, empty: !cell(column, slot.time).length }" />
                      } @else if (!cell(column, slot.time).length) {
                        <span class="cal-dash" aria-label="Sem caminhão">—</span>
                      }
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="cal-list">
          @for (day of listDays(); track day.iso) {
            <section class="cal-list-day" [class.is-today]="day.today">
              <h3>{{ day.name }}</h3>
              @for (slot of slots; track slot.time) {
                <div class="cal-list-slot">
                  <span class="cal-list-time">{{ slot.label }}</span>
                  <div class="cal-list-items">
                    @for (item of dayItems(day.iso, slot.time); track item.id) {
                      <ng-container *ngTemplateOutlet="card; context: { $implicit: item }" />
                    }
                    <ng-container *ngTemplateOutlet="free; context: { day: day.iso, time: slot.time, empty: !dayItems(day.iso, slot.time).length }" />
                  </div>
                </div>
              }
            </section>
          }
        </div>
      }
      <ng-template #card let-item>
        <a [class]="'cal-card ' + tone(item)" [routerLink]="['/agenda', item.id]">
          <span class="cal-card-top">
            <app-status [value]="tone(item)" />
            @if (item.divergence_reported_at) {
              <span class="cal-flag">Divergência</span>
            }
          </span>
          <strong class="cal-card-title">{{ item.supplier_name }}</strong>
          <span class="cal-card-meta">{{ item.vehicle_plate || "Placa não informada" }} · {{ pack(item.packaging) }}</span>
          @if (view() === "day") {
            <span class="cal-card-meta">NF {{ item.invoice_number || "não informada" }}</span>
          }
        </a>
      </ng-template>
      <ng-template #free let-day="day" let-time="time" let-empty="empty">
        @if (freeUnits(day, time) > 0 && !past(day)) {
          @if (canSchedule()) {
            <a class="cal-free is-link" routerLink="/agenda/novo" [queryParams]="{ date: day, time: time }">
              + Agendar <small>{{ freeText(day, time) }}</small>
            </a>
          } @else {
            <span class="cal-free">{{ freeText(day, time) }}</span>
          }
        } @else if (empty) {
          <span class="cal-dash">{{ past(day) ? "—" : held(day, time) ? "Reservado pelo armazém" : "Lotado" }}</span>
        }
      </ng-template>
    </section>
  `,
  styles: [
    `
      :host { display: block; }
      .cal { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
      .cal > *, .cal-bar > * { min-width: 0; }
      .cal-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
      .cal-nav, .cal-chips, .cal-side { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
      .cal-heading { margin: 0 0 0 8px; font-size: 18px; }
      .cal-nav svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .cal-views { display: inline-flex; gap: 4px; padding: 4px; background: var(--surface-subtle); border-radius: var(--radius-full); }
      .cal-views button, .cal-chip, .cal-today, .cal-print {
        border: 1px solid transparent; background: transparent; color: var(--text); font: inherit; font-size: 14px; font-weight: 600;
        border-radius: var(--radius-full); min-height: 44px; padding: 8px 16px; cursor: pointer;
      }
      .cal-views button.is-active { background: var(--surface); box-shadow: 0 0 0 1px var(--line); color: var(--green); }
      .cal-today, .cal-print, .cal-chip { border-color: var(--control-line); background: var(--surface); }
      .cal-chip.is-active { background: var(--green); border-color: var(--green); color: var(--brand-contrast); }
      .cal-chip-count { opacity: 0.75; font-weight: 500; margin-left: 2px; }
      .cal-print:disabled { opacity: 0.6; cursor: not-allowed; }
      .cal-select { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; }
      .cal-select select { min-width: 180px; }
      .cal-util { margin: 0; color: var(--muted); font-size: 14px; }
      .cal-util strong { color: var(--text); }
      .cal-empty { margin: 0; color: var(--muted); font-size: 14px; }
      .cal-empty-box { display: grid; justify-items: start; gap: 12px; padding: 24px; border: 1px solid var(--line); border-radius: var(--radius-card); background: var(--surface); }
      .cal-empty-box p { margin: 0; }
      .cal-scroll { overflow: auto; }
      .cal-table { min-width: 720px; table-layout: fixed; }
      .cal-table th, .cal-table td { white-space: normal; vertical-align: top; padding: 10px; }
      .cal-table thead th:first-child, .cal-table th[scope="row"] { width: 92px; }
      .cal-table th[scope="row"] { background: var(--surface-subtle); }
      .cal-table th[scope="row"] strong { display: block; font-size: 15px; }
      .cal-row-free { display: block; margin-top: 4px; color: var(--muted); font-size: 12px; font-weight: 500; }
      .cal-table thead th { text-align: left; text-transform: capitalize; }
      .cal-table thead th strong, .cal-table thead th small { display: block; }
      .cal-table thead th small { font-weight: 500; color: var(--muted); margin-top: 2px; }
      .cal-table .is-today { background: var(--brand-soft); }
      .cal-card {
        display: grid; gap: 2px; margin-bottom: 6px; padding: 8px 10px; border-radius: var(--radius-control);
        border: 1px solid var(--line); border-left-width: 4px; background: var(--surface); color: var(--text); text-decoration: none;
      }
      .cal-card:hover { background: var(--surface-hover); }
      .cal-card-top { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 2px; }
      .cal-card-title { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cal-card-meta { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cal-card.waiting { border-left-color: var(--blue); }
      .cal-card.pending { border-left-color: var(--warning); }
      .cal-card.approved, .cal-card.completed { border-left-color: var(--success); }
      .cal-card.arrived, .cal-card.in_progress { border-left-color: var(--green); background: var(--info-soft); }
      .cal-card.rejected, .cal-card.cancelled, .cal-card.not_received { border-left-color: var(--danger); opacity: 0.75; }
      .cal-flag { border-radius: var(--radius-full); padding: 2px 8px; font-size: 11px; font-weight: 700; background: var(--danger-soft); color: var(--danger); }
      .cal-free { display: block; color: var(--muted); font-size: 12px; font-weight: 600; padding: 6px 2px; }
      .cal-free.is-link {
        color: var(--green); text-decoration: none; border: 1px dashed var(--control-line); border-radius: var(--radius-control);
        padding: 8px 10px; min-height: 44px; display: grid; align-content: center;
      }
      .cal-free.is-link:hover { background: var(--brand-soft); border-style: solid; }
      .cal-free small { color: var(--muted); font-weight: 500; }
      .cal-dash { display: block; color: var(--muted); font-size: 12px; padding: 6px 2px; }
      .cal-list { display: none; }
      .cal-month { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
      .cal-weekday { color: var(--muted); font-size: 12px; font-weight: 700; padding: 0 6px; }
      .cal-day {
        display: flex; flex-direction: column; align-items: stretch; gap: 4px; min-height: 104px; padding: 8px;
        border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface);
        color: var(--text); text-align: left; font: inherit; cursor: pointer;
      }
      .cal-day:hover:not(:disabled) { background: var(--surface-hover); }
      .cal-day:disabled { cursor: default; }
      .cal-day.is-outside { opacity: 0.5; }
      .cal-day.is-weekend { background: var(--surface-subtle); }
      .cal-day.is-today { box-shadow: inset 0 0 0 2px var(--green); }
      .cal-day-number { font-weight: 700; font-size: 13px; }
      .cal-day-count { font-size: 12px; font-weight: 700; color: var(--green); }
      .cal-mini { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-radius: var(--radius-full); padding: 2px 6px; font-size: 11px; font-weight: 600; background: var(--surface-subtle); }
      .cal-mini.cancelled, .cal-mini.not_received, .cal-mini.rejected { text-decoration: line-through; color: var(--muted); }
      @media (max-width: 767px) {
        .cal-heading { flex-basis: 100%; margin: 4px 0 0; font-size: 16px; }
        .cal-views { width: 100%; }
        .cal-views button { flex: 1; }
        .cal-chips { flex-wrap: nowrap; overflow-x: auto; width: 100%; padding-bottom: 4px; }
        .cal-chip { white-space: nowrap; }
        .cal-select { width: 100%; }
        .cal-select select { flex: 1; min-width: 0; }
        .cal-scroll { display: none; }
        .cal-list { display: grid; gap: 16px; }
        .cal-list-day { border: 1px solid var(--line); border-radius: var(--radius-card); background: var(--surface); padding: 12px; }
        .cal-list-day.is-today { border-color: var(--green); }
        .cal-list-day h3 { margin: 0 0 8px; font-size: 15px; text-transform: capitalize; }
        .cal-list-slot { display: grid; grid-template-columns: 44px 1fr; gap: 8px; padding: 8px 0; border-top: 1px solid var(--line); }
        .cal-list-time { font-weight: 700; padding-top: 6px; }
        .cal-day { min-height: 64px; padding: 4px; }
        .cal-mini { display: none; }
        .cal-day-count { font-size: 11px; }
      }
    `,
  ],
})
export class ScheduleCalendar implements OnInit {
  appointments = input<ScheduleItem[]>([]);
  warehouses = input<{ id: string; name: string; code?: string }[]>([]);
  mode = input<"agenda" | "compras">("agenda");
  busy = input(false);
  canSchedule = input(false);
  rangeChange = output<ScheduleRange>();
  view = signal<View>("week");
  anchor = signal(nextReceivingDay());
  status = signal("");
  moega = signal("");
  origin = signal("");
  private api = inject(Api);
  printBusy = signal(false);
  printError = signal("");
  // Server-side occupancy (includes holds and other suppliers' loads), keyed by "date|time".
  private capacity = signal(new Map<string, SlotCapacity>());
  private capacityRequest = 0;
  readonly views = [
    { id: "day" as const, label: "Dia" },
    { id: "week" as const, label: "Semana" },
    { id: "month" as const, label: "Mês" },
  ];
  readonly slots = SLOTS;
  readonly weekNames = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  readonly chips = computed(() =>
    this.mode() === "compras"
      ? [
          { id: "", label: "Todas" },
          { id: "pending", label: "A conferir" },
          { id: "approved", label: "Aprovadas" },
          { id: "rejected", label: "Rejeitadas" },
        ]
      : [
          { id: "", label: "Todos" },
          { id: "waiting", label: "Agendado" },
          { id: "arrived", label: "No pátio" },
          { id: "in_progress", label: "Em descarga" },
          { id: "completed", label: "Concluído" },
        ],
  );
  // Destination columns only matter to the warehouse; suppliers never see other loads.
  readonly showDestinationFilter = computed(() => this.api.can("warehouse") && this.warehouses().length > 0);
  readonly showOriginFilter = computed(() => this.api.user()?.role === "admin");
  readonly visible = computed(() =>
    this.appointments().filter((item) => this.matchesStatus(item) && this.matchesMoega(item)),
  );
  readonly printable = computed(() => {
    if (this.view() !== "day") return [];
    const day = iso(this.anchor());
    return this.appointments().filter((item) => this.itemDate(item) === day && this.canPrint(item));
  });
  readonly weekDays = computed(() => {
    const start = startOfWeek(this.anchor());
    const todayIso = iso(startOfDay(new Date()));
    return Array.from({ length: WEEKDAYS }, (_, index) => {
      const day = addDays(start, index);
      const dayIso = iso(day);
      return { iso: dayIso, name: weekdayLabel(day), today: dayIso === todayIso };
    });
  });
  readonly listDays = computed(() =>
    this.view() === "week"
      ? this.weekDays()
      : [{ iso: this.anchorIso(), name: weekdayLabel(this.anchor()), today: this.anchorIso() === iso(startOfDay(new Date())) }],
  );
  readonly columns = computed<Column[]>(() => {
    if (this.view() === "week") return this.weekDays().map((day) => ({ id: day.iso, ...day }));
    if (!this.api.can("warehouse")) return [{ id: "all", name: "Caminhões do dia" }];
    const selected = this.moega();
    if (selected === "unassigned") return [{ id: "unassigned", name: "Sem destino definido" }];
    if (selected) {
      const warehouse = this.warehouses().find((item) => item.id === selected);
      return [{ id: selected, name: warehouse?.name ?? "Armazém", code: warehouse?.code }];
    }
    const today = this.visible().filter((item) => this.itemDate(item) === this.anchorIso());
    // Only destinations with trucks today become columns, so the day view stays readable.
    const used = new Map<string, Column>();
    let unassigned = false;
    for (const item of today) {
      if (!item.visits?.length) unassigned = true;
      for (const visit of item.visits ?? []) {
        const known = this.warehouses().find((w) => w.id === visit.warehouse);
        used.set(visit.warehouse, { id: visit.warehouse, name: known?.name ?? visit.warehouse_name, code: known?.code });
      }
    }
    const columns = [...used.values()];
    if (!columns.length) return [{ id: "all", name: "Caminhões do dia" }];
    if (unassigned) columns.push({ id: "unassigned", name: "Sem destino definido" });
    return columns;
  });
  readonly freeInCells = computed(() => this.view() === "week" || this.columns().length === 1);
  readonly monthDays = computed(() => {
    const anchor = this.anchor();
    const start = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
    return Array.from({ length: 42 }, (_, index) => {
      const day = addDays(start, index);
      const dayIso = iso(day);
      const items = this.visible().filter((item) => this.itemDate(item) === dayIso);
      return {
        iso: dayIso,
        number: day.getDate(),
        inMonth: day.getMonth() === anchor.getMonth(),
        weekend: isWeekend(dayIso),
        today: dayIso === iso(startOfDay(new Date())),
        items: items.slice(0, 2),
        count: items.length,
        label: new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" }).format(day),
      };
    });
  });
  readonly utilization = computed(() => {
    const dates = this.capacityDates();
    const capacity = dates.length * SLOTS.length * 2;
    const used = dates.reduce(
      (sum, day) => sum + SLOTS.reduce((daySum, slot) => daySum + Math.min(2, this.used(day, slot.time)), 0),
      0,
    );
    return {
      scope: this.view() === "day" ? "no dia" : this.view() === "week" ? "na semana" : "no mês",
      used,
      capacity,
    };
  });
  readonly heading = computed(() => {
    const anchor = this.anchor();
    if (this.view() === "day") return capitalize(new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" }).format(anchor));
    if (this.view() === "month") return capitalize(new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(anchor));
    const start = startOfWeek(anchor);
    const end = addDays(start, WEEKDAYS - 1);
    const format = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
    return `${format.format(start)} a ${format.format(end)}/${end.getFullYear()}`;
  });
  ngOnInit() {
    if (this.mode() === "compras") this.status.set("pending");
    this.publish();
  }
  setView(view: View) {
    this.view.set(view);
    this.publish();
  }
  step(direction: number) {
    const anchor = this.anchor();
    if (this.view() === "month") {
      this.anchor.set(new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1));
    } else if (this.view() === "week") {
      this.anchor.set(addDays(startOfWeek(anchor), direction * 7));
    } else {
      // Day view skips weekends: Friday → Monday and back.
      let next = addDays(anchor, direction);
      while (isWeekend(iso(next))) next = addDays(next, direction);
      this.anchor.set(next);
    }
    this.publish();
  }
  goToday() {
    this.anchor.set(nextReceivingDay());
    this.publish();
  }
  async printDay() {
    const preview = window.open("", "_blank");
    const items = [...this.printable()].sort(
      (a, b) => this.itemTime(a).localeCompare(this.itemTime(b)) || a.supplier_name.localeCompare(b.supplier_name, "pt-BR"),
    );
    if (!items.length) {
      preview?.close();
      return;
    }
    this.printBusy.set(true);
    this.printError.set("");
    try {
      const ids = [...new Set(items.map((item) => item.invoice).filter((id): id is string => Boolean(id)))];
      const invoices = new Map<string, InvoicePayload>();
      await Promise.all(
        ids.map(async (id) => {
          invoices.set(id, await this.api.get<InvoicePayload>(`invoices/${id}/`));
        }),
      );
      const rows: ReceivingReportRow[] = [];
      for (const item of items) {
        const invoice = item.invoice ? invoices.get(item.invoice) : undefined;
        const products = invoice?.items ?? [];
        const total = invoiceTotal(products);
        const value = total == null ? "Não informado" : money(total);
        const date = formatDay(this.itemDate(item));
        const number = item.invoice_number || invoice?.number || "Não informada";
        if (!products.length) {
          rows.push({
            supplier: item.supplier_name,
            product: "Não informado na nota",
            quantity: "Não informada",
            invoice: number,
            value,
            date,
          });
          continue;
        }
        for (const product of products) {
          rows.push({
            supplier: item.supplier_name,
            product: product.description || "Não informado",
            quantity: formatQuantity(product.quantity, product.unit),
            invoice: number,
            value,
            date,
          });
        }
      }
      await openReceivingReport(rows, formatDay(iso(this.anchor())), preview);
    } catch (error) {
      preview?.close();
      this.printError.set(apiError(error));
    } finally {
      this.printBusy.set(false);
    }
  }
  openDay(day: string) {
    this.anchor.set(parseIso(day));
    this.view.set("day");
    this.publish();
  }
  setMoega(event: Event) {
    this.moega.set((event.target as HTMLSelectElement).value);
  }
  setOrigin(event: Event) {
    this.origin.set((event.target as HTMLSelectElement).value);
    this.publish();
  }
  stepLabel(direction: number) {
    const target = this.view() === "month" ? "mês" : this.view() === "week" ? "semana" : "dia útil";
    return direction < 0 ? `Anterior (${target})` : `Próximo (${target})`;
  }
  chipCount(id: string) {
    const items = this.appointments().filter((item) => this.matchesMoega(item) && this.inRange(item));
    return id ? items.filter((item) => this.statusOf(item) === id).length : items.length;
  }
  cell(column: Column, time: string) {
    const day = column.iso || this.anchorIso();
    return this.visible().filter((item) => this.itemDate(item) === day && this.itemTime(item) === time && this.inColumn(item, column.id));
  }
  dayItems(day: string, time: string) {
    return this.visible().filter((item) => this.itemDate(item) === day && this.itemTime(item) === time);
  }
  freeUnits(day: string, time: string) {
    if (isWeekend(day)) return 0;
    const server = this.capacity().get(`${day}|${time}`);
    if (server) return server.calendar_open ? server.available_units : 0;
    return Math.max(0, 2 - this.used(day, time));
  }
  freeText(day: string, time: string) {
    if (this.past(day)) return "";
    const free = this.freeUnits(day, time);
    return free === 0 ? "Lotado" : free === 1 ? "1 vaga livre" : `${free} vagas livres`;
  }
  held(day: string, time: string) {
    return (this.capacity().get(`${day}|${time}`)?.held_units ?? 0) > 0;
  }
  past(day: string) {
    return day < iso(startOfDay(new Date()));
  }
  weekend = isWeekend;
  slotLabel(time: string) {
    return SLOTS.find((slot) => slot.time === time)?.label ?? time;
  }
  tone(item: ScheduleItem) {
    if (this.mode() === "compras") return item.purchase_status || "pending";
    if (item.purchase_status === "rejected") return "rejected";
    if (item.operation_status === "unloading") return "in_progress";
    return item.operation_status || "waiting";
  }
  pack = packaging;
  itemTime(item: ScheduleItem) {
    return (item.time || item.slot?.time || "").slice(0, 5);
  }
  private publish() {
    const [from, to] = this.bounds();
    this.rangeChange.emit({ from, to, origin: this.origin() });
    void this.loadCapacity(from, to);
  }
  private async loadCapacity(from: string, to: string) {
    const request = ++this.capacityRequest;
    try {
      const result = await this.api.get<AvailabilityRange>(
        `slots/availability/?${new URLSearchParams({ date_from: from, date_to: to })}`,
      );
      if (request !== this.capacityRequest) return;
      const map = new Map<string, SlotCapacity>();
      for (const day of result.days)
        for (const slot of day.slots)
          map.set(`${day.date}|${slot.time}`, { ...slot, calendar_open: day.calendar_open });
      this.capacity.set(map);
    } catch {
      // Without server occupancy the calendar falls back to the appointments it can see.
      if (request === this.capacityRequest) this.capacity.set(new Map());
    }
  }
  private bounds(): [string, string] {
    const anchor = this.anchor();
    if (this.view() === "day") {
      const day = iso(anchor);
      return [day, day];
    }
    if (this.view() === "week") {
      const start = startOfWeek(anchor);
      return [iso(start), iso(addDays(start, 6))];
    }
    const start = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
    return [iso(start), iso(addDays(start, 41))];
  }
  private inRange(item: ScheduleItem) {
    const day = this.itemDate(item);
    if (this.view() === "day") return day === this.anchorIso();
    if (this.view() === "week") return this.weekDays().some((d) => d.iso === day);
    const anchor = this.anchor();
    const date = parseIso(day);
    return date.getMonth() === anchor.getMonth() && date.getFullYear() === anchor.getFullYear();
  }
  private capacityDates() {
    if (this.view() === "day") return isWeekend(this.anchorIso()) ? [] : [this.anchorIso()];
    if (this.view() === "week") return this.weekDays().map((day) => day.iso);
    const anchor = this.anchor();
    const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
    return Array.from({ length: last }, (_, index) => iso(new Date(anchor.getFullYear(), anchor.getMonth(), index + 1))).filter(
      (day) => !isWeekend(day),
    );
  }
  private canPrint(item: ScheduleItem) {
    if (item.purchase_status === "rejected") return false;
    return !["cancelled", "not_received"].includes(item.operation_status);
  }
  private statusOf(item: ScheduleItem) {
    if (this.mode() === "compras") return item.purchase_status;
    return item.operation_status === "unloading" ? "in_progress" : item.operation_status;
  }
  private matchesStatus(item: ScheduleItem) {
    const selected = this.status();
    return !selected || this.statusOf(item) === selected;
  }
  private matchesMoega(item: ScheduleItem) {
    const selected = this.moega();
    if (!selected) return true;
    if (selected === "unassigned") return !item.visits?.length;
    return (item.visits ?? []).some((visit) => visit.warehouse === selected);
  }
  private inColumn(item: ScheduleItem, columnId: string) {
    if (this.view() === "week" || columnId === "all") return true;
    if (columnId === "unassigned") return !item.visits?.length;
    return (item.visits ?? []).some((visit) => visit.warehouse === columnId);
  }
  private occupies(item: ScheduleItem) {
    if (item.capacity_reserved === false) return false;
    if (item.purchase_status === "rejected") return false;
    return !["cancelled", "not_received"].includes(item.operation_status);
  }
  private used(day: string, time: string) {
    const server = this.capacity().get(`${day}|${time}`);
    if (server) return server.occupied_units;
    return this.appointments()
      .filter((item) => this.occupies(item) && this.itemDate(item) === day && this.itemTime(item) === time)
      .reduce((sum, item) => sum + (item.packaging === "batida" ? 2 : 1), 0);
  }
  private itemDate(item: ScheduleItem) {
    return item.date || item.slot?.date || "";
  }
  anchorIso() {
    return iso(this.anchor());
  }
}
function capitalize(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
interface SlotCapacity {
  time: string;
  occupied_units: number;
  held_units: number;
  available_units: number;
  calendar_open: boolean;
}
interface AvailabilityRange {
  days: { date: string; calendar_open: boolean; slots: Omit<SlotCapacity, "calendar_open">[] }[];
}
interface InvoicePayload {
  number: string;
  items: { description: string; quantity: string | null; unit: string; unit_value: string | null }[];
}
function formatDay(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}
function formatQuantity(quantity: string | null, unit: string) {
  if (quantity == null || quantity === "") return "Não informada";
  const number = Number(quantity);
  const text = Number.isFinite(number)
    ? new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(number)
    : quantity;
  return unit ? `${text} ${unit}` : text;
}
function invoiceTotal(items: InvoicePayload["items"]) {
  let total = 0;
  let found = false;
  for (const item of items) {
    if (item.quantity == null || item.unit_value == null || item.quantity === "" || item.unit_value === "") continue;
    const quantity = Number(item.quantity);
    const unitValue = Number(item.unit_value);
    if (!Number.isFinite(quantity) || !Number.isFinite(unitValue)) continue;
    total += quantity * unitValue;
    found = true;
  }
  return found ? total : null;
}
function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}
