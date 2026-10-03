import { Component, computed, inject, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { Api, apiError } from "../core/api";

const rememberedKey = "cocapec.rememberedUser";

@Component({
  standalone: true,
  selector: "app-login",
  imports: [ReactiveFormsModule],
  template: `
    <main class="login-page">
      <div class="beans" aria-hidden="true">
        <svg class="bean bean-tl" viewBox="0 0 90 120">
          <ellipse cx="45" cy="60" rx="30" ry="48" />
          <path d="M45 22c10 18 10 58 0 76" />
        </svg>
        <svg class="bean bean-tr" viewBox="0 0 90 120">
          <ellipse cx="45" cy="60" rx="30" ry="48" />
          <path d="M45 22c10 18 10 58 0 76" />
        </svg>
        <svg class="bean bean-bl" viewBox="0 0 90 120">
          <ellipse cx="45" cy="60" rx="30" ry="48" />
          <path d="M45 22c10 18 10 58 0 76" />
        </svg>
        <svg class="bean bean-br" viewBox="0 0 90 120">
          <ellipse cx="45" cy="60" rx="30" ry="48" />
          <path d="M45 22c10 18 10 58 0 76" />
        </svg>
      </div>
      <header class="login-meta" style="display: flex; justify-content: center;">
        <span class="pill-safra">
          <i></i>
          PORTAL COOPERADO • SAFRA 2026/2027
        </span>
      </header>
      <section class="login-card">
        <div class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 48 48">
            <rect x="8" y="16" width="32" height="20" rx="6" />
            <path d="M16 16c0-6 16-6 16 0" />
            <path d="M40 22h3c2 0 4 2 4 5s-2 5-4 5h-3" />
            <ellipse cx="24" cy="24" rx="7" ry="3" />
          </svg>
        </div>
        <h1>Recebimento Inteligente<br /><span>COCAPEC</span></h1>
        <p class="lede">
          Acesse com suas credenciais de cooperado ou operador
        </p>
        <div class="tabs" role="tablist" aria-label="Tipo de acesso">
          <button
            type="button"
            role="tab"
            [class.is-active]="perfil() === 'cooperado'"
            [attr.aria-selected]="perfil() === 'cooperado'"
            (click)="perfil.set('cooperado')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="9" cy="8" r="3.2" />
              <path d="M4.5 18.5c.6-3.2 2.6-5 4.5-5s3.9 1.8 4.5 5" />
              <path d="m15 11 2 2 4-4" />
            </svg>
            Cooperado /<br />Produtor
          </button>
          <button
            type="button"
            role="tab"
            [class.is-active]="perfil() === 'operador'"
            [attr.aria-selected]="perfil() === 'operador'"
            (click)="perfil.set('operador')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 20V9l8-5 8 5v11h-6v-6H10v6H4z" />
            </svg>
            Operador
          </button>
        </div>
        @if (error()) {
          <div class="error" role="alert">{{ error() }}</div>
        }
        @if (notice()) {
          <p class="notice">{{ notice() }}</p>
        }
        <form [formGroup]="form" (ngSubmit)="submit()">
          <div class="field">
            <div class="field-top">
              <label for="username">{{ userLabel() }}</label>
              <span>{{ userHint() }}</span>
            </div>
            <div class="control">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="4" y="6" width="16" height="12" rx="2" />
                <circle cx="9" cy="12" r="2" />
                <path d="M13 10h5M13 14h3" />
              </svg>
              <input
                id="username"
                formControlName="username"
                [attr.placeholder]="userPlaceholder()"
                autocomplete="username"
                required
              />
            </div>
          </div>
          <div class="field">
            <div class="field-top">
              <label for="password">Senha de Acesso</label>
              <button type="button" class="forgot" (click)="forgot()">
                Esqueceu sua senha?
              </button>
            </div>
            <div class="control">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="5" y="11" width="14" height="9" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
              <input
                id="password"
                formControlName="password"
                [type]="showPassword() ? 'text' : 'password'"
                placeholder="••••••••"
                autocomplete="current-password"
                required
              />
              <button
                type="button"
                class="eye"
                (click)="showPassword.set(!showPassword())"
                [attr.aria-label]="
                  showPassword() ? 'Ocultar senha' : 'Mostrar senha'
                "
              >
                @if (showPassword()) {
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3 3l18 18" />
                    <path d="M10.6 10.6A3 3 0 0 0 12 15a3 3 0 0 0 2.4-1.2" />
                    <path
                      d="M9.9 5.1A10.9 10.9 0 0 1 12 5c6 0 10 7 10 7a18.4 18.4 0 0 1-4.2 4.8M6.1 6.1C3.7 7.8 2 12 2 12s4 7 10 7a10.6 10.6 0 0 0 3.7-.6"
                    />
                  </svg>
                } @else {
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                }
              </button>
            </div>
          </div>
          <div class="row-options">
            <label class="remember">
              <input type="checkbox" formControlName="remember" />
              Lembrar acesso
            </label>
          </div>
          <button type="submit" class="submit" [disabled]="busy() || form.invalid">
            @if (busy()) {
              Entrando...
            } @else {
              Entrar no Sistema
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            }
          </button>
        </form>
      </section>
      <footer class="login-legal">
        <span>© 2026 COCAPEC • Todos os direitos reservados</span>
        <span>
          <a href="https://www.cocapec.com.br/governanca-e-transparencia#lgpd" target="_blank" rel="noreferrer"
            >Privacidade &amp; LGPD</a
          >
          • Alta Mogiana
        </span>
      </footer>
    </main>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100dvh;
      }
      .login-page {
        position: relative;
        overflow: hidden;
        min-height: 100dvh;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 28px 16px 18px;
        background: var(--login-canvas);
        color: var(--login-ink);
      }
      .beans {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
      .bean {
        position: absolute;
        width: 150px;
        height: 200px;
        fill: var(--login-bean);
        opacity: 0.55;
      }
      .bean path {
        fill: none;
        stroke: var(--login-crease);
        stroke-width: 6;
        stroke-linecap: round;
      }
      .bean-tl {
        top: -36px;
        left: -18px;
        transform: rotate(-28deg);
      }
      .bean-tr {
        top: -8px;
        right: 8px;
        transform: rotate(18deg);
        width: 120px;
      }
      .bean-bl {
        left: 36px;
        bottom: 72px;
        width: 90px;
        opacity: 0.35;
        transform: rotate(-12deg);
      }
      .bean-br {
        right: -10px;
        bottom: 28px;
        transform: rotate(22deg);
      }
      .login-meta,
      .login-card,
      .login-legal {
        position: relative;
        width: min(440px, 100%);
      }
      .login-meta {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin-bottom: 22px;
      }
      .pill-safra,
      .pill-secure {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.02em;
        white-space: nowrap;
      }
      .pill-safra {
        background: var(--login-pill);
        color: var(--login-navy);
        border: 1px solid var(--login-line);
        border-radius: var(--radius-full);
        padding: 8px 12px;
        box-shadow: var(--shadow-card);
      }
      .pill-safra i {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--brand-secondary);
      }
      .pill-secure {
        color: #b0892a;
      }
      .pill-secure svg {
        width: 16px;
        height: 16px;
      }
      .login-card {
        background: var(--login-card);
        border-radius: var(--radius-lg);
        padding: 28px 28px 26px;
        box-shadow: var(--shadow-card);
        text-align: center;
      }
      .brand-mark {
        width: 58px;
        height: 58px;
        margin: 0 auto 14px;
        border-radius: 16px;
        background: var(--login-mark);
        display: grid;
        place-items: center;
      }
      .brand-mark svg {
        width: 34px;
        height: 34px;
        fill: none;
        stroke: var(--login-navy);
        stroke-width: 2;
        stroke-linecap: round;
      }
      h1 {
        margin: 0;
        font-size: 26px;
        line-height: 1.15;
        color: var(--login-navy);
        font-weight: 750;
      }
      h1 span {
        font-weight: 800;
        letter-spacing: 0.01em;
      }
      .lede {
        margin: 10px 0 18px;
        color: var(--login-muted);
        font-size: 13px;
        max-width: none;
      }
      .tabs {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        padding: 5px;
        background: var(--login-track);
        border-radius: var(--radius-full);
        margin-bottom: 18px;
      }
      .tabs button {
        border: 0;
        background: transparent;
        min-height: 48px;
        border-radius: var(--radius-full);
        color: var(--login-navy);
        font: inherit;
        font-size: 13px;
        font-weight: 700;
        line-height: 1.15;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        cursor: pointer;
      }
      .tabs svg {
        width: 18px;
        height: 18px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
        flex: none;
      }
      .tabs .is-active {
        background: var(--login-fill);
        color: var(--login-fill-contrast);
      }
      .error,
      .notice {
        text-align: left;
        font-size: 13px;
        margin: 0 0 14px;
        padding: 12px 14px;
        border-radius: 12px;
      }
      .error {
        background: var(--negative-bg);
        color: var(--negative);
        border: 1px solid transparent;
      }
      .notice {
        background: var(--info-soft);
        color: var(--login-ink);
        max-width: none;
      }
      form {
        text-align: left;
      }
      .field {
        margin-bottom: 16px;
      }
      .field-top {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 8px;
        margin-bottom: 6px;
      }
      .field-top label {
        font-size: 13px;
        font-weight: 700;
        color: var(--login-ink);
      }
      .field-top span,
      .forgot {
        font-size: 12px;
        color: var(--login-muted);
        font-weight: 600;
      }
      .forgot {
        border: 0;
        background: none;
        padding: 0;
        color: var(--login-navy);
        cursor: pointer;
      }
      .control {
        display: flex;
        align-items: center;
        gap: 8px;
        background: var(--login-input);
        border: 1px solid var(--login-line);
        border-radius: 14px;
        min-height: 48px;
        padding: 0 12px;
      }
      .control svg {
        width: 18px;
        height: 18px;
        fill: none;
        stroke: #8b97a8;
        stroke-width: 1.8;
        stroke-linecap: round;
        flex: none;
      }
      .control input {
        flex: 1;
        min-width: 0;
        width: auto;
        border: 0;
        border-radius: 0;
        background: transparent;
        color: var(--login-ink);
        min-height: 46px;
        padding: 0;
        box-shadow: none;
      }
      .control input:-webkit-autofill,
      .control input:-webkit-autofill:hover,
      .control input:-webkit-autofill:focus {
        -webkit-text-fill-color: var(--login-ink);
        caret-color: var(--login-ink);
        box-shadow: 0 0 0 1000px var(--login-input) inset;
        transition: background-color 99999s ease-out;
      }
      .eye {
        border: 0;
        background: none;
        padding: 6px;
        color: #8b97a8;
        cursor: pointer;
      }
      .eye svg {
        width: 18px;
        height: 18px;
      }
      .row-options {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin: 6px 0 18px;
      }
      .remember {
        flex-direction: row;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 600;
        color: var(--login-ink);
      }
      .remember input {
        width: 16px;
        height: 16px;
        min-height: 16px;
        accent-color: var(--login-navy);
      }
      .terminal {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: var(--brand-secondary);
        font-size: 12px;
        font-weight: 700;
      }
      .terminal i {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--brand-secondary);
      }
      .submit {
        width: 100%;
        min-height: 48px;
        border: 0;
        border-radius: 14px;
        background: var(--login-fill);
        color: var(--login-fill-contrast);
        font: inherit;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        cursor: pointer;
      }
      .submit svg {
        width: 18px;
        height: 18px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .submit:hover:not(:disabled) {
        background: var(--login-fill-hover);
      }
      .login-legal {
        margin-top: auto;
        padding-top: 22px;
        display: flex;
        justify-content: space-between;
        gap: 12px;
        color: var(--login-muted);
        font-size: 11px;
      }
      .login-legal a {
        color: var(--login-navy);
        text-decoration: none;
        font-weight: 700;
      }
      @media (max-width: 640px) {
        .login-meta {
          flex-direction: column;
        }
        .login-legal {
          flex-direction: column;
          text-align: center;
        }
        .bean-bl,
        .bean-br {
          display: none;
        }
      }
    `,
  ],
})
export class Login {
  private api = inject(Api);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private fb = inject(FormBuilder);
  perfil = signal<"cooperado" | "operador">(
    this.route.snapshot.queryParamMap.get("perfil") === "cooperado"
      ? "cooperado"
      : "operador",
  );
  showPassword = signal(false);
  busy = signal(false);
  error = signal("");
  notice = signal("");
  userLabel = computed(() =>
    this.perfil() === "cooperado"
      ? "Matrícula do Cooperado ou CPF"
      : "Usuário de acesso",
  );
  userHint = computed(() =>
    this.perfil() === "cooperado" ? "Ex: 2190-3" : "Operador interno",
  );
  userPlaceholder = computed(() =>
    this.perfil() === "cooperado"
      ? "Ex: 2190-3 ou 000.000.000-00"
      : "Informe seu usuário",
  );
  form = this.fb.nonNullable.group({
    username: [
      localStorage.getItem(rememberedKey) ?? "",
      Validators.required,
    ],
    password: ["", Validators.required],
    remember: [Boolean(localStorage.getItem(rememberedKey))],
  });
  forgot() {
    this.notice.set(
      "Na demonstração local, use as credenciais fornecidas para o perfil operador.",
    );
  }
  async submit() {
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set("");
    this.notice.set("");
    try {
      const { username, password, remember } = this.form.getRawValue();
      if (remember) localStorage.setItem(rememberedKey, username);
      else localStorage.removeItem(rememberedKey);
      const session = await this.api.login(username, password);
      this.form.controls.password.reset();
      await this.router.navigateByUrl(["portaria", "gatehouse"].includes(session.user.role) ? "/portaria" : "/agenda");
    } catch (e) {
      this.error.set(apiError(e, "login"));
    } finally {
      this.busy.set(false);
    }
  }
}
