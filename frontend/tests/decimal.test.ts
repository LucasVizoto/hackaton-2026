import { test } from "node:test";
import assert from "node:assert/strict";
import { decimal } from "../src/app/core/presentation";

test("formata frações e tarifas oficiais sem alterar o valor recebido", () => {
  assert.equal(decimal("10.5"), "10,5");
  assert.equal(decimal("0.1824", 4, 4), "0,1824");
  assert.equal(decimal("1234.000001"), "1.234,000001");
});
test("número ausente ou inválido permanece indisponível e zero medido permanece zero", () => {
  for (const value of [null, undefined, "", "  ", "invalid", NaN, Infinity, false]) assert.equal(decimal(value), "Não disponível");
  assert.equal(decimal("0.0"), "0");
});
