import { ChangeDetectionStrategy, Component, inject, OnInit, ViewEncapsulation } from "@angular/core";
import { RouterLink } from "@angular/router";
import { IonButton } from "@ionic/angular/standalone";
import { LogisticsState } from "../core/logistics";
import { chartDateLabel, chartItems } from "../core/chart-data";
import { BarChart, EmptyState, FeedbackState, LoadingState, MetricCard, PageHeader } from "../shared/ui";
import { DonutChart } from "../shared/donut-chart";

@Component({ standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: "./logistics.scss",
  providers: [LogisticsState],
  imports: [RouterLink, IonButton, PageHeader, MetricCard, BarChart, DonutChart, LoadingState, FeedbackState, EmptyState],
  template: `<div class="page logistics-page">
    <app-page-header title="Logística e Entregas">
      <a routerLink="/gestao">Voltar à Gestão</a><ion-button type="button" [disabled]="busy()" (click)="load()">{{ busy() && snapshot() ? 'Atualizando…' : 'Atualizar' }}</ion-button>
    </app-page-header>
    @if (error()) { <div app-feedback tone="error">{{ error() }} @if (snapshot()) { Os valores abaixo são da última consulta concluída. }</div> }
    <p role="status" class="sr-only">@if (busy() && snapshot()) { Atualizando indicadores. }</p>
    @if (busy() && !snapshot()) { <app-loading-state label="Consultando logística e entregas…" /> }
    @if (snapshot(); as data) {
      <div class="logistics-data" [attr.aria-busy]="busy()">
      <div class="muted logistics-reference"><p>Operação registrada · Referência: {{ date(data.reference_date) }}</p><p role="status">Última consulta: {{ timestamp(data.generated_at) }} · Brasília</p></div>
      <h2 class="sr-only">Indicadores da operação</h2>
      <div class="metric-grid logistics-metrics">
        <app-metric-card label="Cargas Recebidas Hoje" [value]="number(data.summary.received_today)" hint="Concluídas hoje; cada carga conta uma vez" tone="brand" />
        <app-metric-card label="Pessoas que passaram na portaria" [value]="number(data.summary.driver_entries_today)" hint="Entradas de motoristas hoje; dois recebimentos da mesma pessoa contam duas passagens" />
        <app-metric-card label="Caminhões em Fila" [value]="number(data.summary.trucks_in_queue)" hint="Na unidade, aguardando a primeira descarga; inclui chegadas de dias anteriores" />
      </div>
      @if (data.coverage.driver_entries_without_name || data.coverage.completed_without_destination) {
        <aside class="notice logistics-coverage" aria-label="Cobertura dos indicadores">
          @if (data.coverage.driver_entries_without_name) { <p>{{ number(data.coverage.driver_entries_without_name) }} {{ data.coverage.driver_entries_without_name === 1 ? 'entrada hoje sem nome de motorista: excluída' : 'entradas hoje sem nome de motorista: excluídas' }} do indicador de pessoas.</p> }
          @if (data.coverage.completed_without_destination) { <p>{{ number(data.coverage.completed_without_destination) }} {{ data.coverage.completed_without_destination === 1 ? 'carga concluída nos sete dias sem destino: incluída' : 'cargas concluídas nos sete dias sem destino: incluídas' }} nas barras, fora da rosca.</p> }
        </aside>
      }
      <div class="logistics-period"><h2>Cargas nos últimos 7 dias</h2><p class="muted">{{ date(data.period.date_from) }} a {{ date(data.period.date_to) }} · Por data de conclusão</p></div>
      @if (!hasCompletedLoads()) { <div app-empty-state>Nenhuma carga concluída nos últimos sete dias.</div> }
      <div class="chart-grid logistics-charts">
        <app-bar-chart title="Cargas recebidas por dia" description="Cada carga conta uma vez. Dias sem conclusões aparecem com zero." [items]="dateItems()" />
        <app-donut-chart title="Cargas por armazém de destino" description="Uma carga pode atender vários armazéns. Percentuais sobre o total de associações carga–destino." [items]="destinationItems()" />
      </div>
      </div>
    } @else if (!busy() && error()) { <p class="muted">Os indicadores ainda não foram consultados. Use Atualizar para tentar novamente.</p> }
  </div>`,
})
export class Logistics implements OnInit {
  private state = inject(LogisticsState);
  readonly snapshot = this.state.snapshot;
  readonly busy = this.state.busy;
  readonly error = this.state.error;
  readonly date = chartDateLabel;
  readonly number = (value: number) => new Intl.NumberFormat("pt-BR").format(value);
  readonly timestamp = (value: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
  dateItems() { return chartItems(this.snapshot()?.loads_by_date, "date", chartDateLabel); }
  destinationItems() { return chartItems(this.snapshot()?.loads_by_warehouse, "warehouse_name"); }
  hasCompletedLoads() { return this.snapshot()?.loads_by_date.some(item => item.count > 0) ?? false; }
  ngOnInit() { void this.load(); }
  load() { return this.state.load(); }
}
