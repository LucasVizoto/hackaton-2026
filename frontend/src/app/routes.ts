import { inject } from "@angular/core";
import { CanActivateFn, Router, Routes } from "@angular/router";
import { Api } from "./core/api";
const auth: CanActivateFn = () =>
  inject(Api).user()
    ? true
    : inject(Router).createUrlTree(["/login"], {
        queryParams: { perfil: "operador" },
      });
const guest: CanActivateFn = () =>
  inject(Api).user() ? inject(Router).createUrlTree(["/agenda"]) : true;
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
    canActivate: [auth],
    loadComponent: () =>
      import("./features/receiving").then((m) => m.AppointmentList),
  },
  {
    path: "agenda/novo",
    canActivate: [auth],
    loadComponent: () =>
      import("./features/receiving").then((m) => m.AppointmentCreate),
  },
  {
    path: "agenda/:id",
    canActivate: [auth],
    loadComponent: () =>
      import("./features/receiving").then((m) => m.AppointmentDetail),
  },
  {
    path: "compras",
    canActivate: [auth],
    loadComponent: () =>
      import("./features/receiving").then((m) => m.AppointmentList),
    data: { mode: "compras" },
  },
  {
    path: "operacao",
    canActivate: [auth],
    loadComponent: () =>
      import("./features/receiving").then((m) => m.AppointmentList),
    data: { mode: "operacao" },
  },
  {
    path: "nao-recebimentos",
    canActivate: [auth],
    loadComponent: () =>
      import("./features/receiving").then((m) => m.NonReceipts),
  },
  {
    path: "nao-recebimentos/novo",
    canActivate: [auth],
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
    canActivate: [auth],
    loadComponent: () =>
      import("./features/bulletins").then((m) => m.BulletinList),
  },
  {
    path: "boletins/novo",
    canActivate: [auth],
    loadComponent: () =>
      import("./features/bulletins").then((m) => m.BulletinEditor),
  },
  {
    path: "boletins/:id",
    canActivate: [auth],
    loadComponent: () =>
      import("./features/bulletins").then((m) => m.BulletinEditor),
  },
  {
    path: "gestao",
    canActivate: [auth],
    loadComponent: () =>
      import("./features/management").then((m) => m.Management),
  },
  {
    path: "qualidade",
    canActivate: [auth],
    loadComponent: () =>
      import("./features/management").then((m) => m.DataQuality),
  },
  { path: "**", redirectTo: "" },
];
