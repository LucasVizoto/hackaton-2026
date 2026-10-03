> **Documento v1 preservado.** O contrato atual está em [API v2](v2/api.md). Os campos, permissões e limites abaixo descrevem a versão anterior.

# Contrato da API implementada

Base local: `http://localhost:8000/api/v1/`. Todas as rotas abaixo incluem a barra final. IDs de domínio são UUID; os exemplos usam apenas nomes de campos e não contêm registros reais. Web e Android consomem a mesma API PostgreSQL.

## Autenticação, formatos e erros

| Método e rota | Entrada | Retorno/permite |
|---|---|---|
| `GET health/` | Sem autenticação | `status`, `database`; consulta real ao PostgreSQL |
| `POST auth/login/` | `username`, `password` | `token`, `user` com `id`, `username`, `role`, `supplier_id` |
| `GET auth/me/` | Header de autenticação | Perfil do usuário autenticado |
| `POST auth/logout/` | Header de autenticação | HTTP 204; revoga o token |

Demais rotas exigem `Authorization: Token <token>` e perfil válido. Perfis: `supplier`, `purchasing`, `warehouse`, `management`, `admin`; administrador pode executar as ações autorizadas de qualquer perfil. Fornecedor acessa seus próprios documentos, recebimentos, etapas e recusas. O token fica em memória no cliente, sem armazenamento persistente; o MVP usa um token por usuário e não possui refresh/expiração automática.

Datas usam `YYYY-MM-DD`; timestamps usam ISO 8601 com fuso. Valores decimais monetários são strings exatas. Campos `display` são valores arredondados somente para apresentação. Listas paginadas usam `count`, `next`, `previous`, `results`, com 100 registros por página e parâmetro `page`. Endpoints de indicadores possuem envelope próprio.

Erros tratados têm `error.code` e `error.details`. Os detalhes podem ser mensagem, lista ou mapa por campo. HTTP 400 indica entrada/regra inválida; 401, autenticação; 403, autorização; 404, recurso indisponível ao usuário; 409, conflito de estado/revisão na agenda. Conflito de revisão do boletim retorna 400. O cliente deve mostrar o erro e recuperar o estado antes de repetir, sem anunciar sucesso quando a requisição falha.

## Catálogos e anexos

| Método e rota | Contrato |
|---|---|
| `GET catalog/warehouses/` | Locais físicos: `id`, `code`, `name` |
| `GET catalog/suppliers/` | Fornecedores autorizados; fornecedor vê somente seu cadastro |
| `GET catalog/workers/?registration=...` | Matrículas para perfis internos; fornecedor não recebe trabalhadores |
| `GET catalog/equipment/` | Equipamentos com `purpose`, local-base opcional e `mobile` que aceita nulo quando desconhecido |
| `GET catalog/service-rates/` | Perfis internos; `floor_per_day` e 14 categorias com `code`, `label`, `price` |
| `GET invoices/` e `GET invoices/:id/` | Notas autorizadas; itens, extração, `attachment_id`, `download_url`, origem |
| `POST invoices/upload/` | Multipart: `file` XML/PDF não vazio até 10 MB; `supplier` obrigatório para usuário interno; fornecedor usa seu vínculo. Perfis supplier/purchasing/warehouse |
| `GET attachments/:id/download/` | Download autenticado com `Cache-Control: private, no-store`; sem URL pública |

Upload novo retorna 201; documento de mesmo fornecedor/hash já armazenado retorna 200 sem duplicação. XML usa extração segura com limites, preservando até dez casas de `vUnCom`; status `extracted_unverified` não atesta autenticidade fiscal nem vínculo ao catálogo. PDF tem status `manual` e exige conferência.

## Agenda, validações e operação

| Método e rota | Entrada/retorno principal |
|---|---|
| `GET slots/availability/?date=YYYY-MM-DD` | `calendar_open`, capacidade global, horários/ocupação/disponibilidade; retenções apenas para warehouse/admin |
| `GET appointments/` e `GET appointments/:id/` | Nota/fornecedor autorizados, data/hora, estados independentes, revisão, eventos, visitas e recursos |
| `POST appointments/` | `invoice`, `date`, `time`, `packaging`; `supplier` para usuário interno; opcionais `vehicle_plate`, `notes`, `origin`. Perfis supplier/purchasing/warehouse |
| `PATCH appointments/:id/` | Campos editáveis `invoice`, `packaging`, `vehicle_plate`, `notes`, `expected_revision`; estados/data usam ações específicas |
| `POST appointments/:id/purchase-review/` | Purchasing: `decision` pending/approved/rejected, `order_reference`, `comparison_notes`, `expected_revision`; aprovação requer conferência explícita |
| `POST appointments/:id/warehouse-review/` | Warehouse: `warehouse_ids` (1–4), `notes`, `expected_revision`; confirma destinos após Compras |
| `POST appointments/:id/arrive/` | Warehouse: `occurred_at` opcional, `expected_revision`; chegada independe das aprovações |
| `POST appointments/:id/start/` | Warehouse: `occurred_at` opcional, `expected_revision`; entrada exige chegada, dupla validação, destinos e reserva/data/calendário válidos |
| `POST appointments/:id/finish/` | Warehouse: recursos globais confirmados, `occurred_at`, `expected_revision`; exige etapas concluídas |
| `GET warehouse-visits/` e `GET warehouse-visits/:id/` | Etapas autorizadas, sequência, marcos e recursos |
| `POST warehouse-visits/:id/start/` | Warehouse: `occurred_at`, `expected_revision`; respeita sequência |
| `POST warehouse-visits/:id/finish/` | Warehouse: recursos da etapa, `occurred_at`, `expected_revision` |
| `POST appointments/:id/cancel/` | Supplier/warehouse: `reason`, `expected_revision`; antes da entrada, cria retenção |
| `POST appointments/:id/reschedule/` | Warehouse: `date`, `time`, `reason`, `nature_exception=true`, `expected_revision`; fluxo exclusivo de natureza, transação e justificativa |
| `POST slots/assign-cancelled-capacity/` | Warehouse: `hold_id`, `appointment_id`, `expected_revision` do destinatário; atribuição nominal |
| `GET non-receipts/` e `GET non-receipts/:id/` | Ocorrências autorizadas |
| `POST non-receipts/` | Warehouse: `reason`, `description`, opcionais `appointment`, `supplier`, `vehicle_plate`, `occurred_at`, `origin`, `expected_revision`; aceita ocorrência sem agendamento |

