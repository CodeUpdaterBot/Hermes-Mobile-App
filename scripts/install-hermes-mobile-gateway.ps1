<#
.SYNOPSIS
  Installs a private, authenticated Hermes gateway for Hermes Mobile on Windows.

.DESCRIPTION
  The gateway binds only to this computer's Tailscale IPv4 address, registers a
  per-user Scheduled Task for login startup, and limits Windows Firewall access
  to the Tailscale CGNAT range (100.64.0.0/10). It never opens port 9119 to the
  public internet and never prints passwords or gateway secrets.

  This one `hermes serve` IS the whole phone-facing stack. Binding every
  interface is what makes it require authentication, and because it is an
  ordinary Hermes runtime it also carries the chats that are open on the Hermes
  Desktop, through the session-attach relay. Do NOT add the dev-only forwarder
  indirection here: the forwarder exists to steer the phone onto a runtime that
  owns the sessions, and a runtime that cannot authenticate a remote client must
  never be advertised to one (a Desktop-owned loopback backend is deliberately
  exempt from the ticket gate and always reports auth_required=false).

  Run from an Administrator PowerShell window, or use setup-hermes-tailscale-gateway.cmd.
#>
[CmdletBinding()]
param(
  [ValidateSet('Install', 'Status', 'Uninstall')]
  [string]$Mode = 'Install',
  [string]$HermesExecutable,
  [string]$HermesHome,
  [string]$TailscaleIP,
  [ValidateRange(1, 65535)]
  [int]$Port = 9119,
  [string]$Username,
  [switch]$SkipAuthSetup
)

$ErrorActionPreference = 'Stop'
$TaskName = 'Hermes Mobile Tailscale Gateway'
$FirewallName = 'Hermes Mobile Tailscale Gateway (Private)'
$RunnerDirectoryName = 'mobile-gateway'

function Write-Info([string]$Message) { Write-Host "[Hermes Mobile] $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host "[OK] $Message" -ForegroundColor Green }
function Write-Warn([string]$Message) { Write-Host "[!] $Message" -ForegroundColor Yellow }
function Fail([string]$Message) { Write-Host "ERROR: $Message" -ForegroundColor Red; exit 1 }

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Quote-PowerShellLiteral {
  param([string]$Value)
  return "'" + $Value.Replace("'", "''") + "'"
}

function Invoke-ElevatedSelf {
  $command = "& $(Quote-PowerShellLiteral $PSCommandPath) -Mode $(Quote-PowerShellLiteral $Mode) -Port $Port"
  if ($HermesExecutable) { $command += " -HermesExecutable $(Quote-PowerShellLiteral $HermesExecutable)" }
  if ($HermesHome) { $command += " -HermesHome $(Quote-PowerShellLiteral $HermesHome)" }
  if ($TailscaleIP) { $command += " -TailscaleIP $(Quote-PowerShellLiteral $TailscaleIP)" }
  if ($Username) { $command += " -Username $(Quote-PowerShellLiteral $Username)" }
  if ($SkipAuthSetup) { $command += ' -SkipAuthSetup' }
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
  $process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList "-NoProfile -EncodedCommand $encoded"
  exit $process.ExitCode
}

function Normalize-HermesHome {
  param([string]$Candidate)
  $resolved = (Resolve-Path -LiteralPath $Candidate).Path
  $parent = Split-Path -Parent $resolved
  if ((Split-Path -Leaf $parent) -ieq 'profiles') {
    return (Resolve-Path -LiteralPath (Split-Path -Parent $parent)).Path
  }
  return $resolved
}

function Resolve-HermesHome {
  param([string]$RequestedHome)
  $candidates = @(
    $RequestedHome,
    (Join-Path $env:LOCALAPPDATA 'hermes'),
    $env:HERMES_HOME,
    (Join-Path $HOME '.hermes')
  ) | Where-Object { $_ } | Select-Object -Unique
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Container) {
      return (Normalize-HermesHome -Candidate $candidate)
    }
  }
  Fail "Could not locate Hermes home. Install Hermes Desktop/Agent first, or rerun with -HermesHome 'C:\path\to\hermes'."
}

function Resolve-HermesExecutable {
  param([string]$RequestedExecutable, [string]$ResolvedHome)
  $candidates = @(
    $RequestedExecutable,
    (Get-Command hermes.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
    (Get-Command hermes -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
    (Join-Path $ResolvedHome 'hermes-agent\venv\Scripts\hermes.exe'),
    (Join-Path $env:LOCALAPPDATA 'hermes\hermes-agent\venv\Scripts\hermes.exe')
  ) | Where-Object { $_ } | Select-Object -Unique
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      try {
        & $candidate serve --help *> $null
        return (Resolve-Path -LiteralPath $candidate).Path
      } catch { }
    }
  }
  Fail "Could not locate a working Hermes executable. Install Hermes Desktop/Agent first, add 'hermes' to PATH, or rerun with -HermesExecutable 'C:\path\to\hermes.exe'."
}

