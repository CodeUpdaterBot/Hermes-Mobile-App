#!/usr/bin/env bash
# Installs a private, authenticated Hermes gateway for Hermes Mobile on macOS.
# The gateway binds only to the local Tailscale IP and runs as a per-user
# LaunchAgent. It never opens TCP 9119 to the public internet.
set -euo pipefail

MODE="install"
HERMES_EXE=""
HERMES_HOME_OVERRIDE=""
TAILSCALE_IP=""
PORT="9119"
USERNAME=""
SKIP_AUTH_SETUP=0
LABEL="com.hermesmobile.gateway"

info() { printf '\033[36m[Hermes Mobile]\033[0m %s\n' "$*"; }
ok() { printf '\033[32m[OK]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[!]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'EOF'
Usage: install-hermes-mobile-gateway.sh [install|status|uninstall] [options]

Options:
  --hermes PATH       Explicit Hermes executable path.
  --hermes-home PATH  Explicit Hermes home directory.
  --tailscale-ip IP   Explicit local Tailscale IPv4 address.
  --port PORT         Gateway port (default: 9119).
  --username NAME     Username for first-time basic authentication setup.
  --skip-auth-setup   Do not create basic auth; use only with an existing
                      Hermes OAuth or basic-auth provider.
  -h, --help          Show this help.

Install creates a per-user LaunchAgent. It binds Hermes only to this Mac's
Tailscale 100.64.0.0/10 address and never exposes port 9119 publicly.
EOF
}

while (($#)); do
  case "$1" in
    install|status|uninstall) MODE="$1" ;;
    --hermes) HERMES_EXE="${2:?--hermes requires a path}"; shift ;;
    --hermes-home) HERMES_HOME_OVERRIDE="${2:?--hermes-home requires a path}"; shift ;;
    --tailscale-ip) TAILSCALE_IP="${2:?--tailscale-ip requires an address}"; shift ;;
    --port) PORT="${2:?--port requires a number}"; shift ;;
    --username) USERNAME="${2:?--username requires a name}"; shift ;;
    --skip-auth-setup) SKIP_AUTH_SETUP=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown argument: $1. Run with --help for usage." ;;
  esac
  shift
done

[[ "$PORT" =~ ^[0-9]+$ ]] && ((PORT >= 1 && PORT <= 65535)) || die '--port must be 1 through 65535.'
[[ "$(uname -s)" == "Darwin" ]] || die 'This installer is for macOS. Use install-hermes-mobile-gateway.ps1 on Windows.'

resolve_home() {
  local candidate resolved parent
  for candidate in "$HERMES_HOME_OVERRIDE" "$HOME/.hermes" "${HERMES_HOME:-}" "$HOME/Library/Application Support/hermes"; do
    [[ -n "$candidate" && -d "$candidate" ]] || continue
    resolved="$(cd "$candidate" && pwd -P)"
    parent="$(dirname "$resolved")"
    if [[ "$(basename "$parent")" == 'profiles' ]]; then
      dirname "$parent"
    else
      printf '%s\n' "$resolved"
    fi
    return
  done
  die "Could not locate Hermes home. Install Hermes Desktop/Agent first, or rerun with --hermes-home '/path/to/hermes'."
}

resolve_hermes() {
  local candidate
  for candidate in "$HERMES_EXE" "$(command -v hermes 2>/dev/null || true)" "$RESOLVED_HOME/hermes-agent/venv/bin/hermes" "$HOME/.local/bin/hermes"; do
    [[ -n "$candidate" && -x "$candidate" ]] || continue
    if "$candidate" serve --help >/dev/null 2>&1; then
      cd "$(dirname "$candidate")" && printf '%s/%s\n' "$(pwd -P)" "$(basename "$candidate")"
      return
    fi
  done
  die "Could not locate a working Hermes executable. Install Hermes Desktop/Agent first, add 'hermes' to PATH, or rerun with --hermes '/path/to/hermes'."
}

resolve_tailscale() {
  if command -v tailscale >/dev/null 2>&1; then command -v tailscale; return; fi
  if [[ -x '/Applications/Tailscale.app/Contents/MacOS/Tailscale' ]]; then printf '%s\n' '/Applications/Tailscale.app/Contents/MacOS/Tailscale'; return; fi
  die 'Tailscale was not found. Install and sign in to Tailscale first: https://tailscale.com/download/mac'
}

is_tailscale_ipv4() {
  awk -v ip="$1" 'BEGIN { n=split(ip,a,"."); exit !(n==4 && a[1]==100 && a[2]>=64 && a[2]<=127 && a[3]>=0 && a[3]<=255 && a[4]>=0 && a[4]<=255 && a[1] ~ /^[0-9]+$/ && a[2] ~ /^[0-9]+$/ && a[3] ~ /^[0-9]+$/ && a[4] ~ /^[0-9]+$/) }'
}

