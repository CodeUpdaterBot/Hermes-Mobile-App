[CmdletBinding()]
param(
    [string]$Keystore = 'E:\Hermes\hermes-mobile-upload.jks',
    [string]$Alias = 'hermes-mobile',
    [int]$MaxAttempts = 5
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Convert-SecureStringToPlainText([Security.SecureString]$SecureValue) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
}

function Find-Keytool {
    if ($env:JAVA_HOME) {
        $candidate = Join-Path $env:JAVA_HOME 'bin\keytool.exe'
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    $command = Get-Command keytool.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    throw 'keytool.exe was not found. Install/configure a JDK first.'
}

function Invoke-KeytoolWithInput([string]$Tool, [string]$Arguments, [string]$InputText) {
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $Tool
    $start.Arguments = $Arguments
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $start
    [void]$process.Start()
    try {
        if ($null -ne $InputText) {
            $process.StandardInput.Write($InputText)
        }
        $process.StandardInput.Close()
        $stdout = $process.StandardOutput.ReadToEnd()
        $stderr = $process.StandardError.ReadToEnd()
        $process.WaitForExit()
        return [pscustomobject]@{ ExitCode = $process.ExitCode; Stdout = $stdout; Stderr = $stderr }
    }
    finally {
        $process.Dispose()
    }
}

if (-not (Test-Path -LiteralPath $Keystore -PathType Leaf)) {
    throw "Keystore not found: $Keystore"
}
$Keystore = (Resolve-Path -LiteralPath $Keystore).Path
$keytool = Find-Keytool
$quotedKeystore = '"' + $Keystore.Replace('"', '\"') + '"'
$quotedAlias = '"' + $Alias.Replace('"', '\"') + '"'

Write-Host "Keystore: $Keystore"
Write-Host "Alias:    $Alias"
Write-Host 'Passwords are never printed or saved by this script.' -ForegroundColor Cyan
Write-Host ''

$storePassword = $null
for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    $secure = Read-Host "Keystore/store password (attempt $attempt of $MaxAttempts)" -AsSecureString
    $candidate = Convert-SecureStringToPlainText $secure
    $result = Invoke-KeytoolWithInput $keytool "-list -keystore $quotedKeystore -alias $quotedAlias" "$candidate`n"
    $candidate = $null
    $secure = $null
    if ($result.ExitCode -eq 0) {
        $storePassword = Convert-SecureStringToPlainText (Read-Host 'Re-enter the verified store password for the build session' -AsSecureString)
        Write-Host 'Store password: VERIFIED' -ForegroundColor Green
        break
    }
    Write-Host 'Store password: incorrect; try again.' -ForegroundColor Yellow
}
if ($null -eq $storePassword) {
    throw 'Store password was not verified. No key-password check or build was started.'
}

$keyPassword = $null
for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    $secure = Read-Host "Private-key password (attempt $attempt of $MaxAttempts)" -AsSecureString
    $candidate = Convert-SecureStringToPlainText $secure
    $temp = Join-Path $env:TEMP ("hermes-key-check-{0}.p12" -f [guid]::NewGuid().ToString('N'))
    $destinationPassword = [guid]::NewGuid().ToString('N')
    try {
        $result = Invoke-KeytoolWithInput $keytool "-importkeystore -noprompt -srckeystore $quotedKeystore -srcalias $quotedAlias -destkeystore `"$temp`" -deststoretype PKCS12 -deststorepass $destinationPassword -destkeypass $destinationPassword" "$storePassword`n$candidate`n"
    }
    finally {
        Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
    }
    $candidate = $null
    $secure = $null
    if ($result.ExitCode -eq 0) {
        $keyPassword = Convert-SecureStringToPlainText (Read-Host 'Re-enter the verified private-key password for the build session' -AsSecureString)
        Write-Host 'Private-key password: VERIFIED' -ForegroundColor Green
        break
    }
    Write-Host 'Private-key password: incorrect; try again.' -ForegroundColor Yellow
}

if ($null -eq $keyPassword) {
    $storePassword = $null
    throw 'Private-key password was not verified. No signing build was started.'
}

Write-Host ''
Write-Host 'Both credentials verified successfully.' -ForegroundColor Green
Write-Host 'For the release build, set these only in the current PowerShell process:' -ForegroundColor Cyan
Write-Host '$env:HERMES_MOBILE_KEYSTORE = [REDACTED]'
Write-Host '$env:HERMES_MOBILE_KEY_ALIAS = [REDACTED]'
Write-Host '$env:HERMES_MOBILE_STORE_PASSWORD = [REDACTED]'
Write-Host '$env:HERMES_MOBILE_KEY_PASSWORD = [REDACTED]'
Write-Host ''
Write-Host 'This verifier does not persist environment variables or start a build.' -ForegroundColor Cyan
$storePassword = $null
$keyPassword = $null