function Test-TailscaleIPv4 {
  param([string]$Address)
  $parsed = $null
  if (-not [Net.IPAddress]::TryParse($Address, [ref]$parsed)) { return $false }
  if ($parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { return $false }
  $octets = $parsed.GetAddressBytes()
  return $octets[0] -eq 100 -and $octets[1] -ge 64 -and $octets[1] -le 127
}

function Get-LocalTailscaleIPs {
  $tailscale = Get-Command tailscale.exe -ErrorAction SilentlyContinue
  if (-not $tailscale) { $tailscale = Get-Command tailscale -ErrorAction SilentlyContinue }
  if (-not $tailscale) { Fail "Tailscale was not found. Install and sign in to Tailscale first: https://tailscale.com/download/windows" }
  $addresses = @(& $tailscale.Source ip -4 2>$null | ForEach-Object { $_.Trim() } | Where-Object { Test-TailscaleIPv4 $_ })
  if ($addresses.Count -eq 0) { Fail "Tailscale is installed but no Tailscale IPv4 address was found. Open Tailscale, sign in, then rerun this installer." }
  return $addresses
}

function Resolve-TailscaleIP {
  param([string]$RequestedIP)
  $addresses = @(Get-LocalTailscaleIPs)
  if ($RequestedIP) {
    if (-not (Test-TailscaleIPv4 $RequestedIP)) { Fail "-TailscaleIP must be a valid locally assigned Tailscale IPv4 address in 100.64.0.0/10." }
    if ($addresses -notcontains $RequestedIP) { Fail "-TailscaleIP $RequestedIP is not currently assigned to this computer's Tailscale interface." }
    return $RequestedIP
  }
  return $addresses[0]
}

function Get-DotEnvValue {
  param([string]$Path, [string]$Key)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $line = Get-Content -LiteralPath $Path | Where-Object { $_ -match "^$([regex]::Escape($Key))=" } | Select-Object -Last 1
  if (-not $line) { return $null }
  return $line.Substring($Key.Length + 1)
}

function Set-DotEnvValue {
  param([string]$Path, [string]$Key, [string]$Value)
  if ($Value -match "[\r\n]") { Fail "The $Key value cannot contain a newline." }
  $directory = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
  $lines = if (Test-Path -LiteralPath $Path) { Get-Content -LiteralPath $Path } else { @() }
  $retained = @($lines | Where-Object { $_ -notmatch "^$([regex]::Escape($Key))=" })
  Set-Content -LiteralPath $Path -Value @($retained + "$Key=$Value") -Encoding utf8
}

function New-Base64Secret {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return [Convert]::ToBase64String($bytes)
}

function Protect-DotEnv {
  param([string]$Path)
  try {
    & icacls.exe $Path /inheritance:r /grant:r "$env:USERNAME`:(R,W)" /grant:r 'SYSTEM:(F)' /grant:r 'Administrators:(F)' *> $null
    Write-Ok "Restricted gateway credential file ACLs."
  } catch {
    Write-Warn "Could not tighten ACLs on $Path. Confirm that only your Windows account and administrators can read it."
  }
}

function Configure-BasicAuth {
  param([string]$ResolvedHome)
  $envFile = Join-Path $ResolvedHome '.env'
  $existingUser = Get-DotEnvValue -Path $envFile -Key 'HERMES_DASHBOARD_BASIC_AUTH_USERNAME'
  $existingPassword = Get-DotEnvValue -Path $envFile -Key 'HERMES_DASHBOARD_BASIC_AUTH_PASSWORD'
  $existingSecret = Get-DotEnvValue -Path $envFile -Key 'HERMES_DASHBOARD_BASIC_AUTH_SECRET'
  if ($existingUser -and $existingPassword -and $existingSecret) {
    Write-Ok "Existing Hermes basic-auth credentials found; preserving them."
    return
  }
  if ($SkipAuthSetup) {
    Write-Warn "Skipping basic-auth setup. The final verification will fail unless Hermes already has an authenticated provider configured."
    return
  }
  Write-Host ''
  Write-Info 'Hermes Mobile needs an authenticated host gateway. Create credentials for this trusted Tailnet only.'
  $selectedUser = if ($Username) { $Username } else { Read-Host 'Gateway username (Enter for admin)' }
  if ([string]::IsNullOrWhiteSpace($selectedUser)) { $selectedUser = 'admin' }
  if ($selectedUser -match '[\r\n=]') { Fail 'Gateway username cannot contain a newline or =.' }
  do {
    $passwordSecure = Read-Host 'Gateway password' -AsSecureString
    $confirmSecure = Read-Host 'Confirm gateway password' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($passwordSecure)
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    $confirmBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirmSecure)
    $confirm = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($confirmBstr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($confirmBstr)
    if ([string]::IsNullOrWhiteSpace($password)) { Write-Warn 'Password cannot be empty.' }
    elseif ($password -ne $confirm) { Write-Warn 'Passwords did not match. Try again.' }
  } while ([string]::IsNullOrWhiteSpace($password) -or $password -ne $confirm)
  Set-DotEnvValue -Path $envFile -Key 'HERMES_DASHBOARD_BASIC_AUTH_USERNAME' -Value $selectedUser
  Set-DotEnvValue -Path $envFile -Key 'HERMES_DASHBOARD_BASIC_AUTH_PASSWORD' -Value $password
  Set-DotEnvValue -Path $envFile -Key 'HERMES_DASHBOARD_BASIC_AUTH_SECRET' -Value (New-Base64Secret)
  $password = $null; $confirm = $null
  Protect-DotEnv -Path $envFile
  Write-Ok "Configured authenticated gateway credentials in $envFile. Password and secret were not printed."
}

function Write-Runner {
  param([string]$ResolvedHome, [string]$ResolvedHermes, [string]$IP, [int]$GatewayPort)
  $runnerDirectory = Join-Path $ResolvedHome $RunnerDirectoryName
  New-Item -ItemType Directory -Force -Path $runnerDirectory | Out-Null
  $runner = Join-Path $runnerDirectory 'run-hermes-mobile-gateway.cmd'
  $content = @(
    '@echo off',
    'setlocal EnableExtensions',
    ('set "HERMES_HOME=' + $ResolvedHome + '"'),
    ('"' + $ResolvedHermes + '" serve --host 0.0.0.0 --port ' + $GatewayPort)
  )
  Set-Content -LiteralPath $runner -Value $content -Encoding ascii
  return $runner
}

function Install-FirewallRule {
  param([int]$GatewayPort)
  Get-NetFirewallRule -DisplayName $FirewallName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName $FirewallName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $GatewayPort -RemoteAddress '100.64.0.0/10' -Profile Any | Out-Null
  Write-Ok "Added Windows Firewall rule for TCP $GatewayPort from Tailscale addresses only."
}

function Install-ScheduledTask {
  param([string]$Runner)
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
  $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/d /c `"`"$Runner`"`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName
  Write-Ok "Installed and started the per-user '$TaskName' task."
}

function Get-PortListeners {
  param([int]$GatewayPort)
  return @(Get-NetTCPConnection -State Listen -LocalPort $GatewayPort -ErrorAction SilentlyContinue)
}

function Assert-NoForeignListener {
  param([int]$GatewayPort)
  $listeners = Get-PortListeners -GatewayPort $GatewayPort
  if ($listeners.Count -gt 0) {
    $bindings = $listeners | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort) (PID $($_.OwningProcess))" }
    Fail "Port $GatewayPort is already listening: $($bindings -join '; '). Stop the existing service first; the installer will not replace an unknown or broad listener."
  }
}

function Assert-TailscaleGatewayListener {
  param([int]$GatewayPort)
  $listeners = Get-PortListeners -GatewayPort $GatewayPort
  $unexpected = @($listeners | Where-Object { $_.LocalAddress -ne '0.0.0.0' })
  $expected = @($listeners | Where-Object { $_.LocalAddress -eq '0.0.0.0' })
  if ($unexpected.Count -gt 0 -or $expected.Count -ne 1) {
    $bindings = $listeners | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort) (PID $($_.OwningProcess))" }
    throw "Gateway listener must be one IPv4 wildcard bind at 0.0.0.0:$GatewayPort, protected by the Tailscale-only firewall rule. Observed: $($bindings -join '; ')"
  }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($expected[0].OwningProcess)" -ErrorAction SilentlyContinue
  if (-not $process -or $process.CommandLine -notmatch '(?i)hermes.*\bserve\b') {
    throw "The listener on 0.0.0.0:$GatewayPort is not owned by a Hermes serve process."
  }
}

function Test-Gateway {
  param([string]$IP, [int]$GatewayPort)
  $url = "http://${IP}:$GatewayPort/api/status"
  for ($attempt = 1; $attempt -le 20; $attempt++) {
    try {
      Assert-TailscaleGatewayListener -GatewayPort $GatewayPort
      $status = Invoke-RestMethod -Uri $url -TimeoutSec 3
      if ($status.auth_required -eq $true) {
        Write-Ok "Authenticated Hermes gateway is protected by the Tailscale-only firewall at $url"
        return
      }
      Fail "Gateway responded at $url but authentication is not required. Refusing an unsafe remote setup."
    } catch {
      if ($attempt -eq 20) { throw }
      Start-Sleep -Seconds 1
    }
  }
  Fail "Gateway did not become safely reachable at $url. Inspect the Hermes Mobile Scheduled Task and $env:LOCALAPPDATA\hermes\logs, then rerun with -Mode Status."
}

function Show-Status {
  param([string]$ResolvedHermes, [string]$ResolvedHome, [string]$IP, [int]$GatewayPort)
  $healthy = $true
  Write-Info "Hermes home: $ResolvedHome"
  Write-Info "Hermes executable: $ResolvedHermes"
  Write-Info "Tailscale gateway URL: http://${IP}:$GatewayPort"
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task -and $task.State -eq 'Running') { Write-Host "Task: $($task.State)" } else { Write-Warn "Task '$TaskName' is not running."; $healthy = $false }
  $rule = Get-NetFirewallRule -DisplayName $FirewallName -ErrorAction SilentlyContinue
  if ($rule -and $rule.Enabled -eq 'True') { Write-Host "Firewall: enabled (Tailscale-only rule present)" } else { Write-Warn 'Tailscale-only firewall rule is not enabled.'; $healthy = $false }
  & $ResolvedHermes serve --status | Out-Host
  try {
    Assert-TailscaleGatewayListener -GatewayPort $GatewayPort
    $status = Invoke-RestMethod -Uri "http://${IP}:$GatewayPort/api/status" -TimeoutSec 3
    if ($status.auth_required -eq $true) { Write-Ok 'Gateway API: reachable and authenticated.' } else { Write-Warn 'Gateway API is reachable but does not require authentication.'; $healthy = $false }
  } catch { Write-Warn $_.Exception.Message; $healthy = $false }
  return $healthy
}

if (-not (Test-Administrator)) {
  Invoke-ElevatedSelf
}

if ($Mode -eq 'Uninstall') {
  Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false
  Get-NetFirewallRule -DisplayName $FirewallName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  $cleanupHomes = @($HermesHome, (Join-Path $env:LOCALAPPDATA 'hermes'), $env:HERMES_HOME, (Join-Path $HOME '.hermes')) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) } | Select-Object -Unique
  foreach ($home in $cleanupHomes) {
    $runnerDirectory = Join-Path (Normalize-HermesHome -Candidate $home) $RunnerDirectoryName
    if (Test-Path -LiteralPath $runnerDirectory) { Remove-Item -LiteralPath $runnerDirectory -Recurse -Force }
  }
  Write-Ok 'Removed Hermes Mobile startup task and private firewall rule. Existing Hermes credentials were preserved.'
  exit 0
}

$resolvedHome = Resolve-HermesHome -RequestedHome $HermesHome
$resolvedHermes = Resolve-HermesExecutable -RequestedExecutable $HermesExecutable -ResolvedHome $resolvedHome
$resolvedIP = Resolve-TailscaleIP -RequestedIP $TailscaleIP

if ($Mode -eq 'Status') {
  if (Show-Status -ResolvedHermes $resolvedHermes -ResolvedHome $resolvedHome -IP $resolvedIP -GatewayPort $Port) { exit 0 }
  exit 1
}

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask -and $existingTask.State -eq 'Running') {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  Start-Sleep -Seconds 2
}
Assert-NoForeignListener -GatewayPort $Port
Configure-BasicAuth -ResolvedHome $resolvedHome
$runner = Write-Runner -ResolvedHome $resolvedHome -ResolvedHermes $resolvedHermes -IP $resolvedIP -GatewayPort $Port
Install-FirewallRule -GatewayPort $Port
Install-ScheduledTask -Runner $runner
Test-Gateway -IP $resolvedIP -GatewayPort $Port
Write-Host ''
Write-Ok "Hermes Mobile host setup is complete. On your phone, enter: http://${resolvedIP}:$Port"
Write-Warn 'This gateway is restricted to your Tailscale network. Do not expose port 9119 directly to the public internet.'
