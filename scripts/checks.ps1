$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
function Invoke-Checked {
    param([string]$Command, [Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Falha em $Command (exit $LASTEXITCODE)." }
}
Invoke-Checked 'docker' @('compose', 'config', '--quiet')
Invoke-Checked 'backend/.venv/Scripts/ruff.exe' @('check', 'backend')
Invoke-Checked 'backend/.venv/Scripts/python.exe' @('backend/manage.py', 'check')
Invoke-Checked 'backend/.venv/Scripts/python.exe' @('backend/manage.py', 'makemigrations', '--check', '--dry-run', '--noinput')
Invoke-Checked 'backend/.venv/Scripts/python.exe' @('backend/manage.py', 'migrate', '--check')
Invoke-Checked 'backend/.venv/Scripts/python.exe' @('backend/manage.py', 'test', 'core', 'receiving', 'labor', 'analytics', 'imports', '--noinput')
Push-Location -LiteralPath 'frontend'
try {
    Invoke-Checked 'npm.cmd' @('run', 'lint')
    Invoke-Checked 'npm.cmd' @('test')
    Invoke-Checked 'npm.cmd' @('run', 'build')
    Invoke-Checked 'npx.cmd' @('cap', 'sync', 'android')
} finally { Pop-Location }
