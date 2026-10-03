# Deploy Contabo

Aplicação: https://cocapec.lucasvizoto.com. SSH usa o alias `contabo` e root por chave. PostgreSQL 17, Gunicorn e Caddy são controlados exclusivamente pelo Supervisor; systemd inicia o Supervisor no boot.

## Primeira instalação

Use um checkout limpo e commitado, PowerShell 7 e o pacote privado completo. Configure o registro A no Cloudflare sem proxy para a emissão inicial do certificado. O plugin Cloudflare é responsável pelo DNS e pelas regras do hostname; os scripts não armazenam tokens Cloudflare.

```powershell
.\scripts\deploy.ps1 -Provision -UploadPrivateData -PrivateDataPath 'C:\pasta-privada\DADOS_HACKATHON_2026'
```

O script transfere somente o commit e o pacote privado separado, valida SHA-256, testa em banco separado e bloqueia a publicação em caso de falha. O backend usa `config.settings_production`; segredos, fontes, anexos e relatórios ficam em `/srv/cocapec/shared`. A senha nova das cinco contas demo está em `/srv/cocapec/shared/credentials.json`, legível somente por root. Nunca copie esses arquivos para Git ou para o diretório público.

O certificado deve estar válido antes de ativar o proxy Cloudflare. Configure `ssl=strict` e `rocket_loader=false` por hostname; bypass de cache para `/api/*`. A zona global e outros sites permanecem com suas configurações próprias.

```powershell
ssh contabo 'bash /srv/cocapec/current/deploy/firewall.sh cloudflare'
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes contabo 'id; systemctl stop cocapec-firewall-rollback.timer'
```

A política permite 22/80 e 443 somente para as redes Cloudflare, com rollback da regra em 120 segundos caso a nova conexão SSH não seja validada.

## Atualização e operação

```powershell
.\scripts\deploy.ps1
ssh contabo 'supervisorctl status'
ssh contabo 'supervisorctl restart cocapec-api'
ssh contabo 'supervisorctl tail cocapec-api'
ssh contabo 'supervisorctl tail cocapec-postgres'
```

Cada release fica em `/srv/cocapec/releases/<commit>` e `current` aponta para a ativa. Atualizações testam antes da breve parada da API para migrations. Fontes históricas não são reimportadas automaticamente e senhas existentes não são alteradas. Em caso de falha durante migrations, mantenha a API parada até corrigir a causa.

```powershell
ssh contabo 'bash /srv/cocapec/current/deploy/rollback.sh /srv/cocapec/releases/COMMIT_COMPATIVEL'
```

Rollback troca somente o código e recusa schema com migrations desconhecidas. Não restaura banco. Backups foram excluídos do escopo do hackathon.

Os logs do Supervisor ficam em `/var/log/cocapec`, com 20 MB e cinco arquivos anteriores. O acesso Caddy fica em `/var/log/caddy`; Authorization e cookies são redigidos pelo padrão do servidor. Após atualizar o pacote Caddy, reaplique `setcap cap_net_bind_service=+ep /usr/bin/caddy` antes de reiniciá-lo. A configuração das redes confiáveis pode ser atualizada executando novamente o provisionamento durante manutenção.

## Android

```powershell
.\scripts\build-release.ps1
.\scripts\publish-apk.ps1 -ApkPath '.private/android-release/cocapec-COMMIT12.apk'
```

O script prepara JDK 21 com checksum e um checkout isolado do commit, usa SDK 36, gera assinatura privada fora do Git, configura HTTPS somente no build ignorado e produz APK e SHA-256 em `.private/android-release`. Conserve a chave e seu arquivo de senhas para atualizar versões futuras. O APK release não atualiza instalações com assinatura debug; use uma instalação de QA separada. A API remota dispensa `adb reverse`.

## Aceite

```powershell
.\scripts\verify-deploy.ps1 -Checkpoint
.\scripts\verify-deploy.ps1 -VerifyPersistence
```

Confira health externo, login e isolamento dos cinco perfis, downloads privados, seed idempotente e o boletim histórico de 17/11/2025. Execute `scripts/verify_api.py --base-url https://cocapec.lucasvizoto.com/api/v1 --checkpoint` no servidor e repita com `--verify-persistence` após reiniciar serviços e após reboot. Não publique o checkpoint nem os relatórios privados.

Valide o APK assinado no emulador: login remoto, chegada refletida na web, download pelo seletor Android, erro quando a API estiver indisponível e persistência após reinício. Play Store e aparelhos físicos não fazem parte deste aceite.

O teste de recuperação provoca a saída de cada processo, um por vez, e exige um novo PID em estado `RUNNING`. Execute durante manutenção, depois de registrar o checkpoint. Ele interrompe brevemente a API e o banco.

```powershell
ssh contabo 'bash /srv/cocapec/current/deploy/verify-recovery.sh'
ssh contabo '/srv/cocapec/current/backend/.venv/bin/python /srv/cocapec/current/scripts/verify_api.py --base-url https://cocapec.lucasvizoto.com/api/v1 --verify-persistence'
```

