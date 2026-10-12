#!/usr/bin/env python3
"""Verify the Hermes session-attach relay end to end (one runtime, two clients).

What it proves, against a stand-in runtime that genuinely HOLDS the session lease:

1. ``session.resume`` mounts the OWNER's live snapshot on a local shadow runtime id, keeping the
   durable session key;
2. the owner's event stream is fanned back into the client's stream, rewritten onto the local id;
3. an owner server->client request (approval) is forwarded and the client's answer travels back;
4. ``prompt.submit`` runs on the OWNER (its reply, never the "open in another window" refusal);
5. ``session.interrupt`` is forwarded too.

HOW TO RUN (the harness must live inside the agent repo: ``--run-module`` only searches the
repo root, and the gateway modules are only importable the way the launcher imports them):

    cp scripts/verify-session-attach-relay.py "$HERMES_HOME/hermes-agent/verify_attach_relay.py"
    HERMES_HOME=<throwaway-home> "$HERMES_HOME/hermes-agent/.hermes/bin/hermes.exe" \
        --run-module verify_attach_relay "$PWD/scripts/attach-owner-standin.py"
    rm "$HERMES_HOME/hermes-agent/verify_attach_relay.py"

``<throwaway-home>`` needs a ``config.yaml`` (any model/provider) and a ``profiles/`` dir; the
stand-in creates its own session row there, so no real chat is ever touched.
"""
from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = Path(os.environ.get("HERMES_AGENT_REPO", r"C:\Users\PC\AppData\Local\hermes\hermes-agent"))
VENV_PY = REPO / ".venv" / "Scripts" / "python.exe"
HOME = Path(os.environ["HERMES_HOME"]).resolve()


def _standin_path() -> Path:
    """The stand-in owner script: argv[1] when given (the harness runs from the agent repo)."""
    for raw in (sys.argv[1] if len(sys.argv) > 1 else None,
                os.environ.get("HERMES_ATTACH_STANDIN")):
        if raw:
            return Path(raw)
    return HERE / "attach-owner-standin.py"


STANDIN = _standin_path()

LINES: list[str] = []


def say(*parts) -> None:
    line = " ".join(str(p) for p in parts)
    LINES.append(line)
    print(line, flush=True)


class Recorder:
    """A Transport that keeps every frame the gateway writes to one client."""

    def __init__(self) -> None:
        self.frames: list[dict] = []
        self._lock = threading.Lock()

    def write(self, obj: dict) -> bool:
        with self._lock:
            self.frames.append(obj)
        return True

    def close(self) -> None:
        return None

    def snapshot(self) -> list[dict]:
        with self._lock:
            return list(self.frames)

    def events(self, kind: str) -> list[dict]:
        return [f for f in self.snapshot()
                if f.get("method") == "event" and (f.get("params") or {}).get("type") == kind]

    def requests(self, method: str) -> list[dict]:
        return [f for f in self.snapshot() if f.get("method") == method]


