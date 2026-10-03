---
name: angular-dashboard-design
description: Use esta skill sempre que for criar ou reestruturar telas Angular no estilo de dashboards de produto (fintech, cripto, SaaS, painéis administrativos). Orienta boas práticas de Angular moderno (standalone components, signals, OnPush) combinadas a um padrão visual limpo e moderno inspirado em dashboards de exchange/carteira digital, com sidebar que vira menu em pílula no mobile e suporte obrigatório a tema claro e escuro.
license: Complete terms in LICENSE.txt
---

# Angular Dashboard Design

Esta skill combina duas frentes que devem sempre andar juntas: **engenharia Angular moderna** e **um padrão visual específico** (dashboard limpo, tipo fintech/exchange). Nenhuma tela gerada com esta skill deve ignorar uma das duas frentes.

Antes de escrever qualquer código, monte mentalmente (ou em texto curto) um plano com: estrutura de componentes, tokens de cor/tipografia que serão usados, e como o layout se comporta em mobile. Só depois disso comece a implementação.

## Referência visual

O padrão-alvo é o de um dashboard financeiro moderno: sidebar fixa à esquerda com navegação por ícone + label, um card de saldo em destaque com gráfico de linha suave, cards secundários com cantos arredondados grandes, uma lista de "top tokens" com sparklines, um indicador circular tipo gauge, uma lista de atividades recentes, e um bloco de IA/assistente com input de chat. A sensação geral é: espaçosa, silenciosa, com poucos acentos de cor usados com intenção (verde para ganho, vermelho para perda, azul/roxo como cor de marca), nunca cheia de sombras pesadas ou gradientes decorativos.

Trate essa referência como ponto de partida estético, não como template a clonar pixel a pixel — adapte a paleta e os componentes ao domínio real do produto que está sendo construído (ex: um dashboard de saúde não deveria usar linguagem visual de "greed index" cripto, mas deve manter a mesma sobriedade, hierarquia e sistema de espaçamento).

## Princípios de design

- **Espaço antes de decoração.** Prefira respiro (padding generoso, `gap` consistente) a bordas, sombras ou divisores extras. Sombras devem ser muito sutis (`0 1px 2px rgba(0,0,0,.04)` a `0 4px 12px rgba(0,0,0,.06)`), nunca o cinza genérico `rgba(0,0,0,.1)` aplicado em tudo igualmente.
- **Um raio de borda por família de elemento**, não um raio único aplicado indiscriminadamente: cards grandes podem ter `16–24px`, elementos internos (badges, botões pequenos, avatars) `8–12px`, pills de navegação e badges de status usam `999px` (totalmente arredondado). Documente esses valores como tokens (veja tokens abaixo) e reutilize.
- **Hierarquia por tamanho e peso, não por cor.** O número de destaque (ex: saldo) deve ser o maior elemento tipográfico da tela; labels de apoio ficam pequenos e em tom neutro (cinza médio), nunca em caixa alta com letter-spacing como "eyebrow" decorativo.
- **Cor com significado, não decoração.** Reserve verde/vermelho para variação positiva/negativa de valores. Reserve a cor de marca (o acento azul/roxo do produto) para ações primárias (botões principais, item de navegação ativo, links). Não aplique gradientes decorativos sem função.
- **Gráficos discretos.** Sparklines e curvas devem ser finas (`stroke-width` 1.5–2), sem grid pesado, sem eixo Y visível quando o contexto já deixa claro a escala. Tooltips flutuantes com sombra leve e cantos arredondados, como no card de saldo.
- **Ícones consistentes.** Use uma única biblioteca de ícones (ex: lucide, heroicons) em peso `outline` ou `stroke`, nunca misturando estilos de ícone diferentes na mesma tela.
- Siga o restante dos princípios gerais de tipografia, restrição e autocrítica descritos na skill `frontend-design`, quando disponível: escolha tipografia deliberada (não a fonte-padrão óbvia), evite os "tells" de design genérico (eyebrows em caps, setas `→` decorativas, sombra cinza padrão em tudo), e revise o resultado antes de considerar pronto.

## Paleta de cores: fonte da verdade é o site da Cocapec

