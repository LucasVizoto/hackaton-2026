# Indicadores v2 — evento, unidade e cobertura

Todos os resultados precisam de período, origem e unidade. `operacional_registrado`, `historico_importado` e `demo_sintetico` são separados. Ausência de medição é nula ou explicitamente sem cobertura; não vira zero. As novas médias não incluem legados sem quatro marcos.

## Logística e Entregas

`/gestao/logistica` consulta somente operação registrada. A data de referência e os sete dias vêm do servidor, no calendário `America/Sao_Paulo`; a última consulta identifica quando o painel foi atualizado. Atualização é manual. Falha mantém os últimos resultados identificados e oferece repetição, sem inserir valores de demonstração.

- Cargas Recebidas Hoje: recebimentos concluídos por `finished_at` hoje, sem duplicar notas ou destinos.
- Pessoas que passaram na portaria: entradas por `gate_checked_in_at` hoje com nome de motorista identificado. São passagens de motoristas, não pessoas únicas; dois recebimentos do mesmo motorista contam duas entradas. Saídas não aumentam o indicador. Registros antigos sem nome são excluídos e quantificados na cobertura.
- Caminhões em Fila: entrada na unidade, nenhuma saída, situação aguardando/chegou e sem início de descarga global nem de qualquer visita. Considera todas as datas de entrada, inclusive anteriores aos sete dias.
- Barras: sete datas de conclusão ordenadas, incluindo hoje; uma consulta completa sem conclusões no dia retorna zero observado.
- Rosca: cargas concluídas nos sete dias por armazém de destino, uma associação por carga/local. Os percentuais usam o total dessas associações, que pode superar o total global de cargas. Cargas sem destino permanecem nas barras, são excluídas da rosca e aparecem na cobertura.

Entradas e saídas são as do recebimento existente; não há registro avulso de visitantes, deduplicação por nome nem novas tabelas. Novas entradas exigem nome de motorista não vazio de até 160 caracteres. O nome não é inferido de fotos ou de avisos de chegada.

| Indicador | Numerador e base temporal | Limite |
|---|---|---|
| Cargas com saída da unidade | Recebimentos distintos por `gate_checked_out_at` no período | Não confundir com número de notas ou visitas |
| Espera após Portaria | Primeira entrada em local menos chegada à Portaria, para cargas com saída no período | Apenas pares válidos; N informado |
| Permanência total | Saída menos entrada na Portaria | Descarga concluída não é saída física |
| Permanência no local | Saída menos entrada da visita, por saída da visita no período | Locais atendidos não formam uma duração global aditiva sem examinar marcos |
| Pessoas-dia previstas, presentes e utilizadas | WorkerDay distintos com atividade no estado correspondente/uso confirmado | A mesma pessoa em dois dias conta duas vezes; vários locais no mesmo dia não duplicam o indicador global. Estado previsto é ainda previsto; atividades distintas podem estar em estados diferentes |
| Pessoas-dia presentes por local | Local da atividade física | Não atribui automaticamente custo àquele local |
| Produção, piso, complemento e total | Somatório de boletins fechados do responsável financeiro | Fórmula aplicada por boletim antes da soma; sem encargos, custo de máquina ou folha RH |
| Parcela individual | Fração proporcional e centavos gravados no fechamento | Não reconstruir valores nominais de legados |
| Reconciliação | Soma dos totais individuais gravados contra soma dos totais exibidos por boletim | Diferença nula quando houver legado sem parcelas; não afirmar cobertura completa |
| Saldo confirmado de pedido | Quantidade pedida menos aceita em linhas aprovadas | Depende de pedido local confirmado e unidades iguais, sem inferência a partir de NF |
| Cenário de equipe | Diferença entre os totais calculados com E atual e E proposto | Produção constante é hipótese; mínimo/recursos são restrições informadas, não medições de atendimento |

`analytics/labor-costs/` acrescenta `individuals.records` por pessoa com `cost_warehouses` e `activity_warehouses`, `presence` e `reconciliation`. O filtro de local financeiro seleciona o armazém responsável; a presença usa o local da atividade. A lista nominal é limitada a 100 linhas com `count`, `returned_count` e `truncated`, sem reduzir os totais. A reconciliação compara parcelas efetivamente salvas; `legacy_bulletins_without_allocations` informa a cobertura faltante.

## Comparativo de custos e gargalos em Gestão

`GET /api/v2/analytics/labor-costs/` também retorna:

- `daily_series`: uma linha por dia do recorte, em ordem cronológica, com `date`, `production`, `total_payable`, `supplement` e `bulletin_count`. Valores monetários são strings decimais exatas; dia sem boletim fechado tem valores nulos e contagem zero. Resumo, série e fontes usam o mesmo conjunto completo de snapshots, sem o limite de 100 registros da consulta de evidências.
- `weekly_supplement`: `period`, `groups`, `closed_bulletins` e `leaders`. A janela começa no maior entre `date_from` e `date_to − 6 dias`; cada grupo informa armazém, complemento exato, número de boletins e datas cobertas. `leaders` contém todos os IDs empatados no maior complemento positivo. Lista vazia de líderes, com boletins fechados, significa complemento zero; sem boletins significa ausência de cobertura.

`GET /api/v2/analytics/operations/` retorna `gate_wait_by_warehouse`, com armazém, `average_minutes`, `valid_records` e `excluded_records`. A população usa a saída da portaria no período. A espera exige chegada à portaria ≤ entrada no primeiro destino pela sequência ≤ saída da unidade. Um destino posterior não herda a espera global. Registros sem marcos válidos são excluídos, não substituídos por outra visita ou por zero; a cobertura também informa exclusões e registros sem destino. Para histórico documental, o campo é nulo; lista vazia operacional significa ausência de observações atribuíveis ao recorte.

O painel compara **valor produzido** com **total a pagar**, não pagamento efetivado. A faixa representa o complemento e interrompe nos dias sem boletim. O destaque de espera mostra os empates e a cobertura por armazém; o destaque financeiro mostra a janela de até sete dias. Alterar o filtro mantém origem e local separados. As consultas preservam as permissões existentes, e a análise da IA continua restrita a Gestão/admin.

O extrato da pessoa distingue `operational` de `historical_rh`. Folha histórica é visível apenas a Gestão/admin, considera lotes ativos e totaliza observações utilizáveis. Datas inválidas/ausentes ficam na qualidade, fora do intervalo datado; pagamento ausente é nulo. Um pagamento observado não identifica automaticamente produção, fração ou boletim.

Complemento elevado indica que o piso coletivo ultrapassou a produção lançada. Isso não comprova ociosidade: trabalho interno, carregamento a cooperados, indisponibilidade de máquina, simultaneidade e cobertura incompleta precisam ser avaliados. Complemento zero tampouco prova equipe suficiente.

O cenário retorna `infeasible` se as restrições fornecidas são violadas e `unverified` nos demais casos. Não declara viabilidade comprovada: demanda medida e sobreposição de atividades continuam sem validação automática. O filtro/origem e as hipóteses acompanham cada comparação.
