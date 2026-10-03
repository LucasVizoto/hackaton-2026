import { Capacitor } from "@capacitor/core";
import { Component, computed, inject, input, OnInit, output, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { Api, apiError, originLabel } from "../core/api";
import { openReceivingReport, ReceivingReportRow } from "./receiving-report";
import { exportCsv } from "../core/workflow";
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
  invoices?: { id:string; number:string }[];
  origin?:string;
  purchase_status: string;
  operation_status: string;
  capacity_reserved?: boolean;
  visits?: ScheduleVisit[];
  slot?: { date: string; time: string };
}
export interface ScheduleRange {
  from: string;
  to: string;
  origin: string;
}
interface CalendarAvailability {date:string;calendar_open:boolean;global_capacity:number;slots:{time:string;occupied_units:number;available_units:number;eligible:boolean}[];}
type View = "day" | "week" | "month";
interface Column {
  id: string;
  name: string;
  code?: string;
  iso?: string;
  weekend?: boolean;
  today?: boolean;
}

const SLOTS = [
  { time: "08:00", label: "08h00" },
  { time: "10:00", label: "10h00" },
  { time: "13:00", label: "13h00" },
  { time: "15:00", label: "15h00" },
];

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
function packaging(value: string) {
  return (
    ({ batida: "Batida", paletizada: "Paletizada", big_bag: "Big bag", machine_implement: "Máquina / implemento" } as Record<string, string>)[value] ??
    value
  );
}

