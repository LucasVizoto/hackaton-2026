import "zone.js";
import { inject, provideAppInitializer } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { provideRouter } from "@angular/router";
import { provideIonicAngular } from "@ionic/angular/standalone";
import { AppComponent } from "./app/app";
import { routes } from "./app/routes";
import { Api, authInterceptor } from "./app/core/api";
bootstrapApplication(AppComponent, {
  providers: [
    provideIonicAngular({ mode: "md" }),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideRouter(routes),
    provideAppInitializer(() => inject(Api).restoreSession()),
  ],
}).catch((error) => console.error("Inicialização falhou", error));