local_tailscale_ips() {
  "$TAILSCALE_BIN" ip -4 2>/dev/null | while IFS= read -r address; do is_tailscale_ipv4 "$address" && printf '%s\n' "$address"; done
}

resolve_ip() {
  local candidate addresses
  addresses="$(local_tailscale_ips)"
  [[ -n "$addresses" ]] || die 'No usable Tailscale 100.64.0.0/10 IPv4 address was found. Open Tailscale, sign in, then retry.'
  if [[ -n "$TAILSCALE_IP" ]]; then
    candidate="$TAILSCALE_IP"
    is_tailscale_ipv4 "$candidate" || die '--tailscale-ip must be a valid Tailscale IPv4 address in 100.64.0.0/10.'
    printf '%s\n' "$addresses" | grep -Fx -- "$candidate" >/dev/null || die "--tailscale-ip $candidate is not currently assigned to this Mac's Tailscale interface."
    printf '%s\n' "$candidate"
  else
    printf '%s\n' "$addresses" | head -n 1
  fi
}

dotenv_value() {
  local key="$1"
  [[ -f "$ENV_FILE" ]] || return 0
  grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -n 1 | cut -d= -f2- || true
}

set_dotenv_value() {
  local key="$1" value="$2" temp
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || die "$key cannot contain a newline."
  mkdir -p "$(dirname "$ENV_FILE")"
  touch "$ENV_FILE"
  temp="$(mktemp "${ENV_FILE}.XXXXXX")"
  grep -Ev "^${key}=" "$ENV_FILE" > "$temp" || true
  printf '%s=%s\n' "$key" "$value" >> "$temp"
  mv "$temp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

configure_auth() {
  local existing_user existing_password existing_secret password confirmation secret
  existing_user="$(dotenv_value HERMES_DASHBOARD_BASIC_AUTH_USERNAME)"
  existing_password="$(dotenv_value HERMES_DASHBOARD_BASIC_AUTH_PASSWORD)"
  existing_secret="$(dotenv_value HERMES_DASHBOARD_BASIC_AUTH_SECRET)"
  if [[ -n "$existing_user" && -n "$existing_password" && -n "$existing_secret" ]]; then
    ok 'Existing Hermes basic-auth credentials found; preserving them.'
    return
  fi
  if ((SKIP_AUTH_SETUP)); then
    warn 'Skipping basic-auth setup. Final verification will fail unless Hermes already advertises another authenticated provider.'
    return
  fi
  info 'Hermes Mobile needs an authenticated host gateway. Create credentials for this trusted Tailnet only.'
  if [[ -z "$USERNAME" ]]; then
    read -r -p 'Gateway username [admin]: ' USERNAME
    USERNAME="${USERNAME:-admin}"
  fi
  [[ "$USERNAME" != *$'\n'* && "$USERNAME" != *'='* ]] || die 'Gateway username cannot contain a newline or =.'
  while :; do
    read -r -s -p 'Gateway password: ' password; printf '\n'
    read -r -s -p 'Confirm gateway password: ' confirmation; printf '\n'
    [[ -n "$password" ]] || { warn 'Password cannot be empty.'; continue; }
    [[ "$password" == "$confirmation" ]] || { warn 'Passwords did not match. Try again.'; continue; }
    break
  done
  secret="$(openssl rand -base64 32)" || die 'Could not generate a gateway signing secret with openssl.'
  set_dotenv_value HERMES_DASHBOARD_BASIC_AUTH_USERNAME "$USERNAME"
  set_dotenv_value HERMES_DASHBOARD_BASIC_AUTH_PASSWORD "$password"
  set_dotenv_value HERMES_DASHBOARD_BASIC_AUTH_SECRET "$secret"
  unset password confirmation secret
  ok "Configured authenticated gateway credentials in $ENV_FILE. Password and secret were not printed."
}

xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&apos;/g"
}

install_launch_agent() {
  local plist_dir="$HOME/Library/LaunchAgents" home_xml exe_xml ip_xml log_dir log_xml
  PLIST="$plist_dir/$LABEL.plist"
  log_dir="$RESOLVED_HOME/logs"
  mkdir -p "$plist_dir" "$log_dir"
  home_xml="$(xml_escape "$RESOLVED_HOME")"; exe_xml="$(xml_escape "$RESOLVED_HERMES")"; ip_xml="$(xml_escape "$RESOLVED_IP")"; log_xml="$(xml_escape "$log_dir")"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$exe_xml</string><string>serve</string><string>--host</string><string>$ip_xml</string><string>--port</string><string>$PORT</string>
  </array>
  <key>EnvironmentVariables</key><dict><key>HERMES_HOME</key><string>$home_xml</string></dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>$log_xml/hermes-mobile-gateway.out.log</string>
  <key>StandardErrorPath</key><string>$log_xml/hermes-mobile-gateway.err.log</string>
</dict></plist>
EOF
  plutil -lint "$PLIST" >/dev/null || die "Generated LaunchAgent plist is invalid: $PLIST"
  chmod 600 "$PLIST"
  launchctl bootout "gui/$LAUNCH_UID" "$PLIST" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$LAUNCH_UID" "$PLIST"
  launchctl kickstart -k "gui/$LAUNCH_UID/$LABEL"
  ok "Installed and started per-user LaunchAgent $LABEL."
}

