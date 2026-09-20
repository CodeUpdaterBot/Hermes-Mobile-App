#!/usr/bin/env bash
# Installs a private, authenticated Hermes gateway for Hermes Mobile on Linux.
# The gateway binds only to the local Tailscale IPv4 address and runs as a
# per-user systemd service. It never opens TCP 9119 to public/LAN interfaces.
set -euo pipefail

MODE="install"
HERMES_EXE=""
HERMES_HOME_OVERRIDE=""
TAILSCALE_IP=""
PORT="9119"
USERNAME=""
SKIP_AUTH_SETUP=0
ENABLE_LINGER=0
UNIT_NAME="hermes-mobile-gateway.service"
RUNTIME_DIR="$HOME/.local/share/hermes-mobile-gateway"
RUNNER_PATH="$RUNTIME_DIR/run"
RUNTIME_ENV="$RUNTIME_DIR/gateway.env"
PYTHON_BIN=""

info() { printf '\033[36m[Hermes Mobile]\033[0m %s\n' "$*"; }
ok() { printf '\033[32m[OK]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[!]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'EOF'
Usage: install-hermes-mobile-gateway-linux.sh [install|status|uninstall] [options]

Options:
  --hermes PATH       Explicit Hermes executable path.
  --hermes-home PATH  Explicit Hermes home directory.
  --tailscale-ip IP   Explicit local Tailscale IPv4 address.
  --port PORT         Gateway port (default: 9119).
  --username NAME     Username for first-time basic authentication setup.
  --skip-auth-setup   Do not create basic auth; use only with an existing
                      Hermes OAuth or basic-auth provider.
  --enable-linger     Keep the per-user service running after logout. This may
                      require sudo/loginctl privileges on your distribution.
  -h, --help          Show this help.

Install creates ~/.config/systemd/user/hermes-mobile-gateway.service. Hermes
binds only to the host's assigned Tailscale 100.64.0.0/10 IPv4 address, so
TCP 9119 is not bound to ordinary LAN or public interfaces.
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
    --enable-linger) ENABLE_LINGER=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown argument: $1. Run with --help for usage." ;;
  esac
  shift
done

[[ "$PORT" =~ ^[0-9]+$ ]] && ((PORT >= 1 && PORT <= 65535)) || die '--port must be 1 through 65535.'
[[ "$(uname -s)" == "Linux" ]] || die 'This installer is for Linux. Use install-hermes-mobile-gateway.ps1 on Windows or install-hermes-mobile-gateway.sh on macOS.'
command -v systemctl >/dev/null 2>&1 || die 'systemd/systemctl is required for this Linux installer. Use your distribution’s supported service manager or install systemd first.'
command -v curl >/dev/null 2>&1 || die 'curl is required for authenticated gateway verification.'
command -v ss >/dev/null 2>&1 || die 'ss (usually provided by iproute2) is required for listener verification.'
PYTHON_BIN="$(command -v python3 2>/dev/null || command -v python 2>/dev/null || true)"
[[ -n "$PYTHON_BIN" ]] || die 'python3 or python is required to validate Hermes gateway status JSON.'
systemctl --user show-environment >/dev/null 2>&1 || die 'A per-user systemd manager is not available. Log in through a systemd user session, then retry.'

resolve_home() {
  local candidate resolved parent
  for candidate in "$HERMES_HOME_OVERRIDE" "${HERMES_HOME:-}" "$HOME/.hermes" "$HOME/.local/share/hermes"; do
    [[ -n "$candidate" && -d "$candidate" ]] || continue
    resolved="$(cd "$candidate" && pwd -P)"
    parent="$(dirname "$resolved")"
    if [[ "$(basename "$parent")" == 'profiles' ]]; then dirname "$parent"; else printf '%s\n' "$resolved"; fi
    return
  done
  die "Could not locate Hermes home. Install Hermes Agent first, or rerun with --hermes-home '/path/to/hermes'."
}

resolve_hermes() {
  local candidate
  for candidate in "$HERMES_EXE" "$(command -v hermes 2>/dev/null || true)" "$RESOLVED_HOME/hermes-agent/venv/bin/hermes" "$HOME/.local/bin/hermes" "/usr/local/bin/hermes" "/usr/bin/hermes"; do
    [[ -n "$candidate" && -x "$candidate" ]] || continue
    if "$candidate" serve --help >/dev/null 2>&1; then
      cd "$(dirname "$candidate")" && printf '%s/%s\n' "$(pwd -P)" "$(basename "$candidate")"
      return
    fi
  done
  die "Could not locate a working Hermes executable. Install Hermes Agent first, add 'hermes' to PATH, or rerun with --hermes '/path/to/hermes'."
}

