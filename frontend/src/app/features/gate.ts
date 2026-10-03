import { Component, inject, input, OnInit, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { IonButton, IonSpinner } from "@ionic/angular/standalone";
import { Api, apiError, dateTime, Page } from "../core/api";
import { invoiceNumber } from "../core/workflow";
import { readInvoiceImage } from "./invoice-code";
import { FeedbackState, PageHeader } from "../shared/ui";

interface Arrival {
  id: string;
  vehicle_plate: string;
  tractor_plate: string;
  driver_name: string;
  invoice_number: string;
  created_at: string;
  seen_at: string | null;
  created_by_name: string;
}

@Component({
  selector: "app-arrival-list",
  standalone: true,
  imports: [IonButton],
  template: `<div class="arrival-list">
    @for (item of rows(); track item.id) {
      <article class="arrival-card">
        <div>
          <strong>{{ item.driver_name }}</strong>
          <span>{{ item.vehicle_plate }} · cavalo {{ item.tractor_plate }}</span>
          <span>Nota {{ item.invoice_number }} · {{ when(item.created_at) }}</span>
          @if (!item.seen_at && !seenIds().has(item.id) && api.can("warehouse")) {
            <span class="status pending">Nova</span>
          }
        </div>
        <ion-button fill="outline" size="small" (click)="open(item)">Ver nota</ion-button>
      </article>
      @if (openId() === item.id && imageError()) {
        <p class="error">{{ imageError() }}</p>
      }
      @if (openId() === item.id && image()) {
        <img class="note-preview" [src]="image()" alt="Nota fiscal de {{ item.driver_name }}" />
      }
    }
  </div>`,
  styles: [
    `
      .arrival-list { display: grid; gap: 12px; }
      .arrival-card { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
      .arrival-card div { display: grid; gap: 4px; }
      .arrival-card span { color: var(--muted); }
      .note-preview { display: block; max-width: 100%; max-height: 420px; border-radius: 12px; }
    `,
  ],
})
export class ArrivalList {
  api = inject(Api);
  rows = input.required<Arrival[]>();
  openId = signal("");
  image = signal("");
  imageError = signal("");
  seenIds = signal<ReadonlySet<string>>(new Set());
  when = dateTime;
  private generation=0;
  async open(item: Arrival) {
    const generation=++this.generation;
    if (this.image()) URL.revokeObjectURL(this.image());
    this.openId.set(item.id);
    this.image.set("");
    this.imageError.set("");
    try {
      const blob = await this.api.blob(`gate-arrivals/${item.id}/file/`);
      if(generation!==this.generation)return;
      this.image.set(URL.createObjectURL(blob));
      if (!item.seen_at && !this.seenIds().has(item.id) && this.api.can("warehouse")) {
        const seen = await this.api.post<Arrival>(`gate-arrivals/${item.id}/seen/`, {});
        if (seen.seen_at) this.seenIds.update(ids => new Set([...ids, item.id]));
      }
    } catch (e) {
      if(generation===this.generation)this.imageError.set(apiError(e));
    }
  }
  ngOnDestroy(){this.generation++;if(this.image())URL.revokeObjectURL(this.image());}
}

@Component({
  standalone: true,
  imports: [RouterLink, ReactiveFormsModule, IonButton, IonSpinner, PageHeader, FeedbackState, ArrivalList],
  template: `<div class="page form-page">
    <app-page-header title="Aviso de chegada com foto" subtitle="Envie placas, motorista e uma foto da nota ao armazém."><ion-button routerLink="/portaria" fill="outline">Recebimentos da Portaria</ion-button></app-page-header>
    <p class="notice">Este aviso fica separado dos recebimentos. A entrada e a saída da unidade são registradas no recebimento correspondente.</p>
    @if (error()) {
      <div app-feedback tone="error" class="error">{{ error() }}</div>
    }
    @if (notice()) {
      <div app-feedback tone="success" class="notice">{{ notice() }}</div>
    }
    <form [formGroup]="form" (ngSubmit)="save()">
      <section class="panel">
        <h2>Chegada</h2>
        <div class="form-grid">
          <label>Placa<input formControlName="vehicle_plate" placeholder="Placa do veículo" autocomplete="off" /></label>
          <label>Placa cavalo<input formControlName="tractor_plate" placeholder="Placa do cavalo" autocomplete="off" /></label>
          <label class="wide">Motorista<input formControlName="driver_name" placeholder="Nome do motorista" autocomplete="name" /></label>
          <div class="wide">
            <span class="field-label">Nota fiscal</span>
            <div class="actions">
              <ion-button type="button" fill="outline" [disabled]="busy() || reading()" (click)="cameraPick.click()">Tirar foto</ion-button>
              <ion-button type="button" fill="outline" [disabled]="busy() || reading()" (click)="filePick.click()">Anexar dos arquivos</ion-button>
            </div>
            <input #cameraPick hidden type="file" accept="image/*" capture="environment" (change)="onFile($event)" />
            <input #filePick hidden type="file" accept="image/*" (change)="onFile($event)" />
            <span class="field-help">Use a câmera do celular ou escolha uma imagem de até 10 MB. A leitura sugere o número; confira na foto antes de enviar.</span>
            @if (preview()) {
              <img class="note-preview" [src]="preview()" alt="Foto da nota fiscal anexada" />
            }
            @if (reading()) {
              <p class="field-help">Lendo a nota fiscal…</p>
              <ion-button type="button" fill="outline" (click)="enterManually()">Informar número manualmente</ion-button>
            }
          </div>
          <label class="wide"
            >Número da nota<input formControlName="invoice_number" [readonly]="reading()" (input)="numberEdited()" inputmode="numeric" autocomplete="off" /><span class="field-help">Informe o número da NF-e com 1 a 9 dígitos, sem zeros iniciais; não informe a chave de 44 dígitos.</span></label>
          <label class="checkbox wide"><input type="checkbox" formControlName="number_confirmed" />Conferi o número da nota na imagem.</label>
          @if(suggestion()){<p class="field-help wide">Número sugerido pela leitura: {{suggestion()}}. Zeros de preenchimento impressos foram removidos; a imagem original foi preservada.</p>}
          @if(form.controls.invoice_number.touched && form.controls.invoice_number.invalid){<p class="error wide">Use apenas o número da NF-e, de 1 a 9 dígitos, sem zeros iniciais.</p>}
        </div>
      </section>
      <div class="actions">
        <ion-button type="submit" [disabled]="busy() || reading() || form.invalid || !file">
          @if (busy()) {
            <ion-spinner name="dots" />
          }
          Avisar o armazém
        </ion-button>
      </div>
    </form>
    <section class="panel">
      <h2>Chegadas enviadas</h2><ion-button fill="outline" [disabled]="listBusy()" (click)="load()">Atualizar avisos</ion-button>
      <app-arrival-list [rows]="rows()" />
      <div class="pagination"><ion-button fill="outline" [disabled]="listBusy()||page===1" (click)="load(page-1)">Anterior</ion-button><span>Página {{page}} · {{count()}} avisos</span><ion-button fill="outline" [disabled]="listBusy()||!hasNext()" (click)="load(page+1)">Próxima</ion-button></div>
    </section>
  </div>`,
  styles: [
    `
      .field-label { display: block; margin-bottom: 8px; }
      .note-preview { display: block; margin-top: 12px; max-width: 100%; max-height: 280px; border-radius: 12px; }
    `,
  ],
})
export class GateDesk implements OnInit {
  private api = inject(Api);
  private fb = inject(FormBuilder);
  busy = signal(false);
  reading = signal(false);
  error = signal("");
  notice = signal("");
  preview = signal("");
  rows = signal<Arrival[]>([]);
  file: File | null = null;
  suggestion=signal('');private fileGeneration=0;listBusy=signal(false);page=1;count=signal(0);hasNext=signal(false);
  form = this.fb.nonNullable.group({
    vehicle_plate: ["", Validators.required],
    tractor_plate: ["", Validators.required],
    driver_name: ["", [Validators.required, Validators.minLength(3)]],
    invoice_number: ["", [Validators.required, Validators.pattern(/^[1-9][0-9]{0,8}$/)]],
    number_confirmed: [false, Validators.requiredTrue],
  });
  ngOnInit() {
    void this.load();
  }
  async onFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const next = input.files?.[0] ?? null;
    input.value = "";
    if (!next || this.busy()) return;
    if(!next.size || next.size>10*1024*1024){this.error.set("Envie uma imagem de até 10 MB.");return;}
    if (next.type && !next.type.startsWith("image/")) {
      this.error.set("Envie uma imagem da nota fiscal.");
      return;
    }
    if (this.preview()) URL.revokeObjectURL(this.preview());
    const generation=++this.fileGeneration;
    this.file = next;
    this.form.controls.invoice_number.reset();this.form.controls.number_confirmed.setValue(false);this.suggestion.set('');
    this.preview.set(URL.createObjectURL(next));
    this.error.set("");
    this.notice.set("");
    this.reading.set(true);
    try {
      const code = await readInvoiceImage(next);
      if(generation!==this.fileGeneration)return;
      if (code){this.form.controls.invoice_number.setValue(code);this.suggestion.set(code);}
      else this.error.set("Não encontrei o número da nota na imagem. Informe o número da NF-e.");
    } catch {
      if(generation===this.fileGeneration)this.error.set("Não foi possível ler a imagem. Informe o número da nota.");
    } finally {
      if(generation===this.fileGeneration)this.reading.set(false);
    }
  }
  async save() {
    if (this.busy() || !this.file || this.form.invalid || this.reading()) {this.form.markAllAsTouched();return;}
    this.busy.set(true);
    this.error.set("");
    this.notice.set("");
    try {
      const value = this.form.getRawValue();
      const body = new FormData();
      body.append("file", this.file);
      body.append("vehicle_plate", value.vehicle_plate);
      body.append("tractor_plate", value.tractor_plate);
      body.append("driver_name", value.driver_name);
      body.append("invoice_number", invoiceNumber(value.invoice_number));
      await this.api.post("gate-arrivals/", body);
      this.notice.set("Chegada informada ao armazém.");
      this.form.reset();this.suggestion.set('');
      this.file = null;
      if (this.preview()) URL.revokeObjectURL(this.preview());
      this.preview.set("");
      await this.load(1);
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
  numberEdited(){this.form.controls.number_confirmed.setValue(false);}
  enterManually(){this.fileGeneration++;this.reading.set(false);this.suggestion.set('');this.form.controls.number_confirmed.setValue(false);this.notice.set('Informe o número impresso na nota e confirme a conferência da imagem.');}
  async load(page=this.page){this.listBusy.set(true);try{const result=await this.api.get<Page<Arrival>>(`gate-arrivals/?page=${page}`);this.page=page;this.rows.set(result.results);this.count.set(result.count);this.hasNext.set(!!result.next);}catch(e){this.error.set(apiError(e));}finally{this.listBusy.set(false);}}
  ngOnDestroy(){this.fileGeneration++;if(this.preview())URL.revokeObjectURL(this.preview());}

}

@Component({
  standalone: true,
  imports: [RouterLink, IonButton, PageHeader, FeedbackState, ArrivalList],
  template: `<div class="page">
    <app-page-header title="Chegadas com foto" subtitle="Avisos enviados pela Portaria; abrir a foto marca o aviso como visto."><ion-button fill="outline" [disabled]="busy()" (click)="load()">Atualizar avisos</ion-button></app-page-header>
    <p class="notice">Um aviso com foto não cria agendamento nem registra entrada ou saída automaticamente. <a routerLink="/operacao">Consultar recebimentos</a></p>
    @if (error()) {
      <div app-feedback tone="error" class="error">{{ error() }}</div>
    }
    @if (!rows().length && !error()) {
      <p class="notice">Nenhuma chegada informada.</p>
    }
    <section class="panel">
      <app-arrival-list [rows]="rows()" />
      <div class="pagination"><ion-button fill="outline" [disabled]="busy()||page===1" (click)="load(page-1)">Anterior</ion-button><span>Página {{page}} · {{count()}} avisos</span><ion-button fill="outline" [disabled]="busy()||!hasNext()" (click)="load(page+1)">Próxima</ion-button></div>
    </section>
  </div>`,
})
export class ArrivalInbox implements OnInit {
  private api = inject(Api);
  rows = signal<Arrival[]>([]);
  error = signal("");
  busy=signal(false);page=1;count=signal(0);hasNext=signal(false);
  ngOnInit() {
    void this.load();
  }
  async load(page=this.page){this.busy.set(true);this.error.set('');try{const result=await this.api.get<Page<Arrival>>(`gate-arrivals/?page=${page}`);this.page=page;this.rows.set(result.results);this.count.set(result.count);this.hasNext.set(!!result.next);}catch(e){this.error.set(apiError(e));}finally{this.busy.set(false);}}
}
