import { Component, inject, OnInit, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { IonButton, IonSpinner } from "@ionic/angular/standalone";
import {
  Api,
  apiError,
  money,
  originLabel,
  RecordData,
  today,
} from "../core/api";
import { Catalog } from "../core/catalog";
import { Bulletin } from "./bulletins";
interface Costs {
  origin: string;
  period: { date_from: string; date_to: string };
  summary: {
    production: string;
    equivalent_days: string;
    total_payable: string;
    supplement: string;
    supplement_share: string | null;
    days_below_floor: number;
    people_count: number;
    bulletin_count: number;
  };
  groups: {
    warehouse: string;
    warehouse_name: string;
    period: RecordData;
    production: string;
    equivalent_days: string;
    total_payable: string;
    supplement: string;
    people_count: number;
    bulletin_count: number;
    diagnosis: string;
    supplement_share: string | null;
    days_below_floor: number;
    evidence?: unknown;
  }[];
  coverage: RecordData;
  warnings: string[];
}
interface Operations {
  origin: string;
  period: { date_from: string; date_to: string };
  summary?: RecordData;
  received_loads?: number | null;
  average_wait_minutes?: number | null;
  average_unloading_minutes?: number | null;
  average_workers_per_receipt?: number | null;
  historical_documentary?: RecordData;
  coverage?: RecordData;
  definitions?: RecordData;
  warnings?: string[];
  [key: string]: unknown;
}
interface Scenario {
  origin: string;
  warehouse_name: string;
  reference_date: string;
  current: RecordData;
  scenario: RecordData;
  difference: string;
  conditional: boolean;
  assumptions: string[];
}
const imports = [ReactiveFormsModule, IonButton, IonSpinner];
@Component({
  standalone: true,
  imports,
  template: `<div class="page">
    <div class="page-head">
      <div>
        <h1>Gestão por local e período</h1>
        <p class="muted">
          Compare produção e piso com a operação registrada e a cobertura
          disponível.
        </p>
      </div>
    </div>
    <form class="filters" [formGroup]="filters" (ngSubmit)="load()">
      <label>De<input type="date" formControlName="date_from" /></label
      ><label>Até<input type="date" formControlName="date_to" /></label
      ><label
        >Local<select formControlName="warehouse">
          <option value="">Todos os locais</option>
          @for (w of catalog.warehouses(); track w.id) {
            <option [value]="w.id">{{ w.name }}</option>
          }
        </select></label
      ><label
        >Origem<select formControlName="origin">
          <option value="operacional_registrado">Operação registrada</option>
          <option value="demo_sintetico">Demonstração sintética</option>
          <option value="historico_importado">Histórico importado</option>
        </select></label
      ><ion-button type="submit" [disabled]="busy()"
        >Aplicar período</ion-button
      >
    </form>
    @if (
      costs()?.origin === "demo_sintetico" ||
      operations()?.origin === "demo_sintetico"
    ) {
      <div class="notice synthetic">
        Demonstração sintética. Valores, equipe e tempos desse conjunto foram
        criados para demonstrar o funcionamento; não são medições da Cocapec.
      </div>
    }
    @if (error()) {
      <div class="error" role="alert">{{ error() }}</div>
    }
    @if (busy()) {
      <div class="loading"><ion-spinner /> Consultando indicadores…</div>
    }
    @if (costs(); as c) {
      <section class="section">
        <h2>Custo dos boletins fechados</h2>
        <p class="muted">
          Resultados aplicados: {{ origin(c.origin) }} ·
          {{ c.period.date_from }} a {{ c.period.date_to }}.
        </p>
        <p class="muted">
          Piso aplicado a cada boletim antes de agregar. Pessoas distintas são
          contadas por matrícula; custos e frações não são deduplicados.
        </p>
        <div class="table-wrap">
          <table class="finance">
            <thead>
              <tr>
                <th>Produção (P)</th>
                <th>Diárias (E)</th>
                <th>Total a pagar (T)</th>
                <th>Complemento (C)</th>
                <th>Complemento / total</th>
                <th>Boletins abaixo do piso</th>
                <th>Pessoas distintas</th>
                <th>Boletins</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{{ money(c.summary.production) }}</td>
                <td>{{ show(c.summary.equivalent_days) }}</td>
                <td>
                  <strong>{{ money(c.summary.total_payable) }}</strong>
                </td>
                <td>{{ money(c.summary.supplement) }}</td>
                <td>{{ percent(c.summary.supplement_share) }}</td>
                <td>{{ c.summary.days_below_floor }}</td>
                <td>{{ c.summary.people_count }}</td>
                <td>{{ c.summary.bulletin_count }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        @if (c.groups.length) {
          <div class="table-wrap section">
            <table>
              <thead>
                <tr>
                  <th>Local / período</th>
                  <th class="numeric">Produção</th>
                  <th class="numeric">Diárias</th>
                  <th class="numeric">Total a pagar</th>
                  <th class="numeric">Complemento</th>
                  <th class="numeric">Complemento / total</th>
                  <th>Leitura do resultado</th>
                </tr>
              </thead>
              <tbody>
                @for (g of c.groups; track g.warehouse + g.period) {
                  <tr>
                    <td>
                      {{ g.warehouse_name }}<br /><small>{{
                        show(g.period)
                      }}</small>
                    </td>
                    <td class="numeric">{{ money(g.production) }}</td>
                    <td class="numeric">{{ g.equivalent_days }}</td>
                    <td class="numeric">{{ money(g.total_payable) }}</td>
                    <td class="numeric">{{ money(g.supplement) }}</td>
                    <td class="numeric">{{ percent(g.supplement_share) }}</td>
                    <td class="wrap metric-description">{{ g.diagnosis }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <div class="empty section">
            Não há boletins fechados para esta origem e período. Não há base
            para concluir dimensionamento em reais.
          </div>
        }
        <details>
          <summary>Origem e cobertura financeira</summary>
          <dl class="metadata">
            @for (entry of entries(c.coverage); track entry[0]) {
              <div>
                <dt>{{ fieldLabel(entry[0]) }}</dt>
                <dd>{{ show(entry[1]) }}</dd>
              </div>
            }
          </dl>
        </details>
        @for (w of c.warnings; track w) {
          <p class="notice section">{{ w }}</p>
        }
      </section>
    }
    @if (operations(); as o) {
      <section class="section">
        <h2>Operação e recursos</h2>
        <p class="muted">
          Resultados aplicados: {{ origin(o.origin) }} ·
          {{ o.period.date_from }} a {{ o.period.date_to }}.
        </p>
        <p class="muted">
          Um caminhão conta uma vez globalmente. Totais por destino podem não
          ser aditivos. Recursos por descarga medem intensidade, não efetivo
          diário.
        </p>
        @for (group of operationGroups(); track group.key) {
          <h3 class="section">{{ fieldLabel(group.key) }}</h3>
          @if (group.rows.length) {
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    @for (col of group.columns; track col) {
                      <th>{{ fieldLabel(col) }}</th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (row of group.rows; track $index) {
                    <tr>
                      @for (col of group.columns; track col) {
                        <td
                          [class.wrap]="
                            col === 'definition' ||
                            col === 'name' ||
                            col === 'warehouse_name'
                          "
                        >
                          {{ show(row[col]) }}
                        </td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="muted">Sem registros no recorte.</p>
          }
        }
        @if (operationsSummary()) {
          <details open>
            <summary>Resumo operacional</summary>
            <dl class="metadata">
              @for (entry of entries(operationsSummary()); track entry[0]) {
                <div>
                  <dt>{{ fieldLabel(entry[0]) }}</dt>
                  <dd>{{ show(entry[1]) }}</dd>
                </div>
              }
            </dl>
          </details>
        }
        @if (o.coverage) {
          <details>
            <summary>Cobertura das medições</summary>
            <dl class="metadata">
              @for (entry of entries(o.coverage); track entry[0]) {
                <div>
                  <dt>{{ fieldLabel(entry[0]) }}</dt>
                  <dd>{{ show(entry[1]) }}</dd>
                </div>
              }
            </dl>
          </details>
        }
        @for (w of o.warnings || []; track w) {
          <p class="notice section">{{ w }}</p>
        }
      </section>
    }
    <section class="panel section">
      <h2>Cenário condicional de diárias</h2>
      <p>
        Conserva a produção do boletim como hipótese e compara o total do
        servidor. A diferença não garante economia nem capacidade de
        atendimento.
      </p>
      <form
        class="filters"
        [formGroup]="scenarioForm"
        (ngSubmit)="calculateScenario()"
      >
        <label
          >Boletim<select formControlName="bulletin">
            <option value="">Selecione um boletim</option>
            @for (b of bulletins(); track b.id) {
              <option [value]="b.id">
                {{ b.reference_date }} · {{ b.warehouse_name }} ·
                {{ origin(b.origin) }}
              </option>
            }
          </select></label
        ><label
          >Diárias no cenário<input
            type="number"
            min="0"
            step="0.5"
            formControlName="equivalent_days" /></label
        ><ion-button
          type="submit"
          fill="outline"
          [disabled]="busy() || scenarioForm.invalid"
          >Calcular cenário</ion-button
        >
      </form>
      @if (scenario(); as s) {
        <p class="muted">
          Cenário calculado: {{ s.warehouse_name }} · {{ s.reference_date }} ·
          {{ origin(s.origin) }}.
        </p>
        @if (s.origin === "demo_sintetico") {
          <p class="notice synthetic">
            Este cenário usa um boletim de demonstração sintética; não
            representa economia ou produtividade medida na Cocapec.
          </p>
        }
        <div class="notice">
          Diferença financeira condicional:
          <strong>{{ money(s.difference) }}</strong>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Medida</th>
                <th>Boletim selecionado</th>
                <th>Cenário</th>
              </tr>
            </thead>
            <tbody>
              @for (e of scenarioEntries(s.current); track e[0]) {
                <tr>
                  <th>{{ fieldLabel(e[0]) }}</th>
                  <td>{{ scenarioValue(e[0], e[1]) }}</td>
                  <td>{{ scenarioValue(e[0], s.scenario[e[0]]) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <ul>
          @for (a of s.assumptions; track a) {
            <li>{{ a }}</li>
          }
        </ul>
      }
    </section>
    <p class="site-note">
      Não há uma série histórica de boletins por local nem tempos históricos
      medidos nos arquivos fornecidos. Complemento não prova ociosidade;
      complemento zero não prova dimensionamento adequado.
    </p>
  </div>`,
})
export class Management implements OnInit {
  private api = inject(Api);
  catalog = inject(Catalog);
  private fb = inject(FormBuilder);
  filters = this.fb.nonNullable.group({
    date_from: [today().slice(0, 8) + "01"],
    date_to: [today()],
    warehouse: [""],
    origin: ["operacional_registrado"],
  });
  scenarioForm = this.fb.nonNullable.group({
    bulletin: ["", Validators.required],
    equivalent_days: ["10.5", [Validators.required, Validators.min(0)]],
  });
  costs = signal<Costs | null>(null);
  operations = signal<Operations | null>(null);
  scenario = signal<Scenario | null>(null);
  bulletins = signal<Bulletin[]>([]);
  error = signal("");
  busy = signal(false);
  money = money;
  percent = (value: string | null) =>
    value === null
      ? "Não disponível"
      : new Intl.NumberFormat("pt-BR", {
          style: "percent",
          maximumFractionDigits: 2,
        }).format(Number(value));
  origin = originLabel;
  entries = (v: RecordData) => Object.entries(v);
  show = (v: unknown): string =>
    v === null || v === undefined
      ? "Não disponível"
      : Array.isArray(v)
        ? v.map((x) => this.show(x)).join(", ")
        : typeof v === "object"
          ? Object.entries(v as RecordData)
              .map(([k, x]) => `${this.fieldLabel(k)}: ${this.show(x)}`)
              .join(" · ")
          : typeof v === "boolean"
            ? v
              ? "Sim"
              : "Não"
            : typeof v === "number"
              ? new Intl.NumberFormat("pt-BR", {
                  maximumFractionDigits: 2,
                }).format(v)
              : String(v);
  ngOnInit() {
    void this.catalog.load().catch((e) => this.error.set(apiError(e)));
    void this.load();
  }
  fieldLabel(k: string) {
    return (
      (
        {
          summary: "Resumo",
          coverage: "Cobertura",
          warehouse_name: "Armazém",
          warehouse: "Local",
          supplier_name: "Fornecedor",
          supplier: "Fornecedor",
          period: "Período",
          date: "Data",
          time: "Horário",
          origin: "Origem",
          source: "Fonte",
          production: "Produção",
          total_payable: "Total a pagar",
          supplement: "Complemento",
          equivalent_days: "Diárias equivalentes",
          people_count: "Pessoas distintas",
          bulletin_count: "Boletins",
          completed_count: "Caminhões concluídos",
          truck_count: "Caminhões",
          distinct_completed_trucks: "Caminhões concluídos distintos",
          arrival_count: "Chegadas",
          waiting_minutes: "Espera (min)",
          unloading_minutes: "Descarga (min)",
          mean_waiting_minutes: "Espera média (min)",
          mean_unloading_minutes: "Descarga média (min)",
          average_wait_minutes: "Espera média (min)",
          average_unload_minutes: "Descarga média (min)",
          average_unloading_minutes: "Descarga média (min)",
          average_workers_per_receipt: "Chapas médios por recebimento",
          received_loads: "Caminhões recebidos",
          loads_by_date: "Cargas por data",
          loads_by_warehouse: "Cargas por local",
          occupied_minutes: "Minutos ocupados",
          utilization_percent: "Utilização (%) indisponível",
          arrivals_by_hour: "Chegadas por hora",
          bookings_by_hour: "Agendamentos por hora",
          non_receipts_by_reason: "Não recebimentos por motivo",
          hour: "Hora",
          completed_records: "Registros concluídos",
          valid_wait_records: "Registros com espera válida",
          excluded_wait_records: "Registros sem espera válida",
          valid_unloading_records: "Registros com descarga válida",
          excluded_unloading_records: "Registros sem descarga válida",
          covered_dates: "Datas cobertas",
          covered_warehouses: "Locais cobertos",
          coverage_ratio: "Proporção de cobertura",
          expected_bulletins: "Boletins esperados",
          note: "Observação",
          rows: "Linhas documentais",
          purchase_orders: "Pedidos distintos",
          receipt_numbers: "Recebimentos documentais",
          by_depot: "Linhas por depósito",
          worker_count: "Chapas por descarga",
          equipment_name: "Equipamento",
          equipment: "Equipamento",
          reason: "Motivo",
          count: "Quantidade",
          value: "Valor",
          unit: "Unidade",
          definition: "Definição",
          denominator: "Denominador",
          warehouses: "Locais",
          by_warehouse: "Por armazém",
          by_supplier: "Por fornecedor",
          by_date: "Por data",
          by_slot: "Por horário",
          suppliers: "Fornecedores",
          non_receipts: "Não recebimentos",
          equipment_usage: "Equipamentos",
          completed_with_times: "Concluídos com horários",
          closed_bulletins: "Boletins fechados",
          draft_bulletins: "Boletins em rascunho",
          date_from: "Início do período",
          date_to: "Fim do período",
          supplement_share: "Participação do complemento",
          total: "Total",
          invoice_mismatch: "Divergência nota/pedido",
          unscheduled_no_capacity: "Sem agendamento e sem vaga",
          nature: "Caso fortuito",
          other: "Outro",
        } as Record<string, string>
      )[k] ?? k.replaceAll("_", " ")
    );
  }
  operationGroups() {
    const data = this.operations();
    if (!data) return [];
    return Object.entries(data)
      .filter(
        ([, v]) => Array.isArray(v) && v.length > 0 && typeof v[0] === "object",
      )
      .map(([key, value]) => {
        const rows = value as RecordData[];
        return {
          key,
          rows,
          columns: Object.keys(rows[0]).filter(
            (k) =>
              !k.endsWith("_id") &&
              k !== "id" &&
              (rows[0][k] === null || typeof rows[0][k] !== "object") &&
              !["warehouse", "supplier", "equipment"].includes(k),
          ),
        };
      });
  }
  operationsSummary(): RecordData {
    const o = this.operations();
    if (!o) return {};
    return (
      o.summary ?? {
        received_loads: o.received_loads,
        average_wait_minutes: o.average_wait_minutes,
        average_unloading_minutes: o.average_unloading_minutes,
        average_workers_per_receipt: o.average_workers_per_receipt,
        ...(o.historical_documentary ?? {}),
      }
    );
  }
  scenarioEntries(v: RecordData) {
    return Object.entries(v).filter(([k]) =>
      ["production", "equivalent_days", "total_payable", "supplement"].includes(
        k,
      ),
    );
  }
  async load() {
    this.busy.set(true);
    this.error.set("");
    this.scenario.set(null);
    try {
      const q = new URLSearchParams();
      Object.entries(this.filters.getRawValue()).forEach(([k, v]) => {
        if (v) q.set(k, v);
      });
      const results = await Promise.allSettled([
        this.api.get<Costs>(`analytics/labor-costs/?${q}`),
        this.api.get<Operations>(`analytics/operations/?${q}`),
        this.api.get<{ results: Bulletin[] }>(
          `bulletins/?${q}&status=CLOSED&page_size=100`,
        ),
      ]);
      if (results[0].status === "fulfilled") this.costs.set(results[0].value);
      else {
        this.costs.set(null);
        this.error.set(apiError(results[0].reason));
      }
      if (results[1].status === "fulfilled")
        this.operations.set(results[1].value);
      else {
        this.operations.set(null);
        this.error.update((v) =>
          [
            v,
            apiError(results[1].status === "rejected" ? results[1].reason : ""),
          ]
            .filter(Boolean)
            .join(" · "),
        );
      }
      if (results[2].status === "fulfilled")
        this.bulletins.set(results[2].value.results);
      else this.bulletins.set([]);
    } finally {
      this.busy.set(false);
    }
  }
  scenarioValue(k: string, v: unknown) {
    return [
      "production",
      "total_payable",
      "supplement",
      "collective_floor",
    ].includes(k)
      ? money(v)
      : this.show(v);
  }
  async calculateScenario() {
    this.busy.set(true);
    this.error.set("");
    try {
      this.scenario.set(
        await this.api.post<Scenario>(
          "analytics/staffing-scenario/",
          this.scenarioForm.getRawValue(),
        ),
      );
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
}
@Component({
  standalone: true,
  imports,
  template: `<div class="page">
    <div class="page-head">
      <div>
        <h1>Origem e cobertura dos dados</h1>
        <p class="muted">
          A ausência de registro permanece ausência; não é convertida em zero.
        </p>
      </div>
      <ion-button fill="outline" (click)="load()" [disabled]="busy()"
        >Atualizar</ion-button
      >
    </div>
    <div class="notice">
      O histórico fornecido contém documentos e movimentações, sem identificador
      confiável de caminhão operacional e sem série de boletins por armazém.
      Tempos só são calculados dos eventos registrados na aplicação.
    </div>
    @if (error()) {
      <div class="error" role="alert">{{ error() }}</div>
    }
    @if (busy()) {
      <div class="loading"><ion-spinner /> Consultando importações…</div>
    }
    @if (data(); as d) {
      @for (e of entries(d); track e[0]) {
        <section class="panel">
          <h2>{{ label(e[0]) }}</h2>
          @if (isRows(e[1])) {
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    @for (c of columns(e[1]); track c) {
                      <th>{{ label(c) }}</th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (r of rows(e[1]); track $index) {
                    <tr>
                      @for (c of columns(e[1]); track c) {
                        <td class="wrap">{{ show(r[c]) }}</td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p>{{ show(e[1]) }}</p>
          }
        </section>
      }
    }
    <section class="panel">
      <h2>Limites conhecidos das fontes</h2>
      <ul>
        <li>
          Peso repetido por pedido: sua semântica e unidade continuam pendentes;
          não soma por linha.
        </li>
        <li>
          Produto pode existir em vários depósitos. Enriquecimento deve
          conservar as linhas originais e preservar registros sem
          correspondência.
        </li>
        <li>
          CSV de mão de obra incompleto: lacunas não são zero; nomes de abas e
          datas requerem conferência.
        </li>
        <li>
          O único boletim preenchido é referência matemática, não série de
          pagamentos históricos.
        </li>
        <li>
          Itens XML usam código do fornecedor; associação ao código interno
          precisa conferência.
        </li>
      </ul>
    </section>
  </div>`,
})
export class DataQuality implements OnInit {
  private api = inject(Api);
  data = signal<RecordData | null>(null);
  error = signal("");
  busy = signal(false);
  entries = (v: RecordData) => Object.entries(v);
  label = (k: string) =>
    (
      ({
        batches: "Lotes de importação",
        issues: "Pendências encontradas",
        source_file: "Arquivo de origem",
        filename: "Arquivo",
        sha256: "Hash do arquivo",
        source_hash: "Hash do arquivo",
        row_count: "Linhas",
        imported_count: "Importados",
        error_count: "Erros",
        status: "Estado",
        kind: "Tipo",
        message: "Pendência",
        created_at: "Registrado em",
        origin: "Origem",
        coverage: "Cobertura",
        warnings: "Limitações",
        data: "Dados",
        results: "Lotes",
      }) as Record<string, string>
    )[k] ?? k.replaceAll("_", " ");
  show = (v: unknown): string =>
    v === null || v === undefined
      ? "Não disponível"
      : typeof v === "object"
        ? Array.isArray(v)
          ? v.map((x) => this.show(x)).join(" · ")
          : Object.entries(v as RecordData)
              .map(([k, x]) => `${this.label(k)}: ${this.show(x)}`)
              .join(" · ")
        : String(v);
  isRows(v: unknown) {
    return Array.isArray(v) && v.length > 0 && typeof v[0] === "object";
  }
  rows(v: unknown) {
    return v as RecordData[];
  }
  columns(v: unknown) {
    return this.isRows(v)
      ? Object.keys((v as RecordData[])[0]).filter(
          (k) => !k.endsWith("_id") && k !== "id",
        )
      : [];
  }
  ngOnInit() {
    void this.load();
  }
  async load() {
    this.busy.set(true);
    this.error.set("");
    try {
      this.data.set(await this.api.get<RecordData>("data/quality/"));
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
}
