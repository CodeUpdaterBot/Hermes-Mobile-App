# Hermes Mobile gateway - run the phone's endpoint in its OWN console window.
#
# Why a window rather than a hidden child: the gateway has to outlive Hermes Desktop. A
# process started by (or as a child of) the Desktop dies with it, and a hidden one gives no
# sign it has gone - the phone simply stops working with no visible cause. Run this and the
# gateway gets a titled console window of its own: closing the window is the only way to stop
# it, and the window is proof it is alive.
#
# Two modes, one file:
#   (default)   launcher - stops any stale listeners, opens the window, waits, verifies
#   -Supervise  runs INSIDE the window: gateway + forwarder in the foreground, logs visible
#
#   0.0.0.0:<PhonePort>     -> hermes-session-forwarder.py -> advertised runtime, else
#   127.0.0.1:<GatewayPort> -> a local `hermes serve`, the authenticated fallback the phone
#                              pairs against

[CmdletBinding()]
param(
    [string]$PublicUrl  = 'http://100.118.101.75:9119',
    [int]$PhonePort     = 9119,
    [int]$GatewayPort   = 9120,
    [string]$HermesHome = (Join-Path $env:LOCALAPPDATA 'hermes'),
    [string]$RepoRoot   = '',
    [switch]$Supervise,
    [switch]$Stop
)

if (-not $RepoRoot) { $RepoRoot = Split-Path -Parent $PSScriptRoot }

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$WindowTitle = 'Hermes Mobile Gateway - do not close'

function Get-ListenerPid([int]$Port) {
    $line = netstat -ano | Select-String -Pattern 'LISTENING' |
        Where-Object { $_ -match ":$Port\s" } | Select-Object -First 1
    if (-not $line) { return $null }
    return [int](($line.ToString() -split '\s+')[-1])
}

