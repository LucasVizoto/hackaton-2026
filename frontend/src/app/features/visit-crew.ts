import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { Api, apiError } from "../core/api";
import { FeedbackState, LoadingState } from "../shared/ui";

export interface CrewPerson { id: string; registration: string; name: string; attendance: string | null; in_crew: boolean; busy_at: string | null; }
export interface CrewEquipment { id: string; name: string; kind: string; kind_label: string; warehouse_name: string | null; own: boolean; planned: boolean; busy_at: string | null; }
export interface Crew {
  visit: string; appointment: string; warehouse: string; warehouse_name: string; date: string; origin: string; stage: "waiting" | "running" | "done";
  suggestion: { packaging_label: string; people: number; gas_forklifts: number; text: string; estimated: boolean; light_load: boolean; notes: string[]; equipment: string[]; forklift_warning: string | null; borrowed: boolean };
  crew: string[]; people: CrewPerson[]; others: { id: string; registration: string; name: string }[]; equipment: CrewEquipment[];
}

/** Equipe da descarga numa etapa (caminhão × armazém): a norma sugere, o armazém escolhe quem vai. */
@Component({
  selector: "app-visit-crew",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, FeedbackState, LoadingState],
  styles: [`
    .crew { display: grid; gap: 12px; }
    .suggest { padding: 12px 14px; border-radius: var(--radius-control); background: var(--info-soft); color: var(--blue); }
    .suggest strong { display: block; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 14px; border: 1px solid var(--line); border-radius: var(--radius-full); background: var(--surface); color: inherit; font: inherit; cursor: pointer; }
    .chip[aria-pressed="true"] { border-color: var(--green); background: var(--green); color: var(--brand-contrast); font-weight: 600; }
    .chip:disabled { opacity: .5; cursor: not-allowed; }
    .chip small { font-weight: 400; opacity: .85; }
    .count { font-weight: 600; }
    .count.short { color: var(--danger); }
    .row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; }
    .add { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .add select { min-height: 44px; }
    .save { min-height: 44px; padding: 0 20px; border: 0; border-radius: var(--radius-full); background: var(--green); color: var(--brand-contrast); font: inherit; font-weight: 600; cursor: pointer; }
    .save:disabled { opacity: .5; cursor: not-allowed; }
  `],
  template: `
  @if (error()) { <div app-feedback tone="error">{{ error() }}</div> }
  @if (!data() && busy()) { <app-loading-state label="Carregando equipe sugerida…" /> }
  @if (data(); as d) {
    <div class="crew">
      <div class="suggest" role="note"><strong>Sugestão: {{ d.suggestion.text }}</strong>
        @if (d.suggestion.borrowed) { <span>Empilhadeira emprestada de outro armazém (a deste está ocupada ou não existe).</span> }
        @if (d.suggestion.forklift_warning) { <span>{{ d.suggestion.forklift_warning }}</span> }
        @if (d.suggestion.estimated) { <small>Estimativa pela norma; peso ou volumes da nota não informados.</small> }
      </div>

      <div>
        <div class="row"><h3>Quem vai nesta descarga</h3>
          <span class="count" [class.short]="selected().length < d.suggestion.people">{{ selected().length }} de {{ d.suggestion.people }} {{ d.suggestion.people === 1 ? "pessoa sugerida" : "pessoas sugeridas" }}</span></div>
        @if (d.people.length) {
          <div class="chips" role="group" aria-label="Chapas escalados hoje">
            @for (p of d.people; track p.id) {
              <button type="button" class="chip" [attr.aria-pressed]="selected().includes(p.id)" [disabled]="!editable() || (p.attendance === 'ABSENT' && !selected().includes(p.id))" (click)="toggle(p.id)">
                {{ p.name }}
                @if (p.attendance === "ABSENT") { <small>faltou</small> } @else if (p.busy_at) { <small>em {{ p.busy_at }}</small> }
              </button>
            }
          </div>
        } @else {
          <p class="muted">Ninguém escalado hoje. <a routerLink="/escala">Abrir a escala</a> ou adicione abaixo.</p>
        }
        @if (editable() && d.others.length) {
          <div class="add section"><label>Adicionar quem não estava escalado
            <select [ngModel]="extra()" (ngModelChange)="extra.set($event)"><option value="">Escolha a pessoa</option>@for (o of d.others; track o.id) { <option [value]="o.id">{{ o.name }} ({{ o.registration }})</option> }</select></label>
            <button type="button" class="chip" [disabled]="!extra()" (click)="addExtra()">Adicionar</button></div>
        }
      </div>

      @if (d.stage !== "done") {
        <div>
          <h3>Equipamento</h3>
          <div class="chips" role="group" aria-label="Equipamentos deste armazém e os que circulam">
            @for (e of d.equipment; track e.id) {
              <button type="button" class="chip" [attr.aria-pressed]="equipment().includes(e.id)" [disabled]="!editable()" (click)="toggleEquipment(e.id)">
                {{ e.name }}@if (!e.own && e.warehouse_name) { <small>do {{ e.warehouse_name }}</small> }@if (e.busy_at) { <small>em uso no {{ e.busy_at }}</small> }
              </button>
            } @empty { <p class="muted">Nenhum equipamento cadastrado para este armazém.</p> }
          </div>
        </div>
      }

      @if (editable()) {
        <div class="row"><span class="field-help">{{ d.stage === "done" ? "A saída já foi registrada; aqui você corrige só os nomes." : "A quantidade e os equipamentos são confirmados na saída do armazém." }}</span>
          <button type="button" class="save" [disabled]="busy() || !dirty()" (click)="save()">{{ busy() ? "Salvando…" : "Salvar equipe" }}</button></div>
      }
      @if (saved()) { <div app-feedback tone="success">Equipe salva. Quem foi para a descarga fica como presente na escala.</div> }
    </div>
  }`,
})
export class VisitCrew {
  private api = inject(Api);
  visitId = input.required<string>();
  canEdit = input(false);
  changed = output<Crew>();
  data = signal<Crew | null>(null);
  selected = signal<string[]>([]);
  equipment = signal<string[]>([]);
  extra = signal("");
  busy = signal(false);
  error = signal("");
  saved = signal(false);
  private original = signal("");
  editable = computed(() => this.canEdit() && !!this.data());
  dirty = computed(() => JSON.stringify([this.selected().slice().sort(), this.equipment().slice().sort()]) !== this.original());
  constructor() { effect(() => { const id = this.visitId(); if (id) void this.load(id); }); }
  private apply(crew: Crew) {
    this.data.set(crew);
    const planned = crew.equipment.filter(e => e.planned).map(e => e.id);
    this.selected.set([...crew.crew]);
    this.equipment.set(planned.length || crew.stage === "done" ? planned : [...crew.suggestion.equipment]);
    this.original.set(JSON.stringify([[...crew.crew].sort(), planned.slice().sort()]));
  }
  async load(id: string) {
    this.busy.set(true);
    this.error.set("");
    try { this.apply(await this.api.get<Crew>(`allocation/visits/${id}/crew/`)); } catch (e) { this.error.set(apiError(e)); } finally { this.busy.set(false); }
  }
  toggle(id: string) { this.saved.set(false); this.selected.update(list => list.includes(id) ? list.filter(x => x !== id) : [...list, id]); }
  toggleEquipment(id: string) { this.saved.set(false); this.equipment.update(list => list.includes(id) ? list.filter(x => x !== id) : [...list, id]); }
  addExtra() {
    const d = this.data(), id = this.extra();
    const person = d?.others.find(o => o.id === id);
    if (!d || !person) return;
    this.data.set({ ...d, others: d.others.filter(o => o.id !== id), people: [...d.people, { ...person, attendance: null, in_crew: false, busy_at: null }] });
    this.toggle(id);
    this.extra.set("");
  }
  async save() {
    const d = this.data();
    if (!d || this.busy()) return;
    this.busy.set(true);
    this.error.set("");
    try {
      const body: Record<string, unknown> = { worker_ids: this.selected() };
      if (d.stage !== "done") body["equipment_ids"] = this.equipment();
      const crew = await this.api.post<Crew>(`allocation/visits/${d.visit}/crew/`, body);
      this.apply(crew);
      this.saved.set(true);
      this.changed.emit(crew);
    } catch (e) { this.error.set(apiError(e)); } finally { this.busy.set(false); }
  }
}
