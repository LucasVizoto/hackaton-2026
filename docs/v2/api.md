# API v2 — contrato implementado

Base local: `/api/v2/`. Rotas terminam em `/`; IDs de domínio são UUID; datas usam `YYYY-MM-DD` e horários ISO 8601 com fuso. Valores monetários são strings decimais. O código de referência está em `backend/receiving/urls_v2.py`, `labor/urls_v2.py`, `analytics/urls_v2.py` e `integrations/urls.py`.

Autenticação mantém `POST auth/login/`, `GET auth/me/`, `POST auth/logout/` e `Authorization: Token <token>`. O cliente pode recuperar o token do cookie local e confirmar sua validade em `auth/me/`; logout revoga o token no servidor e limpa a sessão local. Perfis v2: fornecedor (`supplier`), Compras (`purchasing`), Armazém (`warehouse`), Portaria (`gatehouse`), Gestão (`management`) e administrador (`admin`). A autenticação v1 conserva o nome `portaria`; as duas identidades persistidas têm o mesmo escopo de Portaria, sem renomear registros históricos. Portaria não acessa boletins, pessoas, folha ou indicadores financeiros. Fornecedor consulta somente seus documentos e recebimentos. Administrador pode executar as ações autorizadas dos demais perfis, exceto criar agendamentos: essa ação pertence somente a Fornecedor vinculado, na v1 e na v2.

Listas paginadas usam `count`, `next`, `previous`, `results`. Erros usam `error.code` e `error.details`. Mutações de recebimento v2 exigem `expected_revision`; as de boletim exigem `revision`. Conflito de estado da agenda retorna 409; conflito de revisão do boletim retorna 400. O cliente deve recuperar a versão atual e preservar os dados não salvos. `available_actions` contém `{code,allowed,reason}` por ação e é calculado pelo servidor.

## Catálogos e documentos

| Rota | Contrato |
|---|---|
| `GET catalog/warehouses/`, `catalog/suppliers/` | Locais e fornecedores autorizados |
| `GET/POST catalog/workers/`; `GET/PATCH/DELETE catalog/workers/:id/` | Nome, matrícula, origem e `is_active`; Armazém/Gestão administram, administrador também; DELETE inativa |
| `GET/POST catalog/equipment/`; `GET/PATCH/DELETE catalog/equipment/:id/` | Código, nome, local-base, mobilidade, finalidade, `is_active`; alterações por Armazém/admin; DELETE inativa |
| `GET catalog/service-rates/` | Piso, 14 categorias e `daily_services` FULL/HALF com tarifas distintas |
| `GET invoices/`, `GET invoices/:id/`, `POST invoices/upload/` | Documento privado XML/PDF; upload autenticado multipart `file`, fornecedor quando interno; até 10 MB |
| `GET attachments/:id/download/` | Original privado, sem URL pública |

Cadastros inativos continuam disponíveis para consultar o histórico; novas atividades, participantes e recursos recusam inativos. O filtro `is_active=true/false` restringe catálogos. A origem histórica exige importação rastreável. Número de NF precisa ser numérico e válido, sem truncamento; extração não equivale a aprovação fiscal. Chave é opcional; quando informada, exige 44 dígitos ASCII, dígito verificador e número correspondente. Número ausente na leitura deve ser preenchido manualmente. Novos uploads v1/v2 seguem essa regra; documentos históricos não são reescritos.

## Aviso avulso da Portaria

As rotas `gate-arrivals/` existem em `/api/v1/` e `/api/v2/`. O aviso `GateArrival` reúne foto, placa, placa do cavalo, motorista e número da NF; os dois campos de placa são obrigatórios neste formulário preservado de `main`. Ele não é um `Appointment` e não cria fornecedor, NF, reserva, chegada de recebimento nem visita automaticamente.

