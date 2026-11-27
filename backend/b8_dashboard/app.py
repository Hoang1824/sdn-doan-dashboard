from __future__ import annotations

import asyncio
import hmac
import ipaddress
import os
import time
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .reader import (
    InvalidCursorError,
    InvalidJsonlError,
    InvalidRunIdError,
    ResyncRequiredError,
    RunNotFoundError,
    SourceUnavailableError,
)
from .service import B8DashboardService


def _is_loopback(host: str) -> bool:
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _allowed_origins(value: str | None) -> list[str]:
    if not value:
        return ["http://localhost:5173", "http://127.0.0.1:5173"]
    return [origin.strip() for origin in value.split(",") if origin.strip()]


def create_app(
    log_root: str | Path | None = None,
    *,
    active_run_id: str | None = None,
    dashboard_token: str | None = None,
    allowed_origins: list[str] | None = None,
    host: str | None = None,
    poll_interval: float = 0.25,
    heartbeat_interval: float = 10.0,
) -> FastAPI:
    configured_host = host or os.environ.get("B8_DASHBOARD_HOST", "127.0.0.1")
    if configured_host in {"0.0.0.0", "::", "[::]"}:
        raise ValueError("Bind to loopback or a specific reviewed interface, not an unspecified address.")
    if dashboard_token is not None and not (
        len(dashboard_token) >= 32
        and all(character.isalnum() or character in "_-" for character in dashboard_token)
    ):
        raise ValueError("B8_DASHBOARD_TOKEN must be at least 32 URL-safe characters.")
    if not _is_loopback(configured_host) and not dashboard_token:
        raise ValueError("A non-loopback bind requires B8_DASHBOARD_TOKEN.")

    default_root = Path.cwd().parent / "logs_v2"
    configured_root = Path(log_root or os.environ.get("B8_LOG_ROOT", default_root)).expanduser()
    origins = allowed_origins or _allowed_origins(os.environ.get("B8_ALLOWED_ORIGINS"))
    service = B8DashboardService(configured_root, active_run_id)
    app = FastAPI(title="B8 Dashboard Read-Only API", version="1.0.0")
    app.state.dashboard_service = service
    app.state.dashboard_token = dashboard_token
    app.state.allowed_origins = set(origins)
    app.state.dashboard_host = configured_host
    app.state.poll_interval = max(0.1, poll_interval)
    app.state.heartbeat_interval = max(1.0, heartbeat_interval)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=["Authorization", "Content-Type"],
    )

    async def require_access(authorization: str | None = Header(default=None)) -> None:
        expected = app.state.dashboard_token
        if expected is None:
            return
        supplied = ""
        if authorization and authorization[:7].lower() == "bearer ":
            supplied = authorization[7:].strip()
        if not hmac.compare_digest(supplied, expected):
            raise HTTPException(status_code=401, detail="A valid Bearer token is required.")

    @app.exception_handler(InvalidRunIdError)
    async def invalid_run_handler(_, error: InvalidRunIdError):
        return await _http_error(400, str(error))

    @app.exception_handler(RunNotFoundError)
    async def run_not_found_handler(_, error: RunNotFoundError):
        return await _http_error(404, str(error))

    @app.exception_handler(SourceUnavailableError)
    async def source_unavailable_handler(_, error: SourceUnavailableError):
        return await _http_error(503, str(error))

    @app.exception_handler(InvalidJsonlError)
    async def invalid_jsonl_handler(_, error: InvalidJsonlError):
        return await _http_error(500, str(error))

    @app.exception_handler(ResyncRequiredError)
    async def resync_handler(_, error: ResyncRequiredError):
        return await _http_error(409, {"resync_required": True, "detail": str(error)})

    @app.get("/api/health", dependencies=[Depends(require_access)])
    async def health():
        return await asyncio.to_thread(service.health)

    @app.get("/api/runs", dependencies=[Depends(require_access)])
    async def runs():
        return await asyncio.to_thread(service.list_runs)

    @app.get("/api/runs/{run_id}/snapshot", dependencies=[Depends(require_access)])
    async def snapshot(
        run_id: str,
        data_mode: Literal["LIVE", "REPLAY"] = Query(default="REPLAY"),
    ):
        try:
            return await asyncio.to_thread(service.snapshot, run_id, data_mode)
        except PermissionError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    @app.get("/api/runs/{run_id}/events", dependencies=[Depends(require_access)])
    async def events(
        run_id: str,
        after: str | None = Query(default=None, max_length=8192),
        limit: int = Query(default=100, ge=1, le=500),
        data_mode: Literal["LIVE", "REPLAY"] = Query(default="REPLAY"),
    ):
        try:
            cursor = after or service.reader.initial_cursor(run_id)
            page = await asyncio.to_thread(service.events, run_id, cursor, limit, data_mode)
        except PermissionError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        except InvalidCursorError as error:
            raise HTTPException(
                status_code=409,
                detail={"resync_required": True, "message": str(error)},
            ) from error
        return {
            "run_id": run_id,
            "data_mode": data_mode,
            "events": page.events,
            "next_cursor": page.next_cursor,
            "has_more": page.has_more,
        }

    @app.websocket("/ws/runs/{run_id}")
    async def event_stream(
        websocket: WebSocket,
        run_id: str,
        after: str | None = None,
        data_mode: Literal["LIVE", "REPLAY"] = "REPLAY",
    ):
        origin = websocket.headers.get("origin")
        if origin and origin not in app.state.allowed_origins:
            await websocket.close(code=1008, reason="Origin is not allowed.")
            return

        expected = app.state.dashboard_token
        protocols = websocket.scope.get("subprotocols", [])
        token_protocols = [item.removeprefix("b8-token.") for item in protocols if item.startswith("b8-token.")]
        if expected is not None and (
            len(token_protocols) != 1
            or not hmac.compare_digest(token_protocols[0], expected)
            or "b8.dashboard.v1" not in protocols
        ):
            await websocket.close(code=1008, reason="WebSocket authentication failed.")
            return

        try:
            service._data_mode(run_id, data_mode)
            service.reader.run_dir(run_id)
            await websocket.accept(subprotocol="b8.dashboard.v1" if expected else None)
        except (
            PermissionError,
            ValueError,
            InvalidRunIdError,
            RunNotFoundError,
            SourceUnavailableError,
        ) as error:
            await websocket.close(code=1008, reason=str(error)[:120])
            return

        if not after:
            await websocket.send_json(
                {
                    "type": "resync_required",
                    "reason": "snapshot_cursor_required",
                }
            )
            await websocket.close(code=1008)
            return

        cursor = after
        last_heartbeat = time.monotonic()
        try:
            while True:
                page = await asyncio.to_thread(
                    service.events, run_id, cursor, 100, data_mode
                )
                for event in page.events:
                    await websocket.send_json({"type": "event", "event": event})
                cursor = page.next_cursor

                if data_mode == "REPLAY" and not page.has_more:
                    await websocket.send_json(
                        {"type": "replay_complete", "cursor": cursor}
                    )
                    await websocket.close(code=1000)
                    return

                now = time.monotonic()
                if data_mode == "LIVE" and now - last_heartbeat >= app.state.heartbeat_interval:
                    await websocket.send_json(
                        {"type": "heartbeat", "cursor": cursor, "data_mode": "LIVE"}
                    )
                    last_heartbeat = now

                if data_mode == "LIVE" and not page.has_more:
                    await asyncio.sleep(app.state.poll_interval)
        except ResyncRequiredError as error:
            await websocket.send_json(
                {"type": "resync_required", "reason": str(error)}
            )
            await websocket.close(code=1012)
        except InvalidCursorError as error:
            await websocket.send_json(
                {"type": "resync_required", "reason": str(error)}
            )
            await websocket.close(code=1012)
        except InvalidJsonlError as error:
            await websocket.send_json(
                {"type": "source_error", "code": "invalid_jsonl", "detail": str(error)}
            )
            await websocket.close(code=1011)
        except WebSocketDisconnect:
            return

    return app


async def _http_error(status_code: int, detail: object):
    from fastapi.responses import JSONResponse

    return JSONResponse(status_code=status_code, content={"detail": detail})


def _app_from_environment() -> FastAPI:
    log_root = os.environ.get("B8_LOG_ROOT")
    active_run_id = os.environ.get("B8_ACTIVE_RUN_ID")
    token = os.environ.get("B8_DASHBOARD_TOKEN")
    host = os.environ.get("B8_DASHBOARD_HOST", "127.0.0.1")
    return create_app(
        log_root,
        active_run_id=active_run_id,
        dashboard_token=token,
        host=host,
    )


app = _app_from_environment()