@Component({
  standalone: true,
  selector: "app-schedule-calendar",
  imports: [RouterLink, Status],
  template: `
    <section class="cal" [attr.aria-busy]="busy()">
      <div class="cal-toolbar">
        <div class="cal-views" role="tablist" aria-label="Modelo do calendário">
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
        <div class="cal-nav">
          <button type="button" class="icon-button" (click)="step(-1)" [attr.aria-label]="stepLabel(-1)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6 9 12l6 6" /></svg>
          </button>
          <strong>{{ heading() }}</strong>
          <button type="button" class="icon-button" (click)="step(1)" [attr.aria-label]="stepLabel(1)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
          </button>
          <button type="button" class="cal-today" (click)="goToday()">Hoje</button>
          <button type="button" class="cal-print" (click)="refresh()" [disabled]="busy() || availabilityBusy()">Atualizar</button>
          <button type="button" class="cal-print" (click)="export()" [disabled]="busy() || !visible().length">Exportar agenda</button>
          @if (view() === "day") {
            <button
              type="button"
              class="cal-print"
              (click)="printDay()"
              [disabled]="printBusy() || !printable().length"
            >
              {{ printBusy() ? "Preparando…" : "Imprimir dia completo" }}
            </button>
          }
        </div>
        <div class="cal-util">
          <span>Ocupação global · {{ utilization().scope }}</span>
          <div class="bar-track" aria-hidden="true"><span [style.width.%]="utilization().percent"></span></div>
          <strong>{{ availabilityBusy() ? "Consultando…" : utilization().known ? utilization().percent + "% (" + utilization().used + "/" + utilization().capacity + " unidades)" : "Não disponível" }}</strong>
        </div>
      </div>
      <div class="cal-filters">
        <div class="cal-chips" role="group" [attr.aria-label]="mode() === 'compras' ? 'Filtrar por compras' : 'Filtrar por operação'">
          @for (chip of chips(); track chip.id) {
            <button type="button" class="cal-chip" [class.is-active]="status() === chip.id" (click)="status.set(chip.id)">
              {{ chip.label }}
            </button>
          }
        </div>
        <label class="cal-moega">
          Armazém
          <select [value]="moega()" (change)="setMoega($event)">
            <option value="">Todos os armazéns</option>
            @for (warehouse of warehouses(); track warehouse.id) {
              <option [value]="warehouse.id">{{ warehouse.name }}</option>
            }
            <option value="unassigned">A definir</option>
          </select>
        </label>
        <label class="cal-moega">
          Origem
          <select [value]="origin()" (change)="setOrigin($event)">
            <option value="">Todas as origens</option>
            <option value="operacional_registrado">Operação registrada</option>
            <option value="demo_sintetico">Demonstração sintética</option>
          </select>
        </label>
      </div>
      @if(view() === 'day'){<p class="field-help">A impressão inclui o dia completo e a origem escolhida, exceto rejeitados, cancelados e não recebidos. Filtros de situação e armazém afetam apenas a tela e a exportação CSV.</p>}
      <p class="field-help">A disponibilidade é global, consultada na API, independentemente dos filtros. Uma vaga compartilhada não garante espaço para carga exclusiva.</p>
      @if(availabilityError()){<p class="error" role="alert">Disponibilidade: {{availabilityError()}}</p>}
      @if (printError()) {
        <p class="cal-empty" role="alert">{{ printError() }}</p>
      }
      @if (!busy() && !visible().length) {
        <p class="cal-empty">Nenhum agendamento neste recorte. Os horários livres continuam no calendário.</p>
      }
      @if (busy() && !appointments().length) {
        <p class="cal-empty">Carregando os horários deste período.</p>
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
              [attr.aria-label]="day.label + (day.count ? ', ' + day.count + ' agendamentos' : ', sem agendamentos')"
              (click)="openDay(day.iso)"
            >
              <span class="cal-day-number">{{ day.number }}</span>
              @for (item of day.items; track item.id) {
                <span [class]="'cal-mini ' + tone(item)">{{ itemTime(item) }} · {{ item.supplier_name }}</span>
              }
              @if (day.extra) {
                <span class="cal-more">+{{ day.extra }}</span>
              }
            </button>
          }
        </div>
      } @else {
        <div class="table-wrap cal-scroll" tabindex="0" role="region" [attr.aria-label]="view() === 'day' ? 'Agenda do dia por armazém' : 'Agenda da semana'">
          <table class="cal-table">
            <caption class="sr-only">{{ heading() }}</caption>
            <thead>
              <tr>
                <th scope="col">Faixa horária</th>
                @for (column of columns(); track column.id) {
                  <th scope="col" [class.is-today]="column.today" [class.is-weekend]="column.weekend">
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
                  <th scope="row">{{ slot.label }}</th>
                  @for (column of columns(); track column.id) {
                    <td [class.is-today]="column.today" [class.is-weekend]="column.weekend">
                      @for (item of cell(column, slot.time); track item.id) {
                        <a [class]="'cal-card ' + tone(item)" [routerLink]="['/agenda', item.id]">
                          <app-status [value]="tone(item)" />
                          <strong>{{ item.supplier_name }}</strong>
                          <span>{{ item.vehicle_plate || "Placa não informada" }} · {{ pack(item.packaging) }}</span>
                          <span>{{ itemTime(item) }} · NF {{ invoiceNumbers(item) }}</span>
                          @if (view() === "week" && item.visits?.length) {
                            <span>{{ visitLabel(item) }}</span>
                          }
                        </a>
                      } @empty {
                        <span [class]="open(column.iso || anchorIso(), slot.time) ? 'cal-open' : 'cal-closed'">{{availabilityLabel(column.iso || anchorIso(), slot.time)}}</span>
                      }
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
  styles: [
    `
      :host { display: block; }
      .cal { display: grid; gap: 16px; }
      .cal-toolbar, .cal-filters, .cal-nav, .cal-util, .cal-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
      .cal-toolbar, .cal-filters { justify-content: space-between; }
      .cal-views { display: inline-flex; gap: 4px; padding: 4px; background: var(--surface-subtle); border-radius: var(--radius-full); }
      .cal-views button, .cal-chip, .cal-today, .cal-print {
        border: 0; background: transparent; color: var(--text); font: inherit; font-size: 13px; font-weight: 600;
        border-radius: var(--radius-full); min-height: 40px; padding: 8px 14px; cursor: pointer;
      }
      .cal-print { border: 1px solid var(--control-line); background: var(--surface); }
      .cal-print:disabled { opacity: 0.6; cursor: not-allowed; }
      .cal-views button.is-active, .cal-chip.is-active, .cal-today { background: var(--green); color: var(--brand-contrast); }
      .cal-chip { border: 1px solid var(--line); background: var(--surface); }
      .cal-chip.is-active { border-color: transparent; }
      .cal-nav { gap: 4px; }
      .cal-nav strong { min-width: 220px; text-align: center; font-size: 16px; }
      .cal-nav svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .cal-util { min-width: min(100%, 280px); gap: 8px; color: var(--muted); font-size: 12px; }
      .cal-util .bar-track { flex: 1; min-width: 88px; margin: 0; }
      .cal-util strong { color: var(--text); font-size: 13px; }
      .cal-moega { min-width: 180px; flex: 0 1 240px; }
      .cal-empty { margin: 0; color: var(--muted); font-size: 14px; }
      .cal-scroll { overflow: auto; }
      .cal-table { min-width: 760px; }
      .cal-table th, .cal-table td { white-space: normal; vertical-align: top; min-width: 168px; }
      .cal-table th[scope="row"], .cal-table thead th:first-child { min-width: 108px; position: sticky; left: 0; z-index: 1; background: var(--surface-subtle); }
      .cal-table thead th { text-align: left; }
      .cal-table thead th strong, .cal-table thead th small { display: block; }
      .cal-table thead th small { font-weight: 500; color: var(--muted); margin-top: 2px; }
      .cal-table .is-today { background: var(--brand-soft); }
      .cal-table .is-weekend { background: var(--surface-subtle); color: var(--muted); }
      .cal-card {
        display: grid; gap: 4px; margin-bottom: 8px; padding: 10px 12px; border-radius: var(--radius-control);
        border: 1px solid var(--line); background: var(--surface); color: var(--text); text-decoration: none;
      }
      .cal-card:last-child { margin-bottom: 0; }
      .cal-card:hover { background: var(--surface-hover); }
      .cal-card strong { font-size: 13px; }
      .cal-card span { color: var(--muted); font-size: 12px; }
      .cal-card.pending { background: var(--warning-soft); border-color: transparent; }
      .cal-card.approved, .cal-card.completed { background: var(--success-soft); border-color: transparent; }
      .cal-card.arrived, .cal-card.unloading, .cal-card.in_progress { background: var(--info-soft); border-color: transparent; }
      .cal-card.rejected, .cal-card.cancelled, .cal-card.not_received { background: var(--danger-soft); border-color: transparent; }
      .cal-card.waiting { background: var(--surface); border-color: var(--blue); }
      .cal-open, .cal-closed {
        display: grid; place-items: center; min-height: 72px; border-radius: var(--radius-control);
        color: var(--muted); font-size: 12px; font-weight: 600;
      }
      .cal-open { border: 1px dashed var(--control-line); }
      .cal-month { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; }
      .cal-weekday { color: var(--muted); font-size: 12px; font-weight: 700; padding: 0 6px; }
      .cal-day {
        display: flex; flex-direction: column; align-items: stretch; gap: 4px; min-height: 112px; padding: 8px;
        border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface);
        color: var(--text); text-align: left; font: inherit; cursor: pointer;
      }
      .cal-day.is-outside { opacity: 0.55; }
      .cal-day.is-weekend { background: var(--surface-subtle); }
      .cal-day.is-today { box-shadow: inset 0 0 0 2px var(--green); }
      .cal-day-number { font-weight: 700; font-size: 13px; }
      .cal-mini, .cal-more { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-radius: var(--radius-full); padding: 2px 6px; font-size: 11px; font-weight: 600; }
      .cal-mini { background: var(--info-soft); color: var(--blue); }
      .cal-mini.pending { background: var(--warning-soft); color: var(--warning); }
      .cal-mini.approved, .cal-mini.completed { background: var(--success-soft); color: var(--success); }
      .cal-mini.rejected, .cal-mini.cancelled, .cal-mini.not_received { background: var(--danger-soft); color: var(--danger); }
      .cal-mini.waiting { background: var(--surface-subtle); color: var(--text); }
      .cal-more { color: var(--muted); }
      @media (max-width: 767px) {
        .cal-nav strong { min-width: 0; font-size: 14px; }
        .cal-month { gap: 4px; }
        .cal-day { min-height: 72px; padding: 4px; }
        .cal-mini, .cal-more { display: none; }
        .cal-day-number { font-size: 12px; }
      }
    `,
  ],
})
export class ScheduleCalendar implements OnInit {
  appointments = input<ScheduleItem[]>([]);
  warehouses = input<{ id: string; name: string; code?: string }[]>([]);
  mode = input<"agenda" | "compras" | "operacao" | "portaria">("agenda");
  busy = input(false);
  rangeChange = output<ScheduleRange>();
  view = signal<View>("week");
  anchor = signal(startOfDay(new Date()));
  status = signal("");
  moega = signal("");
  origin = signal("");
  private api = inject(Api);
  printBusy = signal(false);
  printError = signal("");
  availability = signal<Record<string,CalendarAvailability>>({}); availabilityBusy=signal(false); availabilityError=signal('');
  private availabilityGeneration=0;private availabilityController?:AbortController;
  readonly views = [
    { id: "day" as const, label: "Visão diária" },
    { id: "week" as const, label: "Visão semanal" },
    { id: "month" as const, label: "Visão mensal" },
  ];
  readonly slots = SLOTS;
  readonly weekNames = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  readonly chips = computed(() =>
    this.mode() === "compras"
      ? [
          { id: "", label: "Todas" },
          { id: "pending", label: "Pendente" },
          { id: "approved", label: "Aprovada" },
          { id: "rejected", label: "Rejeitada" },
        ]
      : [
          { id: "", label: "Todas" },
          { id: "waiting", label: "Agendado" },
          { id: "arrived", label: "No pátio" },
          { id: "in_progress", label: "Em descarga" },
          { id: "completed", label: "Concluído" },
        ],
  );
  readonly visible = computed(() =>
    this.appointments().filter((item) => this.matchesStatus(item) && this.matchesMoega(item)),
  );
  readonly printable = computed(() => {
    if (this.view() !== "day") return [];
    const day = iso(this.anchor());
    return this.appointments().filter((item) => this.itemDate(item) === day && this.canPrint(item));
  });
  readonly columns = computed<Column[]>(() => {
    if (this.view() === "week") {
      const start = startOfWeek(this.anchor());
      return Array.from({ length: 7 }, (_, index) => {
        const day = addDays(start, index);
        const dayIso = iso(day);
        return {
          id: dayIso,
          iso: dayIso,
          name: new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).format(day),
          weekend: isWeekend(dayIso),
          today: dayIso === iso(startOfDay(new Date())),
        };
      });
    }
    const selected = this.moega();
    if (selected === "unassigned") return [{ id: "unassigned", name: "A definir" }];
    if (selected) {
      const warehouse = this.warehouses().find((item) => item.id === selected);
      return [{ id: selected, name: warehouse?.name ?? "Moega", code: warehouse?.code }];
    }
    const columns: Column[] = this.warehouses().map((item) => ({ id: item.id, name: item.name, code: item.code }));
    const known = new Set(columns.map((column) => column.id));
    let unassigned = false;
    for (const item of this.visible()) {
      if (this.itemDate(item) !== this.anchorIso()) continue;
      if (!item.visits?.length) {
        unassigned = true;
        continue;
      }
      for (const visit of item.visits) {
        if (known.has(visit.warehouse)) continue;
        known.add(visit.warehouse);
        columns.push({ id: visit.warehouse, name: visit.warehouse_name || "Moega" });
      }
    }
    if (!columns.length) return [{ id: "all", name: "Agenda" }];
    if (unassigned) columns.push({ id: "unassigned", name: "A definir" });
    return columns;
  });
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
        items: items.slice(0, 3),
        extra: Math.max(0, items.length - 3),
        count: items.length,
        label: new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" }).format(day),
      };
    });
  });
  readonly utilization = computed(() => {
    const dates=this.capacityDates(), states=this.availability(), known=dates.every(day=>!!states[day]);
    const capacity=dates.reduce((sum,day)=>sum+(states[day]?.calendar_open ? states[day].global_capacity*states[day].slots.length : 0),0);
    const used=dates.reduce((sum,day)=>sum+(states[day]?.slots.reduce((units,slot)=>units+slot.occupied_units,0)??0),0);
    return {scope:this.view()==='day'?'Dia':this.view()==='week'?'Semana':'Mês',used,capacity,known,percent:capacity?Math.round(used/capacity*100):0};
  });
  readonly heading = computed(() => {
    const anchor = this.anchor();
    if (this.view() === "day") return capitalize(new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" }).format(anchor));
    if (this.view() === "month") return capitalize(new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(anchor));
    const start = startOfWeek(anchor);
    const end = addDays(start, 6);
    const format = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
    return `Semana de ${format.format(start)} a ${format.format(end)}/${end.getFullYear()}`;
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
      const next = new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
      this.anchor.set(next);
    } else {
      this.anchor.set(addDays(anchor, direction * (this.view() === "week" ? 7 : 1)));
    }
    this.publish();
  }
  goToday() {
    this.anchor.set(startOfDay(new Date()));
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
    const target = this.view() === "month" ? "mês" : this.view() === "week" ? "semana" : "dia";
    return direction < 0 ? `Período anterior (${target})` : `Próximo período (${target})`;
  }
  cell(column: Column, time: string) {
    const day = column.iso || this.anchorIso();
    return this.visible().filter((item) => this.itemDate(item) === day && this.itemTime(item) === time && this.inColumn(item, column.id));
  }
  open(day: string, time: string) {
    return this.availability()[day]?.calendar_open === true && this.availability()[day]?.slots.some(slot=>slot.time.slice(0,5)===time&&slot.eligible) === true;
  }
  availabilityLabel(day:string,time:string){const state=this.availability()[day];if(this.availabilityBusy())return 'Consultando…';if(!state)return 'Disponibilidade não consultada';if(!state.calendar_open)return 'Calendário fechado';const slot=state.slots.find(slot=>slot.time.slice(0,5)===time);return slot?.eligible ? `${slot.available_units} unidade(s) global(is) disponível(is)` : 'Sem vaga global';}
  invoiceNumbers(item:ScheduleItem){return item.invoices?.map(invoice=>invoice.number).join(', ')||item.invoice_number||'não informada';}
  export(){exportCsv('agenda.csv',[['Data','Hora','Fornecedor','Veículo','Notas fiscais','Situação','Destinos','Origem'],...this.visible().map(item=>[this.itemDate(item),this.itemTime(item),item.supplier_name,item.vehicle_plate,this.invoiceNumbers(item),item.operation_status,this.visitLabel(item),originLabel(item.origin??'')])]);}
  refresh(){this.publish();}
  weekend = isWeekend;
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
  visitLabel(item: ScheduleItem) {
    return (item.visits ?? []).map((visit) => visit.warehouse_name).join(", ");
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
      return [iso(start), iso(addDays(start, 6))];
    }
    const start = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
    return [iso(start), iso(addDays(start, 41))];
  }
  private capacityDates() {
    const [from,to]=this.bounds();const dates:string[]=[];
    for(let day=parseIso(from);iso(day)<=to;day=addDays(day,1)){if(this.view()!=='month'||day.getMonth()===this.anchor().getMonth())dates.push(iso(day));}
    return dates;
  }
  private async loadAvailability(from:string,to:string){
    this.availabilityController?.abort();const controller=this.availabilityController=new AbortController(),generation=++this.availabilityGeneration;
    this.availability.set({});this.availabilityBusy.set(true);this.availabilityError.set('');
    const dates:string[]=[];for(let day=parseIso(from);iso(day)<=to;day=addDays(day,1))dates.push(iso(day));
    try{const entries:Record<string,CalendarAvailability>={};let next=0;
      await Promise.all(Array.from({length:Math.min(6,dates.length)},async()=>{while(next<dates.length&&!controller.signal.aborted){const date=dates[next++];entries[date]=await this.api.get<CalendarAvailability>(`slots/availability/?date=${date}&packaging=paletizada`,controller.signal);}}));
      if(generation===this.availabilityGeneration)this.availability.set(entries);
    }catch(error){if(generation===this.availabilityGeneration&&!controller.signal.aborted)this.availabilityError.set(apiError(error));}
    finally{if(generation===this.availabilityGeneration)this.availabilityBusy.set(false);}
  }
  ngOnDestroy(){this.availabilityGeneration++;this.availabilityController?.abort();}
  private canPrint(item: ScheduleItem) {
    if (item.purchase_status === "rejected") return false;
    return !["cancelled", "not_received"].includes(item.operation_status);
  }
  private matchesStatus(item: ScheduleItem) {
    const selected = this.status();
    if (!selected) return true;
    if (this.mode() === "compras") return item.purchase_status === selected;
    if (selected === "in_progress") return item.operation_status === "in_progress" || item.operation_status === "unloading";
    return item.operation_status === selected;
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
