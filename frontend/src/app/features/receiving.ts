import { Component, inject, OnInit, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { IonButton, IonSpinner } from "@ionic/angular/standalone";
import {
  Api,
  apiError,
  dateTime,
  localTimestamp,
  nowLocal,
  closedDayMessage,
  isWeekend,
  nextBusinessDay,
  originLabel,
  Page,
  today,
} from "../core/api";
import { Catalog } from "../core/catalog";
import { decimal } from "../core/presentation";
import { ScheduleCalendar, ScheduleRange } from "./schedule-calendar";
import { EmptyState, FeedbackState, LoadingState, Origin, PageHeader, Status } from "../shared/ui";
interface Visit {
  id: string;
  warehouse: string;
  warehouse_name: string;
  started_at: string | null;
  finished_at: string | null;
  worker_count: number | null;
  equipment_ids?: string[];
}
interface ReceivingEvent {
  id: string;
  action?: string;
  event_type?: string;
  kind?: string;
  created_at?: string;
  recorded_at?: string;
  occurred_at?: string;
  details?: unknown;
  data?: unknown;
  actor_name?: string;
}
export interface Appointment {
  id: string;
  supplier: string;
  supplier_name: string;
  invoice: string;
  invoice_number?: string;
  invoice_detail?: {
    id: string;
    number: string;
    attachment_id: string;
    extracted?: unknown;
  };
  date: string;
  time: string;
  packaging: string;
  vehicle_plate: string;
  origin: string;
  notes: string;
  purchase_status: string;
  warehouse_status: string;
  operation_status: string;
  capacity_reserved?: boolean;
  arrived_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  visits: Visit[];
  events: ReceivingEvent[];
  worker_count?: number;
  cancelled_slot_hold?: string;
  slot?: { date: string; time: string };
  capacity_holds?: {
    id: string;
    active: boolean;
    date: string;
    time: string;
    units: number;
    exclusive: boolean;
  }[];
  revision: number;
}
interface InvoiceData {
  id: string;
  number: string;
  access_key: string;
  attachment_id: string;
  original_name: string;
  extraction_status: string;
  extracted?: {
    issued_at?: string;
    issuer?: { name: string; document: string };
    volumes?: {
      quantity: string | null;
      species: string;
      net_weight: string | null;
      gross_weight: string | null;
    }[];
  };
  items: {
    id: string;
    position: number;
    supplier_code: string;
    description: string;
    unit: string;
    quantity: string | null;
    unit_value: string | null;
  }[];
}
function appointmentDate(value?: string) {
  if (!value) return "Data não informada";
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value.split("-").reverse().join("/")
    : value;
}
function packagingLabel(value: string) {
  return (
    ({
      batida: "Batida",
      paletizada: "Paletizada",
      big_bag: "Big bag",
      maquina_implemento: "Máquina ou implemento",
    } as Record<string, string>)[value] ?? value
  );
}
function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}
// Mirrors backend receiving/invoice_key.py: nNF sits at positions 26-34 of the 44-digit key.
export function invoiceKeyError(number: string, accessKey: string): string {
  const key = onlyDigits(accessKey);
  if (!key) return "";
  if (key.length !== 44) return `A chave de acesso deve ter 44 dígitos (informados: ${key.length}).`;
  let total = 0;
  for (let i = 42, weight = 2; i >= 0; i--, weight = weight === 9 ? 2 : weight + 1)
    total += Number(key[i]) * weight;
  const remainder = total % 11;
  if ((remainder < 2 ? 0 : 11 - remainder) !== Number(key[43]))
    return "Chave de acesso inválida: dígito verificador não confere.";
  const typed = number.trim();
  if (!typed) return "";
  if (!/^\d+$/.test(typed)) return "O número da nota deve conter somente dígitos.";
  const embedded = Number(key.slice(25, 34));
  return Number(typed) === embedded
    ? ""
    : `Número da nota (${Number(typed)}) não confere com a chave, que indica a nota ${embedded}.`;
}
async function appointmentOptions(api: Api): Promise<Appointment[]> {
  const options: Appointment[] = [];
  let page = 1;
  while (true) {
    const result = await api.get<Page<Appointment>>(
      `appointments/?page=${page}`,
    );
    options.push(...result.results);
    if (!result.next) break;
    page++;
  }
  return options;
}
@Component({
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, IonButton, PageHeader, FeedbackState, LoadingState, ScheduleCalendar],
  template: `<div class="page">
    <app-page-header [title]="title" [subtitle]="subtitle">
      @if (api.can("supplier", "warehouse")) {
        <ion-button routerLink="/agenda/novo">Agendar recebimento</ion-button>
      }
    </app-page-header>
    <div class="notice">
      Capacidade global por horário: uma carga batida exclusiva ou até duas
      cargas paletizadas / big bag. A chegada pode ser registrada com aprovações
      pendentes.
    </div>
    @if (supplierOnly) {
      <div class="notice">Você visualiza somente os agendamentos vinculados ao seu cadastro de fornecedor.</div>
    }
    @if (error()) {
      <div app-feedback tone="error" class="error">{{ error() }}</div>
    }
    @if (busy() && !rows().length) {
      <app-loading-state label="Carregando agenda…" />
    }
    <app-schedule-calendar
      [appointments]="rows()"
      [warehouses]="catalog.warehouses()"
      [mode]="mode"
      [busy]="busy()"
      (rangeChange)="onRange($event)"
    />
  </div>`,
})
export class AppointmentList implements OnInit {
  api = inject(Api);
  catalog = inject(Catalog);
  private route = inject(ActivatedRoute);
  rows = signal<Appointment[]>([]);
  busy = signal(false);
  error = signal("");
  title = "Agenda de recebimento";
  subtitle = "Consulte a reserva de cada caminhão no calendário diário, semanal ou mensal.";
  mode: "agenda" | "compras" | "operacao" = "agenda";
  private request = 0;
  get supplierOnly() {
    return this.api.user()?.role === "supplier";
  }
  ngOnInit() {
    const mode = this.route.snapshot.data["mode"];
    if (mode === "compras") {
      this.mode = "compras";
      this.title = "Conferência de Compras";
      this.subtitle = "Compare a nota e o pedido no calendário antes de registrar a decisão.";
    }
    if (mode === "operacao") {
      this.mode = "operacao";
      this.title = "Operação do armazém";
      this.subtitle = "Acompanhe chegada, descarga e conclusão no calendário da operação.";
    }
    void this.catalog.load().catch(() => undefined);
  }
  async onRange(query: ScheduleRange) {
    const request = ++this.request;
    this.rows.set([]);
    this.busy.set(true);
    this.error.set("");
    try {
      const rows: Appointment[] = [];
      let page = 1;
      while (page <= 30) {
        const params = new URLSearchParams({
          page: String(page),
          page_size: "100",
          date_from: query.from,
          date_to: query.to,
        });
        if (query.origin) params.set("origin", query.origin);
        const result = await this.api.get<Page<Appointment>>(`appointments/?${params}`);
        rows.push(...result.results);
        if (!result.next) break;
        page++;
      }
      if (request !== this.request) return;
      const user = this.api.user();
      this.rows.set(
        user?.role === "supplier"
          ? user.supplier_id
            ? rows.filter((item) => item.supplier === user.supplier_id)
            : []
          : rows,
      );
    } catch (e) {
      if (request !== this.request) return;
      this.error.set(apiError(e));
    } finally {
      if (request === this.request) this.busy.set(false);
    }
  }
}
@Component({
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, IonButton, IonSpinner, PageHeader, LoadingState, FeedbackState],
  template: `<div class="page form-page">
    <app-page-header title="Agendar recebimento" subtitle="Anexe a nota e reserve um horário global.">
      <a routerLink="/agenda">Voltar à agenda</a>
    </app-page-header>
    @if (error()) {
      <div app-feedback tone="error" class="error">{{ error() }}</div>
    }
    <form [formGroup]="form" (ngSubmit)="save()">
      <section class="panel">
        <h2>Nota e carga</h2>
        <div class="form-grid">
          @if (api.can("warehouse", "purchasing")) {
            <label
              >Fornecedor<select formControlName="supplier">
                <option value="">Selecione</option>
                @for (s of catalog.suppliers(); track s.id) {
                  <option [value]="s.id">{{ s.name }} · {{ s.code }}</option>
                }
              </select></label
            >
          }
          <label class="wide"
            >Arquivo da nota<input
              type="file"
              accept=".pdf,.xml"
              (change)="fileChange($event)"
            /><span class="field-help"
              >XML de até 5 MB ou PDF de até 10 MB. O anexo é privado e gravado
              pela API.</span
            ></label
          ><label
            >Número da nota<input formControlName="number" inputmode="numeric" [required]="isPdf()" /><span
              class="field-help"
              >{{ isPdf() ? "Obrigatório para PDF." : "No XML, lido do arquivo." }}</span
            ></label
          ><label class="wide"
            >Chave de acesso<input
              formControlName="access_key"
              inputmode="numeric"
              maxlength="54"
              placeholder="44 dígitos do DANFE"
              [required]="isPdf()"
              [attr.aria-invalid]="!!keyError()"
              aria-describedby="access-key-help"
            /><span class="field-help" id="access-key-help" [class.field-error]="!!keyError()">{{
              keyError() ||
                (isPdf()
                  ? "Obrigatória para PDF. O número da nota precisa constar na chave."
                  : "No XML, lida do arquivo e conferida com o número da nota.")
            }}</span></label
          ><label
            >Placa do veículo<input
              formControlName="vehicle_plate"
              placeholder="Informe a identificação" /></label
          ><label
            >Acondicionamento<select formControlName="packaging">
              <option value="paletizada">Paletizada</option>
              <option value="big_bag">Big bag</option>
              <option value="maquina_implemento">Máquina ou implemento</option>
              <option value="batida">Batida (horário exclusivo)</option>
            </select></label
          ><label class="wide"
            >Observações<textarea formControlName="notes"></textarea>
          </label>
        </div>
      </section>
      <section class="panel">
        <h2>Data e horário</h2>
        <div class="form-grid">
          <label
            >Data<input
              type="date"
              formControlName="date"
              (change)="availability()"
            /><span class="field-help">{{ dateHelp }}</span></label
          ><label
            >Horário<select formControlName="time">
              <option value="08:00">08h00</option>
              <option value="10:00">10h00</option>
              <option value="13:00">13h00</option>
              <option value="15:00">15h00</option>
            </select></label
          >
        </div>
        @if (availabilityBusy()) {
          <app-loading-state label="Consultando horários disponíveis…" />
        } @else if (slots().length) {
          <h3 class="section">Disponibilidade global no dia</h3>
          <div class="table-wrap availability-table" tabindex="0" role="region" aria-label="Disponibilidade por horário">
            <table>
              <thead>
                <tr>
                  <th scope="col">Horário</th>
                  <th scope="col">Capacidade ocupada</th>
                  <th scope="col">Disponibilidade</th>
                </tr>
              </thead>
              <tbody>
                @for (s of slots(); track s.time) {
                  <tr [class.selected-slot]="s.time === form.controls.time.value">
                    <td><strong>{{ s.time }}</strong></td>
                    <td class="numeric">
                      {{ s.used_units ?? s.occupied_units ?? "Consultar" }}
                    </td>
                    <td>
                      <span class="slot-availability"
                        [class.available]="(s.available_units ?? s.remaining_units ?? -1) > 0"
                        [class.unavailable]="(s.available_units ?? s.remaining_units) === 0">{{
                        s.available_units ??
                          s.remaining_units ??
                          "A API confirmará a reserva"
                      }}@if (s.available_units != null || s.remaining_units != null) { unidade(s) }</span>
                      @if (s.can_batida === true) {
                        <span class="table-cell-secondary">Batida exclusiva disponível</span>
                      } @else if (s.can_batida === false) {
                        <span class="table-cell-secondary">Batida exclusiva indisponível</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <p class="field-help section">A disponibilidade é uma consulta. A reserva será confirmada ao salvar.</p>
        }
        <p class="site-note">
          Sem agendamento não há descarga. Um agendamento no ato também precisa
          de validações antes da entrada.
        </p>
      </section>
      <div class="actions">
        <ion-button type="submit" [disabled]="busy() || form.invalid || !file || !!keyError() || calendarClosed()">
          @if (busy()) {
            <ion-spinner name="dots" />
          }
          Salvar e reservar horário</ion-button
        ><ion-button fill="outline" routerLink="/agenda"
          >Cancelar edição</ion-button
        >
      </div>
    </form>
  </div>`,
})
export class AppointmentCreate implements OnInit {
  api = inject(Api);
  catalog = inject(Catalog);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  busy = signal(false);
  availabilityBusy = signal(false);
  error = signal("");
  slots = signal<
    {
      time: string;
      used_units?: number;
      occupied_units?: number;
      available_units?: number;
      remaining_units?: number;
      can_batida?: boolean;
    }[]
  >([]);
  file: File | null = null;
  invoiceId = "";
  calendarClosed = signal(false);
  form = this.fb.nonNullable.group({
    supplier: [""],
    number: [""],
    access_key: [""],
    vehicle_plate: ["", Validators.required],
    packaging: ["paletizada", Validators.required],
    notes: [""],
    date: [nextBusinessDay(), Validators.required],
    time: ["08:00", Validators.required],
  });
  get dateHelp() {
    const selected = this.form.controls.date.value;
    if (this.calendarClosed() || isWeekend(selected)) return closedDayMessage(selected);
    if (isWeekend(today()) && selected === nextBusinessDay()) {
      const [year, month, day] = selected.split("-");
      return `A data inicial é ${day}/${month}/${year}, o próximo dia útil. Recebimento somente de segunda a sexta.`;
    }
    return "Segunda a sexta, conforme o calendário configurado.";
  }
  ngOnInit() {
    if (this.api.can("warehouse", "purchasing"))
      void this.catalog.load().catch((e) => this.error.set(apiError(e)));
    void this.availability();
  }
  fileChange(event: Event) {
    this.file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.invoiceId = "";
  }
  isPdf() {
    return !!this.file?.name.toLowerCase().endsWith(".pdf");
  }
  keyError() {
    const { number, access_key } = this.form.getRawValue();
    return invoiceKeyError(number, access_key);
  }
  async availability() {
    this.availabilityBusy.set(true);
    this.slots.set([]);
    try {
      const r = await this.api.get<
        { slots?: unknown[]; calendar_open?: boolean } | unknown[]
      >(`slots/availability/?date=${this.form.controls.date.value}`);
      if (!Array.isArray(r) && r.calendar_open === false) {
        this.slots.set([]);
        this.calendarClosed.set(true);
        this.error.set(closedDayMessage(this.form.controls.date.value));
        return;
      }
      this.calendarClosed.set(false);
      this.error.set("");
      this.slots.set(
        (Array.isArray(r) ? r : (r.slots ?? [])) as ReturnType<
          typeof this.slots
        >,
      );
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.availabilityBusy.set(false);
    }
  }
  async save() {
    const selected = this.form.controls.date.value;
    if (isWeekend(selected) || this.calendarClosed()) {
      this.calendarClosed.set(true);
      this.error.set(closedDayMessage(selected));
      return;
    }
    if (!this.file || this.form.invalid) return;
    this.busy.set(true);
    this.error.set("");
    try {
      const v = this.form.getRawValue();
      if (!this.invoiceId) {
        const fd = new FormData();
        fd.append("file", this.file);
        if (v.supplier) fd.append("supplier", v.supplier);
        if (v.number) fd.append("number", v.number.trim());
        if (v.access_key) fd.append("access_key", onlyDigits(v.access_key));
        const invoice = await this.api.post<{ id: string }>("invoices/upload/", fd);
        this.invoiceId = invoice.id;
      }
      const a = await this.api.post<Appointment>("appointments/", {
        supplier: v.supplier || undefined,
        invoice: this.invoiceId,
        date: v.date,
        time: v.time,
        packaging: v.packaging,
        vehicle_plate: v.vehicle_plate,
        notes: v.notes,
      });
      await this.router.navigate(["/agenda", a.id]);
    } catch (e) {
      const message = apiError(e);
      const closed = message.includes("segunda a sexta") || message.includes("feriado");
      if (closed) this.calendarClosed.set(true);
      this.error.set(closed ? closedDayMessage(this.form.controls.date.value) : message);
    } finally {
      this.busy.set(false);
    }
  }
}
@Component({
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    IonButton,
    IonSpinner,
    Status,
    Origin,
    PageHeader,
    LoadingState, FeedbackState,
  ],
  template: `<div class="page">
    <app-page-header title="Detalhes do recebimento" subtitle="Documentos, validações e eventos da carga.">
      <a routerLink="/agenda">Voltar à agenda</a>
    </app-page-header>
    @if (error()) {
      <div app-feedback tone="error" class="error">{{ error() }}</div>
    }
    @if (success()) {
      <div app-feedback tone="success" class="success">{{ success() }}</div>
    }
    @if (busy() && !a()) {
      <app-loading-state label="Carregando recebimento…" />
    }
    @if (a(); as item) {
      <app-origin [value]="item.origin" />
      <section class="panel receiving-summary" aria-labelledby="receiving-summary-title">
        <div class="summary-identity">
          <div>
            <h2 class="plate" id="receiving-summary-title">{{ item.vehicle_plate || "Veículo sem placa" }}</h2>
            <p>{{ item.supplier_name }}</p>
          </div>
          <p class="muted">{{ date(item.date || item.slot?.date) }} às {{ item.time || item.slot?.time }}</p>
        </div>
        <dl class="metadata approval-states" aria-label="Situação independente de cada área">
          <div>
            <dt>Compras</dt>
            <dd><app-status [value]="item.purchase_status" /></dd>
          </div>
          <div>
            <dt>Armazém</dt>
            <dd><app-status [value]="item.warehouse_status" /></dd>
          </div>
          <div>
            <dt>Operação</dt>
            <dd><app-status [value]="item.operation_status" /></dd>
          </div>
        </dl>
        <dl class="metadata section">
          <div>
            <dt>Chegada</dt>
            <dd>{{ dt(item.arrived_at) }}</dd>
          </div>
          <div>
            <dt>Entrada</dt>
            <dd>{{ dt(item.started_at) }}</dd>
          </div>
          <div>
            <dt>Saída</dt>
            <dd>{{ dt(item.finished_at) }}</dd>
          </div>
          <div>
            <dt>Nota</dt>
            <dd>
              {{
                item.invoice_number ||
                  item.invoice_detail?.number ||
                  "Número não informado"
              }}
            </dd>
          </div>
          <div>
            <dt>Acondicionamento</dt>
            <dd>{{ packaging(item.packaging) }}</dd>
          </div>
          <div>
            <dt>Origem</dt>
            <dd>{{ origin(item.origin) }}</dd>
          </div>
        </dl>
        @if (item.notes) {
          <div class="section">
            <h3>Observações da carga</h3>
            <p>{{ item.notes }}</p>
          </div>
        }
        <h3 class="section">Ações do recebimento</h3>
        @if (api.can("warehouse") && warehousePending(item).length) {
          <div class="notice section" role="status">
            <strong>Antes da entrada:</strong> {{ warehousePending(item).join(" · ") }}
          </div>
        }
        <div class="actions section">
          @if (api.can("warehouse")) {
            @if (item.operation_status === "waiting") {
              <ion-button (click)="open('arrive')" [disabled]="busy()">Registrar chegada</ion-button>
            }
            @if (canReviewDestinations(item)) {
              <ion-button
                [fill]="item.warehouse_status === 'approved' ? 'outline' : 'solid'"
                (click)="open('warehouse-review')"
                [disabled]="busy()"
                >{{ item.warehouse_status === "approved" ? "Alterar destinos" : "Confirmar destinos" }}</ion-button
              >
            }
            @if (item.operation_status === "arrived" && !warehousePending(item).length) {
              <ion-button (click)="open('start')" [disabled]="busy()">Registrar entrada</ion-button>
            }
            @if (item.operation_status === "in_progress" && visitsDone(item)) {
              <ion-button (click)="open('finish')" [disabled]="busy()">Concluir recebimento</ion-button>
            }
            @if (item.operation_status === "cancelled" && activeHolds().length) {
              <ion-button (click)="open('assign-cancelled')" [disabled]="busy()"
                >Atribuir vaga cancelada</ion-button
              >
            }
          }
          @if (api.can("purchasing") && editable(item)) {
            <ion-button (click)="open('purchase-review')" [disabled]="busy()"
              >Conferir nota / pedido</ion-button
            >
          }
          <ion-button fill="outline" (click)="download()" [disabled]="busy()">Baixar nota</ion-button>
        </div>
        @if (item.operation_status === "in_progress" && !visitsDone(item) && api.can("warehouse")) {
          <p class="field-help">Conclua as etapas em “Destinos e etapas” para liberar a conclusão do recebimento.</p>
        }
        @if (api.can("warehouse") && editable(item)) {
          <h3 class="section">Exceções</h3>
          <div class="actions section">
            <ion-button fill="outline" (click)="open('reschedule')" [disabled]="busy()"
              >Reagendar por natureza</ion-button
            ><ion-button
              fill="outline"
              [routerLink]="['/nao-recebimentos/novo']"
              [queryParams]="{ appointment: item.id }"
              >Registrar não recebimento</ion-button
            ><ion-button fill="outline" color="danger" (click)="open('cancel')" [disabled]="busy()"
              >Cancelar agendamento</ion-button
            >
          </div>
        }
        @if (api.user()?.role === "supplier" && editable(item)) {
          <div class="actions section">
            <ion-button
              fill="outline"
              color="danger"
              (click)="open('cancel')"
              [disabled]="busy()"
              >Cancelar agendamento</ion-button
            >
          </div>
        }
      </section>
      @if (invoiceData(); as invoice) {
        <section class="panel">
          <h2>Dados declarados na nota</h2>
          <dl class="metadata">
            <div>
              <dt>Número</dt>
              <dd>{{ invoice.number || "Não informado" }}</dd>
            </div>
            <div>
              <dt>Emitente declarado</dt>
              <dd>{{ invoice.extracted?.issuer?.name || "Não extraído" }}</dd>
            </div>
            <div>
              <dt>Emissão declarada</dt>
              <dd>{{ invoiceDate(invoice.extracted?.issued_at) }}</dd>
            </div>
            <div>
              <dt>Chave declarada</dt>
              <dd class="break-word">
                {{ invoice.access_key || "Não extraída" }}
              </dd>
            </div>
          </dl>
          <p class="notice section">
            A extração organiza o que o emitente declarou; não valida
            autenticidade fiscal. Códigos de itens são do fornecedor e não estão
            vinculados automaticamente aos códigos internos. Acondicionamento e
            destinos exigem confirmação.
          </p>
          @if (invoice.items.length) {
            <div class="table-wrap" tabindex="0" role="region" aria-label="Itens declarados na nota">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Código do fornecedor</th>
                    <th>Descrição</th>
                    <th>Unidade</th>
                    <th class="numeric">Quantidade declarada</th>
                  </tr>
                </thead>
                <tbody>
                  @for (line of invoice.items; track line.id) {
                    <tr>
                      <td>{{ line.position }}</td>
                      <td>{{ line.supplier_code }}</td>
                      <td class="wrap">{{ line.description }}</td>
                      <td>{{ line.unit }}</td>
                      <td class="numeric">
                        {{ line.quantity == null ? "Não declarada" : decimal(line.quantity) }}
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="muted">
              Itens não extraídos. Confira o anexo privado antes da decisão de
              Compras.
            </p>
          }
          @if (invoice.extracted?.volumes?.length) {
            <h3 class="section">Volumes declarados</h3>
            <div class="table-wrap" tabindex="0" role="region" aria-label="Volumes declarados na nota">
              <table>
                <thead>
                  <tr>
                    <th>Quantidade</th>
                    <th>Espécie</th>
                    <th>Peso líquido declarado (kg)</th>
                    <th>Peso bruto declarado (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  @for (v of invoice.extracted?.volumes; track $index) {
                    <tr>
                      <td>{{ v.quantity == null ? "Não declarado" : decimal(v.quantity) }}</td>
                      <td>{{ v.species || "Não declarada" }}</td>
                      <td>{{ v.net_weight == null ? "Não declarado" : decimal(v.net_weight) }}</td>
                      <td>{{ v.gross_weight == null ? "Não declarado" : decimal(v.gross_weight) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>
      }
      @if (action()) {
        <form class="panel form-page" [formGroup]="form" (ngSubmit)="execute()">
          <h2>{{ actionTitle() }}</h2>
          @if (action() === "purchase-review") {
            <div class="form-grid">
              <label
                >Decisão<select formControlName="decision">
                  <option value="pending">Pendente</option>
                  <option value="approved">Aprovar</option>
                  <option value="rejected">Rejeitar</option>
                </select></label
              ><label
                >Referência do pedido<input
                  formControlName="order_reference"
                /><span class="field-help"
                  >O pedido pode ainda não existir; mantenha pendente nessa
                  situação.</span
                ></label
              ><label class="wide"
                >Resultado da comparação<textarea
                  formControlName="notes"
                  required
                ></textarea>
              </label>
            </div>
          }
          @if (action() === "warehouse-review") {
            <p>
              Confirme um ou mais destinos físicos. A aprovação de Compras é
              verificada no servidor.
            </p>
            <div class="checks">
              @for (w of catalog.warehouses(); track w.id) {
                <label class="check"
                  ><input
                    type="checkbox"
                    [checked]="selectedWarehouses().includes(w.id)"
                    (change)="toggleWarehouse(w.id)"
                  />{{ w.name }}</label
                >
              }
            </div>
            <label class="section"
              >Observação<textarea formControlName="notes"></textarea>
            </label>
          }
          @if (
            action() === "arrive" ||
            action() === "start" ||
            action() === "finish" ||
            action().startsWith("visit-")
          ) {
            <label
              >Data / hora do evento<input
                type="datetime-local"
                formControlName="occurred_at"
                required
              /><span class="field-help"
                >Horário local. A sequência é conferida no backend.</span
              ></label
            >
          }
          @if (action() === "finish" || action() === "visit-finish") {
            <div class="form-grid section">
              <label
                >Chapas utilizados<input
                  type="number"
                  min="0"
                  step="1"
                  formControlName="worker_count"
              /></label>
              <div>
                <h3>Equipamentos utilizados</h3>
                <div class="checks">
                  @for (e of catalog.equipment(); track e.id) {
                    <label class="check"
                      ><input
                        type="checkbox"
                        [checked]="selectedEquipment().includes(e.id)"
                        (change)="toggleEquipment(e.id)"
                      />{{ e.name }}</label
                    >
                  }
                </div>
              </div>
              <label class="check wide"
                ><input
                  type="checkbox"
                  formControlName="resources_confirmed"
                />Confirmei os recursos; zero/nenhum é uma informação
                explícita.</label
              >
            </div>
          }
          @if (action() === "cancel") {
            <div class="notice">
              A capacidade ficará retida para decisão do armazém sobre quem
              ocupa a vaga. O cancelamento preserva o histórico.
            </div>
            <label
              >Motivo<textarea formControlName="reason" required></textarea>
            </label>
          }
          @if (action() === "reschedule") {
            <div class="notice">
              Exceção por caso fortuito de natureza. A API preserva
              exclusividade, calendário, aprovações e histórico.
            </div>
            <div class="form-grid">
              <label
                >Nova data<input
                  type="date"
                  formControlName="date"
                  required /></label
              ><label
                >Horário<select formControlName="time">
                  <option value="08:00">08h00</option>
                  <option value="10:00">10h00</option>
                  <option value="13:00">13h00</option>
                  <option value="15:00">15h00</option>
                </select></label
              ><label class="wide"
                >Caso fortuito / justificativa<textarea
                  formControlName="reason"
                  required
                ></textarea>
              </label>
            </div>
          }
          @if (action() === "assign-cancelled") {
            <label
              >Vaga retida<select formControlName="hold_id">
                <option value="">Selecione a vaga</option>
                @for (h of activeHolds(); track h.id) {
                  <option [value]="h.id">
                    {{ h.date }} · {{ h.time }} · {{ h.units }} unidade(s){{
                      h.exclusive ? " · exclusiva" : ""
                    }}
                  </option>
                }
              </select></label
            ><label class="section"
              >Agendamento destinatário<select
                formControlName="target_appointment"
              >
                <option value="">Selecione o caminhão</option>
                @for (a of candidates(); track a.id) {
                  <option [value]="a.id">{{ appointmentLabel(a) }}</option>
                }</select
              ><span class="field-help"
                >Atribuição explícita ao caminhão escolhido, sujeita à
                capacidade e ao acondicionamento.</span
              ></label
            >
          }
          <div class="actions section">
            <ion-button type="submit" [color]="action() === 'cancel' ? 'danger' : 'primary'" [disabled]="busy()">
              @if (busy()) {
                <ion-spinner name="dots" />
              }
              Confirmar {{ actionTitle().toLowerCase() }}</ion-button
            ><ion-button
              fill="outline"
              (click)="action.set('')"
              [disabled]="busy()"
              >Fechar edição</ion-button
            >
          </div>
        </form>
      }
      <section class="panel">
        <h2>Destinos e etapas</h2>
        @if (item.visits.length) {
          <div class="table-wrap" tabindex="0" role="region" aria-label="Destinos e etapas da carga">
            <table>
              <thead>
                <tr>
                  <th>Armazém</th>
                  <th>Início</th>
                  <th>Fim</th>
                  <th>Chapas</th>
                  <th><span class="sr-only">Ações da etapa</span></th>
                </tr>
              </thead>
              <tbody>
                @for (v of item.visits; track v.id) {
                  <tr>
                    <td><strong class="table-cell-primary">{{ v.warehouse_name }}</strong></td>
                    <td>{{ dt(v.started_at) }}</td>
                    <td>{{ dt(v.finished_at) }}</td>
                    <td>{{ v.worker_count ?? "Não registrado" }}</td>
                    <td>
                      @if (
                        api.can("warehouse") &&
                        item.started_at &&
                        !item.finished_at
                      ) {
                        @if (!v.started_at) {
                          <ion-button
                            size="small"
                            fill="outline"
                            (click)="open('visit-start', v.id)"
                            >Iniciar etapa</ion-button
                          >
                        } @else if (!v.finished_at) {
                          <ion-button
                            size="small"
                            fill="outline"
                            (click)="open('visit-finish', v.id)"
                            >Concluir etapa</ion-button
                          >
                        }
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <p class="muted">Destinos ainda não confirmados.</p>
        }
        <p class="site-note">
          Os destinos são sequenciais. Um caminhão conta uma vez no total
          global. Tempo sem registro de etapa fica indisponível por local.
        </p>
      </section>
      <section class="panel">
        <h2>Histórico de decisões</h2>
        @if (item.events.length) {
          <ol class="audit" aria-label="Eventos registrados no recebimento">
            @for (e of item.events; track e.id) {
              <li>
                <strong>{{
                  eventName(e.kind || e.action || e.event_type)
                }}</strong>
                <div class="audit-meta">
                  <time [attr.datetime]="e.occurred_at || e.recorded_at || e.created_at">{{ dt(e.occurred_at || e.recorded_at || e.created_at) }}</time>
                  <span>{{ e.actor_name || "Responsável registrado" }}</span>
                </div>
                @if (e.data || e.details) {
                  <p class="muted">{{ eventDetail(e.data || e.details) }}</p>
                }
              </li>
            }
          </ol>
        } @else {
          <p class="muted">Sem eventos retornados pela API.</p>
        }
      </section>
    }
  </div>`,
})
export class AppointmentDetail implements OnInit {
  decimal = decimal;
  api = inject(Api);
  catalog = inject(Catalog);
  private route = inject(ActivatedRoute);
  private fb = inject(FormBuilder);
  a = signal<Appointment | null>(null);
  invoiceData = signal<InvoiceData | null>(null);
  candidates = signal<Appointment[]>([]);
  busy = signal(false);
  error = signal("");
  success = signal("");
  action = signal("");
  selectedWarehouses = signal<string[]>([]);
  selectedEquipment = signal<string[]>([]);
  private visitId = "";
  dt = dateTime;
  origin = originLabel;
  date = appointmentDate;
  packaging = packagingLabel;
  form = this.fb.nonNullable.group({
    decision: ["pending"],
    order_reference: [""],
    notes: [""],
    occurred_at: [nowLocal()],
    worker_count: [0],
    resources_confirmed: [false],
    reason: [""],
    date: [today()],
    time: ["08:00"],
    target_appointment: [""],
    hold_id: [""],
  });
  ngOnInit() {
    if (this.api.can("warehouse", "purchasing", "management"))
      void this.catalog.load().catch((e) => this.error.set(apiError(e)));
    void this.load();
  }
  async load() {
    this.busy.set(true);
    try {
      this.a.set(
        await this.api.get<Appointment>(
          `appointments/${this.route.snapshot.paramMap.get("id")}/`,
        ),
      );
      this.invoiceData.set(
        await this.api.get<InvoiceData>(`invoices/${this.a()?.invoice}/`),
      );
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
  open(action: string, visitId = "") {
    this.action.set(action);
    this.visitId = visitId;
    this.error.set("");
    this.success.set("");
    this.form.controls.occurred_at.setValue(nowLocal());
    this.selectedWarehouses.set(
      this.a()?.visits?.map((v) => v.warehouse) ?? [],
    );
    this.selectedEquipment.set([]);
    this.form.controls.resources_confirmed.setValue(false);
    if (action === "assign-cancelled") {
      this.form.controls.hold_id.setValue(this.activeHolds()[0]?.id ?? "");
      void this.loadCandidates();
    }
  }
  actionTitle() {
    return (
      (
        {
          "purchase-review": "Conferência de Compras",
          "warehouse-review": "Confirmação de destinos",
          arrive: "Chegada",
          start: "Entrada",
          finish: "Conclusão",
          cancel: "Cancelamento",
          reschedule: "Reagendamento",
          "assign-cancelled": "Atribuição da vaga",
          "visit-start": "Início da etapa",
          "visit-finish": "Conclusão da etapa",
        } as Record<string, string>
      )[this.action()] ?? ""
    );
  }
  toggleWarehouse(id: string) {
    this.selectedWarehouses.update((v) =>
      v.includes(id) ? v.filter((x) => x !== id) : [...v, id],
    );
  }
  toggleEquipment(id: string) {
    this.selectedEquipment.update((v) =>
      v.includes(id) ? v.filter((x) => x !== id) : [...v, id],
    );
  }
  activeHolds() {
    return this.a()?.capacity_holds?.filter((h) => h.active) ?? [];
  }
  // Mirrors the backend state machine (receiving/services.py) so only valid actions are shown.
  editable(item: Appointment) {
    return ["waiting", "arrived"].includes(item.operation_status);
  }
  canReviewDestinations(item: Appointment) {
    return this.editable(item) && item.purchase_status === "approved";
  }
  warehousePending(item: Appointment) {
    if (!this.editable(item)) return [];
    const pending: string[] = [];
    if (item.purchase_status === "pending") pending.push("aguardando conferência de Compras");
    if (item.purchase_status === "rejected") pending.push("nota rejeitada por Compras");
    if (item.purchase_status === "approved" && item.warehouse_status !== "approved")
      pending.push("confirme os destinos");
    if (item.capacity_reserved === false) pending.push("sem reserva ativa de horário");
    return pending;
  }
  visitsDone(item: Appointment) {
    return item.visits.length <= 1 || item.visits.every((v) => !!v.finished_at);
  }
  appointmentLabel(a: Appointment) {
    return `${a.vehicle_plate || "Veículo sem placa"} · ${a.supplier_name} · ${a.date} ${a.time}`;
  }
  async loadCandidates() {
    this.busy.set(true);
    try {
      this.candidates.set(
        (await appointmentOptions(this.api)).filter(
          (a) =>
            a.id !== this.a()?.id &&
            !a.started_at &&
            !["cancelled", "completed", "not_received"].includes(
              a.operation_status,
            ),
        ),
      );
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
  invoiceDate(value?: string) {
    if (!value) return "Não extraída";
    if (/^\d{4}-\d{2}-\d{2}$/.test(value))
      return value.split("-").reverse().join("/");
    return dateTime(value);
  }
  eventName(kind?: string) {
    return (
      (
        {
          created: "Agendamento criado",
          updated: "Dados do agendamento corrigidos",
          purchase_review: "Conferência de Compras",
          warehouse_review: "Destinos confirmados",
          arrived: "Chegada registrada",
          started: "Entrada registrada",
          finished: "Recebimento concluído",
          visit_started: "Etapa iniciada",
          visit_finished: "Etapa concluída",
          visit_start: "Etapa iniciada",
          visit_finish: "Etapa concluída",
          cancelled: "Agendamento cancelado",
          rescheduled: "Agendamento reagendado",
          capacity_assigned: "Vaga atribuída pelo armazém",
          not_received: "Não recebimento registrado",
        } as Record<string, string>
      )[kind ?? ""] ?? "Registro operacional"
    );
  }
  eventDetail(value: unknown): string {
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object") return "";
    const labels: Record<string, string> = {
      decision: "Decisão",
      order_reference: "Pedido",
      comparison_notes: "Comparação",
      notes: "Observação",
      reason: "Motivo",
      warehouse_ids: "Destinos",
      equipment_ids: "Equipamentos",
      worker_count: "Chapas",
      resources_confirmed: "Recursos confirmados",
      nature_exception: "Exceção por natureza",
      date: "Data",
      time: "Horário",
      from_date: "Data anterior",
      source_date: "Data anterior",
      source_time: "Horário anterior",
      target_date: "Nova data",
      target_time: "Novo horário",
      from_time: "Horário anterior",
      to_date: "Nova data",
      to_time: "Novo horário",
      capacity: "Capacidade",
      approval_reset: "Aprovações reiniciadas",
    };
    return (
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => labels[key])
        .map(([key, v]) => {
          let text = String(v ?? "");
          if (key === "decision")
            text =
              (
                {
                  approved: "Aprovada",
                  pending: "Pendente",
                  rejected: "Rejeitada",
                } as Record<string, string>
              )[text] ?? "Registrada";
          if (key === "reason") text = reasons[text] ?? text;
          if (key === "warehouse_ids" && Array.isArray(v))
            text = v
              .map(
                (id) =>
                  this.catalog.warehouses().find((w) => w.id === id)?.name ??
                  "Destino registrado",
              )
              .join(", ");
          if (key === "equipment_ids" && Array.isArray(v))
            text =
              v
                .map(
                  (id) =>
                    this.catalog.equipment().find((e) => e.id === id)?.name ??
                    "Equipamento registrado",
                )
                .join(", ") || "Nenhum";
          if (
            key === "capacity" &&
            text === "held_for_named_warehouse_assignment"
          )
            text = "Retida para decisão do armazém";
          if (typeof v === "boolean") text = v ? "Sim" : "Não";
          return `${labels[key]}: ${text}`;
        })
        .join(" · ") ||
      "Decisão registrada; trilha completa preservada no servidor."
    );
  }
  async download() {
    this.busy.set(true);
    this.error.set("");
    this.success.set("");
    try {
      const invoice =
        this.invoiceData() ??
        (await this.api.get<InvoiceData>(`invoices/${this.a()?.invoice}/`));
      const saved = await this.api.download(
        `attachments/${invoice.attachment_id}/download/`,
        invoice.original_name || `nota-${invoice.number || this.a()?.id}`,
      );
      if (saved) this.success.set("Anexo salvo no local escolhido.");
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
  async execute() {
    this.busy.set(true);
    this.error.set("");
    this.success.set("");
    const v = this.form.getRawValue(),
      act = this.action();
    let body: unknown = {};
    let endpoint = `appointments/${this.a()?.id}/${act}/`;
    try {
      if (act === "purchase-review") {
        if (!v.notes) throw new Error("Descreva a comparação nota/pedido.");
        body = {
          decision: v.decision,
          order_reference: v.order_reference,
          comparison_notes: v.notes,
        };
      }
      if (act === "warehouse-review") {
        if (!this.selectedWarehouses().length)
          throw new Error("Selecione ao menos um destino.");
        body = { warehouse_ids: this.selectedWarehouses(), notes: v.notes };
      }
      if (
        ["arrive", "start", "finish", "visit-start", "visit-finish"].includes(
          act,
        )
      ) {
        body = { occurred_at: localTimestamp(v.occurred_at) };
        if (act.startsWith("visit-"))
          endpoint = `warehouse-visits/${this.visitId}/${act.replace("visit-", "")}/`;
        if (act === "finish" || act === "visit-finish") {
          if (!v.resources_confirmed)
            throw new Error("Confirme os recursos, inclusive zero/nenhum.");
          body = {
            occurred_at: localTimestamp(v.occurred_at),
            worker_count: Number(v.worker_count),
            equipment_ids: this.selectedEquipment(),
            resources_confirmed: true,
          };
        }
      }
      if (
        act === "cancel" ||
        act === "reschedule" ||
        act === "assign-cancelled"
      ) {
        if (act !== "assign-cancelled" && !v.reason)
          throw new Error("Informe a justificativa.");
        if (act === "assign-cancelled" && (!v.hold_id || !v.target_appointment))
          throw new Error(
            "Selecione a vaga retida e o agendamento destinatário.",
          );
        body =
          act === "cancel"
            ? { reason: v.reason }
            : act === "reschedule"
              ? {
                  date: v.date,
                  time: v.time,
                  reason: v.reason,
                  nature_exception: true,
                }
              : {
                  hold_id: v.hold_id,
                  appointment_id: v.target_appointment,
                };
        if (act === "assign-cancelled")
          endpoint = "slots/assign-cancelled-capacity/";
      }
      await this.api.post(endpoint, {
        ...(body as object),
        expected_revision:
          act === "assign-cancelled"
            ? this.candidates().find((a) => a.id === v.target_appointment)
                ?.revision
            : this.a()?.revision,
      });
      this.action.set("");
      await this.load();
      this.success.set(`${this.actionTitleFor(act)}: registro salvo no servidor.`);
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
  private actionTitleFor(a: string) {
    return (
      (
        {
          "purchase-review": "Conferência",
          "warehouse-review": "Destinos",
          arrive: "Chegada",
          start: "Entrada",
          finish: "Conclusão",
          cancel: "Cancelamento",
          reschedule: "Reagendamento",
          "assign-cancelled": "Atribuição",
          "visit-start": "Início da etapa",
          "visit-finish": "Conclusão da etapa",
        } as Record<string, string>
      )[a] ?? "Evento"
    );
  }
}
interface NonReceipt {
  id: string;
  supplier_name?: string;
  reason: string;
  description: string;
  occurred_at: string;
  origin: string;
}
const reasons: Record<string, string> = {
  invoice_mismatch: "Divergência entre nota e pedido",
  unscheduled_no_capacity: "Sem agendamento e sem vaga",
  nature: "Caso fortuito de natureza",
  other: "Outro",
};
@Component({
  standalone: true,
  imports: [RouterLink, IonButton, Origin, PageHeader, LoadingState, EmptyState, FeedbackState],
  template: `<div class="page">
    <app-page-header [title]="selectedId ? 'Não recebimento registrado' : 'Não recebimentos'" subtitle="Ocorrências com ou sem agendamento.">
      @if (selectedId) {
        <a routerLink="/nao-recebimentos">Ver todas as ocorrências</a>
      } @else if (api.can("warehouse")) {
        <ion-button routerLink="/nao-recebimentos/novo">Registrar ocorrência</ion-button>
      }
    </app-page-header>
    @if (error()) {
      <div app-feedback tone="error" class="error">{{ error() }}</div>
    }
    @if (busy()) {
      <app-loading-state label="Carregando ocorrências…" />
    } @else if (selectedId && rows().length) {
      @for (r of rows(); track r.id) {
        <app-origin [value]="r.origin" />
        <section class="panel">
          <h2>{{ reason(r.reason) }}</h2>
          <dl class="metadata">
            <div><dt>Fornecedor</dt><dd>{{ r.supplier_name || "Não identificado" }}</dd></div>
            <div><dt>Data e hora</dt><dd><time [attr.datetime]="r.occurred_at">{{ dt(r.occurred_at) }}</time></dd></div>
            <div><dt>Origem</dt><dd>{{ origin(r.origin) }}</dd></div>
          </dl>
          <h3 class="section">Descrição da ocorrência</h3>
          <p>{{ r.description || "Descrição não informada" }}</p>
        </section>
      }
    } @else if (rows().length) {
      <div class="table-wrap" tabindex="0" role="region" aria-label="Ocorrências de não recebimento">
        <table>
          <thead>
            <tr>
              <th>Quando</th>
              <th>Fornecedor</th>
              <th>Motivo</th>
              <th>Descrição</th>
              <th>Origem</th>
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.id) {
              <tr>
                <td><time [attr.datetime]="r.occurred_at">{{ dt(r.occurred_at) }}</time></td>
                <td class="wrap"><strong class="table-cell-primary">{{ r.supplier_name || "Não identificado" }}</strong></td>
                <td class="wrap"><a class="table-action" [routerLink]="['/nao-recebimentos', r.id]">{{ reason(r.reason) }}</a></td>
                <td class="wrap">{{ r.description }}</td>
                <td class="wrap"><small [class.origin]="r.origin === 'demo_sintetico'">{{ origin(r.origin) }}</small></td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    } @else if (!error()) {
      <div app-empty-state class="empty">
        <h2>Nenhuma ocorrência registrada</h2>
        <p>Os registros de cargas não recebidas aparecerão aqui.</p>
        @if (api.can("warehouse")) {
          <ion-button routerLink="/nao-recebimentos/novo">Registrar ocorrência</ion-button>
        }
      </div>
    }
  </div>`,
})
export class NonReceipts implements OnInit {
  api = inject(Api);
  private route = inject(ActivatedRoute);
  selectedId = this.route.snapshot.paramMap.get("id");
  rows = signal<NonReceipt[]>([]);
  error = signal("");
  busy = signal(false);
  dt = dateTime;
  origin = originLabel;
  reason = (v: string) => reasons[v] ?? v;
  ngOnInit() {
    void this.load();
  }
  async load() {
    this.busy.set(true);
    this.error.set("");
    try {
      if (this.selectedId)
        this.rows.set([
          await this.api.get<NonReceipt>(`non-receipts/${this.selectedId}/`),
        ]);
      else {
        const r = await this.api.get<Page<NonReceipt>>(
          "non-receipts/?page_size=100",
        );
        this.rows.set(r.results);
      }
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
}
@Component({
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, IonButton, IonSpinner, PageHeader, FeedbackState],
  template: `<div class="page form-page">
    <app-page-header title="Registrar não recebimento" subtitle="Um caminhão sem agendamento e sem vaga também precisa de registro.">
      <a routerLink="/nao-recebimentos">Voltar às ocorrências</a>
    </app-page-header>
    @if (error()) {
      <div app-feedback tone="error" class="error">{{ error() }}</div>
    }
    <form class="panel" [formGroup]="form" (ngSubmit)="save()">
      <h2>Dados da ocorrência</h2>
      <div class="form-grid">
        <label
          >Agendamento (opcional)<select
            formControlName="appointment"
            (change)="appointmentChanged()"
          >
            <option value="">Sem agendamento</option>
            @for (a of candidates(); track a.id) {
              <option [value]="a.id">{{ appointmentLabel(a) }}</option>
            }
          </select></label
        ><label
          >Fornecedor (opcional)<select formControlName="supplier">
            <option value="">Não identificado</option>
            @for (s of catalog.suppliers(); track s.id) {
              <option [value]="s.id">{{ s.name }}</option>
            }
          </select></label
        ><label
          >Motivo<select formControlName="reason">
            <option value="">Selecione o motivo</option>
            <option value="invoice_mismatch">
              Divergência entre nota e pedido
            </option>
            <option value="unscheduled_no_capacity">
              Sem agendamento e sem vaga
            </option>
            <option value="nature">Caso fortuito de natureza</option>
            <option value="other">Outro</option>
          </select></label
        ><label
          >Data / hora<input
            type="datetime-local"
            formControlName="occurred_at"
            required /></label
        ><label
          >Origem<select formControlName="origin">
            <option value="operacional_registrado">Operação registrada</option>
            <option value="demo_sintetico">Demonstração sintética</option>
          </select></label
        ><label class="wide"
          >Descrição<textarea formControlName="description" required></textarea>
        </label>
      </div>
      <div class="actions section">
        <ion-button type="submit" [disabled]="busy() || form.invalid">
          @if (busy()) { <ion-spinner name="dots" /> }
          Gravar ocorrência</ion-button
        ><ion-button fill="outline" routerLink="/nao-recebimentos"
          >Cancelar edição</ion-button
        >
      </div>
    </form>
  </div>`,
})
export class NonReceiptCreate implements OnInit {
  candidates = signal<Appointment[]>([]);
  appointmentLabel(a: Appointment) {
    return `${a.vehicle_plate || "Veículo sem placa"} · ${a.supplier_name} · ${a.date} ${a.time}`;
  }
  private api = inject(Api);
  catalog = inject(Catalog);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private fb = inject(FormBuilder);
  error = signal("");
  busy = signal(false);
  form = this.fb.nonNullable.group({
    appointment: [""],
    supplier: [""],
    reason: ["", Validators.required],
    description: ["", Validators.required],
    occurred_at: [nowLocal(), Validators.required],
    origin: ["operacional_registrado"],
  });
  ngOnInit() {
    this.form.controls.appointment.setValue(
      this.route.snapshot.queryParamMap.get("appointment") ?? "",
    );
    void this.catalog.load().catch((e) => this.error.set(apiError(e)));
    void appointmentOptions(this.api)
      .then((rows) => {
        this.candidates.set(rows.filter((a) => !a.started_at));
        this.appointmentChanged();
      })
      .catch((e) => this.error.set(apiError(e)));
  }
  async save() {
    this.busy.set(true);
    this.error.set("");
    try {
      const v = this.form.getRawValue();
      await this.api.post("non-receipts/", {
        ...v,
        appointment: v.appointment || null,
        supplier: v.supplier || null,
        occurred_at: localTimestamp(v.occurred_at),
        expected_revision: v.appointment
          ? this.candidates().find((a) => a.id === v.appointment)?.revision
          : undefined,
      });
      await this.router.navigateByUrl("/nao-recebimentos");
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
  appointmentChanged() {
    const a = this.candidates().find(
      (a) => a.id === this.form.controls.appointment.value,
    );
    if (a) {
      this.form.patchValue({ supplier: a.supplier, origin: a.origin });
    }
  }
}
