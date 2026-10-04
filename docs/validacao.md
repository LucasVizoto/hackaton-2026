# Ajustes de produção e tempo real — 03/10/2026

Base: main `5f54856`, preservando os commits anteriores. Incorporados descoberta de câmera Android, inventário privado aditivo e verificações de Portaria; adicionados união de migrations, ASGI/Daphne, Redis, permissões de origem, decisão concorrente e recuperação de notificações. Nenhuma alteração foi aplicada em produção.

**213 testes backend passaram em PostgreSQL**, em 77,810 s, incluindo emissão após commit, descarte em rollback, decisão persistida com broker indisponível, decisões concorrentes, autenticação/origens de WebSocket, entrega entre processos e conexão ociosa além do timeout bloqueante. **35 testes frontend passaram**, incluindo endereço nativo da API, cancelamento de conexão pendente no logout e ausência de tentativas duplicadas. Ruff, consistência de migrations, ESLint, build Angular, ShellCheck dos scripts modificados e adaptação/validação do Caddy em contêiner passaram. Os avisos CommonJS de OCR/pdfmake permanecem.

As três cópias isoladas migraram sem diferenças inesperadas: base de produção (38 tabelas, 130.761 registros), merge anterior (57 tabelas, 130.854 registros) e árvore com decisões de Portaria (57 tabelas, 130.854 registros). A comparação preserva todas as colunas anteriores, exceto as transformações de máquina/retenções já previstas na integração anterior. A união nova não transforma dados. Evidências em `.private/production-audit/migration-results.json`.

Jornada sintética no navegador/Android: aceite mostrado como “Pode passar”; recusa feita pelo Armazém no navegador recebida automaticamente no APK da Portaria; fila de Compras mostrou a mesma recusa. Com Redis parado, uma decisão foi persistida e a interface exibiu desconexão; após iniciar Redis, a conexão e a consulta ao estado persistido retornaram. O teste encontrou e corrigiu o timeout padrão de leitura do Redis, que encerrava sockets ociosos; o teste entre processos passou a cobrir heartbeat após dez segundos.

Android: build `assembleDebug`, testes `testDebugUnitTest`, instalação e login/jornada no `emulator-5554` executados. O APK final preservou a decisão após reinstalação. Uma asserção textual Maestro de cartão falhou porque a hierarquia da WebView omitiu seu texto; a captura visual confirmou nome, status e encaminhamento. Não se declara aprovação dessa asserção. Aparelho físico, câmera física e iOS não foram executados.

APK privado: `.private/production-audit/app-under-test.apk`, SHA-256 `3a04ad5e1f9bf3cea0946d3e9f4b0e5ecffa09111851cd545320796749e2d9fb`. Capturas: `web-redis-offline.png`, `web-recovered.png`, `android-rejected.png`. Uma criação sintética adicional via ferramenta foi bloqueada pela revisão automática; a recuperação foi conferida com os registros já existentes. Os arquivos de QA e credenciais não entram no Git.

---

# Integração Richardy — 03/10/2026

Integração de `richardy/fix-armazem-recebimento` (`4449592`, incluindo `490d04d`) à main `b7a28f3`. As decisões confirmadas substituem as regras anteriores: somente Fornecedor agenda; máquina/implemento compartilha uma unidade; movimentação libera a vaga de origem; chave de NF é opcional e o número é obrigatório. A API v2, MultiNF, quatro marcos, Portaria fotográfica e apuração individual foram preservados.

**204 testes backend em PostgreSQL passaram** na rodada final (63,765 s), incluindo concorrência, permissões v1/v2 sem exceção de administrador para criar, alias de máquina, intervalo de disponibilidade, chave/número, encaminhamento idempotente, manutenção de chegada/etapas e bloqueio após início da descarga. Ruff, Django check e consistência de migrations passaram. **33 testes frontend**, ESLint e build Angular passaram. Avisos CommonJS de Tesseract/pdfmake permanecem; nenhuma dependência foi atualizada.

