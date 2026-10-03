# Implementação v2 — recebimento, pessoas e gestão

Plano autorizado em 03/10/2026. Base de trabalho: `1ef6e68`.

## Regras que orientam a entrega

- Dupla aprovação de Compras e Armazém; um caminhão/recebimento/reserva com várias NFs do mesmo fornecedor.
- Máquina/implemento é carga própria e exclusiva, separada do equipamento usado na descarga.
- Portaria vê placas, transportadora, fornecedor, destinos e anexos das NFs; não acessa remuneração.
- Quatro marcos: entrada e saída na portaria, entrada e saída em cada armazém. Descarga concluída não é saída da unidade.
- Uma pessoa participa financeiramente de um boletim por dia. Atividades podem ocorrer em vários locais; o armazém responsável pelo custo é selecionado explicitamente.
- Apuração individual: fração × máximo(produção/diárias equivalentes, piso), com valores exatos e rateio de centavos determinístico.
- Apurado e histórico do RH são separados; não há execução de pagamento.
- Diária Completa e Meia Diária são serviços além das 14 categorias; tarifa da meia diária de serviço não é substituída por metade do piso.
- Exceções de fração, saída antecipada, horas extras e diária especial ficam pendentes e impedem apenas o fechamento afetado.
- Históricos fechados e horários ausentes não serão recalculados ou inventados.

## Frentes e critérios

1. Agenda: validação numérica de NF sem truncamento, divergência XML/manual, múltiplos anexos, origem derivada, invalidação das aprovações ao trocar documentos, uma seleção de horário baseada na API, descarte de resposta antiga, bloqueio enquanto carrega, conflito concorrente sem apagar formulário.
2. Portaria: campos estruturados de transporte, perfil próprio, quatro eventos, visitas sequenciais, repetição idempotente, correção justificada, recusa sem descarga, aviso persistente ao Armazém e reconhecimento.
3. Pessoas: cadastro/inativação, presença prevista/presente/utilizada, atividades por local/recebimento, vínculo financeiro único diário, transferência auditada, cálculo individual versionado e reconciliação dos centavos, consulta por período e RH com procedência/qualidade.
4. Conferência: quantidades declaradas/observadas/aceitas/recusadas por item, linhas manuais identificadas, divergência decidida por Compras, pedido/saldo somente quando confirmado, atraso/ausência/assistido/sem aviso, sem penalidades automáticas.
5. Gestão: custo por armazém responsável e atividades por local sem duplicar parcelas, presença/produção/piso/complemento/cobertura, tempos reais dos quatro eventos, uso de equipamento sem percentuais inventados, cenários condicionais, impressão/exportação.
6. Diferenciais posteriores ao núcleo: calendário diário/semanal, assistente de consulta com contexto autorizado, email, Google Agenda de saída, resumos, WhatsApp oficial configurado, OCR sugerido, assinatura vinculada à revisão, tutorial, prontidão manual e meteorologia informativa. Integrações desabilitadas sem configuração; não simular sucesso.

## Contratos e validação

Contratos ampliados em `/api/v2`, com serviços compartilhados e v1 compatível somente com registros legados. Cliente antigo deve receber impedimento explícito para registros novos incompatíveis. Novos endpoints têm permissões explícitas e mutações transacionais/revisionadas.

Migrações serão exercitadas em cópia isolada; contagens, IDs, anexos e snapshots existentes devem permanecer preservados. Testes PostgreSQL incluem regras, concorrência, referências financeiras (918,1952 / 991,9041 / 73,7089), meia diária, produção zero/acima do piso, pessoa em dois locais sem duplicar custo, arredondamento independente da ordem e proteção dos endpoints de remuneração. Interface, navegador e Android são verificados separadamente; aparelho físico e iOS só podem ser declarados quando efetivamente executados.

## Limites

Sem WMS completo, escrita no SAP, transporte entre filiais, pagamento bancário, CRM comercial genérico ou penalidades por ausência de trabalhador. Novas políticas para regras pendentes exigem resposta dos stakeholders; os demais fluxos podem avançar.

## Evidências desta implementação

Implementação local em Django/PostgreSQL, Angular/Ionic e Android. O contrato novo está em `/api/v2`; mutações v1 incompatíveis recebem impedimento explícito. O índice da [documentação v2](README.md) reúne API, relatório, indicadores, UML, BPMN, DER e roteiro.

| Frente | Implementado |
|---|---|
| Agenda e Pacheco | MultiNF com uma reserva; identidade documental validada; origem derivada; máquina exclusiva; seletor único revalidado; ações por perfil/etapa; exceções em menu próprio |
| Portaria | Placas e transportadora, anexos vinculados, entrada/saída da unidade, visitas sequenciais por armazém, correções justificadas, repetição idempotente, avisos persistidos com ciência |
| Pessoas e boletins | Pessoa/data única, atividade multilocal, boletim responsável explícito, transferências auditadas, serviços de diária, parcelas exatas/centavos, pendências que bloqueiam fechamento, extrato e RH separados e paginados |
| Conferência | Itens XML/manuais, quatro quantidades, divergência decidida por Compras, saldo de pedido confirmado, complemento, nova solicitação vinculada após rejeição |
| Gestão | Parcelas reconciliadas, presença e uso distintos, custo versus atividade, quatro marcos, cobertura, cenários condicionais, CSV e impressão |
| Evolução preparada | Calendário diário/semanal, prontidão, assinatura vinculada à revisão, histórico de fornecedor, tutorial, adaptadores de IA/OCR/clima/email/Google/WhatsApp com disponibilidade explícita |

Os serviços externos estão desligados por padrão. A implementação dos adaptadores foi exercitada com respostas controladas; contas, credenciais, OAuth, templates e agendamento periódico precisam ser configurados e homologados antes da ativação. Não houve envio real nem publicação. Consulte [integrações](v2/integracoes.md).

As exceções de remuneração sem regra aprovada continuam pendentes por desenho. A interface não apresenta sua prévia como apuração definitiva. Legados fechados são consultáveis, preservam snapshots e não recebem parcelas retroativas; conflitos de pessoa/data são identificados para reconciliação.

Validação automatizada final do backend: **187 testes PostgreSQL**, Ruff, Django check e consistência de migrations aprovados. Migração até `receiving/0006` em cópia isolada: **37 tabelas e 130.761 registros anteriores preservados** por hashes de todas as colunas originais. O banco operacional não recebeu migrations ou dados de demonstração.

Jornada HTTP: duas notas, carga exclusiva, dois armazéns, quatro marcos, pessoa em dois locais, um boletim financeiro e diferença de conciliação `0.00`. Um segundo fechamento financeiro da mesma pessoa/data foi recusado. Recebimento e snapshot financeiro permaneceram idênticos após reiniciar a API.

Os comandos e resultados de interface, emulador e limitações de plataforma estão no [registro de validação](validacao.md). APK de homologação: versão `2.0.0-rc1`/código `3`, apontando para API local; não é o APK publicado no servidor. A publicação compatível de backend, web e APK permanece condicionada ao aceite conjunto previsto no plano.
