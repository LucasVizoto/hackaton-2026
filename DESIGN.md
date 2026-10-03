---
name: Recebimento Cocapec
description: Interface operacional compartilhada entre web e Android.
colors:
  green: "#134E39"
  brand-hover: "#0D3527"
  brand-contrast: "#FFFFFF"
  brand-soft: "#EAF4EF"
  blue: "#005596"
  info-soft: "#EAF3FB"
  paper: "#F8FAFC"
  surface: "#FFFFFF"
  surface-subtle: "#F1F5F9"
  surface-hover: "#EDF3F6"
  text: "#0F172A"
  muted: "#526176"
  line: "#E2E8F0"
  control-line: "#7B8BA0"
  success: "#166534"
  success-soft: "#EAF6EE"
  warning: "#92400E"
  warning-soft: "#FFF7E6"
  danger: "#B91C1C"
  danger-soft: "#FEF0EE"
  dark-green: "#91DFB9"
  dark-brand-hover: "#B0EDCE"
  dark-brand-contrast: "#0B3020"
  dark-brand-soft: "#243E36"
  dark-blue: "#90CDF9"
  dark-info-soft: "#243B52"
  dark-paper: "#0F172A"
  dark-surface: "#1E293B"
  dark-surface-subtle: "#253348"
  dark-surface-hover: "#304158"
  dark-text: "#F1F5F9"
  dark-muted: "#B7C5D6"
  dark-line: "#3B4B61"
  dark-success: "#9DE8B5"
  dark-success-soft: "#233E32"
  dark-warning: "#FCD588"
  dark-warning-soft: "#433722"
  dark-danger: "#FFB4AD"
  dark-danger-soft: "#492C32"
typography:
  headline:
    fontFamily: "Plus Jakarta Sans, Inter, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Plus Jakarta Sans, Inter, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  title-small:
    fontFamily: "Plus Jakarta Sans, Inter, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  body-small:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.5
  table-label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.5
  metric-label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.45
  metric-value:
    fontFamily: "Plus Jakarta Sans, Inter, system-ui, sans-serif"
    fontSize: "27px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.025em"
rounded:
  card: "16px"
  control: "12px"
  full: "999px"
spacing:
  compact: "12px"
  standard: "16px"
  field-gap: "20px"
  section: "24px"
  page-tablet: "28px"
  page-desktop: "32px"
components:
  button-primary:
    backgroundColor: "{colors.green}"
    textColor: "{colors.brand-contrast}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 18px"
  button-primary-hover:
    backgroundColor: "{colors.brand-hover}"
    textColor: "{colors.brand-contrast}"
  button-outline:
    textColor: "{colors.green}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 18px"
  button-clear:
    textColor: "{colors.green}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 18px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  nav-active:
    backgroundColor: "{colors.green}"
    textColor: "{colors.brand-contrast}"
    rounded: "{rounded.control}"
    padding: "12px"
  status-pending:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning}"
    rounded: "{rounded.full}"
    padding: "5px 10px"
  metric-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    padding: "22px"
  metric-card-brand:
    backgroundColor: "{colors.green}"
    textColor: "{colors.brand-contrast}"
    rounded: "{rounded.card}"
    padding: "22px"
  origin-synthetic:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning}"
    rounded: "{rounded.control}"
    padding: "16px 18px"
---

# Design System: Recebimento Cocapec

## Overview

Interface de operação para agenda, conferência, armazém, boletins e gestão. O redesign aprovado usa como referência visual o Coffee Logistics Dashboard do Google Stitch, projeto `8449242214206285579`. A direção foi aplicada a partir do código, preservando tarefas, permissões, conteúdo de domínio e contratos da API. A referência não acrescenta funcionalidades ao produto.

O sistema organiza a leitura com cabeçalhos compactos, superfícies claras, cartões de indicadores, tabelas e estados escritos. Verde identifica ação e seleção; azul ajuda a localizar dados e informação. A marca em uso é o texto “Cocapec / Recebimento” acompanhado de uma folha em contorno do Ionicons; não é um logotipo oficial fornecido pela cooperativa. Não há imagens raster na interface entregue.

**Características:** hierarquia de tarefa, dados com origem e cobertura, componentes compartilhados, temas completos e navegação adaptada ao perfil. Este arquivo substitui as regras visuais anteriores. Os valores do frontmatter foram extraídos de [styles.scss](frontend/src/styles.scss); esse arquivo continua sendo a fonte de implementação e de compatibilidade com Ionic.

Evidência do redesign em 03/10/2026: revisão independente com disposição `ship`, conferência web em 1440, 820 e 390px e reflow em 320px nos dois temas; Android em AVD API 36 e viewport de tablet de 800dp. Foram inspecionados teclado nativo, menu Mais, persistência do tema, erro de conexão/repetição e alcance da ação de salvar, sem gravações de negócio durante essa QA visual. Lint, 17 testes de apresentação, 81 testes PostgreSQL, build Angular, sincronização Capacitor, `assembleDebug` e `testDebugUnitTest` passaram. O build inicial registrado é 632,79 kB, abaixo dos limites configurados de 2 MB para aviso e 3 MB para erro. O teste Java local é uma asserção padrão; aparelho físico e TalkBack não foram validados. Evidências detalhadas ficam no arquivo local `.impeccable/review/validation.md`, que não é publicado no repositório.

