from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


_RYU_KINDS = {
    "v2_prediction": "ai.prediction",
    "b8_live_policy_decision": "policy.decision",
    "b8_mitigation_requested": "mitigation.requested",
    "b8_mitigation_confirmed": "mitigation.confirmed",
    "b8_drop_counter": "mitigation.counter",
    "b8_mitigation_flow_removed": "mitigation.removed",
    "b8_mitigation_cleaned": "mitigation.cleaned",
}

_FIELDS_BY_KIND = {
    "ai.prediction": {
        "id", "timestamp", "prediction", "confidence", "src_ip", "src_port",
        "dst_ip", "dst_port", "phase", "values", "candidate", "model_sha256",
        "schema_version", "mode", "sample_id",
    },
    "policy.decision": {
        "timestamp", "mode", "sample_id", "src_ip", "dst_ip", "ip_proto",
        "prediction", "decision", "consecutive",
    },
    "mitigation.requested": {
        "timestamp", "mode", "sample_id", "src_ip", "dst_ip", "ip_proto",
        "prediction", "decision", "consecutive", "cookie", "dpid",
        "mitigation_action", "meter_id", "idle_timeout_s", "hard_timeout_s",
    },
    "mitigation.confirmed": {
        "timestamp", "mode", "sample_id", "src_ip", "dst_ip", "ip_proto",
        "prediction", "decision", "consecutive", "cookie", "dpid",
        "mitigation_action", "meter_id", "idle_timeout_s", "hard_timeout_s",
    },
    "mitigation.counter": {
        "timestamp", "mode", "sample_id", "cookie", "packet_count",
        "byte_count", "counter_source", "dpid", "mitigation_action",
        "src_ip", "dst_ip", "ip_proto",
    },
    "mitigation.removed": {
        "timestamp", "mode", "sample_id", "cookie", "dpid", "reason",
        "packet_count", "byte_count", "src_ip", "dst_ip", "ip_proto",
        "mitigation_action",
    },
    "mitigation.cleaned": {
        "timestamp", "mode", "sample_id", "cookie", "dpid",
    },
    "timeline.observation": {
        "timestamp", "seen_at", "phase", "status", "sample_id", "id",
        "cookie", "delta", "total", "packet_count", "src_ip", "dst_ip",
        "ip_proto", "action", "event",
    },
    "run.phase": {
        "timestamp", "phase", "status", "stage", "event", "run_id",
    },
}


def _raw_event_name(raw: dict[str, Any]) -> str:
    names = {
        value
        for key in ("event", "event_type", "type", "name")
        if isinstance((value := raw.get(key)), str) and value
    }
    if len(names) != 1:
        raise ValueError("JSONL object must contain one unambiguous event name.")
    return names.pop()


def _policy_mode(raw: dict[str, Any], manifest: dict[str, Any], kind: str) -> str | None:
    candidates = (
        raw.get("B8_POLICY_MODE"),
        raw.get("b8_policy_mode"),
        raw.get("policy_mode"),
        manifest.get("B8_POLICY_MODE"),
        manifest.get("b8_policy_mode"),
        manifest.get("policy_mode"),
    )
    if kind in {
        "policy.decision",
        "mitigation.requested",
        "mitigation.confirmed",
        "mitigation.counter",
        "mitigation.removed",
        "mitigation.cleaned",
    }:
        candidates = (*candidates, raw.get("mode"))
    for candidate in candidates:
        if isinstance(candidate, str) and candidate in {"ALERT_ONLY", "MITIGATE"}:
            return candidate
    return None


def _revision(raw: dict[str, Any], manifest: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for source in (manifest, raw):
        for key, value in source.items():
            lowered = key.lower()
            if (
                "revision" in lowered
                or key in {"model_sha256", "schema_version", "profile"}
            ):
                result[key] = value
    return result


def _payload(raw: dict[str, Any], kind: str) -> dict[str, Any]:
    allowed = _FIELDS_BY_KIND.get(kind, set())
    return {key: value for key, value in raw.items() if key in allowed}


def normalize_record(
    *,
    run_id: str,
    stream: str,
    offset: int,
    identity: str,
    raw: dict[str, Any],
    manifest: dict[str, Any],
    data_mode: str,
    cursor: str,
) -> dict[str, Any]:
    raw_event = _raw_event_name(raw)
    if stream == "ryu_events.jsonl":
        kind = _RYU_KINDS.get(raw_event, "source.observation")
    elif stream == "timeline.jsonl":
        kind = "timeline.observation"
    else:
        kind = "run.phase"

    source_run_id = raw.get("run_id")
    if source_run_id is not None and source_run_id != run_id:
        raise ValueError("JSONL record run_id does not match its containing run directory.")

    payload = _payload(raw, kind)
    sample_id = raw.get("sample_id")
    if sample_id is None and kind == "ai.prediction":
        sample_id = raw.get("id")
    cookie = raw.get("cookie")
    event_id = f"{run_id}:{stream}:{identity}:{offset:x}"
    return {
        "schema_version": "b8.dashboard.v1",
        "run_id": run_id,
        "event_id": event_id,
        "cursor": cursor,
        "kind": kind,
        "raw_event": raw_event,
        "source_stream": stream,
        "source_timestamp": raw.get("timestamp"),
        "backend_received_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "data_mode": data_mode,
        "policy_mode": _policy_mode(raw, manifest, kind),
        "run_revision": _revision(raw, manifest),
        "keys": {
            "sample_id": sample_id,
            "cookie": str(cookie) if cookie is not None else None,
        },
        "payload": payload,
    }
