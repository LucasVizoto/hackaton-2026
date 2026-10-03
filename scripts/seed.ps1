$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
& 'backend/.venv/Scripts/python.exe' 'backend/manage.py' 'seed_demo'
if ($LASTEXITCODE -ne 0) { throw "Seed falhou (exit $LASTEXITCODE)." }
