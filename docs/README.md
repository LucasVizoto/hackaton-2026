# Documentação da entrega

Os quatro artefatos exigidos pelo regulamento, seção H, estão abaixo. Cada um contém texto e imagem; os três diagramas têm fontes editáveis. Os documentos retratam o MVP implementado, as hipóteses adotadas e os limites dos dados. Não constituem certificação de produção.

| Artefato obrigatório | Texto | Imagem e fonte editável |
|---|---|---|
| Relatório gerencial | [Relatório](relatorio_gerencial.md) | [Síntese financeira](imagens/financeiro.svg) |
| Casos de uso UML | [Casos de uso](casos_uso.md) | [SVG](imagens/casos-uso.svg), [draw.io](fontes/casos-uso.drawio) |
| Processo BPMN | [Processo](processo.md) | [SVG](imagens/recebimento-bpmn.svg), [BPMN 2.0](fontes/recebimento.bpmn), [draw.io](fontes/recebimento-bpmn.drawio) |
| DER | [Modelo de dados](der.md) | [SVG](imagens/der.svg), [draw.io](fontes/der.drawio) |

Documentos de apoio: [instalação e primeira execução](como_rodar.md), [hipóteses e limitações](hipoteses.md), [contrato da API](api.md), [indicadores e cobertura](indicadores.md), [importação privada](importacao.md), [roteiro de oito minutos](roteiro_8_minutos.md), [validação final](validacao.md).

Última rodada registrada: 81 testes PostgreSQL e sete de apresentação, lint, migrations, Compose, build Angular e sincronização passaram. A instrumentação agregada Android passou em um AVD. O APK atual passou em login, consulta e chegada refletida na web; checkpoint e reinício API/PostgreSQL preservaram o estado. A falha de conexão passou em inspeção visual/estado, com asserção Maestro do alerta FAIL por omissão na hierarquia WebView. O [relatório de validação](validacao.md) delimita os resultados. Nenhum aparelho físico testado; iOS NOT RUN.

As fontes oficiais foram consultadas localmente: `REGULAMENTO - HACKATHON 2026.pdf`, `DOSSIE - HACKATHON 2026.pdf`, `DADOS_HACKATHON_2026/LEIA-ME.md` e arquivos pertinentes. Os originais não fazem parte desta documentação distribuível. Não há esclarecimento registrado da Cocapec que confirme as hipóteses técnicas.

**Visibilidade GitHub: PASS em 03/10/2026.** Índice e quatro artefatos foram abertos no repositório público, com imagens carregadas e fontes editáveis disponíveis. Os 34 arquivos do pacote corresponderam aos hashes da revisão publicada. Originais, dados identificáveis, anexos, banco/dumps, credenciais e traces permanecem privados. Planos e auditorias não fazem parte da entrega.
