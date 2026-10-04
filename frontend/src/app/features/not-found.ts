import { Component, inject } from "@angular/core";
import { RouterLink } from "@angular/router";
import { Api } from "../core/api";

@Component({
  standalone: true,
  imports: [RouterLink],
  template: `<div class="page"><h1>Página não encontrada</h1><p>Este endereço não corresponde a uma página do sistema.</p><a [routerLink]="destination">{{api.user() ? 'Voltar ao sistema' : 'Ir para o acesso'}}</a></div>`,
})
export class NotFound {
  readonly api = inject(Api);
  get destination() { return this.api.user() ? ['gatehouse', 'portaria'].includes(this.api.user()!.role) ? '/portaria' : '/agenda' : '/login'; }
}
