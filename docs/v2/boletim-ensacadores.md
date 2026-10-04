# Boletim dos ensacadores e consulta da Gestão

## Contrato Python

`backend/labor/bulletin.py` contém contratos imutáveis com `dataclasses`, enums e `Decimal`. O serviço não depende de HTTP nem exige acesso ao banco. As tarifas padrão vêm de `labor.constants.PRICES`; tarifas explicitamente fornecidas devem conter as mesmas 14 categorias. Os adaptadores persistidos continuam usando os preços preservados em cada lançamento.

```python
from datetime import date
from decimal import Decimal
from labor.bulletin import (
    BoletimCalculator, BoletimDiario, Categoria, MembroEquipe,
    Modalidade, Movimentacao,
)

boletim = BoletimDiario(
    armazem="ADUBO",
    data=date(2026, 10, 3),
    movimentacoes=(
        Movimentacao(Categoria.FERTILIZANTES, Modalidade.DESCARGA, Decimal("2778")),
        Movimentacao(Categoria.AGROQUIMICO, Modalidade.DESCARGA, Decimal("30")),
        Movimentacao(Categoria.SERVICOS_DIVERSOS, Modalidade.DESCARGA, Decimal("40")),
    ),
    equipe=tuple(
        MembroEquipe(str(i), f"D{i:03}", f"Pessoa sintética {i}", Decimal("1"))
        for i in range(1, 12)
    ),
)
resultado = BoletimCalculator().calcularBoletim(boletim)
assert resultado.producaoTotal == Decimal("918.20")
assert resultado.totalAPagar == Decimal("991.90")
assert resultado.exatos.producaoTotal == Decimal("918.1952")
assert resultado.exatos.totalAPagar == Decimal("991.9041")
```

As modalidades são descarga (`unloading`), remoção (`removal`) e transferência (`transfer`). O contrato rejeita números de ponto flutuante, quantidades negativas ou não finitas, categorias/modalidades desconhecidas, identificadores ou matrículas repetidos, mais de 20 pessoas e pesos diferentes de `Decimal("1")` ou `Decimal("0.5")`. Quantidades e tarifas devem ser `Decimal`, construídos a partir de strings.

`ResultadoBoletim` oferece os seis campos abaixo como valores `Decimal` (ou `None` nos dois valores por diária quando não há equipe). `exatos` preserva a memória anterior ao arredondamento, incluindo o piso coletivo. `resumo()` serializa os seis campos como strings.

| Campo | Exibição do exemplo | Valor antes do arredondamento |
|---|---:|---:|
| `producaoTotal` | 918.20 | 918.1952 |
| `diariasEquivalentes` | 11 | 11 |
| `valorPorDiariaApurado` | 83.47 | 83.4722909090… |
| `totalAPagar` | 991.90 | 991.9041 |
| `complemento` | 73.71 | 73.7089 |
| `valorFinalPorDiariaCompleta` | 90.17 | 90.1731 |

## Precisão, persistência e API

`calculate_totals` é o núcleo comum a `BoletimCalculator`, `calculate` e `calculate_v2`. A comparação com o piso usa valores sem arredondamento monetário intermediário. O contexto decimal tem 40 algarismos de precisão; divisões periódicas são representadas nessa precisão. A apresentação utiliza duas casas e `ROUND_HALF_UP`.

Meia diária de uma pessoa tem peso 0,5 e recebe metade da diária completa final. O piso exato dessa participação é 45,08655. A tarifa 45,0786 da **linha de serviço Meia Diária** continua independente: não altera a fração da pessoa nem é adicionada automaticamente à sua remuneração. Linhas de serviço e fontes adicionais de produção da v2 permanecem no subtotal.

`DailyBulletin`, `BulletinLine`, `BulletinParticipant`, `WorkerDay` e `IndividualAllocation` permanecem como entidades persistidas. Mantêm-se um boletim por armazém/data e um vínculo financeiro por pessoa/data, o rateio por maiores restos e o desempate estável por identificador. A soma das parcelas em centavos reconcilia com o total coletivo. Equipe vazia é permitida em rascunho; o fechamento permanece bloqueado.

