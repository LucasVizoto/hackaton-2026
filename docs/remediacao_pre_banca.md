# Remediação pré-banca — 03/10/2026

A rodada inicial foi realizada sobre `5b57e1d`, sem commit, push, implantação ou distribuição de APK naquele momento. As skills `anti-ai-slop` e `ui-anti-slop-codex` orientaram a revisão de linguagem, superfície e verificação visual. A remediação mantém os componentes, tokens e regras financeiras existentes.

Na preparação Git posterior, solicitada com `$converge preparar`, as alterações foram salvas e conciliadas com `0c71b1d` (contrato do boletim e consulta da Gestão) e `9abfcc6` (leitura PDF/XML e tela do Fornecedor). A consulta de assinaturas usa um único componente, a paginação mantém Gestão sem permissão de reconhecer avisos e uma nova migration vazia reúne as duas folhas existentes sem reescrever migrations aplicadas. Os testes abaixo descrevem a rodada inicial; a validação do commit conciliado e os hashes exatos ficam no registro local da Converge. Esta preparação não publica nem integra na principal.

## Correções e rastreabilidade

| Achado confirmado e causa | Alteração e arquivos | Verificação |
|---|---|---|
| Login anunciava recuperação e CPF/matrícula, mas a API autentica `username` e não há fluxo de reset por e-mail | `features/login.ts`: usuário por perfil, suporte administrativo, “Lembrar usuário”. Não modifica sessão nem inventa associação de CPF | Login inválido, abas, mensagem de suporte, usuário lembrado e senha vazia após logout; suíte de apresentação e autenticação |
| Gestão apresentava WorkerDay distintos como pessoas | `features/management.ts`, `docs/v2/indicadores.md`: pessoas-dia, dicas e cobertura. Query preservada | `analytics/tests_v2.py`: mesma pessoa em dois dias e dois locais produz duas pessoas-dia, sem duplicação no mesmo dia |
| Recusas anunciavam revisão sem desfecho definido | `features/gate.ts`, `app.ts`: consulta de chegadas recusadas, autoria do Armazém, aviso sem promessa de reversão | Compras abre recusa persistida; API e testes de decisão existentes preservados |
| Exceção válida não tem fórmula aprovada; UI podia induzir uso de “não aplicável” | `features/bulletins.ts`, `core/presentation.ts`: motivo do bloqueio e rótulos explícitos. Bloqueio e cálculo preservados | Testes v2 de ocorrência pendente, fechamento e resolução explícita; inspeção do boletim bloqueado no banco de QA |
| Captura institucional aparentava clima/cotações atuais e escondia o acesso local | `features/home.ts`, `public/cocapec.html`: CTA local antes do iframe, atribuição e data da captura, referência sem atualização automática. Removido o bootstrap Livewire da captura com token copiado | Home e CTA no desktop/celular; rótulos do HTML institucional e destinos externos inspecionados |
| Seed padrão mistura exemplos legados e fixtures de desenvolvimento | `core/management/commands/seed_demo.py`: opção `--presentation` em banco exclusivo, workflow v2 real e origem sintética | `core/test_presentation_seed.py`: idempotência, quatro marcos, parcelas, nota pendente ainda não consumida, recusa de QA/baseline misturados |
| Algumas consultas consumiam apenas a primeira página | `core/api.ts`, `core/pagination.ts`; seleções em `purchase-orders.ts`, `receipt-check.ts`, `people.ts`, `bulletins.ts`; listas em `receiving.ts` e `shared/notifications.ts` | `pagination.test.ts`: 121 registros, filtros preservados, erro posterior sem sucesso parcial; `receiving/tests_v2.py`: 100 + 21; navegador QA: 100 + 22, total 122 |
| Chaves e estados técnicos apareciam como texto principal | `core/error-labels.ts`, `core/quality-presentation.ts`, `core/presentation.ts`, `api.ts`, `management.ts`, `integrations.ts`: mapeamentos PT-BR, datas, estados. Qualidade conserva resposta agregada em detalhes técnicos | `domain-presentation.test.ts`: rótulos, datas, nulos, estados e erros; Origem dos dados e integrações no navegador |
| Assinatura persistia sem consulta posterior na UI | `shared/receipt-signatures.ts`, `integrations.ts`, `receiving.ts`: consulta da API existente, responsável, data, revisão atual/anterior, declaração e resumo do manifesto | `integrations/tests.py`: gravação e leitura; assinatura sintética criada e recuperada após recarga no navegador |
| Rota inválida redirecionava silenciosamente à home | `features/not-found.ts`, `routes.ts`: página não encontrada com retorno conforme sessão/perfil | Navegador em rota inválida, build Angular |
| Documentação contradizia sessão, imagens, assistente e seed | `README.md`, `DESIGN.md`, `docs/como_rodar.md`, `docs/README.md`, documentos v2 e este relatório | Confronto com implementação; resultados anteriores preservados como rodadas anteriores |
| Queda de API não atribuível ao commit | `scripts/check-demo.ps1` e procedimento abaixo; nenhum “conserto de crash” sem reprodução | Navegação prolongada em instância isolada; health-check positivo e negativo; reinício deliberado para ativar banco limpo |

