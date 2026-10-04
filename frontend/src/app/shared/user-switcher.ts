import { Component, DestroyRef, InjectionToken, inject, signal } from "@angular/core";
import { IonPopover } from "@ionic/angular/standalone";
import { Api, Page, User, apiError } from "../core/api";
import { GateLive } from "../core/gate-live";

export const reloadUserHome = new InjectionToken<(user: User) => void>("reloadUserHome", {
  providedIn: "root",
  factory: () => user => location.replace(["gatehouse", "portaria"].includes(user.role) ? "/portaria" : "/agenda"),
});

@Component({
  selector: "app-user-switcher", standalone: true, imports: [IonPopover],
  template: `
    <button type="button" class="user-switch-trigger" aria-haspopup="dialog"
      [attr.aria-expanded]="opened()" [disabled]="switching()" (click)="open($event)">
      <span>Trocar usuário</span><strong>{{ api.user()?.username }}</strong>
    </button>
    <ion-popover [isOpen]="opened()" [event]="anchor" cssClass="user-switch-popover"
      [backdropDismiss]="!switching()" [keyboardClose]="false" (didDismiss)="dismiss()">
      <ng-template>
        <section class="user-switch-panel" aria-label="Trocar usuário" [attr.aria-busy]="loading() || switching()">
          <header><h2>Trocar usuário</h2><button type="button" [disabled]="switching()" (click)="dismiss()">Fechar</button></header>
          <label>Buscar usuário<input type="search" [value]="search()" [disabled]="switching()"
            (input)="filter($any($event.target).value)" placeholder="Nome de usuário" /></label>
          @if (error()) { <p role="alert">{{ error() }}</p><button type="button" (click)="retry()" [disabled]="switching()">Tentar novamente</button> }
          @if (loading()) { <p role="status">Carregando usuários…</p> }
          @if (switching()) { <p role="status">Trocando usuário…</p> }
          @if (page(); as result) {
            <div class="user-switch-list">
              @for (user of result.results; track user.id) {
                <button type="button" [class.current]="user.id === api.user()?.id"
                  [attr.aria-current]="user.id === api.user()?.id ? 'true' : null"
                  [disabled]="switching()" (click)="select(user)">
                  <span><strong>{{ user.username }}</strong><small>{{ roleLabel(user.role) }}</small></span>
                  @if (user.id === api.user()?.id) { <small>Atual</small> }
                </button>
              } @empty { <p>Nenhum usuário encontrado.</p> }
            </div>
            <footer><button type="button" [disabled]="!result.previous || switching()" (click)="load(pageNumber() - 1)">Anterior</button>
              <span>Página {{ pageNumber() }}</span><button type="button" [disabled]="!result.next || switching()" (click)="load(pageNumber() + 1)">Próxima</button></footer>
          }
        </section>
      </ng-template>
    </ion-popover>`,
})
export class UserSwitcher {
  readonly api = inject(Api);
  private live = inject(GateLive);
  private reload = inject(reloadUserHome);
  readonly opened = signal(false);
  readonly search = signal("");
  readonly page = signal<Page<User> | null>(null);
  readonly pageNumber = signal(1);
  readonly loading = signal(false);
  readonly switching = signal(false);
  readonly error = signal("");
  anchor?: Event;
  private controller?: AbortController;
  private generation = 0;
  private failedTarget?: User;
  constructor() { inject(DestroyRef).onDestroy(() => this.cancelLoad()); }
  open(event: Event) {
    if (this.switching()) return;
    this.anchor = event;
    this.opened.set(true);
    this.search.set("");
    void this.load(1);
  }
  dismiss() {
    if (this.switching()) return;
    this.opened.set(false);
    this.cancelLoad();
    this.page.set(null);
  }
  filter(search: string) {
    if (this.switching()) return;
    this.search.set(search);
    void this.load(1);
  }
  async load(page = this.pageNumber()) {
    if (this.switching()) return;
    this.cancelLoad();
    const generation = this.generation;
    this.controller = new AbortController();
    this.pageNumber.set(page);
    this.loading.set(true);
    this.page.set(null);
    this.error.set("");
    this.failedTarget = undefined;
    try {
      const params = new URLSearchParams({ search: this.search(), page: String(page) });
      const result = await this.api.get<Page<User>>(`auth/users/?${params}`, this.controller.signal);
      if (generation === this.generation) this.page.set(result);
    } catch (error) {
      if (generation === this.generation) this.error.set(apiError(error));
    } finally {
      if (generation === this.generation) this.loading.set(false);
    }
  }
  async select(user: User) {
    if (this.switching()) return;
    if (user.id === this.api.user()?.id) { this.dismiss(); return; }
    this.switching.set(true);
    this.error.set("");
    this.cancelLoad();
    try {
      const session = await this.api.switchUser(user.id);
      this.live.close();
      this.reload(session.user);
    } catch (error) {
      this.failedTarget = user;
      this.error.set(apiError(error));
      this.switching.set(false);
    }
  }
  retry() { if (this.failedTarget) void this.select(this.failedTarget); else void this.load(); }
  roleLabel(role: string) {
    return ({ admin: "Administrador", supplier: "Fornecedor", purchasing: "Compras", warehouse: "Armazém", management: "Gestão", gatehouse: "Portaria", portaria: "Portaria" } as Record<string, string>)[role] ?? role;
  }
  private cancelLoad() { this.generation++; this.controller?.abort(); this.loading.set(false); }
}
