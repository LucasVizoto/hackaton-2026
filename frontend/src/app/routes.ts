import { inject } from "@angular/core";
import { CanActivateFn, Router, Routes } from "@angular/router";
import { Api } from "./core/api";
function homeOf(api: Api) { return api.user()?.role === "gatehouse" || api.user()?.role === "portaria" ? "/portaria" : "/agenda"; }
const auth: CanActivateFn = () => inject(Api).user() ? true : inject(Router).createUrlTree(["/login"], {queryParams:{perfil:"operador"}});
const supplierBooking: CanActivateFn = () => inject(Api).user()?.role === "supplier" ? true : inject(Router).createUrlTree(["/agenda"]);
const guest: CanActivateFn = () => { const api=inject(Api); return api.user() ? inject(Router).createUrlTree([homeOf(api)]) : true; };
const roles = (...allowed:string[]):CanActivateFn => () => { const api=inject(Api); return api.can(...allowed) ? true : inject(Router).createUrlTree([homeOf(api)]); };
export const routes: Routes = [
  {
    path: "",
    canActivate: [guest],
    loadComponent: () => import("./features/home").then((m) => m.Home),
  },
  {
    path: "login",
    canActivate: [guest],
    loadComponent: () => import("./features/login").then((m) => m.Login),
  },
  {
    path: "agenda",
    canActivate: [auth, roles("supplier", "warehouse", "purchasing", "management")],
    loadComponent: () =>
      import("./features/receiving").then((m) => m.AppointmentList),
  },
  {
    path: "agenda/novo",
    canActivate: [auth, supplierBooking],
    loadComponent: () =>
      import("./features/appointment-create").then((m) => m.AppointmentCreate),
  },
  {
    path: "agenda/:id",
    canActivate: [auth],
    loadComponent: () =>
      import("./features/receiving").then((m) => m.AppointmentDetail),
  },
  {
    path: "compras",
    canActivate: [auth, roles("purchasing", "management")],
    loadComponent: () =>
      import("./features/receiving").then((m) => m.AppointmentList),
    data: { mode: "compras" },
  },
  {path: "operacao", redirectTo: "agenda"},
  {
    path: "nao-recebimentos",
    canActivate: [auth],
    loadComponent: () =>
      import("./features/receiving").then((m) => m.NonReceipts),
  },
  {
    path: "nao-recebimentos/novo",
    canActivate: [auth, roles("warehouse")],
    loadComponent: () =>
      import("./features/receiving").then((m) => m.NonReceiptCreate),
  },
  {
    path: "nao-recebimentos/:id",
    canActivate: [auth],
    loadComponent: () =>
      import("./features/receiving").then((m) => m.NonReceipts),
  },
  {
    path: "boletins",
    canActivate: [auth, roles("warehouse", "management")],
    loadComponent: () =>
      import("./features/bulletins").then((m) => m.BulletinList),
  },
  {
    path: "boletins/novo",
    canActivate: [auth, roles("warehouse")],
    loadComponent: () =>
      import("./features/bulletins").then((m) => m.BulletinEditor),
  },
  {
    path: "boletins/:id",
    canActivate: [auth, roles("warehouse", "management")],
    loadComponent: () =>
      import("./features/bulletins").then((m) => m.BulletinEditor),
  },
  {
    path: "dashboard",
    canActivate: [auth, roles("warehouse", "management", "purchasing")],
    loadComponent: () =>
      import("./features/dashboard").then((m) => m.Dashboard),
  },
  { path: "gestao", pathMatch: "full", redirectTo: "/dashboard" },
  {
    path: "gestao/logistica",
    canActivate: [auth, roles("warehouse", "management", "purchasing")],
    loadComponent: () => import("./features/logistics").then(m => m.Logistics),
  },
  { path: "qualidade", redirectTo: "/gestao" },
  { path: "portaria/avisos", canActivate: [auth, roles("gatehouse")], loadComponent: () => import("./features/gate").then(m => m.GateDesk) },
  { path: "portaria/chegadas", redirectTo: "/chegadas" },
  { path: "chegadas", canActivate: [auth, roles("gatehouse", "warehouse", "purchasing", "management")], loadComponent: () => import("./features/gate").then(m => m.Arrivals) },
  { path: "revisoes", redirectTo: () => inject(Router).createUrlTree(["/chegadas"], { queryParams: { decisao: "rejected" } }) },
  { path: "portaria", canActivate: [auth, roles("gatehouse", "management")], loadComponent: () => import("./features/receiving").then(m => m.AppointmentList), data: {mode: "portaria"} },
  { path: "pessoas", canActivate: [auth, roles("warehouse", "management")], loadComponent: () => import("./features/people-list").then(m => m.PeopleList) },
  { path: "pessoas/:id", canActivate: [auth, roles("warehouse", "management")], loadComponent: () => import("./features/people").then(m => m.People) },
  { path: "equipamentos", canActivate: [auth, roles("warehouse", "management")], loadComponent: () => import("./features/equipment-catalog").then(m => m.EquipmentCatalog) },
  { path: "descarga", canActivate: [auth, roles("warehouse", "management")], loadComponent: () => import("./features/unloading").then(m => m.Unloading) },
  { path: "escala", canActivate: [auth, roles("warehouse", "management")], loadComponent: () => import("./features/staff-roster").then(m => m.StaffRoster) },
  // O acerto da quinzena é uma visão de Boletins; o endereço antigo continua funcionando.
  { path: "acerto", redirectTo: () => inject(Router).createUrlTree(["/boletins"], { queryParams: { visao: "quinzena" } }) },
  { path: "integracoes", redirectTo: "/gestao" },
  { path: "**", loadComponent: () => import("./features/not-found").then(m => m.NotFound) },
];