Todo projeto construído com esta skill deve usar a **paleta de cores oficial implementada em [cocapec.com.br](https://www.cocapec.com.br/)** como fonte da verdade — não a paleta neutra de exemplo da seção de tokens abaixo, que serve apenas como estrutura/nomenclatura de referência.

Como esta paleta não é fixa e pode evoluir junto com o site institucional, o agente **não deve copiar hexadecimais de memória nem inventar valores aproximados**. Antes de estilizar qualquer tela, o agente deve extrair a paleta real a partir de uma fonte confiável, nesta ordem de preferência:

1. **Inspecionar o site ao vivo**, se houver uma ferramenta de navegador/computer use disponível no ambiente (abrir `https://www.cocapec.com.br/`, checar os estilos computados do header, botões, links e rodapé, e anotar os hex exatos usados).
2. **Pedir ao usuário** o manual de marca, um export de design tokens (Figma, etc.) ou prints com os códigos de cor, caso a inspeção ao vivo não seja possível no ambiente de execução.
3. Só na ausência total das opções acima, usar uma aproximação visual documentada como "provisória" e marcar claramente no código (`// TODO: confirmar hex oficial Cocapec`) para substituição posterior — nunca apresentar uma aproximação como se fosse a cor oficial confirmada.

Depois de confirmada, a paleta extraída deve ser mapeada para os papéis funcionais definidos na seção de tokens (fundo de app, fundo de card, texto primário/secundário, cor de marca/ação primária, semânticas de positivo/negativo) preservando a lógica de contraste e acessibilidade (AA) e a adaptação para tema escuro — o site institucional normalmente só define tema claro, então cabe ao agente derivar uma variante escura coerente com a mesma identidade (mesmo matiz, ajustando luminosidade/saturação), e não apenas inverter preto por branco.

## Sistema de tokens (obrigatório)

Toda tela gerada por esta skill deve declarar tokens de design como CSS custom properties no nível global (ex: `:root` e um seletor de tema escuro), nunca cores "hardcoded" espalhadas nos componentes. Isso é o que permite alternar tema claro/escuro sem reescrever estilos.

Estrutura mínima de tokens a definir (nomes podem ser adaptados ao design system do projeto, mas a cobertura deve ser esta). **Os valores de cor abaixo são placeholders de estrutura, não a paleta oficial da Cocapec** — substitua-os pelos hex extraídos conforme a seção anterior antes de considerar os tokens prontos:

```css
:root {
  /* Superfícies */
  --surface-app: #F3F4F6;      /* fundo geral da aplicação */
  --surface-card: #FFFFFF;     /* fundo de cards */
  --surface-sidebar: #FFFFFF;  /* fundo da navegação lateral */
  --surface-overlay: #FFFFFF;  /* tooltips, dropdowns, modais */

  /* Texto */
  --text-primary: #111827;
  --text-secondary: #6B7280;
  --text-tertiary: #9CA3AF;

  /* Bordas */
  --border-subtle: #EEF0F3;
  --border-default: #E5E7EB;

  /* Marca / ação primária */
  --brand: #005BA0;
  --brand-secondary: #49A630
  --brand-terciary: #F5C304
  --brand-contrast: #FFFFFF;

  /* Semânticas */
  --positive: #16A34A;
  --positive-bg: #ECFDF3;
  --negative: #DC2626;
  --negative-bg: #FEF2F2;

  /* Raios */
  --radius-lg: 20px;   /* cards grandes */
  --radius-md: 12px;   /* elementos internos, botões */
  --radius-full: 999px; /* pills, badges, avatars */

  /* Sombra */
  --shadow-card: 0 1px 2px rgba(16, 24, 40, 0.04), 0 4px 12px rgba(16, 24, 40, 0.04);
}

[data-theme='dark'] {
  --surface-app: #0B0D12;
  --surface-card: #14171F;
  --surface-sidebar: #14171F;
  --surface-overlay: #1B1F2A;

  --text-primary: #F3F4F6;
  --text-secondary: #9CA3AF;
  --text-tertiary: #6B7280;

  --border-subtle: #1F2430;
  --border-default: #262B38;

  --brand: #3B82F6;
  --brand-contrast: #0B0D12;

  --positive: #34D399;
  --positive-bg: rgba(52, 211, 153, 0.12);
  --negative: #F87171;
  --negative-bg: rgba(248, 113, 113, 0.12);

  --shadow-card: 0 1px 2px rgba(0, 0, 0, 0.3), 0 4px 16px rgba(0, 0, 0, 0.35);
}
```

Regras sobre esses tokens:
- Ajuste os valores de cor (hex) ao domínio/marca real do produto — a paleta acima é um ponto de partida neutro, não um valor fixo a copiar sempre.
- Nunca escreva uma cor literal (`#fff`, `red`, `rgb(...)`) dentro de um componente Angular; sempre referencie `var(--token)`.
- Todo componente novo deve funcionar corretamente lendo esses tokens — isso é o que garante tema claro/escuro automático.

## Tema claro/escuro (requisito obrigatório)

Toda tela entregue por esta skill **deve** funcionar nos dois temas. Padrão de implementação:

1. O tema é controlado por um atributo no elemento raiz: `<html data-theme="light">` ou `data-theme="dark"`.
2. Um serviço Angular (`ThemeService`) expõe um `signal<'light' | 'dark'>`, inicializado a partir de `prefers-color-scheme` do usuário (via `window.matchMedia('(prefers-color-scheme: dark)')`) e depois persistido (ex: `localStorage`) quando o usuário alterna manualmente.
3. Um `effect()` no serviço escreve o atributo `data-theme` no `document.documentElement` sempre que o signal mudar.
4. Todo componente de UI (cards, gráficos, ícones com `currentColor`) deve ser testado visualmente nos dois temas antes de considerar a tela pronta — isso inclui checar contraste de texto secundário e bordas sutis, que costumam "sumir" no escuro se não forem ajustadas com um token próprio (não basta inverter preto/branco).
5. Nunca use apenas `prefers-color-scheme` no CSS como única fonte de verdade se o produto também precisa de alternância manual — combine media query (estado inicial) com o atributo controlado por Angular (estado explícito do usuário).

Exemplo do toggle no template:

```html
<button
  type="button"
  class="theme-toggle"
  (click)="theme.toggle()"
  [attr.aria-label]="theme.mode() === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'">
  @if (theme.mode() === 'dark') {
    <lucide-icon name="sun" />
  } @else {
    <lucide-icon name="moon" />
  }
</button>
```

## Layout responsivo: sidebar → menu em pílula

Este é um requisito estrutural, não decorativo, e deve ser seguido em toda tela com navegação principal:

- **Desktop (`≥ 1024px`)**: navegação lateral fixa, largura ~240–280px, com logo no topo, itens de navegação empilhados verticalmente (ícone + label), e um bloco de destaque/upsell no rodapé, se aplicável.
- **Tablet (`768–1023px`)**: a sidebar pode colapsar para apenas ícones (sem labels) ou virar um drawer que abre por um botão de menu — escolha conforme densidade da tela, mas mantenha a navegação acessível sem exigir scroll horizontal.
- **Mobile (`< 768px`)**: a navegação lateral **desaparece** e é substituída por uma **pílula de navegação flutuante**, fixa na parte inferior da tela (`position: fixed; bottom: 16px`), centralizada horizontalmente, com fundo em `--surface-overlay`, `border-radius: var(--radius-full)`, sombra leve (`--shadow-card`) e os itens de navegação principais representados só por ícone (com label visível apenas no item ativo, ou via tooltip/long-press). Deixe uma área de respiro (`safe-area-inset-bottom`) para não colidir com a barra de gestos do sistema.

Estrutura de referência para a pílula mobile:

```html
<nav class="pill-nav" role="navigation" aria-label="Navegação principal">
  @for (item of navItems(); track item.route) {
    <a
      [routerLink]="item.route"
      routerLinkActive="is-active"
      class="pill-nav__item"
      [attr.aria-label]="item.label">
      <lucide-icon [name]="item.icon" />
    </a>
  }
</nav>
```

```css
.pill-nav {
  display: none;
}

@media (max-width: 767px) {
  .sidebar { display: none; }

  .pill-nav {
    display: flex;
    align-items: center;
    gap: 4px;
    position: fixed;
    left: 50%;
    bottom: calc(16px + env(safe-area-inset-bottom, 0px));
    transform: translateX(-50%);
    padding: 8px;
    background: var(--surface-overlay);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    box-shadow: var(--shadow-card);
    z-index: 50;
  }

  .pill-nav__item {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: var(--radius-full);
    color: var(--text-secondary);
  }

  .pill-nav__item.is-active {
    background: var(--brand);
    color: var(--brand-contrast);
  }

  /* conteúdo principal ganha padding inferior para não ficar sob a pílula */
  .main-content {
    padding-bottom: 96px;
  }
}
```

Além da navegação, todo o restante do layout deve ser responsivo por padrão:
- Grids de cards usam `grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))` ou breakpoints explícitos, nunca larguras fixas em `px` para containers de conteúdo.
- Tabelas/listas densas (ex: "Recent activities") viram cards empilhados ou permitem `overflow-x: auto` em telas estreitas, nunca quebram o layout da página.
- Textos grandes (ex: saldo em destaque) reduzem de tamanho via `clamp()` em vez de tamanho fixo, para não estourar em telas pequenas.

## Boas práticas de Angular a seguir

Estas regras se aplicam a qualquer componente gerado por esta skill, além do que já é padrão de bom senso em Angular:

**Arquitetura e componentes**
- Use **standalone components** (não módulos `NgModule`, a menos que o projeto já use módulos de forma consolidada).
- Prefira `ChangeDetectionStrategy.OnPush` em todos os componentes.
- Use **signals** (`signal`, `computed`, `effect`) para estado local de componente e de serviços simples, em vez de `BehaviorSubject` só para guardar valor de UI. Reserve RxJS para fluxos assíncronos reais (requisições HTTP, streams de eventos, websockets).
- Use a sintaxe de controle de fluxo moderna do template: `@if`, `@for` (sempre com `track`), `@switch`, em vez de `*ngIf`/`*ngFor`.
- Componentes de apresentação (cards, gráficos, badges) devem ser "dumb": recebem dados via `input()` e emitem eventos via `output()`, sem chamar serviços diretamente. Componentes de página/feature orquestram dados e passam para os componentes de apresentação.
- Organize por feature, não por tipo técnico: prefira `features/dashboard/{components,services}` a uma pasta genérica `components/` compartilhada por todo o app quando o componente não é realmente reutilizável entre features.

**Estilo e qualidade de código**
- TypeScript em modo `strict`; evite `any` — tipar interfaces explícitas para os dados de domínio (ex: `interface TokenBalance { symbol: string; changePercent: number; ... }`).
- Nomeie seletores de componente com prefixo consistente do projeto (ex: `app-balance-card`, `app-pill-nav`).
- CSS por componente (`ViewEncapsulation` padrão do Angular), lendo sempre os tokens globais de `:root`/`[data-theme]` — nunca duplicar valores de cor localmente.
- Acessibilidade não é opcional: todo ícone-somente-clicável tem `aria-label`; foco de teclado visível (`:focus-visible`) com um outline que use `--brand`; contraste de texto secundário testado nos dois temas.
- Respeite `prefers-reduced-motion` em qualquer transição/animação (ex: entrada de cards, hover states).

**Dados e estado**
- Isolar chamadas de API em serviços (`*.service.ts`) injetáveis via `inject()`, retornando `Observable` ou convertendo para `signal` via `toSignal()` quando o consumo é só de leitura no template.
- Loading e erro são estados explícitos do componente (ex: `status = signal<'loading' | 'success' | 'error'>('loading')`), nunca inferidos apenas pela ausência de dados — isso evita telas "piscando" vazio antes do carregamento real.

## Processo de entrega

1. Extraia (ou solicite ao usuário) a paleta oficial de `cocapec.com.br` conforme a seção "Paleta de cores" antes de qualquer outra coisa — não prossiga com cores provisórias sem sinalizar isso explicitamente.
2. Confirme (ou assuma e declare) o domínio real do produto antes de aplicar a paleta — adapte nomenclatura de componentes ao contexto (ex: "Top tokens" só faz sentido em produto financeiro/cripto).
3. Defina os tokens de tema claro/escuro (usando a paleta extraída no passo 1) antes de estilizar qualquer componente.
4. Construa a navegação responsiva (sidebar → pílula) como parte do shell do layout, não como um ajuste posterior.
5. Construa os componentes de conteúdo (cards, gráficos, listas) consumindo os tokens.
6. Revise a tela nos dois temas e em pelo menos três larguras (mobile, tablet, desktop) antes de considerar a entrega concluída.
