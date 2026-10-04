# Acabamento dos fluxos de leitura de notas

Modo de superfície: Operate. Escopo: `/portaria/avisos` e a etapa de notas de `/agenda/novo`, preservando DESIGN.md e a implementação funcional.

- FR-001: agrupar documento, estado, identificadores e conferência; reduzir repetição e rolagem sem esconder instruções fiscais ou ações existentes.
- FR-002: manter labels claros, indicação de obrigatoriedade, ajuda/erros associados e anúncios de leitura, resultado e falha. A escolha de preenchimento manual deve focar o número.
- FR-003: impedir conferência antecipada durante a leitura na Portaria. Troca/remoção deve cancelar a espera, preservar veículo/motorista e descartar respostas antigas.
- FR-004: permitir conferir o PDF selecionado na web; no Android, reutilizar o salvamento privado de anexos para uma cópia, com nome de ação correspondente.
- FR-005: preservar validações, diferenças de zeros, chave opcional, permissões, contratos, uploads, reserva e persistência. Nenhum mock entra no código de produto.

## Critérios de aceite

- SC-001: ambas as telas funcionam em 1440×900, 1280×720, 768×1024 e 390×844, sem overflow horizontal, com ações alcançáveis e temas claro/escuro coerentes.
- SC-002: loading, leitura parcial, erro, confirmação e edição manual são distinguíveis e anunciados; foco permanece útil e não é roubado por respostas automáticas.
- SC-003: XML/PDF textual continuam locais; foto/PDF escaneado usam o serviço existente; cancelamento/edição continuam protegidos. QA usa transporte local, sem chamadas pagas.
- SC-004: testes frontend, typecheck, lint, build e revisão mecânica/visual passam. Dados de uma chegada sintética salva são relidos em banco isolado.

## Fora de escopo (Out of Scope)

Redesign global, novas regras fiscais, APIs/backend, permissões, comparação paga, deploy, commit, push, reformulação de tabelas/listagens e homologação de aparelho físico.