listener_report() {
  /usr/sbin/lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -Fpcn 2>/dev/null || true
}

assert_no_foreign_listener() {
  local listeners
  listeners="$(listener_report)"
  [[ -z "$listeners" ]] || die "Port $PORT is already listening. Stop the existing service first; the installer will not replace an unknown or broad listener. Details: $(printf '%s' "$listeners" | tr '\n' ' ')"
}

assert_private_hermes_listener() {
  local listeners socket_names pids pid command socket
  listeners="$(listener_report)"
  socket_names="$(printf '%s\n' "$listeners" | sed -n 's/^n//p')"
  [[ -n "$socket_names" ]] || return 1
  while IFS= read -r socket; do
    [[ "$socket" == "$RESOLVED_IP:$PORT" ]] || return 1
  done <<< "$socket_names"
  pids="$(printf '%s\n' "$listeners" | sed -n 's/^p//p')"
  for pid in $pids; do
    command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    [[ "$command" == *hermes*serve* ]] || return 1
  done
}

test_gateway() {
  local url="http://$RESOLVED_IP:$PORT/api/status" response attempt
  for attempt in $(seq 1 20); do
    if assert_private_hermes_listener >/dev/null 2>&1; then
      response="$(curl --fail --silent --show-error --connect-timeout 3 "$url" 2>/dev/null || true)"
      if printf '%s' "$response" | grep -Eq '"auth_required"[[:space:]]*:[[:space:]]*true'; then
        ok "Authenticated Hermes gateway is exclusively bound at $url"
        return
      fi
    fi
    sleep 1
  done
  die "Gateway did not become safely reachable at $url. Inspect $RESOLVED_HOME/logs/hermes-mobile-gateway.err.log, then run '$0 status'."
}

show_status() {
  local healthy=0 response
  info "Hermes home: $RESOLVED_HOME"
  info "Hermes executable: $RESOLVED_HERMES"
  info "Tailscale gateway URL: http://$RESOLVED_IP:$PORT"
  if launchctl print "gui/$LAUNCH_UID/$LABEL" >/dev/null 2>&1; then ok "LaunchAgent $LABEL is loaded."; else warn "LaunchAgent $LABEL is not loaded."; healthy=1; fi
  "$RESOLVED_HERMES" serve --status || true
  if ! assert_private_hermes_listener >/dev/null 2>&1; then warn 'Gateway listener is missing, broad, or not Hermes-owned.'; healthy=1; fi
  response="$(curl --fail --silent --connect-timeout 3 "http://$RESOLVED_IP:$PORT/api/status" 2>/dev/null || true)"
  if printf '%s' "$response" | grep -Eq '"auth_required"[[:space:]]*:[[:space:]]*true'; then ok 'Gateway API: reachable and authenticated.'; else warn 'Gateway API is unreachable or unauthenticated.'; healthy=1; fi
  return "$healthy"
}

LAUNCH_UID="$(id -u)"
PLIST="${HOME}/Library/LaunchAgents/$LABEL.plist"

if [[ "$MODE" == 'uninstall' ]]; then
  launchctl bootout "gui/$LAUNCH_UID" "$PLIST" >/dev/null 2>&1 || true
  rm -f "$PLIST"
  ok "Removed $LABEL. Existing Hermes credentials were preserved."
  exit 0
fi

RESOLVED_HOME="$(resolve_home)"
RESOLVED_HERMES="$(resolve_hermes)"
TAILSCALE_BIN="$(resolve_tailscale)"
RESOLVED_IP="$(resolve_ip)"
ENV_FILE="$RESOLVED_HOME/.env"

case "$MODE" in
  status) show_status ;;
  install)
    if launchctl print "gui/$LAUNCH_UID/$LABEL" >/dev/null 2>&1; then
      launchctl bootout "gui/$LAUNCH_UID" "$PLIST" >/dev/null 2>&1 || true
      sleep 1
    fi
    assert_no_foreign_listener
    configure_auth
    install_launch_agent
    test_gateway
    printf '\n'
    ok "Hermes Mobile host setup is complete. On your phone, enter: http://$RESOLVED_IP:$PORT"
    warn 'This gateway is restricted to your private Tailscale network. Do not expose port 9119 directly to the public internet.'
    ;;
esac