Os caminhos frontend da tabela são relativos a `frontend/src/app`; os do backend são relativos a `backend`. A API de assinatura, permissões, tarifas, cálculo, concorrência, migrations e arquitetura não foram alterados.

As listas principais mantêm paginação. Apenas seleções auxiliares já limitadas por fornecedor, dia, origem ou contexto percorrem todas as páginas. A seleção de recebimentos anteriores ainda pode crescer para um fornecedor com longa história; busca no servidor é uma evolução de escala. Histórico do fornecedor e lista individual de Gestão conservam seus limites com aviso explícito e totais completos; não se anuncia exportação integral quando a seleção está truncada.

A conferência final também tornou explícita uma diferença já existente de precisão financeira: os indicadores arredondam a soma exata, enquanto a reconciliação soma os centavos salvos por boletim. Nos dois boletins do cenário, isso mostra R$ 1.352,60 no indicador e R$ 1.352,59 na soma conciliada, com diferença de conciliação zero entre parcelas e boletins. A explicação foi acrescentada junto dos indicadores; nenhuma fórmula ou parcela foi alterada para esconder esse centavo.

## Preparar uma apresentação limpa

Use outro banco PostgreSQL e outro `MEDIA_ROOT`. Não reaproveite a base de QA, não remova registros para escondê-los e não altere origem. O seed padrão continua disponível para desenvolvimento; `setup.ps1 -SeedDemo` instala também o baseline privado e não prepara este cenário exclusivo.

Com o `.env` privado configurado e dependências instaladas, na raiz, em PowerShell:

```powershell
docker compose up -d --wait postgres redis
# Execute a criação uma vez, com um nome novo e verificado.
docker compose exec -T postgres sh -c 'createdb -U "$POSTGRES_USER" cocapec_apresentacao'
$env:DB_NAME = 'cocapec_apresentacao'
$env:MEDIA_ROOT = Join-Path (Get-Location) '.private/apresentacao/media'
$env:REDIS_URL = 'redis://127.0.0.1:56479/14'
.\backend\.venv\Scripts\python.exe backend\manage.py migrate --noinput
if ($LASTEXITCODE -ne 0) { throw 'Migrations falharam.' }
.\backend\.venv\Scripts\python.exe backend\manage.py seed_demo --presentation
if ($LASTEXITCODE -ne 0) { throw 'Seed falhou; confira o banco configurado.' }
.\backend\.venv\Scripts\python.exe backend\manage.py runserver 127.0.0.1:8000
```

