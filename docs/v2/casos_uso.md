# Casos de uso UML — versão v2

![Atores e responsabilidades](../imagens/casos-uso-v2.svg)

Fonte editável: [casos-uso-v2.drawio](../fontes/casos-uso-v2.drawio). Associações mostram permissões e objetivos; não descrevem ordem temporal. Administrador pode executar as ações autorizadas dos demais perfis; autenticação/perfil válido são pré-condições.

| Ator | Casos de uso implementados |
|---|---|
| Fornecedor | Anexar notas privadas, solicitar/consultar a própria carga com várias notas, corrigir dados permitidos e cancelar antes da descarga |
| Compras | Conferir documentos, aprovar/recusar, registrar pedido confirmado e decidir divergências item a item |
| Portaria | Registrar chegada e saída da unidade; corrigir seus marcos com motivo; informar atraso/ausência/acesso; consultar prontidão local |
| Armazém | Confirmar destinos, registrar visitas e recursos, conferir itens, tratar cancelamento/reagendamento/recusa; registrar atividades, cadastrar/inativar pessoas/equipamentos e fechar/reabrir/transferir boletins |
| Gestão | Consultar custos e parcelas, atividades e cobertura; consultar RH histórico com procedência; comparar períodos/cenários; resolver ocorrência comprovadamente não aplicável |
| Administrador | Ações autorizadas dos perfis, além de administração técnica existente; não se pressupõe novo sistema de IAM completo |

Portaria não consulta pessoas, remuneração nem folha. O fornecedor é isolado pelo vínculo de cadastro. Gestão não altera o boletim operacional por conveniência; a alteração cabe a Armazém/admin. Resolver uma ocorrência não inventa uma regra de fração excepcional.

Conferir uma carga inclui cobrir todas as notas e itens; decisão de divergência por Compras é condicional. A aprovação de Compras e a confirmação dos destinos são condições de início da visita, mas não condições da chegada à Portaria. Finalizar a descarga e registrar saída da unidade são casos distintos.

Uma atividade pode atender diversos locais ao longo do dia; a parcela financeira continua vinculada a um único responsável. Consultar o histórico do RH é um caso distinto de consultar apuração do boletim, sem inferir equivalência ou executar pagamento.

Integrações opcionais não são atores confirmados em operação. O código contém adaptadores/configuração para assistente, OCR, clima e entrega externa, mas disponibilidade depende do ambiente. Os testes locais e os provedores externos têm estados de validação separados em [validacao.md](../validacao.md).