| Método e rota | Contrato |
|---|---|
| `GET/POST gate-arrivals/` | Portaria consulta/cria seus próprios avisos; Armazém/admin consultam todos. POST multipart inclui os dados e a foto. |
| `GET gate-arrivals/:id/file/` | Foto original protegida pela mesma autorização do aviso; JPEG, PNG, WebP, HEIC ou HEIF verificados pelo conteúdo. |
| `POST gate-arrivals/:id/seen/` | Armazém/admin registram ciência; repetição mantém a ciência anterior. |

A lista é paginada em 50 itens e retorna `count`, `next`, `previous`, `results` e `unread`. `?summary=1` é restrito a Armazém/admin. O número digitado na v2 deve conter de 1 a 9 dígitos ASCII, sem zero inicial ou chave de acesso; a v1 mantém compatibilidade com separadores de milhar válidos. A leitura OCR local apenas sugere o número canônico para conferência humana: remove zeros de preenchimento da sugestão, prioriza o número impresso com rótulo e só extrai o campo da chave quando identifica uma chave completa e plausível. Nenhuma digitação de 44 dígitos é truncada pelo formulário ou servidor.

## Recebimento de várias notas e quatro marcos

| Método e rota | Entrada e efeito |
|---|---|
| `GET slots/availability/?date=...&packaging=...` | Capacidade global e disponibilidade compatível com acondicionamento; alternativamente `date_from` + `date_to`, até 62 dias inclusivos, retorna `days` com os mesmos dados diários |
| `GET/POST appointments/`; `GET/PATCH appointments/:id/` | Criação: `invoice_ids` de 1 a 30 notas distintas do mesmo fornecedor, `date`, `time`, `packaging`, `vehicle_plate`; somente Fornecedor cria, usando seu próprio vínculo; opcionais `articulated`, `tractor_plate`, `carrier_name`, `driver_name`, `booking_kind`, `notes`, `idempotency_key` |
| `POST appointments/:id/purchase-review/` | Compras: `decision`, referência/evidência de conferência, revisão |
| `POST appointments/:id/forward-to-purchasing/` | Armazém antes da descarga: `reason`, `expected_revision`, `idempotency_key`; mantém reserva/chegada/etapas, reinicia ambas aprovações, audita e notifica Compras |
| `POST appointments/:id/warehouse-review/` | Armazém: `warehouse_ids` em sequência, notas e revisão; exige Compras aprovada |
| `POST appointments/:id/gate-check-in/` | Portaria: chegada à unidade; `occurred_at` opcional, revisão; independe de aprovação |
| `POST warehouse-visits/:id/check-in/` | Armazém: entrada no local; exige chegada, ambas aprovações e etapas anteriores concluídas |
| `POST warehouse-visits/:id/check-out/` | Armazém: saída do local, revisão, horário e recursos confirmados; última etapa exige conferência documental resolvida |
| `POST appointments/:id/gate-check-out/` | Portaria: saída da unidade; exige chegada e descarga concluída, cancelamento ou não recebimento |
| `POST appointments/:id/correct-time/` | `target`, `occurred_at`, `reason`, revisão e `visit_id` quando local; cada perfil corrige os próprios marcos com auditoria |
| `POST appointments/:id/cancel/` | Motivo e revisão; antes da descarga; gera retenção de capacidade |
| `POST appointments/:id/reschedule/` | Data/horário, motivo, `nature_exception=true`, revisão; preserva chegada já observada e libera a vaga de origem |
| `POST slots/assign-cancelled-capacity/` | Atribuição nominal de retenção para outro recebimento, por responsável; libera a vaga anterior do destinatário |
| `GET/POST non-receipts/` | Ocorrência vinculada ou avulsa; motivo, descrição e autor |
| `POST appointments/:id/exceptions/` | `kind`, descrição, horário e revisão; atraso, ausência, natureza, divergência ou outra ocorrência |
| `GET notifications/`; `POST notifications/:id/acknowledge/` | Caixa interna por perfil, com deduplicação e ciência |