resolve_tailscale() {
  for candidate in "$(command -v tailscale 2>/dev/null || true)" /usr/bin/tailscale /usr/local/bin/tailscale /snap/bin/tailscale; do
    [[ -n "$candidate" && -x "$candidate" ]] && { printf '%s\n' "$candidate"; return; }
  done
  die 'Tailscale was not found. Install and sign in to Tailscale first: https://tailscale.com/download/linux'
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
    printf '%s\n' "$addresses" | grep -Fx -- "$candidate" >/dev/null || die "--tailscale-ip $candidate is not currently assigned to this Linux host's Tailscale interface."
    printf '%s\n' "$candidate"
  else
    [[ "$(printf '%s\n' "$addresses" | wc -l | tr -d ' ')" == '1' ]] || die 'More than one usable Tailscale IPv4 address was found. Rerun with --tailscale-ip and choose the address this host should use.'
    printf '%s\n' "$addresses"
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
  if [[ -n "$existing_user" && -n "$existing_password" && -n "$existing_secret" ]]; then ok 'Existing Hermes basic-auth credentials found; preserving them.'; return; fi
  if ((SKIP_AUTH_SETUP)); then warn 'Skipping basic-auth setup. Final verification will fail unless Hermes already advertises another authenticated provider.'; return; fi
  info 'Hermes Mobile needs an authenticated host gateway. Create credentials for this trusted Tailnet only.'
  if [[ -z "$USERNAME" ]]; then read -r -p 'Gateway username [admin]: ' USERNAME; USERNAME="${USERNAME:-admin}"; fi
  [[ "$USERNAME" != *$'\n'* && "$USERNAME" != *'='* ]] || die 'Gateway username cannot contain a newline or =.'
  while :; do
    read -r -s -p 'Gateway password: ' password; printf '\n'
    read -r -s -p 'Confirm gateway password: ' confirmation; printf '\n'
    [[ -n "$password" ]] || { warn 'Password cannot be empty.'; continue; }
    [[ "$password" == "$confirmation" ]] || { warn 'Passwords did not match. Try again.'; continue; }
    break
  done
  command -v openssl >/dev/null 2>&1 || die 'openssl is required to generate the gateway signing secret.'
  secret="$(openssl rand -base64 32)" || die 'Could not generate a gateway signing secret with openssl.'
  set_dotenv_value HERMES_DASHBOARD_BASIC_AUTH_USERNAME "$USERNAME"
  set_dotenv_value HERMES_DASHBOARD_BASIC_AUTH_PASSWORD "$password"
  set_dotenv_value HERMES_DASHBOARD_BASIC_AUTH_SECRET "$secret"
  unset password confirmation secret
  ok "Configured authenticated gateway credentials in $ENV_FILE. Password and secret were not printed."
}

unit_escape() { printf '%s' "$1" | sed -e 's/\\\\/\\\\\\\\/g' -e 's/"/\\\\"/g' -e 's/%/%%/g'; }

write_runtime() {
  mkdir -p "$RUNTIME_DIR"
  umask 077
  printf 'HERMES_HOME=%q\nHERMES_EXE=%q\nTAILSCALE_BIN=%q\nTAILSCALE_IP=%q\nPORT=%q\n' "$RESOLVED_HOME" "$RESOLVED_HERMES" "$TAILSCALE_BIN" "$RESOLVED_IP" "$PORT" > "$RUNTIME_ENV"
  cat > "$RUNNER_PATH" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/gateway.env"
valid_ip() { awk -v ip="$1" 'BEGIN { n=split(ip,a,"."); exit !(n==4 && a[1]==100 && a[2]>=64 && a[2]<=127 && a[3]>=0 && a[3]<=255 && a[4]>=0 && a[4]<=255) }'; }
valid_ip "$TAILSCALE_IP" || { printf 'Saved Tailscale IP is invalid: %s\n' "$TAILSCALE_IP" >&2; exit 1; }
"$TAILSCALE_BIN" ip -4 2>/dev/null | grep -Fx -- "$TAILSCALE_IP" >/dev/null || { printf 'Saved Tailscale IP is no longer assigned: %s. Rerun the Hermes Mobile Linux installer.\n' "$TAILSCALE_IP" >&2; exit 1; }
[[ "${1:-}" == '--check' ]] && exit 0
exec "$HERMES_EXE" serve --host "$TAILSCALE_IP" --port "$PORT" --skip-build
EOF
  chmod 700 "$RUNTIME_DIR" "$RUNNER_PATH"
  chmod 600 "$RUNTIME_ENV"
}

