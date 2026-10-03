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
```

O script prepara JDK 21 com checksum e um checkout isolado do commit, usa SDK 36, gera assinatura privada fora do Git, configura HTTPS somente no build ignorado e produz APK e SHA-256 em `.private/android-release`. Conserve a chave e seu arquivo de senhas para atualizar versões futuras. O APK release não atualiza instalações com assinatura debug; use uma instalação de QA separada. A API remota dispensa `adb reverse`.

## Aceite

Confira health externo, login e isolamento dos cinco perfis, downloads privados, seed idempotente e o boletim histórico de 17/11/2025. Execute `scripts/verify_api.py --base-url https://cocapec.lucasvizoto.com/api/v1 --checkpoint` no servidor e repita com `--verify-persistence` após reiniciar serviços e após reboot. Não publique o checkpoint nem os relatórios privados.

Valide o APK assinado no emulador: login remoto, chegada refletida na web, download pelo seletor Android, erro quando a API estiver indisponível e persistência após reinício. Play Store e aparelhos físicos não fazem parte deste aceite.
