import { Component, computed, DestroyRef, effect, ElementRef, inject, signal, untracked, ViewChild } from "@angular/core";
import { NavigationEnd, Router, RouterLink, RouterOutlet } from "@angular/router";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { IonApp, IonButton, IonIcon, IonPopover } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { calendarOutline, checkmarkCircleOutline, documentTextOutline, gridOutline, leafOutline, logOutOutline, menuOutline, moonOutline, notificationsOutline, peopleOutline, shieldCheckmarkOutline, sunnyOutline, trailSignOutline, warningOutline, eyeOutline, eyeOffOutline, arrowForwardOutline, closeOutline } from "ionicons/icons";
import { Api } from "./core/api";
import { GateLive } from "./core/gate-live";
import { BrandMark, ThemeToggle } from "./shared/ui";

interface NavigationItem { route: string; label: string; shortLabel?: string; icon: string; roles?: string[]; }
const MODULES: NavigationItem[] = [
  { route: "/agenda", label: "Agenda", icon: "calendar-outline", roles: ["supplier", "purchasing", "warehouse", "management"] },
  { route: "/compras", label: "Compras", icon: "checkmark-circle-outline", roles: ["purchasing"] },
  { route: "/portaria", label: "Portaria", icon: "trail-sign-outline", roles: ["gatehouse"] },
  { route: "/portaria/avisos", label: "Aviso com foto", icon: "notifications-outline", roles: ["gatehouse"] },
  { route: "/portaria/chegadas", label: "Chegadas enviadas", shortLabel: "Chegadas", icon: "document-text-outline", roles: ["gatehouse"] },
  { route: "/pessoas", label: "Pessoas", icon: "people-outline", roles: ["warehouse", "management"] },
  { route: "/chegadas", label: "Chegadas", icon: "notifications-outline", roles: ["warehouse"] },
  { route: "/revisoes", label: "Revisões", icon: "warning-outline", roles: ["purchasing"] },
  { route: "/nao-recebimentos", label: "Não recebimentos", icon: "warning-outline", roles: ["warehouse"] },
  { route: "/boletins", label: "Boletins", icon: "document-text-outline", roles: ["warehouse"] },
  { route: "/gestao", label: "Gestão", icon: "grid-outline", roles: ["management", "warehouse", "purchasing"] },
  { route: "/integracoes", label: "Integrações", icon: "grid-outline", roles: ["warehouse", "purchasing", "management"] },
  { route: "/qualidade", label: "Origem dos dados", shortLabel: "Origem", icon: "shield-checkmark-outline", roles: ["management", "warehouse", "purchasing"] },
];
@Component({ selector: "app-root", standalone: true,
  imports: [RouterOutlet, RouterLink, IonApp, IonButton, IonIcon, IonPopover, BrandMark, ThemeToggle],
  template: `<ion-app>
    @if (api.user()) {
      <a class="skip-link" href="#main-content">Ir para o conteúdo</a>
      <div class="shell">
        <aside class="sidebar">
          <a [routerLink]="homeRoute()" class="brand" aria-label="Cocapec Recebimento"><app-brand /></a>
          <nav class="navigation" aria-label="Módulos">@for (item of navItems(); track item.route) { <a [routerLink]="item.route" [class.active]="active(item.route)" [attr.aria-current]="active(item.route) ? 'page' : null"><ion-icon [name]="item.icon" aria-hidden="true" /><span>{{ item.label }}{{ arrivalCount(item.route) }}</span></a> }</nav>
          <div class="sidebar-note"><ion-icon name="leaf-outline" aria-hidden="true" /><span>Agenda, operação<br />e boletim diário.</span></div>
          <div class="user"><span class="avatar" aria-hidden="true">{{ initials() }}</span><div><strong>{{ api.user()?.username }}</strong><small>{{ roleLabel() }}</small></div></div>
        </aside>
        <main #mainContent class="main" id="main-content" tabindex="-1">
          <header class="topbar"><div class="topbar-context"><button type="button" class="icon-button tablet-menu" aria-label="Abrir módulos" (click)="menuOpen.set(true)"><ion-icon name="menu-outline" aria-hidden="true" /></button><span>{{ currentModule() }}</span><span class="context-divider" aria-hidden="true"></span><small>Recebimento Cocapec</small></div><div class="topbar-actions">@if (unreadArrivals()) { <a [routerLink]="alertRoute()" class="arrival-alert">{{ alertLabel() }}</a> }<span class="topbar-user">{{ roleLabel() }}</span><app-theme-toggle /><ion-button fill="clear" size="small" (click)="api.logout()"><ion-icon name="log-out-outline" aria-hidden="true" slot="start" />Sair</ion-button></div></header>
          <router-outlet />
        </main>
        <nav class="pill-nav" aria-label="Módulos principais">@for (item of primaryItems(); track item.route) { <a [routerLink]="item.route" [class.active]="active(item.route)" [attr.aria-current]="active(item.route) ? 'page' : null" [attr.aria-label]="item.label"><ion-icon [name]="item.icon" aria-hidden="true" /><span>{{ item.shortLabel || item.label }}</span></a> }@if (extraItems().length) { <button type="button" [class.active]="extraActive()" [attr.aria-expanded]="menuOpen()" aria-label="Mais módulos" (click)="menuOpen.set(true)"><ion-icon name="menu-outline" aria-hidden="true" /><span>Mais</span></button> }</nav>
      </div>
      <ion-popover [isOpen]="menuOpen()" (didDismiss)="menuOpen.set(false)" cssClass="navigation-popover" [backdropDismiss]="true"><ng-template><div class="module-menu"><div class="module-menu-head"><h2>Módulos</h2><button class="icon-button" type="button" aria-label="Fechar módulos" (click)="menuOpen.set(false)"><ion-icon name="close-outline" aria-hidden="true" /></button></div><nav class="navigation" aria-label="Todos os módulos">@for (item of navItems(); track item.route) { <a [routerLink]="item.route" [class.active]="active(item.route)" [attr.aria-current]="active(item.route) ? 'page' : null" (click)="menuOpen.set(false)"><ion-icon [name]="item.icon" aria-hidden="true" /><span>{{ item.label }}{{ arrivalCount(item.route) }}</span></a> }</nav></div></ng-template></ion-popover>
    } @else { <router-outlet /> }
  </ion-app>`,
})
export class AppComponent {
  readonly api = inject(Api);
  private live = inject(GateLive);
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
    const priority = role === "warehouse" || role === "admin" ? ["/agenda", "/chegadas", "/boletins"] : ["gatehouse", "portaria"].includes(role ?? "") ? ["/portaria", "/portaria/avisos", "/portaria/chegadas"] : role === "purchasing" ? ["/agenda", "/compras", "/revisoes"] : ["/agenda", "/gestao", "/qualidade"];
    return priority.map(route => this.navItems().find(item => item.route === route)).filter((item): item is NavigationItem => !!item);
  });
  readonly extraItems = computed(() => this.navItems().filter(item => !this.primaryItems().includes(item)));
  readonly extraActive = computed(() => this.extraItems().some(item => this.active(item.route)));
  readonly currentModule = computed(() => [...this.navItems()].sort((a,b)=>b.route.length-a.route.length).find(item => this.active(item.route))?.label ?? "Recebimento");
  readonly initials = computed(() => this.api.user()?.username.slice(0, 2).toUpperCase() ?? "");
  constructor() {
    addIcons({ calendarOutline, checkmarkCircleOutline, documentTextOutline, gridOutline, leafOutline, logOutOutline, menuOutline, moonOutline, notificationsOutline, peopleOutline, shieldCheckmarkOutline, sunnyOutline, trailSignOutline, warningOutline, eyeOutline, eyeOffOutline, arrowForwardOutline, closeOutline });
    const timer = window.setInterval(() => {
      if (this.watchesArrivals()) void this.loadArrivals(); else this.unreadArrivals.set(0);
    }, 20000);
    this.destroy.onDestroy(() => window.clearInterval(timer));
    effect(() => {
      const role = this.api.user()?.role;
      const message = this.live.last();
      if (role === "warehouse" || role === "admin" || role === "gatehouse" || role === "portaria" || role === "purchasing") {
        untracked(() => this.live.connect());
      } else {
        untracked(() => this.live.close());
      }
      if (message && (role === "warehouse" || role === "admin" || role === "purchasing")) {
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
    if (route === "/chegadas" && this.api.can("warehouse")) return ` (${count})`;
    if (route === "/revisoes" && this.api.user()?.role === "purchasing") return ` (${count})`;
    return "";
  }
  alertRoute() {
    return this.api.user()?.role === "purchasing" ? "/revisoes" : "/chegadas";
  }
  alertLabel() {
    const count = this.unreadArrivals();
    if (this.api.user()?.role === "purchasing") return count === 1 ? "1 revisão" : `${count} revisões`;
    return `${count} chegada${count === 1 ? "" : "s"}`;
  }
  private watchesArrivals() {
    const role = this.api.user()?.role;
    return role === "warehouse" || role === "admin" || role === "purchasing";
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
  active(route: string): boolean { return this.path() === route || (this.path().startsWith(route + "/") && !MODULES.some(item => item.route !== route && item.route.startsWith(route + "/") && this.path().startsWith(item.route))); }
  roleLabel() { return ({ admin: "Administrador", supplier: "Fornecedor", purchasing: "Compras", warehouse: "Armazém", management: "Gestão", gatehouse: "Portaria", portaria: "Portaria" } as Record<string, string>)[this.api.user()?.role ?? ""] ?? ""; }
}
