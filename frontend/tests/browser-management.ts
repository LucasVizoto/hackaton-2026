import "zone.js";
import "@angular/compiler";
// Browser-only acceptance runner: real Management class, synthetic API only in tests.
const cases: {name:string;run:()=>Promise<void>}[]=[];
function test(name:string,run:()=>Promise<void>){cases.push({name,run});}
const assert={
  equal:(actual:unknown,expected:unknown)=>{if(actual!==expected)throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);},
  ok:(value:unknown)=>{if(!value)throw new Error("Assertion failed");},
  match:(value:string,pattern:RegExp)=>{if(!pattern.test(value))throw new Error(`Expected ${pattern}: ${value}`);},
};
import { createEnvironmentInjector, runInInjectionContext, signal } from "@angular/core";
import { FormBuilder } from "@angular/forms";
import { Api } from "../src/app/core/api";
import { Catalog } from "../src/app/core/catalog";
import { Management } from "../src/app/features/management";

function deferred<T>() { let resolve!:(value:T)=>void; const promise=new Promise<T>(r=>{resolve=r;}); return {promise,resolve}; }
const costs=(count=0)=>({summary:{bulletin_count:count},daily_series:[],weekly_supplement:{groups:[],leaders:[],closed_bulletins:0,period:{date_from:"2026-10-01",date_to:"2026-10-04"}}});
const flush=()=>new Promise(resolve=>setTimeout(resolve, 0));
function fixture(api:object) {
  const injector=createEnvironmentInjector([{provide:Api,useValue:api},{provide:Catalog,useValue:{warehouses:signal([])}},FormBuilder],null!);
  const component=runInInjectionContext(injector,()=>new Management());
  component.filters.patchValue({date_from:"2026-10-01",date_to:"2026-10-04"});
  return {component,dispose:()=>{component.ngOnDestroy();injector.destroy();}};
}

test("invalid filters retain results and do not call the API",async()=>{
  let calls=0;
  const {component,dispose}=fixture({can:()=>false,get:async()=>{calls++;}});
  try {
    component.filters.patchValue({date_from:"2026-10-05"});
    await component.load();
    assert.ok(component.filterError());
    assert.equal(calls,0);
    assert.equal(component.busy(),false);
  } finally {dispose();}
});

test("a later filter wins even when the API returns the earlier request last",async()=>{
  const first=deferred<unknown>();
  const {component,dispose}=fixture({can:()=>false,get:async(path:string)=>path.includes("date_to=2026-10-04") ? first.promise : path.startsWith("analytics/labor") ? costs(2) : path.startsWith("analytics/operations") ? {received_loads:2} : {results:[]}});
  try {
    const old=component.load();
    component.filters.patchValue({date_to:"2026-10-05"});
    await component.load();
    first.resolve(costs(1));
    await old;
    assert.equal(component.costs()?.summary.bulletin_count,2);
    assert.equal(component.operations()?.received_loads,2);
    assert.equal(component.appliedFilters()?.date_to,"2026-10-05");
    assert.equal(component.busy(),false);
  } finally {dispose();}
});

test("operational failure preserves the successful financial response",async()=>{
  const {component,dispose}=fixture({can:()=>false,get:async(path:string)=>{if(path.startsWith("analytics/operations"))throw new Error("Falha sintética");return path.startsWith("analytics/labor") ? costs(3) : {results:[]};}});
  try {
    await component.load();
    assert.equal(component.costs()?.summary.bulletin_count,3);
    assert.equal(component.costsError(),"");
    assert.ok(component.operationsError());
    assert.equal(component.operations(),null);
  } finally {dispose();}
});

test("provider failure retains local analysis and retry uses the applied filters",async()=>{
  const bodies:Record<string,unknown>[]=[];
  const answer={answer:"Consulta real do adaptador de teste",context:{origin:"demo_sintetico",period:{date_from:"2026-10-01",date_to:"2026-10-04"}}};
  const {component,dispose}=fixture({can:()=>true,get:async(path:string)=>path.startsWith("integrations/") ? {capabilities:{assistant:{available:true}}} : path.startsWith("analytics/labor") ? costs(1) : path.startsWith("analytics/operations") ? {} : {results:[]},post:async(_path:string,body:Record<string,unknown>)=>{bodies.push(body);if(bodies.length===1)throw new Error("Provedor indisponível");return answer;}});
  try {
    component.filters.patchValue({origin:"demo_sintetico",warehouse:"local-a"});
    await component.load(); await flush();
    assert.ok(component.aiError());
    assert.equal(component.aiAnswer(),null);
    assert.equal(component.aiBusy(),false);
    component.filters.patchValue({warehouse:"local-b"});
    await component.generateInsight();
    assert.equal(bodies[1]["warehouse"],"local-a");
    assert.equal(component.aiAnswer()?.answer,answer.answer);
    assert.equal(component.aiError(),"");
  } finally {dispose();}
});

test("late AI response is discarded after a new filter and unavailable AI is explicit",async()=>{
  const oldAnswer=deferred<unknown>(); let queries=0;
  const {component,dispose}=fixture({can:()=>true,get:async(path:string)=>path.startsWith("integrations/") ? {capabilities:{assistant:{available:queries===1}}} : path.startsWith("analytics/labor") ? costs(++queries) : path.startsWith("analytics/operations") ? {} : {results:[]},post:()=>oldAnswer.promise});
  try {
    await component.load(); await flush();
    assert.equal(component.aiBusy(),true);
    component.filters.patchValue({date_to:"2026-10-05"});
    await component.load(); await flush();
    oldAnswer.resolve({answer:"Resposta do período antigo"}); await flush();
    assert.equal(component.aiAnswer(),null);
    assert.equal(component.aiBusy(),false);
    assert.match(component.aiNotice(),/desabilitada ou sem configuração/);
  } finally {dispose();}
});

const runButton=document.querySelector<HTMLButtonElement>("#run")!;
runButton.addEventListener("click",async()=>{
  const results=document.querySelector("#results")!;
  results.replaceChildren();runButton.disabled=true;
  for(const item of cases){
    const row=document.createElement("li");
    try{await item.run();row.textContent="PASS: "+item.name;}
    catch(error){row.textContent="FAIL: "+item.name+" — "+String(error);}
    results.append(row);
  }
  runButton.disabled=false;
});
