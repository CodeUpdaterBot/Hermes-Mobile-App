# Hermes Mobile host gateway installers

Hermes Mobile is a secure client for an existing Hermes host. A phone must reach
an authenticated `hermes serve` gateway; it cannot use the host's loopback-only
Desktop backend directly.

These installers create a private gateway over **Tailscale only**. On Windows,
Hermes uses the runtime-compatible wildcard bind while Windows Firewall limits
TCP `9119` to the host's `100.64.0.0/10` Tailscale peers; on macOS, the
LaunchAgent binds directly to the local Tailscale address. Neither path opens
port 9119 to the public internet.

## Before starting

1. Install and sign in to [Tailscale](https://tailscale.com/download) on both
   the Hermes host and phone.
2. Install [Hermes Agent / Hermes Desktop](https://hermes-agent.nousresearch.com/)
   on the host and complete its initial setup.
3. Do not expose TCP `9119` to the public internet. Use Tailscale or a separately
   designed authenticated HTTPS/OAuth deployment instead.

The installer preserves an existing Hermes OAuth/basic-auth provider. If no
basic provider is found in the host `.env`, it prompts once for a username and
password and generates the stable signing secret required for sessions to survive
restarts. Passwords and secrets are never printed; the phone stores only revocable
native secure-storage tokens after pairing.

## Windows

Run `setup-hermes-tailscale-gateway.cmd` by right-clicking it and choosing
**Run as administrator**. It launches the portable PowerShell installer and
requests UAC elevation.

The installer:

- discovers `hermes.exe` from PATH or common Hermes homes;
- discovers the local Tailscale IP;
- supports explicit `-HermesExecutable`, `-HermesHome`, and `-TailscaleIP`
  overrides when discovery cannot find a nonstandard installation;
- starts one `hermes serve` listener on `0.0.0.0`, protected by a Windows Firewall rule restricted to `100.64.0.0/10`;
- writes a small per-user runner under the detected Hermes home;
- creates a per-user, login-start Scheduled Task with bounded restart attempts;
- verifies `http://<tailscale-ip>:9119/api/status`, requires `auth_required: true`, and fails status/install if the listener is duplicated, foreign, or not owned by `hermes serve`.

For advanced control, run from an elevated PowerShell prompt:

```powershell
.\scripts\install-hermes-mobile-gateway.ps1 -Mode Install
.\scripts\install-hermes-mobile-gateway.ps1 -Mode Status
.\scripts\install-hermes-mobile-gateway.ps1 -Mode Uninstall
```

If Hermes is not discovered, install Hermes first or provide the explicit path:

```powershell
.\scripts\install-hermes-mobile-gateway.ps1 `
  -HermesExecutable 'C:\path\to\hermes.exe' `
  -HermesHome 'C:\path\to\hermes'
```

`Uninstall` removes only the Hermes Mobile Scheduled Task, runner, and private
firewall rule. It intentionally preserves Hermes credentials and does not stop
unrelated Hermes servers.

## macOS

From the project directory:

```bash
chmod +x scripts/install-hermes-mobile-gateway.sh
./scripts/install-hermes-mobile-gateway.sh install
./scripts/install-hermes-mobile-gateway.sh status
./scripts/install-hermes-mobile-gateway.sh uninstall
```

The macOS installer:

- discovers `hermes` from PATH or common Hermes homes;
- discovers the Mac's Tailscale IP;
- binds Hermes directly to that private address rather than `0.0.0.0`;
- creates a per-user `launchd` LaunchAgent named `com.hermesmobile.gateway`;
- logs under `<HERMES_HOME>/logs/`;
- verifies the authenticated `/api/status` endpoint and rejects a broad, foreign, or non-Hermes listener on the gateway port.

No Windows-style firewall command is needed on macOS. Binding directly to the
Tailscale interface keeps the server off ordinary LAN/public interfaces. If
macOS displays an application-firewall prompt for Hermes, allow access only for
the trusted local Hermes executable.

For nonstandard installs:

```bash
./scripts/install-hermes-mobile-gateway.sh install \
  --hermes /path/to/hermes \
  --hermes-home /path/to/hermes-home \
  --tailscale-ip 100.x.y.z
```

`uninstall` removes only the LaunchAgent and leaves Hermes credentials intact.

## Linux

From the project directory on a systemd-based Linux distribution:

```bash
chmod +x scripts/install-hermes-mobile-gateway-linux.sh
./scripts/install-hermes-mobile-gateway-linux.sh install
./scripts/install-hermes-mobile-gateway-linux.sh status
./scripts/install-hermes-mobile-gateway-linux.sh uninstall
```

The Linux installer is separate from the macOS script. It:

- discovers `hermes` from PATH, `~/.local/bin`, standard system locations, or the Hermes home;
- discovers the host's assigned Tailscale IPv4 address;
- binds `hermes serve` only to that private Tailscale address—never `0.0.0.0`;
- writes a per-user systemd service at `~/.config/systemd/user/hermes-mobile-gateway.service`;
- configures/preserves authenticated Hermes basic auth and restricts the credential file to the user;
- verifies one Hermes-owned private listener plus authenticated `/api/status` before reporting success;
- preserves Hermes credentials during uninstall.

For a desktop user, the service starts with their systemd user session. For an always-on host that must remain reachable after logout, explicitly opt in to user lingering:

```bash
./scripts/install-hermes-mobile-gateway-linux.sh install --enable-linger
```

If the host uses nonstandard locations, pass them directly:

```bash
./scripts/install-hermes-mobile-gateway-linux.sh install \
  --hermes /path/to/hermes \
  --hermes-home /path/to/hermes-home \
  --tailscale-ip 100.x.y.z
```

This installer requires Linux systemd, Tailscale, `curl`, `ss`, and `openssl`. It fails closed when a per-user systemd manager, authenticated gateway, private Tailscale bind, or listener ownership cannot be verified.

If the installer exits silently with no output, the `.env` is missing the basic-auth keys it looks up first (known bug, see issue #2). Pre-seed them, then rerun:

```bash
printf 'HERMES_DASHBOARD_BASIC_AUTH_USERNAME=%s\nHERMES_DASHBOARD_BASIC_AUTH_PASSWORD=%s\nHERMES_DASHBOARD_BASIC_AUTH_SECRET=%s\n' \
  "admin" "$(openssl rand -hex 16)" "$(openssl rand -base64 32)" >> ~/.hermes/.env
chmod 600 ~/.hermes/.env
```

### Serve the gateway over HTTPS (required for phone chat)

The phone app runs in a secure WebView context, so its chat socket must be `wss://`. A plain `http://100.x:9119` address will pass the gateway test and sign-in, but live chat can never connect. Expose the gateway over your Tailnet with TLS instead — no public internet involved.

Same-Tailnet access only: `tailscale serve --https` serves the URL to devices
in the same Tailnet (subject to your Tailnet ACLs). Do not enable Tailscale
Funnel or otherwise publish it to the public internet. Scope ACLs to the
people/devices that should reach the host (for example, your own user tag),
and keep port `9119` itself private — phones reach the `https://` Serve URL,
never the raw `http://100.x:9119` listener directly.

Gateway authentication is still required: Tailscale identity does not replace
Hermes credentials. The Hermes gateway must still report `auth_required: true`
(and `native_pkce` for phone sign-in), and the phone must still pair with its
Hermes username/password or device flow. Tokens remain revocable Hermes
credentials stored in Android secure storage.

Declare the public name first so the backend trusts it, then restart the
gateway service afterwards, otherwise requests fail with
`400 Invalid Host header`:

```bash
hermes config set dashboard.public_url https://<machine>.<tailnet>.ts.net
systemctl --user restart hermes-mobile-gateway.service
```

Then serve the local proxy below (not the gateway directly) over Tailnet TLS:

```bash
sudo tailscale serve --bg --https=443 http://127.0.0.1:8080
```

The first run prints a one-time approval link for the Tailnet admin. The phone address becomes (no port):

```text
https://<machine>.<tailnet>.ts.net
```

Verify Serve status with `tailscale serve status` — it should show
`https://<machine>.<tailnet>.ts.net` proxied to `http://127.0.0.1:8080`.

Troubleshooting: if sign-in succeeds but chat still won't connect on a recent backend, its WebSocket origin guard is rejecting the app's origin even over `wss`. Front the gateway with a same-host loopback reverse proxy and point Tailscale Serve at the proxy. The proxy presents the public hostname in `Host` and forwards only explicitly allowlisted `Origin` values (disallowed origins become empty and are rejected by the backend instead of being spoofed with a blanket rewrite).

Complete runnable nginx example (replace `<machine>`, `<tailnet>`, and `<tailscale-ip>`; proxy listens only on loopback):

```nginx
# /etc/nginx/sites-available/hermes-gateway
map $http_origin $hermes_origin {
    default "";
    "https://<machine>.<tailnet>.ts.net" $http_origin;
}

server {
    listen 127.0.0.1:8080;
    server_name <machine>.<tailnet>.ts.net;

    location / {
        proxy_pass http://<tailscale-ip>:9119;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host <machine>.<tailnet>.ts.net;
        # Explicit safe allowlist: only the public Tailnet origin above is
        # forwarded. All other origins arrive empty and fail the backend
        # origin guard instead of being rewritten into a trusted value.
        proxy_set_header Origin $hermes_origin;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

Enable and verify before pointing Serve at it:

```bash
sudo ln -s /etc/nginx/sites-available/hermes-gateway /etc/nginx/sites-enabled/hermes-gateway
sudo nginx -t && sudo systemctl reload nginx
curl -H "Host: <machine>.<tailnet>.ts.net" http://127.0.0.1:8080/api/status
sudo tailscale serve --bg --https=443 http://127.0.0.1:8080
```

## Pair the phone

After an installer succeeds, use the printed address in Hermes Mobile’s
**Settings → Security & Pairing** screen. Prefer the HTTPS address when one is served (required for chat on phones):

```text
https://<machine>.<tailnet>.ts.net
```

or the direct Tailscale address (gateway test only — phone chat needs `wss://`):

```text
http://<tailscale-ip>:9119
```

Test the gateway first, then sign in. A successful connection requires both
an authenticated REST response and authenticated Gateway WebSocket readiness.
