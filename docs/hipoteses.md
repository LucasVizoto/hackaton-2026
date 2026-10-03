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
| Autenticação | Token DRF apenas em memória, contas de demonstração separadas | Token padrão não expira automaticamente e é um por usuário; não pronto para produção |

Fora do escopo: ERP/SAP real, folha oficial de RH, carregamento ao cooperado, IAM completo, chatbot, machine learning, OCR, offline-first e infraestrutura distribuída. Extração de XML é automação com conferência humana, sem criar vínculos falsos entre códigos.