A origem do recebimento é derivada pelo servidor; não enviar `origin`. Trocar notas ou acondicionamento invalida aprovações aplicáveis. `articulated=true` exige placa do cavalo. `machine_implement`, `paletizada` e `big_bag` ocupam uma unidade cada, até duas por horário. Apenas `batida` é exclusiva. A entrada `maquina_implemento` é aceita como alias e normalizada para `machine_implement`. `booking_kind=spontaneous` identifica chegada espontânea, sem dispensar a capacidade. Cadastros assistidos anteriores preservam essa identificação; usuários internos não criam novos agendamentos.

Nas ações, `idempotency_key` opcional permite repetir o mesmo comando sem repetir seu efeito. Reutilizar a chave com outro ator, conteúdo ou ação é conflito. Recursos da etapa usam `worker_count`, `equipment_ids` e `resources_confirmed=true`; ausência de registro não vira zero. O status de operação `completed` indica descarga concluída; o marco de saída da Portaria é separado.

## Conferência, divergência e saldo confirmado

`POST appointments/:id/receipt-lines/` recebe `invoice`, `invoice_item` quando extraído, quantidades declarada/observada/aceita/recusada, unidade, motivo de divergência e revisão. `line_id` corrige uma linha existente; `observed_quantity = accepted_quantity + rejected_quantity`. Todas as notas e itens precisam de conferência; nota manual exige ao menos uma linha. Divergência deixa decisão pendente e notifica Compras.

`POST appointments/:id/receipt-review/` recebe `line_id`, `decision=approved|rejected`, justificativa e revisão; somente Compras/admin decide. Quantidades aceitas são controladas contra os limites disponíveis. `purchase_order_line` vincula um pedido confirmado localmente; `previous_receipt_line` identifica uma entrega complementar anterior, sem reutilizar a NF como prova de saldo do pedido.

`GET/POST purchase-orders/` registra fornecedor, referência, evidência `confirmation_notes` e itens com descrição, unidade e quantidade pedida. Cada item retorna quantidade aceita e saldo remanescente. Trata-se de cadastro confirmado no aplicativo; não há leitura ou sincronização SAP. Unidades diferentes não são convertidas automaticamente.

## Pessoas, atividades e boletim

| Método e rota | Contrato |
|---|---|
| `GET/POST bulletins/`; `GET/PATCH bulletins/:id/` | `warehouse` responsável financeiro, `reference_date`, `lines`, `participants`; local/data únicos; origem inferida para equipe exclusivamente sintética quando omitida |
| `POST bulletins/preview/` | Mesmo corpo e `bulletin` opcional para rascunho existente; inclui fontes persistidas, valida local/data/origem e retorna `individual_allocations` sem gravar |
| `POST bulletins/:id/close/` | `revision`; congela cálculo, preços e parcelas individuais |
| `POST bulletins/:id/reopen/` | `revision`, `reason`; preserva snapshots e parcelas antigas como inativas |
| `GET bulletins/:id/history/` | Revisões, autor, motivo e snapshots |
| `POST bulletins/:id/transfer-worker/` | `worker`, `target_bulletin`, revisão dos dois boletins e `reason`; mesma data/origem; reabre os fechados e preserva a trilha |
| `GET/POST labor-activities/`; `GET/PATCH labor-activities/:id/` | Pessoa, data, origem, local, recebimento/equipamento opcionais, tipo, presença, uso, horários, notas; correção exige revisão e motivo |
| `GET workers/:id/statement/` | Período/origem; dias, responsável pelo custo, atividades, parcelas e cobertura; RH fica em seção separada, exclusiva de Gestão/admin |
| `GET/POST labor-rule-occurrences/`; `POST labor-rule-occurrences/:id/resolve/` | Código, descrição, pessoa/fração proposta/atividade/horários opcionais; resolução documentada por Gestão/admin |
| `GET/POST production-records/`; `PATCH production-records/:id/` | Origem única `source_key` por origem; produção de um boletim; correção de quantidade exige revisão/motivo e conserva chave/preço |

