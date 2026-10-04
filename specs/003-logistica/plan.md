# Implementação de Logística e Entregas

## Backend

Adicionar GET `/api/v2/analytics/logistics/`, restrito por IsInternal. Agregar Appointment e WarehouseVisit por origem operacional e calendário local. Retornar referência, período, consulta, summary, loads_by_date, loads_by_warehouse e coverage. A fila usa o estado atual, independente da janela de sete dias. Não depender de paginação nem criar modelos.

Usar GateCheckInInput com driver_name opcional. O workflow exige o nome efetivo na primeira entrada, normaliza espaços e salva no Appointment junto dos marcos e eventos. Repetições não alteram o motorista; a chave e revisão existentes continuam obrigatórias conforme seus contratos.

## Frontend e visual

Reutilizar PageHeader, MetricCard, BarChart, LoadingState, FeedbackState, DESIGN.md e ThemeService. Nova página lazy-loaded com três métricas e dois gráficos; layout compacto, uma coluna de gráficos no celular. Registro permanece no detalhe do recebimento, sem formulário de criação no painel.

Adicionar Chart.js 4.5.1 somente para a rosca, em componente separado da coleção ui.ts para manter a dependência fora do shell. A justificativa é a inexistência de rosca no produto; não adicionar wrapper Angular. Usar importação seletiva, legenda textual, tabela acessível, cores do tema, sem animações, destruição da instância ao sair da página.

Atualizar a ação de entrada com nome preenchido do cadastro e validação exclusiva dessa ação. Manter dados antigos durante atualização, avisar falha e mostrar horário da última consulta. Não usar mocks no painel operacional.

## Validação e documentação

- V-001: Testes analytics de calendário, zeros, origem, destinos, fila, entradas, lacunas e permissões.
- V-002: Testes receiving de nome, persistência, idempotência e sequência; atualização das fixtures e do roteiro verify_v2_journey.
- V-003: Testes frontend de consulta/falha/repetição, validação da entrada e guards; npm run lint, npm test, npm run build.
- V-004: Navegador em 1440, 820 e 390px, dois temas, teclado, tabelas, loading, vazio e falha recuperada; fluxo persistido em banco isolado.
- V-005: Revisão read-only com review-agent, coherence-reviewer e anti-ai-slop; check_all.py do pacote anti-ai-slop com perfil target-repo.

Atualizar docs/v2/api.md, docs/v2/indicadores.md e registrar evidências locais em validation.md. Preparar dependências e banco de QA isolado, sem importar dados privados.
