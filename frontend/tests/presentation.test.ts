import "@angular/compiler";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  money,
  dateTime,
  localTimestamp,
  originLabel,
  apiError,
} from "../src/app/core/api";
import { HttpErrorResponse } from "@angular/common/http";

test("exibe os valores oficiais sem recalcular piso ou complemento no cliente", () => {
  assert.equal(money("918.1952"), "R$\u00a0918,20");
  assert.equal(money("991.9041"), "R$\u00a0991,90");
  assert.equal(money("73.7089"), "R$\u00a073,71");
  assert.equal(money("946.81755"), "R$\u00a0946,82");
  assert.equal(money("28.62235"), "R$\u00a028,62");
});
test("mensagem da regra negada pela API permanece legível sem código interno", () => {
  const e = new HttpErrorResponse({
    status: 409,
    error: {
      error: {
        code: "domain_conflict",
        details: { detail: "Carga batida exige horário exclusivo." },
      },
    },
  });
  assert.equal(apiError(e), "Carga batida exige horário exclusivo.");
});
test("ausência de medição e ausência monetária não aparecem como zero", () => {
  assert.equal(money(null), "Não disponível");
  assert.equal(dateTime(null), "Não registrado");
});
test("origem sintética permanece explicitamente identificada", () => {
  assert.equal(originLabel("demo_sintetico"), "Demonstração sintética");
  assert.equal(originLabel("historico_importado"), "Histórico importado");
});
test("evento local preserva instante e horário de São Paulo", () => {
  assert.equal(
    localTimestamp("2026-10-05T08:00:00-03:00"),
    "2026-10-05T11:00:00.000Z",
  );
  assert.match(dateTime("2026-10-05T11:00:00Z"), /08:00/);
});
