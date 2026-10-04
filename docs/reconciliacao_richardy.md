# Reconciliação da Agenda e dos alertas — 04/10/2026

## Origens e escopo

| Referência | SHA registrado antes da integração |
|---|---|
| main | aaba26f4e8e79d7a58b4ef2c61a65d0cf3255ba0 |
| richardy/feature-agenda-ux | 81ac9e8b805f784ea0a8a6a812d09484e8b13f2d |
| richardy/feature-alerta-chegada | 902b1bbbb2e58fed5d9de53c25d75d33c372349a |

A integração foi construída em checkout isolado na branch `codex/reconcile-richardy-agenda-alerta`. Primeiro foi feito o merge da Agenda (`0666aa6`), depois o merge dos alertas (`81ef643`), ambos com os commits originais como ancestrais. Os conflitos de `notifications.ts` e `angular.json` foram resolvidos por conteúdo e comportamento.

O calendário mantém os cartões, cores, selos Demo, ocupação compacta, menu, filtros e apresentação móvel do Richardy. Os avisos combinam esse visual com o total de registros, paginação da main, identificação dos não lidos da página atual, manutenção da página após reconhecimento e erros visíveis. O analytics continua com o identificador da main.

Foram revisados também os merges automáticos. Assinaturas de conferência, paginação de não recebimentos, várias notas por carga, permissões, disponibilidade global, CSV e o contrato de impressão permanecem preservados. Backend, endpoints, migrations, dependências e documentos fiscais existentes não foram alterados nesta reconciliação.

As branches originais permanecem preservadas. O trabalho local de chapas/escala e armazém no PC do Richardy fica no escopo da auditoria posterior acordada; esses arquivos não foram substituídos por esta integração.

## Correções dos alertas

- Consulta todas as páginas de pendências com o cliente existente; a primeira página do backend contém apenas 50 registros.
- Reproduz os eventos recebidos durante a consulta, deduplica registros e mantém decisões finais. Outra consulta completa é enfileirada quando uma chegada, decisão ou reconexão ocorre durante a leitura, pois mudanças podem deslocar os registros entre páginas.
- Mantém o escalonamento aos 15/30 minutos, reaparecimento após dispensa, som, vibração, notificação em segundo plano e contador de pendências no título.
- Mantém o último resultado completo quando uma página falha, mostra o erro e permite tentar novamente.
- Cancela consultas, limpa temporizadores, áudio, notificações e estado no logout/troca de sessão/desmontagem.
- Mantém cartões operacionais para Armazém/Administrador e os acessos/contadores próprios de Compras, Portaria e Gestão.
- Acrescenta dispensa conjunta e limita a altura da pilha no celular. Isso libera os controles que ficavam cobertos quando há muitas chegadas. Dispensar preserva as pendências e o contador; os cartões voltam ao subir de nível.

## Evidências de validação

| Verificação | Resultado |
|---|---|
| Frontend ESLint | PASS |
| Testes existentes e novos de funções puras | PASS — 51 testes |
| TypeScript da aplicação e do executor de navegador | PASS |
| Build de produção Angular e preparação dos artefatos | PASS |
| Ruff backend, Django check, migrations dry-run e consistência do banco | PASS |
| Django: core, receiving, labor, analytics, imports e integrations | PASS — 229 testes; Redis entre processos habilitado |
| Componentes reais Angular/Ionic no navegador | PASS — cenários descritos abaixo |
| Agenda desktop e viewport móvel de 390 × 844 | PASS — visual, Dia/Semana/Mês, filtros e ausência de transbordamento horizontal |
| Perfis Fornecedor, Compras, Armazém, Portaria e Gestão | PASS — inspeção de telas/acessos; permissões também cobertas por testes backend |
| API real com 105 pendências | PASS — três cartões, mais 102, título com 105 e busca completa em três páginas |
| Aceite e recusa pela tela do Armazém | PASS — contador de pendências passou de 105 para 103 |
| Avisos: paginação e reconhecimento | PASS — 107 registros, página 2 mantida, não lidos da página passaram de 7 para 6 |
| Não recebimentos | PASS — página 2 de lista com 105 ocorrências |
| Assinaturas | PASS — componente de consulta carregado no detalhe; testes backend cobrem os registros assinados |
| Vagas e ocupação global | PASS — filtro visual não alterou a ocupação; horários e agendamento com várias notas disponíveis |
| CSV | PASS — ação executada no navegador; proteção/formatação cobertas pelos testes existentes |
| Falha da API e recuperação | PASS — erros visíveis e ocupação “Não disponível”; recuperação após reiniciar o servidor isolado |
| Impressão | Geração PASS — abriu PDF do dia; inspeção visual da aba limitada pela política de URL blob do navegador |