Se Redis usa outra porta/autenticação, configure sua URL privada; `/14` deve ser reservado a esta apresentação. As variáveis de processo só valem neste terminal: mantenha-as também nos reinícios. No outro terminal, execute `npm.cmd start` em `frontend`. Confirme o proxy e as origens WebSocket previstas no `.env`; o frontend padrão usa `localhost:4200` e a API porta 8000.

Não rode testes que publicam eventos no mesmo Redis/canal da apresentação. Na remediação, apresentação usou Redis `/14`, QA `/13` e o ensaio final de tempo real `/15`. Um teste paralelo inicialmente compartilhou `/14` e produziu um aviso transitório “Synthetic realtime”; a separação impediu sua repetição. Não houve inclusão desse registro no banco de apresentação. Contas têm um token por usuário e cookies são compartilhados entre portas do mesmo host: faça QA em outra sessão/host, ou encerre o QA e autentique novamente antes do ensaio.

O cenário cria três recebimentos v2 (dois concluídos em 01 e 02/10/2026 e uma entrega pendente em 05/10/2026), três notas artificiais, dois boletins fechados com parcelas, 15 pessoas-dia de presença/uso e uma chegada recusada avulsa. Participantes, tempos e documentos continuam identificados como sintéticos. Datas fixas tornam o roteiro previsível; não são atualizadas para parecer operação atual. Reexecução preserva registros/senhas existentes. O comando recusa os conflitos conhecidos; isso não dispensa o uso de banco exclusivo.

Percurso de consulta que esse seed efetivamente prepara:

1. Home → entrar no sistema. Use `armazem_demo`, `compras_demo` e `gestao_demo`, com a senha privada `DEMO_PASSWORD` definida na primeira execução.
2. Agenda de 05/10: entrega pendente. Para consultar as concluídas, selecione a semana de 28/09 a 02/10.
3. Compras → Chegadas recusadas: consultar o aviso do motorista sintético. Não anunciar revisão/reversão de decisão.
4. Boletins: Adubo 01/10 e Insumos 02/10, ambos fechados; abrir parcelas. Novo boletim oferece os exemplos sintéticos como prévia, sem salvar automaticamente.
5. Gestão: origem Demonstração sintética, período 01/10 a 02/10. Mostrar pessoas-dia, custos e cobertura; cenários são condicionais.
6. Pessoas: escolher uma matrícula do cenário e o mesmo período/origem para consultar atividade e parcela.
7. Integrações: escolher recebimento concluído, registrar conferência sintética, recarregar e consultar a assinatura. Adaptadores externos desligados mostram indisponibilidade.

Esse seed não pré-cadastra todos os casos de várias notas, divergência, transferência e exceção do roteiro v2 ampliado. Eles exigem preparação separada em dados sintéticos e ensaio real. Não apresente um desfecho de exceção financeira válida enquanto a regra estiver pendente.

Antes da banca:

```powershell
.\scripts\check-demo.ps1
Invoke-RestMethod 'http://localhost:4200/api/v2/health/'
```

O script testa API/PostgreSQL e entrega HTML do frontend; o segundo comando testa o proxy. Complete login, agenda por perfil, boletim, pessoas, Gestão e estado/reconexão da Portaria no navegador. O health-check não comprova Redis, credenciais externas ou envio. Se falhar, conferir terminais, portas, variáveis do processo, PostgreSQL e Redis; preservar o erro visível, sem afirmar gravação. Reinicie somente os serviços deste ensaio e autentique novamente quando necessário.

## Achados preservados e decisões

