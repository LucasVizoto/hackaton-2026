import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, OnInit, signal, viewChild } from "@angular/core";
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from "@angular/forms";
import { IonButton } from "@ionic/angular/standalone";
import { Api, apiError } from "../core/api";
import { Catalog, CatalogEntry } from "../core/catalog";
import { ActiveFilter, EQUIPMENT_KINDS, groupEquipment, kindLabel } from "../core/registry";
import { EmptyState, FeedbackState, LoadingState, PageHeader } from "../shared/ui";

/**
 * Cadastro de equipamentos usados nas descargas. O tipo alimenta a sugestão de empilhadeiras;
 * "circula entre armazéns" decide em quais etapas o equipamento pode ser escolhido.
 */
@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ReactiveFormsModule, IonButton, EmptyState, FeedbackState, LoadingState, PageHeader],
  template: `<div class="page">
  <app-page-header title="Equipamentos" subtitle="O que pode ser escolhido na equipe de cada descarga. O uso de cada um aparece no boletim do dia.">
    @if (canEdit) { <ion-button (click)="open()">+ Novo equipamento</ion-button> }
  </app-page-header>
  @if (loadError()) { <div app-feedback tone="error">{{ loadError() }}</div> }
  @if (success()) { <div app-feedback tone="success">{{ success() }}</div> }
  <div class="registry-bar">
    <label>Armazém<select [ngModel]="warehouse()" (ngModelChange)="warehouse.set($event)"><option value="">Todos</option>@for (w of catalog.warehouses(); track w.id) { <option [value]="w.id">{{ w.name }}</option> }</select></label>
    <label>Tipo<select [ngModel]="kind()" (ngModelChange)="kind.set($event)"><option value="">Todos</option>@for (k of kinds; track k.code) { <option [value]="k.code">{{ k.label }}</option> }</select></label>
    <div class="segmented" role="group" aria-label="Situação">@for (option of situations; track option[0]) {
      <button type="button" [attr.aria-pressed]="active() === option[0]" (click)="active.set(option[0])">{{ option[1] }}</button> }</div>
  </div>
  @if (loading()) { <app-loading-state label="Carregando equipamentos…" /> }
  @else {
    @for (group of groups(); track group.key) {
      <h2 class="registry-group">{{ group.title }}</h2>
      <ul class="registry-list">
        @for (item of group.items; track item.id) {
          <li class="registry-row" [class.is-inactive]="item.is_active === false">
            <span class="registry-name"><strong>{{ item.name }}@if ((item.quantity ?? 1) > 1) { <span> × {{ item.quantity }}</span> }</strong>
              <small>{{ kindLabel(item.kind) }}@if (item.code) { · {{ item.code }} }@if (item.mobile && item.warehouse) { · base {{ warehouseName(item.warehouse) }} }</small></span>
            <span class="registry-tags">
              @if (!item.kind) { <span class="registry-tag warning">Sem tipo</span> }
              @if (item.is_active === false) { <span class="registry-tag">Inativo</span> }
            </span>
            @if (canEdit) { <button type="button" class="link-button" [attr.aria-label]="'Editar ' + item.name" (click)="open(item)">Editar</button> }
          </li>
        }
      </ul>
    } @empty {
      @if (catalog.equipment().length) {
        <div app-empty-state><p>Nenhum equipamento com esses filtros.</p><ion-button fill="outline" (click)="clear()">Limpar filtros</ion-button></div>
      } @else {
        <div app-empty-state><h2>Nenhum equipamento cadastrado</h2><p>Cadastre empilhadeiras, paleteiras e carrinhos para escolhê-los na equipe da descarga.</p>
          @if (canEdit) { <ion-button (click)="open()">+ Novo equipamento</ion-button> }</div>
      }
    }
  }

  <dialog #sheet class="sheet" aria-labelledby="equipment-form-title" (close)="error.set('')">
    <form [formGroup]="form" (ngSubmit)="save()">
      <header class="sheet-head"><h2 id="equipment-form-title">{{ id() ? "Editar equipamento" : "Novo equipamento" }}</h2>
        <button type="button" class="link-button" (click)="close()">Fechar</button></header>
      <fieldset class="sheet-body" [disabled]="busy()">
        @if (error()) { <div app-feedback tone="error">{{ error() }}</div> }
        <label>Tipo<select formControlName="kind" (change)="suggestName()"><option value="" disabled>Escolha o tipo</option>@for (k of kinds; track k.code) { <option [value]="k.code">{{ k.label }}</option> }</select></label>
        <div class="pair">
          <label>Nome<input formControlName="name" placeholder="Ex.: Empilhadeira 2" autocomplete="off" /></label>
          <label>Quantidade<input type="number" inputmode="numeric" min="1" max="99" formControlName="quantity" /></label>
        </div>
        <p class="field-help">Use quantidade para itens iguais sem identificação, como 3 paleteiras manuais.</p>
        <label>Código ou placa<input formControlName="code" autocomplete="off" /></label>
        <label>Armazém de referência<select formControlName="warehouse"><option value="">Sem armazém fixo</option>@for (w of catalog.warehouses(); track w.id) { <option [value]="w.id">{{ w.name }}</option> }</select></label>
        <label class="check"><input type="checkbox" formControlName="mobile" />Circula entre armazéns</label>
        <p class="field-help">Marcado, aparece na descarga de qualquer armazém. Desmarcado, só nas descargas do armazém de referência.</p>
        <label>Observação<textarea rows="2" formControlName="purpose"></textarea></label>
        @if (id()) {
          <div class="segmented-field" role="group" aria-label="Situação">Situação
            <div class="segmented">
              <button type="button" [attr.aria-pressed]="form.controls.is_active.value" (click)="form.controls.is_active.setValue(true)">Em uso</button>
              <button type="button" [attr.aria-pressed]="!form.controls.is_active.value" (click)="form.controls.is_active.setValue(false)">Fora de uso</button></div></div>
          <p class="field-help">Fora de uso some da equipe da descarga, mas continua nos boletins anteriores.</p>
        }
      </fieldset>
      <footer class="sheet-foot">
        <ion-button type="button" fill="outline" (click)="close()">Cancelar</ion-button>
        <ion-button type="submit" [disabled]="busy() || form.invalid">{{ busy() ? "Salvando…" : id() ? "Salvar alterações" : "Cadastrar equipamento" }}</ion-button>
      </footer>
    </form>
  </dialog>
</div>`,
})
export class EquipmentCatalog implements OnInit {
  private api = inject(Api);
  catalog = inject(Catalog);
  private fb = inject(FormBuilder);
  private sheet = viewChild.required<ElementRef<HTMLDialogElement>>("sheet");
  canEdit = this.api.can("warehouse");
  kinds = EQUIPMENT_KINDS;
  kindLabel = kindLabel;
  situations: [ActiveFilter, string][] = [["active", "Em uso"], ["inactive", "Fora de uso"], ["all", "Todos"]];
  warehouse = signal("");
  kind = signal("");
  active = signal<ActiveFilter>("active");
  loading = signal(true);
  busy = signal(false);
  loadError = signal("");
  error = signal("");
  success = signal("");
  id = signal("");
  groups = computed(() => groupEquipment(this.catalog.equipment(), this.catalog.warehouses(), { warehouse: this.warehouse(), kind: this.kind(), active: this.active() }));
  form = this.fb.nonNullable.group({
    kind: ["", Validators.required], name: ["", Validators.required], quantity: [1, [Validators.required, Validators.min(1), Validators.max(99)]],
    code: ["", Validators.required], warehouse: [""], mobile: [false], purpose: [""], is_active: [true],
  });

