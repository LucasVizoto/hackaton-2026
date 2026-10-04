import { Component, computed, DestroyRef, effect, inject, input, signal, untracked } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { Api, apiError } from "../core/api";
import { Arrival, GateLive, GateMessage } from "../core/gate-live";
import { applyPending, reconcilePending, WaitLevel, waitLabel, waitLevel, waitMinutes } from "../core/arrival-wait";

const VISIBLE_CARDS = 3;
const PROMPT_KEY = "arrival-alert-prompt-dismissed";

function readFlag(key: string) { try { return localStorage.getItem(key) === "1"; } catch { return false; } }
function writeFlag(key: string) { try { localStorage.setItem(key, "1"); } catch { /* Preferência só desta sessão. */ } }

/**
 * Alerta persistente de chegada na portaria para o Armazém: cartão fixo com tempo de espera,
 * som curto, vibração, notificação do navegador quando a aba está em segundo plano e contador no título.
 */
@Component({
  selector: "app-arrival-alert",
  standalone: true,
  imports: [RouterLink],
  template: `@if (active()) {
    <p class="visually-hidden" aria-live="assertive">{{ announcement() }}</p>
    @if (!hidden() && (cards().length || showPrompt() || error())) {
      <section class="arrival-stack" aria-label="Transportadoras aguardando na portaria">
        @if (error()) {
          <article class="arrival-card" role="alert">
            <p>Não foi possível atualizar as chegadas. {{ error() }}</p>
            <button type="button" class="arrival-dismiss" (click)="load()">Tentar novamente</button>
          </article>
        }
        @for (item of visibleCards(); track item.id) {
          <article class="arrival-card" [attr.data-level]="level(item)">
            <header>
              <span class="arrival-kicker">Transportadora na portaria</span>
              <span class="arrival-wait">{{ wait(item) }}</span>
            </header>
            <strong class="arrival-plate">{{ item.vehicle_plate }}@if (item.tractor_plate) {<small> · cavalo {{ item.tractor_plate }}</small>}</strong>
            <p>{{ item.driver_name }} · NF {{ item.invoice_number }}</p>
            <div class="arrival-actions">
              <a routerLink="/chegadas" class="arrival-primary">Ver e decidir</a>
              <button type="button" class="arrival-dismiss" (click)="dismiss(item)" [attr.aria-label]="'Dispensar alerta da placa ' + item.vehicle_plate">Dispensar</button>
            </div>
          </article>
        }
        @if (cards().length > visibleLimit) {
          <a routerLink="/chegadas" class="arrival-more">+{{ cards().length - visibleLimit }} aguardando na portaria</a>
        }
        @if (cards().length) {
          <button type="button" class="arrival-more" (click)="dismissAll()">Dispensar todos os alertas</button>
        }
        @if (showPrompt()) {
          <article class="arrival-card arrival-prompt">
            <p>Ative as notificações para ser avisado de chegadas mesmo com o sistema em outra aba.</p>
            <div class="arrival-actions">
              <button type="button" class="arrival-primary" (click)="enableNotifications()">Ativar notificações</button>
              <button type="button" class="arrival-dismiss" (click)="skipPrompt()">Agora não</button>
            </div>
          </article>
        }
      </section>
    }
  }`,
  styles: [`
    .arrival-stack { position: fixed; z-index: 50; right: 24px; bottom: 24px; display: grid; gap: 12px; width: min(380px, calc(100vw - 32px)); max-height: calc(100dvh - 48px); overflow-y: auto; overscroll-behavior: contain; }
    .arrival-card { display: grid; gap: 6px; padding: 16px 18px; background: var(--surface); color: var(--text); border: 1px solid var(--line); border-left: 6px solid var(--warning); border-radius: var(--radius-card); box-shadow: var(--shadow-overlay); animation: arrival-in .22s ease-out; }
    .arrival-card[data-level="1"] { background: var(--warning-soft); }
    .arrival-card[data-level="2"] { background: var(--danger-soft); border-left-color: var(--danger); }
    .arrival-card header { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; font-weight: 600; }
    .arrival-kicker { color: var(--muted); }
    .arrival-wait { color: var(--warning); font-weight: 700; white-space: nowrap; }
    .arrival-card[data-level="2"] .arrival-wait { color: var(--danger); }
    .arrival-plate { font: 700 20px/1.3 var(--font-heading); letter-spacing: .02em; }
    .arrival-plate small { font: 600 14px/1.4 var(--font-body); color: var(--muted); letter-spacing: 0; }
    .arrival-card p { margin: 0; font-size: 14px; line-height: 1.5; color: var(--muted); overflow-wrap: anywhere; }
    .arrival-actions { display: flex; gap: 8px; margin-top: 6px; }
    .arrival-primary,.arrival-dismiss { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 16px; border-radius: var(--radius-control); font: 600 14px/1.4 var(--font-body); text-decoration: none; cursor: pointer; }
    .arrival-primary { flex: 1; background: var(--green); color: var(--brand-contrast); border: 0; }
    .arrival-primary:hover { background: var(--brand-hover); }
    .arrival-dismiss { background: transparent; color: var(--text); border: 1px solid var(--control-line); }
    .arrival-more { justify-self: end; padding: 8px 14px; border-radius: var(--radius-full); background: var(--surface); border: 1px solid var(--line); box-shadow: var(--shadow-card); color: var(--green); font-size: 13px; font-weight: 700; text-decoration: none; cursor: pointer; }
    .arrival-prompt { border-left-color: var(--blue); }
    .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    @keyframes arrival-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
    @media (max-width: 767px) { .arrival-stack { left: 16px; right: 16px; width: auto; bottom: calc(88px + env(safe-area-inset-bottom, 0px)); max-height: calc(100dvh - 168px - env(safe-area-inset-bottom, 0px)); } }
    @media (prefers-reduced-motion: reduce) { .arrival-card { animation: none; } }
    @media print { .arrival-stack { display: none; } }
  `],
})
export class ArrivalAlert {
  /** Esconde os cartões (ex.: já na tela de Chegadas); som, notificação e título continuam. */
  readonly hidden = input(false);
  readonly visibleLimit = VISIBLE_CARDS;
  private api = inject(Api);
  private live = inject(GateLive);
  private router = inject(Router);
  readonly pending = signal<Arrival[]>([]);
  readonly now = signal(Date.now());
  readonly dismissed = signal<ReadonlyMap<string, WaitLevel>>(new Map());
  readonly announcement = signal("");
  readonly error = signal("");
  readonly permission = signal<NotificationPermission | "unsupported">(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  readonly promptSkipped = signal(readFlag(PROMPT_KEY));
  readonly active = computed(() => ["warehouse", "admin"].includes(this.api.user()?.role ?? ""));
  readonly cards = computed(() => this.pending().filter(item => this.level(item) > (this.dismissed().get(item.id) ?? -1)));
  readonly visibleCards = computed(() => this.cards().slice(0, VISIBLE_CARDS));
  readonly showPrompt = computed(() => this.permission() === "default" && !this.promptSkipped());
  private alerted = new Map<string, WaitLevel>();
  private seeded = false;
  private generation = 0;
  private actor = "";
  private timer?: number;
  private controller?: AbortController;
  private refreshQueued = false;
  private loadingEvents = new Map<string, GateMessage>();
  private decided = new Set<string>();
  private notices = new Set<Notification>();
  private audio?: AudioContext;
  private baseTitle = typeof document === "undefined" ? "" : document.title;

  constructor() {
    const destroy = inject(DestroyRef);
    const unlock = () => { if (this.active()) void this.audioContext()?.resume().catch(() => undefined); };
    document.addEventListener("pointerdown", unlock, { passive: true });
    destroy.onDestroy(() => { document.removeEventListener("pointerdown", unlock); this.reset(); this.setTitle(0); });
    effect(() => {
      const active = this.active();
      const actor = active && this.api.token() ? `${this.api.user()?.id}:${this.api.token()}` : "";
      this.live.refreshed();
      untracked(() => {
        if (actor !== this.actor) {
          this.reset(); this.actor = actor;
          if (actor) { this.now.set(Date.now()); this.timer = window.setInterval(() => { this.now.set(Date.now()); this.escalate(); }, 30000); }
        }
        if (actor) void this.load();
      });
    });
    effect(() => {
      const message = this.live.last();
      if (!message || !this.active() || !this.api.token()) return;
      untracked(() => {
        const id = message.arrival.id;
        if (message.event !== "created" || message.arrival.decision !== "pending") this.decided.add(id);
        if (message.event === "created" && this.decided.has(id)) return;
        if (this.controller) { this.loadingEvents.set(id, message); this.refreshQueued = true; }
        this.pending.update(rows => applyPending(rows, message));
        if (message.event === "created" && message.arrival.decision === "pending" && !this.alerted.has(id)) this.alertNew([message.arrival]);
        else if (message.event !== "created" || message.arrival.decision !== "pending") {
          this.alerted.delete(id);
          this.dismissed.update(map => { const next = new Map(map); next.delete(id); return next; });
          this.closeNotice(id);
        }
      });
    });
    effect(() => this.setTitle(this.active() ? this.pending().length : 0));
  }

  level(item: Arrival): WaitLevel { return waitLevel(waitMinutes(item.created_at, this.now())); }
  wait(item: Arrival) { return waitLabel(waitMinutes(item.created_at, this.now())); }

  dismiss(item: Arrival) {
    this.dismissed.update(map => new Map(map).set(item.id, this.level(item)));
  }

  dismissAll() {
    this.dismissed.set(new Map(this.pending().map(item => [item.id, this.level(item)])));
  }

  async enableNotifications() {
    if (typeof Notification === "undefined") return;
    void this.audioContext()?.resume().catch(() => undefined);
    try { this.permission.set(await Notification.requestPermission()); }
    catch { this.permission.set("unsupported"); }
  }

  skipPrompt() {
    writeFlag(PROMPT_KEY);
    this.promptSkipped.set(true);
  }

  async load() {
    if (!this.active() || !this.api.token()) return;
    if (this.controller) { this.refreshQueued = true; return; }
    const controller = new AbortController();
    this.controller = controller;
    this.refreshQueued = false;
    this.loadingEvents.clear();
    const generation = ++this.generation;
    try {
      const snapshot = await this.api.getAll<Arrival>("gate-arrivals/?decision=pending", controller.signal);
      if (generation !== this.generation || !this.active() || controller.signal.aborted) return;
      const rows = reconcilePending(snapshot, this.loadingEvents.values()).filter(item => !this.decided.has(item.id));
      const fresh = rows.filter(item => !this.alerted.has(item.id));
      this.pending.set(rows);
      this.error.set("");
      const ids = new Set(rows.map(item => item.id));
      for (const id of [...this.alerted.keys()]) if (!ids.has(id)) this.alerted.delete(id);
      this.dismissed.update(map => new Map([...map].filter(([id]) => ids.has(id))));
      if (this.seeded) this.alertNew(fresh);
      else fresh.forEach(item => this.alerted.set(item.id, this.level(item)));
      this.seeded = true;
    } catch (error) {
      if (generation === this.generation && !controller.signal.aborted) this.error.set(apiError(error));
    } finally {
      if (this.controller === controller) {
        const refresh = this.refreshQueued;
        this.controller = undefined; this.loadingEvents.clear(); this.refreshQueued = false;
        // Offset pagination can shift during arrivals/decisions. Repeat after concurrent changes.
        if (refresh) void this.load();
      }
    }
  }

  private reset() {
    this.generation++;
    window.clearInterval(this.timer);
    this.timer = undefined;
    this.controller?.abort();
    this.controller = undefined;
    this.refreshQueued = false;
    this.loadingEvents.clear();
    this.decided.clear();
    this.pending.set([]);
    this.dismissed.set(new Map());
    this.alerted.clear();
    this.seeded = false;
    this.announcement.set("");
    this.error.set("");
    for (const notice of this.notices) notice.close();
    this.notices.clear();
    if (this.audio) { void this.audio.close().catch(() => undefined); this.audio = undefined; }
  }

  private alertNew(items: Arrival[]) {
    if (!items.length) return;
    items.forEach(item => this.alerted.set(item.id, this.level(item)));
    const first = items[items.length - 1];
    const text = items.length === 1
      ? `Transportadora chegou na portaria: placa ${first.vehicle_plate}, motorista ${first.driver_name}.`
      : `${items.length} transportadoras chegaram na portaria.`;
    this.notify(text, first.id, 0);
  }

  /** Repete o alerta quando a espera passa de um nível (15 e 30 min), mesmo se o cartão foi dispensado. */
  private escalate() {
    if (!this.active()) return;
    for (const item of this.pending()) {
      const level = this.level(item);
      if (level > (this.alerted.get(item.id) ?? 0)) {
        this.alerted.set(item.id, level);
        this.notify(`Placa ${item.vehicle_plate} aguarda na portaria ${this.wait(item)}.`, item.id, level);
      }
    }
  }

  private notify(text: string, id: string, level: WaitLevel) {
    this.announcement.set(text);
    try { this.beep(level); } catch { /* O cartão continua disponível sem áudio. */ }
    try { navigator.vibrate?.(level === 2 ? [250, 120, 250, 120, 250] : [200, 100, 200]); } catch { /* Vibração opcional. */ }
    if (this.permission() === "granted" && (document.hidden || !document.hasFocus())) {
      try {
        const notice = new Notification(level ? "Transportadora aguardando" : "Transportadora chegou", { body: text, tag: `arrival-${id}`, requireInteraction: true });
        this.notices.add(notice);
        notice.onclose = () => this.notices.delete(notice);
        notice.onclick = () => { window.focus(); void this.router.navigateByUrl("/chegadas"); notice.close(); };
      } catch { /* Navegadores móveis exigem service worker; o cartão e o som continuam. */ }
    }
  }

  private audioContext() {
    if (this.audio) return this.audio;
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    try { if (Context) this.audio = new Context(); } catch { /* Áudio indisponível. */ }
    return this.audio;
  }

  private beep(level: WaitLevel) {
    const context = this.audioContext();
    if (!context || context.state !== "running") return;
    const tones = level === 2 ? [880, 660, 880] : [660, 880];
    tones.forEach((frequency, index) => {
      const start = context.currentTime + index * 0.22;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.2);
    });
  }

  private setTitle(count: number) {
    if (typeof document === "undefined") return;
    document.title = count ? `(${count}) Chegada${count === 1 ? "" : "s"} · ${this.baseTitle}` : this.baseTitle;
  }

  private closeNotice(id: string) {
    for (const notice of this.notices) if (notice.tag === `arrival-${id}`) { notice.close(); this.notices.delete(notice); }
  }
}