As migrations originais foram mantidas; `receiving/0008` une as árvores e `0009` normaliza máquina e retenções ativas. Três bancos isolados receberam a atualização: main (57 tabelas, 130.785 registros), Richardy (38 tabelas, 130.772 registros) e base da produção (38 tabelas, 130.772 registros). Todos os hashes das colunas anteriores conferiram com a transformação esperada. O verificador calcula previamente apenas a normalização do código, a capacidade de retenções ativas de máquina e a liberação de retenções de origem quando a migration correspondente ainda não foi aplicada. Outras colunas, IDs, eventos, históricos e retenções permanecem na comparação. Os bancos original e de produção não receberam migrations nesta rodada.

A jornada HTTP sintética percorreu duas NFs, dois armazéns, quatro marcos e pessoa com um único boletim financeiro; a apuração reconciliou. Após reiniciar a API isolada, recebimento e snapshot financeiro permaneceram idênticos. Evidências privadas: `.private/validation-richardy/migration-results.json`, `http-journey.json` e `persistence.json`.

No navegador: PDF sem número foi recusado; PDF com número manual e sem chave foi reservado como máquina. Armazém não recebeu o botão de criar e a rota direta retornou à agenda. O encaminhamento a Compras gravou justificativa e notificação. Seleção inicial vazia, máquina compartilhada, mudança para batida incompatível, sábado fechado e troca rápida de datas foram exercitados. Com a API parada, o calendário exibiu erro e disponibilidade ausente, sem links de vagas fictícias; atualizar após o retorno recuperou os dados.

Android: build `assembleDebug` e testes locais `testDebugUnitTest` passaram; APK instalado no `emulator-5554`, com backend isolado. Login de Fornecedor, agenda móvel, formulário em três etapas, opção máquina e seleção visual do horário foram exercitados. A asserção Maestro de `checked` falhou porque a hierarquia da WebView não expôs esse estado; a captura visual confirmou o destaque do horário. Não se declara sucesso integral dessa asserção. Aparelho físico e iOS não executados nesta rodada.

APK local: `.private/validation-richardy/app-under-test.apk`, SHA-256 `c7f00b5faa815e4eee7cdfe2c2fb5f444aaf0afe4ec4b1f898e7275452e00100`. Capturas, logs, anexos sintéticos e cópias dos bancos ficam privados. Esta entrega publica código na main; não comprova deploy web ou distribuição de APK em produção. Na inspeção do servidor configurado, a base ativa era `6ff06af`, sem as migrations do Richardy.

---

# Validação da revisão conciliada com main

Conciliação de 03/10/2026 entre o snapshot v2 `d4017da` e `origin/main` em `6ff06af`. O escopo preserva boletim/pessoa/dia e acrescenta as contribuições de Portaria avulsa com foto, calendário e impressão diária. Os resultados da implementação v2 registrados abaixo pertencem à rodada anterior e não certificam automaticamente esta revisão.

Nesta rodada, **195 testes backend em PostgreSQL passaram**, em 68,198 segundos, assim como Ruff, Django check e a detecção de migrations pendentes. O frontend passou em **33 testes**, ESLint, compilação TypeScript/Angular e build. Os **187 testes backend e 23 frontend abaixo pertencem à revisão anterior**. Esta seção registra a conciliação Git e a homologação local; não comprova implantação no servidor.

A revisão do parser de OCR tem nove testes textuais passando: número impresso prioritário, sugestão sem zeros de preenchimento, número curto, chave completa/agrupada, rejeição de sequências maiores, campos desconexos, estrutura incompatível, múltiplas chaves e números impressos ambíguos. O teste no navegador também executou Tesseract sobre um PNG sintético: `NF-e No 000830001` gerou a sugestão `830001`, preservou a imagem e manteve o envio bloqueado até a confirmação humana. Esse teste encontrou e corrigiu a resolução do export CommonJS no bundle Angular. Qualidade de câmera física e documentos reais não foram homologados.

Na base de QA, as migrations de união `core/0003` e `receiving/0007` foram aplicadas com sucesso. As sete migrations preexistentes das duas árvores conservaram seu conteúdo, desconsiderando apenas a representação das quebras de linha. A releitura HTTP de `verify_v2_journey --verify-checkpoint` após a conciliação confirmou o recebimento, o boletim e as parcelas anteriores; evidência privada em `persistence-after-merge.json`. Ruff dos scripts de implantação passou. `npm audit --omit=dev` não apontou avisos em dependências de runtime; os 15 avisos anteriores das ferramentas de build/desenvolvimento permanecem, sem atualização de versões nesta rodada.

