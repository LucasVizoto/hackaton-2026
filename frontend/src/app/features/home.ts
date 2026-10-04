import { Component } from "@angular/core";
import { RouterLink } from "@angular/router";

@Component({
  standalone: true,
  selector: "app-home",
  imports: [RouterLink],
  template: `<header class="access-bar">
    <div><strong>Recebimento Cocapec</strong><p>Agenda, conferência e boletins.</p></div>
    <a class="system-access" routerLink="/login" [queryParams]="{perfil:'operador'}">Entrar no sistema de recebimento</a>
    <small>Conteúdo institucional abaixo: reprodução de referência do site Cocapec, com links externos e informações capturadas em 03/10/2026.</small>
  </header><iframe
    class="site-frame"
    src="/cocapec.html"
    title="Cocapec - O melhor café está aqui"
  ></iframe>`,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        min-height: 100dvh;
        background: #fff;
      }
      .access-bar { position: relative; z-index: 1; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 24px; color: var(--text); background: var(--surface); border-bottom: 1px solid var(--line); }
      .access-bar p { margin: 2px 0 0; }
      .access-bar small { flex-basis: 100%; color: var(--muted); }
      .system-access { display: inline-flex; align-items: center; min-height: 44px; padding: 10px 16px; background: var(--green); color: var(--brand-contrast); border-radius: 12px; text-decoration: none; font-weight: 600; }
      @media (max-width: 600px) { .access-bar { padding: 16px; } .system-access { width: 100%; justify-content: center; text-align: center; } }
      .site-frame {
        display: block;
        width: 100%;
        height: 100%;
        min-height: 100dvh;
        border: 0;
      }
    `,
  ],
})
export class Home {}
