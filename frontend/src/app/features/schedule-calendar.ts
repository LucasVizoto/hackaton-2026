import { Capacitor } from "@capacitor/core";
import { Component, computed, ElementRef, inject, input, OnInit, output, signal, viewChild } from "@angular/core";
import { NgTemplateOutlet } from "@angular/common";
import { RouterLink } from "@angular/router";
import { Api, apiError, originLabel } from "../core/api";
import { openReceivingReport, ReceivingReportRow } from "./receiving-report";
import { exportCsv } from "../core/workflow";
import { LoadingState } from "../shared/ui";

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
  invoices?: { id:string; number:string }[];
  origin?:string;
  purchase_status: string;
  operation_status: string;
  capacity_reserved?: boolean;
  divergence_reported_at?: string | null;
  visits?: ScheduleVisit[];
  slot?: { date: string; time: string };
}
export interface GateArrivalItem {
  id: string;
  vehicle_plate: string;
  tractor_plate: string;
  driver_name: string;
  invoice_number: string;
  created_at: string;
  decision: "pending" | "occurrence" | "authorized" | "rejected";
  appointment?: string | null;
}
export interface ScheduleRange {
  from: string;
  to: string;
  origin: string;
}
interface CalendarAvailability {date:string;calendar_open:boolean;global_capacity:number;slots:{time:string;occupied_units:number;held_units:number;available_units:number;eligible:boolean}[];}
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
    ({ batida: "Batida", paletizada: "Paletizada", big_bag: "Big bag", machine_implement: "Máquina / implemento" } as Record<string, string>)[value] ??
    value
  );
}
function weekdayLabel(day: Date) {
  return capitalize(new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).format(day));
}
const STATUS_LABELS: Record<string, string> = {
  pending: "Pendente", approved: "Aprovada", rejected: "Rejeitada", waiting: "Agendado", arrived: "No pátio",
  in_progress: "Em descarga", completed: "Concluído", cancelled: "Cancelado", not_received: "Não recebido",
};

