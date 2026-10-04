import { test } from "node:test";
import assert from "node:assert/strict";
import { InvoiceReadSession, readRemoteInvoice } from "../src/app/features/invoice-reading";

test("foto envia multipart autenticável e preserva zeros e bytes originais", async () => {
  const file = new File(["original"], "camera.heic", { type: "image/heic" });
  const controller = new AbortController();
  const result = await readRemoteInvoice(file, async (body, signal) => {
    assert.equal(signal, controller.signal);
    const uploaded = body.get("file") as File;
    assert.equal(uploaded.name, "camera.heic");
    assert.equal(await uploaded.text(), "original");
    return { number: "000123", access_key: null, status: "suggested", requires_confirmation: true };
  }, controller.signal);
  assert.deepEqual(result, { number: "000123", accessKey: "" });
});

test("ambiguidade, ilegibilidade e falhas permitem correção manual sem inventar número", async () => {
  const file = new Blob(["foto"]);
  for (const status of ["ambiguous", "unreadable"] as const) {
    await assert.rejects(readRemoteInvoice(file, async () => ({ number: null, access_key: null, status, requires_confirmation: true })), /manualmente/);
  }
  for (const status of [400, 429, 503]) {
    const failure = new Error(`Erro ${status}`);
    await assert.rejects(readRemoteInvoice(file, async () => { throw failure; }), error => error === failure);
  }
});

test("sessões independentes cancelam troca, edição manual, remoção e saída", () => {
  const first = new InvoiceReadSession(), second = new InvoiceReadSession();
  const old = first.start(), other = second.start();
  const current = first.start();
  assert.equal(old.signal.aborted, true);
  assert.equal(old.isCurrent(), false);
  assert.equal(current.isCurrent(), true);
  assert.equal(other.isCurrent(), true);
  first.cancel();
  assert.equal(current.signal.aborted, true);
  assert.equal(current.isCurrent(), false);
  second.cancel();
  assert.equal(other.isCurrent(), false);
});

test("resposta tardia não sobrescreve edição manual mesmo se servidor ignorar cancelamento", async () => {
  const session = new InvoiceReadSession(), attempt = session.start();
  let finish!: () => void;
  let number = "";
  const pending = readRemoteInvoice(new Blob(["foto"]), async () => {
    await new Promise<void>(resolve => { finish = resolve; });
    return { number: "111", access_key: null, status: "suggested", requires_confirmation: true };
  }, attempt.signal);
  session.cancel();
  number = "222";
  finish();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(attempt.isCurrent(), false);
  assert.equal(number, "222");
});

test("arquivo vazio, grande ou sinal já cancelado não chama o provedor", async () => {
  let calls = 0;
  const request = async () => { calls++; return { number: "123", access_key: null, status: "suggested" as const, requires_confirmation: true as const }; };
  for (const file of [new Blob([]), new Blob([new Uint8Array(10 * 1024 * 1024 + 1)])]) {
    await assert.rejects(readRemoteInvoice(file, request), /10 MB/);
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(readRemoteInvoice(new Blob(["foto"]), request, controller.signal), { name: "AbortError" });
  assert.equal(calls, 0);
});
