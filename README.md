# Recebimento Cocapec — demonstração local

Agenda e operação de recebimentos, boletins diários e diagnóstico financeiro por local/período. Backend Django/DRF e PostgreSQL 17; uma aplicação Angular 20.3/Ionic 8 usada no navegador e pelo Capacitor 8 no Android. Dados e regras persistem no servidor. O aplicativo não está pronto para produção.

## Executar no Windows / PowerShell 7

Acabou de clonar? Siga o [guia de instalação e primeira execução](docs/como_rodar.md), com ferramentas necessárias, contas de demonstração e solução dos erros mais comuns.

Pré-requisitos: Docker Desktop ativo, Python 3.14, uv e Node 24/npm. O backend roda nativamente; Compose sobe somente o PostgreSQL, na porta local 55433. Android é um passo separado, sem download automático de SDK.

```powershell
Set-Location C:\Projects\hackaton-2026
.\scripts\setup.ps1 -PrivateDataPath 'C:\pasta-privada\DADOS_HACKATHON_2026' -SeedDemo
# Em um terminal:
.\backend\.venv\Scripts\python.exe backend\manage.py runserver 127.0.0.1:8000
# Em outro terminal:
Set-Location frontend
npm start
# Abra http://localhost:4200
```

O setup cria `.env` privado com segredos aleatórios se o arquivo ainda não existir, valida o pacote privado completo e executa migrations e seed do banco. Use `-PrivateDataPath` ou configure `PRIVATE_DATA_DIR`. O baseline conserva os dados históricos e todos os arquivos privados, sem gerar horários ou operações ausentes nas fontes.

`-SeedDemo` acrescenta as contas `fornecedor_demo`, `fornecedor_b_demo`, `compras_demo`, `armazem_demo`, `gestao_demo` e `portaria_demo`; a senha é `DEMO_PASSWORD` do `.env` local. Essas fixtures são sintéticas e identificadas. O seed histórico cria somente uma conta técnica inativa, sem senha utilizável. Nenhuma senha existente é alterada.

O token fica apenas em memória: ao recarregar, entre novamente. Recebimentos e boletins são recuperados do PostgreSQL. Logout revoga o token; este MVP tem um token por usuário e não implementa expiração/refresh. Credenciais não devem ser usadas em serviço público.

## Inicializar um banco novo e preservar anexos privados

O comando portátil de montagem funciona com qualquer banco PostgreSQL novo configurado por `DB_*`, inclusive no servidor de produção:

```powershell
.\backend\.venv\Scripts\python.exe backend\manage.py bootstrap_database --path 'C:\pasta-privada\DADOS_HACKATHON_2026' --dry-run
.\backend\.venv\Scripts\python.exe backend\manage.py bootstrap_database --path 'C:\pasta-privada\DADOS_HACKATHON_2026' --report '.private\seed-report.json'
```

Em Linux, use `python backend/manage.py bootstrap_database` com `PRIVATE_DATA_DIR` e `MEDIA_ROOT` configurados. O comando valida as fontes, serializa migrations e aplica o baseline em uma única transação. Reexecutar o mesmo pacote retorna `unchanged`; outro pacote não substitui o baseline. Fontes obrigatórias ausentes ou conflitos impedem a inicialização. Veja [cobertura, pendências e uso no deploy](docs/importacao.md).

No pacote analisado: 938 arquivos, 10.604 produtos, 872 fornecedores, 41.779 movimentos, 1.245 posições de estoque, 428 dias de RH, quatro equipamentos e um boletim histórico preenchido. Os 460 XMLs possuem 458 chaves distintas. Dois conflitos fiscais ficam como documentos pendentes; os dois DANFEs sem XML entram como notas manuais. A posição de estoque não recebe uma data inventada.

Configure `PRIVATE_DATA_DIR` no `.env`, apontando para a pasta local `DADOS_HACKATHON_2026`. Ela pode ficar fora do repositório. Alternativamente passe um caminho ao script:

```powershell
.\scripts\import.ps1 -PrivateDataPath 'C:\pasta-privada\DADOS_HACKATHON_2026' -DryRun
.\scripts\import.ps1 -PrivateDataPath 'C:\pasta-privada\DADOS_HACKATHON_2026'
.\scripts\seed.ps1 -PrivateDataPath 'C:\pasta-privada\DADOS_HACKATHON_2026' -DryRun
```

`import_private` continua disponível para os cinco conjuntos históricos originais e conserva sua política de versões por lote. `seed_hackathon`, usado por `seed.ps1`, instala o baseline completo sem sobrescrever registros equivalentes ou senhas. Peso por pedido não é somado por linha; produto e depósito são relações distintas. O CSV de RH não vira boletim nem custo de produção. A API de qualidade apresenta contagens/limites sem abrir linhas originais. Não há API de exportação dos dados brutos.

Anexos de NF-e são gravados em `.private/media` (`MEDIA_ROOT` configurável), sem rota pública. Downloads exigem autorização. XML usa `defusedxml`, com limites e bloqueio de DTD/entidades; extração não valida autenticidade fiscal nem vincula automaticamente códigos do fornecedor aos códigos internos. PDF exige conferência manual.

## Regras demonstradas

