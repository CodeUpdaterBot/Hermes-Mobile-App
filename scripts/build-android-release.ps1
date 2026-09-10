[CmdletBinding()]
param(
    [switch]$BuildAab
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Read-Default([string]$Prompt, [string]$Default) {
    $value = Read-Host "$Prompt [$Default]"
    if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
    return $value.Trim()
}

function Convert-SecureStringToPlainText([Security.SecureString]$SecureValue) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
}

$defaultKeystore = 'E:\Hermes\hermes-mobile-upload.jks'
$keystore = Read-Default 'Hermes Mobile upload keystore' $defaultKeystore
if (-not (Test-Path -LiteralPath $keystore -PathType Leaf)) {
    throw "Keystore not found: $keystore"
}
$keystore = (Resolve-Path -LiteralPath $keystore).Path

$keytool = $null
if ($env:JAVA_HOME) {
    $candidate = Join-Path $env:JAVA_HOME 'bin\keytool.exe'
    if (Test-Path -LiteralPath $candidate) { $keytool = $candidate }
}
if (-not $keytool) {
    $command = Get-Command keytool.exe -ErrorAction SilentlyContinue
    if ($command) { $keytool = $command.Source }
}
if (-not $keytool) {
    throw 'keytool.exe was not found. Install/configure a JDK and retry.'
}

Write-Host ''
Write-Host 'The next keytool prompt validates the keystore and alias.' -ForegroundColor Cyan
Write-Host 'Enter the keystore password there. It will not be displayed.' -ForegroundColor Cyan
$alias = Read-Default 'Key alias' 'hermes-mobile'
& $keytool -list -keystore $keystore -alias $alias
if ($LASTEXITCODE -ne 0) {
    throw "The alias '$alias' could not be validated in the selected keystore. No build was started."
}

Write-Host ''
Write-Host 'Enter the passwords for this build session. They are kept only in this PowerShell process.' -ForegroundColor Cyan
$storeSecure = Read-Host 'Keystore/store password' -AsSecureString
$keySecure = Read-Host 'Signing key password' -AsSecureString
$storePassword = Convert-SecureStringToPlainText $storeSecure
$keyPassword = Convert-SecureStringToPlainText $keySecure

try {
    $env:HERMES_MOBILE_KEYSTORE = $keystore
    $env:HERMES_MOBILE_KEY_ALIAS = $alias
    $env:HERMES_MOBILE_STORE_PASSWORD = $storePassword
    $env:HERMES_MOBILE_KEY_PASSWORD = $keyPassword

    Write-Host ''
    Write-Host 'Building signed ARM64 release APK…' -ForegroundColor Cyan
    & pnpm tauri android build --apk --target aarch64 --split-per-abi
    if ($LASTEXITCODE -ne 0) { throw 'Signed APK build failed.' }

    if ($BuildAab) {
        Write-Host ''
        Write-Host 'Building signed Android App Bundle…' -ForegroundColor Cyan
        & pnpm tauri android build --aab
        if ($LASTEXITCODE -ne 0) { throw 'Signed AAB build failed.' }
    }

    $apk = Join-Path $repoRoot 'src-tauri\gen\android\app\build\outputs\apk\arm64\release\app-arm64-release.apk'
    Write-Host ''
    Write-Host 'SIGNED BUILD COMPLETE' -ForegroundColor Green
    if (Test-Path -LiteralPath $apk) { Write-Host "APK: $apk" }
    if ($BuildAab) {
        $aab = Join-Path $repoRoot 'src-tauri\gen\android\app\build\outputs\bundle\universalRelease\app-universal-release.aab'
        if (Test-Path -LiteralPath $aab) { Write-Host "AAB: $aab" }
    }
}
finally {
    Remove-Item Env:HERMES_MOBILE_KEYSTORE -ErrorAction SilentlyContinue
    Remove-Item Env:HERMES_MOBILE_KEY_ALIAS -ErrorAction SilentlyContinue
    Remove-Item Env:HERMES_MOBILE_STORE_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:HERMES_MOBILE_KEY_PASSWORD -ErrorAction SilentlyContinue
    $storePassword = $null
    $keyPassword = $null
    $storeSecure = $null
    $keySecure = $null
}
