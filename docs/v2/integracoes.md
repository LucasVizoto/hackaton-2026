# Integrações opcionais — v2

O sistema funciona com todas as integrações externas desligadas. `OPTIONAL_INTEGRATIONS_ENABLED=false` é o padrão. A entrega inclui adaptadores e testes com respostas simuladas; não comprova envio real, conta externa conectada ou homologação de provedor.

A leitura de fotos da Portaria e de PDFs sem texto confiável usa o SDK OpenAI no backend, pela rota `integrations/invoice-reading/`. A extração local de XML e PDFs com texto coerente permanece disponível. `OPENAI_INVOICE_READING_ENABLED=false` é o padrão e controla esse recurso independentemente das demais integrações. Número e chave são sugestões para conferência humana; falhas permitem preenchimento manual e preservam o arquivo selecionado. Consulte [configuração, avaliação e ativação do OCR](ocr.md). A qualidade com documentos reais ainda exige homologação.

## Disponibilidade e responsabilidades

`GET /api/v2/integrations/capabilities/` informa se o recurso está habilitado e possui a configuração mínima. Isso não verifica a validade de credenciais, disponibilidade de rede, saldo da conta ou autorização no provedor. Chamadas indisponíveis retornam erro, sem fabricar resultado.

| Recurso | Contrato local | Limite |
|---|---|---|
| Assistente gerencial | `POST integrations/assistant/`; Gestão/admin; pergunta, período, origem e local opcionais | Consulta indicadores autorizados e compara com o período anterior. Não recebe ferramentas, SQL executável ou acesso para alterar agenda/pagamentos. |
| OCR assistido | `POST integrations/ocr/`; fornecedor, Compras ou Armazém/admin; PDF, PNG ou JPEG até 10 MB | Retorna sugestão para conferência humana. Não cria/aprova NF nem altera itens automaticamente. |
| Leitura de identificação da NF | `POST integrations/invoice-reading/`; Portaria, fornecedor, Compras, Armazém/admin; imagem ou PDF até 10 MB | Retorna número/chave estruturados, com validação determinística. Original é armazenado apenas no envio normal do fluxo. |
| Clima | `GET integrations/weather/`; perfis internos da operação | Previsão informativa, sem bloqueio/reagendamento automático. Ausência, configuração inválida ou resposta incompleta são indisponibilidade. |
| E-mail | Fila persistida processada por `integration_jobs` | Resumo gerencial e notificações internas somente para destinatários explicitamente configurados. |
| Google Calendar | Fila persistida; publicação de reservas | Saída do aplicativo para um calendário configurado. Alterações externas não mudam reserva/capacidade local. |
| WhatsApp | Adaptador de template e fila preparada | Sem conta/template homologados nesta entrega; manter desabilitado até configurar e validar o template na conta responsável. |

Rotas da tabela são relativas a `/api/v2/`. O assistente usa somente dados do período/origem/local solicitados, com cobertura e referências das consultas. A resposta textual é gerada por modelo e exige leitura crítica; o cálculo financeiro permanece no backend determinístico.

## Configuração sem credenciais no repositório

Use variáveis de ambiente do servidor ou o `.env` privado, conforme [instalação](../como_rodar.md). Não colocar tokens em código frontend, APK, documentação ou commit. Os valores abaixo estão vazios ou são exemplos reservados; não habilitam uma conta.

```dotenv
OPTIONAL_INTEGRATIONS_ENABLED=false

OPENAI_API_KEY=
OPENAI_MODEL=
OPENAI_VISION_MODEL=
OPENAI_INVOICE_READING_ENABLED=false
OPENAI_INVOICE_READING_RATE=10/minute

EMAIL_HOST=
EMAIL_PORT=587
EMAIL_HOST_USER=
EMAIL_HOST_PASSWORD=
EMAIL_USE_TLS=true
DEFAULT_FROM_EMAIL=
DIGEST_EMAIL_RECIPIENTS=
NOTIFICATION_EMAIL_RECIPIENTS={}

GOOGLE_CALENDAR_ID=
GOOGLE_CALENDAR_ACCESS_TOKEN=

WHATSAPP_TOKEN=
WHATSAPP_PHONE_ID=
WHATSAPP_API_VERSION=
WHATSAPP_TEMPLATE=
WHATSAPP_TEMPLATE_LANGUAGE=pt_BR
WHATSAPP_RECIPIENTS=

WEATHER_LATITUDE=
WEATHER_LONGITUDE=
```

