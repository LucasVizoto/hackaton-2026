import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, OnInit, signal, viewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { Api, apiError, today } from "../core/api";
import { Catalog } from "../core/catalog";
import { FeedbackState, LoadingState, PageHeader } from "../shared/ui";

export interface RosterEntry { id: string; worker: string; registration: string; name: string; contract_type: string; date: string; warehouse: string | null; warehouse_name: string | null; period: string; activity: string; attendance: string; fraction: string; notes: string; }
interface RosterSlot { time: string; chapas: number; gas_forklifts: number; after_hours: boolean; warnings: string[]; }
export interface RosterDay {
  date: string; day_type: string; holiday: string | null; entries: RosterEntry[]; scheduled_equivalents: string; present_equivalents: string; absences: number;
  plan: { peak_chapas: number; peak_gas_forklifts: number; loads: number; person_hours: string; after_hours_loads: number; forklift_conflicts: number };
  slots: RosterSlot[]; season_target: { min: number; max: number; season: string }; balance: { status: string; message: string };
  bulletin: { id: string; status: string; equivalent_days: string | null } | null;
}
interface RosterWorker { id: string; registration: string; name: string; contract_type: string; }
interface RosterWeek { period: { date_from: string; date_to: string }; origin: string; days: RosterDay[]; workers: RosterWorker[]; rules: string[]; }

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const WEEKDAYS_LONG = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** One color rule for the whole screen: the day situation drives card border, dot and text. */
const TONE: Record<string, string> = { shortage: "danger", attention: "warning", watch: "warning", ok: "success", info: "neutral", closed: "neutral" };
const PRESENCE_LABEL: Record<string, string> = { PLANNED: "Aguardando", PRESENT: "Veio", ABSENT: "Faltou" };
/** Search only helps when the list is long. */
const SEARCH_FROM = 12;

function monday(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
function addDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}
function weekdayIndex(value: string): number { return (new Date(`${value}T12:00:00`).getDay() + 6) % 7; }
function num(value: string | number): string { return Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 }); }
function plural(count: number, one: string, many: string): string { return `${num(count)} ${count === 1 ? one : many}`; }

