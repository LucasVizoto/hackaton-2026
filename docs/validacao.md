# Validação da demonstração

Registro de execução em 03/10/2026, Windows/PowerShell, com PostgreSQL real. O documento distingue checks automatizados, percurso funcional e verificações pendentes. Não é certificação de produção. Nenhuma hipótese foi apresentada como confirmada pela Cocapec.

## Checks executados

Execute os comandos da raiz, exceto os comandos npm, executados em `frontend`, e Gradle, em `frontend/android`. O script `scripts/checks.ps1` reúne as verificações de backend, frontend e sincronização Android; os testes nativos são separados.

| Verificação | Comando | Último resultado registrado |
|---|---|---|
| Compose | `docker compose config --quiet` | PASS |
| Lint backend | `backend/.venv/Scripts/ruff.exe check backend` | PASS |
| Configuração Django | `backend/.venv/Scripts/python.exe backend/manage.py check` | PASS |
| Modelos e migrations | `backend/.venv/Scripts/python.exe backend/manage.py makemigrations --check --dry-run --noinput` | PASS; nenhuma alteração pendente |
| Migrations aplicadas | `backend/.venv/Scripts/python.exe backend/manage.py migrate --check` | PASS |
| Testes backend | `backend/.venv/Scripts/python.exe backend/manage.py test core receiving labor analytics imports --noinput` | PASS; 81 testes em PostgreSQL |
| Lint frontend | `npm run lint` | PASS |
| Testes de apresentação | `npm test` | PASS; 7 testes |
| Build Angular | `npm run build` | PASS |
| Sincronização da mesma aplicação | `npx cap sync android` | PASS |
| Build e testes locais Android | `./gradlew.bat :app:assembleDebug :app:testDebugUnitTest` | PASS |
| Instrumentação Android agregada | `./gradlew.bat connectedDebugAndroidTest` | PASS na última execução em um AVD; um teste de contexto/aplicação |
| Estrutura dos diagramas | XML, IDs/referências e BPMN 2.0 contra XSD oficial OMG | PASS |
| Percurso funcional no APK atual | Login, consulta e chegada com aprovações pendentes, refletida na web | PASS |
| Persistência após a gravação no APK atual | Checkpoint, reinício PostgreSQL/API e `verify_api.py --verify-persistence` | PASS; estado preservado |
| Falha de conexão no APK atual | Desligar a API e confirmar entrada; inspeção visual e conferência de estado | PASS; erro visível, sem sucesso e entrada não registrada |
| Asserção Maestro do alerta de conexão | Localizar o texto do alerta na hierarquia WebView | FAIL; hierarquia omitiu o alerta mostrado na inspeção visual |
| Instalação isolada | `setup.ps1 -SeedDemo`; ambiente Python novo, npm ci e PostgreSQL 17 separado | PASS; ferramentas Windows já disponíveis |
| Round-trip da instalação isolada | API direta e proxy HTTP da aplicação web | PASS |
| Importação isolada | Cinco fixtures sintéticas: dry-run, importação e repetição | PASS; cinco `unchanged`; nenhuma fonte original lida |
| Persistência isolada | Checkpoint e reinício real da API/PostgreSQL | PASS |
| Backup/restauração sintéticos | `pg_dump -Fc`; `pg_restore --exit-on-error` em outro banco | PASS; 37 tabelas, contagens e fingerprints iguais |
| Restauração de produção | Recuperação de dados/serviço de produção | NOT RUN |
| Abertura dos artefatos publicados no GitHub | Abrir textos, imagens e fontes editáveis após publicação | NOT RUN |
| iOS | Build e execução reais em Mac/Xcode | NOT RUN |

Os testes backend cobrem capacidade global/exclusividade e concorrência PostgreSQL, isolamento de fornecedores/anexos, extração XML segura, chegada independente de aprovações, dupla validação/destinos, etapas/recursos, cancelamento/atribuição/reagendamento, não recebimento avulso, matrículas/frações, precisão monetária, snapshot/reabertura/fechamento concorrente, importação idempotente, reconciliação das linhas, origem/cobertura e rastreabilidade dos indicadores. Testes de apresentação e instrumentação de contexto não substituem esses testes nem o percurso funcional.

A falha reproduzida de classes Kotlin duplicadas no módulo de testes gerado foi resolvida pelo alinhamento das dependências. A instrumentação agregada passou com um único transporte ADB por AVD. Seu teste de contexto não comprova percurso funcional nem aparelho físico.

## Conferência monetária reproduzível

`scripts/seed.ps1` prepara dados exclusivamente sintéticos. Os dois boletins de referência usam equipe artificial e as quantidades do exemplo oficial; não representam uma série operacional real.

| Caso | Produção exata | Diárias equivalentes | Total exato | Complemento exato |
|---|---:|---:|---:|---:|
| Exemplo oficial com equipe sintética | 918.1952 | 11 | 991.9041 | 73.7089 |
| Variação oficial com uma meia diária sintética | 918.1952 | 10,5 | 946.81755 | 28.62235 |
| Seed de quatro locais, 01–02/10/2026 | 2213.5100 | 28 | 2779.2796 | 565.7696 |

O piso é aplicado por boletim antes da agregação. O cenário de 11 para 10,5 diárias retorna diferença condicionada de `45.08655`, exibida como R$45,09, supondo a mesma produção. Não é economia medida. Histórico sem boletins retorna custo indisponível, sem converter ausência em zero nem usar pagamento de RH.