As consultas de lista/detalhe da API v2 incluem `calculation.resumo`. A prévia retorna `resumo` junto aos demais campos do cálculo. Exemplo:

```json
{
  "producaoTotal": "918.20",
  "diariasEquivalentes": "11",
  "valorPorDiariaApurado": "83.47",
  "totalAPagar": "991.90",
  "complemento": "73.71",
  "valorFinalPorDiariaCompleta": "90.17"
}
```

Os campos anteriores continuam disponíveis. Para boletins fechados, o resumo é uma projeção dos totais do snapshot: não consulta tarifas atuais, não reconstitui parcelas antigas e não grava alterações no snapshot. Nenhuma migração financeira ou nova tabela foi introduzida. O bloqueio de clientes v1 incompatíveis com recebimentos v2 continua retornando HTTP 409.

## Permissões de Gestão

A regra usa o perfil `management`, independentemente do nome de usuário. A navegação e as rotas permitem consultar Compras, Portaria, chegadas, revisões, não recebimentos, boletins, pessoas, RH, documentos, relatórios, integrações e histórico. As permissões de alteração preexistentes não foram ampliadas.

Gestão consulta chegadas de todos os operadores e recebe eventos pelo canal autenticado `/ws/gate/`. A página Revisões filtra exclusivamente `decision=rejected`. A consulta da foto não registra ciência do Armazém; notificações de todos os perfis operacionais ficam disponíveis para leitura, sem reconhecimento pela Gestão. API e interface mantêm os bloqueios para criar agendamento, aprovar, aceitar/recusar chegada, registrar movimentação operacional ou fechar boletim.

O formulário de boletim fica desabilitado para Gestão, mantendo consultas e exportações. Pedidos confirmados, saldos e assinaturas de conferência podem ser consultados. Filtros de consulta continuam utilizáveis.

`GET /api/v2/integrations/ocr/` oferece uma lista paginada de sugestões, com identificador, arquivo, tipo, status, sugestão, autor, data e caminho autorizado do original. Gestão, Compras e Armazém podem consultar; fornecedores não recebem acesso à lista. O original mantém autenticação e autorização. A leitura não depende de um provedor OCR estar habilitado e não concede envio de novos arquivos à Gestão.

## Validação desta implementação

- Backend: **224 testes aprovados** na regressão Django/PostgreSQL, com Redis disponível para os testes de tempo real.
- Contrato: cenário obrigatório, 14 tarifas, três modalidades, meia diária, produção zero/acima do piso, rascunho vazio, validação de entradas, estabilidade do rateio e igualdade entre serviço, prévia, fechamento e consulta.
- Histórico: snapshot sem resumo projetado sem alteração persistida, inclusive após mudança da tarifa atual.
- Gestão: dois usuários distintos nas APIs v1/v2, anexos, OCR, notificações e eventos; mutações indevidas negadas e leitura sem alteração de ciência/reconhecimento.
- Frontend: **36 testes aprovados**, lint e build Angular aprovados. Ruff e verificação de migrações também aprovados; nenhuma migração pendente.
- Android: `assembleDebug` e tarefa `testDebugUnitTest` concluídas. A tarefa de testes Java estava atualizada; não representa novos testes nativos nesta rodada.
- Jornada web com `gestao_demo`: menus, boletim oficial preservado com os seis resultados, formulário desabilitado, chegadas, abertura de foto e revisões filtradas. A foto usada é uma imagem sintética de 1 pixel: a abertura foi verificada, a legibilidade documental não foi avaliada.
- Emulador Android API 36: APK instalado, autenticação e navegação de Gestão verificadas. Aparelho físico e iOS **não executados**.

Esta entrega apura valores, sem executar pagamentos bancários ou deploy de produção. Evidências de QA e credenciais permanecem fora do repositório.
