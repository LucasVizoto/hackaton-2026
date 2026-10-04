# Indicadores v2 — evento, unidade e cobertura

Todos os resultados precisam de período, origem e unidade. `operacional_registrado`, `historico_importado` e `demo_sintetico` são separados. Ausência de medição é nula ou explicitamente sem cobertura; não vira zero. As novas médias não incluem legados sem quatro marcos.

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

O extrato da pessoa distingue `operational` de `historical_rh`. Folha histórica é visível apenas a Gestão/admin, considera lotes ativos e totaliza observações utilizáveis. Datas inválidas/ausentes ficam na qualidade, fora do intervalo datado; pagamento ausente é nulo. Um pagamento observado não identifica automaticamente produção, fração ou boletim.

Complemento elevado indica que o piso coletivo ultrapassou a produção lançada. Isso não comprova ociosidade: trabalho interno, carregamento a cooperados, indisponibilidade de máquina, simultaneidade e cobertura incompleta precisam ser avaliados. Complemento zero tampouco prova equipe suficiente.

O cenário retorna `infeasible` se as restrições fornecidas são violadas e `unverified` nos demais casos. Não declara viabilidade comprovada: demanda medida e sobreposição de atividades continuam sem validação automática. O filtro/origem e as hipóteses acompanham cada comparação.
