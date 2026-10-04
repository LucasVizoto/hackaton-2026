import { DatePipe } from "@angular/common";
import { Component, DestroyRef, inject, OnInit, signal } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import {
  FormArray,
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { Capacitor } from "@capacitor/core";
import { IonButton, IonSpinner } from "@ionic/angular/standalone";
import { debounceTime } from "rxjs";
import {
  Api,
  apiError,
  money,
  originLabel,
  Page,
  previousDay,
} from "../core/api";
import { Catalog } from "../core/catalog";
import { IndividualAllocation, RuleOccurrence } from "../core/labor-v2";
import { lineAmount, lineQuantity } from "../core/money-line";
import { exportCsv, quantity } from "../core/workflow";
import { ProductionRecords, ProductionRecord } from "./production-records";
import { LaborPayroll } from "./labor-payroll";
import { decimal, occurrenceLabel } from "../core/presentation";
import { openBulletinPdf, type BulletinPrintInput } from "./bulletin-print";
import {
  EmptyState,
  FeedbackState,
  FilterBlock,
  LoadingState,
  Origin,
  PageHeader,
  Status,
} from "../shared/ui";
interface Line {
  warehouse?: string;
  warehouse_name?: string;
  category: string;
  label?: string;
  price?: string;
  unloading: string;
  removal: string;
  transfer: string;
}
interface Participant {
  worker: string;
  registration?: string;
  name?: string;
  fraction: string;
}
export interface Calculation {
  resumo?: {producaoTotal:string;diariasEquivalentes:string;valorPorDiariaApurado:string|null;totalAPagar:string;complemento:string;valorFinalPorDiariaCompleta:string|null};
  individual_allocations?: IndividualAllocation[];
  provisional?: boolean;
  status?: string;
  allocation_status?: string;
  people_count: number;
  equivalent_days: string;
  production: string;
  floor_per_day: string;
  collective_floor: string;
  total_payable: string;
  supplement: string;
  production_per_equivalent_day: string | null;
  display: { production: string; total_payable: string; supplement: string };
  warehouse_costs?: { unattributed: boolean; warehouses: { warehouse: string; share: string; display: { production: string; total_payable: string; supplement: string } }[] };
  tariff_table?: { id: string | null; valid_from: string | null };
}
export interface Adjustment { id: string; worker: string; registration: string; name: string; reference_date: string; kind: string; kind_label: string; amount: string; reason: string; created_by: string; created_at: string; }
interface BulletinAudit {id:string;revision:number;reason:string;recorded_at:string;actor:number|null;snapshot:{status?:string;financial_version?:string};}
export interface Bulletin {
  id: string;
  warehouse: string | null;
  scope?: "day" | "warehouse";
  adjustments?: Adjustment[];
  warehouse_name: string;
  reference_date: string;
  origin: string;
  status: string;
  revision: number;
  financial_version?: string;
  production_records?: ProductionRecord[];
  daily_services?: {kind:string;quantity:string}[];
  individual_allocations?: IndividualAllocation[];
  unresolved_occurrences?: RuleOccurrence[];
  allocation_status?: string;
  lines: Line[];
  participants: Participant[];
  calculation: Calculation;
  history?: { action: string; created_at: string; reason: string }[];
}
@Component({
  standalone: true,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    IonButton,
    EmptyState,
    FeedbackState,
    FilterBlock,
    LoadingState,
    PageHeader,
    Status,
    LaborPayroll,
  ],
  styles: [`
    .view-tabs { display: inline-flex; gap: 4px; padding: 4px; margin-bottom: 16px; border: 1px solid var(--line); border-radius: var(--radius-full); background: var(--surface); }
    .view-tabs button { min-height: 44px; padding: 0 18px; border: 0; border-radius: var(--radius-full); background: transparent; color: var(--muted); font: inherit; font-weight: 600; cursor: pointer; }
    .view-tabs button[aria-selected="true"] { background: var(--green); color: var(--brand-contrast); }
  `],
  template: `<div class="page">
    <app-page-header
      title="Boletins diários"
      subtitle="Um boletim por dia para toda a equipe: produção por armazém, cada chapa uma vez e pagamento pela produção com piso garantido."
    >
      <div actions class="actions">
        @if (api.can("warehouse")) {
          <ion-button routerLink="/boletins/novo">Novo boletim</ion-button>
        }
      </div>
    </app-page-header>
    <div class="view-tabs" role="tablist" aria-label="Visão dos boletins">
      <button type="button" role="tab" [attr.aria-selected]="view() === 'dias'" (click)="setView('dias')">Por dia</button>
      <button type="button" role="tab" [attr.aria-selected]="view() === 'quinzena'" (click)="setView('quinzena')">Quinzena (acerto)</button>
    </div>
    @if (view() === "quinzena") {
      <app-labor-payroll [embedded]="true" />
    } @else {
    <form
      app-filter-block
      class="filters"
      aria-label="Filtrar boletins"
      [formGroup]="filters"
      (ngSubmit)="load(true)"
    >
      <label
        >Armazém com produção<select formControlName="warehouse">
          <option value="">Todos os armazéns</option>
          @for (w of catalog.warehouses(); track w.id) {
            <option [value]="w.id">{{ w.name }}</option>
          }
        </select></label
      ><label>De<input type="date" formControlName="date_from" /></label
      ><label>Até<input type="date" formControlName="date_to" /></label
      ><label
        >Origem<select formControlName="origin">
          <option value="">Todas</option>
          <option value="operacional_registrado">Operação registrada</option>
          <option value="demo_sintetico">Demonstração sintética</option>
        </select></label
      ><ion-button type="submit" fill="outline" [disabled]="busy()"
        >Atualizar</ion-button
      >
    </form>
    @if (error()) {
      <div app-feedback tone="error" class="error">{{ error() }}</div>
    }
    @if (busy()) {
      <app-loading-state label="Carregando boletins…" />
    } @else if (rows().length) {
      <div
        class="table-wrap"
        tabindex="0"
        role="region"
        aria-label="Boletins diários, locais, referências e valores"
      >
        <table>
          <thead>
            <tr>
              <th>Local / referência</th>
              <th>Origem</th>
              <th>Estado</th>
              <th class="numeric">Pessoas</th>
              <th class="numeric">Diárias</th>
              <th class="numeric">Produção</th>
              <th class="numeric">Total a pagar</th>
              <th class="numeric">Complemento</th>
              <th><span class="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            @for (b of rows(); track b.id) {
              <tr>
                <td class="wrap">
                  <strong>{{ b.warehouse_name }}</strong><br />
                  <span class="muted">{{ b.reference_date | date: "dd/MM/yyyy" }}</span>
                </td>
                <td class="wrap">{{ origin(b.origin) }}</td>
                <td><app-status [value]="b.status" /></td>
                <td class="numeric">{{ decimal(b.calculation.people_count) }}</td>
                <td class="numeric">{{ decimal(b.calculation.equivalent_days) }}</td>
                <td class="numeric">{{ money(b.calculation.production) }}</td>
                <td class="numeric">
                  <strong>{{b.calculation.provisional?"Pendente de conferência":money(b.calculation.total_payable)}}</strong>
                </td>
                <td class="numeric">{{ money(b.calculation.supplement) }}</td>
                <td>
                  <a
                    [routerLink]="['/boletins', b.id]"
                    [attr.aria-label]="'Abrir boletim de ' + b.warehouse_name + ', referência ' + (b.reference_date | date: 'dd/MM/yyyy')"
                    >Abrir boletim</a
                  >
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    } @else {
      <div app-empty-state class="empty">
        <h2>Nenhum boletim encontrado</h2>
        <p>Confira o local, as datas e a origem selecionados nos filtros.</p>
        @if (api.can("warehouse")) {
          <ion-button routerLink="/boletins/novo" fill="outline">Criar boletim</ion-button>
        }
      </div>
    }
    @if (count() > 0) {
      <div class="pagination">
        <ion-button
          fill="outline"
          (click)="change(-1)"
          [disabled]="page === 1 || busy()"
          >Anterior</ion-button
        ><span>Página {{ page }} · {{ count() }} boletins</span
        ><ion-button
          fill="outline"
          (click)="change(1)"
          [disabled]="page * 100 >= count() || busy()"
          >Próxima</ion-button
        >
      </div>
    }
    <p class="site-note">
      Valores da apuração oficial. Complemento indica produção abaixo do
      piso; sozinho não comprova ociosidade.
    </p>
    }
  </div>`,
})
export class BulletinList implements OnInit {
  api = inject(Api);
  catalog = inject(Catalog);
  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  view = signal<"dias" | "quinzena">(this.route.snapshot.queryParamMap.get("visao") === "quinzena" ? "quinzena" : "dias");
  setView(view: "dias" | "quinzena") {
    this.view.set(view);
    void this.router.navigate([], { queryParams: { visao: view === "quinzena" ? "quinzena" : null }, queryParamsHandling: "merge", replaceUrl: true });
  }
  filters = this.fb.nonNullable.group({
    warehouse: [""],
    date_from: [""],
    date_to: [""],
    origin: [""],
  });
  rows = signal<Bulletin[]>([]);
  count = signal(0);
  page = 1;
  error = signal("");
  busy = signal(false);
  money = money;
  decimal = decimal;
  occurrenceLabel = occurrenceLabel;
  origin = originLabel;
  ngOnInit() {
    void this.catalog.load().catch((e) => this.error.set(apiError(e)));
    void this.load();
  }
  change(n: number) {
    this.page += n;
    void this.load();
  }
  async load(resetPage = false) {
    if (resetPage) this.page = 1;
    this.busy.set(true);
    this.error.set("");
    try {
      const q = new URLSearchParams({
        page_size: "100",
        page: String(this.page),
      });
      Object.entries(this.filters.getRawValue()).forEach(([k, v]) => {
        if (v) q.set(k, v);
      });
      const r = await this.api.get<Page<Bulletin>>(`bulletins/?${q}`);
      this.rows.set(r.results);
      this.count.set(r.count);
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
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    IonButton,
    IonSpinner,
    ProductionRecords,
    FeedbackState,
    Status,
    Origin,
    PageHeader,
    LoadingState,
  ],
  template: `<div class="page" [attr.aria-busy]="busy()">
    <app-page-header
      [title]="bulletin() ? 'Boletim diário' : 'Novo boletim'"
      subtitle="Registre a produção, confirme a equipe e confira a apuração."
    >
      <div actions class="actions"><ion-button fill="outline" [disabled]="!bulletin()" (click)="exportRecord()">Exportar registro</ion-button><ion-button fill="outline" (click)="printBulletin()" [disabled]="!canPrint()">Imprimir</ion-button><ion-button fill="outline" routerLink="/boletins">Voltar aos boletins</ion-button></div>
    </app-page-header>
    @if (error()) {
      <div app-feedback tone="error" class="error">{{ error() }}</div>
    }
    @if (success()) {
      <div app-feedback tone="success" class="success">{{ success() }}</div>
    }
    <app-origin [value]="displayOrigin()" />
    @if(legacy()){<div class="notice">Boletim legado · somente consulta. Valores e histórico foram preservados; este registro não admite edição, reabertura ou transferência pela versão atual.</div>}
    @if (bulletin(); as b) {
      <div class="actions record-context">
        <app-status [value]="b.status" /><span class="muted"
          >Revisão {{ b.revision }} · {{ b.warehouse_name }} ·
          {{ b.reference_date | date: "dd/MM/yyyy" }}</span
        >
      </div>
    }
    @if (busy() && !lines.length) {
      <app-loading-state label="Carregando referência, categorias e equipe…" />
    }
    <form [formGroup]="form" (ngSubmit)="save()"><fieldset [disabled]="busy() || !loaded() || legacy()">
      <section class="panel">
        <h2>Referência</h2>
        <div class="form-grid">
          @if (!daily()) {<label
            >Armazém<select formControlName="warehouse">
              <option value="">Selecione</option>
              @for (w of catalog.warehouses(); track w.id) {
                <option [value]="w.id">{{ w.name }}</option>
              }
            </select></label
          >}<label
            >Data de referência<input
              type="date"
              formControlName="reference_date"
            /><span class="field-help"
              >Normalmente o dia anterior; boletim de atividade interna pode
              referir sábado.</span
            ></label
          >@if (daily()) {<p class="field-help">Boletim único do dia (decisão da Cocapec de 03/10/2026): a equipe entra uma vez, mesmo trabalhando em vários armazéns. O custo é dividido entre os armazéns pela participação na produção.</p>} @else {<p class="field-help">Boletim por armazém do modelo anterior. A origem acompanha os cadastros da equipe e é validada pelo servidor.</p>}
        </div>
        @if (!bulletin() && !closed()) {
          <details>
            <summary>Reproduzir quantidades do exemplo oficial</summary>
            <p class="muted">
              Preenche fertilizante, agroquímico e serviços diversos. A equipe não entra aqui: ela vem da escala da data.
            </p>
            <div class="actions">
              <ion-button fill="outline" type="button" (click)="example()"
                >Preencher quantidades do exemplo</ion-button
              >
            </div>
          </details>
        }
      </section>
      <section class="panel">
        <h2>Produção por categoria</h2>
        <p class="muted">
          Informe as quantidades de descarga (fornecedor), remoção (cooperado) e transferência (entre armazéns).
          A quantidade total é a soma das três. O total da linha é essa quantidade vezes a tarifa. O piso usa a soma exata, em centavos na apuração.
          {{ daily() ? "Lance por armazém onde a equipe trabalhou. As tarifas seguem a tabela vigente na data." : "As tarifas oficiais acompanham cada categoria." }}
        </p>
        @if (daily()) {
          <fieldset class="section" [disabled]="closed() || !api.can('warehouse')"><legend>Armazéns onde a equipe trabalhou</legend><div class="actions">@for (w of catalog.warehouses(); track w.id) {<label class="check"><input type="checkbox" [checked]="selected().includes(w.id)" (change)="toggleWarehouse(w.id)" />{{ w.name }}</label>}</div></fieldset>
          @for (wid of selected(); track wid) {
            <h3 class="section">{{ warehouseName(wid) }}</h3>
            <div class="table-wrap" formArrayName="lines" tabindex="0" role="region" [attr.aria-label]="'Produção em ' + warehouseName(wid) + ', com quantidade total e valor da linha'">
              <table><thead><tr><th>Categoria</th><th class="numeric">Tarifa (R$)</th><th class="numeric">Descarga</th><th class="numeric">Remoção</th><th class="numeric">Transferência</th><th class="numeric">Qtd. total</th><th class="numeric">Total R$</th></tr></thead>
                <tbody>@for (row of lines.controls; track row; let i = $index) { @if (row.controls.warehouse.value === wid) {<tr [formGroupName]="i">
                  <td class="wrap">{{ rateLabel(row.controls.category.value) }}</td><td class="numeric">{{ decimal(ratePrice(row.controls.category.value, wid)) }}</td>
                  <td><input class="table-input" type="text" inputmode="decimal" formControlName="unloading" [attr.aria-label]="'Descarga ' + rateLabel(row.controls.category.value) + ' em ' + warehouseName(wid)" /></td>
                  <td><input class="table-input" type="text" inputmode="decimal" formControlName="removal" [attr.aria-label]="'Remoção ' + rateLabel(row.controls.category.value) + ' em ' + warehouseName(wid)" /></td>
                  <td><input class="table-input" type="text" inputmode="decimal" formControlName="transfer" [attr.aria-label]="'Transferência ' + rateLabel(row.controls.category.value) + ' em ' + warehouseName(wid)" /></td>
                  <td class="numeric">{{ lineQtyLabel(row) }}</td>
                  <td class="numeric">{{ lineAmountLabel(row, wid) }}</td>
                </tr>} }</tbody></table>
            </div>
          } @empty { <p class="muted">Nenhum armazém selecionado. Sábado de organização interna pode fechar sem produção: paga-se o piso das pessoas presentes e o custo fica não atribuído.</p> }
        } @else {
        <div
          class="table-wrap"
          formArrayName="lines"
          tabindex="0"
          role="region"
          aria-label="Produção por categoria, descarga, remoção, transferência, quantidade total e valor da linha"
        >
          <table>
            <thead>
              <tr>
                <th>Categoria</th>
                <th class="numeric">Tarifa (R$)</th>
                <th class="numeric">Descarga</th>
                <th class="numeric">Remoção</th>
                <th class="numeric">Transferência</th>
                <th class="numeric">Qtd. total</th>
                <th class="numeric">Total R$</th>
              </tr>
            </thead>
            <tbody>
              @for (row of lines.controls; track row; let i = $index) {
                <tr [formGroupName]="i">
                  <td class="wrap">
                    {{ rateLabel(row.controls.category.value) }}
                  </td>
                  <td class="numeric">
                    {{ decimal(ratePrice(row.controls.category.value)) }}
                  </td>
                  <td>
                    <input
                      class="table-input"
                      type="text"
                      inputmode="decimal"
                      min="0"
                      step="0.0001"
                      formControlName="unloading"
                      [attr.aria-label]="
                        'Descarga ' + rateLabel(row.controls.category.value)
                      "
                    />
                  </td>
                  <td>
                    <input
                      class="table-input"
                      type="text"
                      inputmode="decimal"
                      min="0"
                      step="0.0001"
                      formControlName="removal"
                      [attr.aria-label]="
                        'Remoção ' + rateLabel(row.controls.category.value)
                      "
                    />
                  </td>
                  <td>
                    <input
                      class="table-input"
                      type="text"
                      inputmode="decimal"
                      min="0"
                      step="0.0001"
                      formControlName="transfer"
                      [attr.aria-label]="
                        'Transferência ' +
                        rateLabel(row.controls.category.value)
                      "
                    />
                  </td>
                  <td class="numeric">{{ lineQtyLabel(row) }}</td>
                  <td class="numeric">{{ lineAmountLabel(row) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        }
      </section>
      @if(!legacy() && !daily()){<section class="panel">
        <h2>Serviços de diária</h2>
        <p class="muted">Serviços tarifados adicionais às categorias de produção. Estas quantidades não alteram a equipe ou a fração de participação no piso.</p>
        <div class="form-grid">
          <label>Diária completa · R$ 90,1731<input type="text" inputmode="decimal" formControlName="daily_full" required /></label>
          <label>Meia diária · R$ 45,0786<input type="text" inputmode="decimal" formControlName="daily_half" required /></label>
        </div>
      </section>}
      <section class="panel">
        <div class="page-head">
          <div>
            <h2>Equipe participante</h2>
            <p class="muted">
              Até 20 chapas, cada matrícula uma vez, em diária completa. Puxe a escala da data: quem faltou não entra.
            </p>
          </div>
          @if (!closed() && !legacy() && api.can("warehouse")) {
            @if (daily()) {<ion-button type="button" fill="outline" (click)="fillFromRoster(true)" [disabled]="busy()">Puxar chapas da escala</ion-button>}
            <ion-button
              type="button"
              fill="outline"
              (click)="addParticipant()"
              [disabled]="participants.length >= 20"
              >Inserir chapa</ion-button
            >
          }
        </div>
        @if (rosterNote()) { <p class="field-help" role="status">{{ rosterNote() }}</p> }
        @if (participants.length) {
          <div
            class="table-wrap"
            formArrayName="participants"
            tabindex="0"
            role="region"
            aria-label="Equipe participante por matrícula"
          >
            <table>
              <thead>
                <tr>
                  <th>Matrícula / nome</th>
                  @if (!daily()) { <th>Fração</th> }
                  <th><span class="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                @for (p of participants.controls; track p; let i = $index) {
                  <tr [formGroupName]="i">
                    <td>
                      @if (p.controls.worker.value) {
                        <button type="button" class="worker-name" (click)="openWorker(p.controls.worker.value)">{{ workerLabel(p.controls.worker.value) }}</button>
                      } @else {
                      <select
                        formControlName="worker"
                        [attr.aria-label]="'Participante ' + (i + 1)"
                      >
                        <option value="">Selecione a matrícula</option>
                        @for (w of catalog.workers(); track w.id) {
                          <option [value]="w.id">
                            {{ w.registration }} · {{ w.name
                            }}{{
                              w.origin === "demo_sintetico"
                                ? " (sintético)"
                                : ""
                            }}
                          </option>
                        }
                      </select>
                      }
                    </td>
                    @if (!daily()) {
                    <td>
                      <select
                        formControlName="fraction"
                        [attr.aria-label]="'Fração participante ' + (i + 1)"
                      >
                        <option value="1.0">1 diária</option>
                        <option value="0.5">0,5 diária</option>
                      </select>
                    </td>
                    }
                    <td>
                      @if (!closed() && !legacy() && api.can("warehouse")) {
                        <button
                          class="remove"
                          type="button"
                          (click)="removeParticipant(i)"
                          [attr.aria-label]="'Remover participante ' + (i + 1)"
                        >
                          Remover
                        </button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <p class="muted">
            Ninguém escalado nesta data. Insira os chapas que entram neste boletim.
          </p>
        }
        <p class="site-note">
          Cada chapa entra com uma diária completa. Presença e hora extra continuam no registro de Pessoas e não alteram esta lista.
        </p>
      </section>
      <section class="panel">
        <div class="page-head">
          <div>
            <h2>{{pendingCalculation()?"Prévia pendente de conferência":legacy()?"Apuração preservada":closed()?"Apuração oficial":"Prévia de apuração"}}</h2>
            <p class="muted">
              {{pendingCalculation()?"Existe uma regra pendente. Os valores são estimativas e não autorizam pagamento ou fechamento.":"Total a pagar = maior valor entre produção e piso coletivo."}}
            </p>
          </div>
          @if (!closed() && !legacy() && api.can("warehouse")) {
            <ion-button
              type="button"
              fill="outline"
              (click)="preview()"
              [disabled]="busy() || form.invalid"
              >Calcular prévia</ion-button
            >
          }
        </div>
        @if (previewing()) { <p class="field-help" role="status">Atualizando a prévia…</p> }
        @if (previewHold()) { <p class="field-help" role="status">{{ previewHold() }}</p> }
        @if (calculation(); as c) {
          <div class="financial-summary" aria-live="polite">
            <div class="financial-total">
              <span>{{pendingCalculation()?"Total estimado":"Total a pagar"}}</span>
              <strong>{{ money(c.total_payable) }}</strong>
              <p class="field-help">
                {{ pendingCalculation()?"Estimativa provisória; aguarda resolução documentada da regra.":legacy()?"Apuração do registro legado, sem atribuição individual retroativa.":closed() ? "Valor preservado no boletim fechado." : "Confira a prévia antes de fechar o boletim." }}
              </p>
            </div>
            <dl class="metadata">
              <div><dt>Produção</dt><dd>{{ money(c.production) }}</dd></div>
              <div><dt>Piso coletivo</dt><dd>{{ money(c.collective_floor) }}</dd></div>
              <div><dt>{{pendingCalculation()?"Complemento estimado":"Complemento"}}</dt><dd>{{ money(c.supplement) }}</dd></div>
              <div><dt>Pessoas distintas</dt><dd>{{ decimal(c.people_count) }}</dd></div>
              <div><dt>Diárias equivalentes</dt><dd>{{ decimal(c.equivalent_days) }}</dd></div>
              <div><dt>Piso por diária</dt><dd>{{ money(c.floor_per_day) }}</dd></div>
              <div><dt>Produção por diária equivalente</dt><dd>{{ money(c.production_per_equivalent_day) }}</dd></div>
              @if(c.resumo){<div><dt>Valor final por diária completa</dt><dd>{{ money(c.resumo.valorFinalPorDiariaCompleta) }}</dd></div>}
            </dl>
          </div>
          @if (c.warehouse_costs; as split) {
            <h3 class="section">Custo por armazém</h3>
            <div class="table-wrap" tabindex="0" role="region" aria-label="Custo do dia por armazém"><table><thead><tr><th>Armazém</th><th class="numeric">Participação</th><th class="numeric">Produção</th><th class="numeric">Complemento</th><th class="numeric">Custo</th></tr></thead>
              <tbody>@for (row of split.warehouses; track row.warehouse) {<tr><td>{{ row.warehouse === "NAO_ATRIBUIDO" ? "Não atribuído" : warehouseByCode(row.warehouse) }}</td><td class="numeric">{{ percent(row.share) }}</td><td class="numeric">{{ money(row.display.production) }}</td><td class="numeric">{{ money(row.display.supplement) }}</td><td class="numeric"><strong>{{ money(row.display.total_payable) }}</strong></td></tr>}</tbody></table></div>
            <p class="field-help">{{ split.unattributed ? "Dia sem produção: o custo fica não atribuído, nunca num armazém escolhido." : "Dividido pela participação de cada armazém na produção do dia, incluindo o complemento (regra proposta até a Cocapec validar outra)." }}@if (c.tariff_table?.valid_from) { Tabela vigente desde {{ c.tariff_table?.valid_from }}.}</p>
          }
          <details>
            <summary>Precisão e origem do cálculo</summary>
            <p>
              P: {{ decimal(c.production) }} · E: {{ decimal(c.equivalent_days) }} · R:
              {{ decimal(c.floor_per_day) }} · T: {{ decimal(c.total_payable) }} · C:
              {{ decimal(c.supplement) }}.
            </p>
            <p class="muted">
              {{legacy()?"O cálculo exibido pertence ao registro original. Não foram criadas parcelas individuais ou novas tarifas para este boletim.":"As parcelas seguem a fração de cada participante. O servidor preserva a precisão e reconcilia os centavos com o coletivo. O serviço de meia diária usa a tarifa 45,0786, separado da fração de participação no piso."}}
            </p>
          </details>
        } @else {
          <p class="muted">
            A prévia aparece aqui conforme a produção e a equipe são informadas.
          </p>
        }
      </section>
      <section class="panel"><h2>Parcelas por pessoa</h2>@if(allocations().length){<div class="table-wrap" tabindex="0" role="region" aria-label="Parcelas individuais conciliadas"><table><thead><tr><th>Pessoa</th><th>Fração</th><th>Produção atribuída</th><th>Complemento</th><th>Total</th><th>Ajuste de centavos</th></tr></thead><tbody>@for(a of allocations();track a.worker){<tr><td><button type="button" class="worker-name" (click)="openWorker(a.worker)">{{workerLabel(a.worker)}}</button></td><td>{{decimal(a.fraction)}}</td><td>{{money(a.display.production)}}</td><td>{{money(a.display.supplement)}}</td><td><strong>{{money(a.display.total_payable)}}</strong></td><td>{{money(a.display.rounding_adjustment)}}</td></tr>}</tbody></table></div><div class="actions section"><ion-button type="button" fill="outline" (click)="export()">Exportar parcelas</ion-button><ion-button type="button" fill="outline" (click)="printBulletin()" [disabled]="!canPrint()">Imprimir</ion-button></div>}@else{<p class="muted">{{bulletin()?.allocation_status==='pending_rule'?'Uma regra pendente impede atribuir parcelas a este boletim.':legacy()||closed()?'Este registro histórico não possui parcelas individuais preservadas.':previewing()?'Atualizando as parcelas…':'As parcelas aparecem com a prévia, assim que a equipe estiver válida.'}}</p>}</section>
      <div class="actions">
        @if (!closed() && !legacy() && api.can("warehouse")) {
          <ion-button type="submit" [disabled]="busy() || form.invalid">
            @if (busy()) {
              <ion-spinner name="dots" />
            }
            Salvar rascunho</ion-button
          >
          @if (bulletin()) {
            <ion-button
              type="button"
              fill="outline"
              (click)="close()"
              [disabled]="busy() || dirty() || !!bulletin()?.unresolved_occurrences?.length"
              >Fechar boletim</ion-button
            ><small>{{bulletin()?.unresolved_occurrences?.length ? "Fechamento bloqueado: consulte Regras pendentes abaixo." : "Salve alterações antes de fechar."}}</small>
          }
        }
        @if (closed() && !legacy() && api.can("warehouse")) {
          <ion-button
            type="button"
            fill="outline"
            (click)="showReopen.set(true)"
            >Reabrir com motivo</ion-button
          >
        }
      </div>
    </fieldset></form>
    @if(bulletin();as b){@if(!legacy()){<app-production-records [bulletin]="b" [dirty]="dirty()" (changed)="refresh()" />}<section class="panel section"><h2>Regras pendentes</h2><p class="muted">O fechamento permanece bloqueado enquanto houver ocorrência aberta. Saída antecipada, horas extras, diária especial e frações excepcionais ainda não têm regra financeira definida. Gestão deve conferir a ocorrência; se ela for válida, o boletim continua pendente até existir uma regra aprovada e implementada. Marque como não aplicável somente quando a ocorrência não ocorreu ou não afeta o cálculo vigente.</p>@for(o of b.unresolved_occurrences??[];track o.id){<div class="record-context"><strong>{{occurrenceLabel(o.code)}} · {{o.worker?workerLabel(o.worker):'Coletivo'}}</strong><p>{{o.description}}</p>@if(api.can('management')&&!legacy()){<label>Motivo de não aplicabilidade<input #reason type="text" /></label><ion-button type="button" fill="outline" [disabled]="busy()||dirty()" (click)="resolveOccurrence(o.id,reason.value)">Marcar como não aplicável</ion-button>@if(dirty()){<p class="field-help">Salve as alterações do boletim antes de resolver esta ocorrência.</p>}}</div>}@if(!b.unresolved_occurrences?.length){<p class="muted">Sem regra pendente registrada.</p>}@if(api.can('warehouse')&&!closed()&&!legacy()){<form [formGroup]="occurrenceForm" (ngSubmit)="addOccurrence()"><div class="form-grid"><label>Pessoa<select formControlName="worker"><option value="">Coletivo</option>@for(p of b.participants;track p.worker){<option [value]="p.worker">{{workerLabel(p.worker)}}</option>}</select></label><label>Motivo<select formControlName="code"><option value="EARLY_LEAVE">Saída antecipada sem fração definida</option><option value="OVERTIME">Horas extras</option><option value="SPECIAL_DAILY">Diária especial</option><option value="FRACTION">Fração sem regra definida</option><option value="OTHER">Outra regra pendente</option></select></label><label class="span-2">Descrição<textarea formControlName="description" required></textarea></label></div><ion-button type="submit" fill="outline" [disabled]="busy()||occurrenceForm.invalid||dirty()">Registrar pendência</ion-button></form>}</section>
    @if(api.can('warehouse')&&!legacy()&&!daily()){<details class="panel section"><summary>Transferir responsabilidade financeira</summary><p class="muted">A transferência mantém uma participação no dia, registra o motivo e reabre boletins fechados envolvidos. As atividades nos locais permanecem registradas.</p><form [formGroup]="transferForm" (ngSubmit)="transfer()"><div class="form-grid"><label>Pessoa<select formControlName="worker"><option value="">Selecione</option>@for(p of b.participants;track p.worker){<option [value]="p.worker">{{workerLabel(p.worker)}}</option>}</select></label><label>Boletim de destino<select formControlName="target_bulletin"><option value="">Selecione boletim da mesma data</option>@for(target of transferTargets();track target.id){<option [value]="target.id">{{target.warehouse_name}} · {{target.status}}</option>}</select></label><label class="span-2">Motivo<textarea formControlName="reason" required></textarea></label></div><ion-button type="submit" fill="outline" [disabled]="busy()||transferForm.invalid||dirty()">Transferir participante</ion-button></form></details>}}
    @if(bulletin(); as b){@if(daily()){<section class="panel section"><h2>Ajustes individuais</h2><p class="muted">Acréscimo ou desconto para uma pessoa (por exemplo, hora extra confirmada pelo RH), com valor, motivo e quem lançou. Não muda a produção, o piso nem o complemento deste boletim; entra no acerto da quinzena.</p>
      @if((b.adjustments??[]).length){<div class="table-wrap" tabindex="0" role="region" aria-label="Ajustes individuais do dia"><table><thead><tr><th>Pessoa</th><th>Tipo</th><th class="numeric">Valor</th><th>Motivo</th><th>Lançado por</th></tr></thead><tbody>@for(a of b.adjustments??[];track a.id){<tr><td>{{a.registration}} · {{a.name}}</td><td>{{a.kind_label}}</td><td class="numeric">{{money(a.amount)}}</td><td class="wrap">{{a.reason}}</td><td>{{a.created_by}}</td></tr>}</tbody></table></div>}@else{<p class="muted">Nenhum ajuste lançado neste dia.</p>}
      @if(api.can('warehouse')){<form [formGroup]="adjustmentForm" (ngSubmit)="addAdjustment()"><div class="form-grid"><label>Pessoa<select formControlName="worker"><option value="">Selecione</option>@for(p of b.participants;track p.worker){<option [value]="p.worker">{{workerLabel(p.worker)}}</option>}</select></label><label>Tipo<select formControlName="kind"><option value="OVERTIME">Hora extra confirmada</option><option value="EARLY_LEAVE">Saída antecipada</option><option value="SPECIAL_DAILY">Diária especial</option><option value="DISCOUNT">Desconto</option><option value="OTHER">Outro</option></select></label><label>Valor (R$, negativo para desconto)<input type="text" inputmode="decimal" formControlName="amount" /></label><label class="span-2">Motivo<textarea formControlName="reason"></textarea></label></div><ion-button type="submit" fill="outline" [disabled]="busy()||adjustmentForm.invalid">Lançar ajuste</ion-button></form>}</section>}}
    @if(bulletin()){<details class="panel section" (toggle)="historyToggled($event)"><summary>Histórico auditado do boletim</summary><p class="muted">Cada linha registra a revisão, o responsável e o motivo preservados no servidor.</p><ion-button type="button" fill="outline" [disabled]="historyBusy()" (click)="loadHistory()">Atualizar histórico</ion-button>@if(historyBusy()){<app-loading-state label="Consultando histórico…" />}@if(historyError()){<div app-feedback tone="error">{{historyError()}}</div>}@if(auditHistory().length){<div class="table-wrap" tabindex="0" role="region" aria-label="Revisões auditadas do boletim"><table><thead><tr><th>Revisão</th><th>Registrada em</th><th>Estado preservado</th><th>Responsável</th><th>Motivo</th></tr></thead><tbody>@for(entry of auditHistory();track entry.id){<tr><td>{{entry.revision}}</td><td>{{entry.recorded_at|date:'dd/MM/yyyy HH:mm'}}</td><td>@if(entry.snapshot.status){<app-status [value]="entry.snapshot.status" />}@else{Não informado}</td><td>{{entry.actor!==null?'Usuário #'+entry.actor:'Não informado'}}</td><td class="wrap">{{entry.reason||'Sem motivo informado'}}</td></tr>}</tbody></table></div>}@else if(historyLoaded()&&!historyBusy()){<p class="muted">Nenhuma revisão retornada para este registro.</p>}</details>}
    @if (showReopen() && !legacy()) {
      <form
        class="panel section"
        [formGroup]="reopenForm"
        (ngSubmit)="reopen()"
      >
        <h2>Reabrir boletim</h2>
        <label
          >Motivo da correção<textarea
            formControlName="reason"
            required
          ></textarea>
        </label>
        <div class="actions section">
          <ion-button type="submit" [disabled]="busy() || reopenForm.invalid"
            >Confirmar reabertura</ion-button
          ><ion-button type="button" fill="outline" (click)="showReopen.set(false)"
            >Cancelar</ion-button
          >
        </div>
      </form>
    }
    <p class="site-note">
      Complemento não significa automaticamente ociosidade. Nenhuma folha ou
      custo de RH integra este cálculo.
    </p>
    @if (workerCard(); as worker) {
      <div class="worker-modal" role="presentation" (click)="workerCard.set(null)">
        <div class="panel" role="dialog" aria-modal="true" aria-labelledby="worker-card-title" tabindex="-1" id="worker-card" (click)="$event.stopPropagation()" (keydown.escape)="workerCard.set(null)">
          <h2 id="worker-card-title">{{ worker.name }}</h2>
          <dl class="metadata">
            <div><dt>Matrícula</dt><dd>{{ worker.registration }}</dd></div>
            <div><dt>Contrato</dt><dd>{{ worker.contract }}</dd></div>
            <div><dt>Situação</dt><dd>{{ worker.active }}</dd></div>
            <div><dt>Origem</dt><dd>{{ worker.origin }}</dd></div>
          </dl>
          <div class="actions section"><ion-button type="button" fill="outline" (click)="workerCard.set(null)">Fechar</ion-button></div>
        </div>
      </div>
    }
  </div>`,
  styles: [`
    .worker-name { background: none; border: 0; padding: 0; color: var(--text); font: inherit; font-weight: 600; text-align: left; cursor: pointer; text-decoration: none; }
    .worker-name:hover { color: var(--green); }
    .worker-name:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; border-radius: 4px; }
    .worker-modal { position: fixed; inset: 0; z-index: 30; display: grid; place-items: center; padding: 24px; background: var(--scrim); }
    .worker-modal .panel { width: min(440px, 100%); margin: 0; }
    .worker-modal .metadata { grid-template-columns: 1fr; gap: 12px; }
  `],
})
export class BulletinEditor implements OnInit {
  api = inject(Api);
  catalog = inject(Catalog);
  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  bulletin = signal<Bulletin | null>(null);
  calculation = signal<Calculation | null>(null);
  busy = signal(false);
  previewing = signal(false);
  previewHold = signal("");
  printBusy = signal(false);
  rosterNote = signal("");
  workerCard = signal<{ name: string; registration: string; contract: string; active: string; origin: string } | null>(null);
  private previewGeneration = 0;
  private rosterGeneration = 0;
  error = signal("");
  success = signal("");
  showReopen = signal(false);
  dirty = signal(false);
  loaded = signal(false);
  allocations = signal<IndividualAllocation[]>([]);
  transferTargets = signal<Bulletin[]>([]);
  auditHistory=signal<BulletinAudit[]>([]);historyBusy=signal(false);historyError=signal('');historyLoaded=signal(false);
  money = money;
  decimal = decimal;
  occurrenceLabel = occurrenceLabel;
  private line = (category: string, l?: Line, warehouse = "") =>
    this.fb.nonNullable.group({
      warehouse: [warehouse],
      category: [category],
      unloading: [
        l?.unloading ?? "0",
        [Validators.required, Validators.min(0)],
      ],
      removal: [l?.removal ?? "0", [Validators.required, Validators.min(0)]],
      transfer: [l?.transfer ?? "0", [Validators.required, Validators.min(0)]],
    });
  private participant = (p?: Participant) =>
    this.fb.nonNullable.group({
      worker: [p?.worker ?? "", Validators.required],
      fraction: [p?.fraction ?? "1.0", Validators.required],
    });
  form = this.fb.nonNullable.group({
    warehouse: [""],
    reference_date: [previousDay(), Validators.required],
    origin: ["operacional_registrado"],
    daily_full: ["0", Validators.required],
    daily_half: ["0", Validators.required],
    lines: new FormArray<ReturnType<BulletinEditor["line"]>>([]),
    participants: new FormArray<ReturnType<BulletinEditor["participant"]>>([]),
  });
  occurrenceForm = this.fb.nonNullable.group({worker:[""],code:["EARLY_LEAVE"],description:["",Validators.required]});
  transferForm = this.fb.nonNullable.group({worker:["",Validators.required],target_bulletin:["",Validators.required],reason:["",Validators.required]});
  reopenForm = this.fb.nonNullable.group({ reason: ["", Validators.required] });
  adjustmentForm = this.fb.nonNullable.group({worker:["",Validators.required],kind:["OVERTIME"],amount:["",Validators.required],reason:["",Validators.required]});
  selected = signal<string[]>([]);
  dailyRates = signal<Record<string, string>>({});
  get lines() {
    return this.form.controls.lines;
  }
  get participants() {
    return this.form.controls.participants;
  }
  legacy(){const version=this.bulletin()?.financial_version;return !!this.bulletin() && version!=='boletim-v2' && version!=='boletim-v3';}
  daily(){return !this.bulletin() || this.bulletin()?.financial_version==='boletim-v3';}
  warehouseName(id:string){return this.catalog.warehouses().find(w=>w.id===id)?.name??id;}
  warehouseByCode(code:string){return this.catalog.warehouses().find(w=>w.code===code)?.name??code;}
  percent(value:string){return new Intl.NumberFormat("pt-BR",{style:"percent",maximumFractionDigits:1}).format(Number(value));}
  toggleWarehouse(id:string){if(this.closed()||this.legacy())return;if(this.selected().includes(id)){for(let i=this.lines.length-1;i>=0;i--)if(this.lines.at(i).controls.warehouse.value===id)this.lines.removeAt(i);this.selected.update(list=>list.filter(x=>x!==id));}else{this.catalog.rates().forEach(r=>this.lines.push(this.line(r.code,undefined,id)));this.selected.update(list=>[...list,id]);}}
  async loadDailyRates(){if(!this.daily()||this.closed())return;try{const t=await this.api.get<{current:{rates:{code:string;price:string}[]}}>(`tariff-tables/?date=${this.form.controls.reference_date.value}`);this.dailyRates.set(Object.fromEntries(t.current.rates.map(r=>[r.code,r.price])));}catch{this.dailyRates.set({});}}
  async fillFromRoster(fromUser = false) {
    if (!this.daily() || this.closed()) return;
    if (this.bulletin() && !fromUser) return;
    const generation = ++this.rosterGeneration;
    const date = this.form.controls.reference_date.value;
    try {
      const preferred = this.bulletin()?.origin === "demo_sintetico" || this.form.controls.origin.value === "demo_sintetico"
        ? "demo_sintetico"
        : "operacional_registrado";
      let team = await this.rosterTeam(date, preferred);
      if (generation !== this.rosterGeneration) return;
      if (!this.bulletin() && !team.participants.length && !team.absences) {
        const other = preferred === "demo_sintetico" ? "operacional_registrado" : "demo_sintetico";
        const alternate = await this.rosterTeam(date, other);
        if (generation !== this.rosterGeneration) return;
        if (alternate.participants.length || alternate.absences) {
          team = alternate;
          this.form.controls.origin.setValue(other, { emitEvent: false });
        }
      }
      if (generation !== this.rosterGeneration) return;
      this.participants.clear();
      team.participants.slice(0, 20).forEach((person) => this.participants.push(this.participant({ worker: person.worker, fraction: "1.0" })));
      this.rosterNote.set(this.rosterMessage(team));
    } catch (e) {
      if (generation === this.rosterGeneration) this.error.set(apiError(e));
    }
  }
  private rosterTeam(date: string, origin: string) {
    return this.api.get<{ participants: { worker: string }[]; unconfirmed: number; absences: number; absent?: { registration: string; name: string }[] }>(
      `roster/team/?${new URLSearchParams({ date, origin })}`,
    );
  }
  private rosterMessage(team: { unconfirmed: number; absences: number; absent?: { registration: string; name: string }[] }) {
    const names = (team.absent ?? []).map((person) => `${person.registration} · ${person.name}`);
    const missing = names.length
      ? `${names.join("; ")} ${names.length === 1 ? "faltou e não entra" : "faltaram e não entram"} no boletim.`
      : team.absences === 1
        ? "1 chapa faltou e não entra no boletim."
        : team.absences > 1
          ? `${team.absences} chapas faltaram e não entram no boletim.`
          : "";
    const pending = team.unconfirmed
      ? "A escala inclui chapas ainda sem presença confirmada. Cada uma entra com uma diária completa."
      : "";
    return [missing, pending].filter(Boolean).join(" ");
  }
  openWorker(id: string) {
    const worker = this.catalog.workers().find((item) => item.id === id);
    if (!worker) return;
    this.workerCard.set({
      name: worker.name,
      registration: worker.registration || "Não informada",
      contract: worker.contract_type === "TERCEIRIZADO" ? "Terceirizado / reforço de safra" : worker.contract_type === "EFETIVO" ? "Contrato anual" : "Não informado",
      active: worker.is_active === false ? "Inativa" : "Ativa",
      origin: originLabel(worker.origin ?? ""),
    });
    queueMicrotask(() => document.getElementById("worker-card")?.focus());
  }
  async addAdjustment(){const b=this.bulletin();if(!b||!this.daily()||this.busy()||this.adjustmentForm.invalid)return;this.busy.set(true);this.error.set('');try{const v=this.adjustmentForm.getRawValue();await this.api.post('labor-adjustments/',{...v,amount:quantity(v.amount),reference_date:b.reference_date,origin:b.origin});await this.refresh();this.adjustmentForm.reset({worker:'',kind:'OVERTIME',amount:'',reason:''});this.success.set('Ajuste lançado; o boletim não muda e o valor entra no acerto da quinzena.');}catch(e){this.error.set(apiError(e));}finally{this.busy.set(false);}}
  pendingCalculation(){const c=this.calculation();return !!(c?.provisional || c?.status==='pending_rule' || c?.allocation_status==='pending_rule' || this.bulletin()?.unresolved_occurrences?.length);}
  closed() {
    return this.bulletin()?.status === "CLOSED";
  }
  async ngOnInit() {
    this.destroyRef.onDestroy(() => {
      this.invalidatePreview();
      this.rosterGeneration += 1;
    });
    this.busy.set(true);
    try {
      await Promise.all([this.catalog.load(), this.catalog.loadRates()]);
      const id = this.route.snapshot.paramMap.get("id");
      const query = this.route.snapshot.queryParamMap;
      if (id) this.apply(await this.api.get<Bulletin>(`bulletins/${id}/`));
      else {
        if (query.get("data")) this.form.controls.reference_date.setValue(query.get("data")!);
        if (query.get("origem") === "demo_sintetico") this.form.controls.origin.setValue("demo_sintetico");
      }
      await this.loadDailyRates();
      this.form.controls.reference_date.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
        void this.loadDailyRates();
        void this.fillFromRoster();
      });
      this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
        this.dirty.set(true);
        this.success.set("");
        this.invalidatePreview();
        this.calculation.set(null);
        this.allocations.set([]);
        if (!this.canAttemptPreview()) return;
        const draft = this.readDraft();
        this.previewHold.set("hold" in draft ? draft.hold : "");
        this.previewing.set("payload" in draft);
      });
      this.form.valueChanges.pipe(debounceTime(400), takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.preview());
      this.loaded.set(true);
      if (!id) await this.fillFromRoster();
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
  apply(b: Bulletin) {
    this.invalidatePreview();
    this.bulletin.set(b);
    this.auditHistory.set([]);this.historyLoaded.set(false);
    this.form.enable({ emitEvent: false });
    this.form.patchValue(
      {
        warehouse: b.warehouse ?? "",
        reference_date: b.reference_date,
        origin: b.origin,
        daily_full:b.daily_services?.find(x=>x.kind==="FULL")?.quantity??"0",
        daily_half:b.daily_services?.find(x=>x.kind==="HALF")?.quantity??"0",
      },
      { emitEvent: false },
    );
    this.lines.clear({ emitEvent: false });
    if (b.financial_version === "boletim-v3") {
      const warehouses = [...new Set(b.lines.map((l) => l.warehouse ?? "").filter(Boolean))];
      this.selected.set(warehouses);
      warehouses.forEach((wid) => this.catalog.rates().forEach((r) =>
        this.lines.push(this.line(r.code, b.lines.find((l) => l.category === r.code && l.warehouse === wid), wid), { emitEvent: false })));
    } else {
      this.selected.set([]);
      this.catalog.rates().forEach((r) =>
        this.lines.push(
          this.line(
            r.code,
            b.lines.find((l) => l.category === r.code),
          ),
          { emitEvent: false },
        ),
      );
    }
    this.participants.clear({ emitEvent: false });
    b.participants.forEach((p) =>
      this.participants.push(this.participant(p), { emitEvent: false }),
    );
    this.form.controls.warehouse.disable({ emitEvent: false });
    this.form.controls.reference_date.disable({ emitEvent: false });
    this.form.controls.origin.disable({ emitEvent: false });
    if (b.status === "CLOSED" || this.legacy() || !this.api.can("warehouse")) this.form.disable({ emitEvent: false });
    this.calculation.set(b.calculation);
    this.allocations.set(b.individual_allocations??[]);
    void this.loadTargets();
    this.dirty.set(false);
  }
  lineQtyLabel(row: { controls: { unloading: { value: string }; removal: { value: string }; transfer: { value: string } } }) {
    return this.shown(lineQuantity(row.controls.unloading.value, row.controls.removal.value, row.controls.transfer.value));
  }
  lineAmountLabel(row: { controls: { category: { value: string }; unloading: { value: string }; removal: { value: string }; transfer: { value: string } } }, warehouse?: string) {
    const quantity = lineQuantity(row.controls.unloading.value, row.controls.removal.value, row.controls.transfer.value);
    if (quantity === null) return "—";
    const amount = lineAmount(quantity, this.ratePrice(row.controls.category.value, warehouse));
    return amount === null ? "Não disponível" : this.shown(amount, 4);
  }
  private shown(value: string | null, digits = 4) {
    if (value === null) return "—";
    const formatted = decimal(value, digits);
    return formatted === "Não disponível" ? "—" : formatted;
  }
  rateLabel(code: string) {
    return this.catalog.rates().find((r) => r.code === code)?.label ?? code;
  }
  ratePrice(code: string, warehouse?: string) {
    if (this.closed() || this.legacy())
      return (
        this.bulletin()?.lines.find((l) => l.category === code && (!warehouse || l.warehouse === warehouse))?.price ??
        this.dailyRates()[code] ??
        "Não disponível"
      );
    return this.dailyRates()[code] ?? this.catalog.rates().find((r) => r.code === code)?.price ?? "—";
  }
  addParticipant() {
    if(this.legacy())return;
    if (this.participants.length < 20)
      this.participants.push(this.participant());
  }
  removeParticipant(index: number) {
    if(this.legacy())return;
    this.participants.removeAt(index);
  }
  payload() {
    const v = this.form.getRawValue();
    const {daily_full,daily_half,origin,warehouse,...fields}=v;
    void origin;
    const lines = v.lines.map((l) => ({
      ...l,
      unloading: quantity(l.unloading),
      removal: quantity(l.removal),
      transfer: quantity(l.transfer),
    }));
    if (this.daily())
      return {...fields, lines: lines.filter((l) => l.warehouse && [l.unloading, l.removal, l.transfer].some((x) => Number(x) > 0))};
    return {
      ...fields,
      warehouse,
      daily_services:[{kind:"FULL",quantity:quantity(daily_full)},{kind:"HALF",quantity:quantity(daily_half)}],
      lines: lines.map(({warehouse: _ignored, ...line}) => { void _ignored; return line; }),
    };
  }
  private canAttemptPreview() {
    return this.loaded() && !this.legacy() && !this.closed() && !this.busy() && this.api.can("warehouse");
  }
  private invalidatePreview() {
    this.previewGeneration += 1;
    this.previewing.set(false);
    this.previewHold.set("");
  }
  private readDraft(): { payload: ReturnType<BulletinEditor["payload"]> } | { hold: string } | { skip: true } {
    if (!this.canAttemptPreview()) return { skip: true };
    if (this.form.invalid) return { hold: "A prévia atualiza quando as quantidades e a equipe estiverem válidas." };
    try {
      return { payload: this.payload() };
    } catch {
      return { hold: "Aguardando uma quantidade válida para atualizar a prévia." };
    }
  }
  async preview() {
    const draft = this.readDraft();
    if (!("payload" in draft)) {
      this.invalidatePreview();
      if (!this.busy()) this.previewing.set(false);
      if ("hold" in draft) this.previewHold.set(draft.hold);
      return;
    }
    const generation = ++this.previewGeneration;
    this.previewHold.set("");
    this.previewing.set(true);
    try {
      const result = await this.api.post<Calculation>("bulletins/preview/", { ...draft.payload, origin: this.displayOrigin(), bulletin: this.bulletin()?.id });
      if (generation !== this.previewGeneration) return;
      this.calculation.set(result);
      this.allocations.set(this.bulletin()?.unresolved_occurrences?.length ? [] : result.individual_allocations ?? []);
      this.error.set("");
    } catch (e) {
      if (generation !== this.previewGeneration) return;
      this.previewHold.set(apiError(e));
    } finally {
      if (generation === this.previewGeneration) this.previewing.set(false);
    }
  }
  canPrint() {
    return !!this.calculation() && !this.previewing() && !this.previewHold() && !this.busy() && !this.printBusy() && (this.form.valid || this.form.disabled);
  }
  private printModel(): BulletinPrintInput {
    const calculation = this.calculation();
    if (!calculation) throw new Error("Calcule a prévia antes de imprimir.");
    const saved = this.bulletin();
    const warehouses = this.daily()
      ? this.selected().map((id) => this.warehouseName(id))
      : [saved?.warehouse_name || this.warehouseName(this.form.getRawValue().warehouse) || "Armazém"];
    const worker = (id: string) => this.catalog.workers().find((item) => item.id === id);
    return {
      referenceDate: this.form.controls.reference_date.value,
      warehouses,
      revision: saved?.revision ?? null,
      provisional: this.pendingCalculation(),
      closed: this.closed(),
      lines: this.lines.getRawValue().map((row) => ({
        warehouse: this.daily() ? this.warehouseName(row.warehouse) : warehouses[0],
        label: this.rateLabel(row.category),
        unloading: row.unloading,
        removal: row.removal,
        transfer: row.transfer,
        price: this.closed() || this.legacy()
          ? saved?.lines.find((line) => line.category === row.category && (!this.daily() || line.warehouse === row.warehouse))?.price ?? ""
          : this.ratePrice(row.category, row.warehouse),
      })),
      calculation,
      people: this.participants.getRawValue().map((person) => {
        const known = worker(person.worker);
        return { registration: known?.registration ?? "", name: known?.name ?? "", fraction: person.fraction };
      }),
      allocations: this.pendingCalculation() ? [] : this.allocations().map((item) => {
        const known = worker(item.worker);
        return {
          registration: item.registration ?? known?.registration ?? "",
          name: item.name ?? known?.name ?? "",
          fraction: item.fraction,
          production: item.display.production,
          supplement: item.display.supplement,
          total: item.display.total_payable,
        };
      }),
    };
  }
  async printBulletin() {
    if (!this.canPrint() || this.printBusy()) return;
    const preview = Capacitor.isNativePlatform() ? null : window.open("", "_blank");
    this.printBusy.set(true);
    this.error.set("");
    try {
      await openBulletinPdf(this.printModel(), preview, Capacitor.isNativePlatform() ? (blob, name) => this.api.saveBlob(blob, name) : undefined);
    } catch (e) {
      preview?.close();
      this.error.set(apiError(e));
    } finally {
      this.printBusy.set(false);
    }
  }
  async save() {
    if (this.legacy() || this.form.invalid || !this.loaded() || this.busy()) return;
    this.invalidatePreview();
    this.busy.set(true);
    this.error.set("");
    this.success.set("");
    try {
      const b = this.bulletin();
      const payload = this.payload();
      const result = b
        ? await this.api.patch<Bulletin>(`bulletins/${b.id}/`, {
            ...("daily_services" in payload ? { daily_services: payload.daily_services } : {}),
            lines: payload.lines,
            participants: payload.participants,
            revision: b.revision,
          })
        : await this.api.post<Bulletin>("bulletins/", payload);
      this.apply(result);
      this.success.set("Boletim salvo.");
      if (!b) await this.router.navigate(["/boletins", result.id]);
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
  async close() {
    const b = this.bulletin();
    if (!b || this.legacy() || this.dirty() || this.busy()) return;
    this.busy.set(true);
    this.error.set("");
    this.success.set("");
    try {
      this.apply(
        await this.api.post<Bulletin>(`bulletins/${b.id}/close/`, {
          revision: b.revision,
        }),
      );
      this.success.set(
        "Boletim fechado; tarifa e piso preservados na revisão.",
      );
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
  async reopen() {
    const b = this.bulletin();
    if (!b || this.legacy()) return;
    this.busy.set(true);
    this.error.set("");
    this.success.set("");
    try {
      this.apply(
        await this.api.post<Bulletin>(`bulletins/${b.id}/reopen/`, {
          revision: b.revision,
          reason: this.reopenForm.controls.reason.value,
        }),
      );
      this.showReopen.set(false);
      this.success.set("Boletim reaberto com motivo registrado.");
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
  displayOrigin(){if(this.bulletin())return this.bulletin()!.origin;const ids=this.participants.getRawValue().map(p=>p.worker).filter(Boolean);return ids.length&&ids.every(id=>this.catalog.workers().find(w=>w.id===id)?.origin==='demo_sintetico')?'demo_sintetico':'operacional_registrado';}
  workerLabel(id:string){const worker=this.catalog.workers().find(w=>w.id===id);return worker?`${worker.registration} · ${worker.name}`:id;}
  async refresh(){const b=this.bulletin();if(!b)return;try{this.apply(await this.api.get<Bulletin>(`bulletins/${b.id}/`));}catch(e){this.error.set(apiError(e));throw e;}}
  async loadTargets(){const b=this.bulletin();this.transferTargets.set([]);if(!b||this.legacy())return;try{const result=await this.api.getAll<Bulletin>(`bulletins/?date_from=${b.reference_date}&date_to=${b.reference_date}&origin=${b.origin}&page_size=100`);this.transferTargets.set(result.filter(x=>x.id!==b.id&&x.financial_version==='boletim-v2'));}catch(e){this.error.set(apiError(e));}}
  async addOccurrence(){const b=this.bulletin();if(!b||this.legacy()||this.busy()||this.dirty()||this.occurrenceForm.invalid)return;this.busy.set(true);this.error.set('');try{const v=this.occurrenceForm.getRawValue();await this.api.post('labor-rule-occurrences/',{...v,bulletin:b.id,worker:v.worker||null});await this.refresh();this.occurrenceForm.controls.description.setValue('');this.success.set('Pendência registrada. O fechamento aguarda a regra aplicável.');}catch(e){this.error.set(apiError(e));}finally{this.busy.set(false);}}
  async resolveOccurrence(id:string,reason:string){if(this.legacy()||this.busy()||this.dirty())return;if(!reason.trim()){this.error.set('Informe por que a ocorrência não se aplica.');return;}this.busy.set(true);this.error.set('');try{await this.api.post(`labor-rule-occurrences/${id}/resolve/`,{resolution_type:'NOT_APPLICABLE',reason});await this.refresh();this.success.set('Não aplicabilidade registrada com motivo.');}catch(e){this.error.set(apiError(e));}finally{this.busy.set(false);}}
  async transfer(){const b=this.bulletin();const v=this.transferForm.getRawValue();const target=this.transferTargets().find(t=>t.id===v.target_bulletin);if(!b||this.legacy()||!target||target.financial_version!=='boletim-v2'||this.busy()||this.dirty()||this.transferForm.invalid)return;this.busy.set(true);this.error.set('');try{await this.api.post(`bulletins/${b.id}/transfer-worker/`,{...v,revision:b.revision,target_revision:target.revision});await this.refresh();this.transferForm.reset();this.success.set('Responsabilidade financeira transferida com histórico.');}catch(e){this.error.set(apiError(e));}finally{this.busy.set(false);}}
  export(){exportCsv(`parcelas-${this.form.controls.reference_date.value}.csv`,[['Pessoa','Fração','Produção atribuída','Complemento','Total','Ajuste de centavos'],...this.allocations().map(a=>[this.workerLabel(a.worker),a.fraction,a.display.production,a.display.supplement,a.display.total_payable,a.display.rounding_adjustment])]);}
  historyToggled(event:Event){if((event.target as HTMLDetailsElement).open&&!this.historyLoaded())void this.loadHistory();}
  async loadHistory(){const b=this.bulletin();if(!b||this.historyBusy())return;this.historyBusy.set(true);this.historyError.set('');try{const history=await this.api.get<BulletinAudit[]>(`bulletins/${b.id}/history/`);if(this.bulletin()?.id===b.id){this.auditHistory.set(history);this.historyLoaded.set(true);}}catch(e){this.historyError.set(apiError(e));}finally{this.historyBusy.set(false);}}
  exportRecord(){const b=this.bulletin();if(!b)return;exportCsv(`boletim-${b.reference_date}-${b.revision}.csv`,[['Tipo','Referência','Detalhe','Valor / quantidade','Descarga','Remoção','Transferência','Qtd. total','Total'],['Registro',b.id,b.warehouse_name,b.reference_date],['Estado',b.financial_version,b.status,b.revision],['Origem',b.origin],['Apuração',b.calculation.provisional?'Provisória':'Preservada','Produção',b.calculation.production],['Apuração',b.calculation.provisional?'Provisória':'Preservada','Total',b.calculation.total_payable],['Apuração',b.calculation.provisional?'Provisória':'Preservada','Complemento',b.calculation.supplement],...b.lines.map(l=>{const qty=lineQuantity(l.unloading,l.removal,l.transfer);return ['Categoria',l.category,(l.warehouse_name?l.warehouse_name+' · ':'')+(l.label??this.rateLabel(l.category)),l.price,l.unloading,l.removal,l.transfer,qty??'',lineAmount(qty,l.price??'')??''];}),...(b.adjustments??[]).map(a=>['Ajuste',a.registration,a.kind_label+' · '+a.reason,a.amount]),...b.participants.map(p=>['Participante',p.registration??p.worker,p.name??this.workerLabel(p.worker),p.fraction]),...(b.daily_services??[]).map(d=>['Serviço de diária',d.kind,'Quantidade',d.quantity]),...(b.unresolved_occurrences??[]).map(o=>['Pendência',o.code,o.description,o.worker??'Coletivo'])]);}
  async example() {
    this.error.set("");
    if (this.daily() && !this.selected().length) {
      const adubo = this.catalog.warehouses().find((w) => w.code === "ADUBO") ?? this.catalog.warehouses()[0];
      if (adubo) this.toggleWarehouse(adubo.id);
    }
    this.lines.controls.forEach((r) => r.patchValue({ unloading: "0", removal: "0", transfer: "0" }));
    const quantities: Record<string, { unloading: string; removal: string; transfer: string }> = {
      FERTILIZANTES: { unloading: "2378", removal: "400", transfer: "0" },
      AGROQUIMICO: { unloading: "30", removal: "0", transfer: "0" },
      SERVICOS_DIVERSOS: { unloading: "0", removal: "40", transfer: "0" },
    };
    const first = this.selected()[0];
    this.lines.controls.forEach((r) => {
      const q = quantities[r.controls.category.value];
      if (q && (!this.daily() || r.controls.warehouse.value === first)) r.patchValue(q);
    });
    if (!this.daily() && !this.form.controls.warehouse.value) this.form.controls.warehouse.setValue(this.catalog.warehouses()[0]?.id ?? "");
    if (this.daily()) await this.fillFromRoster(true);
  }
}
