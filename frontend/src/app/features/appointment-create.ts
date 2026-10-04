import { ChangeDetectionStrategy, Component, ElementRef, inject, NgZone, OnInit, signal, viewChild } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { IonButton } from "@ionic/angular/standalone";
import { Capacitor } from "@capacitor/core";
import { Api, apiError, originLabel, nextBusinessDay, today } from "../core/api";
import { Catalog } from "../core/catalog";
import { invoiceNumber, uploadIdentity } from "../core/workflow";
import { invoiceFieldsFromXml } from "./invoice-code";
import { InvoiceReader } from "../core/invoice-reader";
import { InvoiceReadSession } from "./invoice-reading";
import { FeedbackState, LoadingState, PageHeader } from "../shared/ui";
import { RainAlert } from "../shared/rain-alert";
import { SlotPicker } from "../shared/slot-picker";

interface PreviousAppointment {id:string;supplier:string;supplier_name:string;date:string;vehicle_plate:string;}
interface InvoiceDraft { key:string; file:File|null; number:string; accessKey:string; uploadedId:string; uploadedIdentity:string; origin:string; reading:boolean; readNotice:string; readError:boolean; documentNotice:string; documentError:boolean; }
@Component({standalone:true,changeDetection:ChangeDetectionStrategy.OnPush,
  imports:[ReactiveFormsModule,RouterLink,IonButton,FeedbackState,LoadingState,PageHeader,SlotPicker,RainAlert],
  template:`<div class="page form-page invoice-form"><app-page-header title="Agendar recebimento" subtitle="Um caminhão, uma reserva e todas as notas do mesmo fornecedor."><a routerLink="/agenda">Voltar à agenda</a></app-page-header>
  @if(error()) {<div app-feedback tone="error">{{error()}}</div>}
  @if(!loaded()) {<app-loading-state label="Carregando fornecedores…" />}
  <form [formGroup]="form" (ngSubmit)="save()"><fieldset [disabled]="busy() || !loaded()">
  <section class="panel"><h2><span class="step-number">1</span> Carga e horário</h2><div class="form-grid"><label>Acondicionamento<select formControlName="packaging"><option value="paletizada">Paletizada</option><option value="big_bag">Big bag</option><option value="batida">Batida — horário exclusivo</option><option value="machine_implement">Máquina / implemento</option></select></label><label>Data<span class="date-with-weather"><input type="date" formControlName="date" [min]="minDate" /><app-rain-alert [date]="selectedDate()" /></span></label><app-slot-picker [date]="selectedDate()" [packaging]="form.controls.packaging.value" [initialTime]="preferredTime" [weather]="true" (selection)="slotChanged($event)" /></div></section>
  <section class="panel">
    @if(previous();as prior){<h2>Nova solicitação vinculada</h2><p>{{prior.supplier_name}} · {{prior.vehicle_plate}} · {{prior.date}}</p><label>Motivo da nova solicitação<textarea formControlName="resubmission_reason" required></textarea></label><p class="field-help">O recebimento anterior permanece no histórico. Esta solicitação exige documentos, reserva e novas aprovações.</p>}
    <h2><span class="step-number">2</span> Notas fiscais</h2>
    <p class="field-help form-instructions">Anexe os documentos e confira os identificadores antes de salvar.</p>
    @for(note of notes();track note.key;let i=$index){
      <section class="invoice-draft" [attr.aria-labelledby]="'note-title-'+note.key">
        <div class="document-heading"><h3 [id]="'note-title-'+note.key">Nota {{i+1}}</h3>@if(notes().length>1){<button class="remove" type="button" (click)="removeNote(note.key)">Remover nota {{i+1}}</button>}</div>
        <div class="form-field">
          <label [for]="'note-file-'+note.key">Arquivo da nota (obrigatório)</label>
          <input [id]="'note-file-'+note.key" type="file" accept=".xml,.pdf" required [attr.aria-describedby]="'note-file-help-'+note.key" (change)="fileChanged(note.key,$event)" />
          <span class="field-help" [id]="'note-file-help-'+note.key">XML até 5 MB ou PDF até 10 MB.</span>
        </div>
        <div class="document-actions actions">
          @if(isPdf(note.file)){<ion-button type="button" fill="outline" [disabled]="busy() || !!documentBusy()" (click)="openPdf(note)">{{documentBusy()===note.key?'Salvando cópia…':isAndroid?'Salvar cópia do PDF':'Abrir PDF'}}</ion-button>}
          @if(note.reading){<ion-button type="button" fill="outline" (click)="enterManually(note.key,noteNumber)">Preencher manualmente</ion-button>}
        </div>
        <div class="reading-state" role="status" aria-live="polite" aria-atomic="true">@if(note.reading){<p>Lendo o número e a chave…</p>}@else if(!note.readError && note.readNotice){<p>{{note.readNotice}}</p>}</div>
        <div role="alert" class="field-help field-error reading-error">@if(note.readError){ {{note.readNotice}} }</div>
        <p class="field-help document-notice" [class.field-error]="note.documentError" [attr.role]="note.documentError?'alert':'status'">{{note.documentNotice}}</p>
        <div class="invoice-identifiers">
          <div class="form-field">
            <label [for]="'note-number-'+note.key">Número da NF</label>
            <input #noteNumber [id]="'note-number-'+note.key" inputmode="numeric" autocomplete="off" [required]="isPdf(note.file)" [attr.aria-describedby]="'note-number-help-'+note.key" [value]="note.number" (input)="numberChanged(note.key,$event)" />
            <span class="field-help" [id]="'note-number-help-'+note.key">De 1 a 9 dígitos, sem zeros à esquerda. Obrigatório para PDF.</span>
          </div>
          <div class="form-field">
            <label [for]="'note-key-'+note.key">Chave de acesso (opcional)</label>
            <input [id]="'note-key-'+note.key" inputmode="numeric" autocomplete="off" [attr.aria-describedby]="'note-key-help-'+note.key" [value]="note.accessKey" (input)="keyChanged(note.key,$event)" />
            <span class="field-help" [id]="'note-key-help-'+note.key">44 dígitos. Se informada, deve corresponder ao número da NF.</span>
          </div>
        </div>
        @if(note.uploadedId){<p class="field-help">Anexo validado · {{origin(note.origin)}}</p>}
      </section>
    }
    <ion-button class="add-invoice" type="button" fill="outline" [disabled]="notes().length>=30" (click)="addNote()">Adicionar outra nota</ion-button>
  </section>
  <section class="panel"><h2><span class="step-number">3</span> Caminhão</h2><div class="form-grid"><div class="form-field"><label for="booking-plate">Placa do veículo / carreta (obrigatória)</label><input id="booking-plate" formControlName="vehicle_plate" required [attr.aria-invalid]="form.controls.vehicle_plate.touched && form.controls.vehicle_plate.invalid" aria-describedby="booking-plate-error" /><span id="booking-plate-error" class="field-help field-error">@if(form.controls.vehicle_plate.touched && form.controls.vehicle_plate.invalid){Informe a placa do veículo ou da carreta.}</span></div><label class="check"><input type="checkbox" formControlName="articulated" />Conjunto articulado</label><label>Placa do cavalo<input formControlName="tractor_plate" [required]="form.controls.articulated.value" /><span class="field-help">Obrigatória para conjunto articulado.</span></label><label>Transportadora<input formControlName="carrier_name" /></label><label>Motorista<input formControlName="driver_name" /></label><label class="wide">Observações<textarea formControlName="notes"></textarea></label></div></section>

  <div class="actions"><ion-button type="submit" [disabled]="busy() || !loaded() || !slotReady() || form.invalid || reading()">{{busy()?'Validando notas e reservando…':'Salvar e reservar horário'}}</ion-button><a routerLink="/agenda">Cancelar edição</a></div>
  <p class="field-help submit-help">{{reading()?'Aguarde a leitura ou preencha as notas manualmente.':!slotReady()?'Escolha um horário disponível.':form.controls.vehicle_plate.invalid?'Informe a placa do veículo ou da carreta.':''}}</p>
  </fieldset></form></div>`,
})
export class AppointmentCreate implements OnInit {
  api=inject(Api);catalog=inject(Catalog);private reader=inject(InvoiceReader);private fb=inject(FormBuilder);private router=inject(Router);private route=inject(ActivatedRoute);private zone=inject(NgZone);previous=signal<PreviousAppointment|null>(null);
  private host:ElementRef<HTMLElement>=inject(ElementRef);
  busy=signal(false);loaded=signal(false);error=signal("");slotReady=signal(false);origin=originLabel;
  readonly minDate=today(); preferredTime="";
  slots=viewChild(SlotPicker);
  notes=signal<InvoiceDraft[]>([]);private attemptSignature="";private attemptKey="";private readings=new Map<string,InvoiceReadSession>();
  readonly isAndroid=Capacitor.getPlatform()==="android";documentBusy=signal("");private pdfUrls=new Map<string,string>();
  isPdf=(file:File|null)=>!!file&&/\.pdf$/i.test(file.name);
  reading=()=>this.notes().some(note=>note.reading);
  form=this.fb.nonNullable.group({supplier:[""],resubmission_reason:[""],articulated:[false],booking_kind:["scheduled"],vehicle_plate:["",Validators.required],tractor_plate:[""],carrier_name:[""],driver_name:[""],packaging:["paletizada",Validators.required],notes:[""],date:[nextBusinessDay(),Validators.required],time:["",Validators.required]});
  readonly selectedDate=signal(this.form.controls.date.value);
  constructor(){this.form.controls.date.valueChanges.pipe(takeUntilDestroyed()).subscribe(value=>this.selectedDate.set(value));}
  async ngOnInit(){const query=this.route.snapshot.queryParamMap,date=query.get("date");if(date&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&date>=this.minDate){this.form.controls.date.setValue(date);this.preferredTime=query.get("time")||"";}this.addNote();try{if(this.api.can('warehouse','purchasing')){this.form.controls.supplier.addValidators(Validators.required);await this.catalog.load();}const previousId=this.route.snapshot.queryParamMap.get('previous_appointment');if(previousId){const prior=await this.api.get<PreviousAppointment>(`appointments/${previousId}/`);this.previous.set(prior);if(this.api.can('warehouse','purchasing'))this.form.controls.supplier.setValue(prior.supplier);this.form.controls.resubmission_reason.addValidators(Validators.required);this.form.controls.resubmission_reason.updateValueAndValidity();}this.loaded.set(true);}catch(e){this.error.set(apiError(e));}}
  addNote(){this.notes.update(notes=>[...notes,{key:crypto.randomUUID(),file:null,number:"",accessKey:"",uploadedId:"",uploadedIdentity:"",origin:"",reading:false,readNotice:"",readError:false,documentNotice:"",documentError:false}]);}
  removeNote(key:string){const remaining=this.notes().find(note=>note.key!==key);this.readings.get(key)?.cancel();this.readings.delete(key);this.revokePdf(key);this.notes.update(notes=>notes.filter(note=>note.key!==key));if(remaining)this.host.nativeElement.querySelector<HTMLInputElement>(`#note-number-${remaining.key}`)?.focus();}
  supplierChanged(){this.notes.update(notes=>notes.map(note=>({...note,uploadedId:"",uploadedIdentity:"",origin:""})));}
  fileChanged(key:string,event:Event){
    this.revokePdf(key);
    const file=(event.target as HTMLInputElement).files?.[0]??null;
    const session=this.readings.get(key)??new InvoiceReadSession();
    this.readings.set(key,session);
    const attempt=session.start();
    const isPdf=!!file&&/\.pdf$/i.test(file.name);
    const isXml=!!file&&/\.xml$/i.test(file.name);
    const valid=!!file&&file.size>0&&file.size<=(isXml?5:10)*1024*1024;
    this.notes.update(notes=>notes.map(note=>note.key===key?{...note,file,number:"",accessKey:"",uploadedId:"",uploadedIdentity:"",origin:"",reading:isPdf||isXml,readNotice:"",readError:false,documentNotice:"",documentError:false}:note));
    if(!valid){this.notes.update(notes=>notes.map(note=>note.key===key?{...note,reading:false,readError:!!file,readNotice:file?'Arquivo vazio ou acima do limite. Escolha outro XML (até 5 MB) ou PDF (até 10 MB).':''}:note));return;}
    if(isPdf)void this.readPdf(key,file,attempt);
    else if(isXml)void this.readXml(key,file,attempt);
    else this.notes.update(notes=>notes.map(note=>note.key===key?{...note,reading:false,readError:true,readNotice:'Formato não aceito. Escolha um XML ou PDF.'}:note));
  }
  private applyReading(key:string,attempt:{isCurrent:()=>boolean},fields:{number:string;accessKey:string},emptyNotice:string){
    if(!attempt.isCurrent())return;
    const found=!!(fields.number||fields.accessKey);
    const notice=fields.number&&fields.accessKey?'Número e chave sugeridos. Confira no documento.':fields.number?'Número sugerido. Chave não identificada; o preenchimento é opcional.':fields.accessKey?'Chave sugerida. Confira e preencha o número da NF.':emptyNotice;
    this.zone.run(()=>this.notes.update(notes=>notes.map(note=>note.key===key?{...note,reading:false,number:fields.number,accessKey:fields.accessKey,readError:!found,readNotice:notice}:note)));
  }
  private async readPdf(key:string,file:File,attempt:{signal:AbortSignal;isCurrent:()=>boolean}){
    try{
      this.applyReading(key,attempt,await this.reader.readPdf(file,attempt.signal),"Identificadores não encontrados. Informe o número e confira no PDF. A chave é opcional.");
    }catch(e){
      this.applyReading(key,attempt,{number:"",accessKey:""},apiError(e));
    }
  }
  private async readXml(key:string,file:File,attempt:{signal:AbortSignal;isCurrent:()=>boolean}){
    try{
      this.applyReading(key,attempt,invoiceFieldsFromXml(await file.text()),"Não encontrei o número da NF no XML. Preencha e confira manualmente.");
    }catch{
      this.applyReading(key,attempt,{number:"",accessKey:""},"Não foi possível ler o XML. Confira o arquivo ou informe o número manualmente. A chave é opcional.");
    }
  }
  enterManually(key:string,input?:HTMLInputElement){this.readings.get(key)?.cancel();this.notes.update(notes=>notes.map(note=>note.key===key?{...note,reading:false,readError:false,readNotice:'Confira o número digitado no documento. A chave é opcional.'}:note));input?.focus();}
  private revokePdf(key:string){const url=this.pdfUrls.get(key);if(url)URL.revokeObjectURL(url);this.pdfUrls.delete(key);}
  async openPdf(note:InvoiceDraft){
    if(!note.file||!this.isPdf(note.file)||this.documentBusy())return;
    this.notes.update(notes=>notes.map(row=>row.key===note.key?{...row,documentNotice:'',documentError:false}:row));
    try{
      if(this.isAndroid){this.documentBusy.set(note.key);if(await this.api.saveBlob(note.file,note.file.name))this.notes.update(notes=>notes.map(row=>row.key===note.key&&row.file===note.file?{...row,documentNotice:'Cópia do PDF salva.',documentError:false}:row));}
      else{let url=this.pdfUrls.get(note.key);if(!url){url=URL.createObjectURL(new Blob([note.file],{type:'application/pdf'}));this.pdfUrls.set(note.key,url);}const tab=window.open(url,'_blank');if(!tab)throw new Error('O navegador bloqueou o PDF. Permita a abertura de uma nova aba e tente novamente.');tab.opener=null;}
    }catch(e){this.notes.update(notes=>notes.map(row=>row.key===note.key&&row.file===note.file?{...row,documentNotice:apiError(e),documentError:true}:row));}
    finally{this.documentBusy.set('');}
  }
  ngOnDestroy(){for(const session of this.readings.values())session.cancel();this.readings.clear();for(const key of this.pdfUrls.keys())this.revokePdf(key);}
  keyChanged(key:string,event:Event){this.enterManually(key);const accessKey=(event.target as HTMLInputElement).value;this.notes.update(notes=>notes.map(note=>note.key===key?{...note,accessKey,uploadedId:"",uploadedIdentity:""}:note));}
  numberChanged(key:string,event:Event){this.enterManually(key);const number=(event.target as HTMLInputElement).value;this.notes.update(notes=>notes.map(note=>note.key===key?{...note,number,uploadedId:"",uploadedIdentity:"",origin:""}:note));}
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
