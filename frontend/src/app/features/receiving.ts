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
  originLabel,
  Page,
  today,
} from "../core/api";
import { Catalog } from "../core/catalog";
import { Origin, Status } from "../shared/ui";
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
  arrived_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  visits: Visit[];
  events: ReceivingEvent[];
  worker_count?: number;
  cancelled_slot_hold?: string;
  slot?: { date: string; time: string };
  capacity_holds?: { id: string; active: boolean }[];
  revision: number;
}
@Component({
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, IonButton, IonSpinner, Status],
  template: `<div class="page">
    <div class="page-head">
      <div>
        <h1>{{ title }}</h1>
        <p class="muted">{{ subtitle }}</p>
      </div>
      @if (api.can("supplier", "warehouse")) {
        <ion-button routerLink="/agenda/novo">Agendar recebimento</ion-button>
      }
    </div>
    <form class="filters" [formGroup]="filters" (ngSubmit)="load(true)">
      <label>Data<input type="date" formControlName="date" /></label
      ><label
        >Origem<select formControlName="origin">
          <option value="">Todas as origens</option>
          <option value="operacional_registrado">Operação registrada</option>
          <option value="demo_sintetico">Demonstração sintética</option>
        </select></label
      ><label
        >Aprovação de Compras<select formControlName="purchase_status">
          <option value="">Todas</option>
          <option value="pending">Pendente</option>
          <option value="approved">Aprovada</option>
          <option value="rejected">Rejeitada</option>
        </select></label
      ><ion-button type="submit" fill="outline" [disabled]="busy()"
        >Atualizar</ion-button
      >
    </form>
    <div class="notice">
      Capacidade global por horário: uma carga batida exclusiva ou até duas
      cargas paletizadas / big bag. A chegada pode ser registrada com aprovações
      pendentes.
    </div>
    @if (error()) {
      <div class="error" role="alert">{{ error() }}</div>
    }
    @if (busy()) {
      <div class="loading"><ion-spinner /> Carregando agenda…</div>
    } @else if (rows().length) {
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Data / hora</th>
              <th>Fornecedor / nota</th>
              <th>Acondicionamento</th>
              <th>Compras</th>
              <th>Armazém</th>
              <th>Operação</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (a of rows(); track a.id) {
              <tr>
                <td>
                  {{ a.date || a.slot?.date }}<br />{{ a.time || a.slot?.time }}
                </td>
                <td class="wrap">
                  <strong>{{ a.supplier_name }}</strong
                  ><br />NF {{ a.invoice_number || "não informada"
                  }}<br /><small
                    [class.origin]="a.origin === 'demo_sintetico'"
                    >{{ origin(a.origin) }}</small
                  >
                </td>
                <td>
                  {{ packaging(a.packaging) }}<br /><small>{{
                    a.vehicle_plate
                  }}</small>
                </td>
                <td><app-status [value]="a.purchase_status" /></td>
                <td><app-status [value]="a.warehouse_status" /></td>
                <td><app-status [value]="a.operation_status" /></td>
                <td>
                  <a [routerLink]="['/agenda', a.id]">Abrir recebimento</a>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <ion-button fill="outline" (click)="change(-1)" [disabled]="page === 1"
          >Anterior</ion-button
        ><span>Página {{ page }} · {{ count() }} registros</span
        ><ion-button
          fill="outline"
          (click)="change(1)"
          [disabled]="page * 100 >= count()"
          >Próxima</ion-button
        >
      </div>
    } @else {
      <div class="empty">
        <h2>Nenhum recebimento encontrado</h2>
        <p>Altere os filtros ou crie um agendamento.</p>
        <a routerLink="/agenda/novo">Agendar recebimento</a>
      </div>
    }
  </div>`,
})
export class AppointmentList implements OnInit {
  api = inject(Api);
  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  rows = signal<Appointment[]>([]);
  count = signal(0);
  busy = signal(false);
  error = signal("");
  page = 1;
  title = "Agenda de recebimento";
  subtitle = "Consulte a reserva e as validações de cada caminhão.";
  filters = this.fb.nonNullable.group({
    date: [""],
    origin: [""],
    purchase_status: [""],
  });
  origin = originLabel;
  packaging = (v: string) =>
    (
      ({
        batida: "Batida",
        paletizada: "Paletizada",
        big_bag: "Big bag",
      }) as Record<string, string>
    )[v] ?? v;
  ngOnInit() {
    const mode = this.route.snapshot.data["mode"];
    if (mode === "compras") {
      this.title = "Conferência de Compras";
      this.subtitle = "Compare a nota e o pedido antes de registrar a decisão.";
      this.filters.controls.purchase_status.setValue("pending");
    }
    if (mode === "operacao") {
      this.title = "Operação do armazém";
      this.subtitle =
        "Registre chegada, destinos, início, recursos e conclusão.";
    }
    void this.load();
  }
  async load(resetPage = false) {
    if (resetPage) this.page = 1;
    this.busy.set(true);
    this.error.set("");
    try {
      const q = new URLSearchParams({
        page: String(this.page),
        page_size: "100",
      });
      Object.entries(this.filters.getRawValue()).forEach(([k, v]) => {
        if (v) q.set(k, v);
      });
      const r = await this.api.get<Page<Appointment>>(`appointments/?${q}`);
      this.rows.set(r.results);
      this.count.set(r.count);
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
  change(n: number) {
    this.page += n;
    void this.load();
  }
}
@Component({
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, IonButton, IonSpinner],
  template: `<div class="page form-page">
    <div class="page-head">
      <div>
        <h1>Agendar recebimento</h1>
        <p class="muted">Anexe a nota e reserve um horário global.</p>
      </div>
      <a routerLink="/agenda">Voltar à agenda</a>
    </div>
    @if (error()) {
      <div class="error" role="alert">{{ error() }}</div>
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
          <label
            >Origem do registro<select formControlName="origin">
              <option value="operacional_registrado">
                Operação registrada
              </option>
              <option value="demo_sintetico">Demonstração sintética</option>
            </select></label
          ><label class="wide"
            >Arquivo da nota<input
              type="file"
              accept=".pdf,.xml"
              (change)="fileChange($event)"
            /><span class="field-help"
              >PDF ou XML de até 10 MB. O anexo é privado e gravado pela
              API.</span
            ></label
          ><label>Número da nota<input formControlName="number" /></label
          ><label
            >Placa do veículo<input
              formControlName="vehicle_plate"
              placeholder="Informe a identificação" /></label
          ><label
            >Acondicionamento<select formControlName="packaging">
              <option value="paletizada">Paletizada</option>
              <option value="big_bag">Big bag</option>
              <option value="batida">Batida (horário exclusivo)</option>
            </select></label
          ><label
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
            /><span class="field-help"
              >Segunda a sexta, conforme o calendário configurado.</span
            ></label
          ><label
            >Horário<select formControlName="time">
              <option value="08:00">08h00</option>
              <option value="10:00">10h00</option>
              <option value="13:00">13h00</option>
              <option value="15:00">15h00</option>
            </select></label
          >
        </div>
        @if (slots().length) {
          <div class="section table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Horário</th>
                  <th>Capacidade ocupada</th>
                  <th>Disponibilidade</th>
                </tr>
              </thead>
              <tbody>
                @for (s of slots(); track s.time) {
                  <tr>
                    <td>{{ s.time }}</td>
                    <td>
                      {{ s.used_units ?? s.occupied_units ?? "Consultar" }}
                    </td>
                    <td>
                      {{
                        s.available_units ??
                          s.remaining_units ??
                          "A API confirmará a reserva"
                      }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
        <p class="site-note">
          Sem agendamento não há descarga. Um agendamento no ato também precisa
          de validações antes da entrada.
        </p>
      </section>
      <div class="actions">
        <ion-button type="submit" [disabled]="busy() || form.invalid || !file">
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
  error = signal("");
  slots = signal<
    {
      time: string;
      used_units?: number;
      occupied_units?: number;
      available_units?: number;
      remaining_units?: number;
    }[]
  >([]);
  file: File | null = null;
  invoiceId = "";
  form = this.fb.nonNullable.group({
    supplier: [""],
    origin: ["operacional_registrado"],
    number: [""],
    vehicle_plate: ["", Validators.required],
    packaging: ["paletizada", Validators.required],
    notes: [""],
    date: [today(), Validators.required],
    time: ["08:00", Validators.required],
  });
  ngOnInit() {
    if (this.api.can("warehouse", "purchasing"))
      void this.catalog.load().catch((e) => this.error.set(apiError(e)));
    void this.availability();
  }
  fileChange(event: Event) {
    this.file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.invoiceId = "";
  }
  async availability() {
    try {
      const r = await this.api.get<
        { slots?: unknown[]; calendar_open?: boolean } | unknown[]
      >(`slots/availability/?date=${this.form.controls.date.value}`);
      if (!Array.isArray(r) && r.calendar_open === false) {
        this.slots.set([]);
        this.error.set(
          "Não há recebimento na data escolhida, conforme o calendário do servidor. Escolha um dia de segunda a sexta sem feriado.",
        );
        return;
      }
      this.error.set("");
      this.slots.set(
        (Array.isArray(r) ? r : (r.slots ?? [])) as ReturnType<
          typeof this.slots
        >,
      );
    } catch (e) {
      this.error.set(apiError(e));
    }
  }
  async save() {
    if (!this.file || this.form.invalid) return;
    this.busy.set(true);
    this.error.set("");
    try {
      const v = this.form.getRawValue();
      if (!this.invoiceId) {
        const fd = new FormData();
        fd.append("file", this.file);
        if (v.supplier) fd.append("supplier", v.supplier);
        if (v.number) fd.append("number", v.number);
        fd.append("origin", v.origin);
        const invoice = await this.api.post<{ id: string; origin: string }>(
          "invoices/upload/",
          fd,
        );
        this.invoiceId = invoice.id;
        this.form.controls.origin.setValue(invoice.origin);
      }
      const a = await this.api.post<Appointment>("appointments/", {
        supplier: v.supplier || undefined,
        invoice: this.invoiceId,
        date: v.date,
        time: v.time,
        packaging: v.packaging,
        vehicle_plate: v.vehicle_plate,
        notes: v.notes,
        origin: this.form.controls.origin.value,
      });
      await this.router.navigate(["/agenda", a.id]);
    } catch (e) {
      this.error.set(apiError(e));
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
  ],
  template: `<div class="page">
    <div class="page-head">
      <div>
        <h1>Recebimento {{ a()?.vehicle_plate }}</h1>
        <p class="muted">
          {{ a()?.supplier_name }} · {{ a()?.date || a()?.slot?.date }} às
          {{ a()?.time || a()?.slot?.time }}
        </p>
      </div>
      <a routerLink="/agenda">Voltar à agenda</a>
    </div>
    @if (error()) {
      <div class="error" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="success" role="status">{{ success() }}</div>
    }
    @if (busy() && !a()) {
      <div class="loading"><ion-spinner /> Carregando recebimento…</div>
    }
    @if (a(); as item) {
      <app-origin [value]="item.origin" />
      <section class="panel">
        <dl class="metadata">
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
            <dd>{{ item.packaging }}</dd>
          </div>
          <div>
            <dt>Origem</dt>
            <dd>{{ origin(item.origin) }}</dd>
          </div>
        </dl>
        @if (item.notes) {
          <p class="section">{{ item.notes }}</p>
        }
        <div class="actions section">
          <ion-button fill="outline" (click)="download()" [disabled]="busy()"
            >Abrir anexo privado</ion-button
          >
          @if (api.can("purchasing")) {
            <ion-button (click)="open('purchase-review')" [disabled]="busy()"
              >Conferir nota / pedido</ion-button
            >
          }
          @if (api.can("warehouse")) {
            <ion-button (click)="open('warehouse-review')" [disabled]="busy()"
              >Confirmar destinos</ion-button
            ><ion-button
              fill="outline"
              (click)="open('arrive')"
              [disabled]="busy() || !!item.arrived_at"
              >Registrar chegada</ion-button
            ><ion-button
              (click)="open('start')"
              [disabled]="busy() || !!item.started_at"
              >Registrar entrada</ion-button
            ><ion-button
              (click)="open('finish')"
              [disabled]="busy() || !item.started_at || !!item.finished_at"
              >Concluir recebimento</ion-button
            ><ion-button
              fill="outline"
              (click)="open('reschedule')"
              [disabled]="busy() || !!item.started_at"
              >Reagendar por natureza</ion-button
            ><ion-button
              fill="outline"
              (click)="open('cancel')"
              [disabled]="busy() || !!item.started_at"
              >Cancelar agendamento</ion-button
            ><ion-button
              fill="outline"
              [routerLink]="['/nao-recebimentos/novo']"
              [queryParams]="{ appointment: item.id }"
              >Registrar não recebimento</ion-button
            >
          }
          @if (item.operation_status === "cancelled" && api.can("warehouse")) {
            <ion-button (click)="open('assign-cancelled')"
              >Atribuir vaga cancelada</ion-button
            >
          }
        </div>
      </section>
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
              >Agendamento destinatário<input
                formControlName="target_appointment"
                required
                placeholder="UUID do agendamento"
              /><span class="field-help"
                >Atribuição explícita ao caminhão escolhido, sujeita à
                capacidade e ao acondicionamento.</span
              ></label
            ><label class="section"
              >Motivo<textarea formControlName="reason" required></textarea>
            </label>
          }
          <div class="actions section">
            <ion-button type="submit" [disabled]="busy()">
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
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Armazém</th>
                  <th>Início</th>
                  <th>Fim</th>
                  <th>Chapas</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (v of item.visits; track v.id) {
                  <tr>
                    <td>{{ v.warehouse_name }}</td>
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
          <ul class="audit">
            @for (e of item.events; track e.id) {
              <li>
                <strong>{{ e.kind || e.action || e.event_type }}</strong
                ><br /><small
                  >{{ dt(e.occurred_at || e.recorded_at || e.created_at) }} ·
                  {{ e.actor_name || "Responsável registrado" }}</small
                >
                @if (e.data || e.details) {
                  <p class="muted">{{ eventDetail(e.data || e.details) }}</p>
                }
              </li>
            }
          </ul>
        } @else {
          <p class="muted">Sem eventos retornados pela API.</p>
        }
      </section>
    }
  </div>`,
})
export class AppointmentDetail implements OnInit {
  api = inject(Api);
  catalog = inject(Catalog);
  private route = inject(ActivatedRoute);
  private fb = inject(FormBuilder);
  a = signal<Appointment | null>(null);
  busy = signal(false);
  error = signal("");
  success = signal("");
  action = signal("");
  selectedWarehouses = signal<string[]>([]);
  selectedEquipment = signal<string[]>([]);
  private visitId = "";
  dt = dateTime;
  origin = originLabel;
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
  eventDetail(v: unknown) {
    return typeof v === "string" ? v : JSON.stringify(v);
  }
  async download() {
    this.error.set("");
    try {
      const invoice =
        this.a()?.invoice_detail ??
        (await this.api.get<{ attachment_id: string; number: string }>(
          `invoices/${this.a()?.invoice}/`,
        ));
      await this.api.download(
        `attachments/${invoice.attachment_id}/download/`,
        `nota-${invoice.number || this.a()?.id}.pdf`,
      );
    } catch (e) {
      this.error.set(apiError(e));
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
        if (!v.reason) throw new Error("Informe a justificativa.");
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
                  hold_id: this.a()?.capacity_holds?.find((h) => h.active)?.id,
                  appointment_id: v.target_appointment,
                };
        if (act === "assign-cancelled")
          endpoint = "slots/assign-cancelled-capacity/";
      }
      await this.api.post(endpoint, {
        ...(body as object),
        expected_revision:
          act === "assign-cancelled" ? undefined : this.a()?.revision,
      });
      this.action.set("");
      await this.load();
      this.success.set(`${this.actionTitleFor(act)} gravado no servidor.`);
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
  imports: [RouterLink, IonButton, IonSpinner],
  template: `<div class="page">
    <div class="page-head">
      <div>
        <h1>Não recebimentos</h1>
        <p class="muted">Ocorrências com ou sem agendamento.</p>
      </div>
      <ion-button routerLink="/nao-recebimentos/novo"
        >Registrar ocorrência</ion-button
      >
    </div>
    @if (error()) {
      <div class="error" role="alert">{{ error() }}</div>
    }
    @if (busy()) {
      <div class="loading"><ion-spinner /> Carregando ocorrências…</div>
    } @else if (rows().length) {
      <div class="table-wrap">
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
                <td>{{ dt(r.occurred_at) }}</td>
                <td>{{ r.supplier_name || "Não identificado" }}</td>
                <td>{{ reason(r.reason) }}</td>
                <td class="wrap">{{ r.description }}</td>
                <td>{{ origin(r.origin) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    } @else {
      <div class="empty">Nenhuma ocorrência registrada.</div>
    }
  </div>`,
})
export class NonReceipts implements OnInit {
  private api = inject(Api);
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
    try {
      const r = await this.api.get<Page<NonReceipt>>(
        "non-receipts/?page_size=100",
      );
      this.rows.set(r.results);
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
}
@Component({
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, IonButton],
  template: `<div class="page form-page">
    <div class="page-head">
      <div>
        <h1>Registrar não recebimento</h1>
        <p class="muted">
          Um caminhão sem agendamento e sem vaga também precisa de registro.
        </p>
      </div>
      <a routerLink="/nao-recebimentos">Voltar</a>
    </div>
    @if (error()) {
      <div class="error" role="alert">{{ error() }}</div>
    }
    <form class="panel" [formGroup]="form" (ngSubmit)="save()">
      <div class="form-grid">
        <label
          >Agendamento (opcional)<input
            formControlName="appointment"
            placeholder="UUID, se existir" /></label
        ><label
          >Fornecedor (opcional)<select formControlName="supplier">
            <option value="">Não identificado</option>
            @for (s of catalog.suppliers(); track s.id) {
              <option [value]="s.id">{{ s.name }}</option>
            }
          </select></label
        ><label
          >Motivo<select formControlName="reason">
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
        <ion-button type="submit" [disabled]="busy() || form.invalid"
          >Gravar ocorrência</ion-button
        ><ion-button fill="outline" routerLink="/nao-recebimentos"
          >Cancelar edição</ion-button
        >
      </div>
    </form>
  </div>`,
})
export class NonReceiptCreate implements OnInit {
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
    reason: ["unscheduled_no_capacity"],
    description: ["", Validators.required],
    occurred_at: [nowLocal(), Validators.required],
    origin: ["operacional_registrado"],
  });
  ngOnInit() {
    this.form.controls.appointment.setValue(
      this.route.snapshot.queryParamMap.get("appointment") ?? "",
    );
    void this.catalog.load().catch((e) => this.error.set(apiError(e)));
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
      });
      await this.router.navigateByUrl("/nao-recebimentos");
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
}
