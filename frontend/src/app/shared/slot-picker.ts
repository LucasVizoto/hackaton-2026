import { ChangeDetectionStrategy, Component, effect, inject, input, OnDestroy, output, untracked, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Api, apiError } from "../core/api";
import { AvailableSlot, revalidatedTime } from "../core/workflow";

@Component({ selector: "app-slot-picker", standalone: true, imports: [FormsModule], changeDetection: ChangeDetectionStrategy.OnPush, host: { style: "display: block; min-width: 0" },
  template: `<fieldset class="slot-picker"><legend>Horário</legend><div class="slot-options">@for(slot of slots();track slot.time){<label class="slot-option" [class.is-disabled]="!slot.eligible || loading()" [class.is-selected]="selected()===slot.time.slice(0,5)"><input type="radio" name="slot-time" [value]="slot.time.slice(0,5)" [checked]="selected()===slot.time.slice(0,5)" [disabled]="loading() || !ready() || !slot.eligible" (change)="choose(slot.time.slice(0,5))" /><strong>{{slot.time.slice(0,5)}}</strong><span>{{slot.eligible?'Disponível':slot.reason || 'Indisponível'}}</span></label>}</div></fieldset>
  @if (loading()) { <p class="field-help" role="status">Consultando disponibilidade…</p> }
  @if (error()) { <p class="error" role="alert">{{error()}}</p><button type="button" (click)="refresh()">Consultar novamente</button> }
  @if (ready() && !hasEligible()) { <p class="notice">Nenhum horário elegível para esta carga e data.</p> }
  <p class="field-help">A reserva é confirmada ao salvar. A escolha é mantida apenas enquanto houver disponibilidade.</p>`,
})
export class SlotPicker implements OnDestroy {
  date = input.required<string>(); packaging = input.required<string>(); exclude = input(""); natureException = input(false); initialTime=input("");
  selection = output<{time:string; ready:boolean}>();
  private api = inject(Api); private controller?: AbortController; private generation = 0; private preferred = "";
  slots = signal<AvailableSlot[]>([]); selected = signal(""); loading = signal(false); ready = signal(false); error = signal("");
  constructor() { effect(() => { const date=this.date(), packaging=this.packaging(), exclude=this.exclude(), nature=this.natureException(), initial=this.initialTime(); if(!this.generation)this.preferred=initial; untracked(() => void this.load(date,packaging,exclude,nature)); }); }
  hasEligible() { return this.slots().some(slot => slot.eligible); }
  refresh() { void this.load(this.date(),this.packaging(),this.exclude(),this.natureException()); }
  async load(date:string, packaging:string, exclude:string, nature:boolean) {
    this.controller?.abort(); const controller = this.controller = new AbortController(), generation = ++this.generation;
    this.slots.set([]); this.selected.set(""); this.ready.set(false); this.error.set(""); this.selection.emit({time:"",ready:false});
    if (!date || !packaging) { this.loading.set(false); return; }
    this.loading.set(true);
    try {
      const query = new URLSearchParams({date,packaging}); if(exclude) query.set("exclude_appointment",exclude); if(nature) query.set("nature_exception","true");
      const result = await this.api.get<{slots:AvailableSlot[];calendar_open?:boolean}>(`slots/availability/?${query}`,controller.signal);
      if(generation !== this.generation) return;
      this.slots.set(result.calendar_open === false ? [] : result.slots); this.ready.set(true);
      this.preferred=revalidatedTime(this.preferred,this.slots());this.selected.set(this.preferred);this.selection.emit({time:this.preferred,ready:!!this.preferred});
    } catch(error) { if(!controller.signal.aborted && generation === this.generation) this.error.set(apiError(error)); }
    finally { if(generation === this.generation) this.loading.set(false); }
  }
  choose(time:string) { const valid=this.ready() && this.slots().some(slot => slot.eligible && slot.time.slice(0,5)===time); this.preferred=valid?time:"";this.selected.set(this.preferred); this.selection.emit({time:valid?time:"",ready:valid}); }
  ngOnDestroy() { this.generation++; this.controller?.abort(); }
}
