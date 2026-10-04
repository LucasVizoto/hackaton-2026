import "zone.js";
import "@angular/compiler";
import { createEnvironmentInjector, runInInjectionContext, signal } from "@angular/core";
import { FormBuilder } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { Api } from "../src/app/core/api";
import { Catalog } from "../src/app/core/catalog";
import { BulletinEditor } from "../src/app/features/bulletins";
import { bulletinSheet } from "../src/app/features/bulletin-print";

const cases: {name:string;run:()=>Promise<void>}[]=[];
function test(name:string,run:()=>Promise<void>){cases.push({name,run});}
function equal(actual:unknown,expected:unknown){if(actual!==expected)throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);}
function ok(value:unknown,message="Assertion failed"){if(!value)throw new Error(message);}
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
const flush=()=>new Promise(r=>setTimeout(r,0));
const calculation=(total:string)=>({total_payable:total,production:total,supplement:"0",floor_per_day:"90.1731",production_per_equivalent_day:total,display:{production:total,total_payable:total,supplement:"0"}});
async function fixture(post:(path:string,body:unknown)=>Promise<unknown>){
  const catalog={load:async()=>{},loadRates:async()=>{},warehouses:signal([{id:"w1",code:"ADUBO",name:"Adubo"}]),rates:signal([{code:"FERTILIZANTES",label:"Fertilizantes"}]),workers:signal([{id:"p1",name:"Presente",registration:"001",origin:"demo_sintetico"}])};
  const api={can:()=>true,post,getAll:async()=>[],get:async(path:string)=>path.startsWith("tariff-tables")?{current:{rates:[{code:"FERTILIZANTES",price:"0.3224"}]}}:{participants:[{worker:"p1"}],unconfirmed:0,absences:1,absent:[{registration:"002",name:"Ausente"}]}};
  const injector=createEnvironmentInjector([{provide:Api,useValue:api},{provide:Catalog,useValue:catalog},{provide:ActivatedRoute,useValue:{snapshot:{paramMap:{get:()=>null},queryParamMap:{get:(key:string)=>key==="data"?"2026-10-07":key==="origem"?"demo_sintetico":null}}}},{provide:Router,useValue:{navigate:async()=>true}},FormBuilder],null!);
  const component=runInInjectionContext(injector,()=>new BulletinEditor());
  await component.ngOnInit();
  component.toggleWarehouse("w1");
  return {component,dispose:()=>injector.destroy()};
}

test("escala exclui faltantes identificados e usa diária completa",async()=>{
  const {component,dispose}=await fixture(async()=>calculation("90.17"));
  try{equal(component.participants.length,1);equal(component.participants.at(0).controls.worker.value,"p1");equal(component.participants.at(0).controls.fraction.value,"1.0");ok(component.rosterNote().includes("002 · Ausente"));}
  finally{dispose();}
});
test("resposta antiga não reaparece durante o intervalo entre edição e nova prévia",async()=>{
  const pending=deferred<unknown>();const {component,dispose}=await fixture(()=>pending.promise);
  try{const old=component.preview();component.lines.at(0).controls.unloading.setValue("100");pending.resolve(calculation("1"));await old;equal(component.calculation(),null);equal(component.canPrint(),false);}
  finally{dispose();}
});
test("falha da nova prévia impede PDF com valores anteriores",async()=>{
  let fail=false;const {component,dispose}=await fixture(async()=>{if(fail)throw new Error("Falha sintética");return calculation("90.17");});
  try{await component.preview();equal(component.canPrint(),true);component.lines.at(0).controls.unloading.setValue("100");fail=true;await component.preview();equal(component.calculation(),null);equal(component.canPrint(),false);ok(component.previewHold());}
  finally{dispose();}
});
test("fechamento preserva tarifa do snapshot no PDF após mudança de catálogo",async()=>{
  const {component,dispose}=await fixture(async()=>calculation("90.17"));
  try{
    const saved={id:"b1",financial_version:"boletim-v3",status:"CLOSED",reference_date:"2026-10-07",origin:"demo_sintetico",revision:3,lines:[{warehouse:"w1",category:"FERTILIZANTES",unloading:"10",removal:"0",transfer:"0",price:"0.1111"}],participants:[{worker:"p1",fraction:"1.0"}],calculation:calculation("90.17")};
    component.apply(saved as Parameters<BulletinEditor["apply"]>[0]);
    component.dailyRates.set({FERTILIZANTES:"9.9999"});
    const model=(component as unknown as {printModel:()=>Parameters<typeof bulletinSheet>[0]}).printModel();
    equal(model.lines[0].price,"0.1111");const printed=JSON.stringify(bulletinSheet(model));ok(printed.includes('"text":"1,111"'),printed);ok(!printed.includes("99,999"));
  }finally{dispose();}
});
test("desmontagem ignora prévia pendente",async()=>{
  const pending=deferred<unknown>();const {component,dispose}=await fixture(()=>pending.promise);
  const request=component.preview();dispose();pending.resolve(calculation("1"));await request;await flush();equal(component.calculation(),null);
});

const button=document.querySelector<HTMLButtonElement>("#run")!;
button.addEventListener("click",async()=>{const results=document.querySelector("#results")!;results.replaceChildren();button.disabled=true;for(const item of cases){const row=document.createElement("li");try{await item.run();row.textContent="PASS: "+item.name;}catch(error){row.textContent="FAIL: "+item.name+" — "+String(error);}results.append(row);}button.disabled=false;});
