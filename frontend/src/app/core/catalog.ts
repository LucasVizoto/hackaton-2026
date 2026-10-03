import { inject, Injectable, signal } from "@angular/core";
import { Api, Page } from "./api";
export interface CatalogEntry {
  id: string;
  name: string;
  code?: string;
  registration?: string;
  label?: string;
  origin?: string;
}
export interface ServiceRate {
  code: string;
  label: string;
  price: string;
}
@Injectable({ providedIn: "root" })
export class Catalog {
  private api = inject(Api);
  warehouses = signal<CatalogEntry[]>([]);
  suppliers = signal<CatalogEntry[]>([]);
  workers = signal<CatalogEntry[]>([]);
  equipment = signal<CatalogEntry[]>([]);
  rates = signal<ServiceRate[]>([]);
  async load() {
    const names = ["warehouses", "suppliers", "workers", "equipment"] as const;
    await Promise.all(
      names.map(async (name) => {
        const entries: CatalogEntry[] = [];
        let page = 1;
        while (page <= 100) {
          const r = await this.api.get<Page<CatalogEntry> | CatalogEntry[]>(
            `catalog/${name}/?page=${page}`,
          );
          entries.push(...(Array.isArray(r) ? r : r.results));
          if (Array.isArray(r) || !r.next) break;
          page++;
        }
        this[name].set(entries);
      }),
    );
  }
  async loadRates() {
    const r = await this.api.get<{ categories: ServiceRate[] }>(
      "catalog/service-rates/",
    );
    this.rates.set(r.categories);
  }
}
