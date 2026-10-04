import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { Api, apiError, dateTime, Page, today } from "../core/api";
import { Catalog } from "../core/catalog";
import { FeedbackState, PageHeader } from "../shared/ui";
import { ReceiptSignatures } from "../shared/receipt-signatures";
import { operationLabel } from "../core/presentation";
import { originLabel } from "../core/api";

interface Capability { available: boolean; reason: string; }
interface Readiness { warehouse: string; warehouse_name: string; ready: boolean | null; notes: string; revision: number; updated_at: string; }
interface ReceiptSummary { id: string; supplier_name: string; vehicle_plate: string; revision: number; operation_status: string; workflow_version: number; }
interface AssistantAnswer { answer: string; references: string[]; context: { period: { date_from: string; date_to: string }; origin: string }; }
interface WeatherData { forecast: { hourly?: { time: string[]; temperature_2m: number[]; precipitation_probability: number[] } }; }

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, FeedbackState, PageHeader, ReceiptSignatures],
  template: `
    <div class="page">
      <app-page-header title="Apoio à operação" subtitle="Prontidão, conferência e consultas com fonte identificada." />
      @if (error()) { <div app-feedback tone="error">{{error()}}</div> }
      @if (message()) { <div app-feedback tone="success">{{message()}}</div> }

      <details class="panel"><summary>Como usar estes recursos</summary>
        <p>Antes da chegada, confira agenda e documentos. Portaria registra entrada e saída da unidade; Armazém registra cada visita e a conferência dos itens. Compras decide divergências.</p>
        <p>Registre onde cada pessoa trabalhou e escolha um único boletim responsável por dia. O extrato apurado e o histórico de RH ficam em consultas separadas.</p>
        <p>Prontidão é um apontamento manual. Previsão do tempo e assistente ajudam a consultar informações; decisões e alterações continuam nas telas da operação.</p>
      </details>

      <section class="panel"><h2>Prontidão dos armazéns</h2>
        <p class="muted">Sem apontamento, a prontidão permanece desconhecida.</p>
        <div class="table-wrap"><table><thead><tr><th>Armazém</th><th>Prontidão</th><th>Observação</th><th>Atualização</th></tr></thead><tbody>
          @for (warehouse of catalog.warehouses(); track warehouse.id) {
            <tr><td>{{warehouse.name}}</td><td>{{readinessFor(warehouse.id)?.ready === true ? 'Pronto' : readinessFor(warehouse.id)?.ready === false ? 'Aguardando preparação' : 'Desconhecida'}}</td><td>{{readinessFor(warehouse.id)?.notes || '—'}}</td><td>{{readinessFor(warehouse.id) ? dateTime(readinessFor(warehouse.id)!.updated_at) : '—'}}</td></tr>
          }
        </tbody></table></div>
        @if (api.can('warehouse')) {
          <form (ngSubmit)="saveReadiness()" class="form-grid section">
            <label>Armazém<select name="readinessWarehouse" [(ngModel)]="readinessWarehouse" required><option value="">Selecione</option>@for (warehouse of catalog.warehouses(); track warehouse.id) {<option [value]="warehouse.id">{{warehouse.name}}</option>}</select></label>
            <label>Condição<select name="ready" [(ngModel)]="ready"><option value="unknown">Desconhecida</option><option value="yes">Pronto</option><option value="no">Aguardando preparação</option></select></label>
            <label class="wide">Observação<input name="readinessNotes" [(ngModel)]="readinessNotes" maxlength="2000" /></label>
            <button type="submit" [disabled]="busy() || !readinessWarehouse">Registrar prontidão</button>
          </form>
        }
      </section>

      @if (api.can('management')) {
        <section class="panel"><h2>Assistente de consulta</h2><p class="muted">Consulta indicadores do período. Não altera agenda, boletins ou pagamentos.</p>
          @if (!available('assistant')) {<p class="notice">{{unavailable('assistant')}}</p>}
          <form (ngSubmit)="ask()" class="form-grid">
            <label>Início<input type="date" name="from" [(ngModel)]="from" required /></label><label>Fim<input type="date" name="to" [(ngModel)]="to" required /></label>
            <label>Origem<select name="origin" [(ngModel)]="origin"><option value="operacional_registrado">Operação registrada</option><option value="demo_sintetico">Demonstração sintética</option><option value="historico_importado">Histórico importado</option></select></label>
            <label class="wide">Pergunta<textarea name="question" [(ngModel)]="question" maxlength="2000" required></textarea></label>
            <button type="submit" [disabled]="busy() || !available('assistant') || !question.trim()">Consultar indicadores</button>
          </form>
          @if (answer(); as result) {<div class="section"><p style="white-space:pre-wrap">{{result.answer}}</p><p class="field-help">{{result.context.period.date_from}} a {{result.context.period.date_to}} · {{originLabel(result.context.origin)}}</p><p>Referências da consulta:</p><ul>@for(reference of result.references;track reference){<li>{{reference}}</li>}</ul><a routerLink="/gestao">Conferir indicadores e fontes no painel</a></div>}
        </section>
      }

      @if (api.can('warehouse', 'purchasing')) {
        <section class="panel"><h2>Leitura assistida de documento</h2><p>PDF ou imagem de até 10 MB. Confira a sugestão antes de preencher a nota; o arquivo original é preservado.</p>
          @if (!available('ocr')) {<p class="notice">{{unavailable('ocr')}}</p>}
          <label>Documento<input type="file" accept=".pdf,.png,.jpg,.jpeg" (change)="chooseFile($event)" [disabled]="!available('ocr') || busy()" /></label>
          <button type="button" class="section" (click)="extract()" [disabled]="busy() || !available('ocr') || !file">Sugerir preenchimento</button>
          @if (suggestion()) {<div class="section"><p style="white-space:pre-wrap">{{suggestion()}}</p><p class="notice">Sugestão pendente de conferência. Nenhuma NF foi alterada.</p><button type="button" (click)="downloadOriginal()">Consultar original</button></div>}
        </section>
      }

      @if (api.can('warehouse')) {
        <section class="panel"><h2>Assinatura de conferência</h2><p>Registra quem conferiu a versão concluída do recebimento e suas notas.</p>
          <form (ngSubmit)="sign()" class="form-grid">
            <label>Recebimento concluído<select name="receipt" [(ngModel)]="receiptId" required><option value="">Selecione</option>@for (receipt of receipts(); track receipt.id) {<option [value]="receipt.id">{{receipt.supplier_name}} · {{receipt.vehicle_plate}}</option>}</select></label>
            <label>Nome de quem confere<input name="signer" [(ngModel)]="signerName" required maxlength="160" /></label>
            <label class="wide">Declaração de conferência<textarea name="declaration" [(ngModel)]="declaration" required maxlength="3000"></textarea></label>
            <button type="submit" [disabled]="busy() || !receiptId || !signerName.trim() || !declaration.trim()">Registrar assinatura nesta versão</button>
          </form><p class="field-help">Registro de conferência; não garante substituição de documentos exigidos.</p>
          @if(receiptId){<app-receipt-signatures [receipt]="receiptId" [refresh]="signatureRefresh()" />}
        </section>
      }

      <section class="panel"><h2>Histórico do fornecedor</h2>
        <form (ngSubmit)="loadHistory()" class="form-grid"><label>Fornecedor<select name="historySupplier" [(ngModel)]="historySupplier" required><option value="">Selecione</option>@for (supplier of catalog.suppliers(); track supplier.id) {<option [value]="supplier.id">{{supplier.name}}</option>}</select></label>
          <label>De<input name="historyFrom" type="date" [(ngModel)]="historyFrom" required /></label><label>Até<input name="historyTo" type="date" [(ngModel)]="historyTo" required /></label>
          <label>Origem<select name="historyOrigin" [(ngModel)]="historyOrigin"><option value="operacional_registrado">Operação registrada</option><option value="demo_sintetico">Demonstração sintética</option><option value="historico_importado">Histórico importado</option></select></label><button type="submit" [disabled]="busy() || !historySupplier">Consultar relacionamento</button>
        </form>
        @if (history(); as result) {<p>{{result.count}} recebimento(s) no período. Abra um recebimento para consultar ocorrências e decisões.</p>@for (receipt of result.results; track receipt.id) {<p><a [routerLink]="['/agenda',receipt.id]">{{receipt.vehicle_plate || 'Sem placa'}} · {{operationLabel(receipt.operation_status)}}</a></p>}@if(result.next){<p class="field-help">Exibidos os primeiros {{result.results.length}} registros. Reduza o período para detalhar.</p>}}
      </section>

      <section class="panel"><h2>Previsão informativa</h2>
        @if (!available('weather')) {<p class="notice">{{unavailable('weather')}}</p>}
        <button type="button" (click)="loadWeather()" [disabled]="busy() || !available('weather')">Consultar previsão</button>
        @if (weather()?.forecast?.hourly; as hourly) {<div class="table-wrap section"><table><thead><tr><th>Horário</th><th>Temperatura</th><th>Probabilidade de chuva</th></tr></thead><tbody>@for (time of hourly.time.slice(0,24); track time; let index=$index) {<tr><td>{{dateTime(time)}}</td><td>{{hourly.temperature_2m[index]}} °C</td><td>{{hourly.precipitation_probability[index]}}%</td></tr>}</tbody></table></div><p class="field-help">Fonte: Open-Meteo. A previsão não bloqueia a agenda.</p>}
      </section>
      <section class="panel"><h2>Envios e sincronização</h2><p>Os serviços abaixo dependem da configuração de destinatários e contas no servidor.</p><ul>@for (channel of outbound; track channel.key) {<li>{{channel.name}} — {{available(channel.key) ? 'Configurado para processamento pelo servidor' : unavailable(channel.key)}}</li>}</ul><p class="field-help">Google Agenda recebe alterações do aplicativo. A capacidade continua sendo definida aqui.</p></section>
    </div>
  `,
})
export class IntegrationsPage implements OnInit {
  readonly api = inject(Api);
  readonly catalog = inject(Catalog);
  readonly dateTime = dateTime;
  readonly operationLabel = operationLabel;
  readonly originLabel = originLabel;
  readonly signatureRefresh = signal(0);
  readonly capabilities = signal<Record<string, Capability>>({});
  readonly readiness = signal<Readiness[]>([]);
  readonly receipts = signal<ReceiptSummary[]>([]);
  readonly answer = signal<AssistantAnswer | null>(null);
  readonly history = signal<Page<ReceiptSummary> | null>(null);
  readonly weather = signal<WeatherData | null>(null);
  readonly suggestion = signal("");
  readonly busy = signal(false);
  readonly error = signal("");
  readonly message = signal("");
  readonly outbound = [{key: "email", name: "Email"}, {key: "google_calendar", name: "Google Agenda"}, {key: "whatsapp", name: "WhatsApp oficial"}];
  readinessWarehouse = ""; ready = "unknown"; readinessNotes = "";
  from = today(); to = today(); origin = "operacional_registrado"; question = "";
  historySupplier = ""; historyFrom = today(); historyTo = today(); historyOrigin = "operacional_registrado";
  receiptId = ""; signerName = ""; declaration = ""; file: File | null = null;
  private originalPath = "";

