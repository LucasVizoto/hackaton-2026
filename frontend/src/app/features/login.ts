import { Component, inject, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { Router } from "@angular/router";
import { IonButton, IonSpinner } from "@ionic/angular/standalone";
import { Api, apiError } from "../core/api";
@Component({
  standalone: true,
  imports: [ReactiveFormsModule, IonButton, IonSpinner],
  template: `<main class="login-page">
    <section class="login">
      <h1>Recebimento Cocapec</h1>
      <p class="muted">Agenda, operação e boletim diário.</p>
      @if (error()) {
        <div class="error" role="alert">{{ error() }}</div>
      }
      <form [formGroup]="form" (ngSubmit)="submit()">
        <label
          >Usuário<input
            formControlName="username"
            autocomplete="username"
            required /></label
        ><label
          >Senha<input
            type="password"
            formControlName="password"
            autocomplete="current-password"
            required /></label
        ><ion-button type="submit" [disabled]="busy() || form.invalid">
          @if (busy()) {
            <ion-spinner name="dots" />
          }
          Entrar</ion-button
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
