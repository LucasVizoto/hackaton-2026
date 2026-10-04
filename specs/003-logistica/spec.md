# Logística e Entregas

Gestão, Compras e Armazém precisam acompanhar recebimentos concluídos, entradas de motoristas e veículos aguardando descarga. A página usa registros persistidos, sem dados de demonstração na operação.

## Requisitos

- FR-001: Disponibilizar `/gestao/logistica` a Gestão, Compras, Armazém e administrador, com acesso pela Gestão e retorno à mesma página.
- FR-002: Contar cargas concluídas hoje e apresentar sete dias de conclusões, incluindo hoje e dias com zero observado, no fuso America/Sao_Paulo.
- FR-003: Contar entradas de motoristas identificados hoje por recebimento, sem deduplicar o nome; saída não aumenta o indicador. Informar entradas antigas sem nome excluídas.
- FR-004: Contar veículos com entrada, sem saída, ativos e sem primeira descarga iniciada, incluindo entradas anteriores ao período dos gráficos.
- FR-005: Mostrar cargas por destino nos últimos sete dias. Percentuais usam associações carga–destino, sem confundir esse total com cargas globais. Informar cargas sem destino.
- FR-006: Exigir nome não vazio, até 160 caracteres, nas novas entradas; aceitar nome já cadastrado ou informado no comando. Preservar revisão, idempotência, sequência temporal, eventos e permissões de entrada e saída existentes.
- FR-007: Reutilizar componentes e tokens do produto; oferecer carregamento, vazio, cobertura incompleta, falha recuperável e atualização com última consulta identificada; não converter falha em zero.
- FR-008: Comprovar agregação, autorização, persistência e comportamento da UI por testes e navegador real, em dois temas e tamanhos de tela.

## Out of Scope

Cadastro de visitantes, pessoas únicas, passagens avulsas, reentradas no mesmo recebimento, filtros novos, atualização em tempo real dos indicadores, pagamento, novas tabelas e migrações.

## Aceite

- SC-001: Os três indicadores e dois gráficos correspondem aos registros da API e às regras FR-002 a FR-005.
- SC-002: Entrada salva nome e horário; leitura posterior confirma ambos. Início da descarga reduz a fila; saída é persistida e não duplica entradas.
- SC-003: Falha mantém dados anteriores identificados ou ausência de consulta, e permite repetir. A UI funciona por teclado e em 1440, 820 e 390px, nos temas claro e escuro.
- SC-004: Testes de backend/frontend, lint, build e revisão de coerência passam, com evidência registrada em validation.md.