- Capacidade global: 08h, 10h, 13h, 15h em dias úteis sem feriados configurados; batida exclusiva ou até duas cargas paletizadas/big bag. Reservas concorrentes usam transações e bloqueios PostgreSQL.
- Chegada independe das aprovações. Entrada exige Compras, armazém, destinos e reserva ativa. Etapas por armazém são sequenciais; chapas globais são confirmados e nunca somados por descarga/etapa.
- Cancelamentos retêm capacidade para atribuição nominal do armazém. Reagendamento por natureza registra justificativa/exceção. Não recebimento sem agendamento é ocorrência avulsa.
- Boletim: 14 categorias × descarga/remoção/transferência; até 20 matrículas únicas e fração 1 ou 0,5. `P=Σquantidade×tarifa`, `E=Σfrações`, `T=max(P,E×90.1731)`, `C=T−P`. Decimais exatos; centavos somente na apresentação. Sem custo de RH/encargos/equipamentos.
- Fechamento preserva preços/cálculo; correções exigem reabertura com motivo. Rateio entre locais limita provisoriamente a uma diária por matrícula/data, sob bloqueio transacional. Não houve confirmação dessa hipótese com a Cocapec.
- Gestão separa operação, histórico documental e demonstração. Ausência de boletim não vira zero. Complemento não comprova ociosidade; cenários mantêm produção por hipótese e não garantem economia.

Feriados devem ser configurados pelo operador, sem inventar calendário oficial:

```powershell
.\backend\.venv\Scripts\python.exe backend\manage.py configure_holidays --date 2026-10-12 --description 'Feriado configurado pelo operador'
```

## Validar e demonstrar

```powershell
.\scripts\checks.ps1
```

O script executa Compose, lint, checks/migrations, testes reais PostgreSQL, lint/testes/build Angular e sincronização Capacitor. Não compila Android nem simula sucesso iOS. Veja [instruções Android/iOS](mobile/README.md), [roteiro de oito minutos](docs/roteiro_8_minutos.md) e [validação realizada](docs/validacao.md).

Seed completo: PASS em 105 testes PostgreSQL, lint, check Django e consistência de migrations. Os 938 arquivos reais foram carregados em banco descartável; reexecução e dois bootstraps concorrentes preservaram IDs, contagens, arquivos e cálculo do boletim. O banco atual não foi alterado. Veja os agregados e as pendências no [relatório de validação](docs/validacao.md).

Rodada anterior à ampliação do seed: PASS em sete testes de apresentação, lint, migrations, Compose, build Angular e sincronização Capacitor. Build, testes locais e instrumentação agregada Android passaram em AVD. O APK atual passou em login, consulta e gravação de chegada com aprovações pendentes, refletida na web. O checkpoint posterior passou após reiniciar API/PostgreSQL. A falha de conexão foi conferida com a API desligada: erro visível, sem sucesso e sem registrar entrada. O relatório distingue essa inspeção visual da asserção Maestro que falhou ao localizar o alerta na hierarquia WebView. O anexo pelo SAF foi verificado em rodada anterior. Nenhum aparelho físico foi testado. iOS segue NOT RUN até execução real em Mac/Xcode.

Instalação isolada PASS: checkout arquivado, ambiente Python novo com dependências fixadas, npm ci e PostgreSQL 17 separado; round-trip API/proxy web, cinco fixtures sintéticas com reimportação idempotente e checkpoint após reinício. Backup/restauração sintéticos preservaram 37 tabelas, contagens e fingerprints. O Windows já tinha as ferramentas instaladas; sistema operacional vazio e restauração de produção são NOT RUN. Auditoria npm somente de leitura apontou 15 avisos de desenvolvimento/build, dois críticos; avaliação completa de segurança/runtime é NOT RUN. Veja os comandos e limites no [relatório de validação](docs/validacao.md).

Artefatos de entrega: [relatório gerencial](docs/relatorio_gerencial.md), [UML de casos de uso](docs/casos_uso.md), [BPMN](docs/processo.md), [DER](docs/der.md). Fontes editáveis e imagens estão em `docs/fontes` e `docs/imagens`. [Hipóteses e limites](docs/hipoteses.md) e [origem/importação](docs/importacao.md) delimitam as conclusões.

A documentação está no [índice da entrega](docs/README.md). Originais, dados identificáveis, anexos, banco/dumps, credenciais e traces devem permanecer privados. O `.gitignore` permite apenas os caminhos exatos dos documentos finais, mantendo planos e auditorias fora da entrega. Índice e quatro artefatos foram abertos no GitHub em 03/10/2026; textos, imagens e fontes editáveis foram conferidos. Não há integração real com SAP, machine learning, chatbot ou economia medida.

## Backup e restauração da demonstração

Exemplo para um banco separado chamado `cocapec_demo_isolado`, que contém apenas fixtures sintéticas. Use um destino novo e vazio. Os comandos gravam o dump em uma pasta privada, sem passar senha na linha de comando. O banco principal e dados originais não devem ser usados neste ensaio.

```powershell
$taskBackupDir = 'C:\pasta-privada\backup-demo'
New-Item -ItemType Directory -Path $taskBackupDir -Force | Out-Null
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d cocapec_demo_isolado -Fc -f /tmp/demo-backup.dump'
if ($LASTEXITCODE -ne 0) { throw 'Falha no backup; interrompa o ensaio.' }
$taskContainerId = docker compose ps -q postgres
docker cp "${taskContainerId}:/tmp/demo-backup.dump" (Join-Path $taskBackupDir 'demo-backup.dump')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao copiar o dump privado.' }
docker compose exec -T postgres sh -c 'createdb -U "$POSTGRES_USER" cocapec_restore_demo'
if ($LASTEXITCODE -ne 0) { throw 'O destino deve ser novo; não restaure sobre banco existente.' }
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d cocapec_restore_demo --exit-on-error --no-owner --no-acl /tmp/demo-backup.dump'
if ($LASTEXITCODE -ne 0) { throw 'Falha na restauração; não considere o banco validado.' }
```

Confira migrations, contagens e registros/cálculos sintéticos no destino antes de aceitar a recuperação. Anexos ficam fora do dump: para recuperar anexos de demonstração, preserve também uma cópia privada do `MEDIA_ROOT` sintético. Dumps e anexos não fazem parte da entrega pública.
