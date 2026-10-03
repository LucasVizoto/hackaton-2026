import { Component, inject, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { Router } from "@angular/router";
import { IonButton, IonIcon, IonSpinner } from "@ionic/angular/standalone";
import { Api, apiError } from "../core/api";
import { BrandMark, FeedbackState, ThemeToggle } from "../shared/ui";
@Component({
  standalone: true,
  imports: [ReactiveFormsModule, IonButton, IonIcon, IonSpinner, BrandMark, FeedbackState, ThemeToggle],
  template: `<main class="login-page">
    <section class="login" aria-labelledby="login-title">
      <div class="login-brand"><app-brand /><app-theme-toggle /></div>
      <h1 id="login-title">Recebimento Cocapec</h1>
      <p class="muted">Agenda, operação e boletim diário.</p>
      @if (error()) {
        <div app-feedback tone="error" class="error">{{ error() }}</div>
      }
      <form [formGroup]="form" (ngSubmit)="submit()">
        <label
          >Usuário<input
            formControlName="username"
            autocomplete="username"
            required /></label
        ><label for="login-password">Senha</label>
        <div class="password-field"><input
            id="login-password"
            [type]="passwordVisible() ? 'text' : 'password'"
            formControlName="password"
            autocomplete="current-password"
            required /><button type="button" class="icon-button" (click)="passwordVisible.set(!passwordVisible())" [attr.aria-label]="passwordVisible() ? 'Ocultar senha' : 'Mostrar senha'" [attr.aria-pressed]="passwordVisible()">@if (passwordVisible()) { <ion-icon name="eye-off-outline" aria-hidden="true" /> } @else { <ion-icon name="eye-outline" aria-hidden="true" /> }</button></div>
        <ion-button type="submit" [disabled]="busy() || form.invalid">
          @if (busy()) {
            <ion-spinner name="dots" />
          }
          Entrar no sistema<ion-icon name="arrow-forward-outline" slot="end" aria-hidden="true" /></ion-button
        >
      </form>
      <p class="site-note">
        Acesso de demonstração. Ao recarregar ou fechar o aplicativo, entre
        novamente. Os registros permanecem no servidor.
      </p>
    </section>
  </main>`,
})
export class Login {
  private api = inject(Api);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  form = this.fb.nonNullable.group({
    username: ["", Validators.required],
    password: ["", Validators.required],
  });
  busy = signal(false);
  error = signal("");
  passwordVisible = signal(false);
  async submit() {
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set("");
    try {
      const { username, password } = this.form.getRawValue();
      await this.api.login(username, password);
      this.form.controls.password.reset();
      await this.router.navigateByUrl("/agenda");
    } catch (e) {
      this.error.set(apiError(e, "login"));
    } finally {
      this.busy.set(false);
    }
  }
}
