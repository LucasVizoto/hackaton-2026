import "@angular/compiler";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createEnvironmentInjector } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Router } from "@angular/router";
import { of, throwError } from "rxjs";
import { Api, User } from "../src/app/core/api";

const current: User = { id: 1, username: "first", role: "supplier", supplier_id: "supplier-a" };
const target: User = { id: 2, username: "second", role: "supplier", supplier_id: "supplier-b" };

test("troca atualiza cookie, restaura identidade e preserva sessão quando a API falha", async () => {
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { cookie: "" } });
  let fail = false;
  const injector = createEnvironmentInjector([
    Api, { provide: Router, useValue: {} },
    { provide: HttpClient, useValue: {
      post: (url: string, body: unknown) => {
        assert.equal(url, "/api/v2/auth/switch/"); assert.deepEqual(body, { user_id: 2 });
        return fail ? throwError(() => new Error("Falha")) : of({ token: "new-token", user: target });
      }, get: () => of(target),
    } },
  ], null!);
  try {
    const api = injector.get(Api); api.user.set(current); api.token.set("old-token");
    await api.switchUser(2);
    assert.equal(api.user(), target); assert.equal(api.token(), "new-token");
    assert.match(document.cookie, /cocapec_session=new-token/);
    api.user.set(null); api.token.set(""); await api.restoreSession();
    assert.equal(api.user(), target);
    fail = true; await assert.rejects(api.switchUser(2));
    assert.equal(api.user(), target); assert.equal(api.token(), "new-token");
  } finally {
    injector.destroy();
    if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

