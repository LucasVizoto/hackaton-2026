# Como rodar o projeto depois do clone

Este guia prepara a demonstração local no **Windows com PowerShell 7**. O PostgreSQL roda no Docker; a API Django e o frontend Angular/Ionic rodam diretamente no PC, em dois terminais. Os scripts atuais usam caminhos e executáveis do Windows.

## 1. O que precisa estar instalado

| Ferramenta | Versão / requisito | Para que serve |
|---|---|---|
| [Git](https://git-scm.com/install/windows) | Já instalado se você fez o clone pelo terminal | Clonar e atualizar o repositório |
| [PowerShell](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows) | **7** | Executar os scripts de preparação |
| [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) | Com Docker Compose v2 e contêineres Linux | Rodar o PostgreSQL 17 |
| [Node.js](https://nodejs.org/en/download) | **24.x**, com npm | Instalar e executar o frontend |
| [uv](https://docs.astral.sh/uv/getting-started/installation/) | Disponível no PATH | Preparar o ambiente Python e instalar as dependências fixadas |
| [Python](https://docs.astral.sh/uv/guides/install-python/) | **3.14.x**; pode ser instalado pelo uv | Executar a API Django |
| Navegador | Edge, Chrome ou Firefox | Acessar a aplicação web |

O PostgreSQL é baixado pelo Compose. As bibliotecas Python, Angular, Ionic e Capacitor são instaladas pelo setup; não é necessário instalar essas ferramentas globalmente. VS Code é opcional.

### Instalar PowerShell e uv

Se o Windows tiver `winget`, execute em um terminal:

```powershell
winget install --id Microsoft.PowerShell --exact --source winget
winget install --id astral-sh.uv --exact
```

Os comandos são documentados pela [Microsoft](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows) e pelo [uv](https://docs.astral.sh/uv/getting-started/installation/#winget). Se não tiver `winget`, use os instaladores nos links da tabela.

Instale o **Node 24.x** pelo site oficial, mantendo npm e a inclusão no PATH. Feche e abra o terminal após instalar as ferramentas. Abra **PowerShell 7** pelo menu Iniciar ou pelo comando `pwsh`; o Windows PowerShell 5.1 que vem no Windows não atende este guia.

No PowerShell 7, instale o Python usado pelo projeto:

```powershell
uv python install 3.14
```

### Preparar o Docker Desktop

Instale e abra o Docker Desktop. Use contêineres Linux e aguarde o mecanismo do Docker iniciar. Para usar o backend WSL 2, habilite a virtualização na BIOS/UEFI e prepare o WSL conforme as [instruções oficiais do Docker](https://docs.docker.com/desktop/setup/install/windows-install/). Se o WSL ainda não estiver instalado, execute em um terminal como administrador:

```powershell
wsl --install
```

Reinicie o PC se solicitado. Se o WSL já estiver instalado e precisar de atualização, use `wsl --update`. O projeto será executado no PowerShell do Windows; não é necessário abrir uma distribuição Linux para rodar os scripts.

## 2. Conferir as ferramentas e entrar na pasta

No PowerShell 7:

```powershell
$PSVersionTable.PSVersion
git --version
node --version
npm.cmd --version
uv --version
uv python find 3.14
docker compose version
docker info
```

Confira PowerShell 7, Node `v24.x` e um caminho de Python 3.14. `docker info` deve conectar ao Docker sem erro.

Entre na pasta onde você clonou o repositório. Nos exemplos abaixo, substitua `C:\Projects\hackaton-2026` pelo caminho do seu clone:

```powershell
Set-Location 'C:\Projects\hackaton-2026'
```

Esta pasta deve conter `compose.yaml`, `.env.example` e a pasta `scripts`. Tenha internet disponível na primeira instalação para baixar os pacotes e a imagem do PostgreSQL.

## 3. Preparar o projeto pela primeira vez

Na raiz do clone:

```powershell
.\scripts\setup.ps1 -PrivateDataPath 'C:\pasta-privada\DADOS_HACKATHON_2026' -SeedDemo
```

O script executa, nesta ordem:

1. Cria `.env` com segredos aleatórios, se esse arquivo ainda não existir.
2. Cria o ambiente Python em `backend/.venv` e instala `backend/requirements.lock`.
3. Sobe o PostgreSQL 17 pelo Docker e espera o banco ficar disponível.
4. Valida o pacote privado completo, aplica migrations e seed histórico, e verifica a configuração do Django.
5. Cria as contas e os dados sintéticos de demonstração por causa de `-SeedDemo`.
6. Instala as dependências do frontend com `npm ci`.

**Espere o script terminar sem erro antes de iniciar os servidores.** Ele prepara o projeto, mas não inicia a API nem o frontend.

No clone novo, deixe o setup gerar o `.env`; copiar `.env.example` antes disso deixa os segredos vazios. Se você já criou `.env` manualmente, preencha `DJANGO_SECRET_KEY`, `DB_PASSWORD` e `DEMO_PASSWORD` antes de executar. `DEMO_PASSWORD` precisa ter pelo menos 12 caracteres. O setup preserva um `.env` existente.

O setup exige o pacote privado completo: passe `-PrivateDataPath` ou preencha `PRIVATE_DATA_DIR`. O `.env`, os arquivos e os anexos ficam privados e não devem ser enviados ao Git. O seed histórico cria uma conta técnica inativa; os logins abaixo são acrescentados somente com `-SeedDemo`.

Para uma demonstração exclusivamente sintética, prepare as dependências e o PostgreSQL, execute `manage.py migrate --noinput` e `manage.py seed_demo` diretamente. Esse caminho não usa `setup.ps1`, que agora monta o banco com o baseline completo.

## 4. Iniciar a API e o frontend

Mantenha o Docker Desktop aberto e use **dois terminais PowerShell 7**.

**Terminal 1 — API:**

```powershell
Set-Location 'C:\Projects\hackaton-2026'
.\backend\.venv\Scripts\python.exe backend\manage.py runserver 127.0.0.1:8000
```

**Terminal 2 — frontend:**

```powershell
Set-Location 'C:\Projects\hackaton-2026\frontend'
npm.cmd start
```

Deixe os dois terminais em execução e abra [http://localhost:4200](http://localhost:4200).

| Serviço | Endereço / porta |
|---|---|
| Aplicação web | `http://localhost:4200` |
| API | `http://127.0.0.1:8000/api/v1/` |
| Verificação da API e do banco | `http://127.0.0.1:8000/api/v1/health/` |
| PostgreSQL | `127.0.0.1:55433` |

O frontend encaminha `/api` para a API na porta 8000 pelo proxy configurado no repositório. A raiz da API pode retornar 404; use a rota `health/` para verificar o funcionamento.

## 5. Entrar e conferir o funcionamento

Abra o `.env` local em um editor e copie o valor depois de `DEMO_PASSWORD=`. Essa é a senha das contas criadas na primeira execução:

| Usuário | Perfil |
|---|---|
| `fornecedor_demo` | Fornecedor A |
| `fornecedor_b_demo` | Fornecedor B |
| `compras_demo` | Compras |
| `armazem_demo` | Armazém |
| `gestao_demo` | Gestão |
| `portaria_demo` | Portaria |

Para conferir os indicadores sintéticos, entre com `gestao_demo`, selecione a origem **Demonstração sintética** e um período que inclua **01/10/2026 a 02/10/2026**. Há também boletins de referência em 17 e 18/11/2025. O painel começa com a origem de operação registrada, que pode estar sem dados em um banco novo.

Em um terceiro terminal, confira a conexão da API com o banco:

```powershell
Invoke-RestMethod 'http://127.0.0.1:8000/api/v1/health/'
Invoke-RestMethod 'http://localhost:4200/api/v1/health/'
```

Ambas devem retornar `status: ok` e `database: postgresql`; a segunda também verifica o proxy do frontend. Recarregar a página mantém o login: o token fica em um cookie de sessão do navegador e some ao fechar o navegador. Os registros continuam no PostgreSQL.

## 6. Parar e voltar a rodar

Para parar, pressione `Ctrl+C` nos terminais da API e do frontend. Se quiser parar também o banco, execute na raiz:

```powershell
docker compose stop
```

Na próxima vez, abra o Docker Desktop, suba o banco e repita os dois comandos de inicialização da seção 4:

```powershell
Set-Location 'C:\Projects\hackaton-2026'
docker compose up -d --wait
```

Não é necessário reinstalar tudo a cada execução. O banco fica no volume Docker `cocapec_pg`; parar os serviços preserva os dados. `docker compose down -v` apaga o volume e os dados, portanto não use esse comando para encerrar a aplicação.

Se precisar completar uma instalação interrompida, execute o setup novamente. O seed preserva registros e senhas existentes: alterar `DEMO_PASSWORD` no `.env` depois da criação das contas não troca a senha dessas contas.

## 7. Problemas comuns

| Problema | Como resolver |
|---|---|
| `uv`, `node`, `npm` ou `docker` não reconhecido | Confira a instalação e o PATH; feche e abra o terminal após instalar. |
| Script bloqueado pela política de execução | No PowerShell 7, execute `Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned` e tente novamente. A alteração vale apenas para esse terminal; políticas da organização podem impedir a mudança. |
| Erro em `RandomNumberGenerator` durante o setup | Confira `$PSVersionTable.PSVersion`; execute com PowerShell 7. |
| Docker não conecta ou não inicia o banco | Abra o Docker Desktop, aguarde iniciar e confira `docker info`. Verifique WSL/virtualização se o aplicativo indicar esse problema. |
| Porta `55433` ocupada | Pare o serviço em conflito ou ajuste `DB_PORT` no `.env` e recrie o contêiner com `docker compose up -d --wait`. Django e Compose leem a mesma variável. |
| Porta `8000` ou `4200` ocupada | Encerre outra instância que esteja usando essa porta e repita o comando. Mudar a porta da API também exige ajustar `frontend/proxy.conf.json`. |
| `DJANGO_SECRET_KEY` ausente / `DEMO_PASSWORD` inválida | Confira os campos do `.env`. Um arquivo criado manualmente não é preenchido pelo setup. |
| Falha de autenticação do PostgreSQL após mudar `DB_PASSWORD` | Um volume já inicializado mantém a senha antiga. Restaure a senha usada na criação do banco ou altere-a no PostgreSQL; mudar só o `.env` não atualiza o banco. |
| A tela abre, mas o login dá erro de conexão | Confira se a API está rodando e se as duas consultas `health/` da seção 5 respondem. |
| Login informa credenciais inválidas | Confira a conta e a senha criadas no primeiro seed. Se pulou `-SeedDemo`, execute `.\backend\.venv\Scripts\python.exe backend\manage.py seed_demo` na raiz após preparar o banco. |
| Gestão não mostra os exemplos | Selecione a origem Demonstração sintética e o período dos dados da seção 5. |

## 8. Etapas opcionais

**Verificação completa:** depois do setup, execute `.\scripts\checks.ps1` na raiz. O script verifica Django/migrations, executa testes no PostgreSQL, lint/testes/build do frontend e sincroniza Capacitor Android. Ele não compila o APK.

**Dados históricos privados:** o setup instala o baseline completo da pasta `DADOS_HACKATHON_2026`. As [instruções de importação](importacao.md) detalham o dry-run, o relatório, a reexecução e o comando de montagem para produção. O seed de demonstração continua opcional.

**Android:** além das ferramentas acima, instale JDK 21 e o Android SDK com plataforma 36, build-tools 36.0.0 e platform-tools. Você pode preparar o SDK e um emulador pelo Android Studio. O projeto inclui o Gradle Wrapper, sem necessidade de instalar Gradle globalmente. Siga [o guia Android](../mobile/README.md) para compilar, instalar e encaminhar a porta da API com `adb reverse`. Essas ferramentas são opcionais para usar a aplicação no navegador.

**iOS:** exige um Mac com Xcode; o fluxo está no [guia mobile](../mobile/README.md) e não foi validado neste projeto.

Este guia foi conferido contra os scripts e as configurações do repositório. A validação anterior de instalação isolada está no [relatório de validação](validacao.md); uma instalação em Windows completamente vazio não foi executada.
