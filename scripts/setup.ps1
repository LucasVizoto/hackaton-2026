param([switch]$SeedDemo, [string]$PrivateDataPath)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
function Invoke-Checked {
    param([string]$Command, [Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Falha em $Command (exit $LASTEXITCODE)." }
}
if (-not (Test-Path -LiteralPath '.env')) {
    $taskEnv = Get-Content -LiteralPath '.env.example' -Raw
    foreach ($taskKey in @('DJANGO_SECRET_KEY', 'DB_PASSWORD', 'DEMO_PASSWORD')) {
        $taskSecret = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
        $taskEnv = $taskEnv.Replace("$taskKey=", "$taskKey=$taskSecret")
    }
    Set-Content -LiteralPath '.env' -Value $taskEnv -Encoding utf8
    Write-Host 'Arquivo .env privado criado com segredos aleatórios. Configure PRIVATE_DATA_DIR para importar.'
}
if (-not (Test-Path -LiteralPath 'backend/.venv/Scripts/python.exe')) {
    Invoke-Checked 'uv' @('venv', '--python', '3.14', 'backend/.venv')
}
Invoke-Checked 'uv' @('pip', 'sync', '--python', 'backend/.venv/Scripts/python.exe', 'backend/requirements.lock')
Invoke-Checked 'docker' @('compose', 'up', '-d', '--wait')
$taskBootstrapArgs = @('backend/manage.py', 'bootstrap_database')
if ($PrivateDataPath) { $taskBootstrapArgs += @('--path', $PrivateDataPath) }
Invoke-Checked 'backend/.venv/Scripts/python.exe' $taskBootstrapArgs
Invoke-Checked 'backend/.venv/Scripts/python.exe' @('backend/manage.py', 'check')
if ($SeedDemo) {
    Invoke-Checked 'backend/.venv/Scripts/python.exe' @('backend/manage.py', 'seed_demo')
}
Push-Location -LiteralPath 'frontend'
try { Invoke-Checked 'npm.cmd' @('ci') } finally { Pop-Location }