| Classificação | Achado e razão |
|---|---|
| Falta regra de negócio | Exceções financeiras válidas (saída antecipada, horas extras, diária especial, fração excepcional) continuam bloqueadas. `NOT_APPLICABLE` só serve para ocorrência que não ocorreu/não afeta o cálculo vigente, com justificativa. Cocapec precisa aprovar a regra antes de implementação. |
| Falta regra de negócio | Não foi encontrada regra de reversão de chegada recusada por Compras. A consulta tem desfecho de leitura; uma decisão adicional dependeria de definição de responsabilidade, critérios e histórico. |
| Comportamento intencional | Autenticação por usuário, sessão existente, recuperação administrativa; sem fluxo de e-mail suficiente para reset automático. |
| Comportamento intencional / decisão humana para distribuição futura | Android `.demo` preservado. O APK de distribuição preservado em `.private/deploy/downloaded-release.apk` usa `br.cocapec.recebimento.demo`, versão 1.1.0/código 2; SHA-256 `d8128e1b2b303c13a2b0d1c0921d01375f0ca9559fd3f89e915ca41bbd56dedf`. Alterar ID criaria outro app, não atualização. Identidade de uma distribuição futura exige decisão do responsável; nenhum APK novo foi produzido nesta remediação. |
| Não reproduzido | Desaparecimento inesperado da API da auditoria anterior. A instância controlada permaneceu ativa durante a navegação até o reinício deliberado. Posteriormente, uma interrupção da execução de ferramentas encerrou o contexto de inspeção; as portas de ensaio estavam sem listener e os processos foram iniciados novamente. Não houve reprodução de crash/traceback da aplicação que permita atribuir causa ao commit; não se garante estabilidade indefinida. |
| Falso positivo | Mocks, adaptadores LLM reais, temporizadores de reconexão, exceção com `pass`, tarifas constantes, logs de falha e migrations geradas são legítimos e foram preservados. |
| Fora de escopo / condicionado à configuração | Homologação de provedores externos, produção, aparelho físico, novo APK e iOS. Código/adaptadores e testes simulados não comprovam funcionamento externo. |

As únicas decisões de domínio sem evidência suficiente são a fórmula/tratamento das exceções financeiras e eventual reversão de recusa por Compras. A identidade Android é decisão de distribuição futura; não é bloqueio para manter a instalação atual.

## Testes executados nesta remediação

Ambiente: Windows/PowerShell, PostgreSQL 17 real, Redis local, Django/Daphne e Angular deste worktree. Python/dependências backend reutilizados da instalação local; `npm ci` executado no worktree. Banco histórico/operacional não foi alterado. Não se afirma instalação em Windows vazio.

| Comando | Resultado |
|---|---|
| `python backend/manage.py test core catalog receiving labor analytics imports integrations --noinput` | PASS: 218 testes, um ignorado por ausência de `TEST_REDIS_URL` nessa execução |
| `REDIS_URL` e `TEST_REDIS_URL` configurados para Redis isolado; `python backend/manage.py test receiving.test_realtime --noinput` | PASS: seis testes, incluindo Redis entre processos, heartbeat e socket ocioso; nenhum ignorado |
| `ruff check backend` | PASS |
| `python backend/manage.py makemigrations --check --dry-run` | PASS: nenhuma alteração necessária |
| `python backend/manage.py migrate --check` / `check` | PASS |
| `migrate --noinput`, `seed_demo --presentation` e reexecução em banco novo | PASS: cenário v2 e idempotência |
| `npm test` | PASS: 40 testes, ampliados além dos 35 anteriores |
| `npm run lint` | PASS |
| `npx tsc --noEmit -p tsconfig.app.json` | PASS |
| `npm run build:production` | PASS; avisos CommonJS existentes de Tesseract, regenerator e pdfmake |
| `scripts/check-demo.ps1` com API real / porta sem API | PASS nos dois estados esperados: sucesso e falha com exit 1 |

O build também compila os templates Angular. Nenhuma migration, fórmula ou autorização foi alterada. Os testes de concorrência usam PostgreSQL real; mocks dos adaptadores externos permanecem legítimos.

## Browser QA e responsividade

Navegador interno com API real. Dimensões conferidas via DOM: 390 × 844 móvel e 1440 × 900 desktop; houve também viewport padrão de 1280 × 720. A mudança da capacidade de viewport exigiu aplicá-la à tela ativa e medir `innerWidth/innerHeight`; não se usou apenas o tamanho solicitado como evidência.

