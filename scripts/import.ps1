param([string]$PrivateDataPath, [switch]$DryRun)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$taskArgs = @('backend/manage.py', 'import_private')
if ($PrivateDataPath) { $taskArgs += @('--path', $PrivateDataPath) }
if ($DryRun) { $taskArgs += '--dry-run' }
& 'backend/.venv/Scripts/python.exe' @taskArgs
if ($LASTEXITCODE -ne 0) { throw "Importação falhou (exit $LASTEXITCODE)." }
