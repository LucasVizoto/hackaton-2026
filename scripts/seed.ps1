param([string]$PrivateDataPath, [switch]$DryRun, [string]$Report)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$taskArgs = @('backend/manage.py', 'seed_hackathon')
if ($PrivateDataPath) { $taskArgs += @('--path', $PrivateDataPath) }
if ($DryRun) { $taskArgs += '--dry-run' }
if ($Report) { $taskArgs += @('--report', $Report) }
& 'backend/.venv/Scripts/python.exe' @taskArgs
if ($LASTEXITCODE -ne 0) { throw "Seed falhou (exit $LASTEXITCODE)." }
