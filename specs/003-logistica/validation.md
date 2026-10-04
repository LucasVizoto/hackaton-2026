# Validação — 04/10/2026

## Ambiente

Worktree `50ad`, Python 3.14.8, Django 5.2, PostgreSQL 17 e Angular 20.3. Banco exclusivo `logistics_qa`, container `cocapec-logistics-qa-50ad`, porta local 55435. Os bancos existentes não foram alterados. `.env`, dependências, registros QA, scripts auxiliares e capturas permanecem locais e ignorados pelo Git.

O navegador usou dados de teste persistidos nesse banco isolado, identificados como QA nos nomes e observações. O código do painel consulta exclusivamente a API operacional e não contém fixtures, mocks ou substituição de falhas por dados demonstrativos.

## V-001 e V-002 — Backend e persistência

- `backend/.venv/Scripts/python.exe backend/manage.py test analytics receiving core --noinput`: 143 testes executados, resultado OK, um teste ignorado pela suíte existente.
- Ruff nos arquivos Python alterados: passou.
- `manage.py makemigrations --check --dry-run --noinput`: nenhuma alteração de modelo/migração.
- Cobertura de calendário local à meia-noite, sete datas ordenadas com zeros, origens excluídas, múltiplas notas/destinos sem duplicação global, 105 cargas sem limite de paginação, passagens repetidas do mesmo motorista, entradas antigas sem identificação e fila sem cancelamentos/recusas/descargas iniciadas.
- Recebimento: nome ausente, só espaços e 161 caracteres rejeitados sem gravação; nome existente aceito; nome informado normalizado, persistido no detalhe e evento. Reenvio idempotente não cria outra entrada/evento. A suíte existente de revisão, autorização e sequência temporal passou.
- API: Gestão, Compras, Armazém e administrador permitidos; Fornecedor e Portaria negados; consulta não aceita POST; ausência de autenticação negada.

## V-003 — Frontend

- `npm test`: 54 testes passaram, incluindo retenção da última resposta, falha inicial sem zeros inventados, recuperação, supressão de atualização concorrente, cancelamento ao sair e guards de permissão.
- `npm run lint`: passou.
- `npm run build`: passou. Chart.js 4.5.1 está no chunk lazy `logistics` (160,55 kB bruto, 49,72 kB estimados de transferência). Permanecem os avisos CommonJS anteriores de OCR/PDF.
- Estado de consulta separado em `core/logistics.ts`, fornecido pela página: permite testar o ciclo de requisição sem carregar Ionic nos testes Node e evita cache entre sessões.

## V-004 — Navegador real e jornada gravada

Browser do Codex em `http://localhost:4200`, navegação e formulários usados pela interface. Conferidos 1440×1000, 820×1000 e 390×844 nos temas claro e escuro. Gráficos em duas colunas nas telas maiores e empilhados no celular; nenhuma largura horizontal excedeu seu contêiner. Alternância de tema atualizou a rosca. Tabelas das barras e da rosca abriram/fecharam por Enter, mantendo foco visível e valores legíveis. Gestão → Logística → Gestão foi exercitado.

Carregamento inicial foi observado. A atualização consultou a API novamente. Ao interromper o backend local, a falha preservou os valores e a data da última consulta; o botão Atualizar recuperou a consulta após reiniciar o serviço. Para o vazio, os oito registros QA foram temporariamente retirados da origem operacional e depois restaurados: a resposta mostrou três zeros, sete dias zerados e nenhuma rosca. Não houve alteração do código nem interceptação da API para esses estados. A verificação final não registrou erros de execução no navegador.

Jornada em banco isolado:

1. Base do painel: 2 cargas hoje, 0 entradas identificadas hoje, 1 veículo em fila. Cobertura: uma entrada sem nome e uma conclusão sem destino; sete dias com seis cargas globais e sete associações de destino (5 e 2, participações 71,4% e 28,6%).
2. Na carga QA50A08, a confirmação sem nome exibiu erro e preservou o horário. A entrada com `Motorista QA da Portaria` foi confirmada pela API. Recarregar o detalhe e consultar o banco confirmou o nome e `04/10/2026 00:45` no horário local. O painel passou a **2 / 1 / 2**.
3. A data atual é domingo. A regra existente permite descarga somente de segunda a sexta; por isso a etapa de descarga/saída foi exercitada separadamente na carga anterior QA50A07, reservada em 24/09/2026. Sua conferência foi preparada e aprovada pelas APIs existentes com os perfis Armazém e Compras. Pela interface, Armazém registrou entrada `24/09 08:00`: a fila caiu de **2 para 1**. A saída do armazém `24/09 09:00`, com zero chapas e nenhum equipamento explicitamente confirmados, concluiu a carga.
4. Pela interface da Portaria, a saída de QA50A07 foi registrada em `04/10/2026 00:47`. Recarregar o detalhe confirmou a leitura posterior, e o banco manteve o horário, a conclusão e os eventos. O painel permaneceu **2 / 1 / 1**: saída hoje não virou entrada hoje. Marcos, nomes, revisões e respostas foram relidos em cada etapa.

Capturas locais em `output/logistics/`: `desktop-light-final.png`, `desktop-dark-final.png`, `tablet-light-final.png`, `tablet-dark.png`, `mobile-light-final.png`, `mobile-dark-final.png`, `mobile-light-charts-final.png`, `mobile-dark-charts-final.png`, `empty-state.png` e `refresh-error.png`. Leitura de banco e respostas em `tmp/logistics-persistence-proof.jsonl`. Esses arquivos não fazem parte da entrega versionada.

## V-005 — Revisões

Revisão direta, sem delegação, seguindo review-agent: contratos, autorização, idempotência, ciclo da requisição, destruição da rosca, rotas e consumidores dos componentes. Corrigido o tracking da legenda/tabela por índice, pois nomes de armazéns não são únicos no modelo. Após correção, nenhuma constatação acionável restante no escopo revisado.

Coherence-reviewer: tarefas vinculadas a FR/SC/V, dependência Chart.js justificada no plano, nenhuma camada nova de persistência ou regra de negócio adicional. Anti-ai-slop: removida flexão artificial `(s)` das mensagens de cobertura; fonte, período, denominador e ausência de destino permanecem explícitos. Nenhum elemento decorativo, ação sem implementação ou valor demonstrativo no fluxo da página.

`check_all.py --root . --profile target-repo --format markdown`: nenhuma constatação (score 100). Esse verificador avalia coerência dos documentos; não substitui os testes ou a verificação visual descritos acima.

Critérios SC-001 a SC-004 atendidos pelas evidências acima. A validação é local; não houve implantação em produção.

## V-006 — Refinamento final

Refinamento visual e de interação concluído com Impeccable 4.3.1, critique independente, confirmação no navegador e segunda passagem. Foco da entrada, erro local, recuperação de falha, hierarquia, densidade e responsividade ajustados sem mudar regras de negócio. Testes finais: frontend 55 passaram, lint/typecheck/build passaram; backend 143 executados, OK, um ignorado. Evidências, viewports, persistência QA e limites registrados em [polish.md](polish.md).