## Colors

Os nomes do frontmatter correspondem aos papéis reais das variáveis CSS. As entradas `dark-*` registram a substituição do mesmo papel sob `[data-theme="dark"]`, não uma segunda paleta disponível para misturar na tela.

### Primary

- **Verde Cocapec** (`green`, `brand-hover`, `brand-contrast`): ações principais, módulo ativo e destaque de indicador. `brand-soft` apoia avatar, horário selecionado e hover de controles de ícone.

### Secondary

- **Azul de informação** (`blue`, `info-soft`): links, placas, informação e valores de apoio. O foco usa a variável `--focus`, com o mesmo valor do azul em cada tema.
- **Estados escritos** (`success`, `warning`, `danger` e seus fundos `*-soft`): confirmação, pendência, dado sintético e falha. O texto identifica o significado; a cor reforça a leitura.

### Neutral

- **Papel e superfícies** (`paper`, `surface`, `surface-subtle`, `surface-hover`): fundo da aplicação, blocos de trabalho, cabeçalhos de tabela e interação sobre linhas.
- **Texto e apoio** (`text`, `muted`): conteúdo principal e contexto secundário.
- **Divisória e controle** (`line`, `control-line`): borda suave de estrutura e borda visível de campo/ação. `control-line` permanece igual nos dois temas; o contraste registrado é 3,48:1 sobre branco e 4,21:1 sobre a superfície escura. Não usar a divisória estrutural para delimitar um campo.

O tema inicial segue `prefers-color-scheme` quando não há preferência válida. A escolha manual persiste em `cocapec.visual-theme`; depois dela, mudanças do sistema não sobrescrevem a escolha. `index.html` aplica o tema antes da montagem para evitar clarão. Se o armazenamento falhar, a troca continua funcionando na sessão. Essa persistência visual não altera o token de autenticação, que continua somente em memória.

## Typography

**Títulos:** Plus Jakarta Sans, com Inter e fontes do sistema como fallback. **Corpo e dados:** Inter, com fallback do sistema. As faixas locais são 600–700 nos títulos e 400–700 no corpo; quatro WOFF2, licenças OFL e proveniência estão em [public/fonts](frontend/public/fonts/SOURCES.txt). `font-display: swap` mantém o conteúdo disponível durante a carga.

A hierarquia normativa está no frontmatter. Títulos de página usam `headline`; no celular passam a 24px. Títulos de seção usam `title` e subtítulos usam `title-small`. Corpo usa `body`; tabelas, subtítulos de página e controles usam a escala menor. Texto de apoio usa 12–13px conforme o componente. Parágrafos têm largura máxima de 75ch.

Valores de indicadores usam `metric-value`, reduzido a 23px no celular; o total financeiro destacado usa 32px. Tabelas, metadados e valores usam numerais tabulares. A apresentação decimal é `pt-BR`; o helper `decimal` formata somente leitura e mostra “Não disponível” para entrada ausente ou inválida. Ele não transforma valores de formulário nem refaz cálculos financeiros.

## Layout

O shell usa uma coluna lateral de 260px e conteúdo flexível a partir de 1024px. A página fica limitada a 1600px e usa espaçamento externo `page-desktop`. O cabeçalho superior permanece visível com rolagem do conteúdo principal. De 768 a 1023px, a lateral cede lugar ao botão de módulos e o conteúdo usa `page-tablet`.

Até 767px, a navegação inferior é uma cápsula com até três módulos autorizados e “Mais” quando restam módulos. Armazém/administrador priorizam Agenda, Chegadas e Boletins (a antiga rota Operação redireciona para a Agenda); Compras prioriza Agenda, Compras e Gestão; os demais perfis recebem os itens autorizados de Agenda, Gestão e Origem. O menu mostra todos os módulos permitidos. Links mantêm `aria-current`; a mudança de rota fecha o menu, volta a rolagem ao início e move o foco para o conteúdo principal.

No celular, a página usa 16px nas laterais, 24px no topo e `112px + safe-area-inset-bottom` no fim, dando passagem à última ação acima da navegação fixa. O cabeçalho e o login respeitam a safe area superior. Formulários passam de duas colunas para uma; ações podem quebrar linha. Filtros têm labels flexíveis e passam a largura inteira até 420px. Textos longos em identidade, feedback e metadados quebram sem expandir a página.

Indicadores usam quatro colunas, duas abaixo de 1200px e uma abaixo de 360px. Gráficos usam três colunas, duas abaixo de 1200px e uma no celular. Tabelas preservam colunas e rolam dentro da região identificada e focável; a página não depende de rolagem horizontal para campos ou navegação. Células têm 16px de padding, reduzido a 12px no celular. Painéis usam 24px de padding, reduzido a 20px vertical e 16px horizontal no celular.

