param([string]$JavaHome, [string]$AndroidSdk = "$env:LOCALAPPDATA/Android/Sdk")
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskPrivate = Join-Path $taskRoot '.private/android-release'
New-Item -ItemType Directory -Path $taskPrivate -Force | Out-Null
function Invoke-Checked {
    $taskExecutable = $args[0]
    $taskArguments = $args[1..($args.Count - 1)]
    & $taskExecutable @taskArguments
    if ($LASTEXITCODE -ne 0) { throw "Falha em $taskExecutable (exit $LASTEXITCODE)." }
}
Set-Location -LiteralPath $taskRoot
if (git status --porcelain) { throw 'Release APK requires a clean committed checkout.' }
$releaseId = (git rev-parse --short=12 HEAD).Trim()
$sourceDir = Join-Path $taskPrivate "source-$releaseId"
$sourceArchive = Join-Path $taskPrivate "source-$releaseId.tar"
New-Item -ItemType Directory -Path $sourceDir -Force | Out-Null
Invoke-Checked git -c core.autocrlf=false archive --format=tar "--output=$sourceArchive" HEAD
Invoke-Checked tar -xf $sourceArchive -C $sourceDir
if (!$JavaHome) {
    $jdkRoot = Join-Path $taskPrivate 'jdk21'
    $jdkBin = Get-ChildItem -LiteralPath $jdkRoot -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin/java.exe') } | Select-Object -First 1
    if (!$jdkBin) {
        New-Item -ItemType Directory -Path $jdkRoot -Force | Out-Null
        $jdkPackage = Invoke-RestMethod 'https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse'
        $jdkAsset = @($jdkPackage)[0].binary.package
        $jdkArchive = Join-Path $taskPrivate 'jdk21.zip'
        if (!(Test-Path -LiteralPath $jdkArchive)) { Invoke-WebRequest -Uri $jdkAsset.link -OutFile $jdkArchive }
        if ((Get-FileHash -LiteralPath $jdkArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $jdkAsset.checksum) { throw 'JDK checksum mismatch.' }
        Invoke-Checked tar -xf $jdkArchive -C $jdkRoot
        $jdkBin = Get-ChildItem -LiteralPath $jdkRoot -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin/java.exe') } | Select-Object -First 1
        @{version=@($jdkPackage)[0].version.openjdk_version;sha256=$jdkAsset.checksum;url=$jdkAsset.link} | ConvertTo-Json | Set-Content (Join-Path $taskPrivate 'jdk-manifest.json') -Encoding utf8NoBOM
    }
    $JavaHome = $jdkBin.FullName
}
$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $AndroidSdk
$env:PATH = "$JavaHome/bin;$AndroidSdk/platform-tools;$env:PATH"
$env:COCAPEC_DEPLOY_TARGET = 'production'
$keystore = Join-Path $taskPrivate 'cocapec-release.jks'
$signingFile = Join-Path $taskPrivate 'signing.json'
if (!(Test-Path -LiteralPath $signingFile)) {
    if (Test-Path -LiteralPath $keystore) { throw 'Existing keystore requires its original signing credentials.' }
    $password = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    @{storePassword=$password;keyPassword=$password} | ConvertTo-Json | Set-Content -LiteralPath $signingFile -Encoding utf8NoBOM
}
$signing = Get-Content -LiteralPath $signingFile -Raw | ConvertFrom-Json
$env:COCAPEC_STORE_PASSWORD = $signing.storePassword
$env:COCAPEC_KEY_PASSWORD = $signing.keyPassword
$env:COCAPEC_KEYSTORE = $keystore
try {
    if (!(Test-Path -LiteralPath $keystore)) {
        Invoke-Checked keytool -genkeypair -keystore $keystore '-storepass:env' COCAPEC_STORE_PASSWORD '-keypass:env' COCAPEC_KEY_PASSWORD -alias cocapec -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Cocapec Hackathon, O=Hackathon 2026, C=BR' -noprompt
    }
    if ($IsWindows) {
        $taskIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        foreach ($taskPrivateFile in @($keystore, $signingFile)) {
            Invoke-Checked icacls $taskPrivateFile /inheritance:r /grant:r "${taskIdentity}:(F)" '*S-1-5-18:(F)' '*S-1-5-32-544:(F)'
        }
    }
    Push-Location (Join-Path $sourceDir 'frontend')
    try {
        Invoke-Checked npm.cmd ci
        Invoke-Checked npm.cmd run lint
        Invoke-Checked npm.cmd test
        Invoke-Checked npm.cmd run build:production
        Invoke-Checked npx.cmd cap sync android
        Push-Location android
        try { Invoke-Checked '.\gradlew.bat' :app:testReleaseUnitTest :app:assembleRelease } finally { Pop-Location }
        $apkPath = Join-Path $taskPrivate "cocapec-$releaseId.apk"
        Copy-Item -LiteralPath 'android/app/build/outputs/apk/release/app-release.apk' -Destination $apkPath
        Invoke-Checked "$AndroidSdk/build-tools/36.0.0/apksigner.bat" verify --verbose --print-certs $apkPath
        $apkHash = (Get-FileHash -LiteralPath $apkPath -Algorithm SHA256).Hash.ToLowerInvariant()
        "$apkHash  cocapec-$releaseId.apk" | Set-Content -LiteralPath "$apkPath.sha256" -Encoding utf8NoBOM
        Write-Output "APK: $apkPath"
        Write-Output "SHA256: $apkHash"
    } finally { Pop-Location }
} finally {
    Remove-Item Env:COCAPEC_STORE_PASSWORD,Env:COCAPEC_KEY_PASSWORD,Env:COCAPEC_KEYSTORE,Env:COCAPEC_DEPLOY_TARGET -ErrorAction SilentlyContinue
}