## Importação, HTTP e persistência

Os cinco conjuntos privados foram reimportados duas vezes com o leitor 1.1. A repetição retornou `unchanged`; os lotes ativos e os registros operacionais preexistentes foram preservados. Por lote, `accepted_rows + pending_rows + rejected_rows = preserved_rows = row_count`. Uma linha com vários motivos conta uma vez como pendente. Pendências permanecem armazenadas; erros estruturais abortam a gravação do lote. A reexecução do seed preservou os registros existentes, incluindo os exemplos com 11 e 10,5 diárias.

As verificações HTTP usam apenas registros sintéticos e mantêm checkpoints privados:

```powershell
.\backend\.venv\Scripts\python.exe scripts\verify_api.py --checkpoint
# Reinicie a API e o PostgreSQL, preservando o volume do banco.
.\backend\.venv\Scripts\python.exe scripts\verify_api.py --verify-persistence
```

Health PostgreSQL, autenticação, custos/cobertura por local, cenário sem escrita e qualidade sem linhas brutas passaram. Na rodada anterior, recebimento, eventos, reservas, visitas/recursos e boletim fechado reapareceram após recarga e reinício real da API/PostgreSQL. No APK atual, a chegada foi gravada com as aprovações ainda pendentes e conferida no mesmo registro pela web. O checkpoint foi criado depois da gravação; após reiniciar PostgreSQL e API, `verify_api.py --verify-persistence` passou, preservando os registros e valores. A recarga exige novo login porque o token fica em memória.

As telas foram acessadas com API real. Foram exercitados anexo/agendamento, chegada com aprovações pendentes, Compras, destinos de dois armazéns, entrada/etapas/saída, recursos globais, atribuição de vaga cancelada, não recebimento avulso, boletim/fechamento e cenário. O APK anterior executou anexo sintético pelo Storage Access Framework, cancelamento/repetição e recuperação nativa após reinício. O APK atual repetiu login, consulta e gravação de chegada, com conferência web e checkpoint após reinício.

Para isolar falha de conexão, a API foi desligada e a ação de confirmar entrada foi acionada no APK. A imagem mostrou erro de conexão, sem confirmação de sucesso; a entrada continuou não registrada. Após restabelecer a API, a verificação de persistência manteve o estado do checkpoint. A asserção de texto do Maestro retornou FAIL porque a hierarquia WebView não incluiu o alerta dinâmico; esse resultado de automação é distinto da inspeção visual e da conferência do estado, ambas PASS. Não se declara que toda a automação Maestro passou.

Os indicadores operacionais usam a data própria de cada evento; custos usam boletins fechados. Os links de origem para Gestão/administrador são limitados a 100 por conjunto, com contagem e indicação de truncamento. O limite dos links não altera os totais. Não há nomes, matrículas, documentos ou caminhos históricos nessas respostas de origem.

## Artefatos e limites da entrega

A prova isolada partiu de `git archive` do commit `523b91d`, acrescido da documentação final, e executou `setup.ps1 -SeedDemo` com ambiente Python novo, 22 dependências fixadas, `npm ci` e PostgreSQL 17 separado. Os lockfiles permaneceram iguais aos da revisão arquivada. Check Django, consistência/aplicação das migrations, lint, sete testes de apresentação e build Angular de 554,39 kB passaram. API direta e proxy web passaram em HTTP; essa prova isolada não automatizou um navegador renderizado. A conferência visual da aplicação principal tem evidência própria descrita acima.

As cinco fixtures da prova eram exclusivamente sintéticas. Dry-run, importação e reimportação passaram; repetir retornou `unchanged` nos cinco conjuntos. Checkpoint após reiniciar API/PostgreSQL passou. Um dump customizado foi restaurado em outro banco sintético; as 37 tabelas conservaram contagens e fingerprints. Isso comprova a recuperação da demonstração, sem equivaler a restauração de produção.

O Windows da prova já possuía Docker, Python/uv, Node e ferramentas de desenvolvimento. Instalação em sistema operacional vazio permanece NOT RUN. A auditoria npm somente de leitura identificou 15 avisos em dependências de desenvolvimento/build, incluindo dois críticos; versões não foram alteradas. Avaliação completa de segurança da aplicação/runtime permanece NOT RUN.

Os quatro artefatos estão no [índice de documentação](README.md), com texto, imagens SVG/PNG e fontes editáveis `.drawio`/`.bpmn`. O BPMN inclui notação e coordenadas BPMN DI; é documental, sem execução em motor de workflow. A validação XSD confere estrutura; os testes verificam as regras do aplicativo.

Fontes oficiais são citadas nominalmente, sem cópia dos originais. Dados identificáveis, anexos, checkpoints, banco/dumps, credenciais e traces permanecem privados. Planos e auditorias não integram a documentação final. A disponibilidade dos textos, imagens e fontes editáveis no GitHub permanece NOT RUN até conferência.

Limites: nenhum aparelho físico foi validado; iOS permanece NOT RUN sem Mac; instalação em sistema operacional vazio e restauração de produção permanecem NOT RUN. Remoção pós-evento permanece NOT RUN, prevista após o prazo de retenção e autorização do responsável. Não existe integração SAP real, economia real medida ou certificação de produção. As [hipóteses de domínio](hipoteses.md) continuam explícitas e reversíveis. O histórico não fornece série de boletins por local.