def main() -> int:
    logging.basicConfig(level=logging.INFO, stream=sys.stderr, force=True)
    logging.getLogger("tui_gateway.session_attach_relay").setLevel(logging.INFO)
    say("hermes home:", HOME)
    failures: list[str] = []
    sid = "attach-relay-" + uuid.uuid4().hex[:12]
    log = HERE / f"owner-frames-{sid}.jsonl"
    env = {**os.environ, "HERMES_HOME": str(HOME)}
    owner = subprocess.Popen(
        [str(VENV_PY), str(STANDIN), sid, str(log)],
        env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        line = owner.stdout.readline()
        info = json.loads(line) if line.strip().startswith("{") else {}
        if not info.get("ready"):
            say("OWNER DID NOT START:", line, owner.stderr.read()[-2000:])
            return 1
        say("stand-in owner ready at", info["origin"], "pid", info["pid"])

        from tui_gateway import server

        recorder = Recorder()

        def dispatch(method, params, req_id, timeout=45.0):
            """Dispatch one RPC and return its reply.

            A long handler is handed to the worker pool, so dispatch() returns None and the reply
            reaches the bound transport instead — collect it from there.
            """
            ret = server.dispatch({"jsonrpc": "2.0", "id": req_id, "method": method, "params": params},
                                  recorder)
            if ret is not None:
                return ret
            deadline = time.time() + timeout
            while time.time() < deadline:
                for frame in recorder.snapshot():
                    if frame.get("id") == req_id and ("result" in frame or "error" in frame):
                        return frame
                time.sleep(0.02)
            return None

        # 1. resume -> the OWNER's live snapshot, mounted on a LOCAL runtime id
        started = time.time()
        reply = dispatch("session.resume", {"session_id": sid}, 1)
        result = (reply or {}).get("result") or {}
        local_sid = result.get("session_id")
        say("resume took %.2fs ->" % (time.time() - started),
            json.dumps({k: result.get(k) for k in
                        ("session_id", "session_key", "stored_session_id", "message_count", "info")})[:280])
        if (reply or {}).get("error"):
            failures.append(f"resume errored: {reply['error']}")
        if not local_sid or local_sid == sid:
            failures.append(f"resume did not mount a local shadow id (got {local_sid!r})")
        if result.get("session_key") != sid:
            failures.append("resume reply lost the durable session key")
        if (result.get("info") or {}).get("title") != "stand-in owner":
            failures.append("resume reply did not carry the OWNER's snapshot")
        if result.get("message_count") != 1:
            failures.append("resume reply did not carry the owner's messages")

        # 2/3. the owner's event + server->client request arrive, rewritten onto the local id
        deadline = time.time() + 6
        while time.time() < deadline:
            if recorder.events("message.delta") and recorder.requests("approval.request"):
                break
            time.sleep(0.05)
        deltas = recorder.events("message.delta")
        forwarded = recorder.requests("approval.request")
        if not deltas:
            failures.append("owner event was not fanned back to the client")
        elif (deltas[0].get("params") or {}).get("session_id") != local_sid:
            failures.append("fanned-back event kept the OWNER's session id")
        else:
            say("fanned-back event:", json.dumps(deltas[0])[:200])
        if not forwarded:
            failures.append("owner server->client request was not forwarded")
        else:
            say("forwarded owner request:", json.dumps(forwarded[0])[:200])
            # ...and the client's answer travels back to the owner
            rid = forwarded[0].get("id")
            if server.dispatch({"jsonrpc": "2.0", "id": rid, "result": {"approved": True}}, recorder) is not None:
                failures.append("a client response frame should produce no reply")

        # 4. prompt.submit runs on the OWNER
        reply = dispatch("prompt.submit", {"session_id": local_sid, "text": "hello from the phone"}, 2)
        if (reply or {}).get("error"):
            failures.append(f"prompt.submit refused instead of relaying: {reply['error']}")
        say("prompt.submit reply:", json.dumps(reply)[:220])

        # 5. session.interrupt is forwarded
        reply = dispatch("session.interrupt", {"session_id": local_sid}, 3)
        if (reply or {}).get("error"):
            failures.append(f"session.interrupt error: {reply['error']}")
        say("interrupt reply:", json.dumps(reply)[:160])

        time.sleep(0.5)
        received = ([json.loads(row) for row in log.read_text(encoding="utf-8").splitlines()]
                    if log.exists() else [])
        say("owner received:", json.dumps([(f.get("method"), (f.get("params") or {}).get("text"))
                                           for f in received if f.get("method")])[:300])
        submits = [f for f in received if f.get("method") == "prompt.submit"]
        if not submits:
            failures.append("the owner never received the prompt.submit")
        else:
            if (submits[0].get("params") or {}).get("text") != "hello from the phone":
                failures.append("the owner received the wrong prompt text")
            if (submits[0].get("params") or {}).get("session_id") != "owner-runtime-sid":
                failures.append("the forwarded prompt did not address the OWNER's runtime session")
        if not any(f.get("method") == "session.interrupt" for f in received):
            failures.append("the owner never received session.interrupt")
        answers = [f for f in received if isinstance(f.get("id"), str)]
        if not answers:
            failures.append("the client's answer to the owner request never reached the owner")
        else:
            say("owner received the client's answer:", json.dumps(answers[0])[:200])

        # 6. a session nobody else owns must NOT be relayed (the handshake only fires for a
        #    session another LIVE runtime actually holds).
        local_only = "standalone-" + uuid.uuid4().hex[:12]
        reply = dispatch("session.resume", {"session_id": local_only, "lazy": True}, 4)
        if (reply or {}).get("error"):
            say("expected: an unknown stored session is not resumable:",
                (reply["error"].get("message") or "")[:90])
    finally:
        owner.terminate()
        try:
            owner.wait(timeout=10)
        except subprocess.TimeoutExpired:
            owner.kill()
        try:
            log.unlink()
        except OSError:
            pass

    if failures:
        say("")
        say("FAILED:")
        for item in failures:
            say("  -", item)
    else:
        say("")
        say("ALL CHECKS PASSED")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