| Configuração | Como é usada |
|---|---|
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Assistente pela Responses API. É necessário escolher um modelo disponível na conta. |
| `OPENAI_VISION_MODEL` | Modelo com suporte aos tipos de entrada usados pelo OCR. |
| `OPENAI_INVOICE_READING_ENABLED`, `OPENAI_INVOICE_READING_RATE` | Leitura estruturada independente; limite próprio por usuário. Modelo inicial recomendado: `gpt-6-astra`. |
| `EMAIL_*`, `DEFAULT_FROM_EMAIL` | SMTP do Django, com timeout de 30 segundos. `EMAIL_HOST_USER/PASSWORD` dependem da autenticação exigida pelo servidor. |
| `DIGEST_EMAIL_RECIPIENTS` | Lista de e-mails separados por vírgula para resumos gerenciais. |
| `NOTIFICATION_EMAIL_RECIPIENTS` | Objeto JSON com listas explícitas para `warehouse`, `purchasing` e/ou `gatehouse`. Nenhum destinatário é inferido de `User.email`. |
| `GOOGLE_CALENDAR_ID`, `GOOGLE_CALENDAR_ACCESS_TOKEN` | Calendário de destino e token com permissão de escrita nesse calendário. |
| `WHATSAPP_*` | Credenciais/identificadores, versão da API, template, idioma e lista de números autorizados pela operação. O template preparado recebe um parâmetro de corpo com o resumo. |
| `WEATHER_LATITUDE`, `WEATHER_LONGITUDE` | Coordenadas numéricas válidas. A consulta usa temperatura e probabilidade de precipitação, horizonte de três dias e fuso `America/Sao_Paulo`. |

Exemplo exclusivamente ilustrativo de destinatários operacionais:

```dotenv
NOTIFICATION_EMAIL_RECIPIENTS='{"warehouse":["armazem@example.com"],"purchasing":["compras@example.com"],"gatehouse":["portaria@example.com"]}'
```

A configuração é validada como objeto/listas; o adaptador considera apenas endereços válidos dos três perfis conhecidos. Sem destinatários de um perfil, seus alertas continuam disponíveis somente na caixa interna. Uma notificação reconhecida antes do envio não gera o e-mail. O e-mail não marca ciência automaticamente no aplicativo.

## Preparação e envio de lotes

O comando não instala tarefa agendada. Um operador pode executar manualmente ou configurar um agendador sob sua responsabilidade. O ator precisa ser uma conta ativa de Gestão/admin. O período aceita no máximo 366 dias e a origem precisa ser explícita: `demo_sintetico` ou `operacional_registrado`.

Na pasta `backend`, preparar um lote sem enviar:

```powershell
.\.venv\Scripts\python.exe manage.py integration_jobs --actor gestao_demo --date-from 2026-10-05 --date-to 2026-10-05 --origin demo_sintetico
```

O exemplo usa dados sintéticos. Para um envio intencional, depois de configurar e conferir destinatários/credenciais, acrescentar `--send` ao mesmo comando. Nunca trocar a origem apenas para tornar dados de demonstração aparentes como operação real.

O lote guarda autor, origem, data inicial e final. `--send` considera apenas os IDs preparados/reconhecidos nessa execução, pertencentes ao mesmo autor e ao mesmo escopo. Uma fila antiga sem escopo, uma chave já pertencente a outro autor ou outro período/origem permanece intacta. Cada execução despacha no máximo 500 itens pendentes elegíveis; execuções posteriores podem processar o restante do mesmo lote.

A seleção das reservas e notificações usa a data reservada do agendamento. Os números do resumo usam os critérios temporais documentados nos [indicadores](indicadores.md), como conclusão da descarga, saída da Portaria e data do boletim. Não são coortes idênticas por definição.

## Deduplicação, confirmação e falhas

`OutboundDelivery` persiste canal, chave de deduplicação, conteúdo, autor, tentativas, estado e referência do provedor. Não há endpoint público para editar arbitrariamente essa fila.

| Estado/resultado | Significado e repetição |
|---|---|
| `pending` | Preparado. Se o canal estiver desabilitado/sem configuração, permanece pendente com zero tentativas novas. |
| `sending` | Um processo assumiu o envio sob bloqueio de linha. Outro processo não o repete. Se o processo parar, exige análise operacional. |
| `sent` | O adaptador recebeu confirmação suficiente. Para e-mail, `smtp_accepted` significa aceitação SMTP, não leitura nem confirmação de entrega final. |
| `failed` | Falha conhecida, como destinatário removido da configuração ou revisão de calendário obsoleta. Não há repetição automática. |
| `uncertain` | Não é possível saber se o provedor aceitou o envio, por exemplo timeout após transmissão ou erro remoto ambíguo. Não é reenviado automaticamente. |

