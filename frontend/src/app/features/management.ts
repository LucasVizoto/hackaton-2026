import { Component, inject, OnDestroy, OnInit, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { IonButton, IonIcon } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { sparklesOutline } from "ionicons/icons";
import {
  Api,
  apiError,
  dateTime,
  money,
  originLabel,
  RecordData,
  today,
} from "../core/api";
import { Catalog } from "../core/catalog";
import { chartDateLabel, chartItems, operationalMetric } from "../core/chart-data";
import { exportCsv } from "../core/workflow";
import { decimal } from "../core/presentation";
import {
  BarChart,
  EmptyState,
  FeedbackState,
  FilterBlock,
  LoadingState,
  MetricCard,
  PageHeader,
} from "../shared/ui";
import { Bulletin } from "./bulletins";
import { BalanceFilters, StaffingBalance } from "./staffing-balance";
import { CostComparisonChart } from "./cost-comparison-chart";
import { DailyCost, managementPeriodError, waitDuration, waitLeaders, WarehouseWait, WeeklySupplement } from "../core/cost-chart";
interface SourceRecords<T> {
  records: T[];
  count: number;
  returned_count: number;
  truncated: boolean;
}
interface FinancialSource {
  id: string;
  reference_date: string;
  warehouse_id: string;
  warehouse_name: string;
  production: string;
  equivalent_days: string;
  total_payable: string;
  supplement: string;
}
interface OperationalSource {
  id: string;
  finished_at: string;
  slot_date: string;
  arrived_at: string | null;
  started_at: string | null;
  warehouse_ids: string[];
}
interface ArrivalSource {
  id: string;
  arrived_at: string;
}
interface BookingSource {
  id: string;
  slot_date: string;
  slot_time: string;
}
interface NonReceiptSource {
  id: string;
  appointment_id: string | null;
  occurred_at: string;
  reason: string;
}
interface OperationalSources extends SourceRecords<OperationalSource> {
  arrivals: SourceRecords<ArrivalSource>;
  bookings: SourceRecords<BookingSource>;
  non_receipts: SourceRecords<NonReceiptSource>;
}
interface IndividualCost {worker:string;registration:string;name:string;equivalent_days:string;production_attributed:string;supplement:string;total_payable:string;display:{production_attributed:string;supplement:string;total_payable:string};cost_warehouses:{id:string;name:string}[];activity_warehouses:{id:string;name:string}[];}
interface Costs {
  daily_series?: DailyCost[];
  weekly_supplement?: WeeklySupplement;
  individuals?: SourceRecords<IndividualCost>;
  presence?: {planned:number;present:number;used:number;coverage:number};
  reconciliation?: {individual_display_total:string|null;collective_display_total:string|null;difference:string|null;legacy_bulletins_without_allocations:number};
  origin: string;
  period: { date_from: string; date_to: string };
  summary: {
    production: string;
    equivalent_days: string;
    total_payable: string;
    supplement: string;
    supplement_share: string | null;
    days_below_floor: number;
    people_count: number;
    bulletin_count: number;
  };
  groups: {
    warehouse: string;
    warehouse_name: string;
    period: RecordData;
    production: string;
    equivalent_days: string;
    total_payable: string;
    supplement: string;
    people_count: number;
    bulletin_count: number;
    diagnosis: string;
    supplement_share: string | null;
    days_below_floor: number;
    evidence?: unknown;
  }[];
  coverage: RecordData;
  warnings: string[];
  source_records?: SourceRecords<FinancialSource> | null;
}
interface Operations {
  gate_wait_by_warehouse?: WarehouseWait[] | null;
  origin: string;
  period: { date_from: string; date_to: string };
  summary?: RecordData;
  received_loads?: number | null;
  average_wait_minutes?: number | null;
  average_unloading_minutes?: number | null;
  average_workers_per_receipt?: number | null;
  historical_documentary?: RecordData;
  coverage?: RecordData;
  definitions?: RecordData;
  warnings?: string[];
  source_records?: OperationalSources | null;
  [key: string]: unknown;
}
interface Scenario {
  origin: string;
  warehouse_name: string;
  reference_date: string;
  current: RecordData;
  scenario: RecordData;
  difference: string;
  conditional: boolean;
  assumptions: string[];
}
const imports = [ReactiveFormsModule, IonButton, PageHeader, LoadingState, FeedbackState];
@Component({
  standalone: true,
  imports: [...imports, RouterLink, IonIcon, MetricCard, BarChart, FilterBlock, EmptyState, StaffingBalance, CostComparisonChart],
  template: `<div class="page">
    <app-page-header
      title="Gestão por local e período"
      subtitle="Compare produção e piso com a operação registrada e a cobertura disponível."
    ><a routerLink="/gestao/logistica">Logística e Entregas</a></app-page-header>
    <form
      app-filter-block
      class="filters"
      aria-label="Filtrar indicadores"
      [formGroup]="filters"
      (ngSubmit)="load()"
    >
      <label>De<input type="date" formControlName="date_from" required [attr.aria-invalid]="filterError() ? true : null" [attr.aria-describedby]="filterError() ? 'management-period-error' : null" /></label
      ><label>Até<input type="date" formControlName="date_to" required [attr.aria-invalid]="filterError() ? true : null" [attr.aria-describedby]="filterError() ? 'management-period-error' : null" /></label
      ><label
        >Local<select formControlName="warehouse">
          <option value="">Todos os locais</option>
          @for (w of catalog.warehouses(); track w.id) {
            <option [value]="w.id">{{ w.name }}</option>
          }
        </select></label
      ><label
        >Origem<select formControlName="origin">
          <option value="operacional_registrado">Operação registrada</option>
          <option value="demo_sintetico">Demonstração sintética</option>
          <option value="historico_importado">Histórico importado</option>
        </select></label
      ><ion-button type="submit" [disabled]="busy()"
        >Aplicar período</ion-button
      >
    </form>
    @if (filterError()) {<p id="management-period-error" app-feedback tone="error">{{filterError()}}</p>}
    @if (
      costs()?.origin === "demo_sintetico" ||
      operations()?.origin === "demo_sintetico"
    ) {
      <div class="notice synthetic">
        Demonstração sintética. Valores, equipe e tempos desse conjunto foram
        criados para demonstrar o funcionamento; não são medições da Cocapec.
      </div>
    }
    @if (error()) {
      <div app-feedback tone="error" class="error">{{ error() }}</div>
    }
    @if (busy()) {
      <app-loading-state label="Consultando indicadores…" />
    }
    <app-staffing-balance [filters]="balanceFilters()" />
    @if (!busy() || costs() || operations()) {
      <section class="section" aria-label="Custos e gargalos">
        @if (appliedFilters(); as applied) {<p class="muted">{{origin(applied.origin)}} · {{date(applied.date_from)}} a {{date(applied.date_to)}} · {{appliedWarehouseName()}}</p>}
        @if (costsError()) {<div app-feedback tone="error">Comparativo financeiro indisponível: {{costsError()}} Reaplique o período para tentar novamente.</div>}
        @if (costs()?.daily_series; as series) {<app-cost-comparison-chart [series]="series"/>}
        <div class="metric-grid section bottleneck-grid">
          <app-metric-card label="Maior espera após portaria" [value]="waitHighlightValue()" [hint]="waitHighlightHint()"/>
          <app-metric-card label="Maior complemento do piso" [value]="supplementHighlightValue()" [hint]="supplementHighlightHint()" tone="warning"/>
        </div>
        @if (operationsError()) {<div app-feedback tone="error">Espera indisponível: {{operationsError()}} Reaplique o período para tentar novamente.</div>}
        @if (costs() || operations()) {
          <section class="panel section management-analysis" aria-labelledby="management-analysis-title">
            <h2 id="management-analysis-title"><ion-icon name="sparkles-outline" aria-hidden="true"/>Análise automática</h2>
            <p>{{localAnalysis()}}</p>
            @if (aiBusy()) {<p role="status">Consultando a IA com os indicadores deste recorte…</p>}
            @if (aiAnswer(); as answer) {<div class="section"><h3>Análise da IA</h3><p class="ai-answer">{{answer.answer}}</p><p class="field-help">{{origin(answer.context.origin)}} · {{date(answer.context.period.date_from)}} a {{date(answer.context.period.date_to)}}. Consulta somente de leitura.</p></div>}
            @if (aiError()) {<p app-feedback tone="error">{{aiError()}} A análise automática acima continua disponível.</p>}
            @if (aiAvailable() && !aiBusy() && aiError()) {<ion-button fill="outline" (click)="generateInsight()">Tentar análise da IA novamente</ion-button>}
            @if (aiNotice()) {<p class="field-help">{{aiNotice()}}</p>}
          </section>
        }
      </section>
    }
    @if (operations(); as o) {
      <section class="section">
        <h2>Operação e recursos</h2>
        <p class="muted">
          Resultados aplicados: {{ origin(o.origin) }} ·
          {{ date(o.period.date_from) }} a {{ date(o.period.date_to) }}.
        </p>
        <p class="muted">
          Um caminhão conta uma vez globalmente. Totais por destino podem não
          ser aditivos. Recursos por descarga medem intensidade, não efetivo
          diário.
        </p>
        <div class="metric-grid">
          <app-metric-card
            label="Cargas recebidas"
            [value]="metric('received_loads')"
            hint="Caminhões concluídos, sem duplicar destinos"
            tone="brand"
          />
          <app-metric-card
            label="Espera média"
            [value]="metric('average_wait_minutes', 'min')"
            hint="Cargas concluídas no período: chegada ao início da descarga"
          />
          <app-metric-card
            label="Descarga média"
            [value]="metric('average_unloading_minutes', 'min')"
            hint="Do início à conclusão registrada"
            tone="info"
          />
          <app-metric-card
            label="Chapas por recebimento"
            [value]="metric('average_workers_per_receipt')"
            hint="Média das cargas com recursos confirmados"
          />
        </div>
        <div class="metric-grid section"><app-metric-card label="Espera após a portaria" [value]="metric('average_gate_wait_minutes','min')" [hint]="medianHint('median_gate_wait_minutes', 'Cargas com saída no período: portaria até o 1º armazém')" /><app-metric-card label="Permanência total" [value]="metric('average_total_stay_minutes','min')" [hint]="medianHint('median_total_stay_minutes', 'Entrada até saída da unidade')" /><app-metric-card label="Saídas da unidade" [value]="metric('departed_loads')" hint="Descarga concluída não equivale a saída da portaria" /></div>
        <div class="chart-grid section">
          <app-bar-chart
            title="Cargas por data"
            description="Caminhões concluídos por data de conclusão."
            [items]="dateChart()"
            [emptyLabel]="chartEmptyLabel('loads_by_date', 'Nenhuma carga concluída no período.')"
          />
          <app-bar-chart
            title="Cargas por local"
            description="Contagem por destino. Um caminhão pode passar por mais de um local."
            [items]="warehouseChart()"
            [emptyLabel]="chartEmptyLabel('loads_by_warehouse', 'Nenhum destino registrado no período.')"
          />
          <app-bar-chart
            title="Não recebimentos por motivo"
            description="Ocorrências por data do não recebimento."
            [items]="reasonChart()"
            [emptyLabel]="chartEmptyLabel('non_receipts_by_reason', 'Nenhum não recebimento no período.')"
          />
        </div>
        <details class="section">
          <summary>Distribuições e recursos em tabelas</summary>
        @for (group of operationGroups(); track group.key) {
          <h3 class="section">{{ fieldLabel(group.key) }}</h3>
          @if (group.rows.length) {
            <div class="table-wrap" tabindex="0" role="region" [attr.aria-label]="fieldLabel(group.key)">
              <table>
                <thead>
                  <tr>
                    @for (col of group.columns; track col) {
                      <th>{{ fieldLabel(col) }}</th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (row of group.rows; track $index) {
                    <tr>
                      @for (col of group.columns; track col) {
                        <td
                          [class.wrap]="
                            col === 'definition' ||
                            col === 'name' ||
                            col === 'warehouse_name'
                          "
                        >
                          {{ show(row[col]) }}
                        </td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="muted">Sem registros no recorte.</p>
          }
        }
        </details>
        @if (operationsSummary()) {
          <details>
            <summary>Resumo operacional</summary>
            <dl class="metadata">
              @for (entry of entries(operationsSummary()); track entry[0]) {
                <div>
                  <dt>{{ fieldLabel(entry[0]) }}</dt>
                  <dd>{{ show(entry[1]) }}</dd>
                </div>
              }
            </dl>
          </details>
        }
        @if (o.coverage) {
          <details>
            <summary>Cobertura das medições</summary>
            <dl class="metadata">
              @for (entry of entries(o.coverage); track entry[0]) {
                <div>
                  <dt>{{ fieldLabel(entry[0]) }}</dt>
                  <dd>{{ show(entry[1]) }}</dd>
                </div>
              }
            </dl>
          </details>
        }
        @if (o.source_records; as sources) {
          <details class="section">
            <summary>Recebimentos que sustentam os indicadores de conclusão</summary>
            <p class="muted">
              {{ sources.returned_count }} de {{ sources.count }} recebimentos
              concluídos neste recorte, selecionados pela data de conclusão.
              Chegadas, agendamentos e não recebimentos usam suas próprias datas.
            </p>
            @if (sources.truncated) {
              <p class="notice">
                A consulta mostra até 100 registros. Reduza o período ou
                selecione um local para conferir os demais recebimentos.
              </p>
            }
            @if (sources.records.length) {
              <div class="table-wrap" tabindex="0" role="region" aria-label="Recebimentos concluídos que sustentam os indicadores">
                <table>
                  <thead>
                    <tr>
                      <th>Data agendada</th>
                      <th>Chegada</th>
                      <th>Entrada</th>
                      <th>Conclusão</th>
                      <th>Registro</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (record of sources.records; track record.id) {
                      <tr>
                        <td>{{ date(record.slot_date) }}</td>
                        <td>{{ dt(record.arrived_at) }}</td>
                        <td>{{ dt(record.started_at) }}</td>
                        <td>{{ dt(record.finished_at) }}</td>
                        <td>
                          <a [routerLink]="['/agenda', record.id]">Abrir recebimento</a>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p class="muted">Nenhum recebimento concluído neste recorte.</p>
            }
          </details>
          <details class="section">
            <summary>Chegadas que sustentam a distribuição por hora</summary>
            <p class="muted">
              {{ sources.arrivals.returned_count }} de {{ sources.arrivals.count }}
              chegadas neste recorte, selecionadas pela data de chegada.
            </p>
            @if (sources.arrivals.truncated) {
              <p class="notice">Consulta limitada a 100 registros. Reduza o período ou selecione um local.</p>
            }
            @if (sources.arrivals.records.length) {
              <div class="table-wrap" tabindex="0" role="region" aria-label="Chegadas que sustentam a distribuição por hora">
                <table>
                  <thead><tr><th>Chegada</th><th>Registro</th></tr></thead>
                  <tbody>
                    @for (record of sources.arrivals.records; track record.id) {
                      <tr>
                        <td>{{ dt(record.arrived_at) }}</td>
                        <td><a [routerLink]="['/agenda', record.id]">Abrir recebimento</a></td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p class="muted">Nenhuma chegada registrada neste recorte.</p>
            }
          </details>
          <details class="section">
            <summary>Agendamentos que sustentam a distribuição por horário</summary>
            <p class="muted">
              {{ sources.bookings.returned_count }} de {{ sources.bookings.count }}
              agendamentos neste recorte, selecionados pela data agendada.
            </p>
            @if (sources.bookings.truncated) {
              <p class="notice">Consulta limitada a 100 registros. Reduza o período ou selecione um local.</p>
            }
            @if (sources.bookings.records.length) {
              <div class="table-wrap" tabindex="0" role="region" aria-label="Agendamentos que sustentam a distribuição por horário">
                <table>
                  <thead><tr><th>Data / horário</th><th>Registro</th></tr></thead>
                  <tbody>
                    @for (record of sources.bookings.records; track record.id) {
                      <tr>
                        <td>{{ date(record.slot_date) }} · {{ record.slot_time }}</td>
                        <td><a [routerLink]="['/agenda', record.id]">Abrir recebimento</a></td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p class="muted">Nenhum agendamento neste recorte.</p>
            }
          </details>
          <details class="section">
            <summary>Ocorrências que sustentam os não recebimentos por motivo</summary>
            <p class="muted">
              {{ sources.non_receipts.returned_count }} de {{ sources.non_receipts.count }}
              ocorrências neste recorte, selecionadas pela data da ocorrência.
            </p>
            @if (sources.non_receipts.truncated) {
              <p class="notice">Consulta limitada a 100 registros. Reduza o período ou selecione um local.</p>
            }
            @if (sources.non_receipts.records.length) {
              <div class="table-wrap" tabindex="0" role="region" aria-label="Ocorrências que sustentam os não recebimentos">
                <table>
                  <thead><tr><th>Ocorrência</th><th>Motivo</th><th>Registro</th></tr></thead>
                  <tbody>
                    @for (record of sources.non_receipts.records; track record.id) {
                      <tr>
                        <td>{{ dt(record.occurred_at) }}</td>
                        <td>{{ fieldLabel(record.reason) }}</td>
                        <td><a [routerLink]="['/nao-recebimentos', record.id]">Abrir ocorrência</a></td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p class="muted">Nenhum não recebimento registrado neste recorte.</p>
            }
          </details>
        }
        @for (w of o.warnings || []; track w) {
          <p class="notice section">{{ w }}</p>
        }
      </section>
    }
    @if (costs(); as c) {
      <section class="section">
        <h2>Custo dos boletins fechados</h2>
        <p class="muted">
          Resultados aplicados: {{ origin(c.origin) }} ·
          {{ date(c.period.date_from) }} a {{ date(c.period.date_to) }}.
        </p>
        <p class="muted">
          Piso aplicado a cada boletim antes de agregar. Pessoas distintas são
          contadas por matrícula; custos e frações não são deduplicados.
        </p>
        <p class="field-help">Os indicadores arredondam a soma dos valores exatos. A conciliação abaixo soma os centavos gravados por boletim; os totais podem diferir pelo arredondamento.</p>
        <div class="metric-grid">
          <app-metric-card
            label="Produção"
            [value]="money(c.summary.production)"
            hint="Valor oficial dos boletins fechados"
          />
          <app-metric-card
            label="Total a pagar"
            [value]="money(c.summary.total_payable)"
            hint="Piso aplicado por boletim"
            tone="brand"
          />
          <app-metric-card
            label="Complemento"
            [value]="money(c.summary.supplement)"
            [hint]="supplementHint(c.summary.supplement_share)"
            tone="info"
          />
          <app-metric-card
            label="Boletins abaixo do piso"
            [value]="show(c.summary.days_below_floor)"
            [hint]="show(c.summary.bulletin_count) + ' boletins fechados no período'"
            tone="warning"
          />
        </div>
        @if(c.presence;as p){<section class="panel section"><h3>Presença e utilização registradas</h3><div class="metric-grid"><app-metric-card label="Pessoas-dia previstas" [value]="show(p.planned)" hint="Atividade ainda prevista no dia" /><app-metric-card label="Pessoas-dia presentes" [value]="show(p.present)" hint="Presença confirmada no dia" /><app-metric-card label="Pessoas-dia utilizadas" [value]="show(p.used)" hint="Serviço confirmado no dia; separado de remuneração" /></div><p class="field-help">Cobertura: {{p.coverage}} pessoas-dia com atividade registrada. A mesma pessoa em dois dias conta duas vezes; atividades em vários locais no mesmo dia contam uma vez em cada indicador.</p></section>}
        @if(c.individuals;as individuals){<section class="panel section"><div class="page-head"><div><h3>Apuração por pessoa</h3><p class="muted">Produção atribuída e complemento de boletins fechados. Atuação por local permanece separada do armazém responsável pelo custo.</p></div><div class="actions"><ion-button fill="outline" (click)="exportIndividuals()" [disabled]="!individuals.records.length">Exportar pessoas</ion-button><ion-button fill="outline" (click)="print()">Imprimir</ion-button></div></div>@if(individuals.records.length){<div class="table-wrap" tabindex="0" role="region" aria-label="Custo individual por pessoa"><table><thead><tr><th>Pessoa</th><th>Diárias equivalentes</th><th>Produção atribuída</th><th>Complemento</th><th>Total</th><th>Armazéns do custo</th><th>Locais de atividade</th></tr></thead><tbody>@for(person of individuals.records;track person.worker){<tr><td><a [routerLink]="['/pessoas',person.worker]" [queryParams]="{date_from:c.period.date_from,date_to:c.period.date_to,origin:c.origin}">{{person.registration}} · {{person.name}}</a></td><td>{{decimal(person.equivalent_days)}}</td><td>{{money(person.display.production_attributed)}}</td><td>{{money(person.display.supplement)}}</td><td>{{money(person.display.total_payable)}}</td><td>{{names(person.cost_warehouses)}}</td><td>{{names(person.activity_warehouses)}}</td></tr>}</tbody></table></div>@if(individuals.truncated){<p class="notice">Exibindo {{individuals.returned_count}} de {{individuals.count}} pessoas. Reduza o período para exportar uma seleção completa.</p>}}@else{<p class="muted">Nenhuma parcela individual fechada disponível neste recorte.</p>}@if(c.reconciliation;as r){<dl class="metadata section"><div><dt>Soma das parcelas exibidas</dt><dd>{{money(r.individual_display_total)}}</dd></div><div><dt>Total coletivo do recorte</dt><dd>{{money(r.collective_display_total)}}</dd></div><div><dt>Diferença de conciliação</dt><dd>{{money(r.difference)}}</dd></div><div><dt>Boletins legados sem parcelas</dt><dd>{{r.legacy_bulletins_without_allocations}}</dd></div></dl>}</section>}
        <details class="section">
          <summary>Resumo financeiro completo</summary>
        <div class="table-wrap" tabindex="0" role="region" aria-label="Resumo financeiro completo dos boletins">
          <table class="finance">
            <thead>
              <tr>
                <th>Produção (P)</th>
                <th>Diárias (E)</th>
                <th>Total a pagar (T)</th>
                <th>Complemento (C)</th>
                <th>Complemento / total</th>
                <th>Boletins abaixo do piso</th>
                <th>Pessoas distintas</th>
                <th>Boletins</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{{ money(c.summary.production) }}</td>
                <td>{{ decimal(c.summary.equivalent_days) }}</td>
                <td>
                  <strong>{{ money(c.summary.total_payable) }}</strong>
                </td>
                <td>{{ money(c.summary.supplement) }}</td>
                <td>{{ percent(c.summary.supplement_share) }}</td>
                <td>{{ c.summary.days_below_floor }}</td>
                <td>{{ c.summary.people_count }}</td>
                <td>{{ c.summary.bulletin_count }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        </details>
        @if (c.groups.length) {
          <div class="table-wrap section" tabindex="0" role="region" aria-label="Comparação de custos por local e período">
            <table>
              <thead>
                <tr>
                  <th>Local / período</th>
                  <th class="numeric">Produção</th>
                  <th class="numeric">Diárias</th>
                  <th class="numeric">Total a pagar</th>
                  <th class="numeric">Complemento</th>
                  <th class="numeric">Complemento / total</th>
                  <th>Leitura do resultado</th>
                </tr>
              </thead>
              <tbody>
                @for (g of c.groups; track g.warehouse + g.period) {
                  <tr>
                    <td>
                      {{ g.warehouse_name }}<br /><small>{{
                        show(g.period)
                      }}</small>
                    </td>
                    <td class="numeric">{{ money(g.production) }}</td>
                    <td class="numeric">{{ decimal(g.equivalent_days) }}</td>
                    <td class="numeric">{{ money(g.total_payable) }}</td>
                    <td class="numeric">{{ money(g.supplement) }}</td>
                    <td class="numeric">{{ percent(g.supplement_share) }}</td>
                    <td class="wrap metric-description">{{ g.diagnosis }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <div app-empty-state class="empty section">
            Não há boletins fechados para esta origem e período. Não há base
            para concluir dimensionamento em reais.
          </div>
        }
        <details>
          <summary>Origem e cobertura financeira</summary>
          <dl class="metadata">
            @for (entry of entries(c.coverage); track entry[0]) {
              <div>
                <dt>{{ fieldLabel(entry[0]) }}</dt>
                <dd>{{ show(entry[1]) }}</dd>
              </div>
            }
          </dl>
        </details>
        @if (c.source_records; as sources) {
          <details class="section">
            <summary>Boletins que sustentam os custos</summary>
            <p class="muted">
              {{ sources.returned_count }} de {{ sources.count }} boletins
              fechados neste recorte. Abra o registro para conferir produção,
              participantes e precisão do cálculo.
            </p>
            @if (sources.truncated) {
              <p class="notice">
                A consulta mostra até 100 registros. Reduza o período ou
                selecione um local para conferir os demais boletins.
              </p>
            }
            @if (sources.records.length) {
              <div class="table-wrap" tabindex="0" role="region" aria-label="Boletins fechados que sustentam os custos">
                <table>
                  <thead>
                    <tr>
                      <th>Data / local</th>
                      <th class="numeric">Produção</th>
                      <th class="numeric">Diárias</th>
                      <th class="numeric">Total a pagar</th>
                      <th class="numeric">Complemento</th>
                      <th>Registro</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (record of sources.records; track record.id) {
                      <tr>
                        <td class="wrap">
                          {{ date(record.reference_date) }}<br />{{ record.warehouse_name }}
                        </td>
                        <td class="numeric">{{ money(record.production) }}</td>
                        <td class="numeric">{{ decimal(record.equivalent_days) }}</td>
                        <td class="numeric">{{ money(record.total_payable) }}</td>
                        <td class="numeric">{{ money(record.supplement) }}</td>
                        <td>
                          <a [routerLink]="['/boletins', record.id]">Abrir boletim</a>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p class="muted">Nenhum boletim fechado neste recorte.</p>
            }
          </details>
        }
        @for (w of c.warnings; track w) {
          <p class="notice section">{{ w }}</p>
        }
      </section>
    }
    <section class="panel section">
      <h2>Cenário condicional de diárias</h2>
      <p>
        Conserva a produção do boletim como hipótese e compara o total do
        servidor. A diferença não garante economia nem capacidade de
        atendimento.
      </p>
      <p class="muted">
        Capacidade operacional não avaliada: demanda atendida ou não atendida e
        recursos necessários estão indisponíveis. A diferença financeira não
        recomenda reduzir a equipe.
      </p>
      <form
        app-filter-block
        class="filters"
        [formGroup]="scenarioForm"
        (ngSubmit)="calculateScenario()"
      >
        <label
          >Boletim<select formControlName="bulletin">
            <option value="">Selecione um boletim</option>
            @for (b of bulletins(); track b.id) {
              <option [value]="b.id">
                {{ date(b.reference_date) }} · {{ b.warehouse_name }} ·
                {{ origin(b.origin) }}
              </option>
            }
          </select></label
        ><label
          >Diárias no cenário<input
            type="number"
            min="0"
            step="0.5"
            formControlName="equivalent_days" /></label
        ><ion-button
          type="submit"
          fill="outline"
          [disabled]="busy() || scenarioForm.invalid"
          >Calcular cenário</ion-button
        >
      </form>
      @if (scenario(); as s) {
        <p class="muted">
          Cenário calculado: {{ s.warehouse_name }} · {{ date(s.reference_date) }} ·
          {{ origin(s.origin) }}.
        </p>
        @if (s.origin === "demo_sintetico") {
          <p class="notice synthetic">
            Este cenário usa um boletim de demonstração sintética; não
            representa economia ou produtividade medida na Cocapec.
          </p>
        }
        <div class="notice">
          Diferença financeira condicional:
          <strong>{{ money(s.difference) }}</strong>
        </div>
        <div class="table-wrap" tabindex="0" role="region" aria-label="Comparação do boletim com o cenário condicional">
          <table>
            <thead>
              <tr>
                <th>Medida</th>
                <th>Boletim selecionado</th>
                <th>Cenário</th>
              </tr>
            </thead>
            <tbody>
              @for (e of scenarioEntries(s.current); track e[0]) {
                <tr>
                  <th>{{ fieldLabel(e[0]) }}</th>
                  <td>{{ scenarioValue(e[0], e[1]) }}</td>
                  <td>{{ scenarioValue(e[0], s.scenario[e[0]]) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <ul>
          @for (a of s.assumptions; track a) {
            <li>{{ a }}</li>
          }
        </ul>
      }
    </section>
    <p class="site-note">
      Não há uma série histórica de boletins por local nem tempos históricos
      medidos nos arquivos fornecidos. Complemento não prova ociosidade;
      complemento zero não prova dimensionamento adequado.
    </p>
  </div>`,
  styles: [`.bottleneck-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } .management-analysis { border-left-color:var(--blue); } .management-analysis h2 { display:flex; align-items:center; gap:10px; font-size:20px; } .management-analysis ion-icon { color:var(--blue); flex-shrink:0; } .ai-answer { white-space:pre-wrap; } @media(max-width:600px) { .bottleneck-grid { grid-template-columns:1fr; } }`],
})
export class Management implements OnInit, OnDestroy {
  constructor() { addIcons({ sparklesOutline }); }
  names(values:{name:string}[]){return values.map(v=>v.name).join(', ')||'Sem registro';}
  print(){window.print();}
  exportIndividuals(){const c=this.costs();if(!c?.individuals)return;exportCsv(`pessoas-${c.period.date_from}-${c.period.date_to}.csv`,[['Matrícula','Nome','Diárias equivalentes','Produção atribuída','Complemento','Total apurado','Armazéns do custo','Locais de atividade'],...c.individuals.records.map(p=>[p.registration,p.name,p.equivalent_days,p.display.production_attributed,p.display.supplement,p.display.total_payable,this.names(p.cost_warehouses),this.names(p.activity_warehouses)])]);}
  private api = inject(Api);
  catalog = inject(Catalog);
  private fb = inject(FormBuilder);
  filters = this.fb.nonNullable.group({
    date_from: [today().slice(0, 8) + "01", Validators.required],
    date_to: [today(), Validators.required],
    warehouse: [""],
    origin: ["operacional_registrado"],
  });
  scenarioForm = this.fb.nonNullable.group({
    bulletin: ["", Validators.required],
    equivalent_days: ["10.5", [Validators.required, Validators.min(0)]],
  });
  costs = signal<Costs | null>(null);
  balanceFilters = signal<BalanceFilters | null>(null);
  operations = signal<Operations | null>(null);
  scenario = signal<Scenario | null>(null);
  bulletins = signal<Bulletin[]>([]);
  error = signal("");
  busy = signal(false);
  filterError = signal("");
  costsError = signal("");
  operationsError = signal("");
  appliedFilters = signal<{date_from:string;date_to:string;warehouse:string;origin:string} | null>(null);
  aiAnswer = signal<{answer:string;context:{origin:string;period:{date_from:string;date_to:string}}} | null>(null);
  aiBusy = signal(false);
  aiAvailable = signal(false);
  aiError = signal("");
  aiNotice = signal("");
  private requestVersion = 0;
  private insightVersion = 0;
  private requestController?: AbortController;
  money = money;
  decimal = decimal;
  dt = dateTime;
  date = chartDateLabel;
  percent = (value: string | null) =>
    value === null
      ? "Não disponível"
      : new Intl.NumberFormat("pt-BR", {
          style: "percent",
          maximumFractionDigits: 2,
        }).format(Number(value));
  origin = originLabel;
  appliedWarehouseName() { const id=this.appliedFilters()?.warehouse; return id ? this.catalog.warehouses().find(w=>w.id===id)?.name ?? "Local selecionado" : "Todos os locais"; }
  private waitWinners() { return waitLeaders(this.operations()?.gate_wait_by_warehouse); }
  private supplementWinners() { const week=this.costs()?.weekly_supplement; return week?.groups.filter(row=>week.leaders.includes(row.warehouse)) ?? []; }
  waitHighlightValue() { const rows=this.waitWinners(); return rows.length ? waitDuration(rows[0].average_minutes!) : !this.operations() && this.busy() && !this.operationsError() ? "Consultando…" : "Não disponível"; }
  waitHighlightHint() {
    const rows=this.waitWinners();
    if(!rows.length) return this.operationsError() ? "Falha ao consultar a operação." : !this.operations() && this.busy() ? "Consultando a operação…" : "Sem espera válida atribuída ao primeiro destino neste recorte.";
    return `${rows.length>1 ? "Empate: " : ""}${rows.map(row=>`${row.warehouse_name} (${row.valid_records} ${row.valid_records===1 ? "observação válida" : "observações válidas"}; ${row.excluded_records} ${row.excluded_records===1 ? "excluída" : "excluídas"})`).join(", ")}. Portaria → primeiro armazém; cargas com saída no período.`;
  }
  supplementHighlightValue() {
    const week=this.costs()?.weekly_supplement;
    if(!week?.closed_bulletins) return !this.costs() && this.busy() && !this.costsError() ? "Consultando…" : "Não disponível";
    const rows=this.supplementWinners();
    return rows.length ? money(rows[0].supplement) : "Sem complemento";
  }
  supplementHighlightHint() {
    const week=this.costs()?.weekly_supplement;
    if(!week) return this.costsError() ? "Falha ao consultar os boletins." : this.busy() ? "Consultando os boletins…" : "Complemento semanal indisponível.";
    const period=`${this.date(week.period.date_from)} a ${this.date(week.period.date_to)}`;
    if(!week.closed_bulletins) return `${period} · Sem boletins fechados na janela.`;
    const rows=this.supplementWinners();
    const coverage=(count:number)=>`${count} ${count===1 ? "boletim fechado" : "boletins fechados"}`;
    return `${period} · ${rows.length ? `${rows.length>1 ? "Empate: " : ""}${rows.map(row=>`${row.warehouse_name} (${coverage(row.bulletin_count)})`).join(", ")}` : `${coverage(week.closed_bulletins)} sem complemento.`} Complemento não comprova ociosidade.`;
  }
  localAnalysis() {
    const statements:string[]=[];
    const c=this.costs();
    if(c?.summary.bulletin_count) statements.push(`${c.summary.bulletin_count===1 ? "O boletim fechado apura" : `Os ${c.summary.bulletin_count} boletins fechados apuram`} ${money(c.summary.production)} de produção e ${money(c.summary.total_payable)} a pagar, com ${money(c.summary.supplement)} de complemento.`);
    else statements.push(this.costsError() ? "A apuração financeira não pôde ser consultada." : !c && this.busy() ? "A consulta dos boletins fechados está em andamento." : "Não há boletins fechados que sustentem uma comparação financeira neste recorte.");
    const waits=this.waitWinners();
    if(waits.length) statements.push(`${waits.map(row=>row.warehouse_name).join(" e ")} ${waits.length>1 ? "compartilham a maior" : "tem a maior"} espera média após portaria: ${waitDuration(waits[0].average_minutes!)}. Verifique os recebimentos e os horários registrados antes de atribuir uma causa.`);
    else statements.push(this.operationsError() ? "A consulta de esperas falhou; o destaque operacional está indisponível." : !this.operations() && this.busy() ? "A consulta de esperas está em andamento." : "Não há espera válida por primeiro destino disponível neste recorte.");
    const week=c?.weekly_supplement, supplements=this.supplementWinners();
    if(week?.closed_bulletins && supplements.length) statements.push(`Entre ${this.date(week.period.date_from)} e ${this.date(week.period.date_to)}, ${supplements.map(row=>row.warehouse_name).join(" e ")} ${supplements.length>1 ? "compartilham o maior" : "tem o maior"} complemento: ${money(supplements[0].supplement)}.`);
    statements.push("Complemento do piso não comprova ociosidade. Dias e horários ausentes limitam a análise.");
    return statements.join(" ");
  }
  ngOnDestroy() { this.requestVersion++; this.insightVersion++; this.requestController?.abort(); }
  supplementHint(value: string | null) {
    return value === null
      ? "Participação no total não disponível"
      : `${this.percent(value)} do total a pagar`;
  }
  metric(key: string, unit = "") {
    const value = operationalMetric(this.operations(), key);
    return value === null
      ? "Não disponível"
      : `${this.show(value)}${unit ? " " + unit : ""}`;
  }
  medianHint(key: string, definition: string) {
    // A média sozinha é dominada por um horário digitado errado; a mediana mostra a espera típica.
    return operationalMetric(this.operations(), key) === null ? definition : `Mediana ${this.metric(key, "min")}. ${definition}`;
  }
  dateChart() {
    return chartItems(this.operations()?.["loads_by_date"], "date", chartDateLabel);
  }
  warehouseChart() {
    return chartItems(this.operations()?.["loads_by_warehouse"], "warehouse_name");
  }
  reasonChart() {
    return chartItems(
      this.operations()?.["non_receipts_by_reason"],
      "reason",
      (value) => this.fieldLabel(value),
    );
  }
  chartEmptyLabel(key: string, emptyLabel: string) {
    const value = this.operations()?.[key];
    return !Array.isArray(value) || value.length > 0
      ? "Medição não disponível para este recorte."
      : emptyLabel;
  }
  entries = (v: RecordData) => Object.entries(v);
  show = (v: unknown): string =>
    v === null || v === undefined
      ? "Não disponível"
      : Array.isArray(v)
        ? v.map((x) => this.show(x)).join(", ")
        : typeof v === "object"
          ? Object.entries(v as RecordData)
              .map(([k, x]) => `${this.fieldLabel(k)}: ${this.show(x)}`)
              .join(" · ")
          : typeof v === "boolean"
            ? v
              ? "Sim"
              : "Não"
            : typeof v === "number"
              ? new Intl.NumberFormat("pt-BR", {
                  maximumFractionDigits: 2,
                }).format(v)
              : typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
                ? this.date(v)
                : String(v);
  ngOnInit() {
    void this.catalog.load().catch((e) => this.error.set(apiError(e)));
    void this.load();
  }
  fieldLabel(k: string) {
    return (
      (
        {
          summary: "Resumo",
          distinct_departed_trucks: "Caminhões que saíram da unidade",
          valid_gate_wait: "Esperas medidas após entrada na unidade",
          excluded_gate_wait: "Registros sem espera medida após entrada",
          valid_total_stay: "Permanências totais medidas",
          excluded_total_stay: "Registros sem permanência total medida",
          worker_resource_coverage: "Cobertura de pessoas por descarga",
          equipment_resource_coverage: "Cobertura de equipamentos por descarga",
          planned: "Pessoas-dia previstas",
          present: "Pessoas-dia presentes",
          used: "Pessoas-dia utilizadas",
          warehouse_stays: "Permanência por armazém",
          average_minutes: "Permanência média (min)",
          visits: "Visitas medidas",
          departures: "Saídas da portaria",
          valid_total_stay_records: "Permanências totais medidas",
          valid_gate_wait_records: "Esperas após portaria medidas",
          excluded_gate_wait_records: "Esperas após portaria excluídas",
          unattributed_gate_wait_records: "Saídas sem primeiro armazém identificado",
          gate_wait_definition: "Critério da espera após portaria",
          excluded_warehouse_stays: "Visitas sem marcos suficientes",
          event_time_basis: "Data de referência dos eventos",
          coverage: "Cobertura",
          warehouse_name: "Armazém",
          warehouse: "Local",
          supplier_name: "Fornecedor",
          supplier: "Fornecedor",
          period: "Período",
          date: "Data",
          time: "Horário",
          origin: "Origem",
          source: "Fonte",
          production: "Produção",
          total_payable: "Total a pagar",
          supplement: "Complemento",
          equivalent_days: "Diárias equivalentes",
          people_count: "Pessoas distintas",
          bulletin_count: "Boletins",
          completed_count: "Caminhões concluídos",
          truck_count: "Caminhões",
          distinct_completed_trucks: "Caminhões concluídos distintos",
          arrival_count: "Chegadas",
          waiting_minutes: "Espera (min)",
          unloading_minutes: "Descarga (min)",
          mean_waiting_minutes: "Espera média (min)",
          mean_unloading_minutes: "Descarga média (min)",
          average_wait_minutes: "Espera média (min)",
          average_unload_minutes: "Descarga média (min)",
          average_unloading_minutes: "Descarga média (min)",
          average_workers_per_receipt: "Chapas médios por recebimento",
          received_loads: "Caminhões recebidos",
          loads_by_date: "Cargas por data",
          loads_by_warehouse: "Cargas por local",
          occupied_minutes: "Minutos ocupados",
          utilization_percent: "Utilização (%) indisponível",
          arrivals_by_hour: "Chegadas por hora",
          bookings_by_hour: "Agendamentos por hora",
          non_receipts_by_reason: "Não recebimentos por motivo",
          hour: "Hora",
          completed_records: "Registros concluídos",
          valid_wait_records: "Registros com espera válida",
          excluded_wait_records: "Registros sem espera válida",
          valid_unloading_records: "Registros com descarga válida",
          excluded_unloading_records: "Registros sem descarga válida",
          covered_dates: "Datas cobertas",
          covered_warehouses: "Locais cobertos",
          coverage_ratio: "Proporção de cobertura",
          expected_bulletins: "Boletins esperados",
          note: "Observação",
          rows: "Linhas documentais",
          purchase_orders: "Pedidos distintos",
          receipt_numbers: "Recebimentos documentais",
          by_depot: "Linhas por depósito",
          worker_count: "Chapas por descarga",
          equipment_name: "Equipamento",
          equipment: "Equipamento",
          reason: "Motivo",
          count: "Quantidade",
          value: "Valor",
          unit: "Unidade",
          definition: "Definição",
          denominator: "Denominador",
          warehouses: "Locais",
          by_warehouse: "Por armazém",
          by_supplier: "Por fornecedor",
          by_date: "Por data",
          by_slot: "Por horário",
          suppliers: "Fornecedores",
          non_receipts: "Não recebimentos",
          equipment_usage: "Equipamentos",
          completed_with_times: "Concluídos com horários",
          closed_bulletins: "Boletins fechados",
          draft_bulletins: "Boletins em rascunho",
          date_from: "Início do período",
          date_to: "Fim do período",
          supplement_share: "Participação do complemento",
          total: "Total",
          invoice_mismatch: "Divergência nota/pedido",
          unscheduled_no_capacity: "Sem agendamento e sem vaga",
          nature: "Caso fortuito",
          other: "Outro",
        } as Record<string, string>
      )[k] ?? "Informação adicional"
    );
  }
  operationGroups() {
    const data = this.operations();
    if (!data) return [];
    return Object.entries(data)
      .filter(
        ([, v]) => Array.isArray(v) && v.length > 0 && typeof v[0] === "object",
      )
      .map(([key, value]) => {
        const rows = value as RecordData[];
        return {
          key,
          rows,
          columns: Object.keys(rows[0]).filter(
            (k) =>
              !k.endsWith("_id") &&
              k !== "id" &&
              (rows[0][k] === null || typeof rows[0][k] !== "object") &&
              !["warehouse", "supplier", "equipment"].includes(k),
          ),
        };
      });
  }
  operationsSummary(): RecordData {
    const o = this.operations();
    if (!o) return {};
    return (
      o.summary ?? {
        received_loads: o.received_loads,
        average_wait_minutes: o.average_wait_minutes,
        average_unloading_minutes: o.average_unloading_minutes,
        average_workers_per_receipt: o.average_workers_per_receipt,
        ...(o.historical_documentary ?? {}),
      }
    );
  }
  scenarioEntries(v: RecordData) {
    return Object.entries(v).filter(([k]) =>
      ["production", "equivalent_days", "total_payable", "supplement"].includes(
        k,
      ),
    );
  }
  async load() {
    const values = this.filters.getRawValue();
    const validation = managementPeriodError(values.date_from, values.date_to);
    this.filterError.set(validation);
    if (validation) { this.filters.markAllAsTouched(); return; }
    const version = ++this.requestVersion;
    ++this.insightVersion;
    this.requestController?.abort();
    this.requestController = new AbortController();
    const signal = this.requestController.signal;
    this.busy.set(true);
    this.error.set("");
    this.costsError.set("");
    this.operationsError.set("");
    this.costs.set(null);
    this.operations.set(null);
    this.bulletins.set([]);
    this.appliedFilters.set(values);
    this.aiAnswer.set(null);
    this.aiBusy.set(false);
    this.aiError.set("");
    this.aiNotice.set("");
    this.aiAvailable.set(false);
    this.scenario.set(null);
    const { date_from, date_to, origin } = this.filters.getRawValue();
    this.balanceFilters.set({ date_from, date_to, origin });
    try {
      const q = new URLSearchParams();
      Object.entries(values).forEach(([k, v]) => {
        if (v) q.set(k, v);
      });
      await Promise.allSettled([
        this.api.get<Costs>(`analytics/labor-costs/?${q}`, signal).then(data => {
          if (version === this.requestVersion) this.costs.set(data);
        }).catch(e => { if (version === this.requestVersion) this.costsError.set(apiError(e)); }),
        this.api.get<Operations>(`analytics/operations/?${q}`, signal).then(data => {
          if (version === this.requestVersion) this.operations.set(data);
        }).catch(e => { if (version === this.requestVersion) this.operationsError.set(apiError(e)); }),
        this.api.get<{ results: Bulletin[] }>(
          `bulletins/?${q}&status=CLOSED&page_size=100`, signal,
        ).then(data => { if (version === this.requestVersion) this.bulletins.set(data.results); }),
      ]);
    } finally {
      if (version === this.requestVersion) {
        this.busy.set(false);
        void this.prepareInsight(version);
      }
    }
  }
  private async prepareInsight(version: number) {
    if (!this.api.can("management")) { this.aiNotice.set("Análise da IA disponível para Gestão e Administração."); return; }
    try {
      const result = await this.api.get<{capabilities:{assistant:{available:boolean}}}>("integrations/capabilities/", this.requestController?.signal);
      if (version !== this.requestVersion) return;
      this.aiAvailable.set(result.capabilities.assistant.available);
      if (!this.aiAvailable()) { this.aiNotice.set("IA externa desabilitada ou sem configuração. A síntese usa os indicadores consultados."); return; }
      // A fresh server context must not silently replace a failed/partial dashboard.
      if (this.costsError() || this.operationsError()) { this.aiNotice.set("A IA aguarda a consulta completa dos indicadores. Reaplique o período após a falha."); return; }
      if (!this.costs()?.summary.bulletin_count && !this.waitWinners().length) { this.aiNotice.set("A IA aguarda boletins fechados ou esperas medidas neste recorte."); return; }
      void this.generateInsight();
    } catch {
      if (version === this.requestVersion) this.aiNotice.set("Não foi possível verificar a disponibilidade da IA. Reaplique o período para tentar novamente.");
    }
  }
  async generateInsight() {
    const applied = this.appliedFilters();
    if (!applied || !this.aiAvailable() || !this.api.can("management") || this.aiBusy()) return;
    const version = ++this.insightVersion;
    this.aiBusy.set(true);
    this.aiError.set("");
    this.aiNotice.set("");
    try {
      const answer = await this.api.post<{answer:string;context:{origin:string;period:{date_from:string;date_to:string}}}>("integrations/assistant/", {
        date_from:applied.date_from, date_to:applied.date_to, origin:applied.origin, ...(applied.warehouse ? {warehouse:applied.warehouse} : {}),
        question:"Analise os gargalos deste recorte: maior espera após portaria por primeiro armazém e maior complemento na janela semanal fornecida. Informe empates, quantidade de observações e lacunas; sugira quais registros conferir, sem afirmar ociosidade ou economia. Responda em até dois parágrafos curtos.",
      });
      if (version === this.insightVersion) this.aiAnswer.set(answer);
    } catch (e) {
      if (version === this.insightVersion) this.aiError.set(`Análise da IA indisponível: ${apiError(e)}`);
    } finally {
      if (version === this.insightVersion) this.aiBusy.set(false);
    }
  }
  scenarioValue(k: string, v: unknown) {
    return [
      "production",
      "total_payable",
      "supplement",
      "collective_floor",
    ].includes(k)
      ? money(v)
      : k === "equivalent_days"
        ? decimal(v)
        : this.show(v);
  }
  async calculateScenario() {
    this.busy.set(true);
    this.error.set("");
    try {
      this.scenario.set(
        await this.api.post<Scenario>(
          "analytics/staffing-scenario/",
          this.scenarioForm.getRawValue(),
        ),
      );
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
}
