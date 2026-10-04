import "@angular/compiler";
import assert from "node:assert/strict";
import test from "node:test";
import { createEnvironmentInjector, runInInjectionContext } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";
import { HttpClient } from "@angular/common/http";
import { Api } from "../src/app/core/api";
import { routes } from "../src/app/routes";

test("legacy settlement URL preserves the embedded fortnight view in bulletins", () => {
  const tree = {};
  let destination: unknown;
  const injector = createEnvironmentInjector([
    { provide: Router, useValue: { createUrlTree: (...args: unknown[]) => { destination = args; return tree; } } },
  ], null!);
  try {
    const route = routes.find(route => route.path === "acerto")!;
    assert.equal(typeof route.redirectTo, "function");
    const redirect = route.redirectTo as (snapshot: never) => unknown;
    assert.equal(runInInjectionContext(injector, () => redirect(null!)), tree);
    assert.deepEqual(destination, [["/boletins"], { queryParams: { visao: "quinzena" } }]);
    assert.ok(routes.find(route => route.path === "boletins")!.canActivate!.length > 0);
  } finally { injector.destroy(); }
});

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
        "nao-recebimentos", "boletins", "boletins/:id", "pessoas", "pessoas/:id", "equipamentos", "escala", "descarga", "gestao", "gestao/logistica"]) {
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

test("logistics allows internal readers and denies suppliers and gatehouse", () => {
  const redirected = {};
  const injector = createEnvironmentInjector([
    { provide: Api, useClass: Api }, { provide: HttpClient, useValue: {} },
    { provide: Router, useValue: { createUrlTree: () => redirected } },
  ], null!);
  try {
    const api = runInInjectionContext(injector, () => injector.get(Api));
    const route = routes.find(route => route.path === "gestao/logistica")!;
    for (const role of ["management", "warehouse", "purchasing", "admin", "supplier", "gatehouse", "portaria"]) {
      api.user.set({ id: 12, username: "leitor", role, supplier_id: null });
      const results = route.canActivate!.map(guard => runInInjectionContext(injector, () => (guard as CanActivateFn)(null!, null!)));
      assert.equal(results.every(result => result === true), ["management", "warehouse", "purchasing", "admin"].includes(role), role);
    }
    api.user.set(null);
    assert.ok(route.canActivate!.some(guard => runInInjectionContext(injector, () => (guard as CanActivateFn)(null!, null!)) === redirected));
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

test("unloading board is for the warehouse and management only", () => {
  const redirected = {};
  const injector = createEnvironmentInjector([
    { provide: Api, useClass: Api }, { provide: HttpClient, useValue: {} },
    { provide: Router, useValue: { createUrlTree: () => redirected } },
  ], null!);
  try {
    const api = runInInjectionContext(injector, () => injector.get(Api));
    const route = routes.find(route => route.path === "descarga")!;
    for (const role of ["warehouse", "management", "admin", "purchasing", "supplier", "gatehouse"]) {
      api.user.set({ id: 13, username: role, role, supplier_id: null });
      const results = route.canActivate!.map(guard => runInInjectionContext(injector, () => (guard as CanActivateFn)(null!, null!)));
      assert.equal(results.every(result => result === true), ["warehouse", "management", "admin"].includes(role), role);
    }
  } finally { injector.destroy(); }
});
