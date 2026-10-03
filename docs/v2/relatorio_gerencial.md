# Relatório gerencial — apuração coletiva e individual

A versão v2 permite identificar o responsável pelo custo diário de cada pessoa e registrar os vários locais atendidos sem duplicar sua remuneração. Ela também separa os quatro marcos do recebimento, várias notas da mesma carga e quantidades declaradas, aceitas e recusadas. Esses registros ampliam a capacidade de análise futura; não produzem uma série histórica de fatos que não foram medidos.

![Exemplos coletivos de referência, sem alterar valores anteriores](../imagens/financeiro.svg)

## Regra preservada e divisão individual

Por boletim, `P = Σ quantidade × tarifa`, `E = Σ frações`, `F = E × 90.1731`, `T = max(P,F)` e `C = T − P`. A fração é 1 ou 0,5. Uma pessoa/data/origem pertence financeiramente a um único boletim, mesmo que execute atividades em diversos locais. O local do boletim representa responsabilidade pelo custo; atividade representa onde o trabalho ocorreu.

Para cada pessoa `i`, a parcela exata é `T × fração_i / E`, equivalente a `fração_i × max(P/E,90.1731)`. Produção e complemento são atribuídos na mesma proporção. O cálculo armazena decimal e fração racional; centavos usam maiores restos, com desempate estável pelo ID da pessoa. A soma dos pagamentos apresentados corresponde ao total apresentado do boletim. `rounding_adjustment` explicita o centavo necessário quando produção e complemento arredondados separadamente não somam o total.

| Exemplo identificado | Pessoas | E | P exato | T exato | C exato |
|---|---:|---:|---:|---:|---:|
| Referência coletiva com 11 diárias | 11 | 11 | 918.1952 | 991.9041 | 73.7089 |
| Variação de referência com uma meia participação | 11 | 10,5 | 918.1952 | 946.81755 | 28.62235 |

Esses valores reproduzem os exemplos documentados; não descrevem remuneração real de pessoas identificadas. O sistema não realiza transferência bancária ou pagamento de folha.

## Diária de serviço e presença são campos diferentes

Diária completa de serviço tem tarifa `90.1731`; meia diária de serviço tem tarifa própria `45.0786`. Esses serviços entram em P e são distintos da participação da pessoa. Metade do piso de presença é `90.1731 × 0,5 = 45.08655`; substituir esse cálculo pela tarifa de serviço alteraria indevidamente a fórmula coletiva. As duas grandezas permanecem explícitas.

Fração excepcional, saída antecipada, horas extras e diária especial ainda não têm regra executável aprovada nesta implementação. São ocorrências estruturadas e impedem apenas o fechamento afetado. Não se apresenta uma parcela definitiva nem se aplica um percentual por analogia. Uma ocorrência comprovadamente não aplicável pode ser resolvida por Gestão/admin com justificativa, sem criar uma nova fórmula.

## Leitura por período e origem

O relatório financeiro usa fechados e parcelas ativas. Reabertura conserva snapshots e parcelas anteriores; transferência de responsabilidade reabre boletins fechados envolvidos e mantém as atividades físicas. Legados mantêm seus números e não recebem rateio retroativo. Sem parcelas, o resultado individual é indisponível, ainda que exista um custo coletivo legado.

Folha histórica é outra fonte: valores observados, localização textual, data, qualidade e procedência. Somente lotes ativos e observações utilizáveis entram no total correspondente. Não se deduz fração pelo valor pago nem se mistura folha com custo de boletim. Lacunas de arquivos/datas continuam explícitas.

Os quatro marcos permitem medir espera depois da Portaria, permanência por local e permanência total. Contar notas não equivale a contar caminhões; somar participações em visitas não equivale a contar pessoas distintas. Pedido confirmado, NF e conferência também têm saldos diferentes. As definições estão em [indicadores](indicadores.md).

## O que pode orientar uma decisão

Complemento, duração, espera e recusas ajudam a selecionar dias para investigar. Uma decisão de equipe precisa considerar tarefas internas, carregamentos a cooperados, máquinas, simultaneidade e atendimento. O cenário monetário conserva produção como hipótese; restrições de equipe/máquina informadas podem refutar uma proposta, mas não comprovar atendimento futuro. Não há promessa de economia nem recomendação automática de redução.

As entrevistas e planilhas sustentam regras e hipóteses de projeto; estimativas declaradas de tempo/demanda não foram convertidas em medições. Dados sintéticos demonstram fluxo e matemática, sem ampliar a cobertura histórica da cooperativa.

## Estado verificável da entrega

Em 03/10/2026, os 29 testes do módulo de mão de obra — incluindo referências v1, parcelas v2, transferência, ocorrência, permissões e concorrência PostgreSQL — passaram em banco isolado. A rodada integrada registrou jornada HTTP real com várias notas, dois locais, Portaria, atividades individuais e um único boletim. O registro completo e as limitações pertencem a [validacao.md](../validacao.md), atualizado separadamente; resultados de APK/AVD da versão anterior não validam automaticamente o fluxo v2.

Assistente, OCR, clima e envio externo possuem código/configuração, mas estão desabilitados sem configuração apropriada. Não há verificação de provedor ao vivo afirmada aqui. Prontidão manual e manifestação de aceite não constituem controle automático de capacidade ou assinatura certificada.

Esta documentação não contém nomes de trabalhadores, valores nominais reais, documentos fiscais, credenciais, arquivos originais ou capturas da folha.
