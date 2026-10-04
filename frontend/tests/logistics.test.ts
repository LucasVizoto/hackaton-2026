import "@angular/compiler";
import assert from "node:assert/strict";
import test from "node:test";
import { createEnvironmentInjector, runInInjectionContext } from "@angular/core";
import { HttpErrorResponse } from "@angular/common/http";
import { Api } from "../src/app/core/api";
import { LogisticsState, LogisticsSnapshot } from "../src/app/core/logistics";

const snapshot: LogisticsSnapshot = {
  origin: "operacional_registrado", reference_date: "2026-10-04", timezone: "America/Sao_Paulo",
  generated_at: "2026-10-04T12:00:00-03:00", period: { date_from: "2026-09-28", date_to: "2026-10-04" },
  summary: { received_today: 2, driver_entries_today: 3, trucks_in_queue: 1 },
  loads_by_date: [{ date: "2026-10-03", count: 0 }, { date: "2026-10-04", count: 2 }],
  loads_by_warehouse: [{ warehouse: "1", warehouse_name: "Armazém de teste", count: 2 }],
  coverage: { driver_entries_without_name: 1, completed_without_destination: 0, destination_associations: 2 },
};

test("logistics retains last persisted response on failure and replaces it after recovery", async () => {
  let calls = 0;
  const api = { get: async (path: string) => {
    assert.equal(path, "analytics/logistics/");
    calls++;
    if (calls === 2) throw new Error("Serviço indisponível");
    return calls === 3 ? { ...snapshot, summary: { ...snapshot.summary, trucks_in_queue: 0 } } : snapshot;
  } };
  const injector = createEnvironmentInjector([{ provide: Api, useValue: api }], null!);
  try {
    const page = runInInjectionContext(injector, () => new LogisticsState());
    await page.load();
    assert.equal(page.snapshot(), snapshot);
    assert.deepEqual(page.snapshot()?.loads_by_date, snapshot.loads_by_date);
    await page.load();
    assert.equal(page.snapshot(), snapshot);
    assert.equal(page.error(), "Serviço indisponível");
    assert.equal(page.busy(), false);
    await page.load();
    assert.equal(page.error(), "");
    assert.equal(page.snapshot()?.summary.trucks_in_queue, 0);
  } finally { injector.destroy(); }
});

test("unavailable logistics explains retry without exposing server content, while authorization errors keep their meaning", async () => {
  let failure = new HttpErrorResponse({ status: 500, error: "<html>Internal server traceback</html>" });
  const api = { get: async () => { throw failure; } };
  const injector = createEnvironmentInjector([{ provide: Api, useValue: api }], null!);
  try {
    const page = runInInjectionContext(injector, () => new LogisticsState());
    await page.load();
    assert.equal(page.snapshot(), null);
    assert.equal(page.error(), "Não foi possível consultar os indicadores. Use Atualizar para tentar novamente.");
    failure = new HttpErrorResponse({ status: 403, error: { detail: "Seu perfil não permite consultar este painel." } });
    await page.load();
    assert.equal(page.error(), "Seu perfil não permite consultar este painel.");
    assert.equal(page.busy(), false);
  } finally { injector.destroy(); }
});

test("initial failure does not become a zero snapshot; repeated refresh is suppressed and navigation cancels the request", async () => {
  let calls = 0;
  let requestSignal: AbortSignal | undefined;
  let rejectRequest!: (error: Error) => void;
  const api = { get: (_path: string, signal: AbortSignal) => {
    calls++; requestSignal = signal;
    return new Promise((_, reject) => { rejectRequest = reject; });
  } };
  const injector = createEnvironmentInjector([{ provide: Api, useValue: api }], null!);
  const page = runInInjectionContext(injector, () => new LogisticsState());
  const pending = page.load();
  await page.load();
  assert.equal(calls, 1);
  assert.equal(page.busy(), true);
  rejectRequest(new Error("Consulta falhou"));
  await pending;
  assert.equal(page.snapshot(), null);
  assert.equal(page.error(), "Consulta falhou");
  const cancelled = page.load();
  injector.destroy();
  assert.equal(requestSignal?.aborted, true);
  rejectRequest(new Error("Cancelada"));
  await cancelled;
  assert.equal(page.error(), "");
});
