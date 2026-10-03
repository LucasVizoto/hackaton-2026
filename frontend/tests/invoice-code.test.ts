import { test } from "node:test";
import assert from "node:assert/strict";
import { invoiceCodeFromText } from "../src/app/features/invoice-code";

test("preenche o número da nota e não a chave de acesso completa", () => {
  const danfe = [
    "NF-e Nº 000.315.407",
    "Série 012",
    "CHAVE DE ACESSO",
    "3526 0961 1565 0100 9960 5501 3000 3154 9719 7114 5230",
    "1326307033181",
  ].join("\n");
  assert.equal(invoiceCodeFromText(danfe), "000315407");
  assert.equal(invoiceCodeFromText("NF-e Nº 000.315.407"), "000315407");
  assert.equal(
    invoiceCodeFromText("CHAVE DE ACESSO\n3526 0961 1565 0100 9960 5501 3000 3154 9719 7114 5230"),
    "35260961156501009960550130003154971971145230".slice(25, 34),
  );
  assert.equal(invoiceCodeFromText("sem numero fiscal"), "");
});
