> **Documento v1 preservado.** O [roteiro v2](v2/roteiro_8_minutos.md) inclui Portaria, várias notas, pessoas e boletim único. Os resultados anteriores de APK/GitHub abaixo não validam automaticamente a nova versão.

# Roteiro da demonstração — oito minutos

Preparar previamente PostgreSQL, backend, aplicação Angular e seed sintético. Abrir perfis necessários em sessões distintas, com credenciais locais fora dos slides. Usar documento artificial. Não transmitir nomes/CNPJ/chaves dos originais nem abrir a folha de RH. Confirmar o período/origem na gestão antes do pitch.

| Tempo | Ação ao vivo | O que comprova |
|---|---|---|
| 00:00–00:40 | Apresentar os três módulos e dizer que a demonstração é sintética | Problema de organização e resposta econômica, com limites claros |
| 00:40–02:00 | Fornecedor anexa nota artificial e agenda; mostrar batida exclusiva e capacidade global | Documento privado, calendário e reserva no servidor |
| 02:00–03:10 | Registrar chegada antes das aprovações; Compras decide e armazém confirma dois destinos; executar entrada/etapas/saída com recursos | Aprovação independente da chegada, eventos e múltiplos locais persistentes |
| 03:10–03:45 | Abrir cancelamento com retenção/atribuição, reagendamento por natureza e recusa avulsa sem vaga nos casos preparados | Exceções obrigatórias com motivo e histórico |
| 03:45–05:00 | Abrir os dois boletins sintéticos de referência, 17 e 18/11/2025; mostrar 11 versus 10,5 diárias e os valores oficiais; lançar/salvar/fechar outro boletim com data disponível | Regra do piso, três modalidades, matrícula e meia diária reproduzíveis pelo seed |
| 05:00–06:25 | Gestão: filtrar origem/período, mostrar quatro locais e custo/complemento/cobertura; executar cenário | Resposta em reais; complemento não prova ociosidade; cenário condicionado |
| 06:25–07:10 | Recarregar/relogin; no APK, abrir recebimento com chegada e boletim de 10,5 recuperados do mesmo backend; mostrar anexo artificial salvo pelo SAF | Persistência e aplicação compartilhada; recuperação nativa ensaiada |
| 07:10–08:00 | Abrir relatório, UML, BPMN e DER; explicar histórico incompleto e limites de Android/iOS | Quatro artefatos e honestidade da evidência |

O roteiro usa dados já preparados, mas as ações demonstradas são reais e gravadas no PostgreSQL. Não usar vídeo gravado. O reinício de serviços deve ser ensaiado antes; sua evidência está no relatório de validação. A apresentação não chama aplicativo pronto para produção.

O APK atual passou em login, consulta e chegada com aprovações pendentes, refletida na web. O checkpoint posterior permaneceu igual após reiniciar API/PostgreSQL. O percurso Android anterior verificou SAF/anexo e recuperação visual nativa. A instrumentação agregada passou em AVD, com um teste de contexto do app. A falha de conexão foi conferida visualmente e pelo estado sem entrada; a asserção Maestro do alerta retornou FAIL por limitação da hierarquia WebView, conforme [relatório](validacao.md). Nenhum aparelho físico foi testado. iOS permanece **NOT RUN** e só recebe **PASS** após execução real em Mac/Xcode.

Os dois exemplos monetários são sintéticos: a data 18/11/2025 é escolhida pelo seed para a variação com uma meia diária, sem afirmar que ela ocorreu na Cocapec. A reexecução preserva boletins existentes; conflito com outra origem aborta o seed. Índice, quatro artefatos, imagens e fontes editáveis foram conferidos no GitHub em 03/10/2026: PASS. Reconfira o acesso antes da apresentação. Não apresentar a entrega como pronta para produção.

## Contingência e encerramento

Antes da apresentação, conferir API/PostgreSQL locais, encaminhamento ADB, cabo USB, carga do dispositivo e AVD disponível como contingência. Manter build, dependências e quatro artefatos acessíveis localmente. A consulta e gravação pelo Android exigem conexão com a API; sem conexão, mostrar o erro, restabelecer serviço/encaminhamento e entrar novamente. Não anunciar gravação offline nem substituir ações ao vivo por vídeo. Confirmar acesso à internet para abrir o repositório; os artefatos locais permitem a leitura durante uma interrupção, sem declarar GitHub verificado.

Ao encerrar, usar Sair nas sessões ativas para revogar seus tokens; o responsável deve revogar tokens remanescentes do banco de demonstração. Encerrar o aplicativo e os servidores API/web; `docker compose stop postgres` interrompe o contêiner preservando o volume. Guardar backup e anexos sintéticos somente em armazenamento privado pelo período de retenção aplicável.

Após o evento e o período de retenção, o responsável autorizado deve identificar e remover apenas cópias geradas, dumps, anexos e banco/volume exclusivos da demonstração. Conferir o destino antes de qualquer exclusão. Não remover arquivos originais nem o conteúdo de `PRIVATE_DATA_DIR` sem ordem expressa sobre essas fontes. A remoção pós-evento permanece NOT RUN; estas instruções não executam limpeza.
