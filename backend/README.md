# API e regras de domínio

Django 5.2/DRF, Python 3.14 e PostgreSQL 17. Leia o README da raiz para preparar `.env`, dependências fixadas e banco. Não há modo SQLite, mocks persistentes ou integração SAP.

```powershell
Set-Location C:\Projects\hackaton-2026
.\backend\.venv\Scripts\python.exe backend\manage.py bootstrap_database --path 'C:\pasta-privada\DADOS_HACKATHON_2026'
# Opcional, para contas e operações sintéticas:
.\backend\.venv\Scripts\python.exe backend\manage.py seed_demo
.\backend\.venv\Scripts\python.exe backend\manage.py runserver 127.0.0.1:8000
.\scripts\checks.ps1
```

Rotas em `/api/v1/`: `health/`, `auth/login/`, `auth/me/`, `auth/logout/`; catálogos somente leitura; `invoices/upload/`, `attachments/:id/download/`, `appointments/` e ações; `slots/availability/`, `slots/assign-cancelled-capacity/`, `warehouse-visits/:id/start|finish/`, `non-receipts/`; `bulletins/`, `bulletins/preview/`, `bulletins/:id/close|reopen/`; `analytics/operations/`, `analytics/labor-costs/`, `analytics/staffing-scenario/`, `data/quality/`. Consulte o [contrato da API](../docs/api.md).

Autorização é feita no servidor pelo perfil, com isolamento de fornecedor. Upload XML/PDF e download são privados. Recebimentos usam `expected_revision`; edição/fechamento/reabertura de boletim exigem `revision`. Valores monetários no JSON são strings decimais exatas, com campos de apresentação em centavos. Erros usam envelope `error`.

Agenda bloqueia a grade global, inclusive sua primeira criação concorrente. Fechamento de boletim bloqueia matrículas em ordem estável para validar o rateio entre locais. Testes incluem concorrência PostgreSQL em threads. Migrations versionadas representam todos os modelos; novas alterações devem passar `makemigrations --check --dry-run`.

Inicialização: `manage.py bootstrap_database [--path PASTA] [--dry-run] [--report ARQUIVO]`. Valida todas as fontes antes das migrations, instala o baseline em transação única e conserva os 938 arquivos em armazenamento privado. `manage.py seed_hackathon` aplica somente o seed sobre schema já preparado. Reexecução não duplica nem altera o baseline. O banco deve existir e estar configurado por `DB_*`.

Importação privada incremental: `manage.py import_private [--path PASTA] [--dry-run]` mantém os cinco leitores originais e a política de versões por lote. Dados históricos não recebem tempos inventados nem custos reconstruídos de RH. `seed_demo` permanece opcional e pula o exemplo de 17/11/2025 quando esse boletim histórico já existe. Confira a [cobertura e uso no deploy](../docs/importacao.md).

O leitor 1.1 reconcilia linhas aceitas, pendentes e rejeitadas com o total preservado. Motivos de pendência são privados. Erros estruturais abortam o lote; uma linha com vários motivos conta uma vez. Consulte [importação](../docs/importacao.md).

Gestão/administrador recebem `source_records` em indicadores financeiros e operacionais, com IDs/datas/valores dos conjuntos agregados. Cada conjunto tem `count`, `returned_count` e `truncated`, limitado a 100 em ordem determinística. Chegadas, agendamentos, conclusões e não recebimentos usam datas próprias. Outros perfis e consultas históricas recebem `null`; não há nomes/documentos históricos adicionais. Consulte [indicadores](../docs/indicadores.md).
