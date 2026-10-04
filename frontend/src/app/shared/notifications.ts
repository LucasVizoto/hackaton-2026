import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonButton } from '@ionic/angular/standalone';
import { Api, apiError, dateTime, Page } from '../core/api';
import { FeedbackState } from './ui';
interface Notification {id:string;appointment:string;message:string;created_at:string;acknowledged_at:string|null;}
@Component({
  selector:'app-notifications',standalone:true,imports:[RouterLink,IonButton,FeedbackState],
  template:`<details class="notif-box">
    <summary>Avisos operacionais · {{count()}} registros @if(unread()){<span class="notif-badge">{{unread()}} não lidos nesta página</span>}</summary>
    <ion-button fill="outline" [disabled]="busy()" (click)="load()">Atualizar avisos</ion-button>
    @if(error()){<div app-feedback tone="error">{{error()}}</div>}
    @for(n of rows();track n.id){
      <div class="record-context"><strong>{{n.message}}</strong><small class="field-help">{{dt(n.created_at)}}</small>
        <div class="actions"><a [routerLink]="['/agenda',n.appointment]">Abrir recebimento</a>
          @if(!n.acknowledged_at && api.can('warehouse','purchasing','gatehouse')){<ion-button fill="clear" [disabled]="busy()" (click)="acknowledge(n.id)">Marcar como lido</ion-button>}
        </div>
      </div>
    }@empty{<p class="muted">Nenhum aviso disponível.</p>}
    <div class="pagination">
      <ion-button fill="outline" [disabled]="busy()||page===1" (click)="load(page-1)">Anterior</ion-button>
      <span>Página {{page}} · {{unread()}} não lidos nesta página</span>
      <ion-button fill="outline" [disabled]="busy()||!hasNext()" (click)="load(page+1)">Próxima</ion-button>
    </div>
  </details>`,
  styles:[`
    :host { display: block; }
    .notif-box { margin: 0; padding: 0 16px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface); }
    .notif-box > summary { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; color: var(--green); }
    .notif-box[open] { padding-bottom: 12px; }
    .notif-badge { border-radius: var(--radius-full); padding: 2px 8px; font-size: 12px; background: var(--warning-soft); color: var(--warning); }
  `]
})
export class Notifications implements OnInit {
  api=inject(Api);rows=signal<Notification[]>([]);page=1;count=signal(0);hasNext=signal(false);busy=signal(false);error=signal('');dt=dateTime;
  ngOnInit(){void this.load();}
  unread(){return this.rows().filter(n=>!n.acknowledged_at).length;}
  async load(page=this.page){
    this.busy.set(true);this.error.set('');
    try{const result=await this.api.get<Page<Notification>>(`notifications/?page=${page}`);this.page=page;this.count.set(result.count);this.hasNext.set(!!result.next);this.rows.set(result.results);}
    catch(e){this.error.set(apiError(e));}finally{this.busy.set(false);}
  }
  async acknowledge(id:string){
    if(!this.api.can('warehouse','purchasing','gatehouse'))return;
    this.busy.set(true);this.error.set('');
    try{await this.api.post(`notifications/${id}/acknowledge/`,{});await this.load();}
    catch(e){this.error.set(apiError(e));}finally{this.busy.set(false);}
  }
}