  async ngOnInit() {
    await this.perform(async () => {
      const capabilities = await this.api.get<{capabilities: Record<string, Capability>}>("integrations/capabilities/");
      this.capabilities.set(capabilities.capabilities);
      await this.catalog.load();
      await this.refreshReadiness();
      if (this.api.can("warehouse")) {
        const completed: ReceiptSummary[] = [];
        let page = 1;
        while (true) {
          const response = await this.api.get<Page<ReceiptSummary>>(`appointments/?operation_status=completed&page=${page}`);
          completed.push(...response.results.filter(receipt => receipt.operation_status === "completed" && receipt.workflow_version >= 2));
          if (!response.next) break;
          page++;
        }
        this.receipts.set(completed);
      }
    });
  }
  available(channel: string) { return this.capabilities()[channel]?.available ?? false; }
  unavailable(channel: string) { return this.capabilities()[channel]?.reason || "Consultando configuração…"; }
  readinessFor(id: string) { return this.readiness().find(item => item.warehouse === id); }
  private async perform(work: () => Promise<void>) {
    if (this.busy()) return;
    this.busy.set(true); this.error.set(""); this.message.set("");
    try { await work(); } catch (error) { this.error.set(apiError(error)); } finally { this.busy.set(false); }
  }
  private async refreshReadiness() {
    this.readiness.set((await this.api.get<{results: Readiness[]}>("warehouse-readiness/")).results);
  }
  async saveReadiness() {
    await this.perform(async () => {
      await this.api.post("warehouse-readiness/", {warehouse: this.readinessWarehouse, ready: this.ready === "unknown" ? null : this.ready === "yes", notes: this.readinessNotes, revision: this.readinessFor(this.readinessWarehouse)?.revision ?? 0});
      await this.refreshReadiness(); this.message.set("Prontidão registrada.");
    });
  }
  async ask() {
    this.answer.set(null);
    await this.perform(async () => { this.answer.set(await this.api.post<AssistantAnswer>("integrations/assistant/", {date_from: this.from, date_to: this.to, origin: this.origin, question: this.question})); });
  }
  chooseFile(event: Event) { this.file = (event.target as HTMLInputElement).files?.[0] ?? null; this.suggestion.set(""); this.originalPath = ""; }
  async extract() {
    await this.perform(async () => {
      if (!this.file) throw new Error("Selecione um documento.");
      const data = new FormData(); data.append("file", this.file);
      const result = await this.api.post<{suggestion: string; original_url: string}>("integrations/ocr/", data);
      this.suggestion.set(result.suggestion); this.originalPath = result.original_url.replace(/^\/api\/v2\//, "");
    });
  }
  async downloadOriginal() { await this.perform(async () => { if (this.originalPath) await this.api.download(this.originalPath, this.file?.name || "documento"); }); }
  async sign() {
    await this.perform(async () => {
      const receipt = this.receipts().find(item => item.id === this.receiptId);
      if (!receipt) throw new Error("Selecione o recebimento que foi conferido.");
      await this.api.post(`appointments/${receipt.id}/signatures/`, {expected_revision: receipt.revision, signer_name: this.signerName, declaration: this.declaration});
      this.message.set("Assinatura de conferência registrada nesta versão.");
      this.signatureRefresh.update(value => value + 1);
    });
  }
  async loadHistory() {
    this.history.set(null);
    await this.perform(async () => { this.history.set(await this.api.get<Page<ReceiptSummary>>(`suppliers/${this.historySupplier}/history/?${new URLSearchParams({date_from: this.historyFrom, date_to: this.historyTo, origin: this.historyOrigin})}`)); });
  }
  async loadWeather() { this.weather.set(null); await this.perform(async () => { this.weather.set(await this.api.get<WeatherData>("integrations/weather/")); }); }
}