Telas abertas: home, login, Agenda Compras, Agenda Armazém, Gestão, Chegadas recusadas, Boletins, boletim fechado, Novo boletim, Pessoas, Origem dos dados, Integrações, não recebimentos e 404. Estados exercitados: credenciais inválidas, suporte, abas, usuário lembrado/senha vazia, origem sem dados, origem sintética com 15 pessoas-dia, recusa persistida, boletim fechado com parcelas, assinatura salva/recuperada, integração indisponível, paginação e endereço inexistente. Clima/cotações foram inspecionados no documento institucional servido pelo frontend; links externos conservam seus destinos, sem declarar disponibilidade dos serviços externos.

Login, home, agenda, Gestão, recusas e boletim foram inspecionados com largura real de 390 e altura 844. As páginas não produziram overflow horizontal global; tabelas continuam dentro de regiões roláveis com cabeçalhos e nomes, e filtros da agenda permitem rolagem local. Navegação inferior fixa e ações foram conferidas. Não houve necessidade de um redesenho global. Não se afirma teste em aparelho físico nem revisão exaustiva de todos os estados/modais.

QA de volume ocorreu em banco exclusivo: 121 ocorrências criadas para teste mais uma fixture existente, total 122; primeira página 100, segunda 22, avanço desabilitado no fim e retorno à primeira página funcionando. Essa massa não foi copiada para o cenário de apresentação.

Para revisão local, o cenário final usa `cocapec_presentation_8bbe_v2`, API em `127.0.0.1:8103` e frontend em `localhost:4303`. A base foi migrada e o seed reexecutado; conferência agregada encontrou três recebimentos, dois boletins v2, uma recusa, nenhuma importação/ocorrência avulsa de QA e a nota pendente `900000004` ainda não consumida. Credenciais, anexos e preparação do ambiente permanecem em arquivos privados. As portas de QA foram encerradas; processos de desenvolvimento são temporários e devem ser iniciados novamente se a sessão do executor terminar.

## Riscos restantes e estado final

- **Bloqueador condicionado:** fechamento de exceção financeira válida continua bloqueado por falta de regra. Se a banca exigir esse desfecho específico, o requisito ainda não está atendido; o fluxo financeiro comum continua demonstrável.
- **Importante:** homologação de integrações externas, APK com estas alterações, aparelho físico e iOS não executados. Isolar banco, Redis e sessões de QA antes da apresentação. Sessão MVP tem um token por usuário, sem expiração/refresh; não representa prontidão de produção.
- **Polimento/escala:** seletores auxiliares extensos podem exigir busca no servidor; referência institucional depende de alguns recursos externos. Avisos CommonJS permanecem. A tela de qualidade do cenário sintético não contém baseline histórico; seus rótulos/datas foram cobertos por testes e a ausência real foi conferida no navegador.

1. **Promessa visível maior que a função:** não identificada nas superfícies remediadas e ensaiadas. Consulta de recusa, suporte administrativo, snapshot e integrações indisponíveis têm escopo explícito. Isso não é certificação de todas as telas/configurações.
2. **Dado de QA na apresentação:** o cenário novo não contém registros técnicos de QA. O aviso transitório observado durante teste paralelo foi explicado acima e eliminado pela separação do ensaio; nenhuma filtragem para esconder registros foi adicionada.
3. **Cálculo/dado artificial como real:** não identificado no cenário preparado. Origem sintética, referência institucional e cenários condicionais permanecem explícitos; a fórmula financeira existente é aplicada pelo backend.
4. **Fluxo crítico sem desfecho:** exceção financeira válida continua aguardando regra aprovada, com bloqueio explícito. Recusa avulsa termina em decisão do Armazém e consulta; não se promete uma revisão inexistente.
5. **Bloqueador conhecido para a banca:** nenhum encontrado no percurso comum descrito, após os testes desta rodada. Exceções financeiras válidas e execução das alterações em APK não estão validadas como parte desse percurso.
