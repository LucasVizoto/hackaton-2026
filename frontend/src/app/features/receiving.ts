import { HttpErrorResponse } from "@angular/common/http";
import { Component, inject, OnInit, signal, viewChild } from "@angular/core";
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
import { decimal } from "../core/presentation";
import { AvailableAction, allowed, exportCsv } from "../core/workflow";
import { SlotPicker } from "../shared/slot-picker";
import { PurchaseOrders } from "./purchase-orders";
import { AppointmentEdit } from "./appointment-edit";
import { ScheduleCalendar, ScheduleRange } from "./schedule-calendar";
import { Notifications } from "../shared/notifications";
import { ReceiptCheck, ReceiptLine } from "./receipt-check";
import { EmptyState, FeedbackState, LoadingState, Origin, PageHeader, Status } from "../shared/ui";
interface Visit {
  checked_in_at?: string | null;
  checked_out_at?: string | null;
  available_actions?: AvailableAction[];
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
  divergence_notes?:string; divergence_reported_at?:string|null;
  comparison_notes?:string;
  workflow_version?: number;
  articulated?: boolean;
  booking_kind?: string;
  assisted?: boolean;
  exceptions?: {id:string;kind:string;description:string;occurred_at:string}[];
  gate_checked_in_at?: string | null;
  gate_checked_out_at?: string | null;
  tractor_plate?: string;
  carrier_name?: string;
  driver_name?: string;
  invoices?: InvoiceData[];
  receipt_lines?: ReceiptLine[];
  available_actions?: AvailableAction[];
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
export interface InvoiceData {
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
interface ReceiptSignature {id:string;signer_name:string;declaration?:string;signed_at:string;appointment_revision:number;current_revision:boolean;manifest_sha256:string;}
function appointmentDate(value?: string) {
  if (!value) return "Data não informada";
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value.split("-").reverse().join("/")
    : value;
}
function packagingLabel(value: string) {
  return (
    ({
      machine_implement: "Máquina / implemento",
      batida: "Batida",
      paletizada: "Paletizada",
      big_bag: "Big bag",
    } as Record<string, string>)[value] ?? value
  );
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
  imports: [RouterLink, IonButton, PageHeader, FeedbackState, ScheduleCalendar, Notifications, PurchaseOrders],
  template: `<div class="page">
    <app-page-header [title]="title" [subtitle]="subtitle">
      @if(api.user()?.role==='supplier'){<ion-button routerLink="/agenda/novo">Agendar entrega</ion-button>}
      @if(api.can('gatehouse')){<ion-button routerLink="/portaria/avisos" fill="outline">Avisar chegada com foto</ion-button>}
    </app-page-header>
    @if(api.can('purchasing','management')){<app-purchase-orders />}
    <div class="agenda-aux">
    @if(api.can('warehouse','purchasing','gatehouse','management')){<app-notifications />}
    <details class="help-box"><summary>Como funciona a agenda?</summary><ul><li>Cada horário tem vagas para até dois caminhões. Carga batida ocupa o horário inteiro.</li><li>Somente Fornecedor agenda. As vagas livres valem para a unidade inteira e não mudam com os filtros.</li><li>A Portaria registra entrada e saída; o Armazém registra cada etapa da descarga.</li><li>A descarga exige aprovação de Compras e confirmação dos destinos. Divergências podem ser encaminhadas a Compras.</li><li>Na visão Dia, “Imprimir dia” gera o relatório completo do dia na origem escolhida, sem rejeitados, cancelados e não recebidos. Os filtros de situação e armazém valem só para a tela e para a planilha.</li>@if(api.user()?.role==='supplier'){<li>Você vê apenas as entregas do seu cadastro.</li>}</ul></details>
    </div>
    @if(error()){<div app-feedback tone="error">{{error()}}</div>}
    <app-schedule-calendar [appointments]="rows()" [warehouses]="warehouses()" [mode]="mode" [busy]="busy()" [canSchedule]="api.user()?.role==='supplier'" (rangeChange)="onRange($event)" />
  </div>`,
  styles: [`
    .agenda-aux { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px 12px; margin-bottom: 16px; }
    .agenda-aux > * { flex: 1 1 280px; min-width: 0; }
    .agenda-aux .help-box { margin: 0; padding-top: 0; }
  `],
})
export class AppointmentList implements OnInit {
  api=inject(Api); private route=inject(ActivatedRoute); private request=0; private controller?:AbortController;
  rows=signal<Appointment[]>([]); warehouses=signal<{id:string;name:string;code?:string}[]>([]); busy=signal(false); error=signal('');
  title='Agenda de recebimento'; subtitle='Consulte reservas e validações no calendário diário, semanal ou mensal.';
  mode:'agenda'|'compras'|'operacao'|'portaria'='agenda';
  ngOnInit(){
    if(this.api.user()?.role==='supplier'){this.title='Minhas entregas';this.subtitle='Escolha um horário livre ou use Agendar entrega.';}
    const mode=this.route.snapshot.data['mode'];
    if(mode==='compras'){this.mode=mode;this.title='Conferência de Compras';this.subtitle='Compare a nota e o pedido antes de registrar a decisão.';}
    if(mode==='operacao'){this.mode=mode;this.title='Operação do armazém';this.subtitle='Acompanhe os destinos, as entradas e saídas e a conferência da carga.';}
    if(mode==='portaria'){this.mode=mode;this.title='Portaria';this.subtitle='Confira documentos, veículo e destinos; registre entrada e saída da unidade.';}
    void this.loadWarehouses();
  }
  private async loadWarehouses(){try{const rows:{id:string;name:string;code?:string}[]=[];let page=1;while(true){const result=await this.api.get<Page<{id:string;name:string;code?:string}>>(`catalog/warehouses/?page=${page}`);rows.push(...result.results);if(!result.next)break;page++;}this.warehouses.set(rows);}catch(e){this.error.set(apiError(e));}}
  async onRange(query:ScheduleRange){
    this.controller?.abort();const controller=this.controller=new AbortController(),request=++this.request;this.rows.set([]);this.busy.set(true);this.error.set('');
    try{const rows:Appointment[]=[];let page=1;while(request===this.request){const params=new URLSearchParams({page:String(page),page_size:'100',date_from:query.from,date_to:query.to});if(query.origin)params.set('origin',query.origin);const result=await this.api.get<Page<Appointment>>(`appointments/?${params}`,controller.signal);rows.push(...result.results);if(!result.next)break;page++;}if(request===this.request)this.rows.set(rows);}
    catch(e){if(request===this.request&&!controller.signal.aborted)this.error.set(apiError(e));}
    finally{if(request===this.request)this.busy.set(false);}
  }
  ngOnDestroy(){this.request++;this.controller?.abort();}
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
    LoadingState, FeedbackState, SlotPicker, ReceiptCheck, AppointmentEdit,
  ],
  template: `<div class="page">
    <app-page-header title="Detalhes do recebimento" subtitle="Documentos, validações e eventos da carga.">
      <a [routerLink]="api.can('gatehouse') ? '/portaria' : '/agenda'">{{ api.can('gatehouse') ? 'Voltar à portaria' : 'Voltar à agenda' }}</a>
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
      <app-origin [value]="item.origin" /><p class="notice">{{nextStep(item)}}</p>@if(item.divergence_reported_at){<div class="notice"><strong>Divergência encaminhada a Compras</strong><p>{{item.divergence_notes}}</p><small>{{dt(item.divergence_reported_at)}}</small></div>}
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
            <dt>Conferência de Compras</dt>
            <dd><app-status [value]="item.purchase_status" /></dd>
          </div>
          <div>
            <dt>Destino no armazém</dt>
            <dd><app-status [value]="item.warehouse_status" /></dd>
          </div>
          <div>
            <dt>Caminhão</dt>
            <dd><app-status [value]="item.operation_status" /></dd>
          </div>
        </dl>
        <dl class="metadata section">
          <div>
            <dt>{{item.workflow_version === 2 ? "Entrada na portaria" : "Chegada legada"}}</dt>
            <dd>{{ dt(item.workflow_version === 2 ? item.gate_checked_in_at : item.arrived_at) }}</dd>
          </div>
          <div>
            <dt>Início de descarga</dt>
            <dd>{{ dt(item.started_at) }}</dd>
          </div>
          <div>
            <dt>{{item.workflow_version === 2 ? "Saída da portaria" : "Conclusão legada"}}</dt>
            <dd>{{ dt(item.workflow_version === 2 ? item.gate_checked_out_at : item.finished_at) }}</dd>
          </div>
          <div>
            <dt>Notas vinculadas</dt>
            <dd>
              {{ invoiceNumbers() }}
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
        @if(api.user()?.role==='supplier'&&(item.purchase_status==='rejected'||['cancelled','not_received'].includes(item.operation_status))){<a class="section" routerLink="/agenda/novo" [queryParams]="{previous_appointment:item.id}">Criar nova solicitação vinculada</a>}
        @if(item.purchase_status==='rejected' && item.comparison_notes){<p class="notice">{{item.comparison_notes}}</p>}
        <h3 class="section">Próximo passo</h3>
        @if(primaryCommand(); as command) {
          <ion-button [disabled]="busy() || !loaded()" (click)="open(command.code, command.visitId)">{{command.label}}</ion-button>
        } @else {<p class="muted">Não há uma etapa operacional disponível para seu perfil neste momento.</p>}
        @if(blockedCommands().length){<details class="section"><summary>Condições para a próxima etapa</summary>@for(command of blockedCommands();track command.code){<p>{{commandLabel(command.code)}}: {{command.reason}}</p>}</details>}
        @if(exceptionCommands().length){<details class="section"><summary>Exceções e correções</summary><div class="actions section">@for(command of exceptionCommands();track command.code){
          @if(command.code==='non-receipt'){<a [routerLink]="['/nao-recebimentos/novo']" [queryParams]="{appointment:item.id}">Registrar não recebimento</a>}
          @else{<ion-button fill="outline" [disabled]="busy() || !loaded()" (click)="open(command.code)">{{commandLabel(command.code)}}</ion-button>}
        }</div></details>}
      </section>
      <app-appointment-edit [appointment]="item" (changed)="load()" (updated)="applyUpdated($event)" /><section class="panel"><h2>Transporte e documentos</h2><dl class="metadata"><div><dt>Veículo / carreta</dt><dd>{{item.vehicle_plate || 'Identificação não confirmada'}}</dd></div><div><dt>Cavalo</dt><dd>{{item.tractor_plate || 'Não informado'}}</dd></div><div><dt>Transportadora</dt><dd>{{item.carrier_name || 'Não informada'}}</dd></div><div><dt>Motorista</dt><dd>{{item.driver_name || 'Não informado'}}</dd></div></dl><details class="section"><summary>Consultar documentos e relatórios</summary><div class="actions section">@for(invoice of invoices();track invoice.id){<button type="button" [attr.aria-pressed]="invoiceData()?.id===invoice.id" (click)="invoiceData.set(invoice)">Consultar NF {{invoice.number}}</button><ion-button fill="outline" [disabled]="busy()" (click)="download(invoice)">Salvar NF {{invoice.number}}</ion-button>}<button type="button" (click)="exportReceipt()">Exportar recebimento</button><button type="button" (click)="printReceipt()">Imprimir recebimento</button></div></details></section>
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
      @if(item.workflow_version === 2 && api.can("warehouse","purchasing")){<app-receipt-check [appointment]="item" [invoices]="invoices()" (changed)="load()" />}
      @if (action()) {
        <form class="panel form-page" [formGroup]="form" (ngSubmit)="execute()">
          <h2>{{ actionTitle() }}</h2>
          @if(action()==='exceptions'){<label>Tipo<select formControlName="exception_kind"><option value="late">Atraso</option><option value="no_show">Ausência</option>@if(api.can('warehouse','purchasing')){<option value="nature">Impedimento por natureza</option><option value="invoice_mismatch">Divergência documental</option>}<option value="other">Outro</option></select></label><label>Descrição<textarea formControlName="notes" required></textarea></label><label>Quando ocorreu<input type="datetime-local" formControlName="occurred_at" /></label><p class="field-help">O registro não aplica multa ou bloqueio automático.</p>}
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
            action() === "gate-check-in" || action() === "gate-check-out" || action() === "correct-time" ||
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
          @if (action() === "finish" || action() === "visit-finish" || action() === "visit-check-out") {
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
          @if(action() === "correct-time") {<div class="form-grid"><label>Marco<select formControlName="target"><option value="gate_check_in">Entrada na portaria</option><option value="gate_check_out">Saída da portaria</option><option value="warehouse_check_in">Entrada no armazém</option><option value="warehouse_check_out">Saída do armazém</option></select></label><label>Etapa do armazém<select formControlName="visit_id"><option value="">Não se aplica à portaria</option>@for(visit of item.visits;track visit.id){<option [value]="visit.id">{{visit.warehouse_name}}</option>}</select></label><label class="wide">Motivo da correção<textarea formControlName="reason" required></textarea></label></div>}
          @if (action() === "cancel" || action() === "forward-to-purchasing") {
            <div class="notice">
              {{action() === "forward-to-purchasing" ? "A reserva será mantida. Compras deverá conferir novamente, seguida da confirmação de destinos pelo Armazém." : "A capacidade ficará retida para decisão do armazém. O cancelamento preserva o histórico."}}
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
              ><app-slot-picker [date]="form.controls.date.value" [packaging]="item.packaging" [exclude]="item.id" [natureException]="true" (selection)="rescheduleSelection($event)" />
              <label class="wide"
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
            <ion-button type="submit" [color]="action() === 'cancel' ? 'danger' : 'primary'" [disabled]="busy() || (action() === 'reschedule' && !rescheduleReady())">
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
                  <th>{{item.workflow_version===2 ? 'Entrada no armazém' : 'Início legado'}}</th>
                  <th>{{item.workflow_version===2 ? 'Saída do armazém' : 'Fim legado'}}</th>
                  <th>Chapas</th>
                  <th><span class="sr-only">Ações da etapa</span></th>
                </tr>
              </thead>
              <tbody>
                @for (v of item.visits; track v.id) {
                  <tr>
                    <td><strong class="table-cell-primary">{{ v.warehouse_name }}</strong></td>
                    <td>{{ dt(v.checked_in_at || v.started_at) }}</td>
                    <td>{{ dt(v.checked_out_at || v.finished_at) }}</td>
                    <td>{{ v.worker_count ?? "Não registrado" }}</td>
                    <td>
                      @if(api.can('warehouse')){@for(command of v.available_actions || [];track command.code){@if(command.allowed){<ion-button size="small" fill="outline" [disabled]="busy()" (click)="open('visit-' + command.code,v.id)">{{commandLabel('visit-' + command.code)}}</ion-button>}@else if(!v.checked_out_at && !v.finished_at && command.reason){<small class="field-help">{{command.reason}}</small>}}}
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
      @if(item.exceptions?.length){<section class="panel"><h2>Exceções registradas</h2>@for(exception of item.exceptions;track exception.id){<p><strong>{{exceptionLabel(exception.kind)}}</strong> · {{dt(exception.occurred_at)}}</p><p>{{exception.description}}</p>}</section>}
      <details class="panel"><summary>Assinaturas de conferência</summary>
        @if(signaturesError()){<p class="error">{{signaturesError()}}</p>}
        @for(signature of signatures();track signature.id){<section class="section"><strong>{{signature.signer_name}}</strong><p>{{dt(signature.signed_at)}} · Revisão {{signature.appointment_revision}} · {{signature.current_revision?'Versão atual':'Versão anterior'}}</p><p>{{signature.declaration}}</p><p class="field-help">Identificador do documento: {{signature.manifest_sha256}}</p></section>}
        @if(!signatures().length && !signaturesError()){<p>Sem assinatura registrada.</p>}
      </details>
      <details class="panel history-panel">
        <summary><h2>Histórico de decisões</h2></summary>
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
                  @if(e.recorded_at){<span>Lançado em {{dt(e.recorded_at)}}</span>}
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
      </details>
    }
  </div>`,
})
export class AppointmentDetail implements OnInit {
  signatures = signal<ReceiptSignature[]>([]);
  signaturesError = signal('');
  decimal = decimal;
  api = inject(Api);
  catalog = inject(Catalog);
  private route = inject(ActivatedRoute);
  private fb = inject(FormBuilder);
  a = signal<Appointment | null>(null);
  invoiceData = signal<InvoiceData | null>(null);
  invoices = signal<InvoiceData[]>([]);
  rescheduleReady = signal(false);
  private reschedulePicker = viewChild(SlotPicker);
  loaded = signal(false);
  private idempotencyKey = "";
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
  private readonly operationalCodes = ['gate-check-in','gate-check-out','purchase-review','warehouse-review','arrive','start','finish'];
  private readonly exceptionalCodes = ['forward-to-purchasing','non-receipt','cancel','reschedule','assign-cancelled','correct-time','exceptions'];
  primaryCommand(): {code:string;label:string;visitId:string} | undefined {
    const item=this.a();
    if(!item)return;
    const visit=item.visits.flatMap(v=>(v.available_actions??[]).filter(c=>c.allowed).map(c=>({code:'visit-'+c.code,label:this.commandLabel('visit-'+c.code)+' · '+v.warehouse_name,visitId:v.id})))[0];
    if(visit && this.api.can('warehouse'))return visit;
    const command=this.operationalCodes.map(code=>item.available_actions?.find(c=>c.code===code&&c.allowed)).find(Boolean);
    return command ? {code:command.code,label:this.commandLabel(command.code),visitId:''} : undefined;
  }
  exceptionCommands(){return (this.a()?.available_actions??[]).filter(c=>c.allowed&&this.exceptionalCodes.includes(c.code));}
  blockedCommands(){
    const item=this.a();if(!item||['completed','cancelled','not_received'].includes(item.operation_status))return [];
    const own=this.api.can('gatehouse')?['gate-check-in','gate-check-out']:this.api.can('warehouse')?['warehouse-review','arrive','start','finish']:this.api.can('purchasing')?['purchase-review']:[];
    return (item.available_actions??[]).filter(c=>!c.allowed&&c.reason&&own.includes(c.code));
  }
  nextStep(item:Appointment){
    if(item.workflow_version===2&&item.gate_checked_in_at&&!item.gate_checked_out_at&&['completed','not_received','cancelled'].includes(item.operation_status))return 'A operação está encerrada. Falta registrar a saída do veículo na Portaria.';
    if(item.gate_checked_out_at)return 'Veículo saiu da unidade; consulte os documentos e o histórico.';
    if(item.divergence_reported_at)return 'Compras deve conferir a divergência; depois o Armazém confirma os destinos novamente.';
    if(item.operation_status==='in_progress')return 'Descarga em andamento. Registre cada etapa e confira as quantidades antes de concluir.';
    if(['cancelled','not_received','completed'].includes(item.operation_status))return 'Operação encerrada. Consulte o histórico.';
    if(item.purchase_status==='rejected')return 'Nota rejeitada por Compras. Consulte o motivo e solicite a correção.';
    if(item.purchase_status!=='approved')return 'Aguardando conferência de Compras. A Portaria pode registrar a chegada.';
    if(item.warehouse_status!=='approved')return 'O Armazém deve confirmar os destinos antes da descarga.';
    return item.gate_checked_in_at||item.arrived_at?'Liberações registradas. O Armazém pode iniciar a etapa disponível.':'Aguardando chegada do caminhão à Portaria.';
  }
  invoiceNumbers(){return this.invoices().map(i=>i.number).join(', ')||this.a()?.invoice_number||'Número não informado';}
  printReceipt(){window.print();}
  exportReceipt(){const item=this.a();if(!item)return;exportCsv(`recebimento-${item.id}.csv`,[
    ['Recebimento','Fornecedor','Veículo / carreta','Cavalo','Transportadora','Origem','Notas','Entrada portaria','Saída portaria'],
    [item.id,item.supplier_name,item.vehicle_plate,item.tractor_plate,item.carrier_name,item.origin,this.invoiceNumbers(),item.gate_checked_in_at,item.gate_checked_out_at],
    [],['Armazém','Entrada','Saída'],...item.visits.map(v=>[v.warehouse_name,v.checked_in_at||v.started_at,v.checked_out_at||v.finished_at]),
    [],['Evento','Ocorrido em','Lançado em','Responsável'],...item.events.map(e=>[this.eventName(e.kind||e.action||e.event_type),e.occurred_at,e.recorded_at||e.created_at,e.actor_name])]);}
  form = this.fb.nonNullable.group({
    decision: ["pending"],
    order_reference: [""],
    notes: [""],
    occurred_at: [nowLocal()],
    worker_count: [0],
    resources_confirmed: [false],
    reason: [""],
    date: [today()],
    time: [""],
    exception_kind:["late"],
    target_appointment: [""],
    hold_id: [""],
    target: ["gate_check_in"],
    visit_id: [""],
  });
  async ngOnInit() {
    try{if(this.api.can("warehouse","purchasing","management"))await this.catalog.load();await this.load();this.loaded.set(true);}catch(e){this.error.set(apiError(e));}
  }
  async load() {
    this.busy.set(true);
    try {
      this.a.set(
        await this.api.get<Appointment>(
          `appointments/${this.route.snapshot.paramMap.get("id")}/`,
        ),
      );
      const item=this.a()!;
      const invoices=item.invoices?.length ? item.invoices : item.invoice ? [await this.api.get<InvoiceData>(`invoices/${item.invoice}/`)] : [];
      this.invoices.set(invoices);this.invoiceData.set(invoices[0]??null);
      this.signatures.set([]);this.signaturesError.set('');
      try { this.signatures.set((await this.api.get<{results:ReceiptSignature[]}>(`appointments/${item.id}/signatures/`)).results); }
      catch(e) { this.signaturesError.set(apiError(e)); }
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
  open(action: string, visitId = "") {
    const commands = visitId ? this.a()?.visits.find(visit=>visit.id===visitId)?.available_actions : this.a()?.available_actions;
    if(!this.loaded()||!allowed(commands,visitId?action.replace('visit-',''):action)) return;
    this.idempotencyKey=crypto.randomUUID();this.rescheduleReady.set(false);
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
  applyUpdated(item:Appointment){const selected=this.invoiceData()?.id;this.a.set(item);this.invoices.set(item.invoices??[]);this.invoiceData.set(item.invoices?.find(invoice=>invoice.id===selected)??item.invoices?.[0]??null);}
  rescheduleSelection(value:{time:string;ready:boolean}){this.form.controls.time.setValue(value.time);this.rescheduleReady.set(value.ready);}
  commandLabel(code:string){return ({'forward-to-purchasing':'Encaminhar para Compras',exceptions:'Registrar exceção',edit:'Corrigir documentos e transporte','gate-check-in':'Registrar entrada na portaria','gate-check-out':'Registrar saída da portaria','visit-check-in':'Registrar entrada no armazém','visit-check-out':'Registrar saída do armazém','correct-time':'Corrigir horário com motivo','purchase-review':'Conferir notas / pedido','warehouse-review':'Confirmar destinos',arrive:'Registrar chegada legada',start:'Iniciar recebimento legado',finish:'Concluir recebimento legado',cancel:'Cancelar agendamento',reschedule:'Postergar por natureza','assign-cancelled':'Atribuir vaga retida','visit-start':'Iniciar etapa legada','visit-finish':'Concluir etapa legada'} as Record<string,string>)[code]??code;}
  actionTitle() {return this.commandLabel(this.action());}
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
          gate_check_in: "Entrada na portaria",
          gate_check_out: "Saída da portaria",
          warehouse_check_in: "Entrada no armazém",
          warehouse_check_out: "Saída do armazém",
          time_corrected: "Horário corrigido com justificativa",
          receipt_line_recorded: "Conferência física registrada",
          receipt_line_reviewed: "Decisão sobre divergência",
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
          forwarded_to_purchasing: "Divergência encaminhada a Compras",
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
                  this.catalog.warehouses().find((w) => w.id === id)?.name ?? this.a()?.visits.find(v=>v.warehouse===id)?.warehouse_name ??
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
  async download(selected?: InvoiceData) {
    this.busy.set(true);
    this.error.set("");
    this.success.set("");
    try {
      const invoice = selected ??
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
    if(this.busy()||!this.loaded())return;
    this.busy.set(true);
    this.error.set("");
    this.success.set("");
    const v = this.form.getRawValue(),
      act = this.action();
    let body: unknown = {};
    let endpoint = `appointments/${this.a()?.id}/${act}/`;
    try {
      if(act==='forward-to-purchasing'){if(!v.reason.trim())throw new Error("Descreva a divergência.");body={reason:v.reason};}
      if(act==='exceptions'){if(!v.notes.trim())throw new Error('Descreva a exceção.');body={kind:v.exception_kind,description:v.notes,occurred_at:localTimestamp(v.occurred_at)};}
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
        ["gate-check-in","gate-check-out","visit-check-in","visit-check-out","arrive", "start", "finish", "visit-start", "visit-finish"].includes(
          act,
        )
      ) {
        body = { occurred_at: localTimestamp(v.occurred_at) };
        if (act.startsWith("visit-"))
          endpoint = `warehouse-visits/${this.visitId}/${act.replace("visit-", "")}/`;
        if (act === "finish" || act === "visit-finish" || act === "visit-check-out") {
          if (!v.resources_confirmed)
            throw new Error("Confirme os recursos, inclusive zero/nenhum.");
          if(!/^\d+$/.test(String(v.worker_count))||Number(v.worker_count)>100)throw new Error('Confirme a quantidade inteira de pessoas, inclusive zero.');
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
      if(act==='reschedule' && !this.rescheduleReady()) throw new Error('Selecione um horário elegível.');
      if(act==='correct-time'){if(!v.reason.trim())throw new Error('Informe o motivo da correção.');body={target:v.target,visit_id:v.visit_id||undefined,occurred_at:localTimestamp(v.occurred_at),reason:v.reason};}
      await this.api.post(endpoint, {
        idempotency_key:this.idempotencyKey,
        ...(body as object),
        expected_revision:
          act === "assign-cancelled"
            ? this.candidates().find((a) => a.id === v.target_appointment)
                ?.revision
            : this.a()?.revision,
      });
      this.action.set("");
      await this.load();
      this.success.set(`${this.commandLabel(act)}: registro salvo no servidor.`);
    } catch (e) {
      this.error.set(apiError(e));
      if(act === 'reschedule' && e instanceof HttpErrorResponse && e.status === 409){
        this.rescheduleReady.set(false);
        // Keep the date and reason while reloading the server revision and capacity.
        await this.load();
        this.reschedulePicker()?.refresh();
      }
    } finally {
      this.busy.set(false);
    }
  }
  exceptionLabel(value:string){return ({late:'Atraso',no_show:'Ausência',nature:'Impedimento por natureza',invoice_mismatch:'Divergência documental',other:'Outra ocorrência'} as Record<string,string>)[value]??value;}

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
    <form class="panel" [formGroup]="form" (ngSubmit)="save()"><fieldset [disabled]="busy() || !loaded()">
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
    </fieldset></form>
  </div>`,
})
export class NonReceiptCreate implements OnInit {
  loaded = signal(false);
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
  });
  async ngOnInit() {
    this.form.controls.appointment.setValue(
      this.route.snapshot.queryParamMap.get("appointment") ?? "",
    );
    try {
      const [, rows] = await Promise.all([this.catalog.load(), appointmentOptions(this.api)]);
      this.candidates.set(rows.filter(a => allowed(a.available_actions, 'non-receipt')));
      this.appointmentChanged();
      this.loaded.set(true);
    } catch(e) { this.error.set(apiError(e)); }
  }
  async save() {
    if (!this.loaded() || this.busy() || this.form.invalid) return;
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
      this.form.patchValue({ supplier: a.supplier });
    }
  }
}
