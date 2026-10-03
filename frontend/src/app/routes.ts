import { inject } from "@angular/core";
import { CanActivateFn, Router, Routes } from "@angular/router";
import { Api } from "./core/api";
function homeOf(api: Api) {
  return api.user()?.role === "portaria" ? "/portaria" : "/agenda";
}
function pathOf(url: string) {
  return url.split(/[?#]/)[0];
}
const auth: CanActivateFn = (_route, state) => {
  const api = inject(Api);
  const router = inject(Router);
  const user = api.user();
  if (!user) return router.createUrlTree(["/login"], { queryParams: { perfil: "operador" } });
  const path = pathOf(state.url);
  if (user.role === "portaria" && path !== "/portaria") return router.parseUrl("/portaria");
  if (path === "/chegadas" && !api.can("warehouse")) return router.parseUrl(homeOf(api));
  // The warehouse follows existing appointments; only suppliers and Purchasing schedule.
  if (path === "/agenda/novo" && !api.can("supplier", "purchasing")) return router.parseUrl("/agenda");
  return true;
};
const guest: CanActivateFn = (_route, state) => {
  const api = inject(Api);
  if (!api.user()) return true;
  const home = homeOf(api);
  return pathOf(state.url) === home ? true : inject(Router).parseUrl(home);
};
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
    path: "portaria",
    canActivate: [auth],
    loadComponent: () => import("./features/gate").then((m) => m.GateDesk),
  },
  {
    path: "chegadas",
    canActivate: [auth],
    loadComponent: () => import("./features/gate").then((m) => m.ArrivalInbox),
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
  // "Operação" showed the same calendar as the agenda; old links land on the agenda.
  { path: "operacao", redirectTo: "agenda" },
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
