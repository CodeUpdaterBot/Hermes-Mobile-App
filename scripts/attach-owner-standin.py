#!/usr/bin/env python3
"""Stand-in OWNER runtime for the session-attach relay verification.

Takes a real active-session lease in ``$HERMES_HOME`` and serves BOTH ``GET /api/session-attach``
and ``/api/ws`` on ONE loopback port — exactly like a real Hermes runtime, because the handshake
fences the reply's websocket URL to the advertised origin. Every frame it receives is appended to
``argv[2]`` so the verification can prove exactly what the relay forwarded.

Invoked by ``verify-session-attach-relay.py``; not meant to be run by hand.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

REPO = Path(os.environ.get("HERMES_AGENT_REPO", r"C:\Users\PC\AppData\Local\hermes\hermes-agent"))
sys.path.insert(0, str(REPO))

from websockets.asyncio.server import serve as ws_serve  # noqa: E402
from websockets.datastructures import Headers  # noqa: E402
from websockets.http11 import Response  # noqa: E402
from hermes_state import SessionDB  # noqa: E402
from hermes_cli.active_sessions import try_acquire_active_session  # noqa: E402

SID = sys.argv[1]
LOG = Path(sys.argv[2])
HOME = Path(os.environ["HERMES_HOME"]).resolve()
OWNER_RUNTIME_SID = "owner-runtime-sid"
OWNER_REQUEST_ID = "owner-req-1"
state: dict = {"port": 0, "lease": None}


def _attach_response() -> Response:
    """The ``/api/session-attach`` reply: the lease triple plus this runtime's own ws URL."""
    reply = {"session_id": SID, "lease_id": state["lease"].lease_id, "profile_home": str(HOME),
             "websocket_url": f"ws://127.0.0.1:{state['port']}/api/ws?token=standin-token"}
    body = json.dumps(reply).encode()
    headers = Headers([("Content-Type", "application/json"), ("Content-Length", str(len(body)))])
    return Response(200, "OK", headers, body)


def _process_request(connection, request):
    path = request.path.split("?", 1)[0]
    if path == "/api/session-attach":
        return _attach_response()
    if path == "/api/ws":
        return None  # let the WebSocket handshake proceed
    body = b'{"detail":"not found"}'
    return Response(404, "Not Found", Headers([("Content-Type", "application/json"),
                                               ("Content-Length", str(len(body)))]), body)


def _record(frame: dict) -> None:
    with LOG.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(frame) + "\n")


async def _handler(ws) -> None:
    await ws.send(json.dumps({"jsonrpc": "2.0", "method": "event",
                              "params": {"type": "gateway.ready", "payload": {}}}))
    async for raw in ws:
        try:
            req = json.loads(raw)
        except ValueError:
            continue
        _record(req)
        rid = req.get("id")
        method = req.get("method")
        if method == "session.resume":
            result = {"session_id": OWNER_RUNTIME_SID, "message_count": 1,
                      "messages": [{"role": "user", "content": "owner history row"}],
                      "info": {"title": "stand-in owner", "model": "stand-in/model"}}
            await ws.send(json.dumps({"jsonrpc": "2.0", "id": rid, "result": result}))
            # The owner's live stream for this session, and a server->client request to answer.
            await ws.send(json.dumps({"jsonrpc": "2.0", "method": "event",
                                      "params": {"type": "message.delta", "session_id": OWNER_RUNTIME_SID,
                                                 "payload": {"text": "owner streamed token"}}}))
            await ws.send(json.dumps({"jsonrpc": "2.0", "id": OWNER_REQUEST_ID, "method": "approval.request",
                                      "params": {"session_id": OWNER_RUNTIME_SID,
                                                 "payload": {"prompt": "allow?"}}}))
        elif method == "prompt.submit":
            await ws.send(json.dumps({"jsonrpc": "2.0", "id": rid, "result": {}}))
        elif method == "session.interrupt":
            await ws.send(json.dumps({"jsonrpc": "2.0", "id": rid, "result": {"status": "interrupted"}}))
        else:
            await ws.send(json.dumps({"jsonrpc": "2.0", "id": rid, "result": {}}))


async def main() -> None:
    db = SessionDB()
    db.create_session(session_id=SID, source="cli")
    db.close()
    async with ws_serve(_handler, "127.0.0.1", 0, process_request=_process_request) as server:
        state["port"] = server.sockets[0].getsockname()[1]
        origin = f"http://127.0.0.1:{state['port']}"
        lease, err = try_acquire_active_session(
            session_id=SID, surface="desktop", config={},
            metadata={"live_session_id": SID, "shared_runtime_url": origin})
        if err is not None:
            print(json.dumps({"error": str(err)}), flush=True)
            return
        state["lease"] = lease
        print(json.dumps({"ready": True, "origin": origin, "port": state["port"],
                          "pid": os.getpid()}), flush=True)
        try:
            await asyncio.Event().wait()
        finally:
            lease.release()


asyncio.run(main())
