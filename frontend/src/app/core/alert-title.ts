import { Injectable } from "@angular/core";

/**
 * Contador único no título da aba para os alertas persistentes (chegadas, ocorrências, avisos).
 * Cada alerta informa só a sua contagem; assim um não apaga o contador do outro.
 */
@Injectable({ providedIn: "root" })
export class AlertTitle {
  private base = typeof document === "undefined" ? "" : document.title;
  private parts = new Map<string, { count: number; label: string }>();

  set(key: string, count: number, label: string) {
    if (count > 0) this.parts.set(key, { count, label }); else this.parts.delete(key);
    if (typeof document === "undefined") return;
    const active = [...this.parts.values()];
    const total = active.reduce((sum, part) => sum + part.count, 0);
    document.title = total ? `(${total}) ${active.map(part => part.label).join(" · ")} · ${this.base}` : this.base;
  }
}
