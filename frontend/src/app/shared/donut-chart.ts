import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, input, signal, viewChild } from "@angular/core";
import { ArcElement, Chart, DoughnutController, Tooltip } from "chart.js";
import { ThemeService } from "../core/theme";
import type { ChartItem } from "../core/chart-data";

Chart.register(DoughnutController, ArcElement, Tooltip);

@Component({
  selector: "app-donut-chart", standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section class="chart-panel"><h3>{{ title() }}</h3><p class="field-help">{{ description() }}</p>
    @if (total() > 0) {
      <div class="donut-canvas"><canvas #canvas role="img" [attr.aria-label]="title() + '. Valores disponíveis na legenda e na tabela.'"></canvas></div>
      <ul class="donut-legend" [attr.aria-label]="title()">
        @for (item of items(); track $index; let index = $index) {
          <li><span class="donut-key" [style.background-color]="color(index)" aria-hidden="true"></span><span class="donut-label">{{ item.label }}</span><strong>{{ number(item.value) }} <small>({{ share(item.value) }})</small></strong></li>
        }
      </ul>
      <details><summary>Ver valores em tabela</summary><div class="table-wrap" tabindex="0" role="region" [attr.aria-label]="title()"><table>
        <caption class="sr-only">{{ title() }}; percentuais sobre associações carga–destino</caption>
        <thead><tr><th>Armazém</th><th class="numeric">Cargas</th><th class="numeric">Participação</th></tr></thead>
        <tbody>@for (item of items(); track $index) {<tr><td class="wrap">{{ item.label }}</td><td class="numeric">{{ number(item.value) }}</td><td class="numeric">{{ share(item.value) }}</td></tr>}</tbody>
      </table></div></details>
    } @else { <p class="chart-empty">Nenhum destino registrado para as cargas concluídas no período.</p> }
  </section>`,
  styles: `:host { min-width: 0; } .donut-canvas { position: relative; height: 200px; margin: 20px auto; max-width: 300px; }
    .donut-legend { list-style: none; padding: 0; display: grid; gap: 12px; margin: 20px 0; }
    .donut-legend li { display: grid; grid-template-columns: 12px minmax(0, 1fr) auto; align-items: baseline; gap: 10px; font-size: 14px; }
    .donut-key { width: 12px; height: 12px; border-radius: 2px; }
    .donut-label { overflow-wrap: anywhere; }
    .donut-legend strong { font-variant-numeric: tabular-nums; } .donut-legend small { font-weight: 400; color: var(--muted); }
    @media (max-width: 420px) { .donut-legend strong { grid-column: 2; } }`,
})
export class DonutChart {
  title = input.required<string>();
  description = input("");
  items = input<readonly ChartItem[]>([]);
  readonly total = computed(() => this.items().reduce((sum, item) => sum + item.value, 0));
  private canvas = viewChild<ElementRef<HTMLCanvasElement>>("canvas");
  private theme = inject(ThemeService);
  private palette = signal<string[]>([]);
  private chart?: Chart<"doughnut", number[], string>;
  readonly number = (value: number) => new Intl.NumberFormat("pt-BR").format(value);
  share(value: number) { return new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 }).format(value / this.total()); }
  color(index: number) { const colors = this.palette(); return colors[index % colors.length] ?? ""; }

  constructor() {
    afterRenderEffect(() => {
      this.theme.mode();
      const element = this.canvas()?.nativeElement;
      const items = this.items();
      if (!element || !this.total()) { this.chart?.destroy(); this.chart = undefined; return; }
      const css = getComputedStyle(element);
      const palette = ["--green", "--blue", "--muted", "--text", "--control-line"].map(token => css.getPropertyValue(token).trim());
      this.palette.set(palette);
      const dataset = { data: items.map(item => item.value), backgroundColor: items.map((_, index) => palette[index % palette.length]), borderColor: css.getPropertyValue("--surface").trim(), borderWidth: 2 };
      const labels = items.map(item => item.label);
      if (this.chart) {
        this.chart.data.labels = labels;
        this.chart.data.datasets = [dataset];
        this.chart.update("none");
      } else {
        this.chart = new Chart(element, {
          type: "doughnut", data: { labels, datasets: [dataset] },
          options: { responsive: true, maintainAspectRatio: false, animation: false, cutout: "65%",
            plugins: { tooltip: { callbacks: { label: context => `${context.label}: ${this.number(context.parsed)} cargas (${this.share(context.parsed)})` } } },
          },
        });
      }
    });
    inject(DestroyRef).onDestroy(() => this.chart?.destroy());
  }
}
