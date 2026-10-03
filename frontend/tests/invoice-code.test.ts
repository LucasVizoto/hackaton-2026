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
  assert.equal(invoiceCodeFromText(danfe), "315407");
  assert.equal(invoiceCodeFromText("NF-e Nº 000.315.407"), "315407");
  assert.equal(
    invoiceCodeFromText("CHAVE DE ACESSO\n3526 0961 1565 0100 9960 5501 3000 3154 9719 7114 5230"),
    "315497",
  );
  assert.equal(invoiceCodeFromText("sem numero fiscal"), "");
});

const accessKey = "35260961156501009960550130003154971971145230";

test("sugestão OCR remove preenchimento de zeros e aceita números curtos", () => {
  for (const label of ["NF-e Nº", "Nº", "N°.", "NNo inválido\nNúmero:", "nNF:"]) {
    assert.equal(invoiceCodeFromText(`${label} 000.000.007`), "7");
  }
  assert.equal(invoiceCodeFromText("NF-e 123456789"), "123456789");
  assert.equal(invoiceCodeFromText("Nº 12"), "12");
  assert.equal(invoiceCodeFromText("NF-e Nº 000 315 407"), "315407");
  assert.equal(invoiceCodeFromText("NF-e\nNº 000.315.407"), "315407");
});

test("prioriza o número impresso rotulado mesmo quando a chave aparece antes", () => {
  assert.equal(invoiceCodeFromText(`CHAVE DE ACESSO\n${accessKey}\nNF-e Nº 000.123.456`), "123456");
  assert.equal(invoiceCodeFromText(`Pedido Nº 123\nNF-e Nº 000.123.456`), "123456");
});

test("não trunca números OCR excessivos nem sugere número zero", () => {
  for (const source of ["NF-e Nº 1234567890", "Nº 123.456.789.012", "NF-e Nº 000.000.000", "Nº 1.2345", "Nº １２３"]) {
    assert.equal(invoiceCodeFromText(source), "", source);
  }
});

test("fallback aceita exatamente uma chave completa, contínua ou em grupos de quatro", () => {
  assert.equal(invoiceCodeFromText(accessKey), "315497");
  assert.equal(invoiceCodeFromText(`CHAVE DE ACESSO: ${accessKey}`), "315497");
  assert.equal(invoiceCodeFromText(`CHAVE DE ACESSO\n3526 0961 1565 0100 9960 5501\n3000 3154 9719 7114 5230\nPROTOCOLO 1326307033181`), "315497");
});

test("não recorta chave dentro de sequência maior ou combina documentos diferentes", () => {
  for (const source of [
    `1${accessKey}`,
    `${accessKey}1`,
    `${accessKey} 1234`,
    `1234 ${accessKey.match(/.{4}/g)?.join(" ")}`,
    `${accessKey.slice(0, 20)} CNPJ ${accessKey.slice(20)}`,
    `PROTOCOLO ${accessKey.slice(0, 20)}\nNº PEDIDO ${accessKey.slice(20)}`,
  ]) assert.equal(invoiceCodeFromText(source), "", source);
});

test("rejeita chaves com UF, mês, modelo, emissão ou número incompatível", () => {
  const replace = (start: number, value: string) => accessKey.slice(0, start) + value + accessKey.slice(start + value.length);
  for (const invalid of [replace(0, "99"), replace(4, "00"), replace(4, "13"), replace(20, "57"), replace(34, "0"), replace(25, "000000000")]) {
    assert.equal(invoiceCodeFromText(invalid), "", invalid);
  }
});

test("duas chaves diferentes sem um número impresso inequívoco não geram sugestão", () => {
  const otherKey = accessKey.slice(0, 25) + "000000001" + accessKey.slice(34);
  assert.equal(invoiceCodeFromText(`${accessKey}\n${otherKey}`), "");
});

test("números impressos conflitantes não permitem fallback para uma chave plausível", () => {
  for (const label of ["NF-e Nº", "Nº"]) {
    assert.equal(invoiceCodeFromText(`${label} 000.123.456\n${label} 000.123.457\nCHAVE DE ACESSO\n${accessKey}`), "");
  }
});
