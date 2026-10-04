import { inject, Injectable, signal } from "@angular/core";
import { Api } from "./api";

/** Public HGBrasil weather API. The browser reaches it through the app API because the provider omits CORS without a registered key. */
export const HGBRASIL_WEATHER_URL = "https://api.hgbrasil.com/weather";
/** WOEID of Espírito Santo do Pinhal, SP — the Cocapec unloading yard. */
export const DELIVERY_WOEID = "431819";
export const RAIN_ALERT =
  "Alerta: Possibilidade de chuva. Isso pode afetar o tempo de descarregamento e gerar reagendamentos.";
export const SUN_LABEL = "Sem previsão de chuva para esta data.";

export interface HgForecastDay {
  date: string;
  full_date?: string;
  weekday?: string;
  max?: number;
  min?: number;
  description?: string;
  condition?: string;
  rain?: number;
  rain_probability?: number;
}

export interface HgWeatherResults {
  city?: string;
  city_name?: string;
  date?: string;
  description?: string;
  condition_slug?: string;
  rain?: number;
  forecast?: HgForecastDay[];
}

export interface HgWeatherResponse {
  by?: string;
  valid_key?: boolean;
  results?: HgWeatherResults;
}

export interface DayForecast {
  date: string;
  rainy: boolean;
  description: string;
  condition: string;
  rainProbability: number | null;
  source: "hgbrasil" | "open-meteo" | "fallback";
}

export function forecastIcon(day: DayForecast | null): "rain" | "sun" {
  if (day?.source !== "fallback" && day?.rainy) return "rain";
  return "sun";
}

const RAIN_TERMS = /chuva|chuvisco|tempestade|trovoada|pancadas|garoa|granizo|storm|rain|hail|drizzle|shower/i;

export function isRainyForecast(day: Pick<HgForecastDay, "description" | "condition" | "rain" | "rain_probability">): boolean {
  const condition = day.condition ?? "";
  const description = day.description ?? "";
  if (RAIN_TERMS.test(condition) || RAIN_TERMS.test(description)) return true;
  if (typeof day.rain === "number" && day.rain > 0) return true;
  if (typeof day.rain_probability === "number" && day.rain_probability >= 40) return true;
  return false;
}

export function isoFromHgDate(value: string, referenceIso = ""): string | null {
  const full = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (full) return `${full[3]}-${full[2]}-${full[1]}`;
  const short = /^(\d{2})\/(\d{2})$/.exec(value.trim());
  if (!short) return null;
  let year = Number(referenceIso.slice(0, 4)) || new Date().getFullYear();
  const month = Number(short[2]);
  const referenceMonth = referenceIso ? Number(referenceIso.slice(5, 7)) : NaN;
  if (referenceMonth === 12 && month === 1) year += 1;
  if (referenceMonth === 1 && month === 12) year -= 1;
  return `${year}-${short[2]}-${short[1]}`;
}

export function indexForecast(response: HgWeatherResponse, source: DayForecast["source"] = "hgbrasil"): Map<string, DayForecast> {
  const days = new Map<string, DayForecast>();
  const results = response.results;
  if (!results) return days;
  const listed = [...(Array.isArray(results.forecast) ? results.forecast : [])];
  if (results.date) {
    listed.push({
      date: results.date.slice(0, 5),
      full_date: results.date.length > 5 ? results.date : undefined,
      description: results.description,
      condition: results.condition_slug,
      rain: results.rain,
    });
  }
  for (const day of listed) {
    const iso = isoFromHgDate(day.full_date || day.date);
    if (!iso) continue;
    const description = day.description ?? "";
    const condition = day.condition ?? "";
    const rainProbability = typeof day.rain_probability === "number" ? day.rain_probability : null;
    const forecast: DayForecast = {
      date: iso,
      rainy: isRainyForecast(day),
      description,
      condition,
      rainProbability,
      source,
    };
    const current = days.get(iso);
    if (!current || forecast.rainy) days.set(iso, forecast);
  }
  return days;
}

export function mockHgWeather(isoDates: string[]): HgWeatherResponse {
  return {
    by: "fallback",
    valid_key: false,
    results: {
      city: "Espírito Santo do Pinhal, SP",
      city_name: "Espírito Santo do Pinhal",
      forecast: isoDates.map((iso) => {
        const [year, month, day] = iso.split("-");
        return {
          date: `${day}/${month}`,
          full_date: `${day}/${month}/${year}`,
          weekday: "",
          description: "Tempo nublado",
          condition: "cloud",
          rain: 0,
          rain_probability: 0,
        };
      }),
    },
  };
}

@Injectable({ providedIn: "root" })
export class HgWeather {
  private api = inject(Api);
  private days = signal<ReadonlyMap<string, DayForecast>>(new Map());
  private inflight = new Map<string, Promise<void>>();
  readonly pending = signal<ReadonlySet<string>>(new Set());
  readonly source = signal<"" | DayForecast["source"]>("");

  day(iso: string): DayForecast | null {
    return this.days().get(iso) ?? null;
  }

  load(iso: string): Promise<void> {
    if (!iso || this.days().has(iso)) return Promise.resolve();
    const current = this.inflight.get(iso);
    if (current) return current;
    this.pending.update((dates) => new Set(dates).add(iso));
    const task = this.fetch(iso).finally(() => {
      this.inflight.delete(iso);
      this.pending.update((dates) => {
        const next = new Set(dates);
        next.delete(iso);
        return next;
      });
    });
    this.inflight.set(iso, task);
    return task;
  }

  private async fetch(iso: string) {
    try {
      const response = await this.api.get<HgWeatherResponse>(`integrations/hg-weather/?date=${encodeURIComponent(iso)}`);
      const source = response.by === "open-meteo" ? "open-meteo" : "hgbrasil";
      const indexed = indexForecast(response, source);
      const forecast = indexed.get(iso);
      if (!forecast) throw new Error("empty forecast");
      this.days.update((current) => new Map(current).set(iso, forecast));
      this.source.set(source);
    } catch {
      const forecast = indexForecast(mockHgWeather([iso]), "fallback").get(iso);
      if (forecast) this.days.update((current) => new Map(current).set(iso, forecast));
      this.source.set("fallback");
    }
  }
}
