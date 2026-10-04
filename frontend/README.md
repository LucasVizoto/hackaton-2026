# Aplicação web e contêiner Android

Angular 20.3 + Ionic 8 + Capacitor 8, uma base de código. API Django `/api/v1`, sem mocks. Valores e regras são retornados pelo backend.

```powershell
Set-Location C:\Projects\hackaton-2026\frontend
npm ci
npm start
# http://localhost:4200; proxy para a API na porta 8000
npm run lint
npm test
npm run build
npm run android:sync
```

O login usa contas criadas pelo seed local, com senha definida privadamente em `.env`. O token existe somente em memória; recarga pede novo login. A API preserva os dados.

Rotas: `/agenda`, `/agenda/novo`, `/agenda/:id`, `/compras`, `/operacao`, `/nao-recebimentos`, `/nao-recebimentos/:id`, `/boletins`, `/boletins/novo`, `/boletins/:id`, `/descarga`, `/dashboard`, `/gestao/logistica`, `/gestao`, `/qualidade`. Os perfis vêm do servidor, sem seletor visual de permissão.

Dashboard é um módulo próprio no menu, disponível para Gestão, Armazém, Compras e administrador. No celular aparece na navegação principal de Gestão, Compras e administrador. Armazém mantém Agenda, Descarga e Equipe na barra principal e acessa Dashboard em Mais. Gestão fica em Mais, com Logística e Entregas, Chegadas e Não recebimentos. O endereço antigo `/gestao` redireciona para `/dashboard`.

O componente `Dashboard` fica em `src/app/features/dashboard.ts` e é carregado sob demanda pela rota `/dashboard`. Reutiliza os componentes de gráficos e consulta os indicadores financeiros e operacionais da API existente.

Criar recebimento: anexo privado, data/horário, acondicionamento. Detalhe: decisões independentes, destinos/etapas, chegada, entrada, conclusão/recursos, cancelamento com retenção e atribuição explícita, reagendamento por natureza. Boletim: 14 categorias, três modalidades, matrículas/frações, prévia da API, rascunho, fechamento e reabertura com motivo. Dashboard: filtros por origem/período/local e cenários condicionais.

Os exemplos preenchem apenas matrículas sintéticas e quantidades de referência; o cálculo é feito por `bulletins/preview/`. O painel usa operação registrada por padrão e separa `demo_sintetico`.

Última conferência registrada: lint, sete testes de apresentação e build Angular passaram. A rolagem no contêiner Android permite alcançar Salvar com gesto. Gestão exibe os links de origem autorizados e sinaliza quando o limite de 100 registros por conjunto é atingido, sem reduzir os totais.

Android: consulte [mobile/README.md](../mobile/README.md). Build, testes locais e instrumentação agregada passaram em AVD. O APK atual passou em login, consulta e chegada refletida na web; o checkpoint posterior manteve os registros após reiniciar API/PostgreSQL. Com a API desligada, a tentativa de entrada mostrou erro sem gravar sucesso; a asserção Maestro do alerta falhou porque a hierarquia WebView o omitiu, embora a inspeção visual o mostrasse. O anexo pelo SAF foi conferido em rodada anterior. O [relatório](../docs/validacao.md) delimita cada evidência. `public/runtime-config.json` configura a API nativa; o padrão exige `adb reverse tcp:8000 tcp:8000` após instrumentação/instalação. O Capacitor usa `loggingBehavior: 'none'`. HTTP é exclusivo de desenvolvimento. iOS permanece NOT RUN sem Mac/Xcode. Nenhum aparelho físico foi testado. Não é entrega pronta para produção.
