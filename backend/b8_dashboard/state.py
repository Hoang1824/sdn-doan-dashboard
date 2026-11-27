from __future__ import annotations

from copy import deepcopy
import math
from statistics import median
from typing import Any


PREDICTION_LABELS = ("benign", "syn_flood", "udp_flood")
MAX_ALERT_EVENTS = 100
MAX_DROP_COUNTER_SAMPLES = 500
MAX_RECENT_EVENTS = 500


def _integer(value: Any) -> int | None:
    if type(value) is int and value >= 0:
        return value
    return None


def _timestamp(value: Any) -> float | None:
    if (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    ):
        return float(value)
    return None


def _rule_key(event: dict[str, Any]) -> tuple[str, str] | None:
    keys = event["keys"]
    payload = event["payload"]
    cookie = keys.get("cookie")
    dpid = payload.get("dpid")
    if cookie is None or dpid is None:
        return None
    return str(dpid), str(cookie)


class B8StateReducer:
    """Idempotent projection of primary Ryu events plus supplemental observations."""

    def __init__(self) -> None:
        self._seen: set[str] = set()
        self._prediction_ids: set[str] = set()
        self._prediction_class_counts = {label: 0 for label in PREDICTION_LABELS}
        self._latest_prediction: dict[str, Any] | None = None
        self._policies: dict[str, dict[str, Any]] = {}
        self._policy_order: list[str] = []
        self._rules: dict[tuple[str, str], dict[str, Any]] = {}
        self._phases: list[dict[str, Any]] = []
        self._alert_event_count = 0
        self._alert_events: list[dict[str, Any]] = []
        self._drop_alert_rule_keys: set[tuple[str, str]] = set()
        self._drop_counter_sample_count = 0
        self._drop_counter_history: list[dict[str, Any]] = []
        self._recent_events: list[dict[str, Any]] = []
        self._mitigation_request_times: dict[tuple[str, str], float] = {}
        self._mitigation_observation_latencies: dict[tuple[str, str], float] = {}

    def apply(self, event: dict[str, Any]) -> bool:
        event_id = event["event_id"]
        if event_id in self._seen:
            return False
        self._seen.add(event_id)

        kind = event["kind"]
        payload = event["payload"]
        keys = event["keys"]
        if kind == "ai.prediction":
            prediction_id = payload.get("id")
            if prediction_id is not None:
                prediction_key = str(prediction_id)
                if prediction_key not in self._prediction_ids:
                    self._prediction_ids.add(prediction_key)
                    label = payload.get("prediction")
                    if label in self._prediction_class_counts:
                        self._prediction_class_counts[label] += 1
                    self._latest_prediction = deepcopy(event)
                    if label in {"syn_flood", "udp_flood"}:
                        self._record_alert(event)
        elif kind == "policy.decision":
            sample_id = keys.get("sample_id")
            if sample_id is not None:
                sample_key = str(sample_id)
                if sample_key in self._policy_order:
                    self._policy_order.remove(sample_key)
                self._policy_order.append(sample_key)
                self._policies[sample_key] = deepcopy(event)
        elif kind.startswith("mitigation."):
            self._apply_rule(event)
            self._apply_mitigation_observability(event)
        elif kind == "run.phase":
            if self._has_timeline_phase_marker(event):
                return True
            self._phases.append(deepcopy(event))
            self._phases = self._phases[-200:]
        elif kind in {"timeline.observation", "source.observation"}:
            self._phases.append(deepcopy(event))
            self._phases = self._phases[-200:]
        if event["source_stream"] == "ryu_events.jsonl" or kind == "run.phase":
            self._recent_events.append(self._history_projection(event))
            self._recent_events = self._recent_events[-MAX_RECENT_EVENTS:]
        return True

    def _record_alert(self, event: dict[str, Any]) -> None:
        self._alert_event_count += 1
        self._alert_events.append(deepcopy(event))
        self._alert_events = self._alert_events[-MAX_ALERT_EVENTS:]

    @staticmethod
    def _history_projection(event: dict[str, Any]) -> dict[str, Any]:
        fields = {
            "id", "prediction", "decision", "mitigation_action", "src_ip",
            "dst_ip", "ip_proto", "cookie", "dpid", "packet_count",
            "byte_count", "counter_source", "reason", "phase", "traffic_mode",
            "status", "sample_id",
        }
        projection = deepcopy(event)
        projection["payload"] = {
            key: value for key, value in event["payload"].items() if key in fields
        }
        return projection

    def _apply_mitigation_observability(self, event: dict[str, Any]) -> None:
        kind = event["kind"]
        payload = event["payload"]
        action = payload.get("mitigation_action")
        if kind == "mitigation.requested" and action == "DROP":
            self._record_alert(event)
            key = _rule_key(event)
            if key is None:
                return
            requested_at = _timestamp(event["source_timestamp"])
            if requested_at is not None:
                previous = self._mitigation_request_times.get(key)
                if previous is None or requested_at < previous:
                    self._mitigation_request_times[key] = requested_at
            return

        if kind == "mitigation.confirmed":
            self._record_alert(event)
            return

        key = _rule_key(event)
        if key is None:
            return
        rule = self._rules.get(key)
        evidence = rule.get("evidence") if rule else None
        has_current_evidence = (
            isinstance(evidence, dict)
            and evidence.get("reference") == event["event_id"]
            and evidence.get("source") == "controller"
        )

        if kind == "mitigation.counter":
            if not has_current_evidence or action != "DROP":
                return
            packet_count = _integer(payload.get("packet_count"))
            timestamp = _timestamp(event["source_timestamp"])
            cookie = event["keys"].get("cookie")
            dpid = payload.get("dpid")
            if (
                packet_count is None
                or timestamp is None
                or not isinstance(cookie, str)
                or not cookie.strip()
                or type(dpid) is not int
                or dpid < 0
            ):
                return

            self._drop_counter_sample_count += 1
            self._drop_counter_history.append(
                {
                    "event_id": event["event_id"],
                    "timestamp": timestamp,
                    "cookie": cookie,
                    "dpid": dpid,
                    "src_ip": payload.get("src_ip"),
                    "sample_id": event["keys"].get("sample_id"),
                    "packet_count": packet_count,
                    "delta": rule["counter_delta"],
                    "counter_reset": rule["counter_reset"],
                }
            )
            self._drop_counter_history = self._drop_counter_history[
                -MAX_DROP_COUNTER_SAMPLES:
            ]

            requested_at = self._mitigation_request_times.get(key)
            if (
                requested_at is not None
                and timestamp >= requested_at
                and key not in self._mitigation_observation_latencies
            ):
                self._mitigation_observation_latencies[key] = (
                    timestamp - requested_at
                ) * 1000

            if packet_count > 0 and key not in self._drop_alert_rule_keys:
                self._drop_alert_rule_keys.add(key)
                self._record_alert(event)
            return

        if (
            kind == "mitigation.removed"
            and action == "DROP"
            and _integer(payload.get("packet_count")) is not None
            and payload["packet_count"] > 0
            and _timestamp(event["source_timestamp"]) is not None
            and key not in self._drop_alert_rule_keys
        ):
            self._drop_alert_rule_keys.add(key)
            self._record_alert(event)

    def _has_timeline_phase_marker(self, event: dict[str, Any]) -> bool:
        phase = event["payload"].get("phase")
        if phase is None:
            return False
        return any(
            previous["source_stream"] == "timeline.jsonl"
            and previous["raw_event"] == "PHA_KICH_BAN"
            and previous["payload"].get("phase") == phase
            for previous in self._phases
        )

    def _apply_rule(self, event: dict[str, Any]) -> None:
        key = _rule_key(event)
        if key is None:
            return
        kind = event["kind"]
        payload = event["payload"]
        rule = self._rules.setdefault(
            key,
            {
                "id": f"{key[0]}:{key[1]}",
                "dpid": payload.get("dpid"),
                "cookie": key[1],
                "sample_id": event["keys"].get("sample_id"),
                "src_ip": payload.get("src_ip"),
                "dst_ip": payload.get("dst_ip"),
                "ip_proto": payload.get("ip_proto"),
                "mitigation_action": payload.get("mitigation_action"),
                "status": "UNKNOWN",
                "packet_count": None,
                "byte_count": None,
                "counter_delta": None,
                "counter_reset": False,
                "counter_source": None,
                "evidence": None,
                "reason": None,
                "source_timestamp": None,
                "last_event_id": None,
            },
        )
        for field in ("dpid", "src_ip", "dst_ip", "ip_proto", "mitigation_action", "sample_id"):
            value = payload.get(field)
            if value is not None:
                rule[field] = value
        rule["source_timestamp"] = event["source_timestamp"]
        rule["last_event_id"] = event["event_id"]

        if kind == "mitigation.requested":
            if rule["status"] in {"UNKNOWN", "REQUESTED"}:
                rule["status"] = "REQUESTED"
        elif kind == "mitigation.confirmed":
            if rule["status"] not in {"VERIFIED", "DROPPING", "REMOVED", "REMOVED_IDLE", "CLEANED"}:
                rule["status"] = "CONFIRMED"
        elif kind == "mitigation.counter":
            self._apply_counter(rule, event)
        elif kind == "mitigation.removed":
            self._apply_final_counter(rule, payload)
            rule["reason"] = payload.get("reason")
            reason = payload.get("reason")
            rule["status"] = "REMOVED_IDLE" if type(reason) is int and reason == 0 else "REMOVED"
        elif kind == "mitigation.cleaned":
            rule["status"] = "CLEANED"

    @staticmethod
    def _apply_counter(rule: dict[str, Any], event: dict[str, Any]) -> None:
        payload = event["payload"]
        packet_count = _integer(payload.get("packet_count"))
        byte_count = _integer(payload.get("byte_count"))
        previous = rule["packet_count"]
        rule["counter_source"] = payload.get("counter_source")
        rule["counter_delta"] = None
        rule["counter_reset"] = False

        if packet_count is not None:
            if previous is not None and packet_count >= previous:
                rule["counter_delta"] = packet_count - previous
            elif previous is not None and packet_count < previous:
                rule["counter_reset"] = True
            rule["packet_count"] = packet_count
        if byte_count is not None:
            rule["byte_count"] = byte_count

        valid_flow_stats = (
            payload.get("counter_source") == "verified_flow_stats"
            and isinstance(rule.get("cookie"), str)
            and bool(rule["cookie"].strip())
            and type(rule.get("dpid")) is int
            and rule["dpid"] >= 0
            and packet_count is not None
            and isinstance(event["source_timestamp"], (int, float))
            and not isinstance(event["source_timestamp"], bool)
            and math.isfinite(event["source_timestamp"])
        )
        if valid_flow_stats:
            rule["evidence"] = {
                "source": "controller",
                "reference": event["event_id"],
                "source_timestamp": event["source_timestamp"],
            }
            if rule["status"] not in {"REMOVED", "REMOVED_IDLE", "CLEANED"}:
                rule["status"] = "DROPPING" if packet_count > 0 else "VERIFIED"

    @staticmethod
    def _apply_final_counter(rule: dict[str, Any], payload: dict[str, Any]) -> None:
        packet_count = _integer(payload.get("packet_count"))
        byte_count = _integer(payload.get("byte_count"))
        previous = rule["packet_count"]
        rule["counter_delta"] = None
        rule["counter_reset"] = False
        if packet_count is not None:
            if previous is not None and packet_count >= previous:
                rule["counter_delta"] = packet_count - previous
            elif previous is not None and packet_count < previous:
                rule["counter_reset"] = True
            rule["packet_count"] = packet_count
        if byte_count is not None:
            rule["byte_count"] = byte_count

    def snapshot(self) -> dict[str, Any]:
        rules = sorted(
            (deepcopy(rule) for rule in self._rules.values()),
            key=lambda item: (str(item.get("dpid")), str(item.get("cookie"))),
        )
        verified_sources = {
            rule["src_ip"]
            for rule in rules
            if rule["status"] in {"VERIFIED", "DROPPING"}
            and isinstance(rule.get("src_ip"), str)
            and rule["src_ip"]
        }
        latency_samples = list(self._mitigation_observation_latencies.values())
        return {
            "prediction_count": len(self._prediction_ids),
            "prediction_class_counts": deepcopy(self._prediction_class_counts),
            "latest_prediction": deepcopy(self._latest_prediction),
            "latest_policies": [
                deepcopy(self._policies[sample_id])
                for sample_id in self._policy_order[-100:]
            ],
            "rules": rules,
            "verified_source_count": len(verified_sources),
            "observations": deepcopy(self._phases[-100:]),
            "alert_event_count": self._alert_event_count,
            "alert_events": deepcopy(self._alert_events),
            "recent_events": deepcopy(self._recent_events),
            "drop_counter_sample_count": self._drop_counter_sample_count,
            "drop_counter_history": deepcopy(self._drop_counter_history),
            "mitigation_observation_ms": (
                median(latency_samples) if latency_samples else None
            ),
            "mitigation_observation_count": len(latency_samples),
        }
