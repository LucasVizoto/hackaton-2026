import "@angular/compiler";
import assert from "node:assert/strict";
import test from "node:test";
import { HttpErrorResponse } from "@angular/common/http";
import { createEnvironmentInjector, runInInjectionContext } from "@angular/core";
import { Api } from "../src/app/core/api";
import {
  forecastIcon,
  HgWeather,
  indexForecast,
  isRainyForecast,
  isoFromHgDate,
  RAIN_ALERT,
  SUN_LABEL,
} from "../src/app/core/hg-weather";

const rainyDay = {
  date: "03/10",
  full_date: "03/10/2026",
  description: "Chuvas esparsas",
  condition: "rain",
  rain: 0.81,
  rain_probability: 98,
};

test("maps the HGBrasil forecast day onto the selected date", () => {
  const days = indexForecast({
    results: {
      date: "03/10/2026",
      description: "Chuvas esparsas",
      condition_slug: "rain",
      rain: 0.23,
      forecast: [rainyDay, { date: "06/10", full_date: "06/10/2026", description: "Tempo limpo", condition: "clear_day", rain: 0, rain_probability: 0 }],
    },
  });
  assert.equal(days.get("2026-10-03")?.rainy, true);
  assert.equal(days.get("2026-10-03")?.source, "hgbrasil");
  assert.equal(days.get("2026-10-06")?.rainy, false);
  assert.equal(forecastIcon(days.get("2026-10-06") ?? null), "sun");
  assert.equal(forecastIcon(days.get("2026-10-03") ?? null), "rain");
  assert.equal(isoFromHgDate("05/01", "2026-12-30"), "2027-01-05");
});

test("Open-Meteo day 5 stays rainy and a dry day shows the sun", () => {
  const days = indexForecast({
    by: "open-meteo",
    results: {
      forecast: [
        { date: "05/10", full_date: "05/10/2026", description: "Chuva", condition: "rain", rain: 6.7, rain_probability: 73 },
        { date: "06/10", full_date: "06/10/2026", description: "Tempo limpo", condition: "clear_day", rain: 0, rain_probability: 0 },
      ],
    },
  }, "open-meteo");
  assert.equal(days.get("2026-10-05")?.source, "open-meteo");
  assert.equal(forecastIcon(days.get("2026-10-05") ?? null), "rain");
  assert.equal(forecastIcon(days.get("2026-10-06") ?? null), "sun");
  assert.equal(SUN_LABEL, "Sem previsão de chuva para esta data.");
});

test("treats rain, storm and a wet description as rainy", () => {
  assert.equal(isRainyForecast({ description: "Tempo nublado", condition: "cloud", rain: 0, rain_probability: 12 }), false);
  assert.equal(isRainyForecast({ description: "Tempestade", condition: "storm" }), true);
  assert.equal(isRainyForecast({ description: "Parcialmente nublado", condition: "cloudly_day", rain: 1.2, rain_probability: 10 }), true);
  assert.equal(isRainyForecast({ description: "Nublado", condition: "cloud", rain: 0, rain_probability: 40 }), true);
  assert.equal(RAIN_ALERT, "Alerta: Possibilidade de chuva. Isso pode afetar o tempo de descarregamento e gerar reagendamentos.");
});

test("loads each selected day and reuses that day without a new request", async () => {
  const calls: string[] = [];
  const api = {
    get: async (path: string) => {
      calls.push(path);
      const selected = new URL(path, "http://local").searchParams.get("date") ?? "";
      const [year, month, day] = selected.split("-");
      const rainy = selected === "2026-10-05";
      return {
        by: "open-meteo",
        results: {
          forecast: [{
            date: `${day}/${month}`,
            full_date: `${day}/${month}/${year}`,
            description: rainy ? "Chuva" : "Tempo limpo",
            condition: rainy ? "rain" : "clear_day",
            rain: rainy ? 6.7 : 0,
            rain_probability: rainy ? 73 : 0,
          }],
        },
      };
    },
  };
  const injector = createEnvironmentInjector([{ provide: Api, useValue: api }], null!);
  const weather = runInInjectionContext(injector, () => new HgWeather());
  await weather.load("2026-10-05");
  await weather.load("2026-10-06");
  await weather.load("2026-10-05");
  assert.deepEqual(calls.map((path) => new URL(path, "http://local").searchParams.get("date")), ["2026-10-05", "2026-10-06"]);
  assert.equal(weather.pending().size, 0);
  assert.equal(forecastIcon(weather.day("2026-10-05")), "rain");
  assert.equal(forecastIcon(weather.day("2026-10-06")), "sun");
});

test("a failed day does not hide the forecast of another day", async () => {
  const api = {
    get: async (path: string) => {
      const selected = new URL(path, "http://local").searchParams.get("date");
      if (selected === "2026-10-06") throw new HttpErrorResponse({ status: 503, statusText: "unavailable", url: path });
      return { by: "open-meteo", results: { forecast: [{ date: "05/10", full_date: "05/10/2026", description: "Chuva", condition: "rain", rain: 6.7, rain_probability: 73 }] } };
    },
  };
  const injector = createEnvironmentInjector([{ provide: Api, useValue: api }], null!);
  const weather = runInInjectionContext(injector, () => new HgWeather());
  await weather.load("2026-10-05");
  await weather.load("2026-10-06");
  assert.equal(forecastIcon(weather.day("2026-10-05")), "rain");
  assert.equal(forecastIcon(weather.day("2026-10-06")), "sun");
});
