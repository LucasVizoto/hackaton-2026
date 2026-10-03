import { Component, inject, input, OnInit, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { IonButton, IonSpinner } from "@ionic/angular/standalone";
import { Api, apiError, dateTime } from "../core/api";
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
          @if (!item.seen_at && api.can("warehouse")) {
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
  when = dateTime;
  async open(item: Arrival) {
    if (this.image()) URL.revokeObjectURL(this.image());
    this.openId.set(item.id);
    this.image.set("");
    this.imageError.set("");
    try {
      const blob = await this.api.blob(`gate-arrivals/${item.id}/file/`);
      this.image.set(URL.createObjectURL(blob));
      if (!item.seen_at && this.api.can("warehouse")) {
        const seen = await this.api.post<Arrival>(`gate-arrivals/${item.id}/seen/`, {});
        item.seen_at = seen.seen_at;
      }
    } catch (e) {
      this.imageError.set(apiError(e));
    }
  }
}

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, IonButton, IonSpinner, PageHeader, FeedbackState, ArrivalList],
  template: `<div class="page form-page">
    <app-page-header title="Portaria" subtitle="Registre a chegada e avise o armazém." />
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
              <ion-button type="button" fill="outline" (click)="cameraPick.click()">Tirar foto</ion-button>
              <ion-button type="button" fill="outline" (click)="filePick.click()">Anexar dos arquivos</ion-button>
            </div>
            <input #cameraPick hidden type="file" accept="image/*" capture="environment" (change)="onFile($event)" />
            <input #filePick hidden type="file" accept="image/*" (change)="onFile($event)" />
            <span class="field-help">Use a câmera do celular ou escolha uma imagem já salva. A leitura preenche o número da nota.</span>
            @if (preview()) {
              <img class="note-preview" [src]="preview()" alt="Foto da nota fiscal anexada" />
            }
            @if (reading()) {
              <p class="field-help">Lendo a nota fiscal…</p>
            }
          </div>
          <label class="wide"
            >Número da nota<input formControlName="invoice_number" inputmode="numeric" autocomplete="off" /><span class="field-help">Número da NF-e impresso no quadro da nota. Confira antes de enviar.</span></label>
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
    @if (rows().length) {
      <section class="panel">
        <h2>Chegadas enviadas</h2>
        <app-arrival-list [rows]="rows()" />
      </section>
    }
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
  form = this.fb.nonNullable.group({
    vehicle_plate: ["", Validators.required],
    tractor_plate: ["", Validators.required],
    driver_name: ["", [Validators.required, Validators.minLength(3)]],
    invoice_number: ["", [Validators.required, Validators.minLength(3)]],
  });
  ngOnInit() {
    void this.load();
  }
  async onFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const next = input.files?.[0] ?? null;
    input.value = "";
    if (!next) return;
    if (next.type && !next.type.startsWith("image/")) {
      this.error.set("Envie uma imagem da nota fiscal.");
      return;
    }
    if (this.preview()) URL.revokeObjectURL(this.preview());
    this.file = next;
    this.preview.set(URL.createObjectURL(next));
    this.error.set("");
    this.notice.set("");
    this.reading.set(true);
    try {
      const code = await readInvoiceImage(next);
      if (code) this.form.controls.invoice_number.setValue(code);
      else this.error.set("Não encontrei o número da nota na imagem. Informe o número da NF-e.");
    } catch {
      this.error.set("Não foi possível ler a imagem. Informe o número da nota.");
    } finally {
      this.reading.set(false);
    }
  }
  async save() {
    if (!this.file || this.form.invalid || this.reading()) return;
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
      body.append("invoice_number", value.invoice_number);
      await this.api.post("gate-arrivals/", body);
      this.notice.set("Chegada informada ao armazém.");
      this.form.reset();
      this.file = null;
      if (this.preview()) URL.revokeObjectURL(this.preview());
      this.preview.set("");
      await this.load();
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
  private async load() {
    try {
      const result = await this.api.get<{ results: Arrival[] }>("gate-arrivals/");
      this.rows.set(result.results);
    } catch (e) {
      this.error.set(apiError(e));
    }
  }
}

@Component({
  standalone: true,
  imports: [PageHeader, FeedbackState, ArrivalList],
  template: `<div class="page">
    <app-page-header title="Chegadas na portaria" subtitle="Motorista, placas e nota fiscal enviados pela portaria." />
    @if (error()) {
      <div app-feedback tone="error" class="error">{{ error() }}</div>
    }
    @if (!rows().length && !error()) {
      <p class="notice">Nenhuma chegada informada.</p>
    }
    <section class="panel">
      <app-arrival-list [rows]="rows()" />
    </section>
  </div>`,
})
export class ArrivalInbox implements OnInit {
  private api = inject(Api);
  rows = signal<Arrival[]>([]);
  error = signal("");
  ngOnInit() {
    void this.load();
  }
  private async load() {
    try {
      const result = await this.api.get<{ results: Arrival[] }>("gate-arrivals/");
      this.rows.set(result.results);
    } catch (e) {
      this.error.set(apiError(e));
    }
  }
}