Dois replays adicionais compararam hashes de todas as colunas anteriores: a cópia que já executava a v2 preservou **56 tabelas e 130.774 registros**; a cópia no estado da equipe preservou **38 tabelas e 130.764 registros**, inclusive papel `portaria` e aviso fotográfico. O papel persistido não foi reescrito; a autorização reconhece o alias. Evidências privadas: `.private/validation-v2/merge-backend-checks.json` e `merge-migration-results.json`.

Na web, Portaria acessou os quatro marcos e as duas NFs anteriores, preservou a sessão após recarga e enviou um aviso fotográfico sintético. Armazém recebeu o aviso, abriu a imagem e registrou ciência pela API. O calendário diário/semanal exibiu as duas notas, ocupação global e horários fechados; a máquina do dia 09/10 consumiu duas unidades de oito, independentemente dos dois destinos. A impressão diária abriu o PDF com o título e a data corretos. A política do navegador impediu inspecionar a aba `blob:`; a inspeção visual do PDF foi feita separadamente com o arquivo sintético do teste de geração, em uma página e sem colunas cortadas. As capturas e o PDF de teste estão em `.private/validation-main-20261003/`.

O reteste final confirmou que o indicador “Nova” desaparece na mesma tela depois da ciência confirmada pelo servidor, sem recarregar. APK conciliado: **2.0.0-rc1**, código **3**, bundle `main-R2GDWV7G.js`, SHA-256 `46c6a4e6a963ce18b6f797dbfc5da3ef936ac0872316c9a5fcc15bd3d7cb96d6`. Build, instalação preservando os dados e verificação no `emulator-5554` passaram: login Portaria, aviso com foto separado, calendário de 08/10 com máquina e duas NFs, detalhe com horários e nomes dos armazéns. A cópia local é `.private/validation-main-20261003/app-under-test.apk`; não é uma publicação de APK no servidor. Aparelho físico e iOS não foram executados nesta rodada.

O push para `main` não comprova ativação do sistema. Não há workflow GitHub Actions versionado nesta conciliação. A [automação de implantação existente](deploy.md) acompanha `main` em clone separado e exige inspeção do SHA de origem e da integração, validação e aceite HTTPS antes de registrar sucesso. Publicação Git, implantação web e distribuição de APK são estados separados.

## Rodada anterior — implementação v2

Rodada de 03/10/2026, sobre a base `1ef6e68`, com alterações locais ainda não publicadas. Todos os cenários novos usam dados sintéticos em banco isolado. Os resultados antigos do seed e de outras versões estão preservados mais abaixo e não devem ser atribuídos automaticamente à v2.

## Regras, migração e persistência

- **187 testes Django passaram em PostgreSQL**, incluindo concorrência real de reserva e pessoa/data, permissões, compatibilidade v1, conferência/saldos, parcelas, pendências, paginação e integrações com respostas controladas. Ruff, Django check e `makemigrations --check --dry-run` passaram.
- Migração final ensaiada em `cocapec_v2_migration_final`, restaurada do dump anterior. Aplicou primeiro as migrations já pertencentes à base e depois todas as novas, até `receiving/0006`. **37 tabelas e 130.761 registros anteriores mantiveram os hashes das colunas originais**, IDs e snapshots; novos marcos continuaram nulos nos legados. O banco operacional foi preservado.
- Referências financeiras oficiais mantidas: produção `918.1952`, total `991.9041`, complemento `73.7089`; com 10,5 diárias equivalentes, total `946.81755`, complemento `28.62235`. Meia diária de serviço mantém `45.0786`, separada da fração de participação.
- Jornada HTTP contra o servidor local: duas NFs, uma reserva exclusiva, entrada na Portaria, dois armazéns sequenciais, conferência por item e saída da unidade. Uma pessoa trabalhou em dois locais e recebeu uma única parcela em um boletim; tentativa de segundo vínculo financeiro foi recusada. Produção `45.0786`, total `90.1731`, valor exibido `90.17`, diferença de conciliação `0.00`.
- Depois de interromper e reiniciar a API, a releitura confirmou igualdade de revisão, marcos, notas, itens, visitas e snapshot financeiro. Isso valida persistência no PostgreSQL através do reinício da aplicação; não é promessa de gravação offline nem teste de desastre do servidor de banco.

