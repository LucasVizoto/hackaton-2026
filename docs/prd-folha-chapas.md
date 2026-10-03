# PRD — Fechamento e conciliação da folha dos chapas

**Versão:** 1.0 — 03/10/2026

**Estado:** proposta para desenvolvimento; decisões de RH identificadas abaixo ainda precisam de validação da Cocapec.

**Produto existente:** Recebimento Cocapec (Django/DRF, PostgreSQL, Angular/Ionic/Capacitor).
**Dono de negócio proposto:** RH/Folha, com Armazém responsável pelos apontamentos e Gestão pela análise.

## 1. Objetivo e fronteira do produto

Criar um processo verificável que transforme os boletins diários fechados em uma **pré-folha de produção por chapa**, concilie essa base com o sistema oficial de RH e registre o resultado do fechamento. O operador deve conseguir explicar, para cada matrícula e período, quais boletins, frações, serviços e correções formaram o valor; o RH deve identificar diferenças antes de aceitar a competência.

O aplicativo **já calcula a remuneração operacional do boletim**. Ainda não calcula a folha trabalhista completa, descontos, encargos, líquido bancário, nem comprova que houve pagamento. A primeira entrega deste PRD é a pré-folha e a conciliação. Gerar/transmitir a folha oficial ou executar pagamento é uma etapa posterior, condicionada ao contrato do ERP/RH e às políticas da Cocapec. O uso da palavra “pago” fica restrito ao valor observado na fonte histórica de RH ou a uma confirmação importada do sistema oficial; a UI da pré-folha usa “apurado” e “enviado/conciliado”.

### Resultados esperados

1. Fechar um período com valores individuais rastreáveis a boletins e revisões, sem duplicar a mesma pessoa/dia.
2. Conciliar matrícula, data, valor e cobertura com a folha oficial, com pendências explícitas e nenhuma equivalência presumida.
3. Preservar cada versão de fechamento e cada retorno do RH; correções posteriores geram diferenças/reprocessamento controlado.
4. Permitir exportação restrita no formato acordado com o RH, somente após validação e aceite formal do layout.

**Indicadores de sucesso a medir no piloto:** percentual de dias elegíveis com boletim fechado; percentual de parcelas associadas a matrícula válida; diferença em centavos entre pré-folha e boletins; quantidade/valor de divergências com RH; tempo entre fim da competência e aceite do RH; correções após aceite. Metas numéricas dependem de linha de base do piloto, não estão definidas nas fontes.

## 2. Fontes e o que elas sustentam

| Fonte | Fato útil para o produto | Limite |
|---|---|---|
| `DOSSIE - HACKATHON 2026.pdf`, §§7–8, pp. 6–9 | Chapas compartilhados entre recebimento, carregamento e movimentação; boletim por armazém/dia, produção em três modalidades, até 20 matrículas, piso e meia diária; RH mantém o registro oficial de presença | Não define integração de folha, rubricas oficiais nem tratamento de todas as exceções |
| `DADOS_HACKATHON_2026/05_operacao/boletim_diario_chapas.xlsx`, Plan1 | Exemplo de Adubo em 17/11/2025, categorias, tarifas, lista de matrícula e fórmulas | Um dia preenchido; não é série histórica de boletins |
| `DADOS_HACKATHON_2026/04_mao_de_obra/chapas_por_dia_2025.xlsx`, `chapas_por_dia_2026.xlsx` e `chapas_por_dia.csv` | Folha original por pessoa/quinzena e observações consolidadas por dia | Dados sujos; CSV não demonstra alocação por boletim. Agosto e dezembro de 2025 ausentes; cabeçalhos/anos nas abas exigem conferência por célula |
| `DADOS_HACKATHON_2026/LEIA-ME.md`, §§04–05 | Identificadores `CHAPA_..` substituem nomes e são estáveis entre anos; dados privados e incompletos | Não autoriza publicar originais ou reconstruir identidade civil |
| Código atual `backend/labor`, `backend/imports`, `frontend/src/app/features` | Boletim v2, parcelas individuais, histórico RH separado, atividade multilocal, revisões e permissões atuais | Não existe agregado de competência, aprovação RH, exportação de folha oficial nem confirmação bancária |
| `docs/v2/processo.md`, `docs/v2/indicadores.md`, `docs/hipoteses.md` | Invariantes já adotadas e hipóteses provisórias | O rateio da mesma matrícula entre locais não foi confirmado pela Cocapec |

