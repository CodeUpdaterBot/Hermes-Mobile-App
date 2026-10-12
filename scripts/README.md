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
- that listener is the whole phone-facing stack: a non-loopback bind makes it require authentication, and being an ordinary Hermes runtime it also carries the chats that are open on the Hermes Desktop, through the session-attach relay;
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

## Development stack (this clone)

These scripts are for developing and testing the client, not for host installs. The installers above
need none of them.

- `start-hermes-mobile-stack.ps1` — idempotent start/stop for the dev companion stack: an
  authenticated gateway on `127.0.0.1:9120` plus `hermes-session-forwarder.py` on `0.0.0.0:9119`, both
  launched detached so a Hermes Desktop restart cannot take them down. Use `-Stop` to shut it down.
  Never hand-start the two pieces.
- `hermes-session-forwarder.py` — the phone's dev endpoint. It forwards each connection to the
  advertised session runtime, but **never to one that cannot authenticate a remote client**: it probes
  `/api/status` and skips any candidate reporting `auth_required: false` (the Desktop's own backend is
  deliberately exempt from the ticket gate), falling through to the authenticated gateway, which
  reaches that runtime's sessions through the session-attach relay. `--no-require-auth` restores the
  old behaviour.
- `verify-session-attach-relay.py` + `attach-owner-standin.py` — end-to-end proof of the relay against
  a stand-in runtime that genuinely holds a session lease in a throwaway `HERMES_HOME` (no real chat
  is touched). Run recipe and assertions are in the script docstring.

## Pair the phone

After an installer succeeds, use the printed address in Hermes Mobile’s
**Settings → Security & Pairing** screen:

```text
http://<tailscale-ip>:9119
```

Test the gateway first, then sign in. A successful connection requires both
an authenticated REST response and authenticated Gateway WebSocket readiness.
