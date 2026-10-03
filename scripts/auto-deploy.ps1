param(
    [switch]$Deploy,
    [ValidatePattern('^([a-f0-9]{40})?$')][string]$ReviewedCommit = '',
    [string]$SshHost = 'contabo'
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskPrivate = Join-Path $taskRoot '.private/auto-deploy'
$taskCheckout = Join-Path $taskPrivate 'checkout'
$taskStatePath = Join-Path $taskPrivate 'state.json'
$taskOriginalLocation = Get-Location
New-Item -ItemType Directory -Path $taskPrivate -Force | Out-Null
try {
    $taskLock = [IO.File]::Open((Join-Path $taskPrivate 'run.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
} catch [IO.IOException] {
    Write-Output '{"status":"busy","changed":false}'
    return
}
function Invoke-Checked {
    $taskExecutable = $args[0]
    $taskArguments = $args[1..($args.Count - 1)]
    & $taskExecutable @taskArguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed: $taskExecutable (exit $LASTEXITCODE)." }
}
function Save-State {
    $taskState.updatedAt = [DateTime]::UtcNow.ToString('o')
    $taskTemporaryState = "$taskStatePath.next"
    $taskState | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $taskTemporaryState -Encoding utf8NoBOM
    Move-Item -LiteralPath $taskTemporaryState -Destination $taskStatePath -Force
}
function Invoke-Remote([string]$Command) {
    Invoke-Checked ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 $SshHost $Command
}
$taskState = $null
$taskTarget = $null
$taskPrevious = $null
$taskPhase = 'inspect'
try {
    if (!(Test-Path -LiteralPath (Join-Path $taskCheckout '.git'))) {
        Invoke-Checked git clone --no-hardlinks $taskRoot $taskCheckout
        Invoke-Checked git -C $taskCheckout remote set-url origin git@github.com:LucasVizoto/hackaton-2026.git
        Invoke-Checked git -C $taskCheckout config user.name 'Cocapec Deploy'
        Invoke-Checked git -C $taskCheckout config user.email 'deploy@cocapec.local'
    }
    Invoke-Checked git -C $taskCheckout fetch origin
    $taskTarget = (Invoke-Checked git -C $taskCheckout rev-parse origin/main).Trim()
    if (Test-Path -LiteralPath $taskStatePath) {
        $taskState = Get-Content -LiteralPath $taskStatePath -Raw | ConvertFrom-Json -AsHashtable
    } else {
        $taskBase = (Invoke-Checked git -C $taskCheckout merge-base HEAD origin/main).Trim()
        $taskPrevious = (Invoke-Remote 'basename "$(readlink -f /srv/cocapec/current)"').Trim()
        $taskState = @{
            branch = 'main'; lastSuccessfulMain = $taskBase; lastSuccessfulRelease = $taskPrevious
            lastPublishedApkVersionCode = 2; lastPublishedApkMain = $taskBase
            status = 'initialized'; updatedAt = $null
        }
        Save-State
    }
    if ($taskState.lastSuccessfulMain -eq $taskTarget) {
        Write-Output (@{ status = 'unchanged'; changed = $false; mainCommit = $taskTarget } | ConvertTo-Json -Compress)
        return
    }
    if ($Deploy -and $ReviewedCommit -ne $taskTarget) { throw 'Deploy requires the full SHA reviewed by the agent after fetching main.' }
    if (Invoke-Checked git -C $taskCheckout status --porcelain) { throw 'Isolated checkout has pending changes or merge conflicts; review and commit them before deploying.' }
    Invoke-Checked git -C $taskCheckout merge --no-edit origin/main
    $taskIntegration = (Invoke-Checked git -C $taskCheckout rev-parse HEAD).Trim()
    $taskRelease = $taskIntegration.Substring(0, 12)
    $taskChanges = @(Invoke-Checked git -C $taskCheckout diff --name-only $taskState.lastSuccessfulMain $taskTarget)
    $taskApkNeeded = @($taskChanges | Where-Object { $_ -match '^frontend/' }).Count -gt 0 -and $taskState.lastPublishedApkMain -ne $taskTarget
    $taskReview = @{
        status = 'review_required'; changed = $true; mainCommit = $taskTarget
        previousMainCommit = $taskState.lastSuccessfulMain; integrationCommit = $taskIntegration
        release = $taskRelease; checkout = $taskCheckout; apkNeeded = $taskApkNeeded; changedFiles = $taskChanges
    }
    $taskReview | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $taskPrivate 'review.json') -Encoding utf8NoBOM
    if (!$Deploy) { Write-Output ($taskReview | ConvertTo-Json -Depth 5); return }
    $taskPrevious = (Invoke-Remote 'basename "$(readlink -f /srv/cocapec/current)"').Trim()
    if ($taskPrevious -notmatch '^[a-f0-9]{12}$') { throw 'Unexpected current release identity.' }
    $taskState.pendingMain = $taskTarget
    $taskState.pendingRelease = $taskRelease
    $taskState.status = 'running'
    Save-State
    $taskPhase = 'checkpoint'
    Invoke-Remote '/srv/cocapec/current/backend/.venv/bin/python /srv/cocapec/current/scripts/verify_api.py --base-url https://cocapec.lucasvizoto.com/api/v1 --checkpoint'
    $taskApk = $null
    if ($taskApkNeeded) {
        $taskPhase = 'apk_build'
        $taskSigningDirectory = Join-Path $taskRoot '.private/android-release'
        foreach ($taskSigningName in @('cocapec-release.jks', 'signing.json')) {
            if (!(Test-Path -LiteralPath (Join-Path $taskSigningDirectory $taskSigningName))) { throw 'Original release signing material is missing.' }
        }
        $taskApkCode = [int]$taskState.lastPublishedApkVersionCode + 1
        & (Join-Path $taskCheckout 'scripts/build-release.ps1') -PrivateDirectory $taskSigningDirectory -VersionCode $taskApkCode -VersionName "1.1.$($taskApkCode - 2)"
        $taskApk = Join-Path $taskSigningDirectory "cocapec-$taskRelease.apk"
        if (!(Test-Path -LiteralPath $taskApk)) { throw 'Signed APK was not produced.' }
    }
    $taskPhase = 'web_deploy'
    & (Join-Path $taskCheckout 'scripts/deploy.ps1') -SshHost $SshHost
    $taskPhase = 'acceptance'
    Invoke-Remote "/srv/cocapec/current/backend/.venv/bin/python /srv/cocapec/releases/$taskPrevious/scripts/verify_api.py --base-url https://cocapec.lucasvizoto.com/api/v1 --verify-persistence"
    & (Join-Path $taskCheckout 'scripts/verify-deploy.ps1') -SshHost $SshHost -Checkpoint
    if ($taskApk) {
        $taskPhase = 'apk_publish'
        & (Join-Path $taskCheckout 'scripts/publish-apk.ps1') -SshHost $SshHost -ApkPath $taskApk
        $taskState.lastPublishedApkMain = $taskTarget
        $taskState.lastPublishedApkVersionCode = $taskApkCode
        $taskState.lastPublishedApk = "https://cocapec.lucasvizoto.com/downloads/cocapec-$taskRelease.apk"
        $taskState.lastPublishedApkSha256 = (Get-FileHash -LiteralPath $taskApk -Algorithm SHA256).Hash.ToLowerInvariant()
        Save-State
    }
    $taskCurrent = (Invoke-Remote 'basename "$(readlink -f /srv/cocapec/current)"').Trim()
    if ($taskCurrent -ne $taskRelease) { throw 'Current release changed during acceptance.' }
    $taskState.lastSuccessfulMain = $taskTarget
    $taskState.lastSuccessfulRelease = $taskRelease
    $taskState.lastSuccessfulIntegration = $taskIntegration
    $taskState.status = 'succeeded'
    $taskState.failure = $null
    Save-State
    Invoke-Checked scp $taskStatePath "${SshHost}:/srv/cocapec/shared/deployment-state.next.json"
    Invoke-Remote 'chmod 600 /srv/cocapec/shared/deployment-state.next.json && mv /srv/cocapec/shared/deployment-state.next.json /srv/cocapec/shared/deployment-state.json'
    Write-Output (@{ status = 'deployed'; mainCommit = $taskTarget; release = $taskRelease; apk = $taskState.lastPublishedApk } | ConvertTo-Json -Compress)
} catch {
    $taskFailure = $_.Exception.Message
    if ($taskState) {
        $taskState.status = 'failed'
        $taskState.failure = @{ commit = $taskTarget; phase = $taskPhase; message = $taskFailure }
        Save-State
    }
    if ($taskPrevious -and $taskPhase -in @('web_deploy', 'acceptance', 'apk_publish')) {
        try { Invoke-Remote "bash /srv/cocapec/releases/$taskPrevious/deploy/rollback.sh /srv/cocapec/releases/$taskPrevious" } catch { Write-Warning 'Rollback could not be verified; inspect schema compatibility and repair forward.' }
    }
    throw $taskFailure
} finally {
    Set-Location -LiteralPath $taskOriginalLocation.Path
    $taskLock.Dispose()
}