Ações aceitam administrador além do perfil indicado. Recursos exigem `worker_count` inteiro não negativo, `equipment_ids` (lista, inclusive vazia) e `resources_confirmed=true`. Zero/nenhum precisam de confirmação; recursos da etapa não são somados como equipe global. Nas mutações de agenda, a UI envia a revisão mais recente; `expected_revision` é validado quando fornecido. A resposta retorna a revisão atualizada.

Acondicionamentos: `batida`, `paletizada`, `big_bag`; horários: `08:00`, `10:00`, `13:00`, `15:00`. Filtros de agendamentos: `date`, `date_from`, `date_to`, `operation_status`, `supplier`, `origin`. A capacidade é global, com batida exclusiva ou duas unidades paletizadas/big bag, protegida por transações PostgreSQL. Natureza conserva justificativa/exceção e exclusividade; vaga cancelada requer atribuição explícita.

## Boletins

Consulta, tarifas e prévia exigem perfil interno; criação, edição, fechamento e reabertura exigem warehouse/admin.

| Método e rota | Entrada |
|---|---|
| `GET bulletins/` | Filtros `warehouse`, `origin`, `status` DRAFT/CLOSED, `date_from`, `date_to`, `page` |
| `GET bulletins/:id/` | Retorna linhas/participantes, estado, revisão atual e cálculo; snapshots anteriores permanecem persistidos, sem rota de consulta própria |
| `POST bulletins/preview/` | `warehouse`, `reference_date`, `origin`, `lines`, `participants`; calcula sem gravar |
| `POST bulletins/` | Mesmo corpo da prévia; grava rascunho; local/data únicos |
| `PATCH bulletins/:id/` | `revision` atual e linhas/participantes; apenas rascunho, sem mudar local/data/origem |
| `POST bulletins/:id/close/` | `revision`; congela preços/cálculo e cria revisão |
| `POST bulletins/:id/reopen/` | `revision`, `reason`; preserva snapshot anterior |

Cada linha tem `category`, `unloading`, `removal`, `transfer`, com quantidades decimais não negativas de até quatro casas. Cada participante tem `worker` (ID da matrícula) e `fraction` `1.0` ou `0.5`. Categorias/matrículas não se repetem; máximo de 20 participantes. Equipe sintética exige origem `demo_sintetico`. Fechamento valida o rateio provisório entre locais: até uma diária por matrícula/data, sem deduplicar custos de boletins diferentes.

O servidor calcula `P=Σquantidade×tarifa`, `E=Σfrações`, `T=max(P,E×90.1731)` e `C=T−P`. A resposta contém cálculo exato e apresentação em centavos, sem encargos/equipamentos/pagamento de RH. Os exemplos oficiais estão no [relatório gerencial](relatorio_gerencial.md).

## Indicadores, cenário e qualidade

`GET analytics/operations/` e `GET analytics/labor-costs/` exigem perfil interno. Filtros: `date_from`, `date_to`, `warehouse`, `origin`; padrão é operação registrada, do início do mês até a data atual. A resposta informa origem, período, natureza, cobertura/avisos. Custos usam somente boletins fechados e calculam por boletim antes de agregar. Sem boletins, valores monetários são `null`, sem inventar zero. Operação conta recebimentos distintos, preserva datas próprias e informa amostra de tempos; histórico documental não vira caminhão/tempo/custo.

Gestão/admin recebem `source_records`; outros perfis e consultas históricas recebem `null`. O envelope tem `records`, `count`, `returned_count`, `truncated`, com até 100 registros em ordem determinística. O limite afeta links, sem reduzir agregados. Custos identificam boletins por ID/data/local e valores exatos. Operação identifica conclusões em `records`; `arrivals`, `bookings`, `non_receipts` têm envelopes separados com IDs/datas próprias. Não são acrescentados nomes, matrículas ou documentos históricos. Consulte [indicadores](indicadores.md).

`POST analytics/staffing-scenario/` recebe `bulletin` fechado e `equivalent_days` entre 0,5 e 20, em incrementos de meia diária. Retorna situação atual, cenário, diferença monetária e hipóteses. Não grava redução de equipe e não declara economia garantida; a produção constante é condição explícita.

`GET data/quality/` exige perfil interno e retorna lotes ativos, contagens, períodos, pendências e limites agregados. Não retorna linhas originais, códigos, nomes, chaves fiscais, hashes ou caminhos privados. Importação ocorre por comando privado, conforme [instruções](importacao.md), e não por integração SAP.

`baseline` é nulo antes da carga completa. Depois, reúne versão, arquivos por tipo, estoque, observações individuais de RH, notas prontas/pendentes, depósitos, equipamentos e boletim importado. `batches` também inclui as quatro fontes de estoque e as duas folhas anuais separadamente. Não há rotas novas para consultar linhas dessas fontes ou documentos de referência.