  async ngOnInit() {
    try { await this.catalog.load(); } catch (e) { this.loadError.set(apiError(e)); } finally { this.loading.set(false); }
  }
  warehouseName(id?: string | null) { return this.catalog.warehouses().find(w => w.id === id)?.name ?? ""; }
  clear() { this.warehouse.set(""); this.kind.set(""); this.active.set("all"); }
  open(item?: CatalogEntry) {
    this.id.set(item?.id ?? "");
    this.error.set("");
    this.success.set("");
    this.form.reset({
      kind: item?.kind ?? "", name: item?.name ?? "", quantity: item?.quantity ?? 1, code: item?.code ?? "",
      warehouse: item?.warehouse ?? "", mobile: item?.mobile ?? false, purpose: item?.purpose ?? "", is_active: item?.is_active !== false,
    });
    this.sheet().nativeElement.showModal();
  }
  close() { this.sheet().nativeElement.close(); }
  /** Nome vazio recebe o tipo como ponto de partida. */
  suggestName() {
    const name = this.form.controls.name;
    if (!name.value.trim()) name.setValue(kindLabel(this.form.controls.kind.value));
  }
  async save() {
    if (this.busy() || this.form.invalid) return;
    this.busy.set(true);
    this.error.set("");
    try {
      const value = this.form.getRawValue();
      const body = { ...value, name: value.name.trim(), code: value.code.trim(), quantity: Number(value.quantity), warehouse: value.warehouse || null };
      if (this.id()) await this.api.patch(`catalog/equipment/${this.id()}/`, body);
      else await this.api.post("catalog/equipment/", body);
      await this.catalog.load();
      this.close();
      this.success.set(`${body.name} salvo.`);
    } catch (e) { this.error.set(apiError(e)); } finally { this.busy.set(false); }
  }
}
