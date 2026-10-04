import { Component, effect, ElementRef, inject, input, OnInit, output, signal, untracked, viewChild } from "@angular/core";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { IonButton, IonModal, IonSpinner } from "@ionic/angular/standalone";
import { Capacitor } from "@capacitor/core";
import { Api, apiError, dateTime, Page } from "../core/api";
import { Arrival, GateLive, GateMessage } from "../core/gate-live";
import { InvoiceReader } from "../core/invoice-reader";
import { InvoiceReadSession } from "./invoice-reading";
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
            <span class="hold">Recusa registrada pelo Armazém. Compras pode consultar a nota.</span>
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
  template: `<div class="page form-page invoice-form gate-form">
    <app-page-header title="Aviso de chegada com foto"><a routerLink="/portaria">Recebimentos da Portaria</a></app-page-header>
    <p class="field-help form-context">O aviso informa a chegada ao armazém. Entrada e saída são registradas no recebimento.</p>
    @if (error()) {
      <div app-feedback tone="error" class="error">{{ error() }}</div>
    }
    @if (notice()) {
      <div app-feedback tone="success" class="notice">{{ notice() }}</div>
    }
    <form [formGroup]="form" (ngSubmit)="save()">
      <fieldset [disabled]="busy()">
      <section class="panel">
        <h2>Chegada</h2>
        <p class="field-help form-instructions">Todos os campos e a foto são obrigatórios.</p>
        <div class="form-grid">
          <div class="form-field"><label for="arrival-plate">Placa do veículo</label><input id="arrival-plate" formControlName="vehicle_plate" required autocomplete="off" [attr.aria-invalid]="form.controls.vehicle_plate.touched && form.controls.vehicle_plate.invalid" aria-describedby="arrival-plate-error" /><span id="arrival-plate-error" class="field-help field-error">@if(form.controls.vehicle_plate.touched && form.controls.vehicle_plate.invalid){Informe a placa do veículo.}</span></div>
          <div class="form-field"><label for="arrival-tractor">Placa do cavalo</label><input id="arrival-tractor" formControlName="tractor_plate" required autocomplete="off" [attr.aria-invalid]="form.controls.tractor_plate.touched && form.controls.tractor_plate.invalid" aria-describedby="arrival-tractor-error" /><span id="arrival-tractor-error" class="field-help field-error">@if(form.controls.tractor_plate.touched && form.controls.tractor_plate.invalid){Informe a placa do cavalo.}</span></div>
          <div class="form-field wide"><label for="arrival-driver">Motorista</label><input id="arrival-driver" formControlName="driver_name" required autocomplete="name" [attr.aria-invalid]="form.controls.driver_name.touched && form.controls.driver_name.invalid" aria-describedby="arrival-driver-error" /><span id="arrival-driver-error" class="field-help field-error">@if(form.controls.driver_name.touched && form.controls.driver_name.invalid){Informe o nome do motorista com pelo menos 3 caracteres.}</span></div>
        </div>
        <div class="document-review">
          <div class="document-source">
            <h3>Foto da nota fiscal</h3>
            <div class="actions">
              <ion-button type="button" fill="outline" [disabled]="busy()" (click)="cameraPick.click()">Tirar foto</ion-button>
              <ion-button type="button" fill="outline" [disabled]="busy()" (click)="filePick.click()">Escolher imagem</ion-button>
            </div>
            <input #cameraPick hidden type="file" accept="image/*" capture="environment" (change)="onFile($event)" />
            <input #filePick hidden type="file" accept="image/*" (change)="onFile($event)" />
            <p class="field-help">Imagem de até 10 MB.</p>
            @if (preview()) {
              <figure class="document-preview"><img [src]="preview()" alt="Foto da nota fiscal anexada para conferência" /><figcaption>{{ file?.name }}</figcaption></figure>
              <button class="remove" type="button" [disabled]="busy()" (click)="removePhoto()">Remover foto</button>
            }
          </div>
          <div class="document-fields">
            <h3>Conferência da nota</h3>
            <div class="reading-state" role="status" aria-live="polite" aria-atomic="true">
              @if(reading()){<p>Lendo o número na foto…</p>}
              @else if(suggestion()){<p>Número sugerido. Confira todos os dígitos na foto.</p>}
              @else if(readingNotice()){<p>{{ readingNotice() }}</p>}
              @else if(!file){<p>Anexe a foto para conferir a nota.</p>}
            </div>
            <div role="alert" class="field-help field-error reading-error">{{ readingError() }}</div>
            @if(reading()){<ion-button type="button" fill="outline" (click)="enterManually()">Informar número manualmente</ion-button>}
            <div class="form-field">
              <label for="arrival-number">Número da NF-e</label>
              <input #invoiceNumber id="arrival-number" formControlName="invoice_number" required [readonly]="reading()" (input)="numberEdited()" inputmode="numeric" autocomplete="off" [attr.aria-invalid]="form.controls.invoice_number.touched && form.controls.invoice_number.invalid" aria-describedby="arrival-number-help arrival-number-error" />
              <span id="arrival-number-help" class="field-help">De 1 a 9 dígitos, incluindo zeros à esquerda. Não use a chave de acesso.</span>
              <span id="arrival-number-error" class="field-help field-error">@if(form.controls.invoice_number.touched && form.controls.invoice_number.invalid){Informe um número de 1 a 9 dígitos, diferente de zero.}</span>
            </div>
            <label class="check"><input type="checkbox" formControlName="number_confirmed" required />Conferi o número da NF-e na foto.</label>
          </div>
        </div>
      </section>
      <div class="actions">
        <ion-button type="submit" aria-describedby="arrival-submit-help" [disabled]="busy() || reading() || form.invalid || !file">
          @if (busy()) {
            <ion-spinner name="dots" />
          }
          Avisar o armazém
        </ion-button>
      </div>
      <p class="field-help submit-help" id="arrival-submit-help">{{ submitHelp() }}</p>
      </fieldset>
    </form>
  </div>`,
})
export class GateDesk {
  private api = inject(Api);
  private reader = inject(InvoiceReader);
  private readSession = new InvoiceReadSession();
  private live = inject(GateLive);
  private fb = inject(FormBuilder);
  busy = signal(false);
  reading = signal(false);
  error = signal("");
  notice = signal("");
  preview = signal("");
  readingError = signal("");
  readingNotice = signal("");
  private invoiceNumber = viewChild.required<ElementRef<HTMLInputElement>>("invoiceNumber");
  file: File | null = null;
  suggestion=signal('');
  form = this.fb.nonNullable.group({
    vehicle_plate: ["", Validators.required],
    tractor_plate: ["", Validators.required],
    driver_name: ["", [Validators.required, Validators.minLength(3)]],
    invoice_number: ["", [Validators.required, Validators.pattern(/^(?!0+$)[0-9]{1,9}$/)]],
    number_confirmed: [{value:false,disabled:true}, Validators.requiredTrue],
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
            : `Chegada de ${driver} recusada pelo Armazém. Nota disponível para consulta de Compras.`,
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
    const attempt = this.readSession.start();
    this.file = next;
    this.form.controls.invoice_number.reset();this.form.controls.number_confirmed.setValue(false);this.suggestion.set('');
    this.form.controls.number_confirmed.disable({emitEvent:false});
    this.preview.set(URL.createObjectURL(next));
    this.error.set("");
    this.notice.set("");
    this.readingError.set("");
    this.readingNotice.set("");
    this.reading.set(true);
    try {
      const code = (await this.reader.readImage(next, attempt.signal)).number;
      if(!attempt.isCurrent())return;
      if (code){this.form.controls.invoice_number.setValue(code);this.form.controls.number_confirmed.setValue(false);this.suggestion.set(code);}
      else this.readingError.set("Número não identificado. Informe o número da NF-e e confira na foto.");
    } catch (e) {
      if(attempt.isCurrent())this.readingError.set(apiError(e));
    } finally {
      if(attempt.isCurrent()){this.reading.set(false);this.form.controls.number_confirmed.enable({emitEvent:false});}
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
      this.form.controls.number_confirmed.disable({emitEvent:false});
      this.file = null;
      if (this.preview()) URL.revokeObjectURL(this.preview());
      this.preview.set("");
      this.readingError.set("");this.readingNotice.set("");
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
  numberEdited(){this.readSession.cancel();this.reading.set(false);this.suggestion.set('');this.readingError.set('');this.readingNotice.set('Confira o número digitado na foto antes de enviar.');this.form.controls.number_confirmed.setValue(false);if(this.file)this.form.controls.number_confirmed.enable({emitEvent:false});}
  enterManually(){this.numberEdited();this.invoiceNumber().nativeElement.focus();}
  removePhoto(){this.readSession.cancel();this.reading.set(false);if(this.preview())URL.revokeObjectURL(this.preview());this.preview.set('');this.file=null;this.suggestion.set('');this.readingError.set('');this.readingNotice.set('');this.form.controls.invoice_number.reset();this.form.controls.number_confirmed.setValue(false);this.form.controls.number_confirmed.disable({emitEvent:false});this.invoiceNumber().nativeElement.focus();}
  submitHelp(){if(this.reading())return 'Aguarde a leitura ou informe o número manualmente.';if(this.form.controls.vehicle_plate.invalid||this.form.controls.tractor_plate.invalid||this.form.controls.driver_name.invalid)return 'Preencha as duas placas e o nome do motorista.';if(!this.file)return 'Anexe uma foto da nota fiscal.';if(this.form.controls.invoice_number.invalid)return 'Informe um número válido da NF-e.';if(!this.form.controls.number_confirmed.value)return 'Confira o número na foto e marque a conferência.';return '';}
  ngOnDestroy(){this.readSession.cancel();if(this.preview())URL.revokeObjectURL(this.preview());}

}

type ArrivalFilter = "pending" | "authorized" | "rejected" | "";
type ArrivalBoard = "warehouse" | "portaria" | "review";
const ARRIVAL_FILTERS: ArrivalFilter[] = ["pending", "authorized", "rejected", ""];

@Component({
  standalone: true,
  imports: [RouterLink, IonButton, PageHeader, FeedbackState, ArrivalList],
  template: `<div class="page">
    <app-page-header title="Chegadas" [subtitle]="subtitle()"><ion-button fill="outline" [disabled]="busy()" (click)="load()">Atualizar</ion-button></app-page-header>
    @if (board !== "review") {
      <div class="actions">
        @for (option of filters; track option.value) {
          <ion-button size="small" [fill]="filter() === option.value ? 'solid' : 'outline'" (click)="choose(option.value)">{{ option.label }}</ion-button>
        }
      </div>
    }
    @if (board === "warehouse") {
      <p class="notice">Um aviso com foto não cria agendamento nem registra entrada ou saída automaticamente. <a routerLink="/agenda">Consultar recebimentos</a></p>
    }
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
      <app-arrival-list [rows]="rows()" [board]="board" (updated)="replace($event)" />
      <div class="pagination"><ion-button fill="outline" [disabled]="busy()||page===1" (click)="load(page-1)">Anterior</ion-button><span>Página {{page}} · {{count()}} chegadas</span><ion-button fill="outline" [disabled]="busy()||!hasNext()" (click)="load(page+1)">Próxima</ion-button></div>
    </section>
  </div>`,
})
export class Arrivals implements OnInit {
  api = inject(Api);
  private live = inject(GateLive);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  readonly filters = [
    { value: "pending" as const, label: "Aguardando" },
    { value: "authorized" as const, label: "Pode passar" },
    { value: "rejected" as const, label: "Recusada" },
    { value: "" as const, label: "Todas" },
  ];
  readonly board: ArrivalBoard = this.api.can("purchasing") && !this.api.can("warehouse", "management") ? "review" : this.api.can("gatehouse") && !this.api.can("warehouse", "management") ? "portaria" : "warehouse";
  filter = signal<ArrivalFilter>(this.initialFilter());
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
      if (!message) return;
      untracked(() => this.receive(message));
    });
  }
  ngOnInit() {
    void this.load();
  }
  subtitle() {
    if (this.board === "review") return "Recusas registradas pelo Armazém, para consulta da nota. Esta tela não altera decisões de entrada.";
    if (this.board === "portaria") return "Avisos com foto enviados por você. O filtro inicial mostra só o que ainda aguarda o armazém.";
    return this.api.can("warehouse") ? "Aceite libera a entrada na portaria. A recusa fica registrada para consulta de Compras. Abrir a foto marca o aviso como visto." : "Consulta de todos os avisos de chegada. A abertura da foto não altera a ciência do Armazém.";
  }
  emptyLabel() {
    if (this.filter() === "pending") return "Nenhuma chegada aguardando.";
    if (this.filter() === "authorized") return "Nenhuma chegada liberada.";
    if (this.filter() === "rejected") return "Nenhuma chegada recusada.";
    return "Nenhuma chegada informada.";
  }
  choose(value: ArrivalFilter) {
    this.filter.set(value);
    this.notice.set("");
    void this.router.navigate([], { relativeTo: this.route, queryParams: { decisao: value || null }, queryParamsHandling: "merge", replaceUrl: true });
    void this.load(1);
  }
  replace(arrival: Arrival) {
    this.rows.update((rows) => applyArrival(rows, { event: arrival.decision === "pending" ? "created" : arrival.decision, arrival }, "warehouse"));
  }
  private receive(message: GateMessage) {
    if (this.board === "portaria") {
      if (message.event === "created") return;
      const driver = message.arrival.driver_name;
      this.notice.set(message.event === "authorized" ? `${driver} pode passar.` : `Chegada de ${driver} recusada pelo Armazém. Nota disponível para consulta de Compras.`);
      void this.load(this.page);
      return;
    }
    if (this.board === "review") {
      if (message.event !== "rejected") return;
      this.notice.set(`Recusa de ${message.arrival.driver_name} registrada pelo Armazém. Nota disponível para consulta.`);
    }
    const filter = this.filter();
    this.rows.update((rows) => filter && message.arrival.decision !== filter && !rows.some((row) => row.id === message.arrival.id) ? rows : applyArrival(rows, message, this.board));
  }
  private initialFilter(): ArrivalFilter {
    if (this.board === "review") return "rejected";
    const requested = this.route.snapshot.queryParamMap.get("decisao");
    if (requested !== null && (ARRIVAL_FILTERS as string[]).includes(requested)) return requested as ArrivalFilter;
    return this.board === "portaria" ? "pending" : "";
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
