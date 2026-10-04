# Plano de correção

Reutilizar `prepare_attachment`, `extract_invoice`, `InvoiceReadingView` e os testes existentes. O fluxo de UI e o contrato da API permanecem os mesmos.

1. FR-001: mover o import do script para `main()` após a preparação do caminho Python.
2. FR-002: usar Pillow para compor RGBA/paleta/transparência sobre fundo branco, preservando a cópia sem EXIF e os bytes originais.
3. FR-003: adicionar `pypdf` para ler a estrutura e verificar páginas antes do envio. Não há parser de PDF no backend atual; assinaturas de arquivo não atendem à validação de conteúdo. A biblioteca é Python puro e não será usada para OCR nem para modificar originais. Atualizar ambos os locks para Python 3.14, preservando os demais pins.
4. FR-004: conforme a correção posterior do usuário, omitir teto de tokens e esforço de raciocínio. Verificar sua ausência no JSON produzido pelo SDK com transporte controlado e documentar que a latência/consumo medidos anteriormente usavam outra configuração.
5. FR-005: manter validações fiscais, permissões e erros atuais. Documentar tratamento de transparência/PDF e parâmetros padrão do modelo em `docs/v2/ocr.md`; registrar resultados em `docs/validacao.md`.

Validação SC-001/SC-002: testes `integrations.test_invoice_reading` e `integrations.test_ocr_evaluation`, Ruff com `backend/ruff.toml` sobre backend/scripts/deploy, Django check e makemigrations dry-run. Conferir localmente a pequena amostra de PDFs reais já usada, sem rede. Instalar o lock de produção em contêiner Python 3.14.

Validação SC-003: navegador na Portaria, com conta sintética em banco isolado, SDK real e transporte HTTP local. Verificar prévia, confirmação, falha e preenchimento manual; conferir que os registros de domínio permanecem ausentes.

Risco: parsing estrito pode rejeitar PDFs fora da especificação. A amostra local verifica compatibilidade; rejeição deve retornar 400 com instrução para usar um PDF válido e permitir preenchimento manual. Não será extraído nem registrado conteúdo fiscal pelo parser.

Referências da dependência: [PdfReader](https://pypdf.readthedocs.io/en/stable/modules/PdfReader.html), [modo estrito](https://pypdf.readthedocs.io/en/stable/user/robustness.html).
