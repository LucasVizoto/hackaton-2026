# Inicialização completa e importação privada

## Montar um banco novo

Configure um banco PostgreSQL existente e novo em `DB_NAME`, `DB_HOST`, `DB_PORT`, `DB_USER` e `DB_PASSWORD`. Disponibilize o pacote completo por `PRIVATE_DATA_DIR` e um armazenamento privado persistente por `MEDIA_ROOT`. O banco é provisionado separadamente; o comando abaixo prepara o schema e os dados.

```powershell
.\backend\.venv\Scripts\python.exe backend\manage.py bootstrap_database --path 'C:\pasta-privada\DADOS_HACKATHON_2026' --dry-run
.\backend\.venv\Scripts\python.exe backend\manage.py bootstrap_database --path 'C:\pasta-privada\DADOS_HACKATHON_2026' --report '.private\seed-report.json'
```

O setup local executa esse mesmo comando. `seed.ps1` chama `seed_hackathon`, que instala somente o baseline sobre schema já preparado. `--dry-run` valida as fontes e, quando o schema já está atualizado, os conflitos com registros existentes. Não executa migrations, gravações no banco ou cópias de anexos. Se solicitado, o relatório JSON é gravado no caminho de `--report`.

O relatório privado inclui o manifesto completo, hashes, pendências dos documentos e cobertura das entidades. Grave-o fora da pasta de fontes: um relatório dentro do pacote alteraria seu manifesto. A saída do terminal contém somente o resumo agregado.

Todas as fontes obrigatórias são conferidas antes da primeira escrita. Migrations são serializadas por uma trava de sessão PostgreSQL. O seed usa transação única e trava transacional, incluindo coordenação com os leitores de `import_private`. Falhas de dados ou de cópia revertem o seed e removem apenas os arquivos criados naquela tentativa. Migrations concluídas permanecem aplicadas; o comando pode ser repetido após corrigir a causa.

`SeedRun` identifica o baseline `hackathon-2026-v1`, seu manifesto e hashes. O mesmo conjunto retorna `unchanged`, preservando IDs, arquivos, senhas e alterações posteriores dos operadores. Outro manifesto é recusado: atualizar fontes não substitui automaticamente o baseline. Cadastros e lotes anteriores equivalentes são reutilizados; diferenças interrompem a inicialização. O seed não é uma rotina de atualização do ERP.

## Cobertura do pacote e do banco

| Fonte | Destino |
|---|---|
| Produtos | `Product` e `ProductDeposit`: 10.604 produtos, 10.899 associações |
| Fornecedores | `Supplier`: 872 códigos; documentos compartilhados ficam sinalizados |
| Depósitos de cadastro e movimentação | `Depot`: 14 códigos; `Warehouse`: quatro locais |
| Estoque de defensivos, fertilizantes, geral e máquinas | `HistoricalStock`: 1.245 posições; 12 referências de produto ausentes são preservadas |
| Equipamentos | Quatro `Equipment`, com finalidade; localização e mobilidade desconhecidas ficam nulas |
| Pedido, recebimento e nota fiscal | `HistoricalMovement`: 41.779 linhas, sem inventar agendamentos |
| XML e DANFE | `Invoice`, `InvoiceItem` e vínculos privados em `SourceFile` |
| CSV de chapas | `HistoricalLaborDay`: 428 datas, sem transformar RH em custo de produção |
| Folhas Excel | `HistoricalWorkerDay`: observações por célula; `SourceRow`: rubricas, fórmulas, cache e endereços originais |
| Boletim preenchido | 15 `Worker`, 14 `ServiceRate`, um `DailyBulletin`, 14 linhas e 11 participantes |
| Documentos de referência | `SourceFile`: formulário em branco, PDF manuscrito, especificação, imagem SAP e LEIA-ME |

Os 938 arquivos são conservados em `MEDIA_ROOT/seed`, com nomes por hash. Duplicatas idênticas reutilizam o arquivo físico e continuam tendo entradas próprias em `SourceFile`. Um arquivo pode alimentar vários lotes; `ImportBatch.source_key` distingue fontes do mesmo tipo. Os lotes anteriores conservam a chave vazia e os cinco leitores originais continuam compatíveis.