**Regra de precedência:** dossiê prevalece sobre a especificação inicial do pacote quando houver divergência. Política de folha nova só pode ser declarada oficial após validação registrada pelo RH/Cocapec. Dados sintéticos, históricos importados e operação registrada permanecem segregados.

## 3. Contexto operacional e problema atual

O Armazém lança o trabalho do dia seguinte no Boletim Diário de Serviços dos Ensacadores. A produção inclui descarga de fornecedor, remoção/carregamento para cooperados e transferências; portanto não é possível atribuir todo o valor a um caminhão. Os mesmos chapas podem atender vários recebimentos e locais. Contar chapas por descarga e somar essas contagens produziria efetivo falso. O boletim identifica a equipe por matrícula e fração de diária; a folha de ponto do RH é a fonte oficial de presença.

Hoje o sistema mantém `DailyBulletin`, linhas de produção, serviços de diária, participantes, `WorkerDay`, `LaborActivity`, ocorrências e `IndividualAllocation`. Um boletim fechado v2 grava parcelas individuais em centavos e valores exatos; reabrir inativa as parcelas correntes, mantendo o histórico. A tela de Pessoas mostra apuração operacional separada das observações históricas de RH. O histórico importado guarda lote/aba/linha/coluna e qualidade da célula. Ele não deve ser somado à produção operacional.

A lacuna principal é o fechamento por competência: não há uma lista congelada de parcelas candidatas ao RH, reconciliação formal, aceite, protocolo de exportação/retorno, nem regra para correções depois do aceite. Também não há comprovação de que a parcela individual proporcional calculada pelo aplicativo corresponda à rubrica e ao critério do RH.

## 4. Usuários e permissões propostas

| Papel | Ação |
|---|---|
| Armazém | Criar/corrigir atividades e boletins; resolver pendência operacional dentro das permissões atuais; consultar status do próprio envio sem ver folha histórica de outros trabalhadores |
| RH/Folha **(novo papel)** | Definir competência, validar vínculos cadastrais, importar retorno, analisar divergências, aceitar/rejeitar pré-folha, emitir arquivo autorizado |
| Gestão | Consultar agregados, cobertura e divergências; visualizar dados nominais somente com autorização explícita de negócio |
| Administração | Configurar integrações, política versionada e controle de acesso; não substituir aprovação de negócio sem registro de delegação |
| Chapa | Autoatendimento de extrato individual é fase futura, após autenticação e política de privacidade próprias |

Fornecedor e Portaria não acessam remuneração, folha ou exportações. Os perfis atuais `warehouse`, `management` e `admin` não devem ser usados como substituto automático do novo papel de RH.

## 5. Escopo e entregas

### MVP — pré-folha controlada

- Seleção de período/competência, origem `operacional_registrado` e armazéns incluídos.
- Painel de prontidão dos boletins: fechado, rascunho, regra pendente, sem boletim, legado sem parcela, revisão alterada.
- Prévia e snapshot imutável de parcelas por matrícula/data/local/boletim/revisão, com soma por pessoa e por competência.
- Reconciliação interna: parcelas versus total de cada boletim e duplicidade pessoa/data/origem; origem sintética ou histórica nunca entra em competência operacional.
- Importação privada de arquivo de conferência do RH em layout homologado, com staging, diagnóstico de qualidade, prévia e confirmação de lote.
- Conciliação por chave definida com RH; divergências classificadas e tratadas por responsável, sem ajustar valores automaticamente.
- Aprovação/rejeição com justificativa e trilha; exportação da pré-folha aprovada com checksum, versão, usuário e horário, caso o RH aceite esse formato.

### Fase posterior, sujeita a contrato e homologação

