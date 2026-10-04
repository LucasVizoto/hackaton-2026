function canonicalOcrNumber(raw: string): string {
  if (!/^(?:[0-9]{1,9}|[0-9]{1,3}(?:[.\t ]+[0-9]{3}){1,2})$/.test(raw)) return "";
  const number = raw.replace(/[.\t ]/g, "").replace(/^0+/, "");
  return /^[1-9][0-9]{0,8}$/.test(number) ? number : "";
}

function plausibleAccessKey(raw: string): string {
  // Recognize one complete key, never concatenate arbitrary fields or truncate digits.
  if (!/^(?:[0-9]{44}|[0-9]{4}(?:[.\t ]+[0-9]{4}){10})$/.test(raw)) return "";
  const key = raw.replace(/[.\t ]/g, "");
  const states = new Set(["11", "12", "13", "14", "15", "16", "17", "21", "22", "23", "24", "25", "26", "27", "28", "29", "31", "32", "33", "35", "41", "42", "43", "50", "51", "52", "53"]);
  if (!states.has(key.slice(0, 2)) || !/^(?:0[1-9]|1[0-2])$/.test(key.slice(4, 6))) return "";
  if (key.slice(20, 22) !== "55" || !/^[1-79]$/.test(key[34])) return "";
  if (/^0+$/.test(key.slice(6, 20)) || !canonicalOcrNumber(key.slice(25, 34))) return "";
  return key;
}

function accessKey(source: string): string {
  const candidates = new Set<string>();
  for (const line of source.split(/\r?\n/)) {
    for (const match of line.matchAll(/[0-9]+(?:[.\t ]+[0-9]+)*/g)) {
      const key = plausibleAccessKey(match[0]);
      if (key) candidates.add(key);
    }
  }
  // Wrapped groups are considered only immediately after the access-key label.
  const wrapped = source.match(/chave\s*de\s*acesso[^\r\n0-9]*\r?\n((?:[\t ]*[0-9]{4}(?:[.\t ]+[0-9]{4})*[\t ]*(?:\r?\n|$)){1,3})/i);
  if (wrapped) {
    const key = plausibleAccessKey(wrapped[1].trim().replace(/\r?\n[\t ]*/g, " "));
    if (key) candidates.add(key);
  }
  return candidates.size === 1 ? [...candidates][0] : "";
}

