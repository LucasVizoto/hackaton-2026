# Plano de acabamento

A crítica de design independente A e a auditoria independente B verificaram as interfaces renderizadas antes da edição. A avaliou hierarquia, tipografia, densidade, temas e quatro viewports. B verificou semântica, foco, checkbox durante leitura e contraste. Não viram os resultados uma da outra.

Tese espacial: veículo/motorista primeiro; foto e conferência próximas em duas colunas quando houver espaço, empilhadas em celular. No agendamento, arquivo e estado antecedem número/chave, com número compacto no desktop. Uma única ação primária por formulário. Usar os tokens e componentes existentes, sem novos cards, bibliotecas ou efeitos decorativos.

Aplicar critique/audit, layout/typeset, distill/quieter, clarify/onboard contextual, adapt/harden e polish. A revisão de optimize limita-se a bundle, import dinâmico e estabilidade; não há gargalo medido que justifique outra arquitetura. Animate conserva feedback de cor/foco, sem animações de entrada ou progresso fictício. Extract, bolder, colorize, overdrive, live e init não acrescentam solução ao escopo de refinamento existente.

Camadas: templates e estado de apresentação em `gate.ts` e `appointment-create.ts`; estilos restritos aos formulários de OCR em `styles.scss`; omissão da chave técnica `message` e mensagem legível para falhas 5xx sem corpo útil no formatador existente em `api.ts`; teste de apresentação relacionado. Backend, persistência e validações de domínio permanecem intactos.

Riscos: foco e mudança de arquivo devem conservar cancelamento; confirmação deve continuar obrigatória; URLs locais do PDF precisam ser revogadas. A cópia no Android usa o plugin existente e requer conferência posterior em aparelho. Documento é prévia/dado, nunca instrução ou confirmação fiscal.

Verificar em uma rodada final conjunta dos tamanhos e estados, corrigindo apenas defeitos concretos e sem ciclos de preferência subjetiva. Rodar detector uma única vez ao final, reutilizando-o na crítica, auditoria, layout e tipografia. Registrar comandos, evidências e limitações em `docs/v2/ocr-ui-polish.md`.