Resumos são deduplicados por origem/período/canal, e por destinatário no WhatsApp. Alertas de e-mail são deduplicados por notificação. Eventos de calendário são enfileirados por agendamento/revisão. Repetir um lote não transforma falhas em sucesso nem reinicia itens incertos.

Antes de corrigir/reprocessar uma falha conhecida ou incerta, conferir a referência e o estado no provedor. A entrega não inclui console de reconciliação/reenvio nem recuperação automática de registros presos em `sending`. Renovar uma credencial não altera o estado de uma tentativa já encerrada.

## Calendário, OAuth e expiração

Cada agendamento usa um ID estável derivado do UUID. O adaptador atualiza o evento existente; se não houver evento, cria com o mesmo ID, tratando conflito de criação. Cancelamento/não recebimento remove o evento, e ausência já confirmada pelo provedor é tratada como remoção idempotente. O evento é privado/transparente, com um marcador de um minuto: esse minuto não representa duração estimada de descarga nem reserva de capacidade externa. O formato de criação e os IDs permitidos seguem a [referência oficial de inserção de eventos](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert); atualização e exclusão seguem as operações [update](https://developers.google.com/workspace/calendar/api/v3/reference/events/update) e [delete](https://developers.google.com/workspace/calendar/api/v3/reference/events/delete).

Uma revisão obsoleta da fila não exporta o estado novo silenciosamente. O destino configurado também é conferido. A operação serializa alterações do mesmo agendamento durante a chamada ao provedor; latência externa pode adiar comandos desse agendamento até o timeout.

O código recebe um access token pronto. Não implementa login OAuth, obtenção/armazenamento de refresh token, renovação automática ou escolha interativa de calendário. Tokens podem expirar/revogar; o administrador deve providenciar credencial válida e reconciliar a fila. Para operação contínua, falta implementar o ciclo OAuth autorizado pela conta, conforme [OAuth 2.0 para aplicações web do Google](https://developers.google.com/identity/protocols/oauth2/web-server).

## OCR, assistente e documentos originais

O original enviado ao OCR é salvo com SHA-256 antes da chamada de extração. Falha do provedor mantém o arquivo e retorna seu identificador. Download é restrito ao autor e à conferência por Compras/Armazém/admin; a Portaria não recebe acesso ao arquivo avulso de OCR. NFs já vinculadas ao recebimento têm a autorização própria de documentos do fluxo.

O OCR usa entradas de arquivo/imagem da Responses API, retorna sugestão e pede conferência humana. O adaptador usa `store=false`, não envia ferramentas e não oferece SQL ou operações de domínio ao modelo. Isso descreve a requisição do aplicativo, sem prometer política de retenção diferente daquela contratada com o provedor. Consulte as referências oficiais de [entradas de arquivo](https://developers.openai.com/api/docs/guides/file-inputs) e [ferramentas na Responses API](https://developers.openai.com/api/docs/guides/tools).

Assinaturas locais independem de provedor externo. Exigem recebimento v2 concluído e conferência resolvida. O manifesto reúne NFs/hashes, linhas e decisões, referências de pedido/complemento, visitas e marcos observados. Autor e revisão ficam preservados; alteração posterior torna a assinatura anterior não atual. Não se afirma assinatura digital certificada nem substituição automática de documento obrigatório.

A Portaria acompanha situação, transporte, NFs vinculadas e marcos. Sua resposta não inclui análise/anotações de Compras, referências internas de pedido, linhas de decisão da conferência ou conteúdo interno da trilha de auditoria. Para assinaturas, vê metadados/hash e atualidade, sem declaração ou manifesto com decisões internas. A restrição ocorre na API, inclusive na projeção de lista v1, além dos botões da interface.

## Evidência e referências complementares

Testes locais cobrem fila e escopo, deduplicação, falha incerta, e-mail com backend em memória, respostas Google simuladas, OCR/original/autorização, assistente sem escrita e clima indisponível. A suíte completa final de 187 testes PostgreSQL passou em banco isolado, incluindo a restrição de dados da Portaria e a paginação do extrato individual. Nenhum e-mail, mensagem WhatsApp, evento Google ou requisição de OCR/IA real foi enviado nessa validação. Consulte o [estado de validação](../validacao.md) para atualizações posteriores.

O SMTP usa a API de e-mail do Django, documentada em [Sending email — Django 5.2](https://docs.djangoproject.com/en/5.2/topics/email/). Os campos meteorológicos estão descritos na [documentação oficial Open-Meteo](https://open-meteo.com/en/docs). A consulta à documentação Meta não concluiu nesta rodada; o adaptador WhatsApp está preparado, mas depende de revisão da versão/template e validação na conta antes de habilitar. Não há sincronização SAP, confirmação de pagamento bancário ou envio de pagamento RH.
