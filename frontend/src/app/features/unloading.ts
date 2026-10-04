import { ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, OnInit, signal, viewChild } from "@angular/core";
import { NgTemplateOutlet } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { IonButton } from "@ionic/angular/standalone";
import { Api, apiError, localTimestamp, nowLocal, today } from "../core/api";
import {
  clockTime, crewCoverage, filterByWarehouse, groupByStage, nextStep, shiftDate, UnloadBoard, UnloadItem, UnloadStep, warehousesOf,
} from "../core/unloading";
import { EmptyState, FeedbackState, LoadingState, MetricCard, PageHeader } from "../shared/ui";
import { Crew, VisitCrew } from "./visit-crew";

const ORIGINS: [string, string][] = [["operacional_registrado", "Operação"], ["demo_sintetico", "Demonstração"]];

/**
 * Descarga do dia: cada caminhão em cada armazém, quem está descarregando e com qual equipamento.
 * O painel lateral conduz a etapa inteira — equipe, entrada e saída — sem sair da tela.
 */
@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, FormsModule, RouterLink, IonButton, EmptyState, FeedbackState, LoadingState, MetricCard, PageHeader, VisitCrew],
  styles: [`
    .unload-bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin-bottom: 4px; }
    .day-nav { display: flex; align-items: end; gap: 6px; }
    .day-nav label { min-width: 160px; }
    .day-nav button, .step-link { min-height: 44px; min-width: 44px; padding: 0 12px; border: 1px solid var(--control-line); border-radius: var(--radius-control); background: var(--surface); color: var(--text); font: inherit; font-weight: 600; cursor: pointer; }
    .crew-alert { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; }
    .crew-alert p { margin: 0; }
    .stage-title { display: flex; align-items: baseline; gap: 8px; margin: 28px 0 10px; font-size: 17px; }
    .stage-title small { color: var(--muted); font-size: 14px; font-weight: 600; }
    .unload-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
    .unload-card { display: grid; grid-template-columns: 64px minmax(0, 1fr) auto; gap: 4px 16px; align-items: center; padding: 14px 16px; border: 1px solid var(--line); border-left: 4px solid var(--line); border-radius: var(--radius-card); background: var(--surface); }
    .unload-card.is-running { border-left-color: var(--green); }
    .unload-card.is-ready { border-left-color: var(--blue); }
    .unload-card.is-done { background: var(--surface-subtle); }
    .unload-time { display: grid; font-variant-numeric: tabular-nums; }
    .unload-time strong { font-size: 18px; }
    .unload-time small, .unload-meta, .unload-reason { color: var(--muted); font-size: 13px; }
    .unload-body { display: grid; gap: 2px; min-width: 0; }
    .unload-title { justify-self: start; padding: 0; border: 0; background: none; color: var(--text); font: inherit; font-weight: 700; text-align: left; cursor: pointer; overflow-wrap: anywhere; }
    .unload-title:hover { color: var(--green); text-decoration: underline; }
    .unload-meta, .unload-crew, .unload-reason { margin: 0; overflow-wrap: anywhere; }
    .unload-crew { font-size: 14px; }
    .unload-crew strong { font-weight: 700; }
    .tone-short strong { color: var(--warning); }
    .tone-none strong { color: var(--danger); }
    .plate { font-variant-numeric: tabular-nums; color: var(--blue); font-weight: 600; }
    details.done-group > summary { cursor: pointer; list-style: none; }
    details.done-group > summary::-webkit-details-marker { display: none; }
    details.done-group > summary .stage-title::after { content: "Mostrar"; margin-left: auto; color: var(--blue); font-size: 14px; }
    details.done-group[open] > summary .stage-title::after { content: "Ocultar"; }
    .stage-empty { margin: 0; color: var(--muted); font-size: 14px; }
    .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 0; padding: 0; list-style: none; counter-reset: step; }
    .steps li { display: grid; gap: 6px; color: var(--muted); font-size: 13px; font-weight: 600; counter-increment: step; }
    .steps li::before { content: ""; height: 4px; border-radius: var(--radius-full); background: var(--line); }
    .steps li.is-done::before { background: var(--green); }
    .steps li[aria-current="step"] { color: var(--text); }
    .steps li[aria-current="step"]::before { background: var(--blue); }
    .sheet-sub { margin: 4px 0 0; color: var(--muted); font-size: 14px; }
    .step-box { display: grid; gap: 12px; padding: 16px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface-subtle); }
    .step-box h3 { margin: 0; font-size: 16px; }
    .step-box p { margin: 0; }
    .counter { display: inline-grid; grid-template-columns: 44px 64px 44px; align-items: center; border: 1px solid var(--control-line); border-radius: var(--radius-control); overflow: hidden; background: var(--surface); }
    .counter button { min-height: 44px; border: 0; background: transparent; color: var(--green); font: inherit; font-size: 20px; font-weight: 700; cursor: pointer; }
    .counter input { min-height: 44px; border: 0; border-inline: 1px solid var(--line); border-radius: 0; text-align: center; font-variant-numeric: tabular-nums; }
    .timing summary { cursor: pointer; color: var(--blue); font-size: 14px; font-weight: 600; min-height: 32px; }
    .done-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 0; }
    .done-facts dt { color: var(--muted); font-size: 13px; }
    .done-facts dd { margin: 0; font-weight: 700; font-variant-numeric: tabular-nums; }
    @media (max-width: 640px) {
      .unload-card { grid-template-columns: 52px minmax(0, 1fr); }
      .unload-card ion-button { grid-column: 1 / -1; width: 100%; }
    }
  `],
  template: `<div class="page">
  <app-page-header title="Descarga" subtitle="Quem descarrega cada caminhão e com qual equipamento. Toque numa descarga para escalar a equipe e registrar entrada e saída.">
    <ion-button fill="outline" [disabled]="loading()" (click)="load()">{{ loading() && board() ? "Atualizando…" : "Atualizar" }}</ion-button>
  </app-page-header>

  <div class="unload-bar">
    <div class="day-nav">
      <button type="button" aria-label="Dia anterior" (click)="goDay(-1)">‹</button>
      <label>Dia<input type="date" [ngModel]="date()" (ngModelChange)="setDate($event)" /></label>
      <button type="button" aria-label="Próximo dia" (click)="goDay(1)">›</button>
      @if (date() !== todayDate) { <button type="button" (click)="setDate(todayDate)">Hoje</button> }
    </div>
    @if (warehouses().length > 1) {
      <label>Armazém<select [ngModel]="warehouse()" (ngModelChange)="setWarehouse($event)"><option value="">Todos</option>@for (w of warehouses(); track w.id) { <option [value]="w.id">{{ w.name }}</option> }</select></label>
    }
    <div class="segmented" role="group" aria-label="Origem dos dados">@for (o of origins; track o[0]) {
      <button type="button" [attr.aria-pressed]="origin() === o[0]" (click)="setOrigin(o[0])">{{ o[1] }}</button> }</div>
  </div>

  @if (origin() === "demo_sintetico") { <div class="notice synthetic">Demonstração sintética: estas descargas não descrevem a operação real.</div> }
  @if (error()) { <div app-feedback tone="error">{{ error() }}</div> }
  @if (success()) {
    <div app-feedback tone="success">{{ success() }}@if (followUp(); as next) { <button type="button" class="link-button" (click)="open(next)">Abrir etapa no {{ next.warehouse_name }}</button> }</div>
  }

  @if (!board() && loading()) { <app-loading-state label="Carregando descargas do dia…" /> }
  @if (board(); as b) {
    <div class="metric-grid">
      <app-metric-card label="Em descarga" [value]="b.summary.running" [hint]="b.summary.chapas_now + (b.summary.chapas_now === 1 ? ' chapa trabalhando agora' : ' chapas trabalhando agora')" tone="brand" />
      <app-metric-card label="Prontas para entrar" [value]="b.summary.ready" hint="Liberadas pela portaria e por Compras" tone="info" />
      <app-metric-card label="Aguardando liberação" [value]="b.summary.waiting" hint="Portaria, Compras ou etapa anterior" />
      <app-metric-card label="Concluídas" [value]="b.summary.done" hint="Saída do armazém registrada" />
    </div>

    @if (canOperate && firstWithoutCrew(); as pending) {
      <div class="notice crew-alert" role="status">
        <p><strong>{{ b.summary.without_crew }} {{ b.summary.without_crew === 1 ? "descarga ainda sem equipe" : "descargas ainda sem equipe" }}.</strong> A próxima é {{ pending.supplier }} às {{ pending.slot }}.</p>
        <ion-button size="small" (click)="open(pending, 'crew')">Escalar agora</ion-button>
      </div>
    }

    @if (!visible().length) {
      <div app-empty-state>
        @if (b.items.length) { <p>Nenhuma descarga neste armazém no dia.</p><ion-button fill="outline" (click)="setWarehouse('')">Ver todos os armazéns</ion-button> }
        @else { <h2>Nenhuma descarga com destino confirmado</h2><p>As descargas aparecem aqui quando o Armazém confirma os destinos do agendamento.</p><a routerLink="/agenda">Abrir a agenda</a> }
      </div>
    } @else {
      @for (group of groups(); track group.code) {
        @if (group.code === "done") {
          @if (group.items.length) {
            <details class="done-group" [open]="!activeCount()">
              <summary><h2 class="stage-title">{{ group.title }} <small>{{ group.items.length }}</small></h2></summary>
              <ng-container [ngTemplateOutlet]="list" [ngTemplateOutletContext]="{ $implicit: group.items }" />
            </details>
          }
        } @else if (group.items.length) {
          <h2 class="stage-title">{{ group.title }} <small>{{ group.items.length }}</small></h2>
          <ng-container [ngTemplateOutlet]="list" [ngTemplateOutletContext]="{ $implicit: group.items }" />
        }
      }
    }
  }

  <ng-template #list let-items>
    <ul class="unload-list">
      @for (item of items; track item.visit) {
        @let coverage = coverageOf(item);
        @let step = stepOf(item);
        <li class="unload-card" [class]="'unload-card is-' + item.stage">
          <div class="unload-time"><strong>{{ item.slot }}</strong>
            @if (item.stage === "running") { <small>desde {{ clock(item.checked_in_at) }}</small> }
            @else if (item.stage === "done") { <small>saiu {{ clock(item.checked_out_at) }}</small> }</div>
          <div class="unload-body">
            <button type="button" class="unload-title" (click)="open(item)">{{ item.supplier }}</button>
            <p class="unload-meta">{{ item.warehouse_name }}@if (item.stages > 1) { · etapa {{ item.sequence }} de {{ item.stages }} } · {{ item.packaging_label }}@if (item.vehicle_plate) { · <span class="plate">{{ item.vehicle_plate }}</span> }</p>
            <p class="unload-crew" [class]="'unload-crew tone-' + coverage.tone"><strong>{{ coverage.text }}</strong>@if (item.crew.length) { · {{ names(item) }} }</p>
            @if (item.equipment.length) { <p class="unload-meta">Equipamento: {{ equipmentNames(item) }}</p> }
            @if (item.waiting_reason) { <p class="unload-reason">{{ item.waiting_reason }}</p> }
          </div>
          <ion-button size="small" [fill]="step.step === 'view' ? 'outline' : 'solid'" (click)="open(item, step.step)" [attr.aria-label]="step.label + ' · ' + item.supplier + ' no ' + item.warehouse_name">{{ step.label }}</ion-button>
        </li>
      }
    </ul>
  </ng-template>

  <dialog #sheet class="sheet" aria-labelledby="unload-sheet-title" (close)="closed()">
    @if (selected(); as item) {
      <form (ngSubmit)="submit()">
        <header class="sheet-head"><div><h2 id="unload-sheet-title">{{ item.supplier }}</h2>
          <p class="sheet-sub">{{ item.slot }} · {{ item.warehouse_name }}@if (item.stages > 1) { · etapa {{ item.sequence }} de {{ item.stages }} }@if (item.vehicle_plate) { · {{ item.vehicle_plate }} }</p></div>
          <button type="button" class="link-button" (click)="close()">Fechar</button></header>
        <div class="sheet-body">
          <ol class="steps" aria-label="Etapas da descarga">
            <li [class.is-done]="item.crew.length > 0 || item.stage !== 'waiting' && item.stage !== 'ready'" [attr.aria-current]="(item.stage === 'waiting' || item.stage === 'ready') && !item.crew.length ? 'step' : null">Equipe</li>
            <li [class.is-done]="!!item.checked_in_at" [attr.aria-current]="item.stage === 'ready' && item.crew.length ? 'step' : null">Entrada</li>
            <li [class.is-done]="!!item.checked_out_at" [attr.aria-current]="item.stage === 'running' ? 'step' : null">Saída</li>
          </ol>
          @if (sheetError()) { <div app-feedback tone="error">{{ sheetError() }}</div> }
          @if (sheetSuccess()) { <div app-feedback tone="success">{{ sheetSuccess() }}</div> }

          @if (item.stage === "waiting") {
            <div class="notice info"><strong>{{ item.waiting_reason }}</strong> Você já pode escalar a equipe; a entrada é liberada quando a pendência for resolvida.
              <a [routerLink]="['/agenda', item.appointment]">Abrir recebimento</a></div>
          }

          @if (item.stage === "ready" && canOperate) {
            <section class="step-box" aria-labelledby="checkin-title">
              <h3 id="checkin-title">Entrada no armazém</h3>
              @if (!item.crew.length) { <p class="field-help">Ninguém escalado ainda. Escale abaixo ou registre a entrada e ajuste a equipe depois.</p> }
              @if (crewDirty()) { <p class="field-help field-error">Salve a equipe antes de registrar a entrada.</p> }
              <ng-container [ngTemplateOutlet]="timing" />
              @if (!item.actions["check-in"]?.allowed) { <p class="field-help">{{ item.actions["check-in"]?.reason }}</p> }
              <ion-button type="submit" expand="block" [disabled]="busy() || crewDirty() || !item.actions['check-in']?.allowed">{{ busy() ? "Registrando…" : "Registrar entrada " + (customTime() ? "" : "agora") }}</ion-button>
            </section>
          }

          @if (item.stage === "running" && canOperate) {
            <section class="step-box" aria-labelledby="checkout-title">
              <h3 id="checkout-title">Saída do armazém</h3>
              @if (item.actions["check-out"]?.allowed) {
                <div class="segmented-field">Chapas que trabalharam
                  <div class="counter">
                    <button type="button" aria-label="Menos um chapa" (click)="setWorkers(workers() - 1)">−</button>
                    <input type="number" inputmode="numeric" min="0" max="100" aria-label="Chapas que trabalharam" [ngModel]="workers()" (ngModelChange)="setWorkers($event)" name="workers" />
                    <button type="button" aria-label="Mais um chapa" (click)="setWorkers(workers() + 1)">+</button>
                  </div>
                </div>
                <p class="field-help">Veio da equipe escalada ({{ item.crew.length }}). Corrija se alguém saiu ou chegou depois.</p>
                <p>Equipamento: <strong>{{ checkoutEquipmentText() }}</strong></p>
                @if (crewDirty()) { <p class="field-help field-error">Salve a equipe antes de registrar a saída.</p> }
                <ng-container [ngTemplateOutlet]="timing" />
                <ion-button type="submit" expand="block" [disabled]="busy() || crewDirty()">{{ busy() ? "Registrando…" : checkoutLabel() }}</ion-button>
              } @else {
                <p>{{ item.actions["check-out"]?.reason || "Saída indisponível no momento." }}</p>
                <a [routerLink]="['/agenda', item.appointment]">Abrir conferência do recebimento</a>
              }
            </section>
          }

          @if (item.stage === "done") {
            <dl class="done-facts">
              <div><dt>Entrada</dt><dd>{{ clock(item.checked_in_at) }}</dd></div>
              <div><dt>Saída</dt><dd>{{ clock(item.checked_out_at) }}</dd></div>
              <div><dt>Chapas</dt><dd>{{ item.worker_count ?? "—" }}</dd></div>
            </dl>
          }

          <app-visit-crew [visitId]="item.visit" [canEdit]="canOperate" (changed)="crewChanged($event)" />
          <a class="field-help" [routerLink]="['/agenda', item.appointment]">Ver o recebimento completo</a>
        </div>
      </form>
    }
  </dialog>

  <ng-template #timing>
    <details class="timing" [open]="customTime()" (toggle)="toggleTime($event)">
      <summary>Informar outro horário</summary>
      <label>Horário<input type="datetime-local" name="occurred" [ngModel]="occurredAt()" (ngModelChange)="occurredAt.set($event)" /></label>
    </details>
  </ng-template>
</div>`,
})
export class Unloading implements OnInit {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroy = inject(DestroyRef);
  private sheet = viewChild.required<ElementRef<HTMLDialogElement>>("sheet");
  private crew = viewChild(VisitCrew);
  readonly canOperate = this.api.can("warehouse");
  readonly origins = ORIGINS;
  readonly todayDate = today();
  readonly clock = clockTime;
  date = signal(this.todayDate);
  origin = signal("operacional_registrado");
  warehouse = signal("");
  board = signal<UnloadBoard | null>(null);
  loading = signal(false);
  error = signal("");
  success = signal("");
  followUp = signal<UnloadItem | null>(null);
  selectedId = signal("");
  busy = signal(false);
  sheetError = signal("");
  sheetSuccess = signal("");
  workers = signal(0);
  checkoutEquipment = signal<{ id: string; name: string }[]>([]);
  occurredAt = signal(nowLocal());
  customTime = signal(false);
  private idempotencyKey = "";
  private request = 0;

