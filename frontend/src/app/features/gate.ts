import { Component, effect, inject, input, OnInit, output, signal, untracked } from "@angular/core";
import { RouterLink } from "@angular/router";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { IonButton, IonModal, IonSpinner } from "@ionic/angular/standalone";
import { Capacitor } from "@capacitor/core";
import { Api, apiError, dateTime, Page } from "../core/api";
import { Arrival, GateLive, GateMessage } from "../core/gate-live";
import { readInvoiceImage } from "./invoice-code";
import { FeedbackState, PageHeader } from "../shared/ui";

function gateInvoiceNumber(value: string): string {
  const number = value.trim();
  if (!/^(?!0+$)\d{1,9}$/.test(number)) {
    throw new Error("Informe o número da NF com 1 a 9 dígitos. Zeros à esquerda são permitidos; não use letras nem a chave de 44 dígitos.");
  }
  return number;
}

function applyArrival(rows: Arrival[], message: GateMessage, board: "warehouse" | "portaria" | "review"): Arrival[] {
  const arrival = message.arrival;
  const index = rows.findIndex((row) => row.id === arrival.id);
  if (message.event === "created") {
    if (board !== "warehouse" || index >= 0) return rows;
    return [arrival, ...rows];
  }
  if (index < 0) {
    if (board === "review" && message.event === "rejected") return [arrival, ...rows];
    if (board === "portaria") return [arrival, ...rows];
    return rows;
  }
  const next = rows.slice();
  next[index] = arrival;
  return next;
}

