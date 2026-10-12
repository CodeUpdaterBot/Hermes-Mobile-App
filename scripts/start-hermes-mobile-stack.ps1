# Hermes Mobile companion stack - start/stop everything the phone needs.
#
# Why this exists: the phone's endpoint must reach the runtime that OWNS the sessions.
# Hermes allows exactly one live process per session, so a second runtime is refused with
# "This chat is open in another Hermes window/terminal". This script runs the two pieces
# that make the phone's existing URL land on the right runtime, and it does so DETACHED,
# because anything started as a child of the Hermes Desktop dies when the Desktop restarts.
#
#   0.0.0.0:<PhonePort>  -> hermes-session-forwarder.py -> whichever runtime is advertised
#                                                          on a live session lease, else
#   127.0.0.1:<GatewayPort> -> a local `hermes serve` used as the fallback (and as the
#                              authenticated endpoint the phone pairs against)
#
# Idempotent: re-running it never doubles a listener, never duplicates a process.

[CmdletBinding()]
param(
    [string]$PublicUrl  = 'http://100.118.101.75:9119',
    [int]$PhonePort     = 9119,
    [int]$GatewayPort   = 9120,
    [string]$HermesHome = (Join-Path $env:LOCALAPPDATA 'hermes'),
    [string]$RepoRoot   = '',
    [switch]$Stop
)

# A pipeline is not a legal parameter default; resolve it here instead.
if (-not $RepoRoot) { $RepoRoot = Split-Path -Parent $PSScriptRoot }

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-ListenerPid([int]$Port) {
    $line = netstat -ano | Select-String -Pattern "LISTENING" |
        Where-Object { $_ -match ":$Port\s" } | Select-Object -First 1
    if (-not $line) { return $null }
    return [int](($line.ToString() -split '\s+')[-1])
}

function Write-Step([string]$Message) { Write-Host "  $Message" }

if ($Stop) {
    foreach ($port in @($PhonePort, $GatewayPort)) {
        # $pid is a read-only PowerShell automatic variable - never assign to it.
        $listenerPid = Get-ListenerPid $port
        if ($listenerPid) {
            Write-Step "stopping listener on $port (pid $listenerPid)"
            Stop-Process -Id $listenerPid -Force -ErrorAction SilentlyContinue
        }
    }
    Write-Host 'Stack stopped.' -ForegroundColor Yellow
    return
}

$hermesExe = Join-Path $HermesHome 'bin\hermes.exe'
if (-not (Test-Path -LiteralPath $hermesExe)) { throw "hermes.exe not found at $hermesExe" }

$forwarder = Join-Path $RepoRoot 'scripts\hermes-session-forwarder.py'
if (-not (Test-Path -LiteralPath $forwarder)) { throw "forwarder not found at $forwarder" }

# Start-Process needs a real executable: a bare 'python' may resolve to the Windows Store
# stub, which opens the Store and exits, leaving no listener and no error. Prefer the
# interpreter Hermes itself ships, then any real python on PATH.
$python = @(
    (Join-Path $HermesHome 'tools\python-3.14.7+20260901-win32-x64\python.exe'),
    (Get-Command python -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $python) { throw 'No usable python.exe found; pass one explicitly.' }
Write-Step "using python: $python"

# 1. Declare the public URL. This is what makes a runtime treat the Tailscale host as its
#    own: it becomes a trusted host AND flips auth on, which a remote phone requires before
#    it will pair at all. Set in config (authoritative) and in the environment (inherited by
#    runtimes the Desktop spawns), because a runtime computes auth_required once at start.
Write-Step "declaring dashboard.public_url = $PublicUrl"
$env:HERMES_HOME = $HermesHome
& $hermesExe config set dashboard.public_url $PublicUrl | Out-Null
[Environment]::SetEnvironmentVariable('HERMES_DASHBOARD_PUBLIC_URL', $PublicUrl, 'User')
$env:HERMES_DASHBOARD_PUBLIC_URL = $PublicUrl

# 2. Fallback gateway. Detached, so a Desktop restart cannot take it down with it.
if (Get-ListenerPid $GatewayPort) {
    Write-Step "gateway already listening on $GatewayPort"
} else {
    Write-Step "starting gateway on 127.0.0.1:$GatewayPort"
    $env:HERMES_HOME = $HermesHome
    Start-Process -FilePath $hermesExe `
        -ArgumentList @('serve', '--host', '127.0.0.1', '--port', "$GatewayPort") `
        -WindowStyle Hidden | Out-Null
}

# 3. The forwarding endpoint the phone already uses.
if (Get-ListenerPid $PhonePort) {
    Write-Step "forwarder already listening on $PhonePort"
} else {
    Write-Step "starting forwarder on 0.0.0.0:$PhonePort -> advertised runtime, else $GatewayPort"
    # -ArgumentList does NOT quote: an unquoted path with spaces arrives at python as
    # "C:\...\Coding" and the script is never found. The repo path has spaces.
    # No stdout/stderr redirection here: Start-Process BLOCKS until the child exits when
    # it redirects, and a server never exits.
    $forwarderQuoted = '"' + $forwarder + '"'
    Start-Process -FilePath $python `
        -ArgumentList @($forwarderQuoted, '--home', $HermesHome, '--listen-host', '0.0.0.0',
                        '--listen-port', "$PhonePort", '--fallback-host', '127.0.0.1',
                        '--fallback-port', "$GatewayPort") `
        -WindowStyle Hidden | Out-Null
}

# 4. Wait for both, then report what is actually serving - never assume.
$deadline = (Get-Date).AddSeconds(40)
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
    Write-Host ''
    Write-Host "  phone endpoint serves: $($status.hermes_home)"
    Write-Host "  auth_required there:   $($status.auth_required)"
} catch {
    Write-Host "  could not read /api/status through $PhonePort : $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Stack ready. Re-run this script after a reboot; use -Stop to shut it down.' -ForegroundColor Green
