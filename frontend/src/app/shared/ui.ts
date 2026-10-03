import { Component, input } from "@angular/core";
@Component({
  selector: "app-status",
  standalone: true,
  template: `<span class="status" [class]="'status ' + value().toLowerCase()">{{
    label()
  }}</span>`,
})
export class Status {
  value = input("pending");
  label() {
    return (
      (
        {
          pending: "Pendente",
          approved: "Aprovada",
          rejected: "Rejeitada",
          waiting: "Aguardando",
          scheduled: "Agendado",
          arrived: "Chegou",
          unloading: "Em descarga",
          in_progress: "Em descarga",
          completed: "Concluído",
          cancelled: "Cancelado",
          not_received: "Não recebido",
          draft: "Rascunho",
          closed: "Fechado",
        } as Record<string, string>
      )[this.value().toLowerCase()] ?? this.value()
    );
  }
}
@Component({
  selector: "app-origin",
  standalone: true,
  template: `@if (value() === "demo_sintetico") {
      <div class="notice synthetic">
        Demonstração sintética — este registro não descreve uma operação
        histórica da Cocapec.
      </div>
    } @else if (value() === "historico_importado") {
      <div class="notice">
        Histórico importado. Consulte origem e cobertura antes de interpretar os
        resultados.
      </div>
    }`,
})
export class Origin {
  value = input("");
}
