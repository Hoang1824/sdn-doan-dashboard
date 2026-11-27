from __future__ import annotations

from pathlib import Path
from typing import Any

from .normalize import normalize_record
from .reader import EventPage, JsonlRunReader
from .state import B8StateReducer


class B8DashboardService:
    def __init__(self, log_root: Path, active_run_id: str | None = None) -> None:
        self.reader = JsonlRunReader(log_root)
        self.active_run_id = active_run_id

    def _data_mode(self, run_id: str, data_mode: str) -> str:
        if data_mode not in {"LIVE", "REPLAY"}:
            raise ValueError("data_mode must be LIVE or REPLAY.")
        if data_mode == "LIVE" and (not self.active_run_id or run_id != self.active_run_id):
            raise PermissionError("LIVE mode is limited to the operator-configured active run.")
        return data_mode

    def health(self) -> dict[str, Any]:
        root = self.reader.log_root
        return {
            "status": "ok",
            "service": "b8-dashboard-read-only",
            "log_root_readable": root.is_dir(),
        }

    def list_runs(self) -> dict[str, Any]:
        return {"runs": self.reader.list_runs()}

    def _manifest(self, run_id: str) -> dict[str, Any]:
        return self.reader.read_manifest(run_id, required=False) or {}

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
            "as_of_cursor": as_of_cursor,
            "snapshot_received_at": self._now(),
            "state": projection,
        }

    def events(self, run_id: str, after: str, limit: int, data_mode: str) -> EventPage:
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