@Component({
  selector: "app-staff-roster",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, FeedbackState, LoadingState, PageHeader],
  host: { "(document:click)": "closeMenu($event)", "(document:keydown.escape)": "closeMenu()" },
  styles: [`
    :host { display: block; }
    .ros { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; }
    .ros > * { min-width: 0; margin-bottom: 0; }

    /* Week bar: navigation, heading, filters, more actions. */
    .ros-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
    .ros-nav { display: flex; align-items: center; gap: 4px; }
    .ros-nav svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .ros-heading { flex: 1 1 auto; margin: 0 0 0 4px; font-size: 18px; }
    .ros-side { display: flex; align-items: center; gap: 8px; }
    .ros-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; padding: 0 16px;
      border: 1px solid var(--control-line); border-radius: var(--radius-full); background: var(--surface); color: var(--text);
      font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none; white-space: nowrap;
    }
    .ros-btn:hover:not(:disabled) { background: var(--surface-hover); }
    .ros-btn:disabled { opacity: 0.55; cursor: not-allowed; }
    .ros-btn.is-set { border-color: var(--green); color: var(--green); }
    .ros-btn.primary { background: var(--green); border-color: var(--green); color: var(--brand-contrast); }
    .ros-btn.primary:hover:not(:disabled) { background: var(--brand-hover); }
    .ros-tag { display: inline-flex; align-items: center; min-height: 28px; padding: 0 10px; border-radius: var(--radius-full); font-size: 12px; font-weight: 700; background: var(--warning-soft); color: var(--warning); }
    .ros-more { position: relative; border: 0; padding: 0; margin: 0; }
    .ros-more > summary { list-style: none; padding: 0; color: var(--muted); }
    .ros-more > summary::-webkit-details-marker { display: none; }
    .ros-more svg { width: 20px; height: 20px; fill: currentColor; }
    .ros-menu {
      position: absolute; right: 0; top: calc(100% + 4px); z-index: 10; display: grid; min-width: 240px; padding: 6px;
      background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-control); box-shadow: var(--shadow-overlay);
    }
    .ros-menu button {
      min-height: 44px; padding: 8px 12px; border: 0; border-radius: var(--radius-control); background: transparent;
      color: var(--text); font: inherit; font-size: 14px; font-weight: 600; text-align: left; cursor: pointer;
    }
    .ros-menu button:hover:not(:disabled) { background: var(--surface-hover); }
    .ros-menu button:disabled { opacity: 0.5; cursor: not-allowed; }
    .ros-filters { display: flex; flex-wrap: wrap; align-items: end; gap: 12px 24px; padding: 16px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface); }
    .ros-filters fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
    .ros-filters legend, .ros-filters label { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
    .ros-filters label { display: grid; gap: 6px; }
    .ros-filters select { min-width: 220px; min-height: 44px; }

    /* Segmented controls (shift, presence, origin). */
    .seg { display: inline-flex; flex-wrap: wrap; gap: 4px; padding: 4px; background: var(--surface-subtle); border-radius: var(--radius-control); }
    .seg button {
      min-height: 44px; min-width: 64px; padding: 0 14px; border: 1px solid transparent; border-radius: 9px; background: transparent;
      color: var(--muted); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
    }
    @media (hover: hover) { .seg button:hover:not(:disabled) { color: var(--text); background: var(--surface); } }
    .seg button[aria-pressed="true"] { background: var(--surface); border-color: var(--green); color: var(--green); box-shadow: 0 1px 2px rgba(15,23,42,.08); }
    .seg button:disabled { cursor: not-allowed; }
    .seg.presence button[aria-pressed="true"].PRESENT { border-color: var(--success); color: var(--success); background: var(--success-soft); }
    .seg.presence button[aria-pressed="true"].ABSENT { border-color: var(--danger); color: var(--danger); background: var(--danger-soft); }

    /* Status dot: same color rule everywhere, always next to text. */
    .dot { display: inline-block; flex-shrink: 0; width: 10px; height: 10px; border-radius: var(--radius-full); background: var(--muted); }
    .dot.danger { background: var(--danger); } .dot.warning { background: var(--warning); } .dot.success { background: var(--success); }

    /* Day strip. */
    .days { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; margin: 0; padding: 0; list-style: none; }
    .day {
      display: grid; gap: 4px; width: 100%; min-height: 88px; padding: 10px 12px; text-align: left; cursor: pointer;
      border: 1px solid var(--line); border-left: 4px solid var(--line); border-radius: var(--radius-control);
      background: var(--surface); color: var(--text); font: inherit;
    }
    .day:hover { background: var(--surface-hover); }
    .day.danger { border-left-color: var(--danger); } .day.warning { border-left-color: var(--warning); } .day.success { border-left-color: var(--success); }
    .day[aria-pressed="true"] { border-color: var(--green); border-left-width: 4px; box-shadow: 0 0 0 2px var(--green); }
    .day-name { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; font-size: 14px; font-weight: 700; }
    .day-name small { color: var(--muted); font-weight: 600; font-size: 12px; }
    .day-status { display: flex; align-items: center; gap: 6px; font-size: 13px; line-height: 1.3; }
    .day-today { color: var(--green); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; }

    /* Selected day panel. */
    .sel { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; padding: 20px; border: 1px solid var(--line); border-radius: var(--radius-card); background: var(--surface); }
    .sel-head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .sel > *, .sel-head > div { min-width: 0; }
    .sel-head > div { flex: 1 1 280px; }
    .sel-head h2 { margin: 0; font-size: 20px; }
    .sel-summary { margin: 4px 0 0; font-size: 15px; line-height: 1.5; max-width: 75ch; }
    .sel-summary strong { color: var(--text); }
    .sel-hint { margin: 2px 0 0; color: var(--muted); font-size: 13px; }
    .warn-list { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
    .warn-list li { padding: 8px 12px; border-radius: var(--radius-control); background: var(--warning-soft); color: var(--warning); font-size: 14px; font-weight: 600; }

    .slots { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 0; padding: 0; list-style: none; }
    .slot { display: grid; gap: 6px; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius-control); font-size: 13px; }
    .slot.is-peak { border-color: var(--blue); background: var(--info-soft); }
    .slot strong { font-size: 15px; }
    .slot .muted { font-size: 12px; }
    .slot .bar-track { height: 6px; }
    .slot-warn { color: var(--warning); font-size: 12px; font-weight: 600; }

    .people-tools { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; }
    .people-count { margin: 0; font-size: 15px; font-weight: 600; }
    .people-filter { display: flex; align-items: center; gap: 8px; }
    .people-filter input[type="search"] { min-height: 44px; width: 100%; max-width: 420px; min-width: 0; }
    .people { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--line); }
    .person { display: grid; grid-template-columns: minmax(180px, 1fr) auto; align-items: center; gap: 8px 16px; padding: 12px 0; border-bottom: 1px solid var(--line); }
    .person-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px 12px; }
    .toggle {
      min-height: 48px; min-width: 150px; padding: 0 18px; border: 2px solid var(--green); border-radius: var(--radius-control);
      background: var(--surface); color: var(--green); font: inherit; font-size: 15px; font-weight: 700; cursor: pointer;
    }
    .toggle:hover:not(:disabled) { background: var(--brand-soft); }
    .toggle.is-on { background: var(--green); color: var(--brand-contrast); }
    .toggle.is-on:hover:not(:disabled) { background: var(--brand-hover); }
    .toggle:disabled { opacity: 0.6; cursor: not-allowed; }
    .sel-status { display: inline-flex; align-items: center; gap: 6px; margin-right: 6px; font-weight: 700; }
    .sel-status.danger { color: var(--danger); } .sel-status.warning { color: var(--warning); } .sel-status.success { color: var(--success); }
    .person.is-off .person-name { color: var(--muted); }
    .person-name { display: grid; gap: 2px; font-weight: 600; }
    .person-name small { color: var(--muted); font-weight: 400; font-size: 13px; }
    .tag { display: inline-block; margin-left: 6px; padding: 1px 8px; border-radius: var(--radius-full); background: var(--surface-subtle); color: var(--muted); font-size: 12px; font-weight: 600; }
    .badge { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 12px; border-radius: var(--radius-full); background: var(--surface-subtle); color: var(--muted); font-size: 13px; font-weight: 600; }
    .badge.success { background: var(--success-soft); color: var(--success); }
    .badge.danger { background: var(--danger-soft); color: var(--danger); }
    .badge.on { background: var(--brand-soft); color: var(--green); }
    .closed { padding: 32px 16px; text-align: center; color: var(--muted); }
    .closed strong { display: block; color: var(--text); font-size: 18px; margin-bottom: 4px; }

    .ros-details { border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface); }
    .ros-details > summary { min-height: 48px; display: flex; align-items: center; padding: 0 16px; font-weight: 600; cursor: pointer; }
    .ros-details[open] > summary { border-bottom: 1px solid var(--line); }
    .ros-details-body { padding: 16px; display: grid; gap: 12px; }
    .ros-details-body ul { margin: 0; padding-left: 20px; }
    .legend { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 0; font-size: 13px; color: var(--muted); }
    .overview td.sym { text-align: center; font-size: 16px; }
    .overview td.sym.ABSENT { color: var(--danger); }
    .overview th.is-sel { color: var(--green); }

    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
    button:focus-visible, summary:focus-visible, a:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }

    @media (max-width: 1100px) {
      .person { grid-template-columns: minmax(0, 1fr); }
      .person-actions { justify-content: flex-start; }
    }
    @media (max-width: 767px) {
      .ros-bar { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; }
      .ros-heading { font-size: 16px; margin: 0; }
      .ros-side { grid-column: 1 / -1; justify-content: space-between; }
      .days { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .day { min-height: 72px; padding: 8px 10px; }
      .slots { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .sel { padding: 16px; }
      .people-filter { width: 100%; }
      .people-filter input[type="search"] { flex: 1 1 auto; width: auto; }
      .seg { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); width: 100%; }
      .seg.presence, .seg.origin { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .person-actions .toggle { flex: 1 1 100%; }
      .person-actions .seg.presence { flex: 1 1 auto; width: auto; }
      .people-tools .ros-btn { width: 100%; white-space: normal; }
      .seg button { min-width: 0; padding: 0 6px; }
      .ros-filters select { min-width: 0; width: 100%; }
      .ros-filters label, .ros-filters fieldset { width: 100%; }
    }
  `],
  template: `<div class="page">
  <app-page-header title="Escala dos chapas" subtitle="Quem trabalha em cada dia e se a equipe dá conta dos caminhões da agenda." />
  <section class="ros" [attr.aria-busy]="busy()">
    <div class="ros-bar">
      <div class="ros-nav">
        <button type="button" class="icon-button" (click)="move(-7)" [disabled]="busy()" aria-label="Semana anterior" title="Semana anterior">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
        </button>
        <button type="button" class="icon-button" (click)="move(7)" [disabled]="busy()" aria-label="Próxima semana" title="Próxima semana">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
        </button>
      </div>
      <h2 class="ros-heading" aria-live="polite">{{ heading() }}</h2>
      <details class="ros-more" #more>
        <summary class="icon-button" aria-label="Mais ações" title="Mais ações">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
        </summary>
        <div class="ros-menu">
          @if (canEdit()) { <button type="button" (click)="more.open = false; copyPrevious()" [disabled]="busy()">Repetir a semana anterior</button> }
          <button type="button" (click)="more.open = false; load()" [disabled]="busy()">Atualizar</button>
        </div>
      </details>
      <div class="ros-side">
        @if (isDemo()) { <span class="ros-tag" title="Dados de demonstração: nunca se misturam com a operação real.">Demonstração</span> }
        @if (!isThisWeek()) { <button type="button" class="ros-btn" (click)="goToday()" [disabled]="busy()">Hoje</button> }
        <button type="button" class="ros-btn" [class.is-set]="filterCount()" [attr.aria-expanded]="filtersOpen()" aria-controls="ros-filters" (click)="filtersOpen.set(!filtersOpen())">
          Filtros{{ filterCount() ? " (" + filterCount() + ")" : "" }}
        </button>
      </div>
    </div>

    @if (filtersOpen()) {
      <div class="ros-filters" id="ros-filters">
        <fieldset>
          <legend>Origem dos dados</legend>
          <div class="seg origin" role="group" aria-label="Origem dos dados">
            <button type="button" [attr.aria-pressed]="origin() === 'operacional_registrado'" (click)="setOrigin('operacional_registrado')" [disabled]="busy()">Operação</button>
            <button type="button" [attr.aria-pressed]="origin() === 'demo_sintetico'" (click)="setOrigin('demo_sintetico')" [disabled]="busy()">Demonstração</button>
          </div>
        </fieldset>
        @if (canEdit()) {
          <label>Armazém para novas escalas
            <select [ngModel]="warehouse()" (ngModelChange)="warehouse.set($event)">
              <option value="">Sem armazém fixo</option>
              @for (w of catalog.warehouses(); track w.id) { <option [value]="w.id">{{ w.name }}</option> }
            </select>
          </label>
        }
      </div>
    }

    @if (error()) { <div app-feedback tone="error">{{ error() }}</div> }
    @if (success()) { <div app-feedback tone="success">{{ success() }}</div> }

    @if (busy() && !week()) { <app-loading-state label="Carregando a escala da semana…" /> }

    @if (week(); as w) {
      <ul class="days" aria-label="Dias da semana">
        @for (day of w.days; track day.date) {
          <li>
            <button type="button" [class]="'day ' + tone(day)" [attr.aria-pressed]="day.date === selectedDay()?.date" (click)="selected.set(day.date)" [title]="day.balance.message">
              <span class="day-name">{{ weekday(day.date) }} <small>{{ shortDate(day.date) }}</small></span>
              @if (day.date === todayIso) { <span class="day-today">Hoje</span> }
              <span class="day-status"><span [class]="'dot ' + tone(day)" aria-hidden="true"></span>{{ daySentence(day) }}</span>
            </button>
          </li>
        }
      </ul>

      @if (selectedDay(); as day) {
        <section class="sel" aria-labelledby="sel-title">
          <div class="sel-head">
            <div>
              <h2 id="sel-title">{{ longLabel(day.date) }}</h2>
              @if (isOpen(day)) {
                <p class="sel-summary">
                  <span [class]="'sel-status ' + tone(day)"><span [class]="'dot ' + tone(day)" aria-hidden="true"></span>{{ daySentence(day) }}</span>
                  @if (day.day_type === "saturday") {
                    Sábado é de organização interna. Você escalou <strong>{{ plural(scheduled(day), "chapa", "chapas") }}</strong>.
                  } @else if (day.plan.peak_chapas) {
                    A agenda pede <strong>{{ plural(day.plan.peak_chapas, "chapa", "chapas") }}</strong>. Você escalou <strong>{{ plural(scheduled(day), "chapa", "chapas") }}</strong>.
                  } @else {
                    Nenhum caminhão agendado. Você escalou <strong>{{ plural(scheduled(day), "chapa", "chapas") }}</strong>.
                  }
                </p>
              }
            </div>
            @if (isOpen(day)) {
              @if (day.bulletin; as b) {
                <a class="ros-btn" [routerLink]="['/boletins', b.id]">Ver boletim do dia{{ b.status === "CLOSED" ? " (fechado)" : "" }}</a>
              } @else if (canEdit() && day.entries.length) {
                <a class="ros-btn" routerLink="/boletins/novo" [queryParams]="{ data: day.date, escala: 1, origem: origin() }">Gerar boletim com esta equipe</a>
              }
            }
          </div>

          @if (!isOpen(day)) {
            <div class="closed">
              <strong>Sem expediente</strong>
              {{ day.holiday ? "Feriado: " + day.holiday + "." : "Não há trabalho neste dia." }}
            </div>
          } @else {
            @if (day.plan.after_hours_loads || day.plan.forklift_conflicts) {
              <ul class="warn-list">
                @if (day.plan.after_hours_loads) { <li>{{ day.plan.after_hours_loads === 1 ? "Uma descarga pode" : day.plan.after_hours_loads + " descargas podem" }} passar do fim do expediente — a equipe fica até terminar.</li> }
                @if (day.plan.forklift_conflicts) { <li>Falta empilhadeira a gás em {{ day.plan.forklift_conflicts === 1 ? "um horário" : day.plan.forklift_conflicts + " horários" }}.</li> }
              </ul>
            }

            @if (day.day_type === "workday") {
              <details class="ros-details">
                <summary>Ver horários da agenda</summary>
                <div class="ros-details-body">
                  <ul class="slots" aria-label="Chapas pedidos pela agenda em cada horário">
                    @for (time of times; track time) {
                      @let slot = slotOf(day, time);
                      <li class="slot" [class.is-peak]="slot && slot.chapas && slot.chapas === day.plan.peak_chapas">
                        <span class="muted">{{ hour(time) }}</span>
                        <strong>{{ slot && slot.chapas ? plural(slot.chapas, "chapa", "chapas") : "Sem descarga" }}</strong>
                        <span class="bar-track" aria-hidden="true"><span [style.width.%]="slotWidth(day, slot)"></span></span>
                        @if (slot && slot.gas_forklifts) { <span class="muted">{{ plural(slot.gas_forklifts, "empilhadeira", "empilhadeiras") }}</span> }
                        @for (warning of slot?.warnings ?? []; track warning) { <span class="slot-warn">{{ warning }}</span> }
                      </li>
                    }
                  </ul>
                  <p class="field-help">O número da agenda é o máximo de chapas pedidos num mesmo horário. Para atender também os cooperados, o ideal é ter {{ targetText(day) }} chapas.</p>
                </div>
              </details>
            }

            <div class="people-tools">
              <p class="people-count" aria-live="polite">{{ countLine(day) }}</p>
              @if (canEdit() && day.date <= todayIso && waiting(day).length) {
                <button type="button" class="ros-btn primary" (click)="markAllPresent(day)" [disabled]="busy()">Marcar todos os escalados como “Veio”</button>
              }
            </div>
            @if (showSearch()) {
              <div class="people-filter">
                <label class="sr-only" for="ros-search">Buscar pessoa</label>
                <input id="ros-search" type="search" placeholder="Buscar pessoa pelo nome ou matrícula" [ngModel]="search()" (ngModelChange)="search.set($event)" />
              </div>
            }

            <ul class="people" aria-label="Pessoas do dia">
              @for (person of dayPeople(); track person.id) {
                @let entry = cell(person.id, day.date);
                <li class="person" [class.is-off]="!entry">
                  <span class="person-name">
                    <span>{{ person.name }}@if (person.contract_type === "TERCEIRIZADO") { <span class="tag">Terceirizado</span> }</span>
                    <small>Matrícula {{ person.registration }}</small>
                  </span>
                  @if (canEdit()) {
                    <div class="person-actions">
                      <button type="button" [class]="'toggle' + (entry ? ' is-on' : '')" [attr.aria-pressed]="!!entry" [disabled]="busy()"
                        [attr.aria-label]="(entry ? 'Tirar ' : 'Escalar ') + person.name"
                        (click)="toggle(person.id, day.date)">{{ entry ? "Escalado ✓" : "Escalar" }}</button>
                      @if (entry) {
                        <div class="seg presence" role="group" [attr.aria-label]="'Presença de ' + person.name">
                          <button type="button" class="PRESENT" [attr.aria-pressed]="entry.attendance === 'PRESENT'" [disabled]="busy()" (click)="tapPresence(entry, 'PRESENT')">Veio</button>
                          <button type="button" class="ABSENT" [attr.aria-pressed]="entry.attendance === 'ABSENT'" [disabled]="busy()" (click)="tapPresence(entry, 'ABSENT')">Faltou</button>
                        </div>
                      }
                    </div>
                  } @else {
                    <div class="person-actions">
                      <span [class]="'badge' + (entry ? ' on' : '')">{{ entry ? "Escalado" : "Folga" }}</span>
                      @if (entry) { <span [class]="'badge ' + presenceTone(entry.attendance)">{{ presenceLabel(entry.attendance) }}</span> }
                    </div>
                  }
                </li>
              } @empty {
                <li class="closed">
                  @if (!w.workers.length) { <strong>Ninguém cadastrado</strong> Cadastre os chapas em Pessoas para montar a escala. }
                  @else { Ninguém encontrado com “{{ search() }}”. }
                </li>
              }
            </ul>

          }
        </section>
      }

      <details class="ros-details">
        <summary>Ver a semana inteira</summary>
        <div class="ros-details-body">
          <p class="legend"><span>● escalado</span><span>✕ faltou</span><span>— folga</span></p>
          @if (weekPeople().length) {
            <div class="table-wrap" tabindex="0" role="region" aria-label="Escala da semana">
              <table class="overview">
                <thead><tr><th scope="col">Pessoa</th>
                  @for (day of w.days; track day.date) { <th scope="col" [class.is-sel]="day.date === selectedDay()?.date">{{ weekday(day.date) }} {{ shortDate(day.date) }}</th> }
                </tr></thead>
                <tbody>
                  @for (person of weekPeople(); track person.id) {
                    <tr><th scope="row">{{ person.name }}</th>
                      @for (day of w.days; track day.date) {
                        @let entry = cell(person.id, day.date);
                        <td [class]="'sym ' + (entry?.attendance ?? '')" [attr.aria-label]="entry ? 'Escalado, ' + presenceLabel(entry.attendance) : 'Folga'" [title]="entry ? 'Escalado · ' + presenceLabel(entry.attendance) : 'Folga'">{{ symbol(entry) }}</td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else { <p class="muted">Ninguém escalado nesta semana.</p> }
        </div>
      </details>

      <details class="ros-details">
        <summary>Como funciona</summary>
        <div class="ros-details-body">
          <ul class="field-help">
            <li>A cor de cada dia mostra a situação: vermelho = falta gente, amarelo = atenção, verde = equipe completa, cinza = sábado ou sem expediente.</li>
            <li>“Ao mesmo tempo” é o maior número de chapas que os caminhões agendados pedem num mesmo horário, somando a cooperativa inteira.</li>
            <li>Manhã ou tarde contam como meio dia de trabalho.</li>
            @for (rule of w.rules; track rule) { <li>{{ rule }}</li> }
            <li>A agenda mostra só caminhões de fornecedor; o carregamento para o cooperado usa a mesma equipe. Por isso a escala avisa quando falta gente, mas sobra só se confirma pelo complemento do boletim, no painel de Gestão.</li>
            <li>O pagamento continua sendo feito pelo boletim do dia.</li>
            @if (isDemo()) { <li>Dados de demonstração nunca se misturam com a operação real.</li> }
          </ul>
        </div>
      </details>
    }
  </section>
</div>`,
})
export class StaffRoster implements OnInit {
  readonly api = inject(Api);
  readonly catalog = inject(Catalog);
  readonly times = ["08:00", "10:00", "13:00", "15:00"];
  readonly todayIso = today();
  readonly plural = plural;
  private readonly menu = viewChild<ElementRef<HTMLDetailsElement>>("more");
  weekStart = signal(monday(today()));
  origin = signal("operacional_registrado");
  warehouse = signal("");
  search = signal("");
  filtersOpen = signal(false);
  selected = signal("");
  week = signal<RosterWeek | null>(null);
  busy = signal(false);
  error = signal("");
  success = signal("");
  canEdit = computed(() => this.api.can("warehouse"));
  isDemo = computed(() => this.origin() === "demo_sintetico");
  isThisWeek = computed(() => this.weekStart() === monday(this.todayIso));
  filterCount = computed(() => (this.isDemo() ? 1 : 0) + (this.canEdit() && this.warehouse() ? 1 : 0));
  heading = computed(() => {
    const from = this.weekStart(), to = addDays(from, 5);
    const month = (d: string) => MONTHS[Number(d.slice(5, 7)) - 1];
    const sameMonth = from.slice(5, 7) === to.slice(5, 7);
    return `Semana de ${from.slice(8, 10)}${sameMonth ? "" : "/" + month(from)} a ${to.slice(8, 10)}/${month(to)}`;
  });
  private index = computed(() => {
    const map = new Map<string, RosterEntry>();
    for (const day of this.week()?.days ?? []) for (const entry of day.entries) map.set(`${entry.worker}|${entry.date}`, entry);
    return map;
  });
  private people = computed<RosterWorker[]>(() => {
    const week = this.week();
    if (!week) return [];
    const known = new Map(week.workers.map(worker => [worker.id, worker]));
    for (const day of week.days) for (const entry of day.entries) if (!known.has(entry.worker)) known.set(entry.worker, { id: entry.worker, registration: entry.registration, name: entry.name, contract_type: entry.contract_type });
    return [...known.values()].sort((a, b) => a.registration.localeCompare(b.registration));
  });
  selectedDay = computed<RosterDay | null>(() => {
    const days = this.week()?.days ?? [];
    return days.find(day => day.date === this.selected()) ?? days.find(day => day.date === this.todayIso) ?? days[0] ?? null;
  });
  dayPeople = computed(() => {
    const day = this.selectedDay();
    if (!day) return [];
    const term = this.search().trim().toLocaleLowerCase("pt-BR");
    const on = new Set(day.entries.map(entry => entry.worker));
    return this.people()
      .filter(person => !term || person.name.toLocaleLowerCase("pt-BR").includes(term) || person.registration.toLocaleLowerCase("pt-BR").includes(term))
      .sort((a, b) => Number(on.has(b.id)) - Number(on.has(a.id)));
  });
  showSearch = computed(() => this.people().length > SEARCH_FROM);
  weekPeople = computed(() => {
    const on = new Set((this.week()?.days ?? []).flatMap(day => day.entries.map(entry => entry.worker)));
    return this.people().filter(person => on.has(person.id));
  });

