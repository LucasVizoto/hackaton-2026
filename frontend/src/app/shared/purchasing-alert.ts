import { Component, computed, DestroyRef, effect, inject, input, signal, untracked } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { Api, apiError } from "../core/api";
import { AlertTitle } from "../core/alert-title";
import { GateLive, LiveNotice } from "../core/gate-live";
import { WaitLevel, waitLabel, waitLevel, waitMinutes } from "../core/arrival-wait";
import { ALERT_STYLES } from "./arrival-alert";

const VISIBLE_CARDS = 3;
const PROMPT_KEY = "purchasing-alert-prompt-dismissed";

function readFlag(key: string) { try { return localStorage.getItem(key) === "1"; } catch { return false; } }
function writeFlag(key: string) { try { localStorage.setItem(key, "1"); } catch { /* Preferência só desta sessão. */ } }

/**
 * Alerta persistente para Compras com as mesmas características do alerta de chegada do Armazém:
 * cartão fixo com tempo de espera, som, vibração, notificação do navegador e contador no título.
 * Dispara quando o Armazém encaminha uma divergência ou uma diferença de recebimento para Compras.
 */
@Component({
  selector: "app-purchasing-alert",
  standalone: true,
  imports: [RouterLink],
  template: `@if (active()) {
    <p class="visually-hidden" aria-live="assertive">{{ announcement() }}</p>
    @if (!hidden() && (cards().length || showPrompt() || error())) {
      <section class="arrival-stack" aria-label="Solicitações do Armazém aguardando Compras">
        @if (error()) {
          <article class="arrival-card" role="alert">
            <p>Não foi possível atualizar os avisos. {{ error() }}</p>
            <button type="button" class="arrival-dismiss" (click)="load()">Tentar novamente</button>
          </article>
        }
        @for (item of visibleCards(); track item.id) {
          <article class="arrival-card" [attr.data-level]="level(item)">
            <header>
              <span class="arrival-kicker">Solicitação do Armazém</span>
              <span class="arrival-wait">{{ wait(item) }}</span>
            </header>
            <strong class="arrival-plate">{{ item.vehicle_plate || item.supplier_name || "Recebimento" }}@if (item.vehicle_plate && item.supplier_name) {<small> · {{ item.supplier_name }}</small>}</strong>
            <p>{{ item.message }}@if (item.driver_name) { · {{ item.driver_name }}}</p>
            <div class="arrival-actions">
              <a [routerLink]="['/agenda', item.appointment]" class="arrival-primary">Abrir recebimento</a>
              <button type="button" class="arrival-dismiss" (click)="dismiss(item)" [attr.aria-label]="'Dispensar alerta: ' + item.message">Dispensar</button>
            </div>
          </article>
        }
        @if (cards().length > visibleLimit) {
          <a routerLink="/agenda" class="arrival-more">+{{ cards().length - visibleLimit }} aguardando Compras</a>
        }
        @if (cards().length) {
          <button type="button" class="arrival-more" (click)="dismissAll()">Dispensar todos os alertas</button>
        }
        @if (showPrompt()) {
          <article class="arrival-card arrival-prompt">
            <p>Ative as notificações para ser avisado das solicitações do Armazém mesmo com o sistema em outra aba.</p>
            <div class="arrival-actions">
              <button type="button" class="arrival-primary" (click)="enableNotifications()">Ativar notificações</button>
              <button type="button" class="arrival-dismiss" (click)="skipPrompt()">Agora não</button>
            </div>
          </article>
        }
      </section>
    }
  }`,
  styles: [ALERT_STYLES],
})
export class PurchasingAlert {
  /** Esconde os cartões (ex.: já no recebimento); som, notificação e título continuam. */
  readonly hidden = input(false);
  readonly visibleLimit = VISIBLE_CARDS;
  private api = inject(Api);
  private live = inject(GateLive);
  private router = inject(Router);
  readonly pending = signal<LiveNotice[]>([]);
  readonly now = signal(Date.now());
  readonly dismissed = signal<ReadonlyMap<string, WaitLevel>>(new Map());
  readonly announcement = signal("");
  readonly error = signal("");
  readonly permission = signal<NotificationPermission | "unsupported">(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  readonly promptSkipped = signal(readFlag(PROMPT_KEY));
  readonly active = computed(() => this.api.user()?.role === "purchasing");
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
  private notices = new Set<Notification>();
  private audio?: AudioContext;
  private title = inject(AlertTitle);

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
      const notice = this.live.notice();
      if (!notice || !this.active() || !this.api.token()) return;
      untracked(() => {
        if (notice.acknowledged_at || this.pending().some(item => item.id === notice.id)) return;
        this.pending.update(rows => [...rows, notice].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)));
        if (!this.alerted.has(notice.id)) this.alertNew([notice]);
      });
    });
    effect(() => this.setTitle(this.active() ? this.pending().length : 0));
  }

  level(item: LiveNotice): WaitLevel { return waitLevel(waitMinutes(item.created_at, this.now())); }
  wait(item: LiveNotice) { return waitLabel(waitMinutes(item.created_at, this.now())); }

  dismiss(item: LiveNotice) {
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
    const generation = ++this.generation;
    try {
      const snapshot = await this.api.getAll<LiveNotice>("notifications/?unread=true", controller.signal);
      if (generation !== this.generation || !this.active() || controller.signal.aborted) return;
      const rows = snapshot.filter(item => !item.acknowledged_at).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
      const fresh = rows.filter(item => !this.alerted.has(item.id));
      this.pending.set(rows);
      this.error.set("");
      const ids = new Set(rows.map(item => item.id));
      for (const id of [...this.alerted.keys()]) if (!ids.has(id)) { this.alerted.delete(id); this.closeNotice(id); }
      this.dismissed.update(map => new Map([...map].filter(([id]) => ids.has(id))));
      if (this.seeded) this.alertNew(fresh);
      else fresh.forEach(item => this.alerted.set(item.id, this.level(item)));
      this.seeded = true;
    } catch (error) {
      if (generation === this.generation && !controller.signal.aborted) this.error.set(apiError(error));
    } finally {
      if (this.controller === controller) {
        const refresh = this.refreshQueued;
        this.controller = undefined; this.refreshQueued = false;
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

  private alertNew(items: LiveNotice[]) {
    if (!items.length) return;
    items.forEach(item => this.alerted.set(item.id, this.level(item)));
    const first = items[items.length - 1];
    const text = items.length === 1
      ? `Armazém enviou para Compras: ${first.message}${first.vehicle_plate ? ` Placa ${first.vehicle_plate}.` : ""}`
      : `${items.length} solicitações do Armazém aguardam Compras.`;
    this.notify(text, first, 0);
  }

  /** Repete o alerta quando a espera passa de um nível (15 e 30 min), mesmo se o cartão foi dispensado. */
  private escalate() {
    if (!this.active()) return;
    for (const item of this.pending()) {
      const level = this.level(item);
      if (level > (this.alerted.get(item.id) ?? 0)) {
        this.alerted.set(item.id, level);
        this.notify(`Solicitação do Armazém aguarda Compras ${this.wait(item)}: ${item.message}`, item, level);
      }
    }
  }

  private notify(text: string, item: LiveNotice, level: WaitLevel) {
    this.announcement.set(text);
    try { this.beep(level); } catch { /* O cartão continua disponível sem áudio. */ }
    try { navigator.vibrate?.(level === 2 ? [250, 120, 250, 120, 250] : [200, 100, 200]); } catch { /* Vibração opcional. */ }
    if (this.permission() === "granted" && (document.hidden || !document.hasFocus())) {
      try {
        const notice = new Notification(level ? "Solicitação aguardando Compras" : "Nova solicitação do Armazém", { body: text, tag: `purchasing-${item.id}`, requireInteraction: true });
        this.notices.add(notice);
        notice.onclose = () => this.notices.delete(notice);
        notice.onclick = () => { window.focus(); void this.router.navigate(["/agenda", item.appointment]); notice.close(); };
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
    this.title.set("purchasing-notices", count, `Aviso${count === 1 ? "" : "s"} de Compras`);
  }

  private closeNotice(id: string) {
    for (const notice of this.notices) if (notice.tag === `purchasing-${id}`) { notice.close(); this.notices.delete(notice); }
  }
}