Os depósitos principais são associados explicitamente: `MATFerti` a Adubo, `MATDefe` e `MATGeral` a Insumos, `MATLoja` a Loja e `MATMaq` a Máquinas. Os demais códigos permanecem sem local confirmado. As planilhas de estoque não informam data de posição: `snapshot_on` fica nulo.

`Appointment`, `GlobalSlot`, `WarehouseVisit`, `CapacityHold`, `ReceivingEvent`, `NonReceipt` e `Holiday` não recebem registros inventados. As relações de equipamentos com operações também ficam vazias. Permissões e tipos de conteúdo são gerados pelo Django; grupos, perfis reais, tokens e sessões não são provisionados. A única conta histórica, `_seed_hackathon`, fica inativa e com senha inutilizável, para autoria da importação. O relatório registra cobertura e contagem de cada entidade, inclusive tabelas de associação.

## Pendências e regras de reconciliação

Os 460 XMLs contêm 458 chaves distintas. Versões com extração equivalente compartilham a nota e conservam todos os arquivos. O código de cada item fiscal continua sendo o do fornecedor. O CNPJ é cruzado com o código da movimentação: documentos de duas chaves com conflito são preservados sem criar nota com fornecedor presumido. Os dois DANFEs sem XML entram como notas manuais, com fornecedor documental inequívoco. A carga resulta em 458 notas utilizáveis e 831 itens, com dois documentos fiscais pendentes.

As folhas de RH contêm datas com anos 1900/1901, cabeçalhos repetidos e abas cujo nome diverge das datas. Datas válidas das colunas prevalecem para a observação, com a divergência anotada; datas inválidas têm `day=null`. Valores que não cabem na precisão do campo ficam preservados no original e pendentes, sem arredondamento silencioso. Repetições idênticas têm somente uma observação utilizável; valores conflitantes não são consolidados. A matrícula só é vinculada quando existe correspondência explícita no catálogo do boletim. `FRANCA` não é convertido em um armazém presumido.

Foram preservadas 6.380 observações individuais, das quais 5.081 ficaram utilizáveis. Contagens de problemas podem se sobrepor; não devem ser somadas como pessoas ou observações distintas. O CSV continua sendo a consolidação diária de RH, sem recalcular seu pagamento a partir de uma folha incompleta. Agosto e dezembro de 2025 continuam ausentes.

O único boletim importado é Adubo em 17/11/2025: produção `918.1952`, piso/total `991.9041` e complemento `73.7089`. O fechamento histórico não foi informado, por isso `closed_at` fica nulo. `BulletinRevision` registra a importação no momento atual. O valor declarado de meia diária fica na proveniência; os cálculos usam frações do piso completo. `seed_demo` pula apenas seu exemplo conflitante nesse local/data, conservando os demais exemplos.

O PDF manuscrito de nove páginas permanece como referência privada, sem OCR ou transcrição. A especificação inicial, o formulário e a imagem SAP não geram lançamentos de negócio. `/api/v1/data/quality/` mostra resumos dos lotes e do baseline para usuários internos, sem caminhos, hashes, nomes, códigos fiscais ou linhas originais. Downloads existentes de notas preservam o isolamento por fornecedor. Nenhuma nova tela ou rota de exportação de estoque, folha ou documentos de referência foi criada.

## Execução no deploy

Disponibilize as fontes e `MEDIA_ROOT` por volumes privados ou armazenamento persistente acessível ao processo de montagem. Na raiz do checkout, execute antes de iniciar os servidores:

```sh
python backend/manage.py bootstrap_database --report /private/seed-report.json
```

Um retorno diferente de zero interrompe o deploy. Não há carga automática em `post_migrate` ou na inicialização dos workers web. A infraestrutura de banco, credenciais e volumes é provisionada separadamente. O suporte ao comando em produção não altera as limitações de produção do restante do MVP. Os dados continuam sujeitos ao uso autorizado durante o evento e não entram no Git, nas imagens públicas ou em relatórios públicos com valores originais.

## Leitores históricos originais (`import_private`)

Os importadores leem a pasta configurada em `PRIVATE_DATA_DIR`, ou em `--path`. Não copiam nem modificam as fontes. Originais, anexos, banco e arquivos `.env` ficam fora do controle de versão.