Os testes de backend usaram PostgreSQL descartável e Redis separado. A inspeção da aplicação usou outro banco com fixtures sintéticas. O primeiro ensaio da suíte falhou em cinco testes porque a configuração isolada excluía a origem localhost exigida pelos testes WebSocket; após corrigir apenas esse ambiente, os 229 testes passaram.

O executor de navegador importa os componentes reais, fornece respostas sintéticas e controla o relógio. Valida 105 registros em três páginas, deslocamento entre páginas durante decisões, eventos duplicados, nova chegada simultânea, decisões finais, reconexão, erro na segunda página, tentativa posterior, dispensa individual/conjunta, escalonamento aos 15/30 minutos, logout durante consulta e destruição. Confere Administrador/Gestão, falha/recusa/concessão de permissão de notificação, áudio/vibração indisponíveis e fechamento de áudio/notificações. O componente Ionic de avisos também mantém a página após reconhecimento.

Para repetir esse executor, a partir de `frontend`, com as dependências do projeto já instaladas:

```powershell
npx.cmd tsc -p tests/tsconfig.browser.json
npx.cmd --no-install esbuild tests/browser-reconciliation.ts --bundle --format=esm --target=es2022 --outfile=.angular/reconciliation/app.js --tsconfig=tsconfig.json
Copy-Item -LiteralPath tests/browser-reconciliation.html -Destination .angular/reconciliation/index.html
# Use o Python disponível no seu ambiente e abra http://127.0.0.1:4318.
python -m http.server 4318 --bind 127.0.0.1 --directory .angular/reconciliation
```

Clique em **Executar cenários** e confira a linha **TODOS OS CENÁRIOS APROVADOS**. O executor funciona com dados sintéticos e não se conecta ao backend.

Limites: viewport móvel não equivale a aparelho físico. Os efeitos de áudio, vibração e notificação com permissão concedida foram verificados com substitutos controlados; a entrega pelo sistema operacional depende do navegador/dispositivo e não foi homologada aqui. O fluxo completo de salvar uma nova carga com anexos foi coberto pelo backend; no navegador foram conferidos o formulário, horários e inclusão de várias notas. O build mantém os avisos CommonJS já existentes de OCR/PDF. Esta rodada não comprova deploy em produção.

## Sincronização de Richardy e Lucas

Antes de trocar de branch, cada desenvolvedor deve preservar alterações pendentes, arquivos novos e commits locais em uma branch própria. A captura Git enviada anteriormente não substitui essa conferência no PC.

Depois, cada um executa:

```powershell
git fetch origin
git switch main
git pull --ff-only origin main
git rev-parse HEAD origin/main
git status --short --branch
```

Se o pull recusar por divergência, preserve a main local em outra branch e reconcilie os commits antes de continuar. Não use reset destrutivo nem force push. As branches originais podem permanecer disponíveis para consulta.

Reinicie os servidores de desenvolvimento e confira a Agenda. Richardy e Lucas devem enviar os dois SHAs impressos por `rev-parse`; a sincronização de todos só está confirmada quando ambos correspondem à main remota integrada.

Para conferir a preservação dos dois trabalhos:

```powershell
git merge-base --is-ancestor 81ac9e8 origin/main
git merge-base --is-ancestor 902b1bb origin/main
```

Ambos os comandos devem terminar com código zero. Produção segue o fluxo existente de deploy.
