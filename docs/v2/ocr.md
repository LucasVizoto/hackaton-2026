# Leitura de número e chave da NF com OpenAI

Fotos da Portaria usam leitura online no backend. PDFs do cadastro usam PDF.js localmente quando os identificadores são coerentes; PDFs escaneados, ambíguos ou com chave inválida seguem para OpenAI. XML continua local. O aplicativo permite preenchimento manual durante a leitura e invalida respostas ao trocar/remover arquivo, editar identificadores ou sair da tela.

## Configuração e contrato

```dotenv
OPENAI_API_KEY=<credencial privada do servidor>
OPENAI_VISION_MODEL=gpt-6-astra
OPENAI_INVOICE_READING_ENABLED=false
OPENAI_INVOICE_READING_RATE=10/minute
```

A flag é independente de `OPTIONAL_INTEGRATIONS_ENABLED`. A capability `invoice_reading` informa presença de configuração, sem verificar conta, saldo ou rede. Ative a flag apenas após homologar a conta e o conjunto real de documentos. Desativá-la devolve os fluxos ao preenchimento manual, preservando a leitura local de XML/PDF.

`POST /api/v2/integrations/invoice-reading/` usa a autenticação existente e recebe `file` por multipart, até 10 MB. Portaria, fornecedor, Compras, Armazém e admin podem transcrever um documento enviado por eles. A rota não consulta documentos de outros usuários, não amplia as permissões do OCR avulso e não cria registros de domínio.

Resposta 200: `number` e `access_key` são strings ou `null`; `status` é `suggested`, `unreadable` ou `ambiguous`; `requires_confirmation` é sempre `true`. Número impresso conserva zeros na Portaria; o cadastro normaliza seus zeros. Chave inválida é descartada; conflito entre número/chave válidos ou múltiplas notas distintas exige preenchimento manual. Uma chave válida pode fornecer o número quando ele não é legível.

Arquivo inválido retorna 400, limite de uso 429, integração indisponível 503. Cada chamada usa timeout de 60 segundos, sem repetição automática. Por decisão do usuário, a aplicação não envia teto de tokens nem configuração de esforço de raciocínio: usa os padrões do modelo. Os tempos e custos registrados na amostra paga anterior foram medidos com teto de 1.024 tokens e esforço baixo; não comprovam a latência/consumo da configuração atual. Resposta incompleta retorna indisponibilidade e libera preenchimento manual. Cancelar a espera no cliente não garante cancelamento de uma chamada já recebida pelo provedor nem evita sua cobrança.

JPEG, PNG, WebP, HEIC/HEIF são decodificados, orientados e convertidos para uma cópia PNG sem EXIF. Transparência é composta sobre branco para preservar a leitura de texto preto. Essa cópia mantém a resolução até o limite de dimensões/30.000 patches. PDFs completos são enviados como arquivo com detalhe alto após validação estrutural estrita com `pypdf`: arquivos malformados, sem páginas ou criptografados são rejeitados antes da chamada ao provedor. O parser não renderiza, reescreve nem extrai conteúdo fiscal; originais válidos seguem intactos. O SDK usa `responses.parse`, schema Pydantic, `store=false` e nenhuma ferramenta. Isso não promete retenção zero contratual no provedor. O original selecionado é armazenado pelo fluxo normal de envio da chegada/NF.

Os logs registram modelo, estado, duração e tokens, sem conteúdo fiscal, nome de arquivo, chave ou credenciais. A transcrição e a validação estrutural não atestam autenticidade fiscal.

## Comparação reproduzível

Prepare um conjunto privado representativo de pelo menos 100 documentos reais, incluindo fotos, PDF textual, PDF escaneado, orientação, reflexos, baixa legibilidade, chaves inválidas e múltiplas notas. Rotule número, chave e estado com conferência humana. Use nomes de arquivo únicos. Preserve os zeros impressos no rótulo do número para medir acerto exato, inclusive esse ganho sobre a referência antiga.

Guarde manifesto, documentos e resultados em `.private/ocr-evaluation/`, ignorada pelo Git. Exemplo sintético de manifesto:

```json
{"documents":[{"id":"exemplo-sintetico","file":"nota.png","number":"000123","access_key":null,"status":"suggested"}]}
```

Capture a referência no navegador:

```powershell
node scripts/capture-ocr-baseline.mjs
```

Abra `http://127.0.0.1:4101`, selecione manifesto e pasta, e guarde `ocr-baseline.json` junto ao conjunto privado. A ferramenta extrai o motor anterior da revisão `9abfcc6943346e51d2e80cb4f3b3c1f64b5d4d1f`, instala as versões originais em `.private/ocr-baseline/`, registra a procedência e não participa do bundle/deploy. PDFs preservam inclusive o limite antigo de três páginas de texto e primeira página de OCR. O Tesseract pode baixar recursos de idioma/execução. Encerre o servidor com Ctrl+C. `--prepare` apenas prepara a ferramenta, sem processar documentos.

Após configurar uma conta e habilitar a flag para a avaliação, executar a opção abaixo envia os documentos ao provedor e consome tokens:

```powershell
backend/.venv/Scripts/python.exe scripts/evaluate-invoice-reading.py --manifest .private/ocr-evaluation/manifest.json --baseline .private/ocr-evaluation/ocr-baseline.json --run-openai --output-dir .private/ocr-evaluation/results
```

Para recalcular o relatório sem rede, substituir `--run-openai` por `--candidate .private/ocr-evaluation/results/candidate.json` e usar outro diretório de saída. IDs e SHA-256 precisam coincidir integralmente entre referência, documentos e resultado candidato. O resultado candidato contém identificadores fiscais e deve continuar privado.

O relatório registra acerto exato de número/chave nos documentos rotulados com esses campos, sugestões incorretas, ausência de leitura, falhas, ambiguidades reconhecidas, latência mediana e tokens. Aceitação exige pelo menos 100 documentos, mais números corretos, manutenção/melhora das chaves, menos sugestões incorretas, todas as ambiguidades tratadas e ausência de falhas de provedor. O resultado precisa ser acompanhado da conferência humana da representatividade do conjunto. Testes sintéticos/mocks não comprovam essa melhora.

## Ativação

1. Instalar os locks e verificar Pillow/HEIF no Python 3.14 de desenvolvimento e Linux de produção.
2. Executar os checks automatizados e verificar web/Android com configuração ausente, preenchimento manual e resposta atrasada.
3. Homologar os 100 documentos com referência pareada e conferir custo/latência registrados.
4. Configurar a credencial/modelo privados e ativar `OPENAI_INVOICE_READING_ENABLED=true` na instalação homologada.
5. Acompanhar logs/consumo da conta. Em regressão, desativar a flag e usar preenchimento manual.

Referências: [SDK oficial](https://developers.openai.com/api/docs/libraries), [respostas estruturadas](https://developers.openai.com/api/docs/guides/structured-outputs), [imagens e resolução](https://developers.openai.com/api/docs/guides/images-vision), [PDFs](https://developers.openai.com/api/docs/guides/file-inputs), [Pillow HEIF](https://pillow-heif.readthedocs.io/en/stable/pillow-plugin.html).
