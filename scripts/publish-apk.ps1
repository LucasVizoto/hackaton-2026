param(
    [Parameter(Mandatory)][string]$ApkPath,
    [string]$SshHost = 'contabo'
)
$ErrorActionPreference = 'Stop'
$taskApk = (Resolve-Path -LiteralPath $ApkPath).Path
$taskName = [IO.Path]::GetFileName($taskApk)
if ($taskName -notmatch '^cocapec-[a-f0-9]{12}\.apk$') { throw 'Use the versioned APK from build-release.ps1.' }
$taskChecksum = "$taskApk.sha256"
$taskHash = (Get-FileHash -LiteralPath $taskApk -Algorithm SHA256).Hash.ToLowerInvariant()
if ((Get-Content -LiteralPath $taskChecksum -Raw).Trim() -ne "$taskHash  $taskName") { throw 'APK checksum mismatch.' }
function Invoke-Checked {
    $taskExecutable = $args[0]
    $taskArguments = $args[1..($args.Count - 1)]
    & $taskExecutable @taskArguments
    if ($LASTEXITCODE -ne 0) { throw "Failed: $taskExecutable ($LASTEXITCODE)." }
}
Invoke-Checked ssh -o BatchMode=yes -o StrictHostKeyChecking=yes $SshHost 'install -d -o cocapec -g cocapec -m 750 /srv/cocapec/shared/downloads'
Invoke-Checked scp $taskApk $taskChecksum "${SshHost}:/srv/cocapec/shared/downloads/"
Invoke-Checked ssh $SshHost "cd /srv/cocapec/shared/downloads && sha256sum -c $taskName.sha256 && chown cocapec:cocapec $taskName $taskName.sha256 && install -d -o cocapec -g cocapec -m 755 /srv/cocapec/current/frontend/dist/browser/downloads && install -o cocapec -g cocapec -m 644 $taskName $taskName.sha256 /srv/cocapec/current/frontend/dist/browser/downloads/"
Write-Output "https://cocapec.lucasvizoto.com/downloads/$taskName"
Write-Output "SHA256: $taskHash"
