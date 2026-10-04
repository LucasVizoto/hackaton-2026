import { ChangeDetectionStrategy, Component, ElementRef, inject, output, signal, viewChild } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { IonButton } from "@ionic/angular/standalone";
import { Api, apiError } from "../core/api";
import { Catalog, CatalogEntry } from "../core/catalog";
import { CONTRACT_LABELS } from "../core/registry";
import { FeedbackState } from "../shared/ui";

/** Painel lateral de cadastro de pessoa: quatro campos, abre por cima da lista. */
@Component({
  selector: "app-worker-form",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, IonButton, FeedbackState],
  template: `
  <dialog #sheet class="sheet" aria-labelledby="worker-form-title" (close)="error.set('')">
    <form [formGroup]="form" (ngSubmit)="save()">
      <header class="sheet-head"><h2 id="worker-form-title">{{ id() ? "Editar pessoa" : "Nova pessoa" }}</h2>
        <button type="button" class="link-button" (click)="close()">Fechar</button></header>
      <fieldset class="sheet-body" [disabled]="busy()">
        @if (error()) { <div app-feedback tone="error">{{ error() }}</div> }
        <label>Nome completo<input formControlName="name" autocomplete="off" /></label>
        <label>Matrícula<input formControlName="registration" autocomplete="off" /></label>
        <div class="segmented-field" role="group" aria-label="Vínculo">Vínculo
          <div class="segmented">@for (option of contracts; track option[0]) {
            <button type="button" [attr.aria-pressed]="form.controls.contract_type.value === option[0]" (click)="form.controls.contract_type.setValue(option[0])">{{ option[1] }}</button> }</div></div>
        <p class="field-help">Terceirizados aparecem com etiqueta na escala.</p>
        @if (id()) {
          <div class="segmented-field" role="group" aria-label="Situação">Situação
            <div class="segmented">
              <button type="button" [attr.aria-pressed]="form.controls.is_active.value" (click)="form.controls.is_active.setValue(true)">Ativa</button>
              <button type="button" [attr.aria-pressed]="!form.controls.is_active.value" (click)="form.controls.is_active.setValue(false)">Inativa</button></div></div>
          <p class="field-help">Inativar preserva escalas, boletins e apurações anteriores e só impede novas alocações.</p>
        }
      </fieldset>
      <footer class="sheet-foot">
        <ion-button type="button" fill="outline" (click)="close()">Cancelar</ion-button>
        <ion-button type="submit" [disabled]="busy() || form.invalid">{{ busy() ? "Salvando…" : id() ? "Salvar alterações" : "Cadastrar pessoa" }}</ion-button>
      </footer>
    </form>
  </dialog>`,
})
export class WorkerForm {
  private api = inject(Api);
  private catalog = inject(Catalog);
  private fb = inject(FormBuilder);
  private sheet = viewChild.required<ElementRef<HTMLDialogElement>>("sheet");
  saved = output<CatalogEntry>();
  contracts = Object.entries(CONTRACT_LABELS);
  id = signal("");
  busy = signal(false);
  error = signal("");
  form = this.fb.nonNullable.group({ name: ["", Validators.required], registration: ["", Validators.required], contract_type: ["EFETIVO"], is_active: [true] });

  open(worker?: CatalogEntry) {
    this.id.set(worker?.id ?? "");
    this.error.set("");
    this.form.reset({ name: worker?.name ?? "", registration: worker?.registration ?? "", contract_type: worker?.contract_type || "EFETIVO", is_active: worker?.is_active !== false });
    this.sheet().nativeElement.showModal();
  }
  close() { this.sheet().nativeElement.close(); }
  async save() {
    if (this.busy() || this.form.invalid) return;
    this.busy.set(true);
    this.error.set("");
    try {
      const value = { ...this.form.getRawValue(), name: this.form.controls.name.value.trim(), registration: this.form.controls.registration.value.trim() };
      const worker = this.id()
        ? await this.api.patch<CatalogEntry>(`catalog/workers/${this.id()}/`, value)
        : await this.api.post<CatalogEntry>("catalog/workers/", { ...value, origin: "operacional_registrado" });
      await this.catalog.load();
      this.close();
      this.saved.emit(worker);
    } catch (e) { this.error.set(apiError(e)); } finally { this.busy.set(false); }
  }
}