## Interface web e Android

Os 23 testes de apresentação/validação do frontend passaram, assim como ESLint, TypeScript e build Angular. A verificação visual usou o navegador interno do Codex; a verificação móvel usou o AVD `Cocapec_QA_API_36` (`emulator-5554`) via Maestro. O APK é de homologação local, com API acessada pelo redirecionamento `adb reverse tcp:8000 tcp:8000`.

O problema anterior do horário foi reproduzido no navegador e no APK arquivado: tocar a linha de 10h não mudava o seletor de 08h; trocar para carga exclusiva mantinha 08h e o controle oferecia horários incompatíveis. O formulário novo tem apenas um seletor, inicia sem escolha, descarta resposta antiga e bloqueia horários incompatíveis. Na inspeção Android foi encontrada e corrigida também a perda visual de uma escolha ainda válida durante a reconstrução das opções; o controle passou a usar o acessor de formulário do Angular.

O reteste do **APK final `99604d24`, versão 2.0.0-rc1**, passou: Batida às 10h → Paletizada preservou 10h; Paletizada às 08h → Batida limpou a escolha incompatível; mudar entre 05/10 e 06/10 preservou 10h quando elegível. Sábado 03/10 e domingo 04/10 limparam e desabilitaram o seletor. As opções incompatíveis ficaram desabilitadas. O comparativo, hashes e capturas estão em `.private/validation-v2/android-comparativo.md` e `android-final-*.png`. A consulta de Portaria no Android foi exercitada no APK intermediário; no build final, a projeção atual foi novamente verificada na web e pelos testes de API.

Na web, a conferência individual e o painel mostraram uma pessoa em Adubo e Insumos com uma única parcela `R$ 90,17`; RH apareceu separado, sem registros fabricados. O painel exibiu um caminhão, espera de 10 minutos, permanência total de 55 minutos e diferença de conciliação `R$ 0,00`. O histórico do boletim apresentou revisão, autor, horário e motivo.

Uma segunda jornada foi executada **pelos formulários da web**, com contas sintéticas separadas para Fornecedor, Compras, Armazém e Portaria: upload de duas notas, rejeição de número divergente e correção, reserva exclusiva, chegada, aprovação de Compras, atribuição de Adubo e Insumos, conferência de ambos os itens, entrada/saída em cada local e saída final da unidade. O detalhe confirmou descarga concluída enquanto a saída da Portaria ainda estava ausente; somente a ação da Portaria registrou esse último marco. Evidência: `web-journey.json` e `web-journey-completed.png`.

Com a API desligada, web e Android exibiram erro de conexão, sem confirmar sucesso. Com o serviço restaurado, os dados persistidos voltaram a aparecer. Portaria consultou placas, transportadora e duas notas; a interface restringe suas ações e a API bloqueia dados financeiros e o conteúdo interno das decisões de Compras. A ausência de configuração de IA/clima/envios é exibida explicitamente.

## Matriz dos critérios do plano

| Critério | Evidência principal |
|---|---|
| 1. MultiNF e fornecedor | Testes PostgreSQL, jornada HTTP e reserva pela interface |
| 2. Disponibilidade e concorrência | Testes de disputa pela vaga; reprodução e verificação do controle web/Android |
| 3. Identidade da NF e nova tentativa | Parser/API testados; divergência digitada/XML recusada na web, dados preservados e reserva aceita após correção |
| 4. Portaria | Testes de ACL, inclusive projeção v1, anexos e assinatura; inspeção web/Android |
| 5. Quatro eventos | Testes de sequência/correção/recusa/repetição; jornada HTTP com dois locais |
| 6–10. Boletim, pessoa, centavos, serviços e exceções | Referências oficiais, concorrência pessoa/data, maiores restos, política pendente e serviços de diária em testes PostgreSQL |
| 11. Parciais e saldo | Testes de conferência, referência de complemento, cancelamento e limites de NF/pedido |
| 12. Migração | Comparação dos hashes anteriores e verificação de marcos legados ausentes |
| 13. Clientes | Mesmo recebimento consultado na web e APK; testes de bloqueio explícito do cliente v1 |
| 14. Persistência | Checkpoint antes/depois de reiniciar API; indisponibilidade observada nos dois clientes |
| 15. Painel/IA | Conciliação e cobertura testadas; IA somente leitura exercitada com resposta controlada, sem chamada externa real |

