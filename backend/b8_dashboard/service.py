from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from .normalize import normalize_record
from .reader import EventPage, JsonlRunReader
from .state import B8StateReducer

LIVE_FRESHNESS_SECONDS = 30
TERMINAL_RUN_STATUSES = {
    "aborted",
    "cancelled",
    "canceled",
    "complete",
    "completed",
    "failed",
}


class B8DashboardService:
    def __init__(self, log_root: Path, active_run_id: str | None = None) -> None:
        self.reader = JsonlRunReader(log_root)
        self.active_run_id = active_run_id

    def run_live_status(
        self,
        run_id: str,
        manifest: dict[str, Any] | None = None,
        *,
        now: float | None = None,
    ) -> dict[str, Any]:
        current_manifest = manifest if manifest is not None else self._manifest(run_id)
        raw_status = current_manifest.get("status")
        status = raw_status.strip().lower() if isinstance(raw_status, str) else None
        manifest_run_id = current_manifest.get("run_id")
        activity = self.reader.latest_complete_activity(run_id)
        age_seconds = None
        freshness = "no_activity"
        activity_mtime = activity["last_activity_mtime"]
        if activity_mtime is not None:
            age_seconds = (time.time() if now is None else now) - activity_mtime
            if age_seconds < 0:
                freshness = "clock_skew"
            elif age_seconds <= LIVE_FRESHNESS_SECONDS:
                freshness = "fresh"
            else:
                freshness = "stale"

        terminal = status in TERMINAL_RUN_STATUSES
        eligible = (
            manifest_run_id == run_id
            and status == "running"
            and freshness == "fresh"
        )
        return {
            "status": status,
            "terminal": terminal,
            "freshness": freshness,
            "eligible": eligible,
            "last_activity_at": activity["last_activity_at"],
            "last_activity_stream": activity["last_activity_stream"],
            "age_seconds": age_seconds,
            "freshness_seconds": LIVE_FRESHNESS_SECONDS,
        }

    def _data_mode(
        self,
        run_id: str,
        data_mode: str,
        *,
        allow_terminal: bool = False,
        allow_inactive: bool = False,
    ) -> str:
        if data_mode not in {"LIVE", "REPLAY"}:
            raise ValueError("data_mode must be LIVE or REPLAY.")
        if data_mode == "LIVE":
            if self.active_run_id is not None and run_id != self.active_run_id:
                raise PermissionError("LIVE mode is pinned to the operator-configured run.")
            status = self.run_live_status(run_id)
            if not status["eligible"] and not (allow_terminal and status["terminal"]):
                can_follow_inactive = allow_inactive and (
                    status["status"] == "running" or status["terminal"]
                )
                if not can_follow_inactive:
                    raise PermissionError(
                        "LIVE mode requires an active run with running status and fresh complete JSONL activity."
                    )
        return data_mode

    def health(self) -> dict[str, Any]:
        root = self.reader.log_root
        return {
            "status": "ok",
            "service": "b8-dashboard-read-only",
            "log_root_readable": root.is_dir(),
        }

    def list_runs(self) -> dict[str, Any]:
        runs = self.reader.list_runs()
        candidate_ids: list[str] = []
        for item in runs:
            run_id = item["run_id"]
            manifest = item["manifest"]
            if manifest is None:
                item["live"] = {
                    "status": None,
                    "terminal": False,
                    "freshness": "unknown",
                    "eligible": False,
                    "last_activity_at": None,
                    "last_activity_stream": None,
                    "age_seconds": None,
                    "freshness_seconds": LIVE_FRESHNESS_SECONDS,
                }
                continue
            live = self.run_live_status(run_id, manifest)
            if self.active_run_id is not None and run_id != self.active_run_id:
                live["eligible"] = False
            item["live"] = live
            if live["eligible"]:
                candidate_ids.append(run_id)

        if self.active_run_id is not None:
            discovery_status = "manual_active" if candidate_ids else "manual_unavailable"
            selected_run_id = candidate_ids[0] if candidate_ids else None
            mode = "manual"
        elif not candidate_ids:
            discovery_status = "none"
            selected_run_id = None
            mode = "automatic"
        elif len(candidate_ids) == 1:
            discovery_status = "single"
            selected_run_id = candidate_ids[0]
            mode = "automatic"
        else:
            discovery_status = "ambiguous"
            selected_run_id = None
            mode = "automatic"

        return {
            "runs": runs,
            "live_discovery": {
                "mode": mode,
                "status": discovery_status,
                "selected_run_id": selected_run_id,
                "candidate_run_ids": candidate_ids,
                "freshness_seconds": LIVE_FRESHNESS_SECONDS,
            },
        }

    def _manifest(self, run_id: str) -> dict[str, Any]:
        return self.reader.read_manifest(run_id, required=False) or {}

    @staticmethod
    def finished_phase_status(event: dict[str, Any]) -> str | None:
        status = event["payload"].get("status")
        if (
            event["kind"] == "run.phase"
            and event["source_stream"] == "events.jsonl"
            and event["payload"].get("traffic_mode") == "finished"
            and isinstance(status, str)
            and status.strip().lower() in TERMINAL_RUN_STATUSES
        ):
            return status.strip().lower()
        return None

    def finished_phase_offset(self, run_id: str) -> int | None:
        manifest = self._manifest(run_id)
        manifest_status = manifest.get("status")
        expected_status = (
            manifest_status.strip().lower()
            if isinstance(manifest_status, str)
            else None
        )
        if expected_status not in TERMINAL_RUN_STATUSES:
            return None
        finished_offset: int | None = None
        for record in self.reader.iter_complete_records(run_id, "events.jsonl"):
            event = self._normalizer()(
                run_id=run_id,
                stream=record.stream,
                offset=record.offset,
                identity=record.identity,
                raw=record.value,
                manifest=manifest,
                data_mode="LIVE",
                cursor="",
            )
            if self.finished_phase_status(event) == expected_status:
                finished_offset = record.offset
        return finished_offset

    @staticmethod
    def _run_metadata(manifest: dict[str, Any]) -> dict[str, Any]:
        revisions = {
            key: value
            for key, value in manifest.items()
            if "revision" in key.lower()
            or key in {"model_sha256", "schema_version", "profile"}
        }
        policy_mode = next(
            (
                manifest[key]
                for key in ("B8_POLICY_MODE", "b8_policy_mode", "policy_mode", "mode")
                if isinstance(manifest.get(key), str)
                and manifest[key] in {"ALERT_ONLY", "MITIGATE"}
            ),
            None,
        )
        return {
            "scenario": manifest.get("scenario"),
            "seed": (
                manifest.get("seed")
                if manifest.get("seed") is not None
                else manifest.get("seed_reference")
            ),
            "status": manifest.get("status"),
            "policy_mode": policy_mode,
            "revision": revisions,
        }

    @staticmethod
    def _normalizer():
        return normalize_record

    def snapshot(self, run_id: str, data_mode: str) -> dict[str, Any]:
        mode = self._data_mode(run_id, data_mode)
        manifest = self._manifest(run_id)
        run = self._run_metadata(manifest)
        live_status = self.run_live_status(run_id, manifest)
        reducer = B8StateReducer()
        as_of_cursor = self.reader.scan_snapshot(
            run_id,
            self._normalizer(),
            manifest,
            mode,
            reducer.apply,
        )
        projection = reducer.snapshot()
        return {
            "run_id": run_id,
            "data_mode": mode,
            "policy_mode": run["policy_mode"],
            "run": run,
            "live_monitor": live_status,
            "as_of_cursor": as_of_cursor,
            "snapshot_received_at": self._now(),
            "state": projection,
        }

    def events(
        self,
        run_id: str,
        after: str,
        limit: int,
        data_mode: str,
        *,
        live_session: bool = False,
    ) -> EventPage:
        if live_session and data_mode == "LIVE":
            mode = data_mode
        else:
            mode = self._data_mode(run_id, data_mode)
        manifest = self._manifest(run_id)
        return self.reader.read_page(
            run_id,
            after,
            limit,
            self._normalizer(),
            manifest,
            mode,
        )

    @staticmethod
    def _now() -> str:
        from datetime import datetime, timezone

        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