@Component({
  standalone: true,
  selector: "app-schedule-calendar",
  imports: [NgTemplateOutlet, RouterLink, LoadingState],
  host: { "(document:click)": "closeMenu($event)", "(document:keydown.escape)": "closeMenu()" },
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
        </div>
        <h2 class="cal-heading" aria-live="polite">{{ heading() }}</h2>
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
        <div class="cal-side">
          @if(view()==='day'){<button type="button" class="cal-print" (click)="printDay()" [disabled]="busy() || printBusy() || !printable().length">{{printBusy()?'Preparando…':'Imprimir dia'}}</button>}
          <details class="cal-more" #more>
            <summary class="icon-button" aria-label="Mais ações" title="Mais ações">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
            </summary>
            <div class="cal-menu">
              @if(view()==='day'){<button type="button" class="cal-menu-print" (click)="printDay(); more.open = false" [disabled]="busy() || printBusy() || !printable().length">Imprimir dia</button>}
              <button type="button" (click)="refresh(); more.open = false" [disabled]="busy() || availabilityBusy()">Atualizar agenda</button>
              <button type="button" (click)="export(); more.open = false" [disabled]="busy() || !visible().length">Exportar planilha (CSV)</button>
            </div>
          </details>
        </div>
      </div>
      <div class="cal-util">
        <span>Ocupação<span class="cal-util-scope"> {{ utilization().scope }}</span></span>
        <div class="bar-track" aria-hidden="true"><span [style.width.%]="utilization().percent > 100 ? 100 : utilization().percent"></span></div>
        @if (availabilityBusy()) {
          <strong>Consultando…</strong>
        } @else if (utilization().known) {
          <strong>{{ utilization().percent }}%</strong><span>{{ utilization().used }} de {{ utilization().capacity }} vagas</span>
        } @else {
          <strong>Não disponível</strong>
        }
      </div>
      <div class="cal-filters">
        <div class="cal-chips" role="group" [attr.aria-label]="mode() === 'compras' ? 'Filtrar por compras' : 'Filtrar por operação'">
          @for (chip of chips(); track chip.id) {
            <button type="button" class="cal-chip" [class.is-active]="status() === chip.id" [attr.aria-pressed]="status()===chip.id" (click)="status.set(chip.id)">
              @if (chip.id) {<span [class]="'cal-dot ' + chip.id" aria-hidden="true"></span>}{{ chip.label }} ({{chipCount(chip.id)}})
            </button>
          }
        </div>
        @if (showDestinationFilter() || showOriginFilter()) {
          <button type="button" class="cal-chip cal-filter-toggle" [class.is-set]="activeFilters()" [attr.aria-expanded]="filtersOpen()" aria-controls="cal-selects" (click)="filtersOpen.set(!filtersOpen())">
            Filtros{{ activeFilters() ? " (" + activeFilters() + ")" : "" }}
          </button>
          <div class="cal-selects" id="cal-selects" [class.is-open]="filtersOpen()">
            @if(showDestinationFilter()){<label class="cal-select">
              Armazém
              <select [value]="moega()" (change)="setMoega($event)">
                <option value="">Todos os armazéns</option>
                @for (warehouse of warehouses(); track warehouse.id) {
                  <option [value]="warehouse.id">{{ warehouse.name }}</option>
                }
                <option value="unassigned">A definir</option>
              </select>
            </label>}
            @if(showOriginFilter()){<label class="cal-select">
              Origem
              <select [value]="origin()" (change)="setOrigin($event)">
                <option value="">Todas as origens</option>
                <option value="operacional_registrado">Operação registrada</option>
                <option value="demo_sintetico">Demonstração sintética</option>
              </select>
            </label>}
          </div>
        }
      </div>
      @if(availabilityError()){<p class="error" role="alert">Não foi possível consultar as vagas: {{availabilityError()}}</p>}
      @if (printError()) {
        <p class="error" role="alert">{{ printError() }}</p>
      }
      @if (visibleArrivals().length) {
        <section class="cal-arrivals" aria-labelledby="cal-arrivals-title">
          <h3 id="cal-arrivals-title">Chegadas na portaria sem agendamento ({{ visibleArrivals().length }})</h3>
          <p>A portaria registrou estes caminhões, mas eles ainda não estão vinculados a uma reserva da agenda.</p>
          <ul>
            @for (arrival of visibleArrivals(); track arrival.id) {
              <li>
                <span [class]="'cal-dot ' + arrivalTone(arrival)" aria-hidden="true"></span>
                <strong>{{ arrivalWhen(arrival) }}</strong>
                <span>{{ arrival.vehicle_plate }}@if (arrival.tractor_plate !== arrival.vehicle_plate) { · cavalo {{ arrival.tractor_plate }}}</span>
                <span>{{ arrival.driver_name }}</span>
                <span>NF {{ arrival.invoice_number }}</span>
                <span class="cal-arrival-decision">{{ arrivalDecision(arrival) }}</span>
              </li>
            }
          </ul>
        </section>
      }
      @if (!busy() && emptyMessage()) {
        <p class="cal-empty" role="status">{{ emptyMessage() }}</p>
      }
      @if (busy() && !appointments().length) {
        <app-loading-state label="Carregando agenda…" />
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
              [class.is-today]="day.today"
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
        <div class="table-wrap cal-scroll" tabindex="0" role="region" [attr.aria-label]="view() === 'day' ? 'Agenda do dia por armazém' : 'Agenda da semana'">
          <table class="cal-table">
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
                      @for(item of cell(column,slot.time);track item.id){<ng-container *ngTemplateOutlet="card; context: {$implicit:item}" />}
                      @if(freeInCells()){<ng-container *ngTemplateOutlet="free; context: {day:column.iso || anchorIso(),time:slot.time,empty:!cell(column,slot.time).length}" />}
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
            <span class="cal-card-status"><span [class]="'cal-dot ' + tone(item)" aria-hidden="true"></span>{{ statusLabel(tone(item)) }}</span>
            @if (item.divergence_reported_at) {
              <span class="cal-flag">Divergência</span>
            }
            @if (item.origin === "demo_sintetico") {
              <span class="cal-flag is-demo" title="Demonstração sintética">Demo</span>
            }
          </span>
          <strong class="cal-card-title">{{ item.supplier_name }}</strong>
          <span class="cal-card-meta">{{ item.vehicle_plate || "Placa não informada" }} · {{ pack(item.packaging) }}</span>
          @if (view() === "day") {
            <span class="cal-card-meta">NF {{ invoiceNumbers(item) }}</span>
          }
        </a>
      </ng-template>
      <ng-template #free let-day="day" let-time="time" let-empty="empty">
        @if (freeUnits(day, time) > 0 && !past(day)) {
          @if (canSchedule()) {
            <a class="cal-free is-link" routerLink="/agenda/novo" [queryParams]="{ date: day, time: time }">
              + Agendar <small>· {{ vacancies(freeUnits(day, time)) }}</small>
            </a>
          } @else {
            <span class="cal-free">{{ freeText(day, time) }}</span>
          }
        } @else if (empty) {
          <span class="cal-dash">{{past(day) ? "—" : availabilityLabel(day,time)}}</span>
        }
      </ng-template>
    </section>
  `,
  styles: [
    `
      :host { display: block; }
      .cal { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
      .cal > *, .cal-bar > * { min-width: 0; }

      /* Toolbar: navigation, period heading, view switch, actions. */
      .cal-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
      .cal-nav, .cal-chips, .cal-side { display: flex; align-items: center; gap: 4px; }
      .cal-heading { flex: 1 1 auto; margin: 0 0 0 4px; font-size: 18px; }
      .cal-nav svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .cal-views { display: inline-flex; gap: 4px; padding: 4px; background: var(--surface-subtle); border-radius: var(--radius-full); }
      .cal-views button, .cal-chip, .cal-today, .cal-print {
        border: 1px solid transparent; background: transparent; color: var(--text); font: inherit; font-size: 14px; font-weight: 600;
        border-radius: var(--radius-full); min-height: 44px; padding: 8px 16px; cursor: pointer;
      }
      .cal-views button.is-active { background: var(--surface); box-shadow: 0 0 0 1px var(--line); color: var(--green); }
      .cal-today, .cal-print, .cal-chip { border-color: var(--control-line); background: var(--surface); }
      .cal-print:disabled { opacity: 0.6; cursor: not-allowed; }
      .cal-more { position: relative; border: 0; padding: 0; margin: 0; }
      .cal-more > summary { list-style: none; padding: 0; color: var(--muted); }
      .cal-more > summary::-webkit-details-marker { display: none; }
      .cal-more svg { width: 20px; height: 20px; fill: currentColor; }
      .cal-menu {
        position: absolute; right: 0; top: calc(100% + 4px); z-index: 10; display: grid; min-width: 230px; padding: 6px;
        background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-control); box-shadow: var(--shadow-overlay);
      }
      .cal-menu button {
        min-height: 44px; padding: 8px 12px; border: 0; border-radius: var(--radius-control); background: transparent;
        color: var(--text); font: inherit; font-size: 14px; font-weight: 600; text-align: left; cursor: pointer;
      }
      .cal-menu button:hover:not(:disabled) { background: var(--surface-hover); }
      .cal-menu button:disabled { opacity: 0.5; cursor: not-allowed; }
      .cal-menu-print { display: none; }

      /* Occupancy: one compact line. */
      .cal-util { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 14px; }
      .cal-util .bar-track { flex: 0 1 200px; min-width: 60px; }
      .cal-util strong { color: var(--text); }

      /* Filters: the status chips double as the color legend. */
      .cal-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
      .cal-chips { flex-wrap: wrap; gap: 8px; }
      .cal-chip.is-active { background: var(--green); border-color: var(--green); color: var(--brand-contrast); }
      .cal-filter-toggle { display: none; }
      .cal-selects { display: flex; flex-wrap: wrap; gap: 8px 16px; }
      .cal-select { flex-direction: row; align-items: center; gap: 8px; }
      .cal-select select { min-width: 180px; }
      .cal-dot { display: inline-block; flex-shrink: 0; width: 8px; height: 8px; margin-right: 6px; border-radius: var(--radius-full); background: var(--muted); box-shadow: 0 0 0 2px var(--surface); vertical-align: 1px; }
      .cal-dot.arrived, .cal-dot.in_progress { background: var(--blue); }
      .cal-dot.completed, .cal-dot.approved { background: var(--success); }
      .cal-dot.pending { background: var(--warning); }
      .cal-dot.rejected, .cal-dot.cancelled, .cal-dot.not_received { background: var(--danger); }

      .cal-arrivals { margin: 0 0 16px; padding: 12px 16px; border: 1px solid var(--line); border-left: 4px solid var(--warning); border-radius: var(--radius-card); background: var(--surface); }
      .cal-arrivals h3 { margin: 0 0 4px; font-size: 15px; }
      .cal-arrivals p { margin: 0 0 8px; color: var(--muted); font-size: 13px; }
      .cal-arrivals ul { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
      .cal-arrivals li { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; font-size: 14px; }
      .cal-arrival-decision { color: var(--muted); }
      .cal-empty { margin: 0; color: var(--muted); font-size: 14px; }
      .cal-empty-box { display: grid; justify-items: start; gap: 12px; padding: 24px; border: 1px solid var(--line); border-radius: var(--radius-card); background: var(--surface); }
      .cal-empty-box p { margin: 0; }

      /* Week and day grid. */
      .cal-scroll { overflow: auto; }
      .cal-table { min-width: 720px; table-layout: fixed; }
      .cal-table th, .cal-table td { white-space: normal; vertical-align: top; padding: 8px; }
      .cal-table thead th:first-child, .cal-table th[scope="row"] { width: 84px; }
      .cal-table th[scope="row"] { background: var(--surface-subtle); }
      .cal-table th[scope="row"] strong { display: block; font-size: 15px; }
      .cal-row-free { display: block; margin-top: 4px; color: var(--muted); font-size: 12px; font-weight: 500; }
      .cal-table thead th { text-align: left; }
      .cal-table thead th strong, .cal-table thead th small { display: block; }
      .cal-table thead th small { font-weight: 500; color: var(--muted); margin-top: 2px; }
      .cal-table .is-today { background: var(--brand-soft); }

      /* Appointment card: status line, supplier, plate. The left border repeats the status color. */
      .cal-card {
        display: grid; gap: 2px; margin-bottom: 6px; padding: 8px 10px; border-radius: var(--radius-control);
        border: 1px solid var(--line); border-left-width: 4px; background: var(--surface); color: var(--text); text-decoration: none;
      }
      .cal-card:hover { background: var(--surface-hover); }
      .cal-card-top { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; }
      .cal-card-status { display: inline-flex; align-items: center; font-size: 12px; font-weight: 600; color: var(--muted); }
      .cal-card-title { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cal-card-meta { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cal-card.waiting { border-left-color: var(--muted); }
      .cal-card.pending { border-left-color: var(--warning); }
      .cal-card.approved, .cal-card.completed { border-left-color: var(--success); }
      .cal-card.arrived, .cal-card.in_progress { border-left-color: var(--blue); background: var(--info-soft); }
      .cal-card.rejected, .cal-card.cancelled, .cal-card.not_received { border-left-color: var(--danger); opacity: 0.7; }
      .cal-card.rejected .cal-card-title, .cal-card.cancelled .cal-card-title, .cal-card.not_received .cal-card-title { text-decoration: line-through; }
      .cal-flag { border-radius: var(--radius-full); padding: 1px 7px; font-size: 11px; font-weight: 700; background: var(--danger-soft); color: var(--danger); }
      .cal-flag.is-demo { background: var(--warning-soft); color: var(--warning); }

      /* Free slots. */
      .cal-free { display: block; color: var(--muted); font-size: 12px; font-weight: 500; padding: 6px 2px; }
      .cal-free.is-link {
        display: flex; align-items: center; gap: 4px; min-height: 44px; padding: 6px 10px; color: var(--green); font-size: 13px; font-weight: 600;
        text-decoration: none; border: 1px dashed var(--line); border-radius: var(--radius-control);
      }
      .cal-free.is-link:hover, .cal-free.is-link:focus-visible { background: var(--brand-soft); border: 1px solid var(--green); }
      .cal-free small { color: var(--muted); font-size: 12px; font-weight: 500; }
      .cal-dash { display: block; color: var(--muted); font-size: 12px; padding: 6px 2px; }

      /* Month: Monday to Friday only. */
      .cal-list { display: none; }
      .cal-month { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; }
      .cal-weekday { color: var(--muted); font-size: 12px; font-weight: 700; padding: 0 6px; }
      .cal-day {
        display: flex; flex-direction: column; align-items: stretch; gap: 4px; min-height: 104px; padding: 8px;
        border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface);
        color: var(--text); text-align: left; font: inherit; cursor: pointer;
      }
      .cal-day:hover { background: var(--surface-hover); }
      .cal-day.is-outside { opacity: 0.5; }
      .cal-day.is-today { box-shadow: inset 0 0 0 2px var(--green); }
      .cal-day-number { font-weight: 700; font-size: 13px; }
      .cal-day-count { font-size: 12px; font-weight: 700; color: var(--green); }
      .cal-mini {
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-radius: 6px; padding: 2px 6px; font-size: 11px; font-weight: 600;
        background: var(--surface-subtle); border-left: 3px solid var(--muted);
      }
      .cal-mini.arrived, .cal-mini.in_progress { border-left-color: var(--blue); }
      .cal-mini.completed, .cal-mini.approved { border-left-color: var(--success); }
      .cal-mini.pending { border-left-color: var(--warning); }
      .cal-mini.cancelled, .cal-mini.not_received, .cal-mini.rejected { border-left-color: var(--danger); text-decoration: line-through; color: var(--muted); }

      @media (max-width: 767px) {
        .cal { gap: 10px; }
        .cal-bar { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "nav side" "heading heading" "views views"; gap: 8px; }
        .cal-nav { grid-area: nav; }
        .cal-side { grid-area: side; }
        .cal-heading { grid-area: heading; margin: 0; font-size: 16px; }
        .cal-views { grid-area: views; width: 100%; }
        .cal-views button { flex: 1; }
        .cal-side .cal-print { display: none; }
        .cal-menu-print { display: block; }
        .cal-util { font-size: 13px; }
        .cal-util-scope { display: none; }
        .cal-util .bar-track { flex: 1 1 auto; }
        .cal-filters { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
        .cal-chips { flex-wrap: nowrap; overflow-x: auto; padding-bottom: 4px; }
        .cal-chip { white-space: nowrap; }
        .cal-filter-toggle { display: inline-block; align-self: start; }
        .cal-filter-toggle.is-set { border-color: var(--green); color: var(--green); }
        .cal-selects { display: none; grid-column: 1 / -1; }
        .cal-selects.is-open { display: grid; gap: 8px; }
        .cal-select { justify-content: space-between; }
        .cal-select select { flex: 1; min-width: 0; max-width: 240px; }
        .cal-scroll { display: none; }
        .cal-list { display: grid; gap: 16px; }
        .cal-list-day { border: 1px solid var(--line); border-radius: var(--radius-card); background: var(--surface); padding: 12px; }
        .cal-list-day.is-today { border-color: var(--green); }
        .cal-list-day h3 { margin: 0 0 8px; font-size: 15px; }
        .cal-list-slot { display: grid; grid-template-columns: 44px 1fr; gap: 8px; padding: 8px 0; border-top: 1px solid var(--line); }
        .cal-list-time { font-weight: 700; padding-top: 6px; }
        .cal-day { min-height: 64px; padding: 6px; }
        .cal-mini { display: none; }
        .cal-day-count { font-size: 11px; }
      }
    `,
  ],
})
export class ScheduleCalendar implements OnInit {
  appointments = input<ScheduleItem[]>([]);
  warehouses = input<{ id: string; name: string; code?: string }[]>([]);
  mode = input<"agenda" | "compras" | "operacao" | "portaria">("agenda");
  busy = input(false);
  arrivals = input<GateArrivalItem[]>([]);
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
  availability = signal<Record<string,CalendarAvailability>>({}); availabilityBusy=signal(false); availabilityError=signal('');
  private availabilityGeneration=0;private availabilityController?:AbortController;
  readonly views = [
    { id: "day" as const, label: "Dia" },
    { id: "week" as const, label: "Semana" },
    { id: "month" as const, label: "Mês" },
  ];
  readonly slots = SLOTS;
  readonly weekNames = ["Seg", "Ter", "Qua", "Qui", "Sex"];
  filtersOpen = signal(false);
  private menu = viewChild<ElementRef<HTMLDetailsElement>>("more");
  readonly activeFilters = computed(() => (this.moega() ? 1 : 0) + (this.origin() ? 1 : 0));
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
  // Origin only matters when synthetic demo data is around; real operators should not have to think about it.
  readonly showOriginFilter = computed(
    () => this.api.can("management") || !!this.origin() || this.appointments().some((item) => item.origin === "demo_sintetico"),
  );
  readonly visible = computed(() =>
    this.appointments().filter((item) => this.matchesStatus(item) && this.matchesMoega(item)),
  );
  readonly visibleArrivals = computed(() =>
    this.arrivals()
      // Vinculada a uma reserva, a chegada já aparece no card do agendamento.
      .filter((arrival) => !arrival.appointment)
      .filter((arrival) => arrival.decision === "pending" || this.dayInRange(iso(new Date(arrival.created_at))))
      .sort((a, b) => a.created_at.localeCompare(b.created_at)),
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
    // No receiving on weekends, so the month grid only shows Monday to Friday.
    return Array.from({ length: 42 }, (_, index) => addDays(start, index)).filter((day) => !isWeekend(iso(day))).map((day) => {
      const dayIso = iso(day);
      const items = this.visible().filter((item) => this.itemDate(item) === dayIso);
      return {
        iso: dayIso,
        number: day.getDate(),
        inMonth: day.getMonth() === anchor.getMonth(),
        today: dayIso === iso(startOfDay(new Date())),
        items: items.slice(0, 2),
        count: items.length,
        label: new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" }).format(day),
      };
    });
  });
  readonly utilization = computed(() => {
    const dates=this.capacityDates(), states=this.availability(), known=dates.every(day=>!!states[day]);
    const capacity=dates.reduce((sum,day)=>sum+(states[day]?.calendar_open ? states[day].global_capacity*states[day].slots.length : 0),0);
    const used=dates.reduce((sum,day)=>sum+(states[day]?.slots.reduce((units,slot)=>units+slot.occupied_units,0)??0),0);
    return {scope:this.view()==='day'?'do dia':this.view()==='week'?'da semana':'do mês',used,capacity,known,percent:capacity?Math.round(used/capacity*100):0};
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
    if(this.mode() === "portaria") this.view.set("day");
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
    if(this.printBusy())return;
    const reportDay=formatDay(iso(this.anchor())),reportOrigin=this.origin() ? originLabel(this.origin()) : "Todas as origens";
    const preview = Capacitor.isNativePlatform() ? null : window.open("", "_blank");
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
      const ids = [...new Set(items.flatMap(item => item.invoices?.length ? item.invoices.map(invoice=>invoice.id) : item.invoice ? [item.invoice] : []))];
      const invoices = new Map<string, InvoicePayload>();
      await Promise.all(
        ids.map(async (id) => {
          invoices.set(id, await this.api.get<InvoicePayload>(`invoices/${id}/`));
        }),
      );
      const rows: ReceivingReportRow[] = [];
      for (const item of items) {
        const linked=item.invoices?.length ? item.invoices : [{id:item.invoice??'',number:item.invoice_number??''}];
        for(const link of linked){
          const invoice=invoices.get(link.id),products=invoice?.items??[],total=invoiceTotal(products),value=total==null?'Não disponível':money(total),date=formatDay(this.itemDate(item)),number=link.number||invoice?.number||'Não informada';
          if(!products.length)rows.push({supplier:item.supplier_name,product:'Não informado na nota',quantity:'Não informada',invoice:number,value,date});
          for(const product of products)rows.push({supplier:item.supplier_name,product:product.description||'Não informado',quantity:formatQuantity(product.quantity,product.unit),invoice:number,value,date});
        }
      }
      await openReceivingReport(rows, reportDay, preview, reportOrigin, Capacitor.isNativePlatform() ? (blob,name)=>this.api.saveBlob(blob,name) : undefined);
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
  open(day: string, time: string) {
    return this.availability()[day]?.calendar_open === true && this.availability()[day]?.slots.some(slot=>slot.time.slice(0,5)===time&&slot.eligible) === true;
  }
  availabilityLabel(day:string,time:string){const state=this.availability()[day];if(this.availabilityBusy())return 'Consultando…';if(!state)return '—';if(!state.calendar_open)return 'Fechado';const slot=state.slots.find(slot=>slot.time.slice(0,5)===time);return slot?.eligible ? this.vacancies(slot.available_units) : 'Sem vaga';}
  closeMenu(event?: Event) {
    const menu = this.menu()?.nativeElement;
    if (menu?.open && !(event && menu.contains(event.target as Node))) menu.open = false;
  }
  arrivalWhen(arrival: GateArrivalItem) {
    const at = new Date(arrival.created_at);
    const sameDay = this.view() === "day" && iso(at) === this.anchorIso();
    const format = sameDay ? { hour: "2-digit", minute: "2-digit" } as const : { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" } as const;
    return new Intl.DateTimeFormat("pt-BR", format).format(at);
  }
  arrivalTone(arrival: GateArrivalItem) {
    return arrival.decision === "authorized" ? "arrived" : arrival.decision === "rejected" ? "rejected" : "pending";
  }
  arrivalDecision(arrival: GateArrivalItem) {
    return { pending: "Aguardando o armazém", occurrence: "Ocorrência · aguardando Compras", authorized: "Entrada autorizada", rejected: "Recusada" }[arrival.decision];
  }
  statusLabel(value:string){return STATUS_LABELS[value] ?? value;}
  vacancies(units:number){return units===1 ? '1 vaga' : `${units} vagas`;}
  readonly emptyMessage = computed(() => {
    if (this.visible().length || (this.view() === "day" && isWeekend(this.anchorIso()))) return "";
    const period = this.view() === "day" ? "neste dia" : this.view() === "week" ? "nesta semana" : "neste mês";
    if (this.canSchedule()) return `Você não tem entregas ${period}. Toque em um horário livre para agendar.`;
    return this.appointments().length ? `Nenhum caminhão ${period} com os filtros escolhidos.` : `Nenhum caminhão agendado ${period}.`;
  });
  invoiceNumbers(item:ScheduleItem){return item.invoices?.map(invoice=>invoice.number).join(', ')||item.invoice_number||'não informada';}
  export(){exportCsv('agenda.csv',[['Data','Hora','Fornecedor','Veículo','Notas fiscais','Situação','Destinos','Origem'],...this.visible().map(item=>[this.itemDate(item),this.itemTime(item),item.supplier_name,item.vehicle_plate,this.invoiceNumbers(item),item.operation_status,this.visitLabel(item),originLabel(item.origin??'')])]);}
  refresh(){this.publish();}
  freeUnits(day:string,time:string){if(!this.open(day,time))return 0;return this.availability()[day]?.slots.find(slot=>slot.time.slice(0,5)===time)?.available_units??0;}
  freeText(day:string,time:string){const units=this.freeUnits(day,time);return units>0 ? `${this.vacancies(units)} livre${units===1?'':'s'}` : this.availabilityLabel(day,time);}
  past(day:string){return day<iso(startOfDay(new Date()));}
  held(day:string,time:string){return (this.availability()[day]?.slots.find(slot=>slot.time.slice(0,5)===time)?.held_units??0)>0;}
  dayItems(day:string,time:string){return this.visible().filter(item=>this.itemDate(item)===day&&this.itemTime(item)===time);}
  visitLabel(item:ScheduleItem){return item.visits?.map(visit=>visit.warehouse_name).join(', ')||'Destino a definir';}
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
    void this.loadAvailability(from,to);
  }
  private bounds(): [string, string] {
    const anchor = this.anchor();
    if (this.view() === "day") {
      const day = iso(anchor);
      return [day, day];
    }
    if (this.view() === "week") {
      const start = startOfWeek(anchor);
      return [iso(start), iso(addDays(start, WEEKDAYS - 1))];
    }
    const start = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
    return [iso(start), iso(addDays(start, 41))];
  }
  private inRange(item: ScheduleItem) {
    return this.dayInRange(this.itemDate(item));
  }
  private dayInRange(day: string) {
    if (this.view() === "day") return day === this.anchorIso();
    if (this.view() === "week") return this.weekDays().some((d) => d.iso === day);
    const anchor = this.anchor();
    const date = parseIso(day);
    return date.getMonth() === anchor.getMonth() && date.getFullYear() === anchor.getFullYear();
  }
  private capacityDates() {
    const [from,to]=this.bounds();const dates:string[]=[];
    for(let day=parseIso(from);iso(day)<=to;day=addDays(day,1)){if(this.view()!=='month'||day.getMonth()===this.anchor().getMonth())dates.push(iso(day));}
    return dates;
  }
  private async loadAvailability(from:string,to:string){
    this.availabilityController?.abort();const controller=this.availabilityController=new AbortController(),generation=++this.availabilityGeneration;
    this.availability.set({});this.availabilityBusy.set(true);this.availabilityError.set('');
    try{const result=await this.api.get<{days:CalendarAvailability[]}>(`slots/availability/?date_from=${from}&date_to=${to}&packaging=paletizada`,controller.signal);
      const entries=Object.fromEntries(result.days.map(day=>[day.date,day]));
      if(generation===this.availabilityGeneration)this.availability.set(entries);
    }catch(error){if(generation===this.availabilityGeneration&&!controller.signal.aborted)this.availabilityError.set(apiError(error));}
    finally{if(generation===this.availabilityGeneration)this.availabilityBusy.set(false);}
  }
  ngOnDestroy(){this.availabilityGeneration++;this.availabilityController?.abort();}
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
    if (item.quantity == null || item.unit_value == null || item.quantity === "" || item.unit_value === "") return null;
    const quantity = Number(item.quantity);
    const unitValue = Number(item.unit_value);
    if (!Number.isFinite(quantity) || !Number.isFinite(unitValue)) return null;
    total += quantity * unitValue;
    found = true;
  }
  return found ? total : null;
}
function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}
