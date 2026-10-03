# Importação privada e idempotente

Os importadores leem a pasta configurada em `PRIVATE_DATA_DIR`, ou em `--path`. Não copiam nem modificam as fontes. Originais, anexos, banco e arquivos `.env` ficam fora do controle de versão.

```powershell
& .\backend\.venv\Scripts\python.exe .\backend\manage.py import_private --dry-run
& .\backend\.venv\Scripts\python.exe .\backend\manage.py import_private
& .\backend\.venv\Scripts\python.exe .\backend\manage.py import_private --kind movements
```

Conjuntos suportados: produtos, fornecedores, catálogo direto de matrículas N:O do boletim, movimentação documental e CSV de presença/RH. A folha mensal original não é reconstruída. O exemplo preenchido do boletim não é importado como série de produção. XMLs novos são lidos pelo fluxo de anexos; a amostra não é importada como demanda.

Cada lote registra tipo, hash SHA-256, versão do leitor, fonte privada, quantidade, resumo e problemas. Cada linha preserva aba/posição e valores originais. Somente um lote por conjunto fica ativo para análise. Reimportar o mesmo hash/versão não duplica registros; outro hash conserva a versão anterior como inativa. Reimportar um hash anterior o reativa. Um bloqueio transacional PostgreSQL por conjunto protege importações concorrentes.

O leitor 1.1 reconcilia por linha `accepted_rows + pending_rows + rejected_rows = preserved_rows = row_count`. Uma linha com vários motivos conta uma vez como pendente. Aceito significa que o leitor não encontrou pendência, sem atestar correção fiscal ou operacional. Pendências preservam valores e motivos, inclusive referências ausentes e repetições; não são descartadas. Nos lotes gravados, `rejected_rows=0`: erros estruturais impedem o lote inteiro de ser gravado. O modo `dry-run` confere somente a fonte, com `catalog_links_checked=false`; a reconciliação definitiva da movimentação inclui os vínculos do catálogo ativo. A tabela privada `SourceRow` também conserva `problems` para catálogos. A mudança de versão conserva os lotes 1.0 como inativos.

Cada arquivo é validado antes de gravar e sua importação é atômica. A execução completa pode importar um conjunto e detectar erro em outro; esse limite é explícito. O modo `--dry-run` valida fontes sem gravar registros. Colunas incompatíveis causam erro; arquivos ausentes são informados e não substituídos por mock.

Produto único e produto/depósito são tabelas diferentes. Histórico usa FKs opcionais e códigos originais privados, preservando referências ausentes. Nunca há `INNER JOIN` eliminando movimento nem join por produto multiplicando medidas. Os pares usados para conferir a versão atual vêm do lote ativo do catálogo, mesmo que antigas associações normalizadas continuem preservadas no banco.

`quantity` e `reported_order_weight` conservam os valores da fonte. Não se soma peso por linha ou por recebimento. A movimentação não fornece identidade de caminhão físico nem timestamps operacionais. O pagamento de RH é conservado como `payroll_paid` em tabela histórica; não alimenta o custo dos boletins.

Nenhuma rota fornece linhas originais. A qualidade exposta pela API contém apenas resumos e problemas agregados para usuários internos. Os dados históricos não misturam automaticamente o seed `demo_sintetico`.

Na execução local, foram preservadas 41.779 linhas de movimentação, 10.604 produtos em 10.899 pares produto/depósito, 872 fornecedores, 15 matrículas do cadastro direto do boletim e 428 datas do CSV. A contagem de fornecedores observada diverge dos 859 informados no LEIA-ME; não foi corrigida ou atribuída a esclarecimento da Cocapec.

O leitor marcou 10.517 linhas com produto ausente do cadastro atual, abrangendo 4.676 códigos distintos, e 4.358 linhas com produto cadastrado, mas sem o par produto/depósito atual. Também marcou 114 chaves fiscais de formato inválido e 229 ausentes. Todos esses registros foram preservados. Duas referências documentais de fornecedor estão associadas a múltiplos códigos; nenhum cadastro foi escolhido automaticamente por esse documento.

A segunda execução retornou `unchanged` para os cinco conjuntos. Testes em PostgreSQL cobrem troca de versão sem soma duplicada, produto em vários depósitos, referências ausentes, catálogo alterado, `dry-run`, fontes ausentes, preservação de RH e restrição/redação da API. Detalhes finais estão em [validacao.md](validacao.md).
