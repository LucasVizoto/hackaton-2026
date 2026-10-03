import { inject, Injectable, signal } from "@angular/core";
import {
  HttpClient,
  HttpErrorResponse,
  HttpInterceptorFn,
} from "@angular/common/http";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Router } from "@angular/router";
import { firstValueFrom } from "rxjs";
export interface User {
  id: number;
  username: string;
  role: string;
  supplier_id: string | null;
}
export interface Page<T> {
  count: number;
  results: T[];
  next?: string | null;
  previous?: string | null;
}
export type RecordData = Record<string, unknown>;
const privateAttachment = registerPlugin<{
  save(options: {
    base64: string;
    filename: string;
    mimeType: string;
  }): Promise<{ saved: boolean }>;
}>("PrivateAttachment");
@Injectable({ providedIn: "root" })
export class Api {
  private http = inject(HttpClient);
  private router = inject(Router);
  readonly user = signal<User | null>(null);
  readonly token = signal("");
  private base = "/api/v1";
  private configured = false;
  async configure() {
    if (this.configured) return;
    if (Capacitor.isNativePlatform()) {
      const config = await firstValueFrom(
        this.http.get<{ nativeApiUrl: string }>("runtime-config.json"),
      );
      this.base = config.nativeApiUrl.replace(/\/$/, "");
    }
    this.configured = true;
  }
  async get<T>(path: string) {
    await this.configure();
    return firstValueFrom(this.http.get<T>(`${this.base}/${path}`));
  }
  async post<T>(path: string, body: unknown) {
    await this.configure();
    return firstValueFrom(this.http.post<T>(`${this.base}/${path}`, body));
  }
  async patch<T>(path: string, body: unknown) {
    await this.configure();
    return firstValueFrom(this.http.patch<T>(`${this.base}/${path}`, body));
  }
  async login(username: string, password: string) {
    const r = await this.post<{ token: string; user: User }>("auth/login/", {
      username,
      password,
    });
    this.token.set(r.token);
    this.user.set(r.user);
    return r;
  }
  async logout() {
    try {
      await this.post("auth/logout/", {});
    } finally {
      this.clear();
    }
  }
  clear() {
    this.token.set("");
    this.user.set(null);
    void this.router.navigateByUrl("/login");
  }
  async download(path: string, filename: string) {
    await this.configure();
    const blob = await firstValueFrom(
      this.http.get(`${this.base}/${path}`, { responseType: "blob" }),
    );
    if (Capacitor.getPlatform() === "android") {
      if (blob.size > 10 * 1024 * 1024)
        throw new Error("O anexo excede o limite de 10 MB.");
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
        reader.onerror = () => reject(new Error("Não foi possível ler o anexo."));
        reader.readAsDataURL(blob);
      });
      return (
        await privateAttachment.save({
          base64,
          filename,
          mimeType: blob.type || "application/octet-stream",
        })
      ).saved;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return false;
  }
  can(...roles: string[]) {
    return (
      roles.includes(this.user()?.role ?? "") || this.user()?.role === "admin"
    );
  }
}
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const api = inject(Api);
  return next(
    api.token() && req.url.includes("/api/v1/")
      ? req.clone({ setHeaders: { Authorization: `Token ${api.token()}` } })
      : req,
  );
};
export function apiError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0)
      return "Não foi possível acessar a API. Confira a conexão e tente novamente.";
    if (error.status === 401) return "Sessão encerrada. Entre novamente.";
    const body = error.error as unknown;
    if (typeof body === "string")
      return `Requisição recusada (${error.status}).`;
    if (body && typeof body === "object") {
      const wrapped = (body as RecordData)["error"];
      const details =
        wrapped && typeof wrapped === "object"
          ? ((wrapped as RecordData)["details"] ?? wrapped)
          : body;
      return errorDetails(details);
    }
    return `Requisição recusada (${error.status}).`;
  }
  return error instanceof Error
    ? error.message
    : "Não foi possível completar a ação.";
}
function errorDetails(value: unknown): string {
  if (Array.isArray(value)) return value.map(errorDetails).join("; ");
  if (value && typeof value === "object")
    return Object.entries(value as RecordData)
      .filter(([key]) => key !== "code")
      .map(
        ([key, v]) =>
          `${["detail", "non_field_errors"].includes(key) ? "" : key + ": "}${errorDetails(v)}`,
      )
      .join(" · ");
  return String(value);
}
export function money(value: unknown): string {
  if (value === null || value === undefined || value === "")
    return "Não disponível";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value));
}
export function dateTime(value: string | null | undefined): string {
  if (!value) return "Não registrado";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
export function localTimestamp(value: string): string {
  return new Date(value).toISOString();
}
export function nowLocal(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function today(): string {
  const d = new Date();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
export function previousDay(value = today()): string {
  const reference = new Date(`${value}T12:00:00Z`);
  reference.setUTCDate(reference.getUTCDate() - 1);
  return reference.toISOString().slice(0, 10);
}
export function originLabel(value: string): string {
  return (
    (
      {
        demo_sintetico: "Demonstração sintética",
        historico_importado: "Histórico importado",
        operacional_registrado: "Operação registrada",
      } as Record<string, string>
    )[value] ?? value
  );
}