  async ngOnInit() {
    await this.catalog.load().catch(e => this.error.set(apiError(e)));
    await this.load();
  }
  closeMenu(event?: Event) {
    const menu = this.menu()?.nativeElement;
    if (menu?.open && !(event && menu.contains(event.target as Node))) menu.open = false;
  }

  weekday(date: string) { return WEEKDAYS[weekdayIndex(date)]; }
  shortDate(date: string) { return `${date.slice(8, 10)}/${date.slice(5, 7)}`; }
  longLabel(date: string) { return `${WEEKDAYS_LONG[weekdayIndex(date)]}, ${date.slice(8, 10)}/${MONTHS[Number(date.slice(5, 7)) - 1]}`; }
  hour(time: string) { return `${time.slice(0, 2)}h`; }
  tone(day: RosterDay) { return TONE[day.balance.status] ?? "neutral"; }
  isOpen(day: RosterDay) { return day.day_type !== "sunday" && day.day_type !== "holiday" && day.balance.status !== "closed"; }
  scheduled(day: RosterDay) { return Number(day.scheduled_equivalents) || 0; }
  /** One plain sentence per day, derived from the backend balance. */
  daySentence(day: RosterDay): string {
    const scheduled = this.scheduled(day), required = day.plan.peak_chapas;
    switch (day.balance.status) {
      case "closed": return day.holiday ? "Feriado" : "Sem expediente";
      case "info": return "Sábado: organização";
      case "shortage": { const missing = Math.max(1, Math.ceil(required - scheduled)); return missing === 1 ? "Falta 1 chapa" : `Faltam ${missing} chapas`; }
      case "attention": return `Abaixo do ideal (${day.season_target.min})`;
      case "watch": return "Equipe acima do necessário";
      case "ok": return "Equipe completa";
      default: return day.balance.message;
    }
  }
  targetText(day: RosterDay) { const t = day.season_target; return t.max !== t.min ? `de ${t.min} a ${t.max}` : `${t.min}`; }
  slotOf(day: RosterDay, time: string) { return day.slots.find(slot => slot.time === time); }
  slotWidth(day: RosterDay, slot: RosterSlot | undefined) {
    const max = Math.max(day.plan.peak_chapas, this.scheduled(day), 1);
    return slot ? Math.min(100, slot.chapas / max * 100) : 0;
  }
  countLine(day: RosterDay) {
    const present = day.entries.filter(entry => entry.attendance === "PRESENT").length;
    const absent = day.entries.filter(entry => entry.attendance === "ABSENT").length;
    return `${plural(day.entries.length, "escalado", "escalados")} · ${present} ${present === 1 ? "veio" : "vieram"} · ${absent} ${absent === 1 ? "faltou" : "faltaram"}`;
  }
  waiting(day: RosterDay) { return day.entries.filter(entry => entry.attendance === "PLANNED"); }
  presenceLabel(value: string) { return PRESENCE_LABEL[value] ?? value; }
  presenceTone(value: string) { return value === "PRESENT" ? "success" : value === "ABSENT" ? "danger" : ""; }
  symbol(entry: RosterEntry | undefined) { return !entry ? "—" : entry.attendance === "ABSENT" ? "✕" : "●"; }
  cell(worker: string, date: string) { return this.index().get(`${worker}|${date}`); }