@Component({
  selector: "app-arrival-list",
  standalone: true,
  imports: [IonButton, IonModal],
  template: `<div class="arrival-grid decisions">
    @for (item of rows(); track item.id) {
      <article class="arrival-card">
        <div class="arrival-copy">
          <div class="arrival-head">
            <strong>{{ item.driver_name }}</strong>
            <span [class]="'status ' + tone(item)">{{ label(item) }}</span>
          </div>
          <span>Placa {{ item.vehicle_plate }}</span>
          <span>Cavalo {{ item.tractor_plate }}</span>
          <span>Nota {{ item.invoice_number }}</span>
          <span>{{ when(item.created_at) }}</span>
          @if (board() === "warehouse" && !item.seen_at && !seenIds().has(item.id)) {
            <span class="status pending">Nova</span>
          }
          @if (item.decision === "authorized") {
            <span class="pass">A portaria pode liberar a entrada.</span>
          }
          @if (item.decision === "rejected") {
            <span class="hold">Encaminhada para revisão de Compras.</span>
          }
        </div>
        <div class="arrival-actions">
          @if (board() === "warehouse" && api.can('warehouse') && item.decision === "pending") {
            <ion-button size="small" color="success" [disabled]="busyId() === item.id" (click)="decide(item, 'authorized')">Aceitar</ion-button>
            <ion-button size="small" color="danger" fill="outline" [disabled]="busyId() === item.id" (click)="decide(item, 'rejected')">Recusar</ion-button>
          }
          <ion-button fill="outline" size="small" [disabled]="opening()" (click)="open(item)">Ver nota</ion-button>
        </div>
        @if (openId() === item.id && imageError()) {
          <p class="error">{{ imageError() }}</p>
        }
        @if (decisionError() && errorId() === item.id) {
          <p class="error">{{ decisionError() }}</p>
        }
      </article>
    }
  </div>
  <ion-modal [isOpen]="!!image()" (didDismiss)="closeImage()">
    <ng-template>
      <div class="photo-viewer">
        <ion-button fill="outline" (click)="closeImage()">Fechar nota</ion-button>
        <div class="photo-scroll"><img [src]="image()" alt="Foto da nota fiscal" /></div>
      </div>
    </ng-template>
  </ion-modal>`,
  styles: [
    `
      .arrival-grid { display: grid; gap: 16px; }
      .arrival-grid.decisions { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .arrival-card {
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-width: 0;
        padding: 16px;
        border: 1px solid var(--line);
        border-radius: 16px;
        background: var(--surface);
      }
      .arrival-copy, .arrival-head { display: grid; gap: 4px; }
      .arrival-head { grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 8px; }
      .arrival-card span { color: var(--muted); }
      .arrival-card .pass { color: var(--success); }
      .arrival-card .hold { color: var(--danger); }
      .arrival-actions { display: flex; flex-wrap: wrap; gap: 8px; }
      .photo-viewer { display: flex; flex-direction: column; height: 100%; padding: 12px; }
      .photo-scroll { overflow: auto; flex: 1; }
      .photo-scroll img { display: block; max-width: none; }
      @media (max-width: 960px) {
        .arrival-grid.decisions { grid-template-columns: 1fr; }
      }
    `,
  ],
})
export class ArrivalList {
  api = inject(Api);
  rows = input.required<Arrival[]>();
  board = input<"warehouse" | "portaria" | "review">("portaria");
  updated = output<Arrival>();
  openId = signal("");
  opening = signal(false);
  image = signal("");
  private generation = 0;
  imageError = signal("");
  seenIds = signal<ReadonlySet<string>>(new Set());
  decisionError = signal("");
  errorId = signal("");
  busyId = signal("");
  when = dateTime;
  tone(item: Arrival) {
    if (item.decision === "authorized") return "approved";
    if (item.decision === "rejected") return "rejected";
    return "pending";
  }
  label(item: Arrival) {
    if (item.decision === "authorized") return "Pode passar";
    if (item.decision === "rejected") return "Recusada";
    return "Aguardando";
  }
  async decide(item: Arrival, decision: "authorized" | "rejected") {
    this.busyId.set(item.id);
    this.decisionError.set("");
    this.errorId.set("");
    try {
      const saved = await this.api.post<Arrival>(`gate-arrivals/${item.id}/decision/`, { decision });
      this.updated.emit(saved);
    } catch (e) {
      this.errorId.set(item.id);
      this.decisionError.set(apiError(e));
    } finally {
      this.busyId.set("");
    }
  }
  async open(item: Arrival) {
    if (this.opening()) return;
    const generation = ++this.generation;
    const tab = Capacitor.isNativePlatform() ? null : window.open("about:blank", "_blank");
    this.opening.set(true);
    this.openId.set(item.id);
    this.imageError.set("");
    try {
      const blob = await this.api.blob(`gate-arrivals/${item.id}/file/`);
      if (generation !== this.generation) { tab?.close(); return; }
      const url = URL.createObjectURL(blob);
      if (tab && !tab.closed) {
        tab.location.href = url;
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else {
        this.closeImage();
        this.image.set(url);
      }
      if (this.board() === "warehouse" && this.api.can('warehouse') && !item.seen_at && !this.seenIds().has(item.id)) {
        const seen = await this.api.post<Arrival>(`gate-arrivals/${item.id}/seen/`, {});
        if (seen.seen_at) this.seenIds.update(ids => new Set([...ids, item.id]));
      }
    } catch (e) {
      if (tab?.location.href === "about:blank") tab.close();
      if (generation === this.generation) this.imageError.set(apiError(e));
    } finally {
      if (generation === this.generation) this.opening.set(false);
    }
  }
  closeImage() {
    if (this.image()) URL.revokeObjectURL(this.image());
    this.image.set("");
  }
  ngOnDestroy() { this.generation++; this.closeImage(); }
}

@Component({
  standalone: true,
  imports: [RouterLink, ReactiveFormsModule, IonButton, IonSpinner, PageHeader, FeedbackState],
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
            >Número da nota<input formControlName="invoice_number" [readonly]="reading()" (input)="numberEdited()" inputmode="numeric" autocomplete="off" /><span class="field-help">Informe o número da NF-e com 1 a 9 dígitos. Zeros à esquerda são permitidos; não informe a chave de 44 dígitos.</span></label>
          <label class="checkbox wide"><input type="checkbox" formControlName="number_confirmed" />Conferi o número da nota na imagem.</label>
          @if(suggestion()){<p class="field-help wide">Número sugerido pela leitura: {{suggestion()}}. Se a nota imprimir zeros à esquerda, inclua-os neste campo antes de enviar.</p>}
          @if(form.controls.invoice_number.touched && form.controls.invoice_number.invalid){<p class="error wide">Use apenas o número da NF-e, de 1 a 9 dígitos. Zeros à esquerda são permitidos.</p>}
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
  </div>`,
  styles: [
    `
      .field-label { display: block; margin-bottom: 8px; }
      .note-preview { display: block; margin-top: 12px; max-width: 100%; max-height: 280px; border-radius: 12px; }
    `,
  ],
})
export class GateDesk {
  private api = inject(Api);
  private live = inject(GateLive);
  private fb = inject(FormBuilder);
  busy = signal(false);
  reading = signal(false);
  error = signal("");
  notice = signal("");
  preview = signal("");
  file: File | null = null;
  suggestion=signal('');private fileGeneration=0;
  form = this.fb.nonNullable.group({
    vehicle_plate: ["", Validators.required],
    tractor_plate: ["", Validators.required],
    driver_name: ["", [Validators.required, Validators.minLength(3)]],
    invoice_number: ["", [Validators.required, Validators.pattern(/^(?!0+$)[0-9]{1,9}$/)]],
    number_confirmed: [false, Validators.requiredTrue],
  });
  constructor() {
    effect(() => {
      const message = this.live.last();
      if (!message || message.event === "created") return;
      untracked(() => {
        const driver = message.arrival.driver_name;
        this.notice.set(
          message.event === "authorized"
            ? `${driver} pode passar.`
            : `Chegada de ${driver} recusada. O processo foi encaminhado para Compras.`,
        );
      });
    });
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
      body.append("invoice_number", gateInvoiceNumber(value.invoice_number));
      await this.api.post("gate-arrivals/", body);
      this.notice.set("Chegada informada ao armazém.");
      this.form.reset();this.suggestion.set('');
      this.file = null;
      if (this.preview()) URL.revokeObjectURL(this.preview());
      this.preview.set("");
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
  numberEdited(){this.form.controls.number_confirmed.setValue(false);}
  enterManually(){this.fileGeneration++;this.reading.set(false);this.suggestion.set('');this.form.controls.number_confirmed.setValue(false);this.notice.set('Informe o número impresso na nota e confirme a conferência da imagem.');}
  ngOnDestroy(){this.fileGeneration++;if(this.preview())URL.revokeObjectURL(this.preview());}

}

@Component({
  standalone: true,
  imports: [RouterLink, IonButton, PageHeader, FeedbackState, ArrivalList],
  template: `<div class="page">
    <app-page-header title="Chegadas na portaria" [subtitle]="api.can('warehouse') ? 'Aceite libera a entrada na portaria. A recusa segue para Compras. Abrir a foto marca o aviso como visto.' : 'Consulta de todos os avisos de chegada. A abertura da foto não altera a ciência do Armazém.'"><ion-button fill="outline" [disabled]="busy()" (click)="load()">Atualizar avisos</ion-button></app-page-header>
    <p class="notice">Um aviso com foto não cria agendamento nem registra entrada ou saída automaticamente. <a routerLink="/operacao">Consultar recebimentos</a></p>
    @if (error()) {
      <div app-feedback tone="error" class="error">{{ error() }}</div>
    }
    @if (!rows().length && !error()) {
      <p class="notice">Nenhuma chegada informada.</p>
    }
    <section class="panel">
      <app-arrival-list [rows]="rows()" board="warehouse" (updated)="replace($event)" />
      <div class="pagination"><ion-button fill="outline" [disabled]="busy()||page===1" (click)="load(page-1)">Anterior</ion-button><span>Página {{page}} · {{count()}} avisos</span><ion-button fill="outline" [disabled]="busy()||!hasNext()" (click)="load(page+1)">Próxima</ion-button></div>
    </section>
  </div>`,
})
export class ArrivalInbox implements OnInit {
  api = inject(Api);
  private live = inject(GateLive);
  rows = signal<Arrival[]>([]);
  error = signal("");
  busy=signal(false);page=1;count=signal(0);hasNext=signal(false);
  constructor() {
    effect(() => {
      if (this.live.refreshed()) untracked(() => void this.load());
    });
    effect(() => {
      const message = this.live.last();
      if (!message) return;
      untracked(() => this.rows.update((rows) => applyArrival(rows, message, "warehouse")));
    });
  }
  ngOnInit() {
    void this.load();
  }
  replace(arrival: Arrival) {
    this.rows.update((rows) => applyArrival(rows, { event: arrival.decision === "pending" ? "created" : arrival.decision, arrival }, "warehouse"));
  }
  async load(page=this.page){this.busy.set(true);this.error.set('');try{const result=await this.api.get<Page<Arrival>>(`gate-arrivals/?page=${page}`);this.page=page;this.rows.set(result.results);this.count.set(result.count);this.hasNext.set(!!result.next);}catch(e){this.error.set(apiError(e));}finally{this.busy.set(false);}}
}

@Component({
  standalone: true,
  imports: [IonButton, PageHeader, FeedbackState, ArrivalList],
  template: `<div class="page">
    <app-page-header title="Revisão de chegadas" subtitle="Chegadas recusadas na portaria, encaminhadas para Compras."><ion-button fill="outline" [disabled]="busy()" (click)="load()">Atualizar revisões</ion-button></app-page-header>
    @if (error()) {
      <div app-feedback tone="error" class="error">{{ error() }}</div>
    }
    @if (notice()) {
      <p class="notice">{{ notice() }}</p>
    }
    @if (!rows().length && !error()) {
      <p class="notice">Nenhuma chegada recusada.</p>
    }
    <section class="panel">
      <app-arrival-list [rows]="rows()" board="review" />
      <div class="pagination"><ion-button fill="outline" [disabled]="busy()||page===1" (click)="load(page-1)">Anterior</ion-button><span>Página {{page}} · {{count()}} revisões</span><ion-button fill="outline" [disabled]="busy()||!hasNext()" (click)="load(page+1)">Próxima</ion-button></div>
    </section>
  </div>`,
})
export class ArrivalReview implements OnInit {
  private api = inject(Api);
  private live = inject(GateLive);
  rows = signal<Arrival[]>([]);
  error = signal("");
  notice = signal("");
  busy=signal(false);page=1;count=signal(0);hasNext=signal(false);
  constructor() {
    effect(() => {
      if (this.live.refreshed()) untracked(() => void this.load());
    });
    effect(() => {
      const message = this.live.last();
      if (!message || message.event !== "rejected") return;
      untracked(() => {
        this.rows.update((rows) => applyArrival(rows, message, "review"));
        this.notice.set(`Chegada de ${message.arrival.driver_name} recusada na portaria. Revise o processo.`);
      });
    });
  }
  ngOnInit() {
    void this.load();
  }
  async load(page=this.page){this.busy.set(true);this.error.set('');try{const result=await this.api.get<Page<Arrival>>(`gate-arrivals/?decision=rejected&page=${page}`);this.page=page;this.rows.set(result.results);this.count.set(result.count);this.hasNext.set(!!result.next);}catch(e){this.error.set(apiError(e));}finally{this.busy.set(false);}}
}

@Component({
  standalone: true,
  imports: [IonButton, PageHeader, FeedbackState, ArrivalList],
  template: `<div class="page">
    <app-page-header [title]="api.user()?.role === 'management' ? 'Avisos de chegada' : 'Chegadas enviadas'" [subtitle]="api.user()?.role === 'management' ? 'Consulta dos avisos de todos os operadores da Portaria.' : 'Avisos com foto enviados por você. O filtro inicial mostra só o que ainda aguarda o armazém.'"><ion-button fill="outline" [disabled]="busy()" (click)="load()">Atualizar</ion-button></app-page-header>
    <div class="actions">
      @for (option of filters; track option.value) {
        <ion-button size="small" [fill]="filter() === option.value ? 'solid' : 'outline'" (click)="choose(option.value)">{{ option.label }}</ion-button>
      }
    </div>
    @if (error()) {
      <div app-feedback tone="error" class="error">{{ error() }}</div>
    }
    @if (notice()) {
      <p class="notice">{{ notice() }}</p>
    }
    @if (!rows().length && !error()) {
      <p class="notice">{{ emptyLabel() }}</p>
    }
    <section class="panel">
      <app-arrival-list [rows]="rows()" board="portaria" />
      <div class="pagination"><ion-button fill="outline" [disabled]="busy()||page===1" (click)="load(page-1)">Anterior</ion-button><span>Página {{page}} · {{count()}} chegadas</span><ion-button fill="outline" [disabled]="busy()||!hasNext()" (click)="load(page+1)">Próxima</ion-button></div>
    </section>
  </div>`,
})
export class SentArrivals implements OnInit {
  api = inject(Api);
  private live = inject(GateLive);
  readonly filters = [
    { value: "pending" as const, label: "Aguardando" },
    { value: "authorized" as const, label: "Pode passar" },
    { value: "rejected" as const, label: "Recusada" },
    { value: "" as const, label: "Todas" },
  ];
  filter = signal<"pending" | "authorized" | "rejected" | "">("pending");
  rows = signal<Arrival[]>([]);
  error = signal("");
  notice = signal("");
  busy = signal(false);
  page = 1;
  count = signal(0);
  hasNext = signal(false);
  constructor() {
    effect(() => {
      if (this.live.refreshed()) untracked(() => void this.load());
    });
    effect(() => {
      const message = this.live.last();
      if (!message || message.event === "created") return;
      untracked(() => {
        const driver = message.arrival.driver_name;
        this.notice.set(
          message.event === "authorized"
            ? `${driver} pode passar.`
            : `Chegada de ${driver} recusada. O processo foi encaminhado para Compras.`,
        );
        void this.load(this.page);
      });
    });
  }
  ngOnInit() {
    void this.load();
  }
  choose(value: "pending" | "authorized" | "rejected" | "") {
    this.filter.set(value);
    this.notice.set("");
    void this.load(1);
  }
  emptyLabel() {
    if (this.filter() === "pending") return "Nenhuma chegada aguardando.";
    if (this.filter() === "authorized") return "Nenhuma chegada liberada.";
    if (this.filter() === "rejected") return "Nenhuma chegada recusada.";
    return "Nenhuma chegada enviada.";
  }
  async load(page = this.page) {
    this.busy.set(true);
    this.error.set("");
    try {
      const decision = this.filter();
      const query = decision ? `&decision=${decision}` : "";
      const result = await this.api.get<Page<Arrival>>(`gate-arrivals/?page=${page}${query}`);
      this.page = page;
      this.rows.set(result.results);
      this.count.set(result.count);
      this.hasNext.set(!!result.next);
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
}
