import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal, viewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { IonButton } from "@ionic/angular/standalone";
import { Api, apiError } from "../core/api";
import { Catalog, CatalogEntry } from "../core/catalog";
import { ActiveFilter, CONTRACT_LABELS, filterWorkers } from "../core/registry";
import { EmptyState, FeedbackState, LoadingState, PageHeader } from "../shared/ui";
import { WorkerForm } from "./worker-form";

/** Cadastro de pessoas: a lista abre direto; o nome leva à apuração individual. */
@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, IonButton, EmptyState, FeedbackState, LoadingState, PageHeader, WorkerForm],
  template: `<div class="page">
  <app-page-header title="Pessoas" subtitle="Chapas e equipe do armazém. Abra uma pessoa para ver presença, atividades e apuração.">
    @if (canEdit) { <ion-button (click)="form().open()">+ Nova pessoa</ion-button> }
  </app-page-header>
  @if (error()) { <div app-feedback tone="error">{{ error() }}</div> }
  @if (success()) { <div app-feedback tone="success">{{ success() }}</div> }
  <div class="registry-bar">
    <label class="registry-search">Buscar<input type="search" placeholder="Nome ou matrícula" [ngModel]="query()" (ngModelChange)="query.set($event)" /></label>
    <label>Vínculo<select [ngModel]="contract()" (ngModelChange)="contract.set($event)"><option value="">Todos</option>@for (option of contracts; track option[0]) { <option [value]="option[0]">{{ option[1] }}</option> }</select></label>
    <div class="segmented" role="group" aria-label="Situação">@for (option of situations; track option[0]) {
      <button type="button" [attr.aria-pressed]="active() === option[0]" (click)="active.set(option[0])">{{ option[1] }}</button> }</div>
  </div>
  @if (loading()) { <app-loading-state label="Carregando pessoas…" /> }
  @else if (people().length) {
    <p class="registry-count" aria-live="polite">{{ people().length }} {{ people().length === 1 ? "pessoa" : "pessoas" }}</p>
    <ul class="registry-list">
      @for (person of people(); track person.id) {
        <li class="registry-row" [class.is-inactive]="person.is_active === false">
          <a class="registry-name" [routerLink]="['/pessoas', person.id]"><strong>{{ person.name }}</strong><small>Matrícula {{ person.registration }}</small></a>
          <span class="registry-tags">
            @if (person.contract_type === "TERCEIRIZADO") { <span class="registry-tag warning">Terceirizado</span> } @else { <span class="registry-tag">Contrato anual</span> }
            @if (person.origin === "demo_sintetico") { <span class="registry-tag info">Demonstração</span> }
            @if (person.is_active === false) { <span class="registry-tag">Inativa</span> }
          </span>
          @if (canEdit) { <button type="button" class="link-button" [attr.aria-label]="'Editar ' + person.name" (click)="form().open(person)">Editar</button> }
        </li>
      }
    </ul>
  } @else if (catalog.workers().length) {
    <div app-empty-state><p>Nenhuma pessoa encontrada com esses filtros.</p><ion-button fill="outline" (click)="clear()">Limpar filtros</ion-button></div>
  } @else {
    <div app-empty-state><h2>Ninguém cadastrado ainda</h2><p>Cadastre os chapas para montar a escala e a equipe das descargas.</p>
      @if (canEdit) { <ion-button (click)="form().open()">+ Nova pessoa</ion-button> }</div>
  }
  <app-worker-form (saved)="saved($event)" />
</div>`,
})
export class PeopleList implements OnInit {
  catalog = inject(Catalog);
  canEdit = inject(Api).can("warehouse");
  form = viewChild.required(WorkerForm);
  contracts = Object.entries(CONTRACT_LABELS);
  situations: [ActiveFilter, string][] = [["active", "Ativas"], ["inactive", "Inativas"], ["all", "Todas"]];
  query = signal("");
  contract = signal("");
  active = signal<ActiveFilter>("active");
  loading = signal(true);
  error = signal("");
  success = signal("");
  people = computed(() => filterWorkers(this.catalog.workers(), this.query(), this.active(), this.contract()));

  async ngOnInit() {
    try { await this.catalog.load(); } catch (e) { this.error.set(apiError(e)); } finally { this.loading.set(false); }
  }
  clear() { this.query.set(""); this.contract.set(""); this.active.set("all"); }
  saved(worker: CatalogEntry) { this.success.set(`Cadastro de ${worker.name} salvo.`); }
}