- Integração automática com ERP/RH, retorno de protocolo e estado de processamento.
- Rubricas, encargos, descontos e líquido do holerite, se o RH delegar o cálculo e fornecer regras versionadas.
- Confirmação de pagamento a partir de fonte oficial e eventual extrato do chapa.

**Fora do MVP:** transferência bancária, envio direto ao eSocial, cálculo automático de tributos/encargos, substituição da folha de ponto, inferência de presença por atividade, preenchimento retroativo de boletins, e qualquer valor de folha derivado de R$ 180,00. O eSocial separa informações de remuneração e pagamentos em eventos distintos; integração direta exigiria análise específica do vínculo e dos leiautes atuais pelo RH. Ver [Manual WEB Geral do eSocial](https://www.gov.br/esocial/pt-br/empresas/manual-web-geral/manual-web-geral/).

## 6. Regras de negócio e matemática

### 6.1 Boletim que alimenta a pré-folha

Para cada boletim fechado, `P = Σ[(descarga + remoção + transferência) × tarifa da categoria] + Σ[quantidade de serviço × tarifa de serviço] + produção registrada por fonte única`, `E = Σ frações`, `F = E × 90,1731`, `T = max(P,F)` e `C = T − P`. Calcular com decimal e quatro casas ou precisão superior; arredondar a apresentação para centavos no fim. A comparação com o piso ocorre no boletim, antes de somar dias ou locais. `E=0` com `P>0` bloqueia fechamento; sem atividade/equipe o boletim permanece rascunho.

Participante usa fração `1` ou `0,5`; até 20 por boletim. As tarifas de **serviço** “Diária Completa” (`90,1731`) e “Meia Diária” (`45,0786`) são linhas de produção e não representam a fração de presença. Metade do piso (`45,08655`) difere da tarifa do serviço de meia diária; a regra de `E × 90,1731` reproduz os exemplos oficiais, mas a divergência deve ser confirmada com a Cocapec antes da folha oficial.

Referência obrigatória: em 17/11/2025, `P = (2.378 + 400 + 30 + 40) × 0,3224 = 918,1952`. Com 11 diárias, `T=991,9041`, `C=73,7089` (R$ 991,90 e R$ 73,71 exibidos). Com 10,5 diárias, `T=946,81755`, `C=28,62235` (R$ 946,82 e R$ 28,62 exibidos).

### 6.2 Parcela individual e reconciliação

O sistema atual distribui produção, complemento e total na proporção da fração de cada participante sobre `E`, com reconciliação determinística dos centavos pelo método do maior resto. A soma dos `total_payable` individuais de uma revisão deve ser igual ao total do boletim exibido em centavos. Cada parcela conserva versão da política, valores exatos/racionais, valores exibidos, ajuste de centavos, matrícula, `WorkerDay` e revisão. A pré-folha consome **somente parcelas ativas de boletins v2 fechados** e congela os identificadores e valores usados.

Uma pessoa pode registrar atividades em mais de um local e recebimento, mas a atividade não cria remuneração. A regra atual impede vínculo financeiro duplicado por pessoa/data/origem e limita provisoriamente a soma de frações a uma diária; o responsável pelo custo pode ser transferido com motivo e revisão. Antes de oficializar a folha, RH/Cocapec deve confirmar a política de rateio multilocal. Legados sem parcela permanecem “sem cobertura”, nunca recebem rateio inferido.

### 6.3 Exceções

Saída antecipada sem fração definida, hora extra, diária especial ou fração excepcional gera `LaborRuleOccurrence`; enquanto aberta, bloqueia o fechamento apenas do boletim afetado. A resolução atual permite apenas registrar, com justificativa de Gestão/admin, que a ocorrência não é aplicável. Uma nova política monetária exige regra escrita, versão, vigência, teste com exemplo aprovado e migração sem recalcular snapshots anteriores.

Correção de produção, equipe, tarifa aplicada ou local responsável após fechamento requer reabertura motivada, nova revisão e novo fechamento. Se a revisão já estiver em uma competência aprovada/exportada, não alterar o snapshot entregue: criar ajuste/delta em período de retificação definido pelo RH e vincular original, motivo e aprovação. **Política de competência de ajustes é decisão pendente.**

## 7. Fluxo passo a passo

1. **Apontar:** Armazém registra produção nas 14 categorias/três modalidades, serviços de diária, fontes e equipe por matrícula/fração; presença e atividades ficam em registro separado.
2. **Conferir o boletim:** servidor mostra `P`, `E`, piso, complemento, total e parcelas; destaca pendências, duplicidade, dias sem equipe e fonte não conciliada.
3. **Fechar o dia:** usuário autorizado fecha o boletim com revisão esperada. O sistema bloqueia regra pendente e grava cálculo/tarifas/parcelas e autor. Uma correção exige reabertura com motivo.
4. **Abrir competência:** RH escolhe datas, origem operacional, conjunto de locais e identificador da competência. O sistema informa cobertura do calendário e bloqueios; não converte dia ausente em zero.
5. **Gerar prévia:** servidor soma parcelas ativas por matrícula e preserva cada linha de origem. Mostra totais por pessoa, local e período, conciliação interna, revisões e lista de boletins excluídos.
6. **Congelar pré-folha:** RH confirma a versão quando a política de corte permitir. O snapshot recebe hash e passa a ser imutável. Nova geração vira versão distinta, com comparação de diferenças.
7. **Conferir com RH:** importar arquivo oficial em área privada, validar estrutura, datas, identificadores, duplicidades, valores e rubricas; operador revisa a prévia e confirma o lote. Comparar somente campos semanticamente equivalentes homologados.
8. **Tratar diferenças:** classificar por matrícula não localizada, dia sem boletim, folha sem presença, valor divergente, múltiplos vínculos, rubrica não comparável, revisão posterior ou fonte inválida. Designar responsável, registrar evidência e decisão. Correções operacionais retornam ao passo 2; correções de RH são registradas no sistema oficial e reimportadas.
9. **Aprovar e exportar:** dupla conferência proposta: RH valida e outro aprovador de RH/Gestão aceita a versão final. Exportar somente layout homologado, registrar versão, hash, horário, usuário e destino. Nenhum status “pago” surge desse ato.
10. **Receber retorno:** armazenar protocolo/aceite/rejeição do sistema oficial, se houver; a competência fica “conciliada” apenas conforme critérios aprovados. Mudanças posteriores seguem retificação, sem edição silenciosa.

Estados propostos da competência: `DRAFT → READY → FROZEN → UNDER_REVIEW → APPROVED → EXPORTED → ACKNOWLEDGED`; `REJECTED` retorna a nova versão de prévia, e `ADJUSTMENT_REQUIRED` indica mudança após aprovação. `ACKNOWLEDGED` significa recebimento pelo RH/ERP, **não pagamento**. Transições e aprovadores precisam de política de segregação homologada.

## 8. Requisitos funcionais priorizados

| ID | Requisito | Prioridade | Critério de aceite |
|---|---|---|---|
| RF-01 | Visão de cobertura por dia/local/competência | P0 | Rascunho, fechado, legado, ausente e pendência são estados distintos; ausência não aparece como R$ 0 |
| RF-02 | Prévia individual auditável | P0 | Cada valor aponta para parcela, boletim/revisão, data, matrícula e política; totais por pessoa/competência reconciliam |
| RF-03 | Controle de duplicidade e fração | P0 | Mesmo `WorkerDay` não entra duas vezes; conflito bloqueia congelamento e mostra origem |
| RF-04 | Snapshot e versionamento | P0 | Competência congelada não muda quando boletim é reaberto; nova versão exibe delta e motivo |
| RF-05 | Conciliação de centavos | P0 | Soma de parcelas em centavos = soma de boletins elegíveis em centavos, com cobertura documentada |
| RF-06 | Acesso restrito | P0 | Fornecedor, Portaria e usuário sem papel RH recebem 403 nos dados/exportações nominais |
| RF-07 | Importação de retorno RH com staging | P1 | Nenhuma linha inválida entra como valor utilizável; lote é idempotente e mantém proveniência/erros |
| RF-08 | Tela de diferenças e decisão | P1 | Toda diferença tem tipo, valor, origem, responsável, estado, comentário e trilha; ajuste não ocorre implicitamente |
| RF-09 | Aprovação e exportação controlada | P1 | Apenas versão apta pode ser aprovada/exportada; arquivo reproduzível e hash registrado |
| RF-10 | Retificação pós-aceite | P1 | Alteração de boletim aceito cria pendência/delta rastreável; versão antiga permanece consultável |
| RF-11 | Integração automática ERP/RH | P2 | Contrato, autenticação, reenvio idempotente e retorno homologados em ambiente de teste |
| RF-12 | Extrato do trabalhador | P2 | Trabalhador autenticado vê somente a própria pré-folha e sua condição, após política de RH |

## 9. Dados e contratos propostos

**Reutilizar:** `Worker`, `WorkerDay`, `DailyBulletin`, `BulletinParticipant`, `IndividualAllocation`, `BulletinRevision`, `LaborRuleOccurrence`, `HistoricalWorkerDay`, `ImportBatch` e `SourceFile`. Não copiar cálculos do frontend nem sobrescrever importações históricas.

**Novas entidades sugeridas:** `PayrollPeriod` (datas/competência, origem, locais, corte, status), `PayrollRun` (versão, política, hash, ator, horário, totais/cobertura), `PayrollLine` (matrícula/dia, referência à parcela e boletim/revisão, valores congelados), `PayrollImportBatch` e `PayrollImportRow` (arquivo, hash, layout, dados normalizados/qualidade/proveniência), `PayrollReconciliation` (chave, resultado, diferença, motivo, responsável), `PayrollApproval` e `PayrollExport` (decisão, destinatário, formato, hash, protocolo). Políticas de retenção e campos pessoais são aprovados com RH/privacidade antes da migração final.

**Invariantes de banco:** unicidade da competência por chave de negócio e versão; unicidade da parcela de origem dentro de um run; nenhuma linha de origem `demo_sintetico` em run operacional; exportação referencia exatamente uma versão aprovada; decisão/transição exige revisão esperada e transação; eventos de auditoria são append-only. Índices em matrícula/data, período/status e lote/chave de conciliação. Snapshots usam `Decimal`, moeda BRL, datas locais explícitas e sem `float`.

**API proposta (nomes a validar com convenção atual):**

| Método e rota | Função |
|---|---|
| `GET /api/payroll/periods/` / `POST /api/payroll/periods/` | Listar/criar competência e parâmetros |
| `GET /api/payroll/periods/{id}/readiness/` | Cobertura, bloqueios e totais elegíveis |
| `POST /api/payroll/periods/{id}/preview/` | Prévia calculada sem congelar |
| `POST /api/payroll/periods/{id}/freeze/` | Congelar versão com revisão esperada e chave de idempotência |
| `GET /api/payroll/runs/{id}/lines/` | Linhas paginadas, filtros e proveniência |
| `POST /api/payroll/imports/` / `POST /api/payroll/imports/{id}/confirm/` | Staging e confirmação de retorno do RH |
| `GET /api/payroll/runs/{id}/reconciliation/` | Diferenças e cobertura sem esconder não comparáveis |
| `POST /api/payroll/runs/{id}/decisions/` | Aprovar/rejeitar com ator, revisão e justificativa |
| `POST /api/payroll/runs/{id}/exports/` | Gerar arquivo restrito e registrar hash/protocolo |

Paginação e filtros são obrigatórios para dados nominais; totais agregados não devem ser calculados apenas da página exibida. Erros de negócio retornam código estável, campo e mensagem, por exemplo `409 PAYROLL_SOURCE_CHANGED` quando um boletim muda entre prévia e congelamento; o servidor não aplica uma prévia obsoleta.

## 10. Telas e experiência

1. **Competências:** período, versão, origem, cobertura, status e responsável; ação “Abrir competência”.
2. **Prontidão:** calendário por local, boletins faltantes/pendentes, diferenças de fechamento e links para correção. Mostrar `sem dado`, `zero apurado` e `não comparável` separadamente.
3. **Pré-folha:** totais, filtros por matrícula/local/dia, linhas de origem e detalhamento `produção + complemento + ajuste de centavos = total`; exportação de conferência restrita.
4. **Conciliação RH:** lote importado, erros de layout, divergências por tipo, rubrica comparada, responsável e decisão. O usuário abre a célula/lote de origem sem expor arquivos a perfis indevidos.
5. **Aprovação e histórico:** comparação de versões, checklist de bloqueios, aprovadores, justificativa, exportações e protocolos. Aviso claro de que “enviado” não significa “pago”.

Web é o canal principal de RH; a aplicação Ionic existente pode consultar status no mobile para Armazém, respeitando as mesmas permissões do servidor. Valores financeiros nunca dependem de lógica de cálculo no cliente.

## 11. Segurança, privacidade e operação

Matrícula, nome e remuneração são dados pessoais quando identificam ou permitem identificar uma pessoa; o uso de `CHAPA_..` no material do evento não autoriza expor vínculos internos. Aplicar menor privilégio por rota e objeto, logs sem valores/arquivo bruto, anexos em armazenamento privado, criptografia em trânsito e em repouso conforme arquitetura aprovada, trilha de leitura/exportação e prazo de retenção definido com RH. Exportações devem ter acesso autenticado, validade curta e registro de destinatário; evitar URL pública e cache compartilhado. A ANPD destaca medidas técnicas e administrativas para proteger dados pessoais; ver [orientação da ANPD sobre segurança](https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-publica-guia-de-seguranca-para-agentes-de-tratamento-de-pequeno-porte/).

Backup e restauração precisam preservar versões, arquivos de retorno, hashes e trilha. Uma falha de importação/exportação não altera competência aprovada. Operações repetidas com a mesma chave são idempotentes; ações concorrentes exigem bloqueio transacional e revisão esperada. Falha de rede na UI mostra status desconhecido até consultar o servidor; não confirma envio por otimismo.

**Critério de produção:** revisão de acesso e privacidade, política de retenção, homologação RH, carga e recuperação, observabilidade, proteção de credenciais e testes no ambiente real. A implantação atual do hackathon não deve ser tratada como produção.

## 12. Plano de implementação, passo a passo

| Etapa | Implementação | Saída verificável |
|---|---|---|
| 0. Decisões de negócio | Obter layout/contrato de RH, calendário de competência, chave de matrícula, rubricas comparáveis, política de rateio e ajustes; registrar exemplos assinados | Dicionário de dados e política v1 aprovados; bloqueios listados |
| 1. Baseline técnico | Congelar referência de testes do boletim v2, permissões e importação; mapear tabelas/índices e migração em cópia | Casos monetários oficiais e reconciliação atual passando; rollback documentado |
| 2. Prontidão | Backend para cobertura e bloqueios; tela de calendário/links | Dia ausente distinto de zero; legados e ocorrências visíveis |
| 3. Prévia e snapshot | Agregado de competência, linhas imutáveis, seleção transacional de parcelas, versionamento e idempotência | Soma por pessoa/local/período = soma elegível; reabertura posterior não muda snapshot |
| 4. Importação e conciliação | Parser do layout homologado, staging privado, validação, lote ativo, comparador por chave/rubrica | Reimportação não duplica; divergência semântica fica “não comparável” |
| 5. Aprovação e exportação | Estados, segregação de função, trilha, formato homologado e hash | Somente run aprovado exporta; arquivo reproduzível em teste |
| 6. Retificação | Detectar mudança em fonte aprovada, delta, nova versão/ajuste | Correção preserva original e sinaliza RH sem sobrescrever entrega |
| 7. Piloto e rollout | Testar competência sintética e amostra privada autorizada; comparar RH manualmente; treinar operadores | Aceite RH, reconciliação documentada, plano de suporte e recuperação |

Implementar em migrations aditivas e feature flag; não recalcular boletins antigos nem preencher lacunas de 2025. A fase 3 já entrega valor operacional se o contrato de integração atrasar; a fase 5 depende de layout homologado. O rollout começa em paralelo à folha oficial, sem substituir o processo anterior até aceite formal.

## 13. Testes e critérios de aceite fim a fim

- Reproduzir os exemplos oficiais de 11 e 10,5 diárias com valores exatos e exibidos; testar `P>F`, `P=0`, `E=0`, meia diária de **serviço** versus fração `0,5` e 20 participantes.
- Duas pessoas com frações diferentes: centavos individuais somam exatamente o total do boletim, independentemente da ordem de envio; totais de produção/complemento/ajuste são explicáveis.
- Uma pessoa em duas atividades/locais no mesmo dia gera um único vínculo financeiro válido; tentativa de dupla inclusão em competências ou boletins é bloqueada, sem apagar atividades.
- Boletim reaberto após preview impede congelamento obsoleto; reaberto após aprovação gera pendência de ajuste e conserva run/exportação anterior.
- Regra pendente bloqueia somente o boletim afetado; dia sem boletim, histórico legado e retorno RH ausente são `sem cobertura`, nunca zero.
- Importar o mesmo arquivo duas vezes não duplica linhas; arquivo alterado vira nova versão com diferença visível; linhas inválidas e identificadores ambíguos ficam em staging.
- Provar isolamento: fornecedor/Portaria sem leitura; Armazém sem exportação; RH só vê o escopo autorizado; URL de arquivo não funciona sem autenticação.
- Testar concorrência de congelamento/aprovação em PostgreSQL, recuperação após reinício e backup/restauração de snapshots e trilhas.
- Homologação humana: RH confirma pelo menos uma competência sintética completa, diferenças deliberadas e o layout de exportação. Integração real, folha oficial e pagamento recebem `NOT RUN` até teste executado e aceite registrado.

## 14. Decisões pendentes que bloqueiam partes do escopo

| Pergunta para Cocapec/RH | Por que importa | Decisão provisória segura |
|---|---|---|
| A parcela proporcional do boletim é a base da rubrica de folha? Qual rubrica e qual arredondamento? | Sem isso, valor operacional não pode ser declarado valor oficial de folha | Exibir como pré-folha; comparar apenas após mapeamento homologado |
| Qual é a chave estável entre matrícula do boletim, identificador `CHAPA_..` histórico e cadastro RH? | Associação incorreta troca pagamentos entre pessoas | Bloquear linhas sem vínculo inequívoco; tabela de vínculo privada/auditada |
| Como ratear um chapa que trabalhou em dois armazéns no mesmo dia? | Muda custo por local e talvez parcela individual | Manter regra provisória atual e sinalizar dependência |
| Como RH trata meia diária, saída parcial, extras, feriado/sábado e diária especial? | Exceções podem alterar remuneração e competência | Ocorrência pendente; sem fórmula por texto livre |
| Qual período de corte, competência e regra de retificação após aceite? | Define snapshot, delta e destino de ajustes | Não exportar ajuste automaticamente |
| Qual sistema recebe a pré-folha, layout, autenticação, recibo e significado de “aceito”? | Determina integração e status observáveis | Arquivo restrito somente após homologação; sem “pago” |
| Quem aprova, quem pode corrigir e por quanto tempo guardar dados/exportações? | Segregação de função e privacidade | Aprovação explícita e menor privilégio; retenção a definir |

## 15. Referências e status de validação

Este PRD foi fundamentado no dossiê (especialmente §§7–8), no `LEIA-ME.md` do pacote privado, nas estruturas/fórmulas das planilhas originais, no código e na documentação v2 existentes. A inspeção da planilha de RH confirmou estrutura por quinzenas, rubricas e colunas diárias e encontrou cabeçalhos de datas que exigem normalização; **não** foi feita uma auditoria célula a célula de toda a folha. A planilha de boletim foi lida como fonte de fórmulas e exemplo, sem republicar dados nominais. As regras trabalhistas, rubricas oficiais, integração ERP e execução de pagamento **não estão validadas**. Fontes oficiais de referência para futura análise de integração e privacidade: [eSocial](https://www.gov.br/esocial/pt-br/empresas/manual-web-geral/manual-web-geral/) e [ANPD](https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados/).
