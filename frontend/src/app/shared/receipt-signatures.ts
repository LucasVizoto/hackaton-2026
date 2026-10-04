import { Component, effect, inject, input, signal } from '@angular/core';
import { Api, apiError, dateTime } from '../core/api';
import { FeedbackState } from './ui';

export interface ReceiptSignature {
  id: string; signer_name: string; declaration?: string; signed_at: string;
  appointment_revision: number; current_revision: boolean; manifest_sha256: string;
  document_manifest?: { invoices?: unknown[]; visits?: unknown[]; lines?: unknown[]; gate_checked_in_at?: string; gate_checked_out_at?: string };
}

@Component({
  selector: 'app-receipt-signatures', standalone: true, imports: [FeedbackState],
  template: `<section class="section"><h2>Conferências assinadas</h2>
    <button type="button" [disabled]="busy()" (click)="load()">Atualizar assinaturas</button>
    @if(error()){<div app-feedback tone="error">{{error()}}</div>}
    @if(busy()){<p role="status">Consultando assinaturas…</p>}
    @for(signature of rows();track signature.id){<article class="record-context">
      <h3>{{signature.signer_name}}</h3><p>{{dt(signature.signed_at)}} · Revisão {{signature.appointment_revision}} · {{signature.current_revision ? 'Corresponde à revisão atual' : 'Revisão anterior; não confirma a versão atual'}}</p>
      @if(signature.declaration){<p>{{signature.declaration}}</p>}
      @if(signature.document_manifest;as manifest){<dl class="metadata"><div><dt>Notas preservadas</dt><dd>{{manifest.invoices?.length ?? 0}}</dd></div><div><dt>Etapas preservadas</dt><dd>{{manifest.visits?.length ?? 0}}</dd></div><div><dt>Itens conferidos</dt><dd>{{manifest.lines?.length ?? 0}}</dd></div><div><dt>Entrada na unidade</dt><dd>{{dt(manifest.gate_checked_in_at)}}</dd></div><div><dt>Saída da unidade</dt><dd>{{dt(manifest.gate_checked_out_at)}}</dd></div></dl>}
      <details><summary>Identificação técnica do registro</summary><p class="field-help">Registro {{signature.id}}</p><p class="field-help">SHA-256 do manifesto: {{signature.manifest_sha256}}</p></details>
    </article>}@empty{ @if(!busy()&&!error()){<p>Nenhuma assinatura registrada neste recebimento.</p>} }
  </section>`,
})
export class ReceiptSignatures {
  private api = inject(Api);
  receipt = input.required<string>(); refresh = input(0);
  rows = signal<ReceiptSignature[]>([]); error = signal(''); busy = signal(false); dt = dateTime;
  private generation = 0;
  constructor() { effect(() => { this.refresh(); void this.load(this.receipt()); }); }
  async load(receipt = this.receipt()) {
    const generation = ++this.generation;
    this.rows.set([]); this.error.set('');
    if (!receipt) { this.busy.set(false); return; }
    this.busy.set(true);
    try {
      const result = await this.api.get<{results: ReceiptSignature[]}>(`appointments/${receipt}/signatures/`);
      if (generation === this.generation) this.rows.set(result.results);
    } catch (error) { if (generation === this.generation) this.error.set(apiError(error)); }
    finally { if (generation === this.generation) this.busy.set(false); }
  }
}
