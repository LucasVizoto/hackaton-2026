import { DatePipe } from "@angular/common";
import { Component, inject, OnInit, signal } from "@angular/core";
import {
  FormArray,
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { IonButton, IonSpinner } from "@ionic/angular/standalone";
import {
  Api,
  apiError,
  money,
  originLabel,
  Page,
  previousDay,
} from "../core/api";
import { Catalog } from "../core/catalog";
import { decimal } from "../core/presentation";
import {
  EmptyState,
  FeedbackState,
  FilterBlock,
  LoadingState,
  Origin,
  PageHeader,
  Status,
} from "../shared/ui";
interface Line {
  category: string;
  label?: string;
  price?: string;
  unloading: string;
  removal: string;
  transfer: string;
}
interface Participant {
  worker: string;
  registration?: string;
  name?: string;
  fraction: string;
}
export interface Calculation {
  people_count: number;
  equivalent_days: string;
  production: string;
  floor_per_day: string;
  collective_floor: string;
  total_payable: string;
  supplement: string;
  production_per_equivalent_day: string | null;
  display: { production: string; total_payable: string; supplement: string };
}
export interface Bulletin {
  id: string;
  warehouse: string;
  warehouse_name: string;
  reference_date: string;
  origin: string;
  status: string;
  revision: number;
  lines: Line[];
  participants: Participant[];
  calculation: Calculation;
  history?: { action: string; created_at: string; reason: string }[];
}
@Component({
  standalone: true,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    IonButton,
    EmptyState,
    FeedbackState,
    FilterBlock,
    LoadingState,
    PageHeader,
    Status,
  ],
  template: `<div class="page">
    <app-page-header
      title="Boletins diários"
      subtitle="Produção, equipe e pagamento por local e data de referência."
    >
      <div actions class="actions">
        @if (api.can("warehouse")) {
          <ion-button routerLink="/boletins/novo">Novo boletim</ion-button>
        }
      </div>
    </app-page-header>
    <form
      app-filter-block
      class="filters"
      aria-label="Filtrar boletins"
      [formGroup]="filters"
      (ngSubmit)="load(true)"
    >
      <label
        >Local<select formControlName="warehouse">
          <option value="">Todos os locais</option>
          @for (w of catalog.warehouses(); track w.id) {
            <option [value]="w.id">{{ w.name }}</option>
          }
        </select></label
      ><label>De<input type="date" formControlName="date_from" /></label
      ><label>Até<input type="date" formControlName="date_to" /></label
      ><label
        >Origem<select formControlName="origin">
          <option value="">Todas</option>
          <option value="operacional_registrado">Operação registrada</option>
          <option value="demo_sintetico">Demonstração sintética</option>
        </select></label
      ><ion-button type="submit" fill="outline" [disabled]="busy()"
        >Atualizar</ion-button
      >
    </form>
    @if (error()) {
      <div app-feedback tone="error" class="error">{{ error() }}</div>
    }
    @if (busy()) {
      <app-loading-state label="Carregando boletins…" />
    } @else if (rows().length) {
      <div
        class="table-wrap"
        tabindex="0"
        role="region"
        aria-label="Boletins diários, locais, referências e valores"
      >
        <table>
          <thead>
            <tr>
              <th>Local / referência</th>
              <th>Origem</th>
              <th>Estado</th>
              <th class="numeric">Pessoas</th>
              <th class="numeric">Diárias</th>
              <th class="numeric">Produção</th>
              <th class="numeric">Total a pagar</th>
              <th class="numeric">Complemento</th>
              <th><span class="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            @for (b of rows(); track b.id) {
              <tr>
                <td class="wrap">
                  <strong>{{ b.warehouse_name }}</strong><br />
                  <span class="muted">{{ b.reference_date | date: "dd/MM/yyyy" }}</span>
                </td>
                <td class="wrap">{{ origin(b.origin) }}</td>
                <td><app-status [value]="b.status" /></td>
                <td class="numeric">{{ decimal(b.calculation.people_count) }}</td>
                <td class="numeric">{{ decimal(b.calculation.equivalent_days) }}</td>
                <td class="numeric">{{ money(b.calculation.production) }}</td>
                <td class="numeric">
                  <strong>{{ money(b.calculation.total_payable) }}</strong>
                </td>
                <td class="numeric">{{ money(b.calculation.supplement) }}</td>
                <td>
                  <a
                    [routerLink]="['/boletins', b.id]"
                    [attr.aria-label]="'Abrir boletim de ' + b.warehouse_name + ', referência ' + (b.reference_date | date: 'dd/MM/yyyy')"
                    >Abrir boletim</a
                  >
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    } @else {
      <div app-empty-state class="empty">
        <h2>Nenhum boletim encontrado</h2>
        <p>Confira o local, as datas e a origem selecionados nos filtros.</p>
        @if (api.can("warehouse")) {
          <ion-button routerLink="/boletins/novo" fill="outline">Criar boletim</ion-button>
        }
      </div>
    }
    @if (count() > 0) {
      <div class="pagination">
        <ion-button
          fill="outline"
          (click)="change(-1)"
          [disabled]="page === 1 || busy()"
          >Anterior</ion-button
        ><span>Página {{ page }} · {{ count() }} boletins</span
        ><ion-button
          fill="outline"
          (click)="change(1)"
          [disabled]="page * 100 >= count() || busy()"
          >Próxima</ion-button
        >
      </div>
    }
    <p class="site-note">
      Valores da apuração oficial. Complemento indica produção abaixo do
      piso; sozinho não comprova ociosidade.
    </p>
  </div>`,
})
export class BulletinList implements OnInit {
  api = inject(Api);
  catalog = inject(Catalog);
  private fb = inject(FormBuilder);
  filters = this.fb.nonNullable.group({
    warehouse: [""],
    date_from: [""],
    date_to: [""],
    origin: [""],
  });
  rows = signal<Bulletin[]>([]);
  count = signal(0);
  page = 1;
  error = signal("");
  busy = signal(false);
  money = money;
  decimal = decimal;
  origin = originLabel;
  ngOnInit() {
    void this.catalog.load().catch((e) => this.error.set(apiError(e)));
    void this.load();
  }
  change(n: number) {
    this.page += n;
    void this.load();
  }
  async load(resetPage = false) {
    if (resetPage) this.page = 1;
    this.busy.set(true);
    this.error.set("");
    try {
      const q = new URLSearchParams({
        page_size: "100",
        page: String(this.page),
      });
      Object.entries(this.filters.getRawValue()).forEach(([k, v]) => {
        if (v) q.set(k, v);
      });
      const r = await this.api.get<Page<Bulletin>>(`bulletins/?${q}`);
      this.rows.set(r.results);
      this.count.set(r.count);
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
}
@Component({
  standalone: true,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    IonButton,
    IonSpinner,
    FeedbackState,
    Status,
    Origin,
    PageHeader,
    LoadingState,
  ],
  template: `<div class="page" [attr.aria-busy]="busy()">
    <app-page-header
      [title]="bulletin() ? 'Boletim diário' : 'Novo boletim'"
      subtitle="Registre a produção, confirme a equipe e confira a apuração."
    >
      <ion-button actions fill="outline" routerLink="/boletins">Voltar aos boletins</ion-button>
    </app-page-header>
    @if (error()) {
      <div app-feedback tone="error" class="error">{{ error() }}</div>
    }
    @if (success()) {
      <div app-feedback tone="success" class="success">{{ success() }}</div>
    }
    <app-origin [value]="form.controls.origin.value" />
    @if (bulletin(); as b) {
      <div class="actions record-context">
        <app-status [value]="b.status" /><span class="muted"
          >Revisão {{ b.revision }} · {{ b.warehouse_name }} ·
          {{ b.reference_date | date: "dd/MM/yyyy" }}</span
        >
      </div>
    }
    @if (busy() && !lines.length) {
      <app-loading-state label="Carregando referência, categorias e equipe…" />
    }
    <form [formGroup]="form" (ngSubmit)="save()">
      <section class="panel">
        <h2>Referência</h2>
        <div class="form-grid">
          <label
            >Armazém<select formControlName="warehouse">
              <option value="">Selecione</option>
              @for (w of catalog.warehouses(); track w.id) {
                <option [value]="w.id">{{ w.name }}</option>
              }
            </select></label
          ><label
            >Data de referência<input
              type="date"
              formControlName="reference_date"
            /><span class="field-help"
              >Normalmente o dia anterior; boletim de atividade interna pode
              referir sábado.</span
            ></label
          ><label
            >Origem<select formControlName="origin">
              <option value="operacional_registrado">
                Operação registrada
              </option>
              <option value="demo_sintetico">Demonstração sintética</option>
            </select></label
          >
        </div>
        @if (!bulletin() && !closed()) {
          <details>
            <summary>Reproduzir exemplos oficiais com equipe sintética</summary>
            <p class="muted">
              Preenche as quantidades de referência e onze matrículas
              sintéticas. A prévia é calculada pela API.
            </p>
            <div class="actions">
              <ion-button fill="outline" type="button" (click)="example(false)"
                >Exemplo: 11 diárias</ion-button
              ><ion-button fill="outline" type="button" (click)="example(true)"
                >Exemplo: 10,5 diárias</ion-button
              >
            </div>
          </details>
        }
      </section>
      <section class="panel">
        <h2>Produção por categoria</h2>
        <p class="muted">
          Informe as quantidades de descarga, remoção e transferência.
          As tarifas oficiais acompanham cada categoria.
        </p>
        <div
          class="table-wrap"
          formArrayName="lines"
          tabindex="0"
          role="region"
          aria-label="Produção por categoria, descarga, remoção e transferência"
        >
          <table>
            <thead>
              <tr>
                <th>Categoria</th>
                <th class="numeric">Tarifa (R$)</th>
                <th class="numeric">Descarga</th>
                <th class="numeric">Remoção</th>
                <th class="numeric">Transferência</th>
              </tr>
            </thead>
            <tbody>
              @for (row of lines.controls; track row; let i = $index) {
                <tr [formGroupName]="i">
                  <td class="wrap">
                    {{ rateLabel(row.controls.category.value) }}
                  </td>
                  <td class="numeric">
                    {{ decimal(ratePrice(row.controls.category.value)) }}
                  </td>
                  <td>
                    <input
                      class="table-input"
                      type="number"
                      min="0"
                      step="0.0001"
                      formControlName="unloading"
                      [attr.aria-label]="
                        'Descarga ' + rateLabel(row.controls.category.value)
                      "
                    />
                  </td>
                  <td>
                    <input
                      class="table-input"
                      type="number"
                      min="0"
                      step="0.0001"
                      formControlName="removal"
                      [attr.aria-label]="
                        'Remoção ' + rateLabel(row.controls.category.value)
                      "
                    />
                  </td>
                  <td>
                    <input
                      class="table-input"
                      type="number"
                      min="0"
                      step="0.0001"
                      formControlName="transfer"
                      [attr.aria-label]="
                        'Transferência ' +
                        rateLabel(row.controls.category.value)
                      "
                    />
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel">
        <div class="page-head">
          <div>
            <h2>Equipe participante</h2>
            <p class="muted">
              Até 20 pessoas. Matrícula única no boletim. Fração: uma ou meia
              diária.
            </p>
          </div>
          @if (!closed()) {
            <ion-button
              type="button"
              fill="outline"
              (click)="addParticipant()"
              [disabled]="participants.length >= 20"
              >Adicionar participante</ion-button
            >
          }
        </div>
        @if (participants.length) {
          <div
            class="table-wrap"
            formArrayName="participants"
            tabindex="0"
            role="region"
            aria-label="Equipe participante, matrículas e frações de diária"
          >
            <table>
              <thead>
                <tr>
                  <th>Matrícula / nome</th>
                  <th>Fração</th>
                  <th><span class="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                @for (p of participants.controls; track p; let i = $index) {
                  <tr [formGroupName]="i">
                    <td>
                      <select
                        formControlName="worker"
                        [attr.aria-label]="'Participante ' + (i + 1)"
                      >
                        <option value="">Selecione a matrícula</option>
                        @for (w of catalog.workers(); track w.id) {
                          <option [value]="w.id">
                            {{ w.registration }} · {{ w.name
                            }}{{
                              w.origin === "demo_sintetico"
                                ? " (sintético)"
                                : ""
                            }}
                          </option>
                        }
                      </select>
                    </td>
                    <td>
                      <select
                        formControlName="fraction"
                        [attr.aria-label]="'Fração participante ' + (i + 1)"
                      >
                        <option value="1.0">1 diária</option>
                        <option value="0.5">0,5 diária</option>
                      </select>
                    </td>
                    <td>
                      @if (!closed()) {
                        <button
                          class="remove"
                          type="button"
                          (click)="removeParticipant(i)"
                          [attr.aria-label]="'Remover participante ' + (i + 1)"
                        >
                          Remover
                        </button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <p class="muted">
            Nenhum participante. Produção positiva sem equipe não pode ser
            fechada como custo confiável.
          </p>
        }
        <p class="site-note">
          Hipótese provisória: frações em boletins fechados não ultrapassam uma
          diária por matrícula/data entre locais. Um conflito exige rateio
          explícito.
        </p>
      </section>
      <section class="panel">
        <div class="page-head">
          <div>
            <h2>Apuração oficial</h2>
            <p class="muted">
              Total a pagar = maior valor entre produção e piso coletivo.
            </p>
          </div>
          @if (!closed()) {
            <ion-button
              type="button"
              fill="outline"
              (click)="preview()"
              [disabled]="busy() || form.invalid"
              >Calcular prévia</ion-button
            >
          }
        </div>
        @if (calculation(); as c) {
          <div class="financial-summary" aria-live="polite">
            <div class="financial-total">
              <span>Total a pagar</span>
              <strong>{{ money(c.total_payable) }}</strong>
              <p class="field-help">
                {{ closed() ? "Valor preservado no boletim fechado." : "Confira a prévia antes de fechar o boletim." }}
              </p>
            </div>
            <dl class="metadata">
              <div><dt>Produção</dt><dd>{{ money(c.production) }}</dd></div>
              <div><dt>Piso coletivo</dt><dd>{{ money(c.collective_floor) }}</dd></div>
              <div><dt>Complemento</dt><dd>{{ money(c.supplement) }}</dd></div>
              <div><dt>Pessoas distintas</dt><dd>{{ decimal(c.people_count) }}</dd></div>
              <div><dt>Diárias equivalentes</dt><dd>{{ decimal(c.equivalent_days) }}</dd></div>
              <div><dt>Piso por diária</dt><dd>{{ money(c.floor_per_day) }}</dd></div>
            </dl>
          </div>
          <details>
            <summary>Precisão e origem do cálculo</summary>
            <p>
              P: {{ decimal(c.production) }} · E: {{ decimal(c.equivalent_days) }} · R:
              {{ decimal(c.floor_per_day) }} · T: {{ decimal(c.total_payable) }} · C:
              {{ decimal(c.supplement) }}.
            </p>
            <p class="muted">
              Centavos só na apresentação. Meia diária segue E × 90,1731. A
              referência textual 45,0786 diverge dessa fórmula.
            </p>
          </details>
        } @else {
          <p class="muted">
            Calcule a prévia para conferir produção, piso coletivo e total a pagar.
          </p>
        }
      </section>
      <div class="actions">
        @if (!closed() && api.can("warehouse")) {
          <ion-button type="submit" [disabled]="busy() || form.invalid">
            @if (busy()) {
              <ion-spinner name="dots" />
            }
            Salvar rascunho</ion-button
          >
          @if (bulletin()) {
            <ion-button
              type="button"
              fill="outline"
              (click)="close()"
              [disabled]="busy() || dirty()"
              >Fechar boletim</ion-button
            ><small>Salve alterações antes de fechar.</small>
          }
        }
        @if (closed() && api.can("warehouse")) {
          <ion-button
            type="button"
            fill="outline"
            (click)="showReopen.set(true)"
            >Reabrir com motivo</ion-button
          >
        }
      </div>
    </form>
    @if (showReopen()) {
      <form
        class="panel section"
        [formGroup]="reopenForm"
        (ngSubmit)="reopen()"
      >
        <h2>Reabrir boletim</h2>
        <label
          >Motivo da correção<textarea
            formControlName="reason"
            required
          ></textarea>
        </label>
        <div class="actions section">
          <ion-button type="submit" [disabled]="busy() || reopenForm.invalid"
            >Confirmar reabertura</ion-button
          ><ion-button type="button" fill="outline" (click)="showReopen.set(false)"
            >Cancelar</ion-button
          >
        </div>
      </form>
    }
    <p class="site-note">
      Complemento não significa automaticamente ociosidade. Nenhuma folha ou
      custo de RH integra este cálculo.
    </p>
  </div>`,
})
export class BulletinEditor implements OnInit {
  api = inject(Api);
  catalog = inject(Catalog);
  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  bulletin = signal<Bulletin | null>(null);
  calculation = signal<Calculation | null>(null);
  busy = signal(false);
  error = signal("");
  success = signal("");
  showReopen = signal(false);
  dirty = signal(false);
  money = money;
  decimal = decimal;
  private line = (category: string, l?: Line) =>
    this.fb.nonNullable.group({
      category: [category],
      unloading: [
        l?.unloading ?? "0",
        [Validators.required, Validators.min(0)],
      ],
      removal: [l?.removal ?? "0", [Validators.required, Validators.min(0)]],
      transfer: [l?.transfer ?? "0", [Validators.required, Validators.min(0)]],
    });
  private participant = (p?: Participant) =>
    this.fb.nonNullable.group({
      worker: [p?.worker ?? "", Validators.required],
      fraction: [p?.fraction ?? "1.0", Validators.required],
    });
  form = this.fb.nonNullable.group({
    warehouse: ["", Validators.required],
    reference_date: [previousDay(), Validators.required],
    origin: ["operacional_registrado"],
    lines: new FormArray<ReturnType<BulletinEditor["line"]>>([]),
    participants: new FormArray<ReturnType<BulletinEditor["participant"]>>([]),
  });
  reopenForm = this.fb.nonNullable.group({ reason: ["", Validators.required] });
  get lines() {
    return this.form.controls.lines;
  }
  get participants() {
    return this.form.controls.participants;
  }
  closed() {
    return this.bulletin()?.status === "CLOSED";
  }
  async ngOnInit() {
    this.busy.set(true);
    try {
      await Promise.all([this.catalog.load(), this.catalog.loadRates()]);
      const id = this.route.snapshot.paramMap.get("id");
      if (id) this.apply(await this.api.get<Bulletin>(`bulletins/${id}/`));
      else
        this.catalog.rates().forEach((r) => this.lines.push(this.line(r.code)));
      this.form.valueChanges.subscribe(() => {
        this.dirty.set(true);
        this.calculation.set(null);
        this.success.set("");
      });
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
  apply(b: Bulletin) {
    this.bulletin.set(b);
    this.form.enable({ emitEvent: false });
    this.form.patchValue(
      {
        warehouse: b.warehouse,
        reference_date: b.reference_date,
        origin: b.origin,
      },
      { emitEvent: false },
    );
    this.lines.clear({ emitEvent: false });
    this.catalog.rates().forEach((r) =>
      this.lines.push(
        this.line(
          r.code,
          b.lines.find((l) => l.category === r.code),
        ),
        { emitEvent: false },
      ),
    );
    this.participants.clear({ emitEvent: false });
    b.participants.forEach((p) =>
      this.participants.push(this.participant(p), { emitEvent: false }),
    );
    this.form.controls.warehouse.disable({ emitEvent: false });
    this.form.controls.reference_date.disable({ emitEvent: false });
    this.form.controls.origin.disable({ emitEvent: false });
    if (b.status === "CLOSED") this.form.disable({ emitEvent: false });
    this.calculation.set(b.calculation);
    this.dirty.set(false);
  }
  rateLabel(code: string) {
    return this.catalog.rates().find((r) => r.code === code)?.label ?? code;
  }
  ratePrice(code: string) {
    if (this.closed())
      return (
        this.bulletin()?.lines.find((l) => l.category === code)?.price ??
        "Não disponível"
      );
    return this.catalog.rates().find((r) => r.code === code)?.price ?? "—";
  }
  addParticipant() {
    if (this.participants.length < 20)
      this.participants.push(this.participant());
  }
  removeParticipant(index: number) {
    this.participants.removeAt(index);
  }
  payload() {
    const v = this.form.getRawValue();
    return {
      ...v,
      lines: v.lines.map((l) => ({
        ...l,
        unloading: String(l.unloading ?? 0),
        removal: String(l.removal ?? 0),
        transfer: String(l.transfer ?? 0),
      })),
    };
  }
  async preview() {
    this.busy.set(true);
    this.error.set("");
    try {
      this.calculation.set(
        await this.api.post<Calculation>("bulletins/preview/", this.payload()),
      );
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
  async save() {
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set("");
    this.success.set("");
    try {
      const b = this.bulletin();
      const payload = this.payload();
      const result = b
        ? await this.api.patch<Bulletin>(`bulletins/${b.id}/`, {
            lines: payload.lines,
            participants: payload.participants,
            revision: b.revision,
          })
        : await this.api.post<Bulletin>("bulletins/", payload);
      this.apply(result);
      this.success.set("Boletim salvo.");
      if (!b) await this.router.navigate(["/boletins", result.id]);
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
  async close() {
    const b = this.bulletin();
    if (!b || this.dirty()) return;
    this.busy.set(true);
    this.error.set("");
    this.success.set("");
    try {
      this.apply(
        await this.api.post<Bulletin>(`bulletins/${b.id}/close/`, {
          revision: b.revision,
        }),
      );
      this.success.set(
        "Boletim fechado; tarifa e piso preservados na revisão.",
      );
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
  async reopen() {
    const b = this.bulletin();
    if (!b) return;
    this.busy.set(true);
    this.error.set("");
    this.success.set("");
    try {
      this.apply(
        await this.api.post<Bulletin>(`bulletins/${b.id}/reopen/`, {
          revision: b.revision,
          reason: this.reopenForm.controls.reason.value,
        }),
      );
      this.showReopen.set(false);
      this.success.set("Boletim reaberto com motivo registrado.");
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
  async example(half: boolean) {
    this.error.set("");
    const workers = this.catalog
      .workers()
      .filter((w) => w.origin === "demo_sintetico")
      .slice(0, 11);
    if (workers.length < 11) {
      this.error.set(
        "Execute o seed sintético: os exemplos precisam de 11 matrículas de demonstração.",
      );
      return;
    }
    this.form.controls.origin.setValue("demo_sintetico");
    this.lines.controls.forEach((r) =>
      r.patchValue({ unloading: "0", removal: "0", transfer: "0" }),
    );
    const quantities: Record<
      string,
      { unloading: string; removal: string; transfer: string }
    > = {
      FERTILIZANTES: { unloading: "2378", removal: "400", transfer: "0" },
      AGROQUIMICO: { unloading: "30", removal: "0", transfer: "0" },
      SERVICOS_DIVERSOS: { unloading: "0", removal: "40", transfer: "0" },
    };
    this.lines.controls.forEach((r) => {
      const q = quantities[r.controls.category.value];
      if (q) r.patchValue(q);
    });
    this.participants.clear();
    workers.forEach((w, i) =>
      this.participants.push(
        this.participant({
          worker: w.id,
          fraction: half && i === 10 ? "0.5" : "1.0",
        }),
      ),
    );
    if (!this.form.controls.warehouse.value)
      this.form.controls.warehouse.setValue(
        this.catalog.warehouses()[0]?.id ?? "",
      );
    await this.preview();
  }
}
