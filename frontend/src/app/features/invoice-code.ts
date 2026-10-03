function accessKey(fragment: string): string {
  const grouped = fragment.match(/(?:\d{4}[\s.]*){11}/);
  if (grouped) return grouped[0].replace(/\D/g, "").slice(0, 44);
  const digits = fragment.replace(/\D/g, "");
  return digits.length >= 44 ? digits.slice(0, 44) : "";
}

function printedInvoiceNumber(source: string): string {
  const labeled = source.match(/(?:nf-?e|n[º°o]\.?)[^\d]{0,16}(\d{3})[.\s]?(\d{3})[.\s]?(\d{3})/i);
  return labeled ? `${labeled[1]}${labeled[2]}${labeled[3]}` : "";
}

export function invoiceCodeFromText(text: string): string {
  const source = text.replace(/\u00a0/g, " ");
  const printed = printedInvoiceNumber(source);
  if (printed) return printed;
  const labeled = source.match(/chave\s*de\s*acesso([\s\S]{0,180})/i);
  const key = accessKey(labeled?.[1] ?? source);
  return key ? key.slice(25, 34) : "";
}

export async function readInvoiceImage(file: Blob): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("por").catch(() => createWorker("eng"));
  try {
    const result = await worker.recognize(file);
    return invoiceCodeFromText(result.data.text);
  } finally {
    await worker.terminate();
  }
}
