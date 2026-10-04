import "@angular/compiler";
import assert from "node:assert/strict";
import test from "node:test";
import { createEnvironmentInjector, runInInjectionContext } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Router } from "@angular/router";
import { Capacitor } from "@capacitor/core";
import { of } from "rxjs";
import { Api } from "../src/app/core/api";
import { GateLive } from "../src/app/core/gate-live";

test("realtime cancels a pending connection on logout and does not duplicate retries", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const oldLocation = globalThis.location;
  const oldSocket = globalThis.WebSocket;
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 0;
    onopen?: () => void;
    onclose?: () => void;
    onmessage?: (event: { data: string }) => void;
    constructor(readonly url: string) { sockets.push(this); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  Object.defineProperty(globalThis, "location", { configurable: true, value: { origin: "http://localhost" } });
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  let resolveUrl!: (url: string) => void;
  const api = { token: () => "synthetic", websocketUrl: () => new Promise<string>(resolve => { resolveUrl = resolve; }) };
  const injector = createEnvironmentInjector([{ provide: Api, useValue: api }], null!);
  const live = runInInjectionContext(injector, () => new GateLive());
  try {
    const pending = live.connect();
    live.close();
    resolveUrl("ws://backend/ws/gate/");
    await pending;
    assert.equal(sockets.length, 0);
    api.websocketUrl = async () => "wss://backend/ws/gate/";
    await Promise.all([live.connect(), live.connect()]);
    assert.equal(sockets.length, 1);
    sockets[0].readyState = 1;
    sockets[0].onopen?.();
    assert.equal(live.status(), "connected");
    assert.equal(live.refreshed(), 1);
    sockets[0].onmessage?.({ data: '{"event":"heartbeat"}' });
    assert.equal(live.refreshed(), 2);
    assert.equal(live.last(), null);
    sockets[0].close();
    assert.equal(live.status(), "disconnected");
    live.close();
    t.mock.timers.tick(30000);
    await Promise.resolve();
    assert.equal(sockets.length, 1);
    assert.equal(live.status(), "idle");
  } finally {
    live.close();
    injector.destroy();
    globalThis.WebSocket = oldSocket;
    Object.defineProperty(globalThis, "location", { configurable: true, value: oldLocation });
  }
});

test("native WebSocket uses the configured backend rather than the WebView host", async (t) => {
  const oldLocation = globalThis.location;
  Object.defineProperty(globalThis, "location", { configurable: true, value: { origin: "https://localhost" } });
  t.mock.method(Capacitor, "isNativePlatform", () => true);
  const injector = createEnvironmentInjector([
    { provide: HttpClient, useValue: { get: () => of({ nativeApiUrl: "https://backend.example/api/v1" }) } },
    { provide: Router, useValue: {} },
  ], null!);
  try {
    const api = runInInjectionContext(injector, () => new Api());
    api.token.set("synthetic");
    const url = new URL(await api.websocketUrl());
    assert.equal(url.origin, "wss://backend.example");
    assert.equal(url.pathname, "/ws/gate/");
    assert.equal(url.searchParams.get("stream_version"), "2");
    assert.equal(url.searchParams.get("token"), "synthetic");
  } finally {
    injector.destroy();
    Object.defineProperty(globalThis, "location", { configurable: true, value: oldLocation });
  }
});
