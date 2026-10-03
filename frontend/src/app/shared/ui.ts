import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";
import { IonIcon, IonSpinner } from "@ionic/angular/standalone";
import { ThemeService } from "../core/theme";

@Component({ selector: "app-brand", standalone: true, imports: [IonIcon], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="brand-mark" aria-hidden="true"><ion-icon name="leaf-outline" /></span><span class="brand-copy"><strong>Cocapec</strong><small>Recebimento</small></span>`,
})
export class BrandMark {}

@Component({ selector: "app-theme-toggle", standalone: true, imports: [IonIcon], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button class="icon-button theme-toggle" type="button" (click)="theme.toggle()" [attr.aria-label]="theme.mode() === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'" [attr.title]="theme.mode() === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'">@if (theme.mode() === 'dark') { <ion-icon name="sunny-outline" aria-hidden="true" /> } @else { <ion-icon name="moon-outline" aria-hidden="true" /> }</button>`,
})
export class ThemeToggle { readonly theme = inject(ThemeService); }

@Component({ selector: "app-page-header", standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<header class="page-head"><div class="page-title"><h1>{{ title() }}</h1>@if (subtitle()) { <p class="muted">{{ subtitle() }}</p> }</div><div class="actions page-head-actions"><ng-content /></div></header>`,
})
export class PageHeader { title = input.required<string>(); subtitle = input(""); }

@Component({ selector: "[app-filter-block]", standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content />`, host: { class: "filters" },
})
export class FilterBlock {}

@Component({ selector: "[app-empty-state]", standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content />`, host: { class: "empty" },
})
export class EmptyState {}

@Component({ selector: "[app-feedback]", standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content />`, host: { "[class]": "tone()", "[attr.role]": "tone() === 'error' ? 'alert' : 'status'" },
})
export class FeedbackState { tone = input<"error" | "success">("error"); }

@Component({ selector: "app-metric-card", standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<article [class]="'metric-card metric-' + tone()"><h3>{{ label() }}</h3><strong class="metric-value">{{ value() }}</strong>@if (hint()) { <p>{{ hint() }}</p> }</article>`,
})
export class MetricCard {
  label = input.required<string>(); value = input.required<string | number>(); hint = input("");
  tone = input<"default" | "brand" | "info" | "warning">("default");
}

@Component({ selector: "app-loading-state", standalone: true, imports: [IonSpinner], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="loading" role="status" aria-live="polite"><ion-spinner name="dots" /><span>{{ label() }}</span></div><div class="loading-skeleton" aria-hidden="true"><span></span><span></span><span></span></div>`,
})
export class LoadingState { label = input("Carregando…"); }

export interface ChartItem { label: string; value: number; }
@Component({ selector: "app-bar-chart", standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section class="chart-panel"><h3>{{ title() }}</h3>@if (description()) { <p class="field-help">{{ description() }}</p> }@if (items().length) { <ul class="bar-chart" [attr.aria-label]="title()">@for (item of items(); track $index) { <li><div class="bar-label"><span>{{ item.label }}</span><strong>{{ format(item.value) }}</strong></div><div class="bar-track" aria-hidden="true"><span [style.width.%]="width(item.value)"></span></div></li> }</ul><details><summary>Ver valores em tabela</summary><div class="table-wrap" tabindex="0" role="region" [attr.aria-label]="title()"><table><caption class="sr-only">{{ title() }}</caption><thead><tr><th>Referência</th><th class="numeric">Quantidade</th></tr></thead><tbody>@for (item of items(); track $index) { <tr><td class="wrap">{{ item.label }}</td><td class="numeric">{{ format(item.value) }}</td></tr> }</tbody></table></div></details> } @else { <p class="chart-empty">{{ emptyLabel() }}</p> }</section>`,
})
export class BarChart {
  title = input.required<string>(); description = input(""); items = input<readonly ChartItem[]>([]); emptyLabel = input("Sem registros neste recorte.");
  private max = computed(() => Math.max(0, ...this.items().map(item => item.value)));
  width(value: number) { return this.max() > 0 ? value / this.max() * 100 : 0; }
  format(value: number) { return new Intl.NumberFormat("pt-BR").format(value); }
}

@Component({ selector: "app-status", standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span [class]="'status ' + value().toLowerCase()"><span class="status-dot" aria-hidden="true"></span>{{ label() }}</span>`,
})
export class Status {
  value = input("pending");
  label() {
    return ({ pending: "Pendente", approved: "Aprovada", rejected: "Rejeitada", waiting: "Agendado", scheduled: "Agendado", arrived: "No pátio", unloading: "Em descarga", in_progress: "Em descarga", completed: "Concluído", cancelled: "Cancelado", not_received: "Não recebido", draft: "Rascunho", closed: "Fechado" } as Record<string, string>)[this.value().toLowerCase()] ?? this.value();
  }
}

@Component({ selector: "app-origin", standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (value() === "demo_sintetico") { <div class="notice synthetic">Demonstração sintética — este registro não descreve uma operação histórica da Cocapec.</div> } @else if (value() === "historico_importado") { <div class="notice info">Histórico importado. Consulte origem e cobertura antes de interpretar os resultados.</div> }`,
})
export class Origin { value = input(""); }
