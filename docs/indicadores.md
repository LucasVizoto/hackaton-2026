> **Documento v1 preservado.** As definições atuais de quatro marcos, presença e parcelas estão em [indicadores v2](v2/indicadores.md).

# Indicadores, denominadores e cobertura

O filtro de origem separa `operacional_registrado`, `historico_importado` e `demo_sintetico`. Um cenário é derivado com hipótese declarada; nunca é classificado como medição. Filtros de início/fim e local devem acompanhar todos os números apresentados.

| Indicador | Regra | Cobertura e cautela |
|---|---|---|
| Cargas concluídas globais | Contar agendamentos/caminhões distintos concluídos no período | Documento histórico não é caminhão |
| Cargas por local | Contar agendamentos distintos nas etapas daquele local | Um caminhão pode estar em dois locais; totais não aditivos |
| Espera | Média de `entrada − chegada` | Apenas registros com ambos os marcos válidos; informar N |
| Descarga global | Média de `saída − entrada` | Não replicar duração em cada destino |
| Descarga por local | Duração das etapas registradas | Indisponível quando faltar marco da etapa |
| Chapas por recebimento | Recursos registrados em cada descarga/etapa | Intensidade; nunca soma como pessoas presentes |
| Utilização de local/equipamento | Atendimentos e duração registrados; percentual só com janela/capacidade conhecida | Sem denominador de capacidade, apresentar contagem/minutos, não percentual |
| Fornecedores por volume | Contagem de cargas concluídas, com unidade explícita | Peso/quantidades mistas não são agregados por suposição |
| Movimento por dia/horário | Contagem de cargas com calendário/slot registrados | Histórico documental só informa frequência documental |
| Não recebimentos | Contar ocorrências por motivo | Sem duplicar cancelamentos e reagendamentos como recusas |
| Produção, total, complemento | Somar resultados de boletins fechados, após cálculo individual | Sem encargos, equipamentos ou custo de RH |
| Participação do complemento | `ΣC ÷ ΣT`, se `ΣT>0` | Complemento não comprova ociosidade |
| Pessoas distintas | Matrículas distintas no período/local | Frações e custos continuam por boletim |
| Diárias equivalentes | Soma de 1 ou 0,5 por participação válida | Não inferir meia diária do valor pago na folha |
| Cobertura de boletins | Quantidade de boletins fechados e datas com dados por local | Ausência de arquivo/boletim não equivale a zero |
| Diferença de cenário | Soma de `max(P,R×E_atual) − max(P,R×E_cenário)` por boletim | Produção constante é hipótese; não há economia garantida |

O diagnóstico financeiro identifica necessidade de investigar complemento, disponibilidade e serviço. Uma sequência com complemento elevado pede verificar produção, filas, pausas, tarefas internas, demanda de cooperados e recursos antes de reduzir equipe. Complemento zero também não comprova adequação: a produção pode ser alta enquanto há filas ou sobrecarga.

A API de qualidade de dados (`GET /api/v1/data/quality/`) está restrita aos perfis internos. Retorna conjuntos ativos, contagens, período observado e problemas agregados; não retorna códigos, nomes, chaves fiscais, hashes, caminhos ou linhas originais.

Rastreabilidade do painel: `labor-costs.source_records` identifica os boletins fechados que sustentam o total, com data/local e valores decimais exatos. `operations.source_records.records` identifica os recebimentos incluídos por data de conclusão, preservando a data agendada separada. Os envelopes `arrivals`, `bookings` e `non_receipts` identificam os registros incluídos pela data própria de cada indicador. Gestão/administrador recebem até 100 registros por conjunto, em ordem determinística, com `count`, `returned_count` e `truncated`; o limite dos links não reduz os totais agregados. Outros perfis recebem `source_records=null`. O histórico documental não ganha links inventados para caminhões ou boletins.
