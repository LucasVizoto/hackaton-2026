import { DOCUMENT } from "@angular/common";
import { inject, Injectable, signal } from "@angular/core";
import { persistTheme, preferredTheme, readTheme, ThemeMode } from "./theme-state";

@Injectable({ providedIn: "root" })
export class ThemeService {
  private document = inject(DOCUMENT);
  private window = this.document.defaultView;
  private explicit = false;
  private storage: Storage | null = null;
  private state = signal<ThemeMode>("light");
  readonly mode = this.state.asReadonly();

  constructor() {
    try { this.storage = this.window?.localStorage ?? null; } catch { /* Private WebViews can deny storage. */ }
    const saved = readTheme(this.storage);
    const media = this.window?.matchMedia("(prefers-color-scheme: dark)");
    this.explicit = saved !== null;
    this.apply(preferredTheme(saved, media?.matches ?? false));
    media?.addEventListener("change", (event) => {
      if (!this.explicit) this.apply(event.matches ? "dark" : "light");
    });
  }

  toggle(): void {
    const next = this.mode() === "dark" ? "light" : "dark";
    this.explicit = true;
    this.apply(next);
    persistTheme(this.storage, next);
  }

  private apply(mode: ThemeMode): void {
    this.state.set(mode);
    this.document.documentElement.dataset["theme"] = mode;
  }
}
