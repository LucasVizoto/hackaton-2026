# Documentação da entrega

## Versão atual — v2

Os links abaixo descrevem o código atual: Portaria e quatro marcos, várias notas por carga, conferência por item, pessoa/dia com boletim financeiro único, atividades em vários locais e parcelas auditáveis. A documentação não publica fontes privadas nem dados nominais reais.

A conciliação com `origin/main` preserva também o aviso avulso da Portaria com foto, a caixa de chegadas do Armazém e o calendário com vistas de dia, semana e mês. O aviso fotográfico e a chegada de um recebimento são registros independentes: a foto não reserva horário, não aprova documento e não inicia os quatro marcos. O [estado de validação](validacao.md) distingue a rodada anterior dos testes da revisão conciliada.

| Artefato | Texto atual | Imagem / fonte editável |
|---|---|---|
| Relatório gerencial | [Relatório v2](v2/relatorio_gerencial.md) | [Exemplos coletivos preservados](imagens/financeiro.svg) |
| Casos de uso UML | [Casos de uso v2](v2/casos_uso.md) | [SVG](imagens/casos-uso-v2.svg), [draw.io](fontes/casos-uso-v2.drawio) |
| Processo BPMN | [Processo v2](v2/processo.md) | [SVG](imagens/recebimento-bpmn-v2.svg), [draw.io](fontes/recebimento-bpmn-v2.drawio), [BPMN 2.0](fontes/recebimento-v2.bpmn) |
| DER | [DER v2](v2/der.md) | [Recebimento](imagens/der-recebimento-v2.svg), [Pessoas](imagens/der-pessoas-v2.svg), [draw.io multipágina](fontes/der-v2.drawio) |

Apoio atual: [API](v2/api.md), [indicadores](v2/indicadores.md), [integrações e configuração](v2/integracoes.md), [roteiro de oito minutos](v2/roteiro_8_minutos.md), [plano implementado](implementacao-v2.md), [estado de validação](validacao.md). Instalação e importação permanecem documentadas em [como rodar](como_rodar.md) e [importação privada](importacao.md).

Remediação pré-banca: [correções, cenário limpo, testes e limites](remediacao_pre_banca.md). O cenário de `seed_demo --presentation` tem um percurso de consulta próprio; ele não pré-cadastra todas as exceções do roteiro ampliado.

Reconciliação da Agenda e dos alertas do Richardy: [histórico integrado, validação e sincronização dos desenvolvedores](reconciliacao_richardy.md).

Contrato e permissões: [Boletim dos ensacadores e consulta da Gestão](v2/boletim-ensacadores.md), com exemplo Python, resumo da API, precisão monetária e validação.

Planejamento futuro: [PRD da pré-folha e conciliação dos chapas](prd-folha-chapas.md), com regras, fluxo, etapas e decisões pendentes de validação com o RH.

Os diagramas novos foram escritos em XML draw.io; SVG/PNG são produzidos pelo [gerador do mesmo grafo](fontes/gerar_diagramas_v2.py). O Desktop/CLI não estava disponível. Não se afirma publicação GitHub, teste de APK v2 ou execução de integração externa sem evidência específica no relatório de validação.

## Memória da entrega anterior — v1

O conteúdo a seguir foi preservado para rastreabilidade. Descreve artefatos, resultados de testes e publicação da versão anterior; não constitui validação automática do código v2.

Os quatro artefatos exigidos pelo regulamento, seção H, estão abaixo. Cada um contém texto e imagem; os três diagramas têm fontes editáveis. Os documentos retratam o MVP implementado, as hipóteses adotadas e os limites dos dados. Não constituem certificação de produção.

| Artefato obrigatório | Texto | Imagem e fonte editável |
|---|---|---|
| Relatório gerencial | [Relatório](relatorio_gerencial.md) | [Síntese financeira](imagens/financeiro.svg) |
| Casos de uso UML | [Casos de uso](casos_uso.md) | [SVG](imagens/casos-uso.svg), [draw.io](fontes/casos-uso.drawio) |
| Processo BPMN | [Processo](processo.md) | [SVG](imagens/recebimento-bpmn.svg), [BPMN 2.0](fontes/recebimento.bpmn), [draw.io](fontes/recebimento-bpmn.drawio) |
| DER | [Modelo de dados](der.md) | [SVG](imagens/der.svg), [draw.io](fontes/der.drawio) |

Documentos de apoio: [instalação e primeira execução](como_rodar.md), [hipóteses e limitações](hipoteses.md), [contrato da API](api.md), [indicadores e cobertura](indicadores.md), [importação privada](importacao.md), [roteiro de oito minutos](roteiro_8_minutos.md), [validação final](validacao.md).

O seed completo passou em 105 testes PostgreSQL, lint e checks. Os 938 arquivos reais foram importados em banco descartável e conferidos em reexecução e bootstraps concorrentes. Na rodada anterior, sete testes de apresentação, Compose, build Angular e sincronização passaram. A instrumentação agregada Android passou em um AVD. O APK atual passou em login, consulta e chegada refletida na web; checkpoint e reinício API/PostgreSQL preservaram o estado. A falha de conexão passou em inspeção visual/estado, com asserção Maestro do alerta FAIL por omissão na hierarquia WebView. O [relatório de validação](validacao.md) delimita os resultados. Nenhum aparelho físico testado; iOS NOT RUN.

As fontes oficiais foram consultadas localmente: `REGULAMENTO - HACKATHON 2026.pdf`, `DOSSIE - HACKATHON 2026.pdf`, `DADOS_HACKATHON_2026/LEIA-ME.md` e arquivos pertinentes. Os originais não fazem parte desta documentação distribuível. Não há esclarecimento registrado da Cocapec que confirme as hipóteses técnicas.

**Visibilidade GitHub: PASS em 03/10/2026.** Índice e quatro artefatos foram abertos no repositório público, com imagens carregadas e fontes editáveis disponíveis. Os 34 arquivos do pacote corresponderam aos hashes da revisão publicada. Originais, dados identificáveis, anexos, banco/dumps, credenciais e traces permanecem privados. Planos e auditorias não fazem parte da entrega.