```powershell
& .\backend\.venv\Scripts\python.exe .\backend\manage.py import_private --dry-run
& .\backend\.venv\Scripts\python.exe .\backend\manage.py import_private
& .\backend\.venv\Scripts\python.exe .\backend\manage.py import_private --kind movements
```

Nesse comando, os conjuntos suportados continuam sendo produtos, fornecedores, catálogo direto de matrículas N:O do boletim, movimentação documental e CSV de presença/RH. Para importar também estoque, equipamentos, folhas individuais, documentos fiscais e o boletim preenchido, use o baseline completo descrito acima. Nenhum comando reconstrói uma série histórica de boletins.

Cada lote registra tipo, hash SHA-256, versão do leitor, fonte privada, quantidade, resumo e problemas. Cada linha preserva aba/posição e valores originais. Somente um lote por conjunto fica ativo para análise. Reimportar o mesmo hash/versão não duplica registros; outro hash conserva a versão anterior como inativa. Reimportar um hash anterior o reativa. Um bloqueio transacional PostgreSQL por conjunto protege importações concorrentes.

O leitor 1.1 reconcilia por linha `accepted_rows + pending_rows + rejected_rows = preserved_rows = row_count`. Uma linha com vários motivos conta uma vez como pendente. Aceito significa que o leitor não encontrou pendência, sem atestar correção fiscal ou operacional. Pendências preservam valores e motivos, inclusive referências ausentes e repetições; não são descartadas. Nos lotes gravados, `rejected_rows=0`: erros estruturais impedem o lote inteiro de ser gravado. O modo `dry-run` confere somente a fonte, com `catalog_links_checked=false`; a reconciliação definitiva da movimentação inclui os vínculos do catálogo ativo. A tabela privada `SourceRow` também conserva `problems` para catálogos. A mudança de versão conserva os lotes 1.0 como inativos.

Cada arquivo é validado antes de gravar e sua importação é atômica. A execução completa pode importar um conjunto e detectar erro em outro; esse limite é explícito. O modo `--dry-run` valida fontes sem gravar registros. Colunas incompatíveis causam erro; arquivos ausentes são informados e não substituídos por mock.

Produto único e produto/depósito são tabelas diferentes. Histórico usa FKs opcionais e códigos originais privados, preservando referências ausentes. Nunca há `INNER JOIN` eliminando movimento nem join por produto multiplicando medidas. Os pares usados para conferir a versão atual vêm do lote ativo do catálogo, mesmo que antigas associações normalizadas continuem preservadas no banco.

`quantity` e `reported_order_weight` conservam os valores da fonte. Não se soma peso por linha ou por recebimento. A movimentação não fornece identidade de caminhão físico nem timestamps operacionais. O pagamento de RH é conservado como `payroll_paid` em tabela histórica; não alimenta o custo dos boletins.

Nenhuma rota fornece linhas originais. A qualidade exposta pela API contém apenas resumos e problemas agregados para usuários internos. Os dados históricos não misturam automaticamente o seed `demo_sintetico`.

Na execução local, foram preservadas 41.779 linhas de movimentação, 10.604 produtos em 10.899 pares produto/depósito, 872 fornecedores, 15 matrículas do cadastro direto do boletim e 428 datas do CSV. A contagem de fornecedores observada diverge dos 859 informados no LEIA-ME; não foi corrigida ou atribuída a esclarecimento da Cocapec.

O leitor marcou 10.517 linhas com produto ausente do cadastro atual, abrangendo 4.676 códigos distintos, e 4.358 linhas com produto cadastrado, mas sem o par produto/depósito atual. Também marcou 114 chaves fiscais de formato inválido e 229 ausentes. Todos esses registros foram preservados. Duas referências documentais de fornecedor estão associadas a múltiplos códigos; nenhum cadastro foi escolhido automaticamente por esse documento.

A segunda execução retornou `unchanged` para os cinco conjuntos. Testes em PostgreSQL cobrem troca de versão sem soma duplicada, produto em vários depósitos, referências ausentes, catálogo alterado, `dry-run`, fontes ausentes, preservação de RH e restrição/redação da API. Detalhes finais estão em [validacao.md](validacao.md).
