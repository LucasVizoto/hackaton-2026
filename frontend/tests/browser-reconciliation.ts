// Browser-only acceptance runner: bundles the real Angular/Ionic components with synthetic providers.
// Run with esbuild, serve beside a page with #run, #results and #fixture, then click "Executar".
import "zone.js";
import "@angular/compiler";
import { createComponent, signal } from "@angular/core";
import { createApplication } from "@angular/platform-browser";
import { provideRouter } from "@angular/router";
import { provideIonicAngular } from "@ionic/angular/standalone";
import { Api } from "../src/app/core/api";
import { Arrival, GateLive, GateMessage } from "../src/app/core/gate-live";
import { ArrivalAlert } from "../src/app/shared/arrival-alert";
import { Notifications } from "../src/app/shared/notifications";

const results = document.querySelector("#results")!;
const fixture = document.querySelector("#fixture")!;
function assert(condition: unknown, text: string): asserts condition {
  if (!condition) throw new Error(text);
}
function pass(text: string) { const row = document.createElement("li"); row.textContent = "PASS: " + text; results.append(row); }
function arrival(id: string, created: number): Arrival {
  return { id, vehicle_plate: "QA" + id, tractor_plate: "", driver_name: "Sintético", invoice_number: "123", created_at: new Date(created).toISOString(), decision: "pending", decided_at: null, seen_at: null, created_by_name: "portaria_demo" };
}
async function run() {
  results.replaceChildren(); fixture.replaceChildren();
  const realNow = Date.now, realInterval = window.setInterval, realClear = window.clearInterval;
  const notification = Object.getOwnPropertyDescriptor(window, "Notification");
  const audio = Object.getOwnPropertyDescriptor(window, "AudioContext");
  const vibrate = Object.getOwnPropertyDescriptor(navigator, "vibrate");
  const focus = Object.getOwnPropertyDescriptor(document, "hasFocus");
  let clock = Date.parse("2026-10-05T12:00:00Z"), timerId = 0;
  const timers = new Map<number, () => void>();
  Date.now = () => clock;
  window.setInterval = ((callback: () => void) => { timers.set(++timerId, callback); return timerId; }) as typeof window.setInterval;
  window.clearInterval = (id?: number) => { if (id) timers.delete(id); };
  Object.defineProperty(window, "Notification", { configurable: true, value: undefined });
  Object.defineProperty(window, "AudioContext", { configurable: true, value: class { constructor() { throw new Error("Audio unavailable"); } } });
  Object.defineProperty(navigator, "vibrate", { configurable: true, value: () => { throw new Error("Vibration unavailable"); } });
  const user = signal({ id: 1, username: "qa", role: "warehouse", supplier_id: null });
  const token = signal("synthetic-token");
  const live = { last: signal<GateMessage | null>(null), refreshed: signal(0) };
  const snapshot = Array.from({ length: 105 }, (_, i) => arrival(String(i), clock));
  const requests: string[] = [];
  let pageTwo: ((value: unknown) => void) | undefined;
  let delayed = true, fail = false, acknowledged = false;
  const api = {
    user, token, can: (...roles: string[]) => user().role === "admin" || roles.includes(user().role),
    getAll: Api.prototype.getAll,
    async get(path: string, abort?: AbortSignal): Promise<unknown> {
      requests.push(path);
      if (path.startsWith("notifications/")) {
        const page = Number(new URLSearchParams(path.split("?")[1]).get("page") || 1);
        return { count: 101, next: page === 1 ? "next" : null, results: [{ id: "n" + page, appointment: "appointment", message: "Página " + page, created_at: new Date(clock).toISOString(), acknowledged_at: acknowledged ? new Date(clock).toISOString() : null }] };
      }
      const page = Number(new URLSearchParams(path.split("?")[1]).get("page") || 1);
      if (page === 2 && fail) throw new Error("Falha sintética na segunda página");
      if (page === 2 && delayed) return new Promise((resolve, reject) => {
        pageTwo = resolve; abort?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
      const rows = snapshot.filter(item => item.decision === "pending");
      return { count: rows.length, results: rows.slice((page - 1) * 50, page * 50), next: page * 50 < rows.length ? "next" : null };
    },
    async post() { acknowledged = true; }
  };
  const app = await createApplication({ providers: [provideRouter([]), provideIonicAngular({ mode: "md" }), { provide: Api, useValue: api }, { provide: GateLive, useValue: live }] });
  const tick = async () => { app.tick(); await new Promise(resolve => setTimeout(resolve, 0)); app.tick(); };
  const mountAlert = () => {
    const host = document.createElement("app-arrival-alert"); fixture.append(host);
    const ref = createComponent(ArrivalAlert, { environmentInjector: app.injector, hostElement: host });
    app.attachView(ref.hostView); return ref;
  };
  let alert = mountAlert();
  try {
    await tick();
    assert(pageTwo, "second page requested");
    live.last.set({ event: "created", arrival: arrival("new", clock) }); await tick();
    live.last.set({ event: "authorized", arrival: { ...snapshot[70], decision: "authorized" } }); await tick();
    live.last.set({ event: "rejected", arrival: { ...snapshot[80], decision: "rejected" } }); await tick();
    snapshot[70].decision = "authorized"; snapshot[80].decision = "rejected";
    snapshot.push(arrival("new", clock));
    delayed = false;
    pageTwo({ count: 105, results: snapshot.slice(50, 100), next: "next" }); await tick(); await tick();
    assert(alert.instance.pending().length === 104, "all 3 pages and concurrent events retained");
    assert(requests.length > 3, "concurrent changes trigger another full snapshot");
    assert(requests.some(path => path.includes("page=3")), "third page loaded");
    assert(!alert.instance.pending().some(item => ["70", "80"].includes(item.id)), "decisions stay removed");
    assert(["100", "101"].every(id => alert.instance.pending().some(item => item.id === id)), "repeat restores arrivals skipped when offset pages shift");
    pass("105 registros em três páginas; nova chegada preservada; autorização/recusa durante a consulta removidas");
    const announcement = alert.instance.announcement();
    live.last.set({ event: "created", arrival: arrival("new", clock) }); await tick();
    live.last.set({ event: "created", arrival: snapshot[70] }); await tick();
    assert(alert.instance.pending().length === 104 && alert.instance.announcement() === announcement, "duplicates do not reannounce or resurrect");
    pass("eventos duplicados não duplicam cartões, não repetem alertas e não restauram chegada decidida; áudio/vibração indisponíveis não interrompem");
    const item = alert.instance.pending()[0];
    alert.instance.dismiss(item); await tick();
    assert(!alert.instance.cards().some(row => row.id === item.id), "dismiss");
    clock += 15 * 60000; [...timers.values()].forEach(callback => callback()); await tick();
    assert(alert.instance.cards().some(row => row.id === item.id) && alert.instance.level(item) === 1, "15 min reappearance");
    alert.instance.dismiss(item);
    clock += 15 * 60000; [...timers.values()].forEach(callback => callback()); await tick();
    assert(alert.instance.cards().some(row => row.id === item.id) && alert.instance.level(item) === 2, "30 min reappearance");
    pass("cartão dispensado reaparece e alerta escala aos 15 e aos 30 minutos; contador inclui todas as pendências");
    alert.instance.dismissAll(); await tick();
    assert(alert.instance.cards().length === 0 && alert.instance.pending().length === 104 && document.title.startsWith("(104)"), "dismiss-all leaves pending count intact");
    pass("dispensa conjunta libera controles da página sem alterar pendências ou contador");
    delayed = false; live.refreshed.update(value => value + 1); await tick(); await tick();
    assert(alert.instance.pending().length === 104, "reconnection reflects persisted API");
    fail = true; live.refreshed.update(value => value + 1); await tick(); await tick();
    assert(alert.instance.error() && alert.instance.pending().length === 104, "failed later page retains complete last snapshot");
    assert(fixture.querySelector('[role="alert"]'), "failure is visible");
    fail = false; await alert.instance.load(); await tick();
    assert(!alert.instance.error(), "retry clears error");
    pass("reconexão reconcilia; falha na segunda página preserva lista anterior e mostra erro; nova tentativa recupera");
    delayed = true; live.refreshed.update(value => value + 1); await tick();
    token.set(""); await tick(); await tick();
    assert(alert.instance.pending().length === 0 && timers.size === 0, "logout aborts and clears timers");
    assert(!document.title.startsWith("("), "logout restores title");
    alert.destroy();
    pass("logout durante consulta cancela resposta, limpa cartões, título e temporizadores");
    delayed = false; token.set("synthetic-new-session"); alert = mountAlert(); await tick(); await tick();
    assert(alert.instance.pending().length === 104, "reload/recreation reads full persisted snapshot");
    user.set({ ...user(), role: "management" }); await tick();
    assert(!alert.instance.active() && alert.instance.pending().length === 0 && timers.size === 0, "management does not receive operational cards");
    user.set({ ...user(), role: "admin" }); await tick(); await tick();
    assert(alert.instance.active() && alert.instance.pending().length === 104, "admin cards");
    alert.destroy(); await tick();
    assert(timers.size === 0, "destruction clears timers");
    pass("recriação carrega pendências persistidas; Gestão sem cartões operacionais; Administrador com cartões; desmontagem limpa recursos");
    class FakeNotice {
      static permission = "default";
      static async requestPermission(): Promise<NotificationPermission> { throw new Error("Permission unavailable"); }
      tag: string; closed = false;
      onclick?: () => void; onclose?: () => void;
      constructor(_title: string, options: NotificationOptions) { this.tag = options.tag || ""; noticesCreated.push(this); }
      close() { this.closed = true; this.onclose?.(); }
    }
    const noticesCreated: FakeNotice[] = [];
    Object.defineProperty(window, "Notification", { configurable: true, value: FakeNotice });
    alert = mountAlert(); await tick(); await tick();
    await alert.instance.enableNotifications(); await tick();
    assert(alert.instance.permission() === "unsupported" && alert.instance.cards().length === 104, "permission failure keeps cards");
    alert.destroy();
    FakeNotice.permission = "denied"; alert = mountAlert(); await tick(); await tick();
    assert(!alert.instance.showPrompt() && alert.instance.cards().length === 104, "denied permission keeps cards");
    alert.destroy();
    let tones = 0, audioClosed = false;
    Object.defineProperty(window, "AudioContext", { configurable: true, value: class {
      state = "running"; currentTime = 0; destination = {};
      async resume() {} async close() { audioClosed = true; }
      createOscillator() { return { frequency: { value: 0 }, connect() { return { connect() {} }; }, start() { tones++; }, stop() {} }; }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
    } });
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => false });
    FakeNotice.permission = "granted"; live.last.set(null); alert = mountAlert(); await tick(); await tick();
    live.last.set({ event: "created", arrival: arrival("notice", clock) }); await tick();
    assert(tones === 2 && noticesCreated.length === 1, "sound and background notification");
    live.last.set({ event: "authorized", arrival: { ...arrival("notice", clock), decision: "authorized" } }); await tick();
    assert(noticesCreated[0].closed, "decision closes browser notice");
    live.last.set({ event: "created", arrival: arrival("logout-notice", clock) }); await tick();
    token.set(""); await tick();
    assert(audioClosed && noticesCreated.every(notice => notice.closed), "logout closes audio and browser notifications");
    alert.destroy(); token.set("synthetic-new-session");
    pass("permissão recusada ou falha mantém cartões; com permissão concedida gera som e notificação em segundo plano; decisão/logout fecha notificações e áudio");
    const host = document.createElement("app-notifications"); fixture.append(host);
    const notices = createComponent(Notifications, { environmentInjector: app.injector, hostElement: host });
    app.attachView(notices.hostView); await tick();
    await notices.instance.load(2); await notices.instance.acknowledge("n2"); await tick();
    assert(notices.instance.page === 2 && notices.instance.count() === 101 && notices.instance.unread() === 0, "acknowledgement retains current page and total");
    assert(host.textContent?.includes("não lidos nesta página") && host.querySelector(".notif-box"), "compact visual retains page-local label");
    notices.destroy();
    pass("componente Angular/Ionic de avisos: 101 registros, segunda página mantida após reconhecimento e não lidos referentes à página");
    pass("TODOS OS CENÁRIOS APROVADOS");
  } finally {
    app.destroy(); Date.now = realNow; window.setInterval = realInterval; window.clearInterval = realClear;
    for (const [target, key, descriptor] of [[window, "Notification", notification], [window, "AudioContext", audio], [navigator, "vibrate", vibrate], [document, "hasFocus", focus]] as const) {
      if (descriptor) Object.defineProperty(target, key, descriptor); else Reflect.deleteProperty(target, key);
    }
  }
}
document.querySelector<HTMLButtonElement>("#run")!.onclick = () => { void run().catch(error => { const row = document.createElement("li"); row.textContent = "FAIL: " + error.message; results.append(row); console.error(error); }); };