Cada participante informa `worker` e `fraction` 1 ou 0,5; máximo de 20 pessoas. Uma pessoa/data/origem tem um único vínculo financeiro, inclusive no rascunho. Ela pode ter muitas atividades em diferentes locais e recebimentos. Atividade não gera nova produção nem uma segunda diária automaticamente.

Atividades usam `RECEIVING`, `INTERNAL`, `MACHINE` ou `OTHER`; presença usa `PLANNED`, `PRESENT` ou `ABSENT`. `used=true` exige presença confirmada. O equipamento fixo deve pertencer ao local. `daily_services=[{kind:FULL|HALF,quantity}]` acrescenta serviço à produção com tarifas 90.1731/45.0786; isso não altera a fração de presença.

Parcelas retornam `worker`, `fraction`, `policy_version`, `exact`, `display`. `exact.rationals` preserva numerador/denominador; `display` contém produção atribuída, complemento, piso, total e `rounding_adjustment`. A soma em centavos reconcilia com cada boletim. Legados não recebem parcelas retroativas inventadas. O extrato retorna totais nulos quando nenhuma parcela fechada foi registrada.

O extrato da pessoa pagina apuração e RH independentemente: `day_page` e `rh_page` começam em 1; `page_size` tem padrão e máximo 100. Cada seção retorna `pagination={count,page,pages,page_size,next_page,previous_page}`. Totais, cobertura e qualidade consideram o período completo, sem repetir somas por página. A exportação da tela identifica a página selecionada. Datas/origens legadas com mais de um boletim para a pessoa recebem `LEGACY_MULTIPLE_BULLETINS`; a cobertura informa `legacy_conflict`, `legacy_conflict_days` e `legacy_conflict_bulletins`. O aviso não altera snapshots nem cria reconciliação financeira retroativa.

Fração excepcional/saída antecipada/extra/diária especial pode ser registrada como ocorrência, com `proposed_fraction`, mas não aplicada à fórmula. Enquanto pendente, `allocation_status=pending_rule`, parcelas vazias e cálculo provisório; o fechamento do boletim é impedido. A única resolução implementada é `resolution_type=NOT_APPLICABLE` com justificativa: confirma que a exceção não ocorreu/não afeta a regra atual. Não aprova uma fórmula especial por texto livre.

## Indicadores e integrações opcionais

`GET analytics/operations/`, `GET analytics/labor-costs/` e `POST analytics/staffing-scenario/` mantêm período/local/origem e acrescentam quatro marcos, pessoas, locais atendidos, responsável financeiro, presença e reconciliação. O cenário aceita mínimo de equipe e recursos informados, retorna `infeasible` ou `unverified`, sem executar redução ou prometer economia. Consulte [indicadores](indicadores.md).

`GET integrations/capabilities/` informa habilitação e configuração mínima, sem testar credenciais ou conectividade do provedor. Assistente, OCR, clima e envio externo dependem de habilitação/configuração e não foram verificados contra provedores nesta documentação. Assistente é somente leitura; OCR sugere, não aprova; clima informa, não bloqueia agenda; calendário é saída, sem alterar capacidade local. Falha/ausência de provedor não retorna sucesso simulado. Veja [configuração, fila, escopo de envio e limitações OAuth](integracoes.md).

`warehouse-readiness/` guarda prontidão manual com histórico; ausência é desconhecida e não muda capacidade. `appointments/:id/signatures/` registra declaração, autor e manifesto dos documentos/revisão, sem alegar assinatura digital certificada. `suppliers/:id/history/` consulta registros locais autorizados. `data/quality/` mantém procedência e qualidade agregada.

Clientes v1 seguem disponíveis para o contrato compatível. Recebimentos v2 e boletins com novos serviços/ocorrências/fontes exigem ações v2. Legados conservam horários e snapshots originais, sem reconstrução de marcos ausentes.