Após reboot, confira `supervisorctl status`, health público, checkpoint e anexos. O socket de controle do Supervisor é restrito ao root. Use conexões SSH novas com `BatchMode=yes` e `StrictHostKeyChecking=yes` para verificar o acesso por chave.

## Artefatos desta entrega

- Web: https://cocapec.lucasvizoto.com/login.
- APK: https://cocapec.lucasvizoto.com/downloads/cocapec-3c0af419027d.apk.
- SHA-256: `d8128e1b2b303c13a2b0d1c0921d01375f0ca9559fd3f89e915ca41bbd56dedf`.
- Credenciais locais: `.private/deploy/credentials.json`; no servidor: `/srv/cocapec/shared/credentials.json`.
- Chave de assinatura: `.private/android-release/cocapec-release.jks`; senhas: `.private/android-release/signing.json`. Esses arquivos privados ficam fora do Git e são necessários para atualizar o APK.
- Relatórios privados e inventário das ferramentas: `/srv/cocapec/shared/reports`.

O APK registra o commit `3c0af419027d`. As mudanças posteriores nesta entrega corrigem bootstrap, publicação e verificadores do backend, sem alterar o código Angular ou Android incluído nesse APK. O pacote histórico contém 938 arquivos e 460 anexos de notas, conferidos por SHA-256. A reexecução do baseline preserva os registros existentes.

## Resultado do aceite em 03/10/2026

A VPS executa a release `c8da9d2632f9`. Lint, build e 17 testes Angular passaram; o backend passou em 108 testes PostgreSQL isolados, checks de produção e consistência de migrations. O health HTTPS consulta PostgreSQL e retorna 200; HTTP redireciona com 308. As cinco contas, isolamento dos fornecedores, CORS, cache privado e anexos autenticados foram conferidos pelo proxy Cloudflare.

O boletim histórico retornou produção `918.1952`, total `991.9041` e complemento `73.7089`. No emulador separado `Cocapec_Deploy_36`, o APK fez login sem `adb reverse`, registrou a chegada sintética `DEMO-PEND-01` e salvou `SYN-001.xml` pelo seletor Android. O SHA-256 do arquivo salvo corresponde ao anexo da API. A chegada aparece na web. Com a API parada, a tentativa exibiu erro e manteve a revisão e a chegada do registro sem alteração.

Após saída provocada de cada processo, o Supervisor iniciou novos PIDs. Após reboot real da VPS, os três programas voltaram a `RUNNING`; checkpoint HTTP, chegada, 938 hashes de fontes e 460 anexos permaneceram válidos. Firewall, capability do Caddy e SSH por chave também foram conferidos após o boot.

A auditoria npm registrou 15 alertas nas dependências de build (2 críticos, 9 altos, 3 moderados e 1 baixo). `npm audit --omit=dev` retornou zero alertas. Os relatórios estão em `/srv/cocapec/shared/reports/npm-audit-all.json` e `npm-audit-runtime.json`; a correção dos pacotes de build deve ser feita com atualização do lockfile e novos testes.

## Atualização automática de main

A branch principal remota é `main`; `master` não existe neste repositório. A automação Codex deste chat verifica a cada 15 minutos. Ela executa neste computador, que precisa estar ligado, conectado e com o Codex ativo. A VPS continua servindo a última release mesmo quando o computador está indisponível.

O controlador `scripts/auto-deploy.ps1` usa um clone separado em `.private/auto-deploy/checkout`. Ele integra a configuração de produção com novos commits de `origin/main`, sem trocar a branch do checkout de desenvolvimento. O SHA de origem e o commit da release integrada são registrados separadamente. O agente deve ler o diff e analisar dependências, migrations, dados, configurações e Android antes de aprovar o SHA exato para execução.

```powershell
.\scripts\auto-deploy.ps1
.\scripts\auto-deploy.ps1 -Deploy -ReviewedCommit SHA_COMPLETO_ANALISADO
```

Uma trava local e `flock` na VPS impedem deploys simultâneos. A publicação exige build, lint, testes, checks Django, migrations consistentes e aceite HTTPS. O banco recebe migrations do código novo; fontes, anexos e credenciais permanecem persistentes. Com a API parada para manutenção, um checkpoint de hashes das identidades dos registros confere sua preservação durante migrations, sem armazenar conteúdos de linhas. Isso evita confundir gravações legítimas feitas durante o build com perda de dados. Migrations que mudem tabelas ou chaves existentes exigem adaptação explícita e validada do mapeamento de identidades. O SHA só avança no estado de sucesso quando o aceite passa.

Mudanças em `frontend` também geram APK com a chave de assinatura existente, API HTTPS e `versionCode` crescente. APKs anteriores permanecem disponíveis. Cada publicação usa URL por commit, com SHA-256. O build reutiliza `.private/android-release` do checkout principal, evitando trocar a assinatura em clones separados.

O estado local fica em `.private/auto-deploy/state.json`, e o estado aceito é publicado privadamente em `/srv/cocapec/shared/deployment-state.json`. Em falha de publicação, o controlador tenta reversão compatível do código; incompatibilidade de schema exige correção para frente, sem recriar ou restaurar o banco. Mantenha relatórios e segredos privados. A automação comunica deploy concluído, falha ou necessidade de intervenção e fica silenciosa sem novos commits.
