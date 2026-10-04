# Hipóteses e limitações

As hipóteses abaixo orientam as regras implementadas e podem ser revistas sem apagar o histórico. Não há esclarecimento registrado da Cocapec que as confirme.

| Tema | Decisão mínima | Limite ou pendência |
|---|---|---|
| Reserva submetida | Solicitação já ocupa capacidade global até uma decisão registrada | Não há expiração automática informada na fonte |
| Vaga cancelada | Retenção administrativa substitui a ocupação; armazém atribui a destinatário identificado | Não retorna automaticamente para disputa pública |
| Rejeição/não recebimento | Registrar encerramento e decisão explícita sobre capacidade | Não criar capacidade pública silenciosa |
| Reagendamento por natureza | Mover atomicamente, registrar motivo/exceção e manter calendário e exclusividade da batida | Limite numérico pode ser excedido; alcance da exceção de batida continua interpretação conservadora |
| Chegada | Independe de aprovações; início exige dupla validação, destinos e chegada | Horário de tolerância/atraso não foi inventado |
| Data de entrada | Início exige dia útil sem feriado e reserva na mesma data local | Coerência conservadora da grade; mudança de data exige reagendamento, sem tolerância horária inventada |
| Múltiplos locais | Etapas sequenciais; um caminhão no total global | Sem tempo de etapa, duração por local é indisponível |
| Matrícula em vários locais | Pessoas distintas deduplicadas, frações e custos preservados por boletim | Rateio diário exige frações coerentes; não deduplicar custos |
| Produção sem equipe | Não fechar boletim confiável se `P>0,E=0` | Divisão por zero nunca é executada |
| Sem atividade | `P=0,E=0` permanece rascunho/sem atividade | Não inventar pagamento ou equipe |
| Meia diária | Fração 0,5 aplicada ao piso completo de 90.1731 | Divergência textual de 45.0786 documentada |
| Peso/quantidade | Valores e proveniência preservados; sem soma de peso repetido por linha | Unidade e semântica de demanda histórica não confirmadas |
| Depósito/local | MATGeral acompanha Insumos; grupos conhecidos orientam confirmação humana | Depósitos secundários e grupos desconhecidos permanecem pendentes |
| Recursos | Responsável registra efetivo/equipamentos da etapa, incluindo zero/nenhum confirmado | Dossiê tem limites ambíguos como exatamente 500kg; decisão humana |
| Estimativas de tempo | Separadas de tempos registrados; ciclo de 5min para palete/big bag | Sem medições históricas; sem extrapolação automática para batido |
| Android | Mesma aplicação Angular/Ionic/Capacitor e mesmo backend | PASS exige APK instalado e fluxo executado; navegador móvel não substitui APK |
| iOS | Caminho documentado, execução em Mac/Xcode requerida | NOT RUN sem execução real |
| Autenticação | Token DRF em cookie de sessão do navegador, contas de demonstração separadas | Cookie sem prazo some ao fechar o navegador; o token padrão não expira sozinho e é um por usuário; não pronto para produção |

## Pagamento e alocação dos chapas (PRD de 03/10/2026)

| Tema | Decisão | Origem / pendência |
|---|---|---|
| Boletim único por dia | Um boletim por data e origem para toda a Matriz (`boletim-v3`); a produção é lançada por armazém e tipo de item; cada matrícula entra uma vez com 1 ou 0,5 diária. Substitui a linha "Matrícula em vários locais" para boletins novos | **Decisão da Cocapec**, informada pelos representantes da cooperativa no atendimento do evento em 03/10/2026 (registrar o nome de quem informou). O regulamento fala em boletim por armazém: falta confirmação por escrito e se outra unidade tem boletim próprio |
| Boletins anteriores | Boletins por armazém já registrados continuam consultáveis e editáveis no fluxo antigo; não se cria boletim do dia numa data que já tem boletim por armazém, e vice-versa | Sem migração retroativa de valores |
| Custo por armazém | Total do dia dividido pela participação de cada armazém na produção, incluindo o complemento; centavos por maiores restos. Dia sem produção fica "não atribuído" | Regra proposta até a Cocapec validar outra |
| Tarifas e piso | Tabela com data de vigência aprovada pela Gestão; rascunhos usam a tabela vigente na data; dias fechados nunca mudam (snapshot) | Valor próprio da meia diária não foi modelado: a meia diária é fração 0,5 do piso |
| Linhas "Diária Completa" e "Meia Diária" | Desativadas no boletim do dia | Até a Cocapec explicar quando são usadas |
| Ajustes | Lançamento separado por pessoa e dia, com valor, motivo e autor; cancelamento exige motivo; não altera produção, piso nem complemento | R$ 124,55 de 18/11/2025 tratado como ajuste, se confirmado |
| Folha × boletim | O boletim não aplica o fator 1,1 (R$ 99,19 = 1,1 × 90,1731) | Só comparação até a Cocapec confirmar |
| Acerto da quinzena | Soma das parcelas dos boletins fechados (1–15 e 16–fim) mais ajustes; dia útil sem boletim fechado aparece como "sem dado" | "Apurado" não é "pago": pagamento oficial continua com o RH |
| Normas de alocação | Batido 5 chapas; palete e big bag 2 chapas + 1 empilhadeira a gás; máquina 1 + operador; abaixo de 500 kg ninguém. Peso e volumes vêm da NF-e (`transp/vol`); sem dado, usa 10 paletes / 20 big bags e marca como estimado | Tempos são estimativas do responsável; a mediana dos tempos reais (mínimo de 5 descargas) substitui a retirada |
| Empilhadeiras | Inventário pelo cadastro (tipo "empilhadeira a gás" e quantidade); sem cadastro, usa o do PRD (Insumos 1 fixa, Adubo 2 móveis, Pátio 1 dedicada). Déficit sugere empilhadeira móvel de outro armazém; a do Pátio nunca sai | Qual trator atende qual máquina: só registrar o usado |
| Expediente | Fim de referência às 17h para sinalizar descarga após o expediente | Jornada de referência do chapa pendente com a Cocapec |
| Escala | Planejamento por pessoa e dia (integral ou meio período, presença/falta), até 20 pessoas; sábado é organização interna; alimenta a equipe sugerida do boletim. Quadro de referência: 8 chapas, 14–15 de outubro a março | Sinaliza falta contra o pico da agenda; sobra só se conclui pelo complemento do boletim, porque a agenda não mostra o carregamento ao cooperado |

Fora do escopo: ERP/SAP real, folha oficial de RH, carregamento ao cooperado, IAM completo, chatbot, machine learning, OCR, offline-first e infraestrutura distribuída. Extração de XML é automação com conferência humana, sem criar vínculos falsos entre códigos.