  warehouses = computed(() => warehousesOf(this.board()?.items ?? []));
  visible = computed(() => filterByWarehouse(this.board()?.items ?? [], this.warehouse()));
  groups = computed(() => groupByStage(this.visible()));
  activeCount = computed(() => this.visible().filter(item => item.stage !== "done").length);
  selected = computed(() => this.board()?.items.find(item => item.visit === this.selectedId()) ?? null);
  firstWithoutCrew = computed(() => this.visible().find(item => item.stage !== "done" && !item.crew.length) ?? null);
  crewDirty = computed(() => this.crew()?.dirty() ?? false);
  checkoutEquipmentText = computed(() => this.checkoutEquipment().map(e => e.name).join(", ") || "nenhum");
  checkoutLabel = computed(() => {
    const count = this.workers();
    return `Confirmar saída · ${count} ${count === 1 ? "chapa" : "chapas"}`;
  });

  ngOnInit() {
    const query = this.route.snapshot.queryParamMap;
    if (/^\d{4}-\d{2}-\d{2}$/.test(query.get("data") ?? "")) this.date.set(query.get("data")!);
    if (query.get("origem") === "demo") this.origin.set("demo_sintetico");
    this.warehouse.set(query.get("armazem") ?? "");
    void this.load();
    // A portaria e os outros armazéns mudam o quadro; atualiza em silêncio enquanto ninguém está registrando.
    const timer = window.setInterval(() => { if (!this.busy() && document.visibilityState === "visible") void this.load(true); }, 30000);
    this.destroy.onDestroy(() => window.clearInterval(timer));
  }