function printedInvoiceNumber(source: string): string | null {
  const labels = [
    /\bnf-?e[\t ]*(?:(?:n[º°o]|n[úu]mero)\.?[\t ]*)?[:#]?[\t ]*(?:\r?\n[\t ]*)?([0-9]+(?:[.\t ]+[0-9]+)*)/gi,
    /\b(?:n[º°o]|n[úu]mero|nnf)\.?[\t ]*[:#]?[\t ]*(?:\r?\n[\t ]*)?([0-9]+(?:[.\t ]+[0-9]+)*)/gi,
  ];
  for (const label of labels) {
    const candidates = new Set([...source.matchAll(label)].map((match) => canonicalOcrNumber(match[1])).filter(Boolean));
    if (candidates.size) return candidates.size === 1 ? [...candidates][0] : null;
  }
  return "";
}

export interface InvoiceReading {
  number: string;
  accessKey: string;
}

function numberFromAccessKey(key: string): string {
  return key ? canonicalOcrNumber(key.slice(25, 34)) : "";
}

export function invoiceFieldsFromText(text: string): InvoiceReading {
  const source = text.replace(/\u00a0/g, " ");
  const printed = printedInvoiceNumber(source);
  const key = accessKey(source);
  const number = printed === "" ? numberFromAccessKey(key) : (printed ?? "");
  return { number, accessKey: key };
}

/** The 9-digit nNF inside a single access key is the invoice number, even when other Nº labels disagree. */
export function invoiceDocumentFromText(text: string): InvoiceReading {
  const fields = invoiceFieldsFromText(text);
  const fromKey = numberFromAccessKey(fields.accessKey);
  return { number: fromKey || fields.number, accessKey: fields.accessKey };
}

export function invoiceFieldsFromXml(xml: string): InvoiceReading {
  const source = xml.replace(/<(\/?)[\w.-]+:/g, "<$1");
  const printed = source.match(/<nNF>\s*0*([1-9]\d{0,8})\s*<\/nNF>/i)?.[1] ?? "";
  const accessKey = source.match(/<infNFe\b[^>]*\bId="NFe(\d{44})"/i)?.[1]
    ?? source.match(/<chNFe>\s*(\d{44})\s*<\/chNFe>/i)?.[1]
    ?? "";
  return { number: printed || numberFromAccessKey(accessKey), accessKey };
}

export function invoiceCodeFromText(text: string): string {
  return invoiceFieldsFromText(text).number;
}

interface PdfTextItem {
  str: string;
  transform: number[];
  width?: number;
}

export function linesFromPdfItems(items: readonly PdfTextItem[]): string {
  const rows: { y: number; parts: { x: number; end: number; str: string }[] }[] = [];
  for (const item of items) {
    if (!item.str) continue;
    const x = item.transform[4] ?? 0;
    const y = item.transform[5] ?? 0;
    const width = item.width && item.width > 0 ? item.width : item.str.length * 4;
    let row = rows.find((candidate) => Math.abs(candidate.y - y) <= 2);
    if (!row) {
      row = { y, parts: [] };
      rows.push(row);
    }
    row.parts.push({ x, end: x + width, str: item.str });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => {
      const parts = row.parts.sort((a, b) => a.x - b.x);
      let text = "";
      let cursor = 0;
      for (const part of parts) {
        if (text && part.x > cursor + 1.5) text += " ";
        text += part.str;
        cursor = Math.max(cursor, part.end);
      }
      return text;
    })
    .join("\n");
}

async function recognizeImage(file: Blob): Promise<string> {
  const imported = await import("tesseract.js");
  const { createWorker } = imported.default ?? imported;
  const worker = await createWorker("por").catch(() => createWorker("eng"));
  try {
    const result = await worker.recognize(file);
    return String(result.data.text ?? "");
  } finally {
    await worker.terminate();
  }
}

export async function readInvoiceImage(file: Blob): Promise<string> {
  return invoiceCodeFromText(await recognizeImage(file));
}

async function loadPdf(data: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (typeof document === "undefined") return pdfjs.getDocument({ data }).promise;
  const root = new URL(document.baseURI);
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs/pdf.worker.min.mjs", root).toString();
  return pdfjs.getDocument({
    data,
    standardFontDataUrl: new URL("pdfjs/standard_fonts/", root).toString(),
  }).promise;
}

async function textLayer(pdf: Awaited<ReturnType<typeof loadPdf>>): Promise<string> {
  const pages = Math.min(pdf.numPages, 3);
  const chunks: string[] = [];
  for (let index = 1; index <= pages; index += 1) {
    const page = await pdf.getPage(index);
    const content = await page.getTextContent();
    const items = content.items.flatMap((item) => ("str" in item ? [item] : []));
    chunks.push(linesFromPdfItems(items));
  }
  return chunks.join("\n");
}

async function ocrFirstPage(pdf: Awaited<ReturnType<typeof loadPdf>>): Promise<string> {
  if (typeof document === "undefined") return "";
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, viewport }).promise;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return blob ? recognizeImage(blob) : "";
}

export async function readInvoicePdf(file: Blob): Promise<InvoiceReading> {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await loadPdf(data);
  try {
    const embedded = invoiceDocumentFromText(await textLayer(pdf));
    if (embedded.number || embedded.accessKey) return embedded;
    return invoiceDocumentFromText(await ocrFirstPage(pdf));
  } finally {
    await pdf.destroy();
  }
}