  move(days: number) { this.weekStart.set(addDays(this.weekStart(), days)); this.selected.set(""); void this.load(); }
  goToday() { this.weekStart.set(monday(this.todayIso)); this.selected.set(""); void this.load(); }
  setOrigin(value: string) { if (value !== this.origin()) { this.origin.set(value); void this.load(); } }
  async load() {
    this.busy.set(true);
    this.error.set("");
    try {
      const query = new URLSearchParams({ date_from: this.weekStart(), date_to: addDays(this.weekStart(), 5), origin: this.origin() });
      this.week.set(await this.api.get<RosterWeek>(`roster/?${query}`));
    } catch (e) { this.error.set(apiError(e)); } finally { this.busy.set(false); }
  }
  private async run(action: () => Promise<unknown>, message: string) {
    this.busy.set(true);
    this.error.set("");
    this.success.set("");
    try { await action(); this.success.set(message); } catch (e) { this.error.set(apiError(e)); } finally { this.busy.set(false); }
    await this.load();
  }
  /** One tap: schedule for the whole day, or take the person out (Folga). */
  async toggle(worker: string, date: string) {
    const entry = this.cell(worker, date);
    if (entry) { await this.run(() => this.api.delete(`roster/${entry.id}/`), `${entry.name} saiu da escala.`); return; }
    await this.run(() => this.api.post("roster/", { worker, date, origin: this.origin(), period: "FULL", warehouse: this.warehouse() || null }), "Pessoa escalada.");
  }
  /** Veio / Faltou; tapping the selected one again goes back to "aguardando". */
  async tapPresence(entry: RosterEntry, attendance: "PRESENT" | "ABSENT") {
    const next = entry.attendance === attendance ? "PLANNED" : attendance;
    await this.run(() => this.api.patch(`roster/${entry.id}/`, { attendance: next }), next === "ABSENT" ? "Falta registrada." : next === "PRESENT" ? "Presença registrada." : "Presença desmarcada.");
  }
  async markAllPresent(day: RosterDay) {
    const pending = this.waiting(day);
    if (!pending.length) return;
    await this.run(async () => {
      for (const entry of pending) await this.api.patch(`roster/${entry.id}/`, { attendance: "PRESENT" });
    }, `${plural(pending.length, "pessoa marcada", "pessoas marcadas")} como “Veio”.`);
  }
  async copyPrevious() {
    await this.run(async () => {
      const result = await this.api.post<{ created: number; skipped: number }>("roster/copy-week/", { source_week_start: addDays(this.weekStart(), -7), target_week_start: this.weekStart(), origin: this.origin() });
      if (!result.created) throw new Error("Nada para repetir: a semana anterior está vazia ou já foi repetida.");
    }, "Semana anterior repetida. Quem já estava escalado não foi alterado.");
  }
}