install_unit() {
  local unit_dir log_dir escaped_env escaped_runner
  unit_dir="$HOME/.config/systemd/user"
  UNIT_PATH="$unit_dir/$UNIT_NAME"
  log_dir="$RESOLVED_HOME/logs"
  mkdir -p "$unit_dir" "$log_dir"
  write_runtime
  escaped_env="$(unit_escape "$ENV_FILE")"
  escaped_runner="$(unit_escape "$RUNNER_PATH")"
  cat > "$UNIT_PATH" <<EOF
[Unit]
Description=Hermes Mobile private Tailscale gateway
Documentation=https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=3

[Service]
Type=simple
WorkingDirectory=%h
EnvironmentFile="$escaped_env"
ExecStartPre="$escaped_runner" --check
ExecStart="$escaped_runner"
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
KillSignal=SIGTERM
KillMode=control-group
UMask=0077

[Install]
WantedBy=default.target
EOF
  chmod 600 "$UNIT_PATH"
  systemctl --user daemon-reload
  systemctl --user enable --now "$UNIT_NAME"
  ok "Installed and started per-user systemd unit $UNIT_NAME."
}

listener_lines() { ss -ltnH "sport = :$PORT" 2>/dev/null || true; }

assert_no_foreign_listener() {
  local listeners
  listeners="$(listener_lines)"
  [[ -z "$listeners" ]] || die "Port $PORT is already listening. Stop the existing service first; the installer will not replace an unknown listener. Details: $(printf '%s' "$listeners" | tr '\n' ' ')"
}

assert_private_hermes_listener() {
  local listeners count pid command
  listeners="$(listener_lines)"
  count="$(printf '%s\n' "$listeners" | grep -c -F -- "$RESOLVED_IP:$PORT" || true)"
  [[ "$count" == '1' ]] || return 1
  [[ "$(printf '%s\n' "$listeners" | wc -l | tr -d ' ')" == '1' ]] || return 1
  pid="$(systemctl --user show "$UNIT_NAME" --property MainPID --value 2>/dev/null || true)"
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  command="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
  [[ "$command" == *hermes*serve*"--host $RESOLVED_IP"*"--port $PORT"* ]]
}

status_supports_pairing() {
  "$PYTHON_BIN" -c 'import json, sys; value=json.load(sys.stdin); sys.exit(0 if value.get("auth_required") is True and "native_pkce" in value.get("auth_flows", []) else 1)'
}

test_gateway() {
  local url="http://$RESOLVED_IP:$PORT/api/status" response attempt
  for attempt in $(seq 1 20); do
    if assert_private_hermes_listener >/dev/null 2>&1; then
      response="$(curl --fail --silent --show-error --connect-timeout 3 "$url" 2>/dev/null || true)"
      if printf '%s' "$response" | status_supports_pairing; then ok "Authenticated Hermes gateway is exclusively bound at $url"; return; fi
    fi
    sleep 1
  done
  die "Gateway did not become safely reachable at $url. Inspect: journalctl --user -u $UNIT_NAME -n 100 --no-pager"
}

show_status() {
  local healthy=0 response
  info "Hermes home: $RESOLVED_HOME"
  info "Hermes executable: $RESOLVED_HERMES"
  info "Tailscale gateway URL: http://$RESOLVED_IP:$PORT"
  if systemctl --user is-active --quiet "$UNIT_NAME"; then ok "systemd unit $UNIT_NAME is active."; else warn "systemd unit $UNIT_NAME is not active."; healthy=1; fi
  if ! assert_private_hermes_listener >/dev/null 2>&1; then warn 'Gateway listener is missing, broad, or not Hermes-owned.'; healthy=1; fi
  response="$(curl --fail --silent --connect-timeout 3 "http://$RESOLVED_IP:$PORT/api/status" 2>/dev/null || true)"
  if printf '%s' "$response" | status_supports_pairing; then ok 'Gateway API: reachable, authenticated, and supports native pairing.'; else warn 'Gateway API is unreachable, unauthenticated, or lacks native pairing.'; healthy=1; fi
  return "$healthy"
}

UNIT_PATH="$HOME/.config/systemd/user/$UNIT_NAME"
if [[ "$MODE" == 'uninstall' ]]; then
  systemctl --user disable --now "$UNIT_NAME" >/dev/null 2>&1 || true
  rm -f "$UNIT_PATH"
  rm -rf "$RUNTIME_DIR"
  systemctl --user daemon-reload >/dev/null 2>&1 || true
  systemctl --user reset-failed "$UNIT_NAME" >/dev/null 2>&1 || true
  ok "Removed $UNIT_NAME. Existing Hermes credentials were preserved."
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
    if systemctl --user is-active --quiet "$UNIT_NAME"; then systemctl --user stop "$UNIT_NAME"; sleep 1; fi
    assert_no_foreign_listener
    configure_auth
    if ((ENABLE_LINGER)); then
      loginctl enable-linger "$USER" || die "Could not enable user lingering. Run: sudo loginctl enable-linger $USER"
      ok "Enabled lingering for $USER so the gateway can stay available after logout."
    fi
    install_unit
    test_gateway
    printf '\n'
    ok "Hermes Mobile host setup is complete. On your phone, enter: http://$RESOLVED_IP:$PORT"
    warn 'This gateway is restricted to your private Tailscale network. Do not expose port 9119 directly to the public internet.'
    ;;
esac
