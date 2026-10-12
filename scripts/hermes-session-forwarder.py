#!/usr/bin/env python3
"""Front the *live* Hermes session runtime on a stable TCP port.

Hermes allows exactly ONE live process to drive a session's turns, recorded in a
per-profile lease registry. The Hermes Desktop spawns its own runtime for its chats
(``hermes serve --host 127.0.0.1 --port 0``), so it owns those sessions — and a second
runtime, such as the gateway this device supplies, is refused with "This chat is open in
another Hermes window/terminal".

A runtime now advertises its own origin as ``metadata.shared_runtime_url`` on its lease
(see ``tui_gateway/session_lifecycle.py``). This forwarder turns that advertisement into a
reachable endpoint: it listens on the Tailscale-facing port the phone already uses and
forwards each connection to whichever runtime currently owns the sessions, falling back to
the local gateway when the Desktop is closed and nothing is advertised.

The phone therefore keeps ONE endpoint and lands on the Desktop's own runtime whenever the
Desktop is open — so tapping a Bot on the phone resumes the chat that is open on the
desktop, instead of being refused.

Nothing here changes Hermes' exclusivity rule: exactly one process drives a session. The
forwarder only decides which process the phone's socket reaches.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import socket
import socketserver
import sys
import threading
import time
import urllib.parse

CONNECT_TIMEOUT = 2.0
RESOLVE_TTL = 1.0


def _pid_alive(pid: object) -> bool:
    """Best-effort liveness for a lease's owning pid (Windows + POSIX, stdlib only)."""
    try:
        value = int(pid)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return False
    if value <= 0:
        return False
    if sys.platform == "win32":
        import ctypes

        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        handle = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, value)
        if not handle:
            return False
        ctypes.windll.kernel32.CloseHandle(handle)
        return True
    try:
        import os

        os.kill(value, 0)
        return True
    except OSError:
        return False


def advertised_targets(home: str | pathlib.Path) -> list[tuple[str, int]]:
    """Every advertised runtime origin, newest first.

    Stale leases are not filtered here: liveness is proven by actually connecting, which is
    both cheaper and more truthful than trusting a registry entry.
    """
    found: list[tuple[float, int, str, int]] = []
    pattern = pathlib.Path(home).glob("profiles/*/runtime/active_sessions.json")
    for path in pattern:
        try:
            entries = json.loads(path.read_text(encoding="utf-8")).get("entries") or []
        except Exception:
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            url = str((entry.get("metadata") or {}).get("shared_runtime_url") or "").strip()
            if not url:
                continue
            parsed = urllib.parse.urlsplit(url)
            if parsed.scheme not in ("http", "https") or not parsed.hostname or not parsed.port:
                continue
            if not _pid_alive(entry.get("pid")):
                continue
            age = float(entry.get("updated_at") or entry.get("started_at") or 0.0)
            found.append((age, int(entry["pid"]), parsed.hostname, int(parsed.port)))
    found.sort(key=lambda item: item[0], reverse=True)
    return [(host, port) for _age, _pid, host, port in found]


def connectable(host: str, port: int, timeout: float = CONNECT_TIMEOUT) -> socket.socket | None:
    try:
        sock = socket.create_connection((host, port), timeout=timeout)
    except OSError:
        return None
    sock.settimeout(None)
    return sock


class Resolver:
    """Caches which target is currently serving, refreshing at most once per second."""

    def __init__(self, home: str, fallback: tuple[str, int]):
        self.home = home
        self.fallback = fallback
        self._lock = threading.Lock()
        self._target: tuple[str, int] | None = None
        self._checked_at = 0.0

    def target(self) -> tuple[str, int]:
        with self._lock:
            now = time.monotonic()
            if self._target is not None and now - self._checked_at < RESOLVE_TTL:
                return self._target
            self._checked_at = now
            for candidate in advertised_targets(self.home):
                probe = connectable(*candidate, timeout=0.4)
                if probe is not None:
                    probe.close()
                    self._target = candidate
                    return self._target
            self._target = self.fallback
            return self._target


class Handler(socketserver.BaseRequestHandler):
    def handle(self) -> None:
        target = self.server.resolver.target()  # type: ignore[attr-defined]
        upstream = connectable(*target)
        if upstream is None:
            return
        log = self.server.log  # type: ignore[attr-defined]
        log("forwarding a connection to %s:%s" % target)
        try:
            _pipe_both(self.request, upstream)
        finally:
            try:
                upstream.close()
            except OSError:
                pass


def _pipe_both(client: socket.socket, upstream: socket.socket) -> None:
    """Pump both directions until either side closes (HTTP keep-alive and WS both survive)."""
    done = threading.Event()

    def pump(src: socket.socket, dst: socket.socket) -> None:
        try:
            while not done.is_set():
                chunk = src.recv(65536)
                if not chunk:
                    break
                dst.sendall(chunk)
        except OSError:
            pass
        finally:
            done.set()

    threads = [
        threading.Thread(target=pump, args=(client, upstream), daemon=True),
        threading.Thread(target=pump, args=(upstream, client), daemon=True),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main() -> int:
    parser = argparse.ArgumentParser(description="Front the live Hermes session runtime on a stable TCP port.")
    parser.add_argument("--home", default=str(pathlib.Path.home() / ".hermes"),
                        help="Hermes home holding profiles/*/runtime/active_sessions.json")
    parser.add_argument("--listen-host", default="0.0.0.0")
    parser.add_argument("--listen-port", type=int, default=9119)
    parser.add_argument("--fallback-host", default="127.0.0.1")
    parser.add_argument("--fallback-port", type=int, default=9120)
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    def log(message: str) -> None:
        if not args.quiet:
            print("%s %s" % (time.strftime("%H:%M:%S"), message), flush=True)

    resolver = Resolver(args.home, (args.fallback_host, args.fallback_port))
    with Server((args.listen_host, args.listen_port), Handler) as server:
        server.resolver = resolver  # type: ignore[attr-defined]
        server.log = log  # type: ignore[attr-defined]
        log("listening on %s:%s -> advertised runtime, else %s:%s"
            % (args.listen_host, args.listen_port, args.fallback_host, args.fallback_port))
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
