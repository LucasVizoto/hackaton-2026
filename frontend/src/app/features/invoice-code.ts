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

export function invoiceCodeFromText(text: string): string {
  const source = text.replace(/\u00a0/g, " ");
  const printed = printedInvoiceNumber(source);
  if (printed !== "") return printed ?? "";
  const key = accessKey(source);
  return key ? canonicalOcrNumber(key.slice(25, 34)) : "";
}

export async function readInvoiceImage(file: Blob): Promise<string> {
  const imported = await import("tesseract.js");
  const { createWorker } = imported.default ?? imported;
  const worker = await createWorker("por").catch(() => createWorker("eng"));
  try {
    const result = await worker.recognize(file);
    return invoiceCodeFromText(result.data.text);
  } finally {
    await worker.terminate();
  }
}