## Limites de homologação e publicação

Pacote final local: **2.0.0-rc1**, código Android **3**, bundle web `main-PNC54NOK.js`. O APK contém os mesmos **53 arquivos** da compilação web, comparados byte a byte. SHA-256 do APK: `99604d241e582331e196a237631d83ca151c0314b3863e62fe856e1f8d326755`. Cópia preservada em `.private/validation-v2/cocapec-v2-rc1-local.apk`, com manifesto em `release-manifest.json`. `assembleDebug` e a tarefa `testDebugUnitTest` concluíram com sucesso; o teste nativo existente era apenas o exemplo e estava atualizado, portanto a evidência funcional móvel é o percurso Maestro.

- **Aparelho físico e iOS: não executados.** O teste Android refere-se ao emulador; Gradle compila o APK, mas seu teste unitário nativo de exemplo não comprova as regras do produto.
- Integrações externas: nenhum envio real de email/WhatsApp/Google, OCR, IA ou consulta meteorológica foi realizado. Exigem configuração, contas e homologação; detalhes em [integrações v2](v2/integracoes.md).
- Regras excepcionais de remuneração permanecem pendentes por decisão do plano. Não foram inventadas frações ou políticas.
- Backend, web e APK **não foram publicados**. Ativação ampliada e distribuição aguardam o aceite conjunto previsto no plano. Credenciais, fontes reais e evidências nominais não são publicadas no repositório.

Evidências técnicas locais: `.private/validation-v2/backend-final-checks.json`, `migration-final-result.json`, `http-journey.json`, `persistence-final.json`, `release-manifest.json`, `android-comparativo.md` e capturas `web-*.png`/`android-*.png`. Os scripts [verify_v2_migration.py](../scripts/verify_v2_migration.py) e [verify_v2_journey.py](../scripts/verify_v2_journey.py) permitem repetir a verificação usando uma cópia isolada e dia útil livre. A opção `--verify-checkpoint` apenas relê os registros da jornada.

---

# Histórico de validação do seed e da demonstração anterior

Registro de execução em 03/10/2026, Windows/PowerShell, com PostgreSQL real. O documento distingue checks automatizados, percurso funcional e verificações pendentes. Não é certificação de produção. Nenhuma hipótese foi apresentada como confirmada pela Cocapec.

## Seed completo do Hackathon

O bootstrap foi executado com os 938 arquivos originais em PostgreSQL 17 descartável, separado do banco atual. A carga terminou com as contagens abaixo. Os relatórios com manifestos, hashes e caminhos permanecem em `.private`; somente os agregados são documentados aqui.

| Conjunto | Resultado preservado |
|---|---:|
| Arquivos de origem | 938 entradas; 937 arquivos físicos, com uma duplicata idêntica |
| Produtos / pares produto-depósito | 10.604 / 10.899 |
| Fornecedores / matrículas | 872 / 15 |
| Armazéns / depósitos / equipamentos | 4 / 14 / 4 |
| Movimentação documental | 41.779 linhas |
| Estoque | 1.245 posições; 12 referências ausentes |
| RH diário do CSV | 428 datas |
| Observações individuais de RH | 6.380; 5.081 utilizáveis |
| Notas / itens fiscais | 458 / 831; duas chaves com conflito permanecem pendentes |
| Tarifas / boletins / linhas / participantes | 14 / 1 / 14 / 11 |
| Lotes / linhas de proveniência | 13 / 14.279 |

O boletim histórico conserva produção `918.1952`, total `991.9041` e complemento `73.7089`. Sua auditoria identifica a importação atual; o fechamento histórico desconhecido permanece nulo. Foi criada somente a conta técnica inativa, sem senha utilizável. Não foram criados perfis, tokens, sessões ou registros operacionais sem fonte.

