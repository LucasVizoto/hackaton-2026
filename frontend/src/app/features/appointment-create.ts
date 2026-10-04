import { ChangeDetectionStrategy, Component, inject, NgZone, OnInit, signal, viewChild } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { IonButton } from "@ionic/angular/standalone";
import { Api, apiError, originLabel, nextBusinessDay, today } from "../core/api";
import { Catalog } from "../core/catalog";
import { invoiceNumber, uploadIdentity } from "../core/workflow";
import { invoiceFieldsFromXml, readInvoicePdf } from "./invoice-code";
import { FeedbackState, LoadingState, PageHeader } from "../shared/ui";
import { RainAlert } from "../shared/rain-alert";
import { SlotPicker } from "../shared/slot-picker";

interface PreviousAppointment {id:string;supplier:string;supplier_name:string;date:string;vehicle_plate:string;}
interface InvoiceDraft { key:string; file:File|null; number:string; accessKey:string; uploadedId:string; uploadedIdentity:string; origin:string; reading:boolean; readNotice:string; }
@Component({standalone:true,changeDetection:ChangeDetectionStrategy.OnPush,
  imports:[ReactiveFormsModule,RouterLink,IonButton,FeedbackState,LoadingState,PageHeader,SlotPicker,RainAlert],
  template:`<div class="page form-page"><app-page-header title="Agendar recebimento" subtitle="Um caminhão, uma reserva e todas as notas do mesmo fornecedor."><a routerLink="/agenda">Voltar à agenda</a></app-page-header>
  @if(error()) {<div app-feedback tone="error">{{error()}}</div>}
  @if(!loaded()) {<app-loading-state label="Carregando fornecedores…" />}
  <form [formGroup]="form" (ngSubmit)="save()"><fieldset [disabled]="busy() || !loaded()">
  <section class="panel"><h2><span class="step-number">1</span> Carga e horário</h2><div class="form-grid"><label>Acondicionamento<select formControlName="packaging"><option value="paletizada">Paletizada</option><option value="big_bag">Big bag</option><option value="batida">Batida — horário exclusivo</option><option value="machine_implement">Máquina / implemento</option></select></label><label>Data<span class="date-with-weather"><input type="date" formControlName="date" [min]="minDate" /><app-rain-alert [date]="selectedDate()" /></span></label><app-slot-picker [date]="selectedDate()" [packaging]="form.controls.packaging.value" [initialTime]="preferredTime" [weather]="true" (selection)="slotChanged($event)" /></div></section>
  <section class="panel">@if(previous();as prior){<h2>Nova solicitação vinculada</h2><p>{{prior.supplier_name}} · {{prior.vehicle_plate}} · {{prior.date}}</p><label>Motivo da nova solicitação<textarea formControlName="resubmission_reason" required></textarea></label><p class="field-help">O recebimento anterior permanece no histórico. Esta solicitação exige documentos, reserva e novas aprovações.</p>}<h2><span class="step-number">2</span> Notas fiscais</h2><p class="muted">Os documentos mantêm sua procedência; a origem deste recebimento é definida pelo servidor.</p>
  @for(note of notes();track note.key;let i=$index){<div class="section invoice-draft"><h3>Nota {{i+1}}</h3><div class="form-grid"><label class="wide">Arquivo da nota<input type="file" accept=".xml,.pdf" (change)="fileChanged(note.key,$event)" /><span class="field-help">XML até 5 MB ou PDF até 10 MB. A leitura preenche o número da NF e a chave.</span></label><label class="wide">Número da NF<input inputmode="numeric" [value]="note.number" (input)="numberChanged(note.key,$event)" /><span class="field-help">Número da NF, sem zeros à esquerda. Confira se a leitura não preencher.</span></label><label class="wide">Chave de acesso (opcional)<input inputmode="numeric" [value]="note.accessKey" (input)="keyChanged(note.key,$event)" /><span class="field-help">Se informada, será conferida com o número da NF.</span></label></div>@if(note.reading){<p class="field-help" role="status">Lendo a nota fiscal…</p>}@if(note.readNotice){<p class="field-help">{{note.readNotice}}</p>}@if(note.uploadedId){<p class="field-help">Anexo validado · {{origin(note.origin)}}</p>}@if(notes().length>1){<button class="remove" type="button" (click)="removeNote(note.key)">Remover nota {{i+1}}</button>}</div>}
  <ion-button class="section" type="button" fill="outline" [disabled]="notes().length>=30" (click)="addNote()">Adicionar outra nota</ion-button>
  </section><section class="panel"><h2><span class="step-number">3</span> Caminhão</h2><div class="form-grid"><label>Placa do veículo / carreta<input formControlName="vehicle_plate" /></label><label class="check"><input type="checkbox" formControlName="articulated" />Conjunto articulado</label><label>Placa do cavalo<input formControlName="tractor_plate" [required]="form.controls.articulated.value" /><span class="field-help">Obrigatória para conjunto articulado.</span></label><label>Transportadora<input formControlName="carrier_name" /></label><label>Motorista<input formControlName="driver_name" /></label><label class="wide">Observações<textarea formControlName="notes"></textarea></label></div></section>

  <div class="actions"><ion-button type="submit" [disabled]="busy() || !loaded() || !slotReady() || form.invalid || reading()">{{busy()?'Validando notas e reservando…':'Salvar e reservar horário'}}</ion-button><a routerLink="/agenda">Cancelar edição</a></div>
  </fieldset></form></div>`,
})
export class AppointmentCreate implements OnInit {
  api=inject(Api);catalog=inject(Catalog);private fb=inject(FormBuilder);private router=inject(Router);private route=inject(ActivatedRoute);private zone=inject(NgZone);previous=signal<PreviousAppointment|null>(null);
  busy=signal(false);loaded=signal(false);error=signal("");slotReady=signal(false);origin=originLabel;
  readonly minDate=today(); preferredTime="";
  slots=viewChild(SlotPicker);
  notes=signal<InvoiceDraft[]>([]);private attemptSignature="";private attemptKey="";private readings=new Map<string,number>();
  reading=()=>this.notes().some(note=>note.reading);
  form=this.fb.nonNullable.group({supplier:[""],resubmission_reason:[""],articulated:[false],booking_kind:["scheduled"],vehicle_plate:["",Validators.required],tractor_plate:[""],carrier_name:[""],driver_name:[""],packaging:["paletizada",Validators.required],notes:[""],date:[nextBusinessDay(),Validators.required],time:["",Validators.required]});
  readonly selectedDate=signal(this.form.controls.date.value);
  constructor(){this.form.controls.date.valueChanges.pipe(takeUntilDestroyed()).subscribe(value=>this.selectedDate.set(value));}
  async ngOnInit(){const query=this.route.snapshot.queryParamMap,date=query.get("date");if(date&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&date>=this.minDate){this.form.controls.date.setValue(date);this.preferredTime=query.get("time")||"";}this.addNote();try{if(this.api.can('warehouse','purchasing')){this.form.controls.supplier.addValidators(Validators.required);await this.catalog.load();}const previousId=this.route.snapshot.queryParamMap.get('previous_appointment');if(previousId){const prior=await this.api.get<PreviousAppointment>(`appointments/${previousId}/`);this.previous.set(prior);if(this.api.can('warehouse','purchasing'))this.form.controls.supplier.setValue(prior.supplier);this.form.controls.resubmission_reason.addValidators(Validators.required);this.form.controls.resubmission_reason.updateValueAndValidity();}this.loaded.set(true);}catch(e){this.error.set(apiError(e));}}
  addNote(){this.notes.update(notes=>[...notes,{key:crypto.randomUUID(),file:null,number:"",accessKey:"",uploadedId:"",uploadedIdentity:"",origin:"",reading:false,readNotice:""}]);}
  removeNote(key:string){this.notes.update(notes=>notes.filter(note=>note.key!==key));}
  supplierChanged(){this.notes.update(notes=>notes.map(note=>({...note,uploadedId:"",uploadedIdentity:"",origin:""})));}
  fileChanged(key:string,event:Event){
    const file=(event.target as HTMLInputElement).files?.[0]??null;
    const token=(this.readings.get(key)??0)+1;
    this.readings.set(key,token);
    const isPdf=!!file&&/\.pdf$/i.test(file.name);
    const isXml=!!file&&/\.xml$/i.test(file.name);
    this.notes.update(notes=>notes.map(note=>note.key===key?{...note,file,number:"",accessKey:"",uploadedId:"",uploadedIdentity:"",origin:"",reading:isPdf||isXml,readNotice:""}:note));
    if(isPdf)void this.readPdf(key,file,token);
    else if(isXml)void this.readXml(key,file,token);
  }
  private applyReading(key:string,token:number,fields:{number:string;accessKey:string},emptyNotice:string){
    if(this.readings.get(key)!==token)return;
    const found=!!(fields.number||fields.accessKey);
    this.zone.run(()=>this.notes.update(notes=>notes.map(note=>note.key===key?{...note,reading:false,number:fields.number,accessKey:fields.accessKey,readNotice:found?"Leitura concluída. Confira o número e a chave antes de salvar.":emptyNotice}:note)));
  }
  private async readPdf(key:string,file:File,token:number){
    try{
      this.applyReading(key,token,await readInvoicePdf(file),"Não encontrei o número nem a chave no PDF. Preencha e confira manualmente.");
    }catch{
      this.applyReading(key,token,{number:"",accessKey:""},"Não foi possível ler o PDF. Informe o número e a chave manualmente.");
    }
  }
  private async readXml(key:string,file:File,token:number){
    try{
      this.applyReading(key,token,invoiceFieldsFromXml(await file.text()),"Não encontrei o número da NF no XML. Preencha e confira manualmente.");
    }catch{
      this.applyReading(key,token,{number:"",accessKey:""},"Não foi possível ler o XML. Informe o número e a chave manualmente.");
    }
  }
  keyChanged(key:string,event:Event){const accessKey=(event.target as HTMLInputElement).value;this.notes.update(notes=>notes.map(note=>note.key===key?{...note,accessKey,uploadedId:"",uploadedIdentity:""}:note));}
  numberChanged(key:string,event:Event){const number=(event.target as HTMLInputElement).value;this.notes.update(notes=>notes.map(note=>note.key===key?{...note,number,uploadedId:"",uploadedIdentity:"",origin:""}:note));}
  slotChanged(value:{time:string;ready:boolean}){this.form.controls.time.setValue(value.time);this.slotReady.set(value.ready);}
  async save(){
    if(this.busy()||!this.loaded()||!this.slotReady()||this.form.invalid||this.reading()){this.form.markAllAsTouched();return;}
    this.busy.set(true);this.error.set("");
    try{
      const value=this.form.getRawValue();if(value.articulated&&!value.tractor_plate.trim())throw new Error("Informe a placa do cavalo do conjunto articulado.");const drafts=this.notes(), ids:string[]=[];
      if(!drafts.length)throw new Error("Adicione pelo menos uma nota.");
      if(drafts.some(note=>note.reading))throw new Error("Aguarde a leitura da nota.");
      for(const note of drafts){
        if(!note.file)throw new Error("Selecione o arquivo de todas as notas.");
        const isXml=/\.xml$/i.test(note.file.name),isPdf=/\.pdf$/i.test(note.file.name);
        if(!isXml&&!isPdf)throw new Error("Envie notas em XML ou PDF.");
        if(note.file.size>(isXml?5:10)*1024*1024)throw new Error(`O arquivo ${note.file.name} excede o limite permitido.`);
        const number=note.number.trim()?invoiceNumber(note.number):"";
        if(isPdf&&!number)throw new Error("Informe o número de cada nota PDF.");
        const identity=uploadIdentity(note.file,value.supplier,number)+JSON.stringify(note.accessKey);
        if(note.uploadedId && note.uploadedIdentity===identity){ids.push(note.uploadedId);continue;}
        const data=new FormData();data.append("file",note.file);if(value.supplier)data.append("supplier",value.supplier);if(number)data.append("number",number);if(note.accessKey.trim())data.append("access_key",note.accessKey);
        const invoice=await this.api.post<{id:string;number:string;origin:string}>("invoices/upload/",data);
        ids.push(invoice.id);this.notes.update(rows=>rows.map(row=>row.key===note.key?{...row,uploadedId:invoice.id,uploadedIdentity:identity,origin:invoice.origin}:row));
      }
      const payload={...value,previous_appointment:this.previous()?.id,resubmission_reason:this.previous()?value.resubmission_reason:undefined,supplier:value.supplier||undefined,invoice_ids:ids};const signature=JSON.stringify(payload);
      if(signature!==this.attemptSignature){this.attemptSignature=signature;this.attemptKey=crypto.randomUUID();}
      const appointment=await this.api.post<{id:string}>("appointments/",{...payload,idempotency_key:this.attemptKey});
      await this.router.navigate(["/agenda",appointment.id]);
    }catch(e){this.error.set(apiError(e));this.slots()?.refresh();}finally{this.busy.set(false);}
  }
}
