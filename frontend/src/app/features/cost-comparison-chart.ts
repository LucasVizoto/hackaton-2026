import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";
import { money } from "../core/api";
import { costChart, DailyCost } from "../core/cost-chart";
import { chartDateLabel } from "../core/chart-data";

@Component({
  selector: "app-cost-comparison-chart", standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section class="chart-panel" aria-labelledby="cost-comparison-title">
    <h2 id="cost-comparison-title">Valor produzido × total a pagar</h2><p class="field-help">Apuração diária dos boletins fechados. A faixa entre as linhas é o complemento do piso.</p>
    @if (drawing().measuredDays) {
      <ul class="comparison-legend" aria-label="Legenda do gráfico"><li><span class="legend-line produced" aria-hidden="true"></span>Valor produzido</li><li><span class="legend-line payable" aria-hidden="true"></span>Total a pagar</li><li><span class="legend-area" aria-hidden="true"></span>Complemento do piso</li></ul>
      <div class="comparison-scroll" tabindex="0" role="region" aria-label="Gráfico diário em reais; role horizontalmente em telas estreitas">
        <svg viewBox="0 0 800 250" role="img" aria-labelledby="cost-svg-title cost-svg-description">
          <title id="cost-svg-title">Produção e total a pagar por dia, em reais</title><desc id="cost-svg-description">{{drawing().measuredDays}} dias com boletins fechados. Dias sem boletim interrompem as linhas. Os valores completos estão na tabela abaixo.</desc>
          @for (tick of drawing().ticks; track tick.y) {<line x1="88" x2="776" [attr.y1]="tick.y" [attr.y2]="tick.y" class="comparison-grid"/><text x="78" [attr.y]="tick.y + 4" text-anchor="end">{{axisMoney(tick.value)}}</text>}
          @for (segment of drawing().segments; track $index) {
            @if (segment.area) {<path [attr.d]="segment.area" class="comparison-area"/>}
            <path [attr.d]="segment.payable" class="comparison-line payable"/><path [attr.d]="segment.production" class="comparison-line produced"/>
            @for (point of segment.points; track point.row.date) {
              @if (segment.points.length === 1) {<line [attr.x1]="point.x" [attr.x2]="point.x" [attr.y1]="point.productionY" [attr.y2]="point.payableY" class="comparison-isolated"/>}
              <circle [attr.cx]="point.x" [attr.cy]="point.payableY" r="3.5" class="comparison-dot payable"><title>{{date(point.row.date)}} · Total a pagar: {{money(point.row.total_payable)}}</title></circle>
              <circle [attr.cx]="point.x" [attr.cy]="point.productionY" r="2.5" class="comparison-dot produced"><title>{{date(point.row.date)}} · Valor produzido: {{money(point.row.production)}}</title></circle>
            }
          }
          @for (item of drawing().dates; track item.date) {<text [attr.x]="item.x" y="238" [attr.text-anchor]="$last && drawing().dates.length > 1 ? 'end' : 'middle'">{{date(item.date)}}</text>}
        </svg>
      </div>
      <p class="field-help">Cobertura: {{drawing().measuredDays}} / {{series().length}} dias com boletim fechado. Ausência de boletim não é custo zero. Total a pagar não confirma pagamento efetivado.</p>
      <details><summary>Ver valores diários em tabela</summary><div class="table-wrap" tabindex="0" role="region" aria-label="Valores diários de produção e custo"><table><thead><tr><th>Data</th><th class="numeric">Valor produzido</th><th class="numeric">Total a pagar</th><th class="numeric">Complemento</th><th>Boletins</th></tr></thead><tbody>@for (row of series(); track row.date) {<tr><td>{{date(row.date)}}</td><td class="numeric">{{money(row.production)}}</td><td class="numeric">{{money(row.total_payable)}}</td><td class="numeric">{{money(row.supplement)}}</td><td>{{row.bulletin_count || 'Sem boletim fechado'}}</td></tr>}</tbody></table></div></details>
    } @else {<p class="chart-empty">Sem boletins fechados neste período e origem. A comparação financeira está indisponível.</p>}
  </section>`,
  styles: [`
    :host { display:block; } h2 { font-size:20px; margin:0 0 8px; }
    .comparison-legend { display:flex; flex-wrap:wrap; gap:12px 24px; list-style:none; padding:0; margin:18px 0 6px; font-size:13px; }
    .comparison-legend li { display:flex; align-items:center; gap:8px; }
    .legend-line { width:24px; border-top:3px solid var(--green); } .legend-line.payable { border-color:var(--blue); border-top-style:dashed; }
    .legend-area { width:20px; height:12px; background:var(--warning-soft); border:1px solid var(--warning); }
    .comparison-scroll { overflow-x:auto; } svg { display:block; width:100%; min-width:560px; }
    svg text { font-size:12px; fill:var(--muted); font-family:var(--font-body); }
    .comparison-grid { stroke:var(--line); stroke-width:1; }
    .comparison-area { fill:var(--warning-soft); } .comparison-line { fill:none; stroke-width:2.5; stroke-linejoin:round; }
    .comparison-line.produced { stroke:var(--green); } .comparison-line.payable { stroke:var(--blue); stroke-dasharray:7 4; }
    .comparison-dot.produced { fill:var(--green); } .comparison-dot.payable { fill:var(--surface); stroke:var(--blue); stroke-width:2; }
    .comparison-isolated { stroke:var(--warning); stroke-width:2; } details { margin-top:16px; }
    @media(max-width:900px) { svg text { font-size:17px; } }
  `],
})
export class CostComparisonChart {
  series = input.required<readonly DailyCost[]>();
  drawing = computed(() => costChart(this.series()));
  money = money;
  date = chartDateLabel;
  axisMoney(value: number) { return new Intl.NumberFormat("pt-BR", { style:"currency", currency:"BRL", notation:"compact", maximumFractionDigits:1 }).format(value); }
}