## Elevation & Depth

Superfícies e bordas separam o trabalho. Painéis, tabelas e indicadores não recebem sombra por padrão. A sombra suave de cartão fica no login (`--shadow-card`); menus e navegação inferior usam `--shadow-overlay`. As duas sombras têm versões próprias para claro e escuro, registradas no sidecar e implementadas em `styles.scss`.

Transições de cor duram 160ms com `ease-out` em ações e navegação. Não há animação de dados. `prefers-reduced-motion` reduz animações e transições e desativa rolagem animada.

## Shapes

Cartões, painéis, tabelas e menus usam `card`; campos, botões e feedback usam `control`. Status, avatar, disponibilidade e navegação inferior usam `full`. Tabelas internas de painel têm raio de 10px. Bordas têm 1px; controles usam a borda de controle, superfícies usam a divisória estrutural.

Ações comuns e campos têm altura mínima de 44px; navegação lateral tem 48px e cada destino inferior tem 54px. O checkbox de 20px fica dentro de label com área de interação mínima de 44px. O foco visível usa contorno de 3px e afastamento de 3px; no botão Ionic, o contorno fica dentro da superfície nativa.

## Components

Os componentes reutilizáveis estão em [shared/ui.ts](frontend/src/app/shared/ui.ts). Os estilos globais e os tokens Ionic são resolvidos no mesmo sistema; não criar uma paleta isolada dentro de uma feature.

- **BrandMark e ThemeToggle:** identidade textual com folha em contorno e controle de tema com nome acessível da próxima ação. Ícones de estado do tema e visibilidade da senha usam ramos estáticos `@if`, mantendo o registro Ionicons visível em web e Android.
- **PageHeader:** título e subtítulo da tarefa, com área projetada para ações. No celular, as ações ocupam a linha seguinte. **FilterBlock** é um componente de atributo: preserva o formulário, labels, submit e valores existentes.
- **Botões e campos:** Ionic nas ações principais, outline e clear nas ações de apoio; fonte de controle sem caixa alta, raio `control` e padding horizontal de 18px. Campos nativos têm label persistente, padding de 10px × 12px, hover verde e foco azul. Desabilitado usa opacidade de 0,6. A senha oferece mostrar/ocultar com `aria-pressed`.
- **MetricCard:** label, valor e explicação; tons `default`, `brand`, `info` e `warning`. O tom marca hierarquia, não acrescenta significado ao cálculo. Gestão apresenta quatro indicadores operacionais e quatro financeiros, todos sustentados pela API.
- **LoadingState, EmptyState e FeedbackState:** carregamento anunciado com `role="status"` e skeleton oculto da leitura assistiva; vazio descreve a situação; erro usa `role="alert"`, confirmação usa `role="status"`. Confirmar sucesso somente após resposta real da API e preservar possibilidade de repetição após falha.
- **Status e Origin:** cápsula com ponto decorativo e label de estado; origem sintética e histórica aparecem em avisos explícitos. Compras, Armazém e Operação são estados independentes, exibidos lado a lado na tabela e no detalhe. A linha do tempo mostra eventos registrados, responsável e data; não desenha uma aprovação sequencial inexistente.
- **Tabelas e BarChart:** identidade principal/apoio em cada célula, números alinhados e região de rolagem local. Os três gráficos gerenciais são barras HTML/CSS com rótulo e valor, acompanhadas de tabela em `details`. Contagens usam calendário/local/motivo reais; duração ausente não vira zero. Explicações preservam a diferença entre total global e por destino, recursos por descarga e efetivo diário.
- **Boletins e origem dos dados:** apuração destaca o total e mantém produção, pessoas, diárias e complemento acessíveis; frações e cálculos oficiais continuam no backend. Avisos, cobertura, pendências e links de registros da API continuam disponíveis em Gestão e Origem dos dados.

## Do's and Don'ts

### Do:

- **Do** reutilizar tokens de `styles.scss` e componentes compartilhados; conferir a mudança nos dois temas.
- **Do** preservar labels, nomes acessíveis, foco visível, alvos de 44px e rolagem local das tabelas.
- **Do** manter origem, período, unidade, cobertura e avisos junto dos resultados que explicam.
- **Do** distinguir ausência, zero observado, dado sintético, histórico e cenário; manter cálculos e valores de formulário intactos.

### Don't:

- **Don't** misturar papéis de temas ou usar `line` como borda de campo.
- **Don't** acrescentar métricas, economia, urgência, percentuais sem denominador ou dados de demonstração sem rótulo.
- **Don't** transformar aprovações independentes em sequência obrigatória ou confirmar gravação antes da API.
- **Don't** substituir a marca textual por um logotipo oficial inventado nem inserir imagens sem fonte e proveniência.
