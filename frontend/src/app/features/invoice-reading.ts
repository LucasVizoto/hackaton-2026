import type { InvoiceReading } from "./invoice-code";

export interface InvoiceReadingResponse {
  number: string | null;
  access_key: string | null;
  status: "suggested" | "unreadable" | "ambiguous";
  requires_confirmation: true;
}

export type InvoiceReadingRequest = (body: FormData, signal?: AbortSignal) => Promise<InvoiceReadingResponse>;

export async function readRemoteInvoice(file: Blob, request: InvoiceReadingRequest, signal?: AbortSignal): Promise<InvoiceReading> {
  signal?.throwIfAborted();
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error("Envie uma imagem ou PDF de até 10 MB.");
  const body = new FormData();
  body.append("file", file, file instanceof File ? file.name : "nota.pdf");
  const result = await request(body, signal);
  signal?.throwIfAborted();
  if (result.status === "ambiguous") throw new Error("A leitura encontrou identificadores conflitantes ou mais de uma nota. Confira o documento e preencha manualmente.");
  if (result.status === "unreadable") throw new Error("Não foi possível ler os identificadores. Confira o documento e preencha manualmente.");
  if (result.status !== "suggested" || result.requires_confirmation !== true) throw new Error("Resposta de leitura inválida. Preencha manualmente.");
  return { number: result.number ?? "", accessKey: result.access_key ?? "" };
}

/** One session per document. Every edit/removal invalidates pending results. */
export class InvoiceReadSession {
  private controller?: AbortController;
  start() {
    this.cancel();
    const controller = new AbortController();
    this.controller = controller;
    return { signal: controller.signal, isCurrent: () => this.controller === controller && !controller.signal.aborted };
  }
  cancel() {
    this.controller?.abort();
    this.controller = undefined;
  }
}