  async load(quiet = false) {
    const request = ++this.request;
    if (!quiet) { this.loading.set(true); this.error.set(""); }
    try {
      const query = new URLSearchParams({ date: this.date(), origin: this.origin() });
      const board = await this.api.get<UnloadBoard>(`allocation/unloads/?${query}`);
      if (request !== this.request) return;
      this.board.set(board);
      if (quiet) this.error.set("");
    } catch (e) {
      if (request === this.request && !quiet) this.error.set(apiError(e));
    } finally {
      if (request === this.request) this.loading.set(false);
    }
  }

  private syncUrl() {
    const queryParams = { data: this.date() === this.todayDate ? null : this.date(), origem: this.origin() === "demo_sintetico" ? "demo" : null, armazem: this.warehouse() || null };
    void this.router.navigate([], { relativeTo: this.route, queryParams, replaceUrl: true });
  }
  setDate(value: string) { if (!value || value === this.date()) return; this.date.set(value); this.reset(); }
  goDay(delta: number) { this.setDate(shiftDate(this.date(), delta)); }
  setOrigin(value: string) { if (value === this.origin()) return; this.origin.set(value); this.reset(); }
  setWarehouse(value: string) { this.warehouse.set(value); this.syncUrl(); }
  private reset() { this.board.set(null); this.success.set(""); this.followUp.set(null); this.syncUrl(); void this.load(); }

