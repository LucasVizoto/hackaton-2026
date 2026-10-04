import "@angular/compiler";
import assert from "node:assert/strict";
import test from "node:test";
import { createEnvironmentInjector, runInInjectionContext } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";
import { HttpClient } from "@angular/common/http";
import { Api } from "../src/app/core/api";
import { routes } from "../src/app/routes";

test("management can consult all modules but cannot enter creation routes or gain operational roles", () => {
  const redirected = {};
  const injector = createEnvironmentInjector([
    { provide: Api, useClass: Api },
    { provide: HttpClient, useValue: {} },
    { provide: Router, useValue: { createUrlTree: () => redirected } },
  ], null!);
  try {
    const api = runInInjectionContext(injector, () => injector.get(Api));
    for (const username of ["gestao_demo", "outro_gestor"]) {
      api.user.set({ id: 12, username, role: "management", supplier_id: null });
      for (const path of ["agenda", "compras", "portaria", "portaria/chegadas", "chegadas", "revisoes",
        "nao-recebimentos", "boletins", "boletins/:id", "pessoas", "pessoas/:id", "equipamentos", "escala", "gestao"]) {
        const route = routes.find(route => route.path === path)!;
        for (const guard of route.canActivate ?? []) {
          assert.equal(runInInjectionContext(injector, () => (guard as CanActivateFn)(null!, null!)), true, path);
        }
      }
      for (const path of ["agenda/novo", "boletins/novo", "portaria/avisos", "nao-recebimentos/novo"]) {
        const route = routes.find(route => route.path === path)!;
        assert.ok(route.canActivate!.some(guard => runInInjectionContext(injector, () => (guard as CanActivateFn)(null!, null!)) === redirected), path);
      }
      assert.equal(api.can("warehouse", "purchasing", "gatehouse", "supplier"), false);
      assert.equal(api.can("management"), true);
    }
  } finally { injector.destroy(); }
});

test("every arrival role reaches the unified arrivals screen and old arrival and removed module URLs redirect", () => {
  const redirected = {};
  const injector = createEnvironmentInjector([
    { provide: Api, useClass: Api },
    { provide: HttpClient, useValue: {} },
    { provide: Router, useValue: { createUrlTree: () => redirected } },
  ], null!);
  try {
    const api = runInInjectionContext(injector, () => injector.get(Api));
    const arrivals = routes.find(route => route.path === "chegadas")!;
    for (const role of ["warehouse", "purchasing", "gatehouse", "management"]) {
      api.user.set({ id: 7, username: role, role, supplier_id: null });
      for (const guard of arrivals.canActivate ?? []) {
        assert.equal(runInInjectionContext(injector, () => (guard as CanActivateFn)(null!, null!)), true, role);
      }
    }
    api.user.set({ id: 8, username: "fornecedor", role: "supplier", supplier_id: "s1" });
    assert.ok(arrivals.canActivate!.some(guard => runInInjectionContext(injector, () => (guard as CanActivateFn)(null!, null!)) === redirected));
    assert.equal(routes.find(route => route.path === "portaria/chegadas")!.redirectTo, "/chegadas");
    assert.ok(routes.find(route => route.path === "revisoes")!.redirectTo);
    for (const removed of ["qualidade", "integracoes"]) assert.equal(routes.find(route => route.path === removed)!.redirectTo, "/gestao", removed);
  } finally { injector.destroy(); }
});
