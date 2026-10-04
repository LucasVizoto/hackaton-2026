# Correções da revisão do OCR

Usuários da Portaria e do cadastro de notas precisam de sugestões legíveis e de uma alternativa manual quando a leitura falhar. Este escopo corrige os três defeitos restantes da revisão de 04/10/2026 e registra a decisão posterior do usuário sobre consumo do modelo.

- FR-001: o script de avaliação deve passar pelo Ruff usado em `deploy/verify-backend.sh` e funcionar com `--help` sem chamar o provedor.
- FR-002: a cópia de análise deve compor transparência sobre branco antes da conversão RGB, preservando texto preto e os bytes do original.
- FR-003: PDFs enviados à OpenAI devem ter estrutura e páginas válidas. Conteúdo malformado, documento sem páginas e arquivo criptografado devem retornar 400 antes da construção do cliente. O PDF completo válido continua sendo enviado intacto.
- FR-004: por instrução posterior do usuário, a aplicação não deve enviar teto de tokens nem esforço baixo; deve usar os parâmetros padrão do modelo, mantendo timeout de 60 segundos e zero repetições automáticas. A documentação deve distinguir essa configuração da amostra anterior que levou cerca de quatro segundos com limites.
- FR-005: a correção deve manter contrato, permissões, conferência humana e preenchimento manual; não deve criar registros de domínio durante a leitura. A verificação desta etapa não fará chamadas pagas.

## Critérios de aceite

- SC-001: os testes de regressão verificam os pixels da cópia, os bytes originais, a rejeição local dos PDFs inválidos e a ausência de teto/esforço no payload serializado pelo SDK.
- SC-002: Ruff de backend/scripts/deploy, Django check, consistência de migrations e testes direcionados passam. O parser instala em Python 3.14 no Windows e no ambiente Linux de produção.
- SC-003: no navegador, a leitura de uma imagem transparente conserva a prévia e exige confirmação; falha mantém o arquivo e permite edição manual. Transporte do provedor exclusivamente local e sintético.

## Out of Scope

Redesign, mudanças de frontend ou permissões, gravação de notas/chegadas na verificação, deploy, ativação da flag, novas chamadas pagas, comparação de 100 documentos e homologação de câmera/Android físico.
