param(
    [string]$ApiUrl = 'http://127.0.0.1:8000/api/v2',
    [string]$FrontendUrl = 'http://localhost:4200'
)
$ErrorActionPreference = 'Stop'
try {
    $health = Invoke-RestMethod -Uri "$($ApiUrl.TrimEnd('/'))/health/" -TimeoutSec 10
    if ($health.status -ne 'ok' -or $health.database -ne 'postgresql') { throw 'A API não confirmou acesso ao PostgreSQL.' }
    $page = Invoke-WebRequest -Uri $FrontendUrl -TimeoutSec 10
    if ($page.StatusCode -ne 200 -or $page.Content -notmatch 'app-root') { throw 'O frontend não respondeu com a aplicação Angular.' }
    Write-Output 'API e PostgreSQL: disponíveis. Frontend: disponível.'
    Write-Output 'Complete o ensaio no navegador: login, agenda por perfil, boletim, pessoas, Gestão e reconexão da Portaria. Este check não comprova Redis/WebSocket nem integrações externas.'
} catch {
    Write-Error 'Falha no health-check. Confira os processos de frontend/API, o PostgreSQL e as URLs informadas antes da apresentação.'
    exit 1
}
