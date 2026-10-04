import { Component, computed, DestroyRef, effect, ElementRef, inject, signal, untracked, ViewChild } from "@angular/core";
import { NavigationEnd, Router, RouterLink, RouterOutlet } from "@angular/router";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { IonApp, IonButton, IonIcon, IonPopover } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { calendarOutline, checkmarkCircleOutline, cubeOutline, documentTextOutline, gridOutline, leafOutline, logOutOutline, menuOutline, moonOutline, notificationsOutline, peopleOutline, shieldCheckmarkOutline, sunnyOutline, trailSignOutline, warningOutline, eyeOutline, eyeOffOutline, arrowForwardOutline, closeOutline } from "ionicons/icons";
import { Api } from "./core/api";
import { GateLive } from "./core/gate-live";
import { BrandMark, ThemeToggle } from "./shared/ui";
import { ArrivalAlert } from "./shared/arrival-alert";

interface NavigationTab { route: string; label: string; roles?: string[]; }
interface NavigationItem { route: string; label: string; shortLabel?: string; icon: string; roles?: string[]; tabs?: NavigationTab[]; }
const MODULES: NavigationItem[] = [
  { route: "/agenda", label: "Agenda", icon: "calendar-outline", roles: ["supplier", "purchasing", "warehouse", "management"], tabs: [
    { route: "/agenda", label: "Agenda" },
    { route: "/compras", label: "Conferência de compras", roles: ["purchasing", "management"] },
  ] },
  { route: "/portaria", label: "Portaria", icon: "trail-sign-outline", roles: ["gatehouse", "management"], tabs: [
    { route: "/portaria", label: "Agenda da portaria" },
    { route: "/portaria/avisos", label: "Aviso com foto", roles: ["gatehouse"] },
    { route: "/chegadas", label: "Chegadas enviadas", roles: ["gatehouse"] },
  ] },
  { route: "/descarga", label: "Descarga", icon: "cube-outline", roles: ["warehouse", "management"] },
  { route: "/escala", label: "Equipe", icon: "people-outline", roles: ["warehouse", "management"], tabs: [
    { route: "/escala", label: "Escala" },
    { route: "/pessoas", label: "Pessoas" },
    { route: "/equipamentos", label: "Equipamentos" },
    { route: "/boletins", label: "Boletins" },
  ] },
  { route: "/gestao", label: "Gestão", icon: "grid-outline", roles: ["management", "warehouse", "purchasing"], tabs: [
    { route: "/gestao", label: "Indicadores" },
    { route: "/gestao/logistica", label: "Logística e Entregas" },
    { route: "/chegadas", label: "Chegadas", roles: ["warehouse", "purchasing", "management"] },
    { route: "/nao-recebimentos", label: "Não recebimentos", roles: ["warehouse", "management"] },
  ] },
];
@Component({ selector: "app-root", standalone: true,
  imports: [RouterOutlet, RouterLink, IonApp, IonButton, IonIcon, IonPopover, BrandMark, ThemeToggle, ArrivalAlert],
  template: `<ion-app>
    @if (api.user()) {
      <a class="skip-link" href="#main-content">Ir para o conteúdo</a>
      <div class="shell">
        <aside class="sidebar">
          <a [routerLink]="homeRoute()" class="brand" aria-label="Cocapec Recebimento"><app-brand /></a>
          <nav class="navigation" aria-label="Módulos">@for (item of navItems(); track item.route) { <a [routerLink]="item.route" [class.active]="groupActive(item)" [attr.aria-current]="groupActive(item) ? 'page' : null"><ion-icon [name]="item.icon" aria-hidden="true" /><span>{{ item.label }}{{ arrivalCount(item.route) }}</span></a> }</nav>
          <div class="sidebar-note"><ion-icon name="leaf-outline" aria-hidden="true" /><span>Agenda, operação<br />e boletim diário.</span></div>
          <div class="user"><span class="avatar" aria-hidden="true">{{ initials() }}</span><div><strong>{{ api.user()?.username }}</strong><small>{{ roleLabel() }}</small></div></div>
        </aside>
        <main #mainContent class="main" id="main-content" tabindex="-1">
          <header class="topbar"><div class="topbar-context"><button type="button" class="icon-button tablet-menu" aria-label="Abrir módulos" (click)="menuOpen.set(true)"><ion-icon name="menu-outline" aria-hidden="true" /></button><span>{{ currentModule() }}</span><span class="context-divider" aria-hidden="true"></span><small>Recebimento Cocapec</small></div><div class="topbar-actions">@if (unreadArrivals()) { <a routerLink="/chegadas" [queryParams]="alertQuery()" class="arrival-alert">{{ alertLabel() }}</a> }<span class="topbar-user">{{ roleLabel() }}</span><app-theme-toggle /><ion-button fill="clear" size="small" (click)="api.logout()"><ion-icon name="log-out-outline" aria-hidden="true" slot="start" />Sair</ion-button></div></header>
          @if (live.status() === "disconnected") { <p class="notice" role="status">Atualização em tempo real desconectada. Reconectando; use Atualizar para consultar os registros.</p> }
          @if (tabs().length > 1) { <nav class="module-tabs" [attr.aria-label]="'Seções de ' + currentModule()">@for (tab of tabs(); track tab.route) { <a [routerLink]="tab.route" [class.active]="path() === tab.route" [attr.aria-current]="path() === tab.route ? 'page' : null">{{ tab.label }}</a> }</nav> }
          <router-outlet />
        </main>
        <app-arrival-alert [hidden]="path() === '/chegadas'" />
        <nav class="pill-nav" aria-label="Módulos principais">@for (item of primaryItems(); track item.route) { <a [routerLink]="item.route" [class.active]="groupActive(item)" [attr.aria-current]="groupActive(item) ? 'page' : null" [attr.aria-label]="item.label"><ion-icon [name]="item.icon" aria-hidden="true" /><span>{{ item.shortLabel || item.label }}</span></a> }@if (extraItems().length) { <button type="button" [class.active]="extraActive()" [attr.aria-expanded]="menuOpen()" aria-label="Mais módulos" (click)="menuOpen.set(true)"><ion-icon name="menu-outline" aria-hidden="true" /><span>Mais</span></button> }</nav>
      </div>
      <ion-popover [isOpen]="menuOpen()" (didDismiss)="menuOpen.set(false)" cssClass="navigation-popover" [backdropDismiss]="true"><ng-template><div class="module-menu"><div class="module-menu-head"><h2>Módulos</h2><button class="icon-button" type="button" aria-label="Fechar módulos" (click)="menuOpen.set(false)"><ion-icon name="close-outline" aria-hidden="true" /></button></div><nav class="navigation" aria-label="Todos os módulos">@for (item of navItems(); track item.route) { <a [routerLink]="item.route" [class.active]="groupActive(item)" [attr.aria-current]="groupActive(item) ? 'page' : null" (click)="menuOpen.set(false)"><ion-icon [name]="item.icon" aria-hidden="true" /><span>{{ item.label }}{{ arrivalCount(item.route) }}</span></a> }</nav></div></ng-template></ion-popover>
    } @else { <router-outlet /> }
  </ion-app>`,
})
export class AppComponent {
  readonly api = inject(Api);
  readonly live = inject(GateLive);
  private router = inject(Router);
  private destroy = inject(DestroyRef);
  @ViewChild("mainContent") private mainContent?: ElementRef<HTMLElement>;
  readonly path = signal(this.router.url.split("?")[0]);
  readonly menuOpen = signal(false);
  readonly unreadArrivals = signal(0);
  readonly homeRoute = computed(() => ["gatehouse", "portaria"].includes(this.api.user()?.role ?? "") ? "/portaria" : "/agenda");
  readonly navItems = computed(() => {
    return MODULES.filter(item => !item.roles || this.api.can(...item.roles));
  });
  readonly primaryItems = computed(() => {
    const role = this.api.user()?.role;
    const priority = ["gatehouse", "portaria"].includes(role ?? "") ? ["/portaria"] : role === "supplier" ? ["/agenda"] : role === "warehouse" ? ["/agenda", "/descarga", "/escala"] : ["/agenda", "/escala", "/gestao"];
    return priority.map(route => this.navItems().find(item => item.route === route)).filter((item): item is NavigationItem => !!item);
  });
  readonly extraItems = computed(() => this.navItems().filter(item => !this.primaryItems().includes(item)));
  readonly extraActive = computed(() => this.extraItems().some(item => this.groupActive(item)));
  readonly currentGroup = computed(() => {
    const path = this.path();
    let best: NavigationItem | undefined;
    let length = -1;
    for (const item of this.navItems()) {
      for (const route of this.visibleTabs(item).map(tab => tab.route)) {
        if ((path === route || path.startsWith(route + "/")) && route.length > length) { best = item; length = route.length; }
      }
    }
    return best;
  });
  readonly tabs = computed(() => {
    const group = this.currentGroup();
    const tabs = group?.tabs ? this.visibleTabs(group) : [];
    return tabs.some(tab => tab.route === this.path()) ? tabs : [];
  });
  readonly currentModule = computed(() => this.currentGroup()?.label ?? "Recebimento");
  readonly initials = computed(() => this.api.user()?.username.slice(0, 2).toUpperCase() ?? "");
  constructor() {
    addIcons({ calendarOutline, checkmarkCircleOutline, cubeOutline, documentTextOutline, gridOutline, leafOutline, logOutOutline, menuOutline, moonOutline, notificationsOutline, peopleOutline, shieldCheckmarkOutline, sunnyOutline, trailSignOutline, warningOutline, eyeOutline, eyeOffOutline, arrowForwardOutline, closeOutline });
    const timer = window.setInterval(() => {
      if (this.watchesArrivals()) void this.loadArrivals(); else this.unreadArrivals.set(0);
    }, 20000);
    this.destroy.onDestroy(() => window.clearInterval(timer));
    effect(() => {
      const role = this.api.user()?.role;
      const message = this.live.last();
      const refreshed = this.live.refreshed();
      if (role === "warehouse" || role === "admin" || role === "management" || role === "gatehouse" || role === "portaria" || role === "purchasing") {
        untracked(() => this.live.connect());
      } else {
        untracked(() => this.live.close());
      }
      if ((message || refreshed) && (role === "warehouse" || role === "admin" || role === "management" || role === "purchasing")) {
        untracked(() => void this.loadArrivals());
      }
    });
    this.router.events.pipe(takeUntilDestroyed(this.destroy)).subscribe(event => {
      if (event instanceof NavigationEnd) {
        this.path.set(event.urlAfterRedirects.split("?")[0]);
        this.menuOpen.set(false);
        if (this.watchesArrivals()) void this.loadArrivals(); else this.unreadArrivals.set(0);
        const main = this.mainContent?.nativeElement;
        if (main) { main.scrollTop = 0; main.focus({ preventScroll: true }); }
      }
    });
  }
  arrivalCount(route: string) {
    const count = this.unreadArrivals();
    if (!count) return "";
    return route === "/gestao" && this.watchesArrivals() ? ` (${count})` : "";
  }
  alertQuery() {
    return this.api.user()?.role === "purchasing" ? { decisao: "rejected" } : {};
  }
  alertLabel() {
    const count = this.unreadArrivals();
    if (this.api.user()?.role === "purchasing") return count === 1 ? "1 chegada recusada" : `${count} chegadas recusadas`;
    return `${count} chegada${count === 1 ? "" : "s"}`;
  }
  private watchesArrivals() {
    const role = this.api.user()?.role;
    return role === "warehouse" || role === "admin" || role === "management" || role === "purchasing";
  }
  private async loadArrivals() {
    if (!this.watchesArrivals()) return;
    try {
      const actor=this.api.user()?.id;
      const result = await this.api.get<{ unread: number }>("gate-arrivals/?summary=1");
      if(this.api.user()?.id === actor && this.watchesArrivals()) this.unreadArrivals.set(result.unread);
    } catch {
      /* A contagem volta na próxima navegação. */
    }
  }
  visibleTabs(item: NavigationItem): NavigationTab[] { return (item.tabs ?? [item]).filter(tab => !tab.roles || this.api.can(...tab.roles)); }
  groupActive(item: NavigationItem): boolean { return this.currentGroup() === item; }
  roleLabel() { return ({ admin: "Administrador", supplier: "Fornecedor", purchasing: "Compras", warehouse: "Armazém", management: "Gestão", gatehouse: "Portaria", portaria: "Portaria" } as Record<string, string>)[this.api.user()?.role ?? ""] ?? ""; }
}