Dois processos de `bootstrap_database` começaram juntos em outro PostgreSQL vazio. Um retornou `completed`, o outro `unchanged`, com o mesmo `SeedRun`. Após outra reexecução, as 42 tabelas conservaram contagens e fingerprints de todas as colunas, incluindo IDs; os 937 arquivos físicos mantiveram os hashes. Cada uma das 938 entradas de `SourceFile` foi comparada com o arquivo armazenado.

Em um terceiro banco descartável, foram aplicadas as migrations antigas e usados os cinco leitores da revisão anterior para importar as fontes reais. O bootstrap atualizou o schema e completou a carga, preservando fingerprints e IDs de produtos, associações, fornecedores, matrículas, movimentação, RH diário, lotes e linhas de proveniência anteriores. Os cinco lotes ativos conservaram a fonte vazia e receberam apenas o vínculo novo com `SourceFile`.

A suíte atual passou com **105 testes Django em PostgreSQL**. Os 24 testes do seed cobrem rollback da cópia parcial e de falha tardia, retomada, ausência/estrutura/limites das fontes antes de migrations, conflitos de cadastro, XMLs repetidos/conflitantes, fornecedores ausentes/ambíguos, estoque sem produto/data, RH com datas inválidas/duplicatas/conflitos/precisão, fórmulas preservadas, downloads autorizados, relatório privado e compatibilidade com `seed_demo`. Lint, check Django, consistência de migrations e `git diff --check` passaram. Os testes de frontend/mobile abaixo pertencem à rodada anterior e não foram repetidos nesta alteração de backend.

As fontes originais e o banco atual foram preservados: as novas migrations não foram aplicadas ao banco principal durante a validação.

## Checks executados

Execute os comandos da raiz, exceto os comandos npm, executados em `frontend`, e Gradle, em `frontend/android`. O script `scripts/checks.ps1` reúne as verificações de backend, frontend e sincronização Android; os testes nativos são separados.

| Verificação | Comando | Último resultado registrado |
|---|---|---|
| Compose | `docker compose config --quiet` | PASS |
| Lint backend | `backend/.venv/Scripts/ruff.exe check backend` | PASS |
| Configuração Django | `backend/.venv/Scripts/python.exe backend/manage.py check` | PASS |
| Modelos e migrations | `backend/.venv/Scripts/python.exe backend/manage.py makemigrations --check --dry-run --noinput` | PASS; nenhuma alteração pendente |
| Migrations aplicadas | `backend/.venv/Scripts/python.exe backend/manage.py migrate --check` | PASS nos bancos descartáveis do seed; banco principal preservado |
| Testes backend | `backend/.venv/Scripts/python.exe backend/manage.py test core receiving labor analytics imports --noinput` | PASS; 105 testes em PostgreSQL |
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
| Abertura dos artefatos publicados no GitHub | Abrir índice, quatro textos e imagens; comparar fontes publicadas com Git local | PASS em 03/10/2026; 34 arquivos iguais à revisão publicada |
| iOS | Build e execução reais em Mac/Xcode | NOT RUN |

Os testes backend cobrem capacidade global/exclusividade e concorrência PostgreSQL, isolamento de fornecedores/anexos, extração XML segura, chegada independente de aprovações, dupla validação/destinos, etapas/recursos, cancelamento/atribuição/reagendamento, não recebimento avulso, matrículas/frações, precisão monetária, snapshot/reabertura/fechamento concorrente, importação idempotente, reconciliação das linhas, origem/cobertura e rastreabilidade dos indicadores. Testes de apresentação e instrumentação de contexto não substituem esses testes nem o percurso funcional.

A falha reproduzida de classes Kotlin duplicadas no módulo de testes gerado foi resolvida pelo alinhamento das dependências. A instrumentação agregada passou com um único transporte ADB por AVD. Seu teste de contexto não comprova percurso funcional nem aparelho físico.

## Conferência monetária reproduzível

