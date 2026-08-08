"""Hermes lifecycle adapter for Louder Bridge."""

from __future__ import annotations

import http.client
import json
import os
import queue
import re
import threading
from pathlib import Path
from typing import Any, Optional, Tuple


_EVENTS: queue.Queue[dict[str, str]] = queue.Queue(maxsize=128)
_WORKER_STARTED = False
_WORKER_LOCK = threading.Lock()
_TOKEN_PATTERN = re.compile(r"^[a-f0-9]{64}$")


def _token_path() -> Path:
    return (
        Path.home()
        / "Library"
        / "Application Support"
        / "LouderBridge"
        / "auth-token"
    )


def _bridge_address() -> Tuple[str, int]:
    host = os.environ.get("LOUDER_BRIDGE_HOST", "127.0.0.1")
    if host not in {"127.0.0.1", "::1", "localhost"}:
        raise ValueError("Louder Bridge must stay on the local machine")
    port = int(os.environ.get("LOUDER_BRIDGE_PORT", "47831"))
    if not 1 <= port <= 65535:
        raise ValueError("Invalid Louder Bridge port")
    return host, port


def _send(payload: dict[str, str]) -> None:
    try:
        token = _token_path().read_text(encoding="utf-8").strip()
        if not _TOKEN_PATTERN.fullmatch(token):
            return
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        host, port = _bridge_address()
        connection = http.client.HTTPConnection(host, port, timeout=0.4)
        try:
            connection.request(
                "POST",
                "/hook",
                body=body,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
            )
            response = connection.getresponse()
            response.read()
        finally:
            connection.close()
    except Exception:
        return


def _worker() -> None:
    while True:
        _send(_EVENTS.get())
        _EVENTS.task_done()


def _start_worker() -> None:
    global _WORKER_STARTED
    with _WORKER_LOCK:
        if _WORKER_STARTED:
            return
        threading.Thread(
            target=_worker,
            daemon=True,
            name="louder-bridge-hooks",
        ).start()
        _WORKER_STARTED = True


def _emit(hook_event_name: str, session_id: Optional[str]) -> None:
    if not session_id:
        return
    payload = {
        "surface": "hermes",
        "session_id": str(session_id),
        "hook_event_name": hook_event_name,
    }
    if (
        os.environ.get("TERM_PROGRAM", "").lower() == "ghostty"
        or os.environ.get("TERM", "").lower() == "xterm-ghostty"
    ):
        payload["host"] = "ghostty"
    try:
        _EVENTS.put_nowait(payload)
    except queue.Full:
        return


def _on_session_start(session_id: str = "", **_: Any) -> None:
    _emit("SessionStart", session_id)


def _on_pre_llm_call(session_id: str = "", **_: Any) -> None:
    _emit("UserPromptSubmit", session_id)


def _on_post_llm_call(session_id: str = "", **_: Any) -> None:
    _emit("Stop", session_id)


def _on_session_end(
    session_id: str = "",
    completed: bool = False,
    interrupted: bool = False,
    **_: Any,
) -> None:
    if completed:
        return
    _emit("Stop" if interrupted else "StopFailure", session_id)


def _on_session_finalize(session_id: str = "", **_: Any) -> None:
    _emit("SessionEnd", session_id)


def _on_approval_request(
    session_key: str = "",
    session_id: str = "",
    **_: Any,
) -> None:
    _emit("PermissionRequest", session_id or session_key)


def _on_approval_response(
    session_key: str = "",
    session_id: str = "",
    **_: Any,
) -> None:
    _emit("UserPromptSubmit", session_id or session_key)


def register(ctx: Any) -> None:
    _start_worker()
    ctx.register_hook("on_session_start", _on_session_start)
    ctx.register_hook("pre_llm_call", _on_pre_llm_call)
    ctx.register_hook("post_llm_call", _on_post_llm_call)
    ctx.register_hook("on_session_end", _on_session_end)
    ctx.register_hook("on_session_finalize", _on_session_finalize)
    ctx.register_hook("pre_approval_request", _on_approval_request)
    ctx.register_hook("post_approval_response", _on_approval_response)
