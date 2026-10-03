import "zone.js";
import { bootstrapApplication } from "@angular/platform-browser";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { provideRouter } from "@angular/router";
import { provideIonicAngular } from "@ionic/angular/standalone";
import { AppComponent } from "./app/app";
import { routes } from "./app/routes";
import { authInterceptor } from "./app/core/api";
bootstrapApplication(AppComponent, {
  providers: [
    provideIonicAngular({ mode: "md" }),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideRouter(routes),
  ],
}).catch((error) => console.error("Inicialização falhou", error));