`manage.py seed_demo` prepara dados exclusivamente sintéticos; `scripts/seed.ps1` agora aplica o baseline privado completo. Os dois boletins sintéticos de referência usam equipe artificial e as quantidades do exemplo oficial; não representam uma série operacional real. O exemplo de 17/11/2025 é pulado quando ocupado pelo boletim histórico.

| Caso | Produção exata | Diárias equivalentes | Total exato | Complemento exato |
|---|---:|---:|---:|---:|
| Exemplo oficial com equipe sintética | 918.1952 | 11 | 991.9041 | 73.7089 |
| Variação oficial com uma meia diária sintética | 918.1952 | 10,5 | 946.81755 | 28.62235 |
| Seed de quatro locais, 01–02/10/2026 | 2213.5100 | 28 | 2779.2796 | 565.7696 |

O piso é aplicado por boletim antes da agregação. O cenário de 11 para 10,5 diárias retorna diferença condicionada de `45.08655`, exibida como R$45,09, supondo a mesma produção. Não é economia medida. Histórico sem boletins retorna custo indisponível, sem converter ausência em zero nem usar pagamento de RH.

## Importação, HTTP e persistência

Na rodada anterior ao seed completo, os cinco conjuntos privados foram reimportados duas vezes com o leitor 1.1. A repetição retornou `unchanged`; os lotes ativos e os registros operacionais preexistentes foram preservados. Por lote, `accepted_rows + pending_rows + rejected_rows = preserved_rows = row_count`. Uma linha com vários motivos conta uma vez como pendente. Pendências permanecem armazenadas; erros estruturais abortam a gravação do lote. A reexecução do seed sintético preservou os registros existentes, incluindo os exemplos com 11 e 10,5 diárias.

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

Fontes oficiais são citadas nominalmente, sem cópia dos originais. Dados identificáveis, anexos, checkpoints, banco/dumps, credenciais e traces permanecem privados. Planos e auditorias não integram a documentação final. Em 03/10/2026, o índice e os quatro artefatos foram abertos no repositório público: texto e imagens carregados, fontes editáveis disponíveis e 34 arquivos com hashes iguais à revisão publicada `048da0c`. A revisão dos caminhos e conteúdos atuais/históricos não encontrou originais, credenciais, dumps ou anexos privados no Git.

Limites: nenhum aparelho físico foi validado; iOS permanece NOT RUN sem Mac; instalação em sistema operacional vazio e restauração de produção permanecem NOT RUN. Remoção pós-evento permanece NOT RUN, prevista após o prazo de retenção e autorização do responsável. Não existe integração SAP real, economia real medida ou certificação de produção. As [hipóteses de domínio](hipoteses.md) continuam explícitas e reversíveis. O histórico não fornece série de boletins por local.

## Integração de logística de 03/10/2026

Incorporado o commit `9df952f`, preservando `c9434f4` e os históricos anteriores. O aviso com foto da Portaria aceita e preserva zeros à esquerda no número da nota; essa regra não altera a identidade fiscal das NFs do agendamento. A foto abre em outra aba na web e em um visualizador interno no aplicativo nativo ou quando a aba não puder ser aberta. Solicitações duplicadas ficam bloqueadas durante a consulta e respostas após sair da tela são descartadas.

A migração `receiving.0011_merge_logistics_update` une as duas migrações `0010` publicadas, sem operações sobre dados. Aplicação em cópia PostgreSQL isolada preservou os fingerprints das 57 tabelas e dos 130.854 registros conferidos. `makemigrations --check` não identificou divergências.

Validação desta integração: 213 testes de backend/PostgreSQL aprovados, incluindo Portaria e tempo real com Redis; 35 testes de frontend aprovados; Ruff, lint, build Angular e `assembleDebug` aprovados. Na web, a foto sintética existente abriu em nova aba. No emulador Android API 36, login, consulta do aviso recusado e abertura/fechamento do visualizador interno passaram. A foto utilizada nessa jornada era a fixture mínima de 1 pixel; legibilidade de uma nota real, aparelho físico e iOS não foram verificados nesta rodada. O bloqueio de popup foi tratado no código, mas não induzido na jornada web. Os avisos de build CommonJS de OCR/PDF e `flatDir` do Android permanecem. Nenhum deploy ou alteração do banco de produção foi executado.