  coverageOf(item: UnloadItem) { return crewCoverage(item); }
  stepOf(item: UnloadItem) { return nextStep(item, this.canOperate); }
  names(item: UnloadItem) {
    const names = item.crew.map(person => person.name.split(" ")[0]);
    return names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ");
  }
  equipmentNames(item: UnloadItem) { return item.equipment.map(e => e.name).join(", "); }

  open(item: UnloadItem, step: UnloadStep = "view") {
    this.selectedId.set(item.visit);
    this.sheetError.set("");
    this.sheetSuccess.set("");
    this.followUp.set(null);
    this.prepare(item);
    const dialog = this.sheet().nativeElement;
    if (!dialog.open) dialog.showModal();
    // Equipe primeiro quando é o passo pedido; senão o foco fica no topo do painel.
    if (step === "crew") setTimeout(() => dialog.querySelector<HTMLElement>("app-visit-crew .chip:not([disabled])")?.focus(), 300);
  }
  private prepare(item: UnloadItem) {
    this.idempotencyKey = crypto.randomUUID();
    this.workers.set(item.crew.length);
    this.checkoutEquipment.set(item.equipment);
    this.occurredAt.set(nowLocal());
    this.customTime.set(false);
  }
  close() { this.sheet().nativeElement.close(); }
  closed() { this.selectedId.set(""); }
  toggleTime(event: Event) { this.customTime.set((event.target as HTMLDetailsElement).open); if (!this.customTime()) this.occurredAt.set(nowLocal()); }
  setWorkers(value: number | string) { const count = Math.max(0, Math.min(100, Math.trunc(Number(value) || 0))); this.workers.set(count); }

