# Tarefas da correção

- [x] T001 — FR-001; SC-002: corrigir o import e conferir Ruff/CLI. Files: scripts/evaluate-invoice-reading.py. Evidence: docs/validacao.md
- [x] T002 — FR-002; SC-001: preservar transparência e testar pixels/original. Files: backend/integrations/invoice_reading.py, backend/integrations/test_invoice_reading.py. Evidence: docs/validacao.md
- [x] T003 — FR-003; SC-002: declarar o parser e atualizar os locks. Files: backend/requirements.in, backend/requirements.lock, backend/requirements.production.lock. Evidence: docs/validacao.md
- [x] T004 — FR-003; SC-001: validar PDFs reais e rejeitar malformados, vazios e criptografados antes do provedor. Files: backend/integrations/invoice_reading.py, backend/integrations/test_invoice_reading.py. Evidence: docs/validacao.md
- [x] T005 — FR-004; SC-001: conferir no payload do SDK a ausência de teto/esforço solicitada pelo usuário e documentar a diferença para a amostra anterior. Files: backend/integrations/test_invoice_reading.py, docs/v2/ocr.md. Evidence: docs/validacao.md
- [x] T006 — FR-005; SC-003: conferir navegador e ausência de registros de domínio; documentar correções e evidências. Files: docs/v2/ocr.md, docs/validacao.md. Evidence: docs/validacao.md
