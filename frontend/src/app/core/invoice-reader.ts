import { inject, Injectable } from "@angular/core";
import { Api } from "./api";
import { readInvoicePdf } from "../features/invoice-code";
import { InvoiceReadingResponse, readRemoteInvoice } from "../features/invoice-reading";

@Injectable({ providedIn: "root" })
export class InvoiceReader {
  private api = inject(Api);

  readImage(file: Blob, signal?: AbortSignal) {
    return readRemoteInvoice(file, (body, abort) => this.api.post<InvoiceReadingResponse>("integrations/invoice-reading/", body, abort), signal);
  }

  readPdf(file: Blob, signal?: AbortSignal) {
    return readInvoicePdf(file, (source, abort) => this.readImage(source, abort), signal);
  }
}
