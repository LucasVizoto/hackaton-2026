import { inject, Injectable, signal } from "@angular/core";
import {
  HttpClient,
  HttpErrorResponse,
  HttpInterceptorFn,
} from "@angular/common/http";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Router } from "@angular/router";
import { firstValueFrom, fromEvent, takeUntil } from "rxjs";
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
const sessionCookie = "cocapec_session";
export function sessionCookieAssignment(token: string, secure = false): string {
  return `${sessionCookie}=${encodeURIComponent(token)}; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
}
function readSessionCookie(): string {
  if (typeof document === "undefined" || !document.cookie) return "";
  const row = document.cookie.split("; ").find((item) => item.startsWith(`${sessionCookie}=`));
  try { return row ? decodeURIComponent(row.slice(sessionCookie.length + 1)) : ""; } catch { return ""; }
}
function writeSessionCookie(token: string) {
  const secure = globalThis.location?.protocol === "https:";
  document.cookie = sessionCookieAssignment(token, secure);
}
function clearSessionCookie() {
  document.cookie = `${sessionCookie}=; Path=/; Max-Age=0; SameSite=Lax`;
}
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
  private base = "/api/v2";
  private configured = false;
  async configure() {
    if (this.configured) return;
    if (Capacitor.isNativePlatform()) {
      const config = await firstValueFrom(
        this.http.get<{ nativeApiUrl: string }>("runtime-config.json"),
      );
      this.base = config.nativeApiUrl.replace(/\/$/, "").replace(/\/v1$/, "/v2");
    }
    this.configured = true;
  }
  async get<T>(path: string, signal?: AbortSignal) {
    await this.configure();
    if (signal?.aborted) throw new DOMException("Consulta cancelada", "AbortError");
    const request = this.http.get<T>(`${this.base}/${path}`);
    return firstValueFrom(signal ? request.pipe(takeUntil(fromEvent(signal, "abort"))) : request);
  }
  async websocketUrl(): Promise<string> {
    await this.configure();
    const url = new URL(this.base, globalThis.location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/ws/gate/";
    url.search = "";
    url.searchParams.set("token", this.token());
    url.searchParams.set("stream_version", "2");
    return url.toString();
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
    writeSessionCookie(r.token);
    return r;
  }
  async restoreSession() {
    const token = readSessionCookie();
    if (!token) return;
    this.token.set(token);
    try {
      const user = await this.get<User>("auth/me/");
      this.user.set(user);
    } catch {
      this.token.set("");
      this.user.set(null);
      clearSessionCookie();
    }
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
    clearSessionCookie();
    void this.router.navigateByUrl("/login");
  }
  async blob(path: string) {
    await this.configure();
    return firstValueFrom(
      this.http.get(`${this.base}/${path}`, { responseType: "blob" }),
    );
  }
  async download(path: string, filename: string) {
    return this.saveBlob(await this.blob(path),filename);
  }
  async saveBlob(blob:Blob, filename:string) {
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
      roles.map(role => role === "portaria" ? "gatehouse" : role).includes(this.user()?.role === "portaria" ? "gatehouse" : this.user()?.role ?? "") || this.user()?.role === "admin"
    );
  }
}
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const api = inject(Api);
  return next(
    api.token() && /\/api\/v[12]\//.test(req.url)
      ? req.clone({ setHeaders: { Authorization: `Token ${api.token()}` } })
      : req,
  );
};
export function apiError(error: unknown, context?: "login"): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0)
      return "Não foi possível acessar a API. Confira a conexão e tente novamente.";
    if (error.status === 401)
      return context === "login"
        ? "Usuário ou senha inválidos. Confira as credenciais e tente novamente."
        : "Sessão encerrada. Entre novamente.";
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
export function isWeekend(value: string): boolean {
  const day = new Date(`${value}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}
export function nextBusinessDay(value = today()): string {
  const reference = new Date(`${value}T12:00:00Z`);
  while (reference.getUTCDay() === 0 || reference.getUTCDay() === 6) {
    reference.setUTCDate(reference.getUTCDate() + 1);
  }
  return reference.toISOString().slice(0, 10);
}
export function closedDayMessage(value: string): string {
  const [year, month, day] = value.split("-");
  const label = `${day}/${month}/${year}`;
  const weekday = new Date(`${value}T12:00:00Z`).getUTCDay();
  if (weekday === 6 || weekday === 0) {
    const name = weekday === 6 ? "sábado" : "domingo";
    const [nextYear, nextMonth, nextDay] = nextBusinessDay(value).split("-");
    return `${label} é ${name}. O recebimento ocorre somente de segunda a sexta. Use ${nextDay}/${nextMonth}/${nextYear}.`;
  }
  return `${label} é um feriado configurado. Escolha um dia útil sem feriado.`;
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
