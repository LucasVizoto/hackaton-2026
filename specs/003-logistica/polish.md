# Refinamento final — Logística e Entregas

## Escopo e direção

04/10/2026, worktree 50ad. Implementação funcional existente como fonte de verdade. Preservados DESIGN.md, componentes compartilhados, fontes, verde/azul, temas, navegação, cálculos, permissões, APIs e persistência. Nenhuma dependência acrescentada nesta etapa. Sem commit ou push.

Impeccable 4.3.1: contexto e instruções lidos; modo Operate. Critique e audit independentes por duas avaliações autorizadas. Aplicados layout, typeset, distill, clarify, adapt, harden e polish. Onboarding foi revisado pelos estados vazios contextuais; movimento e performance avaliados, sem justificar novos efeitos ou otimizações não medidas. Chart.js permanece lazy, sem animação de dados e com cleanup. Não se aplicou redesign, branding, conteúdo demonstrativo no frontend ou extração de abstrações.

## Evidência inicial e correções

Avaliação inicial 28/40 nas dez heurísticas; detector executado uma vez em logistics, management, receiving e donut-chart: JSON integral vazio. A avaliação visual A foi concluída antes da entrega dos findings de B. O detector não substituiu a inspeção renderizada.

- **P1 — Abertura:** o nome estava em y=1700 num viewport de 900px, enquanto o foco permanecia no acionador. A entrada agora conduz ao formulário e foca o nome após renderizar. Fechar devolve foco ao botão.
- **P1 — Validação:** no celular, erro em y=-2109 enquanto o campo estava em y=277. Agora há mensagem local, aria-invalid e aria-describedby, com foco no campo inválido. Trim e limite de 160 caracteres preservados.
- **Hierarquia e densidade:** agrupamento H2 antes das métricas H3, valores alinhados em tablet, métricas compactas no celular, cobertura e espaços locais menores. Os gráficos começam em y=543 no laptop, contra y=682 antes. Informações de contagem, período, origem, cobertura e denominador permanecem visíveis.
- **Componentes e texto:** PageHeader, MetricCard, BarChart, estados e tokens reutilizados. Ajustes de internals restritos a `.logistics-page`. Legenda da rosca quebra nomes longos; gráfico mais compacto. A ação usa “Registrar entrada” e sucesso após resposta real.
- **Interação:** atualização mantém dados e consulta anterior, com feedback no botão e comunicação de status. Falhas de serviço orientam repetição sem exibir corpo técnico. Erros da entrada aparecem no formulário e recebem foco.

## Confirmação e segunda passagem

Logística, acesso na Gestão e detalhe/entrada inspecionados em **1440×900, 1280×720, 768×1024 e 390×844**, nos temas claro e escuro. Reflow adicional em **320×844** no painel. Nenhum overflow horizontal global observado; tabelas conservam regiões de rolagem próprias.

Navegação Gestão → Logística → Gestão, atualização, alternância de tema, hover do gráfico, abertura e fechamento das duas tabelas por Enter, regiões focáveis por Tab, foco visível, menu mobile/ESC e aplicação de período na Gestão exercitados. Labels, textos, valores, contraste, alvos de 44px e densidade comparados com o sistema existente. Contrastes medidos na inspeção inicial: mínimo textual 5,76:1 no claro e 7,27:1 no escuro; tokens preservados.

A confirmação encontrou e corrigiu um erro de referência de foco em elementos que hospedam o componente FeedbackState: viewChild passou a ler ElementRef explicitamente. A repetição real do erro de API e do sucesso confirmou foco nos respectivos elementos, sem erro de execução na tab final. A segunda avaliação independente também corrigiu a ajuda de horário para “Horário local”, correspondente à conversão existente por fuso do dispositivo. Nenhuma conversão de data foi alterada.

### Estados e persistência

- Carregamento inicial observado; atualização anterior mantida; consulta concluída e cobertura incompleta legíveis.
- Backend local interrompido: atualização preservou **2 / 1 / 1** e o horário anterior. Ao entrar novamente na rota com serviço indisponível, nenhum indicador zero foi inventado. Atualizar recuperou a consulta após reiniciar o serviço.
- Vazio: oito fixtures QA operacionais foram temporariamente retiradas da origem operacional e restauradas em finally. API retornou três zeros, sete datas zeradas e nenhum destino. Sem interceptação ou alteração do código. Restaurada a resposta **2 / 1 / 1**.
- Portaria teve acesso à rota de Gestão recusado pelo guard, retornando à Portaria. Gestão continuou somente leitura; suítes de permissão passaram.
- Validação do motorista vazio/só espaços não gravou entrada e preservou horário. Nome cadastrado veio preenchido. Fechar e reabrir funcionaram com foco correto.
- Falha real na entrada manteve nome e horário; o alerta recebeu foco e ficou visível. Após reiniciar o serviço, repetir a mesma ação retornou sucesso. A fixture sintética **QA50P02**, banco exclusivo `logistics_qa`, persistiu `Motorista QA foco validado`, entrada **04/10/2026 01:16** local (`2026-10-04T04:16:00+00:00`) e revisão 2. Recarregar o detalhe e reler o banco confirmaram os valores. Origem `demo_sintetico`, explicitamente identificada, excluída dos indicadores operacionais. Nenhuma fixture foi incorporada ao produto.

## Checks finais

Executados após a última correção de código:

| Comando | Resultado |
|---|---|
| `npm test` | 55 testes passaram |
| `npm run lint` | Passou |
| `npx tsc --noEmit -p tsconfig.app.json` | Passou |
| `npm run build` | Passou; avisos CommonJS preexistentes de OCR/PDF |
| `manage.py test analytics receiving core --noinput` | 143 executados, OK, um ignorado pela suíte existente |
| `git diff --check` | Sem erro de whitespace |

Teste novo cobre mensagem de recuperação sem corpo de erro do servidor e preservação da explicação de autorização. Testes existentes de retenção, cancelamento, concorrência, datas, deduplicação, fila, autorização, revisão e idempotência permaneceram passando.

## Evidências e limites

Capturas antes/depois e detector em `output/logistics-polish/`, locais e ignorados pelo Git. Destacam-se `after-laptop-light.jpg`, `after-tablet-light.jpg`, `after-mobile-light.jpg`, `after-entry-mobile-light-error.jpg`, `after-entry-mobile-light-api-error.jpg`, `after-entry-mobile-light-success.jpg`, `after-refresh-mobile-light-error.jpg`, `after-initial-error-laptop-light.jpg`, `after-empty-laptop-light.jpg` e `after-320-light.jpg`.

Validação no navegador local com viewports, sem hardware móvel ou leitor de tela real. Tentativa de zoom por atalho não alterou DPR nem dimensões no navegador integrado; 200% real não foi comprovado. Reflow de 320px foi comprovado. Não houve profiling de performance nem certificação WCAG. Nenhum bloqueador visual ou funcional restante identificado no escopo e condições testados; ajustes adicionais seriam predominantemente preferências visuais.