  crewChanged(crew: Crew) {
    this.workers.set(crew.crew.length);
    this.checkoutEquipment.set(crew.equipment.filter(e => e.planned).map(e => ({ id: e.id, name: e.name })));
    void this.load(true);
  }

  async submit() {
    const item = this.selected();
    if (!item || this.busy() || this.crewDirty() || !this.canOperate) return;
    const entering = item.stage === "ready";
    if (!entering && item.stage !== "running") return;
    this.busy.set(true);
    this.sheetError.set("");
    this.sheetSuccess.set("");
    const occurred_at = localTimestamp(this.customTime() ? this.occurredAt() : nowLocal());
    try {
      const body: Record<string, unknown> = { idempotency_key: this.idempotencyKey, expected_revision: item.revision, occurred_at };
      if (!entering) Object.assign(body, { worker_count: this.workers(), equipment_ids: this.checkoutEquipment().map(e => e.id), resources_confirmed: true });
      await this.api.post(`warehouse-visits/${item.visit}/${entering ? "check-in" : "check-out"}/`, body);
      await this.load(true);
      const at = clockTime(occurred_at);
      if (entering) {
        // Segue no painel: a próxima ação é a saída.
        this.sheetSuccess.set(`Entrada registrada às ${at}. Quando terminar, registre a saída aqui mesmo.`);
        const current = this.selected();
        if (current) this.prepare(current);
      } else {
        const next = this.board()?.items.find(other => other.appointment === item.appointment && other.sequence === item.sequence + 1 && other.stage !== "done") ?? null;
        this.close();
        this.success.set(`Saída registrada às ${at}: ${item.supplier} no ${item.warehouse_name}.${next ? " O caminhão segue para a próxima etapa." : ""}`);
        this.followUp.set(next);
      }
    } catch (e) {
      this.sheetError.set(apiError(e));
      this.idempotencyKey = crypto.randomUUID();
      void this.load(true);
    } finally {
      this.busy.set(false);
    }
  }
}
