from __future__ import annotations

from copy import deepcopy
import math
from typing import Any


def _integer(value: Any) -> int | None:
    if type(value) is int and value >= 0:
        return value
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
        self._latest_prediction: dict[str, Any] | None = None
        self._policies: dict[str, dict[str, Any]] = {}
        self._policy_order: list[str] = []
        self._rules: dict[tuple[str, str], dict[str, Any]] = {}
        self._phases: list[dict[str, Any]] = []

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
                self._prediction_ids.add(str(prediction_id))
                self._latest_prediction = deepcopy(event)
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
        elif kind == "run.phase":
            if self._has_timeline_phase_marker(event):
                return True
            self._phases.append(deepcopy(event))
            self._phases = self._phases[-200:]
        elif kind in {"timeline.observation", "source.observation"}:
            self._phases.append(deepcopy(event))
            self._phases = self._phases[-200:]
        return True

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
        return {
            "prediction_count": len(self._prediction_ids),
            "latest_prediction": deepcopy(self._latest_prediction),
            "latest_policies": [
                deepcopy(self._policies[sample_id])
                for sample_id in self._policy_order[-100:]
            ],
            "rules": rules,
            "verified_source_count": len(verified_sources),
            "observations": deepcopy(self._phases[-100:]),
        }