function Resolve-Python([string]$HermesRoot) {
    # A bare 'python' may be the Windows Store stub, which opens the Store and exits, leaving
    # no listener and no error. Prefer the interpreter Hermes ships, then a real python.
    return @(
        (Join-Path $HermesRoot 'tools\python-3.14.7+202****0901-win32-x64\python.exe'),
        (Get-Command python -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
}

$hermesExe = Join-Path $HermesHome 'bin\hermes.exe'
$forwarder = Join-Path $RepoRoot 'scripts\hermes-session-forwarder.py'
if (-not (Test-Path -LiteralPath $hermesExe)) { throw "hermes.exe not found at $hermesExe" }
if (-not (Test-Path -LiteralPath $forwarder)) { throw "forwarder not found at $forwarder" }
$python = Resolve-Python $HermesHome
if (-not $python) { throw 'No usable python.exe found.' }

function Stop-Listeners {
    foreach ($port in @($PhonePort, $GatewayPort)) {
        # $pid is read-only in PowerShell - never assign to it.
        $listenerPid = Get-ListenerPid $port
        if ($listenerPid) {
            Write-Host "  stopping stale listener on $port (pid $listenerPid)"
            Stop-Process -Id $listenerPid -Force -ErrorAction SilentlyContinue
        }
    }
}

if ($Stop) {
    Stop-Listeners
    Write-Host 'Hermes Mobile gateway stopped.' -ForegroundColor Yellow
    return
}

# ---------------------------------------------------------------- launcher (default mode)
if (-not $Supervise) {
    # Declare the public URL: it makes a runtime treat the Tailscale host as its own, and
    # flips auth on, which a remote phone requires before it will pair at all.
    $env:HERMES_HOME = $HermesHome
    & $hermesExe config set dashboard.public_url $PublicUrl | Out-Null
    [Environment]::SetEnvironmentVariable('HERMES_DASHBOARD_PUBLIC_URL', $PublicUrl, 'User')
    Write-Host "  declared dashboard.public_url = $PublicUrl"

    Stop-Listeners
    Start-Sleep -Milliseconds 800

    # A NEW console window: -NoExit keeps it open if the supervisor ever returns, so a crash
    # leaves the reason on screen instead of vanishing.
    $quotedSelf = '"' + $PSCommandPath + '"'
    Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', $quotedSelf,
        '-Supervise', '-PublicUrl', $PublicUrl,
        '-PhonePort', "$PhonePort", '-GatewayPort', "$GatewayPort",
        '-HermesHome', ('"' + $HermesHome + '"'), '-RepoRoot', ('"' + $RepoRoot + '"')
    ) | Out-Null

    $deadline = (Get-Date).AddSeconds(45)
    while ((Get-Date) -lt $deadline) {
        if ((Get-ListenerPid $PhonePort) -and (Get-ListenerPid $GatewayPort)) { break }
        Start-Sleep -Milliseconds 750
    }

    Write-Host ''
    foreach ($port in @($PhonePort, $GatewayPort)) {
        $state = if (Get-ListenerPid $port) { 'listening' } else { 'NOT LISTENING' }
        Write-Host ("  {0,-6} {1}" -f $port, $state)
    }
    try {
        $status = Invoke-RestMethod -Uri "http://127.0.0.1:$PhonePort/api/status" -TimeoutSec 8 `
            -Headers @{ Host = ($PublicUrl -replace '^https?://', '') }
        $auth = if ($status.PSObject.Properties['auth_required']) { $status.auth_required } else { '?' }
        Write-Host "  phone endpoint answers, auth_required = $auth"
    } catch {
        Write-Host "  could not read /api/status through $PhonePort : $($_.Exception.Message)" -ForegroundColor Yellow
    }
    Write-Host ''
    Write-Host "Look for the window titled '$WindowTitle' in your taskbar." -ForegroundColor Green
    Write-Host 'Leave it open: it IS the gateway. Closing it stops the phone.' -ForegroundColor Green
    return
}

# ------------------------------------------------------------- supervisor (inside the window)
$Host.UI.RawUI.WindowTitle = $WindowTitle
$env:HERMES_HOME = $HermesHome
$env:HERMES_DASHBOARD_PUBLIC_URL = $PublicUrl

Write-Host ''
Write-Host '  Hermes Mobile gateway' -ForegroundColor Cyan
Write-Host "  phone endpoint : 0.0.0.0:$PhonePort"
Write-Host "  fallback host  : 127.0.0.1:$GatewayPort"
Write-Host "  public url     : $PublicUrl"
Write-Host ''
Write-Host '  Leave this window open. Closing it stops the gateway.' -ForegroundColor Yellow
Write-Host ''

# -NoNewWindow: the children share this console, so their logs appear here and this window
# owns their lifetime. That is the whole point - visible and independent of Hermes Desktop.
$gateway = Start-Process -FilePath $hermesExe `
    -ArgumentList @('serve', '--host', '127.0.0.1', '--port', "$GatewayPort") `
    -NoNewWindow -PassThru

# -ArgumentList does NOT quote: an unquoted path containing spaces arrives at python as
# "C:\...\Coding" and the script is never found. The repo path has spaces.
$forwarderQuoted = '"' + $forwarder + '"'
$fwd = Start-Process -FilePath $python `
    -ArgumentList @($forwarderQuoted, '--home', $HermesHome, '--listen-host', '0.0.0.0',
                    '--listen-port', "$PhonePort", '--fallback-host', '127.0.0.1',
                    '--fallback-port', "$GatewayPort") `
    -NoNewWindow -PassThru

Write-Host "  gateway pid $($gateway.Id)   forwarder pid $($fwd.Id)" -ForegroundColor DarkGray
Write-Host ''

while ($true) {
    Start-Sleep -Seconds 3
    if ($gateway.HasExited) {
        Write-Host "  GATEWAY EXITED (code $($gateway.ExitCode)) - the phone cannot connect now." -ForegroundColor Red
        break
    }
    if ($fwd.HasExited) {
        Write-Host "  FORWARDER EXITED (code $($fwd.ExitCode)) - the phone cannot connect now." -ForegroundColor Red
        break
    }
}
