param(
    [string]$SshHost = 'contabo',
    [string]$PrivateDataPath,
    [switch]$Provision,
    [switch]$UploadPrivateData
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
function Invoke-Checked {
    $taskExecutable = $args[0]
    $taskArguments = $args[1..($args.Count - 1)]
    & $taskExecutable @taskArguments
    if ($LASTEXITCODE -ne 0) { throw "Falha em $taskExecutable (exit $LASTEXITCODE)." }
}
if (git status --porcelain) { throw 'Deploy requires a clean committed checkout.' }
$releaseId = (git rev-parse --short=12 HEAD).Trim()
$taskOutput = Join-Path $taskRoot '.private/deploy'
New-Item -ItemType Directory -Path $taskOutput -Force | Out-Null
$archivePath = Join-Path $taskOutput "cocapec-$releaseId.tar"
Invoke-Checked git archive --format=tar "--output=$archivePath" HEAD
Invoke-Checked ssh -o BatchMode=yes -o StrictHostKeyChecking=yes $SshHost "install -d -m 755 /srv/cocapec/releases/$releaseId"
Invoke-Checked scp $archivePath "${SshHost}:/srv/cocapec/releases/$releaseId/source.tar"
Invoke-Checked ssh $SshHost "tar -xf /srv/cocapec/releases/$releaseId/source.tar -C /srv/cocapec/releases/$releaseId && chmod +x /srv/cocapec/releases/$releaseId/deploy/*.sh"
if ($Provision) { Invoke-Checked ssh $SshHost "bash /srv/cocapec/releases/$releaseId/deploy/provision.sh" }
if ($UploadPrivateData) {
    if (!$PrivateDataPath) {
        $sourceLine = Get-Content -LiteralPath .env | Where-Object { $_ -match '^PRIVATE_DATA_DIR=' } | Select-Object -First 1
        $PrivateDataPath = ($sourceLine -split '=',2)[1]
    }
    $sourceDir = (Resolve-Path -LiteralPath $PrivateDataPath).Path
    $sourceArchive = Join-Path $taskOutput 'private-sources.tar'
    $sourceManifest = Join-Path $taskOutput 'sources-manifest.json'
    $manifest = Get-ChildItem -LiteralPath $sourceDir -File -Recurse | ForEach-Object {
        @{ path = [IO.Path]::GetRelativePath($sourceDir,$_.FullName).Replace('\','/'); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
    }
    $manifest | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $sourceManifest -Encoding utf8NoBOM
    Invoke-Checked tar -cf $sourceArchive -C $sourceDir .
    Invoke-Checked scp $sourceArchive $sourceManifest "${SshHost}:/srv/cocapec/shared/"
    Invoke-Checked ssh $SshHost "tar -xf /srv/cocapec/shared/private-sources.tar -C /srv/cocapec/shared/sources && chown -R cocapec:cocapec /srv/cocapec/shared/sources && chmod -R u=rwX,g=rX,o= /srv/cocapec/shared/sources && python3 /srv/cocapec/releases/$releaseId/deploy/verify-sources.py"
}
Invoke-Checked ssh $SshHost "bash /srv/cocapec/releases/$releaseId/deploy/release.sh /srv/cocapec/releases/$releaseId"
Write-Output "Release: $releaseId"
