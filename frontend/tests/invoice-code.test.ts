import { test } from "node:test";
import assert from "node:assert/strict";
import { invoiceCodeFromText, invoiceDocumentFromText, invoiceFieldsFromText, invoiceFieldsFromXml, linesFromPdfItems, readInvoicePdf, reliableInvoiceFromText } from "../src/app/features/invoice-code";

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

test("a leitura devolve o número impresso e a chave completa", () => {
  const danfe = ["NF-e Nº 000.315.407", "CHAVE DE ACESSO", accessKey].join("\n");
  assert.deepEqual(invoiceFieldsFromText(danfe), { number: "315407", accessKey });
});

test("itens do PDF na mesma linha preservam número e chave", () => {
  const text = linesFromPdfItems([
    { str: "NF-e Nº", transform: [1, 0, 0, 1, 40, 300], width: 48 },
    { str: "000.315.407", transform: [1, 0, 0, 1, 100, 300], width: 70 },
    { str: "3526", transform: [1, 0, 0, 1, 40, 260], width: 28 },
    { str: "0961 1565 0100 9960 5501 3000 3154 9719 7114 5230", transform: [1, 0, 0, 1, 80, 260], width: 280 },
  ]);
  assert.deepEqual(invoiceFieldsFromText(text), {
    number: "315407",
    accessKey: "35260961156501009960550130003154971971145230",
  });
});

function samplePdf(lines: string[]): Blob {
  const commands = ["BT", "/F1 12 Tf", ...lines.map((line, index) => `${index ? "0 -22 Td" : "40 360 Td"} (${line}) Tj`), "ET"].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 640 480] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([Buffer.from(body)], { type: "application/pdf" });
}

test("vários Nº no documento não apagam o número que está na chave", () => {
  const text = `Nº 000.123.456\nNº 000.123.457\nCHAVE DE ACESSO\n${accessKey}`;
  assert.equal(invoiceCodeFromText(text), "");
  assert.deepEqual(invoiceDocumentFromText(text), { number: "315497", accessKey });
});

test("XML preenche o nNF e a chave", () => {
  const xml = `<?xml version="1.0"?><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${accessKey}"><ide><nNF>000315497</nNF></ide></infNFe></NFe>`;
  assert.deepEqual(invoiceFieldsFromXml(xml), { number: "315497", accessKey });
});

test("PDF com texto coerente usa leitura local sem chamar o provedor", async () => {
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const require = createRequire(import.meta.url);
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs")).href;
  const file = samplePdf(["NF-e No 000315497", "Pedido 123", "CHAVE DE ACESSO", accessKey]);
  const remote = async () => { throw new Error("Não deve chamar OCR remoto"); };
  assert.deepEqual(await readInvoicePdf(file, remote), { number: "315497", accessKey });
  assert.deepEqual(await readInvoicePdf(file, remote), { number: "315497", accessKey });
});

test("texto conflitante, ambíguo, chave inválida e número de pedido exigem OCR remoto", () => {
  const cases = [`NF-e No 000315407\nCHAVE DE ACESSO\n${accessKey}`,
    `NF-e No 123\nNF-e No 456`, `CHAVE DE ACESSO\n${accessKey}\n${accessKey.slice(0, 43)}1`,
    `NF-e No 000315497\nCHAVE DE ACESSO\n${accessKey.slice(0, 43)}1`, "Pedido Nº 123", "CHAVE DE ACESSO 1234"];
  for (const source of cases) assert.equal(reliableInvoiceFromText(source), null, source);
  assert.deepEqual(reliableInvoiceFromText("NF-e Nº 000123"), { number: "123", accessKey: "" });
});

test("PDF sem texto confiável envia o original completo e normaliza zeros no cadastro", async () => {
  const file = samplePdf(["NF-e No 000315407", "CHAVE DE ACESSO", accessKey]);
  let calls = 0;
  const controller = new AbortController();
  const result = await readInvoicePdf(file, async (original, signal) => {
    calls++;
    assert.equal(original, file);
    assert.equal(signal, controller.signal);
    return { number: "000315497", accessKey };
  }, controller.signal);
  assert.equal(calls, 1);
  assert.deepEqual(result, { number: "315497", accessKey });
});

test("PDF escaneado sem camada textual usa o provedor e preserva erro para entrada manual", async () => {
  const file = samplePdf([]);
  assert.deepEqual(await readInvoicePdf(file, async () => ({ number: "000123", accessKey: "" })), { number: "123", accessKey: "" });
  await assert.rejects(readInvoicePdf(file, async () => { throw new Error("OCR indisponível"); }), /OCR indisponível/);
});

test("cancelamento impede retorno do OCR do PDF e evita envio com sinal já cancelado", async () => {
  const file = samplePdf([]);
  const controller = new AbortController();
  const request = readInvoicePdf(file, async () => {
    controller.abort();
    return { number: "123", accessKey: "" };
  }, controller.signal);
  await assert.rejects(request, { name: "AbortError" });
  let calls = 0;
  await assert.rejects(readInvoicePdf(file, async () => { calls++; return { number: "123", accessKey: "" }; }, controller.signal), { name: "AbortError" });
  assert.equal(calls, 0);
});

test("números impressos conflitantes não permitem fallback para uma chave plausível", () => {
  for (const label of ["NF-e Nº", "Nº"]) {
    assert.equal(invoiceCodeFromText(`${label} 000.123.456\n${label} 000.123.457\nCHAVE DE ACESSO\n${accessKey}`), "");
  }
});
