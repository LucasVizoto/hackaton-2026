import { Component, inject } from "@angular/core";
import { RouterLink, RouterLinkActive, RouterOutlet } from "@angular/router";
import { IonApp, IonButton } from "@ionic/angular/standalone";
import { Api } from "./core/api";
@Component({
  selector: "app-root",
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IonApp, IonButton],
  template: `<ion-app>
    @if (api.user()) {
      <div class="shell">
        <aside class="sidebar">
          <div class="brand">
            Recebimento<small>Cocapec · demonstração local</small>
          </div>
          <nav class="navigation" aria-label="Módulos">
            <a routerLink="/agenda" routerLinkActive="active">Agenda</a>
            @if (api.can("purchasing")) {
              <a routerLink="/compras" routerLinkActive="active">Compras</a>
            }
            @if (api.can("warehouse")) {
              <a routerLink="/operacao" routerLinkActive="active">Operação</a
              ><a routerLink="/nao-recebimentos" routerLinkActive="active"
                >Não recebimentos</a
              ><a routerLink="/boletins" routerLinkActive="active">Boletins</a>
            }
            @if (api.can("management", "warehouse", "purchasing")) {
              <a routerLink="/gestao" routerLinkActive="active">Gestão</a
              ><a routerLink="/qualidade" routerLinkActive="active"
                >Origem dos dados</a
              >
            }
          </nav>
          <div class="user">
            <strong>{{ api.user()?.username }}</strong
            ><br /><small>{{ roleLabel() }}</small>
          </div>
        </aside>
        <main class="main">
          <header class="topbar">
            <span>{{ api.user()?.username }} · {{ roleLabel() }}</span
            ><ion-button fill="clear" size="small" (click)="api.logout()"
              >Sair</ion-button
            >
          </header>
          <router-outlet />
        </main>
      </div>
    } @else {
      <router-outlet />
    }
  </ion-app>`,
})
export class AppComponent {
  api = inject(Api);
  roleLabel() {
    return (
      (
        {
          admin: "Administrador",
          supplier: "Fornecedor",
          purchasing: "Compras",
          warehouse: "Armazém",
          management: "Gestão",
        } as Record<string, string>
      )[this.api.user()?.role ?? ""] ?? ""
    );
  }
}
