param(
    [string]$SshHost = 'contabo',
    [switch]$Checkpoint,
    [switch]$VerifyPersistence,
    [switch]$VerifyRecovery
)
$ErrorActionPreference = 'Stop'
if ($Checkpoint -and $VerifyPersistence) { throw 'Choose Checkpoint or VerifyPersistence.' }
function Invoke-Remote([string]$Command) {
    & ssh -o BatchMode=yes -o StrictHostKeyChecking=yes $SshHost $Command
    if ($LASTEXITCODE -ne 0) { throw "Remote verification failed (exit $LASTEXITCODE)." }
}
if ($VerifyRecovery) {
    Invoke-Remote 'bash /srv/cocapec/current/deploy/verify-recovery.sh'
}
$taskStatus = Invoke-Remote 'supervisorctl status'
foreach ($taskProgram in @('cocapec-postgres', 'cocapec-api', 'cocapec-web')) {
    if (!(($taskStatus -join "`n") -match "(?m)^$taskProgram\s+RUNNING\s")) {
        throw "Supervised program is not RUNNING: $taskProgram"
    }
}
Write-Output $taskStatus
$taskApiCheck = '/srv/cocapec/current/backend/.venv/bin/python /srv/cocapec/current/scripts/verify_api.py --base-url https://cocapec.lucasvizoto.com/api/v1'
if ($Checkpoint) { $taskApiCheck += ' --checkpoint' }
if ($VerifyPersistence) { $taskApiCheck += ' --verify-persistence' }
Invoke-Remote $taskApiCheck
Invoke-Remote '/srv/cocapec/current/backend/.venv/bin/python /srv/cocapec/current/deploy/verify-public.py'
Invoke-Remote 'runuser -u cocapec -- /srv/cocapec/current/backend/.venv/bin/python /srv/cocapec/current/deploy/verify-data.py'
Write-Output 'Deployment verification PASS.'
