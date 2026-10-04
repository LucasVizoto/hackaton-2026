import "@angular/compiler";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createEnvironmentInjector, runInInjectionContext } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Router } from "@angular/router";
import { Observable, of } from "rxjs";
import { Api } from "../src/app/core/api";

function apiWith(http: Partial<HttpClient>) {
  const injector = createEnvironmentInjector([
    { provide: Api, useClass: Api },
    { provide: HttpClient, useValue: http },
    { provide: Router, useValue: {} },
  ], null!);
  return { injector, api: runInInjectionContext(injector, () => injector.get(Api)) };
}

test("API combinada mantém paginação completa e POST sem sinal dos consumidores existentes", async () => {
  const requested: string[] = [];
  const { api, injector } = apiWith({
    get: ((url: string) => {
      requested.push(url);
      const page = Number(new URL(url, "http://localhost").searchParams.get("page"));
      return of({ results: page === 1 ? ["first"] : ["second"], next: page === 1 ? "next" : null });
    }) as HttpClient["get"],
    post: ((url: string, body: unknown) => {
      requested.push(url);
      return of(body);
    }) as HttpClient["post"],
  });
  try {
    assert.deepEqual(await api.getAll("gate-arrivals/?decision=pending"), ["first", "second"]);
    assert.deepEqual(await api.post("notifications/item/acknowledge/", { read: true }), { read: true });
    assert.deepEqual(requested, [
      "/api/v2/gate-arrivals/?decision=pending&page=1",
      "/api/v2/gate-arrivals/?decision=pending&page=2",
      "/api/v2/notifications/item/acknowledge/",
    ]);
  } finally { injector.destroy(); }
});

test("cancelamento do OCR encerra a assinatura HTTP; sinal já cancelado não inicia outro POST", async () => {
  let started = 0, stopped = 0;
  const { api, injector } = apiWith({
    post: (() => new Observable(() => {
      started++;
      return () => { stopped++; };
    })) as HttpClient["post"],
  });
  try {
    const controller = new AbortController();
    const pending = api.post("integrations/invoice-reading/", new FormData(), controller.signal);
    await Promise.resolve();
    assert.equal(started, 1);
    const rejected = assert.rejects(pending, { name: "EmptyError" });
    controller.abort();
    await rejected;
    assert.equal(stopped, 1);
    await assert.rejects(api.post("integrations/invoice-reading/", new FormData(), controller.signal), { name: "AbortError" });
    assert.equal(started, 1);
  } finally { injector.destroy(); }
});
