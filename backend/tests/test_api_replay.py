from __future__ import annotations

import json
import os
from pathlib import Path
import time
from urllib.parse import urlencode

from fastapi.testclient import TestClient

from b8_dashboard.app import create_app
from b8_dashboard.service import B8DashboardService
from b8_dashboard.state import B8StateReducer


FIXTURES = Path(__file__).parent / "fixtures"
S8_RUN = "s8_seed1101"
S8_COOKIE = "0xb83524a71b55e4bc"


def _client(active_run_id: str | None = None) -> TestClient:
    return TestClient(
        create_app(
            FIXTURES,
            active_run_id=active_run_id,
            allowed_origins=["http://localhost:5173"],
        )
    )


def _write_live_run(
    log_root: Path,
    run_id: str,
    *,
    status: str = "running",
    activity_age: float = 0,
) -> Path:
    run_dir = log_root / run_id
    run_dir.mkdir(parents=True)
    (run_dir / "manifest.json").write_text(
        json.dumps(
            {
                "run_id": run_id,
                "scenario": "S1",
                "seed": 701,
                "mode": "MITIGATE",
                "status": status,
            }
        ),
        encoding="utf-8",
    )
    (run_dir / "ryu_events.jsonl").write_text(
        json.dumps(
            {
                "event": "v2_prediction",
                "run_id": run_id,
                "id": f"{run_id}-prediction",
                "timestamp": 1795701900.0,
            }
        )
        + "\n",
        encoding="utf-8",
    )
    old_time = time.time() - activity_age
    os.utime(run_dir / "ryu_events.jsonl", (old_time, old_time))
    return run_dir


def _append_finished_phase(run_dir: Path, status: str) -> None:
    with (run_dir / "events.jsonl").open("a", encoding="utf-8") as file:
        file.write(
            json.dumps(
                {
                    "schema_version": "fixture-1",
                    "run_id": run_dir.name,
                    "phase_seq": 99,
                    "changed_at": "2026-11-28T00:00:00Z",
                    "phase": "fixture-phase",
                    "traffic_mode": "finished",
                    "status": status,
                    "experiment_mode": "MITIGATE",
                }
            )
            + "\n"
        )
        file.flush()


def test_s1_fixture_is_replay_and_keeps_run_metadata() -> None:
    with _client() as client:
        response = client.get("/api/runs/s1_seed701/snapshot")

    assert response.status_code == 200
    snapshot = response.json()
    assert snapshot["data_mode"] == "REPLAY"
    assert snapshot["run_id"] == "s1_seed701"
    assert snapshot["run"]["scenario"] == "S1"
    assert snapshot["run"]["seed"] == 701
    assert snapshot["policy_mode"] == "MITIGATE"
    assert snapshot["state"]["prediction_count"] == 1
    assert snapshot["state"]["latest_prediction"]["source_timestamp"] == 1795701900.0
    assert len(snapshot["state"]["observations"]) == 2


def test_snapshot_maps_seed_reference_when_manifest_seed_is_absent(tmp_path: Path) -> None:
    run_id = "seed-reference-run"
    run_dir = tmp_path / run_id
    run_dir.mkdir()
    (run_dir / "manifest.json").write_text(
        json.dumps(
            {
                "scenario": "S8",
                "seed_reference": 1101,
                "mode": "MITIGATE",
            }
        ),
        encoding="utf-8",
    )

    with TestClient(create_app(tmp_path)) as client:
        response = client.get(f"/api/runs/{run_id}/snapshot")

    assert response.status_code == 200
    assert response.json()["run"]["seed"] == 1101


def test_s8_fixture_counter_and_lifecycle_are_idempotent() -> None:
    with _client() as client:
        response = client.get(f"/api/runs/{S8_RUN}/snapshot")

    assert response.status_code == 200
    state = response.json()["state"]
    assert state["prediction_count"] == 1
    assert len(state["rules"]) == 6
    target = next(rule for rule in state["rules"] if rule["cookie"] == S8_COOKIE)
    assert target["status"] == "CLEANED"
    assert target["packet_count"] == 7300
    assert target["packet_count"] != 142 + 7300
    assert target["byte_count"] == 394200
    assert target["reason"] == 0
    assert target["counter_source"] == "verified_flow_stats"
    assert target["evidence"]["source"] == "controller"
    assert target["mitigation_action"] == "DROP"
    assert all(
        rule["status"] == "CONFIRMED"
        for rule in state["rules"]
        if rule["cookie"] != S8_COOKIE
    )


def test_snapshot_aggregates_all_prediction_classes_alerts_and_drop_counters(
    tmp_path: Path,
) -> None:
    run_id = "observability-run"
    run_dir = tmp_path / run_id
    run_dir.mkdir()
    (run_dir / "manifest.json").write_text(
        json.dumps({"run_id": run_id, "status": "complete", "mode": "MITIGATE"}),
        encoding="utf-8",
    )
    common = {
        "run_id": run_id,
        "sample_id": "sample-syn",
        "src_ip": "10.0.0.10",
        "dst_ip": "10.0.0.100",
        "ip_proto": 6,
        "cookie": "0xb8test",
        "dpid": 3,
        "mitigation_action": "DROP",
    }
    records = [
        {
            "event": "v2_prediction",
            "run_id": run_id,
            "id": "sample-benign",
            "timestamp": 100.0,
            "prediction": "benign",
            "src_ip": "10.0.0.1",
        },
        {
            "event": "v2_prediction",
            "run_id": run_id,
            "id": "sample-syn",
            "timestamp": 101.0,
            "prediction": "syn_flood",
            "src_ip": "10.0.0.10",
        },
        {
            "event": "v2_prediction",
            "run_id": run_id,
            "id": "sample-udp",
            "timestamp": 102.0,
            "prediction": "udp_flood",
            "src_ip": "10.0.0.11",
        },
        {
            "event": "v2_prediction",
            "run_id": run_id,
            "id": "sample-syn",
            "timestamp": 103.0,
            "prediction": "syn_flood",
            "src_ip": "10.0.0.10",
        },
        {
            **common,
            "event": "b8_mitigation_requested",
            "timestamp": 200.0,
        },
        {
            **common,
            "event": "b8_mitigation_confirmed",
            "timestamp": 200.1,
        },
        {
            **common,
            "event": "b8_drop_counter",
            "timestamp": 200.25,
            "packet_count": 142,
            "counter_source": "verified_flow_stats",
        },
        {
            **common,
            "event": "b8_drop_counter",
            "timestamp": 200.5,
            "packet_count": 200,
            "counter_source": "verified_flow_stats",
        },
        {
            **common,
            "event": "b8_mitigation_flow_removed",
            "timestamp": 210.0,
            "reason": 0,
            "packet_count": 12795,
            "byte_count": 1000000,
        },
        {
            **common,
            "event": "b8_mitigation_cleaned",
            "timestamp": 210.1,
        },
    ]
    (run_dir / "ryu_events.jsonl").write_text(
        "".join(json.dumps(record) + "\n" for record in records),
        encoding="utf-8",
    )

    with TestClient(create_app(tmp_path)) as client:
        response = client.get(f"/api/runs/{run_id}/snapshot")

    assert response.status_code == 200
    state = response.json()["state"]
    assert state["prediction_count"] == 3
    assert state["prediction_class_counts"] == {
        "benign": 1,
        "syn_flood": 1,
        "udp_flood": 1,
    }
    assert state["alert_event_count"] == 5
    assert [event["kind"] for event in state["alert_events"]] == [
        "ai.prediction",
        "ai.prediction",
        "mitigation.requested",
        "mitigation.confirmed",
        "mitigation.counter",
    ]
    assert all(event["payload"].get("src_ip") for event in state["alert_events"])
    assert state["drop_counter_sample_count"] == 2
    assert [item["packet_count"] for item in state["drop_counter_history"]] == [142, 200]
    assert [item["delta"] for item in state["drop_counter_history"]] == [None, 58]
    assert state["drop_counter_history"][-1]["cookie"] == "0xb8test"
    assert state["mitigation_observation_ms"] == 250
    assert state["mitigation_observation_count"] == 1
    rule = state["rules"][0]
    assert rule["status"] == "CLEANED"
    assert rule["packet_count"] == 12795
    assert any(event["payload"].get("src_ip") == "10.0.0.10" for event in state["recent_events"])


def test_snapshot_keeps_full_aggregate_counts_with_bounded_event_histories(
    tmp_path: Path,
) -> None:
    run_id = "bounded-observability-run"
    run_dir = tmp_path / run_id
    run_dir.mkdir()
    (run_dir / "manifest.json").write_text(
        json.dumps({"run_id": run_id, "status": "complete"}),
        encoding="utf-8",
    )
    records = [
        {
            "event": "v2_prediction",
            "run_id": run_id,
            "id": f"sample-{index}",
            "timestamp": 1000.0 + index,
            "prediction": "syn_flood",
            "src_ip": "10.0.0.10",
        }
        for index in range(101)
    ]
    records.extend(
        {
            "event": "b8_drop_counter",
            "run_id": run_id,
            "timestamp": 2000.0 + index,
            "cookie": "0xb8bounded",
            "dpid": 3,
            "src_ip": "10.0.0.10",
            "mitigation_action": "DROP",
            "counter_source": "verified_flow_stats",
            "packet_count": index,
        }
        for index in range(505)
    )
    (run_dir / "ryu_events.jsonl").write_text(
        "".join(json.dumps(record) + "\n" for record in records),
        encoding="utf-8",
    )

    with TestClient(create_app(tmp_path)) as client:
        response = client.get(f"/api/runs/{run_id}/snapshot")

    assert response.status_code == 200
    state = response.json()["state"]
    assert state["prediction_count"] == 101
    assert state["prediction_class_counts"]["syn_flood"] == 101
    assert state["alert_event_count"] == 102
    assert len(state["alert_events"]) == 100
    assert state["drop_counter_sample_count"] == 505
    assert len(state["drop_counter_history"]) == 500
    assert len(state["recent_events"]) == 500
    assert state["drop_counter_history"][-1]["packet_count"] == 504


def test_snapshot_retains_all_cleaned_rules_and_final_flow_removed_counters(
    tmp_path: Path,
) -> None:
    run_id = "cleaned-rules-run"
    run_dir = tmp_path / run_id
    run_dir.mkdir()
    (run_dir / "manifest.json").write_text(
        json.dumps({"scenario": "S8", "seed_reference": 1101, "mode": "MITIGATE"}),
        encoding="utf-8",
    )
    records: list[dict] = []
    target_cookie = "0xb83524a71b55e4bc"
    for index in range(6):
        src_ip = f"10.0.0.{10 + index // 2}"
        ip_proto = 6 if index % 2 == 0 else 17
        cookie = target_cookie if index == 0 else f"0xcafe00000000000{index:x}"
        common = {
            "run_id": run_id,
            "sample_id": f"sample-{index}",
            "cookie": cookie,
            "dpid": 3,
            "src_ip": src_ip,
            "dst_ip": "10.0.0.100",
            "ip_proto": ip_proto,
            "mitigation_action": "DROP",
        }
        records.extend(
            [
                {
                    **common,
                    "event": "b8_mitigation_confirmed",
                    "timestamp": 1795701900.0 + index,
                },
                {
                    **common,
                    "event": "b8_drop_counter",
                    "timestamp": 1795701901.0 + index,
                    "counter_source": "verified_flow_stats",
                    "packet_count": 142,
                    "byte_count": 10000,
                },
                {
                    **common,
                    "event": "b8_mitigation_flow_removed",
                    "timestamp": 1795701902.0 + index,
                    "reason": 0,
                    "packet_count": 7300 if index == 0 else 20 + index,
                    "byte_count": 394200 if index == 0 else 2000 + index,
                },
                {
                    **common,
                    "event": "b8_mitigation_cleaned",
                    "timestamp": 1795701903.0 + index,
                },
            ]
        )
    (run_dir / "ryu_events.jsonl").write_text(
        "".join(json.dumps(record) + "\n" for record in records),
        encoding="utf-8",
    )

    with TestClient(create_app(tmp_path)) as client:
        response = client.get(f"/api/runs/{run_id}/snapshot")

    assert response.status_code == 200
    snapshot = response.json()
    state = snapshot["state"]
    assert len(state["rules"]) == 6
    assert len({rule["src_ip"] for rule in state["rules"]}) == 3
    assert {rule["ip_proto"] for rule in state["rules"]} == {6, 17}
    assert all(rule["status"] == "CLEANED" for rule in state["rules"])
    assert all(rule["evidence"]["source"] == "controller" for rule in state["rules"])
    assert state["verified_source_count"] == 0

    target = next(rule for rule in state["rules"] if rule["cookie"] == target_cookie)
    assert target["packet_count"] == 7300
    assert target["byte_count"] == 394200
    assert target["reason"] == 0


def test_snapshot_accepts_phase_state_records_without_event_and_deduplicates_marker(
    tmp_path: Path,
) -> None:
    run_id = "run-phase"
    run_dir = tmp_path / run_id
    run_dir.mkdir()
    (run_dir / "manifest.json").write_text(
        json.dumps(
            {
                "run_id": run_id,
                "scenario": "S1",
                "seed": 701,
                "mode": "MITIGATE",
                "status": "running",
            }
        ),
        encoding="utf-8",
    )
    (run_dir / "timeline.jsonl").write_text(
        json.dumps(
            {
                "event": "PHA_KICH_BAN",
                "run_id": run_id,
                "phase": "traffic",
                "timestamp": 1795701900.0,
            }
        )
        + "\n",
        encoding="utf-8",
    )
    (run_dir / "events.jsonl").write_text(
        json.dumps(
            {
                "schema_version": "1",
                "run_id": run_id,
                "phase_seq": 1,
                "changed_at": "2026-11-27T15:25:00Z",
                "phase": "traffic",
                "traffic_mode": "mixed",
                "status": "running",
                "experiment_mode": "MITIGATE",
            }
        )
        + "\n",
        encoding="utf-8",
    )

    with TestClient(create_app(tmp_path)) as client:
        response = client.get(f"/api/runs/{run_id}/snapshot")

    assert response.status_code == 200
    snapshot = response.json()
    observations = snapshot["state"]["observations"]

    assert snapshot["run_id"] == run_id
    assert snapshot["data_mode"] == "REPLAY"
    assert snapshot["state"]["prediction_count"] == 0
    assert snapshot["state"]["rules"] == []
    assert len(observations) == 1
    assert observations[0]["kind"] == "timeline.observation"
    assert observations[0]["raw_event"] == "PHA_KICH_BAN"


def test_timeline_counter_observation_does_not_mutate_drop_count() -> None:
    service = B8DashboardService(FIXTURES)
    snapshot = service.snapshot(S8_RUN, "REPLAY")
    target = next(
        rule for rule in snapshot["state"]["rules"] if rule["cookie"] == S8_COOKIE
    )

    assert target["packet_count"] == 7300
    assert snapshot["state"]["prediction_count"] == 1
    assert target["status"] == "CLEANED"


def test_confirmed_is_not_verified_without_valid_flow_stats() -> None:
    service = B8DashboardService(FIXTURES)
    manifest = service._manifest(S8_RUN)
    cursor = service.reader.initial_cursor(S8_RUN)
    page = service.events(S8_RUN, cursor, 4, "REPLAY")
    reducer = B8StateReducer()
    for event in page.events:
        reducer.apply(event)

    target = next(
        rule
        for rule in reducer.snapshot()["rules"]
        if rule["cookie"] == S8_COOKIE
    )
    assert target["status"] == "CONFIRMED"
    assert target["evidence"] is None
    assert manifest["mode"] == "MITIGATE"

    with _client() as client:
        final_snapshot = client.get(f"/api/runs/{S8_RUN}/snapshot").json()
    dropping = next(
        rule for rule in final_snapshot["state"]["rules"] if rule["cookie"] == S8_COOKIE
    )
    assert dropping["status"] == "CLEANED"
    assert dropping["packet_count"] == 7300
    assert dropping["evidence"]["reference"]


def test_invalid_flow_stats_timestamp_does_not_verify_rule() -> None:
    service = B8DashboardService(FIXTURES)
    page = service.events(
        S8_RUN,
        service.reader.initial_cursor(S8_RUN),
        5,
        "REPLAY",
    )
    reducer = B8StateReducer()
    for event in page.events[:4]:
        reducer.apply(event)

    invalid_counter = {**page.events[4], "source_timestamp": "not-a-timestamp"}
    reducer.apply(invalid_counter)
    target = next(
        rule
        for rule in reducer.snapshot()["rules"]
        if rule["cookie"] == S8_COOKIE
    )

    assert target["status"] == "CONFIRMED"
    assert target["packet_count"] == 142
    assert target["evidence"] is None


def test_event_page_then_websocket_resume_has_no_duplicate_ids() -> None:
    with _client() as client:
        first_page = client.get(
            f"/api/runs/{S8_RUN}/events",
            params={"limit": 2, "data_mode": "REPLAY"},
        )
        assert first_page.status_code == 200
        first = first_page.json()
        assert first["has_more"] is True
        first_ids = [event["event_id"] for event in first["events"]]

        query = urlencode(
            {
                "after": first["next_cursor"],
                "data_mode": "REPLAY",
            }
        )
        resumed_events: list[dict] = []
        with client.websocket_connect(f"/ws/runs/{S8_RUN}?{query}") as websocket:
            while True:
                frame = websocket.receive_json()
                if frame["type"] == "replay_complete":
                    break
                assert frame["type"] == "event"
                resumed_events.append(frame["event"])

        resumed_ids = [event["event_id"] for event in resumed_events]
        assert not set(first_ids).intersection(resumed_ids)
        assert len(resumed_ids) == len(set(resumed_ids))
        assert len(first_ids + resumed_ids) == len(set(first_ids + resumed_ids))
        last_applied_cursor = resumed_events[-1]["cursor"]

        reconnect_query = urlencode(
            {
                "after": last_applied_cursor,
                "data_mode": "REPLAY",
            }
        )
        with client.websocket_connect(f"/ws/runs/{S8_RUN}?{reconnect_query}") as websocket:
            frame = websocket.receive_json()
            assert frame == {
                "type": "replay_complete",
                "cursor": last_applied_cursor,
            }


def test_snapshot_cursor_websocket_replay_and_reconnect_are_idempotent(
    tmp_path: Path,
) -> None:
    run_id = "snapshot-ws-run"
    run_dir = tmp_path / run_id
    run_dir.mkdir()
    (run_dir / "manifest.json").write_text(
        json.dumps({"scenario": "S1", "seed": 701, "mode": "MITIGATE"}),
        encoding="utf-8",
    )
    source = run_dir / "ryu_events.jsonl"
    source.write_text(
        json.dumps(
            {
                "event": "v2_prediction",
                "run_id": run_id,
                "id": "prediction-in-snapshot",
                "timestamp": 1795701900.0,
            }
        )
        + "\n",
        encoding="utf-8",
    )

    with TestClient(create_app(tmp_path)) as client:
        snapshot_response = client.get(f"/api/runs/{run_id}/snapshot")
        assert snapshot_response.status_code == 200
        snapshot_cursor = snapshot_response.json()["as_of_cursor"]

        with source.open("a", encoding="utf-8") as file:
            file.write(
                json.dumps(
                    {
                        "event": "v2_prediction",
                        "run_id": run_id,
                        "id": "prediction-after-snapshot",
                        "timestamp": 1795701901.0,
                    }
                )
                + "\n"
            )

        query = urlencode({"after": snapshot_cursor, "data_mode": "REPLAY"})
        replayed: list[dict] = []
        with client.websocket_connect(f"/ws/runs/{run_id}?{query}") as websocket:
            while True:
                frame = websocket.receive_json()
                if frame["type"] == "replay_complete":
                    break
                assert frame["type"] == "event"
                replayed.append(frame["event"])

        assert [event["keys"]["sample_id"] for event in replayed] == [
            "prediction-after-snapshot"
        ]
        last_applied_cursor = replayed[-1]["cursor"]

        reconnect_query = urlencode(
            {"after": last_applied_cursor, "data_mode": "REPLAY"}
        )
        with client.websocket_connect(f"/ws/runs/{run_id}?{reconnect_query}") as websocket:
            assert websocket.receive_json() == {
                "type": "replay_complete",
                "cursor": last_applied_cursor,
            }


def test_websocket_requires_snapshot_cursor() -> None:
    with _client() as client:
        with client.websocket_connect(
            f"/ws/runs/{S8_RUN}?data_mode=REPLAY"
        ) as websocket:
            frame = websocket.receive_json()

    assert frame == {
        "type": "resync_required",
        "reason": "snapshot_cursor_required",
    }


def test_replay_route_does_not_claim_live_without_active_run_configuration() -> None:
    with _client() as client:
        response = client.get(
            f"/api/runs/{S8_RUN}/snapshot",
            params={"data_mode": "LIVE"},
        )

    assert response.status_code == 409
    assert "active run" in response.json()["detail"]


def test_invalid_run_and_cursor_return_explicit_errors() -> None:
    with _client() as client:
        invalid_run = client.get("/api/runs/../snapshot")
        page = client.get(f"/api/runs/{S8_RUN}/events?after=not-a-cursor")

    assert invalid_run.status_code in {400, 404}
    assert page.status_code == 409
    assert page.json()["detail"]["resync_required"] is True


def test_live_mode_supports_manual_pin_and_auto_discovery(tmp_path: Path) -> None:
    run_id = "live-run"
    _write_live_run(tmp_path, run_id)
    with TestClient(create_app(tmp_path)) as auto_client:
        auto_response = auto_client.get(
            f"/api/runs/{run_id}/snapshot",
            params={"data_mode": "LIVE"},
        )
    with TestClient(create_app(tmp_path, active_run_id=run_id)) as manual_client:
        manual_response = manual_client.get(
            f"/api/runs/{run_id}/snapshot",
            params={"data_mode": "LIVE"},
        )

    assert auto_response.status_code == 200
    assert auto_response.json()["data_mode"] == "LIVE"
    assert manual_response.status_code == 200
    assert manual_response.json()["data_mode"] == "LIVE"


def test_live_mode_rejects_run_without_fresh_activity(tmp_path: Path) -> None:
    run_id = "stale-run"
    _write_live_run(tmp_path, run_id, activity_age=31)
    with TestClient(create_app(tmp_path, active_run_id=run_id)) as client:
        response = client.get(
            f"/api/runs/{run_id}/snapshot",
            params={"data_mode": "LIVE"},
        )

    assert response.status_code == 409


def test_auto_discovery_finds_run_created_after_backend_start(tmp_path: Path) -> None:
    with TestClient(create_app(tmp_path)) as client:
        before = client.get("/api/runs").json()
        assert before["live_discovery"]["status"] == "none"

        _write_live_run(tmp_path, "new-live-run")
        response = client.get("/api/runs")

    assert response.status_code == 200
    body = response.json()
    assert body["live_discovery"] == {
        "mode": "automatic",
        "status": "single",
        "selected_run_id": "new-live-run",
        "candidate_run_ids": ["new-live-run"],
        "freshness_seconds": 30,
    }
    assert body["runs"][0]["live"]["eligible"] is True
    assert body["runs"][0]["live"]["freshness"] == "fresh"


def test_discovery_excludes_stale_completed_and_aborted_runs(tmp_path: Path) -> None:
    _write_live_run(tmp_path, "fresh-run")
    _write_live_run(tmp_path, "stale-run", activity_age=31)
    _write_live_run(tmp_path, "aborted-run", status="aborted")
    _write_live_run(tmp_path, "complete-run", status="completed")
    invalid_run_dir = _write_live_run(tmp_path, "manifest-mismatch-run")
    (invalid_run_dir / "manifest.json").write_text(
        json.dumps(
            {
                "run_id": "another-run",
                "scenario": "S1",
                "seed": 701,
                "mode": "MITIGATE",
                "status": "running",
            }
        ),
        encoding="utf-8",
    )

    with TestClient(create_app(tmp_path)) as client:
        body = client.get("/api/runs").json()

    assert body["live_discovery"]["candidate_run_ids"] == ["fresh-run"]
    runs = {run["run_id"]: run["live"] for run in body["runs"]}
    assert runs["stale-run"]["eligible"] is False
    assert runs["stale-run"]["freshness"] == "stale"
    assert runs["aborted-run"]["eligible"] is False
    assert runs["aborted-run"]["terminal"] is True
    assert runs["complete-run"]["eligible"] is False
    assert runs["manifest-mismatch-run"]["eligible"] is False


def test_multiple_fresh_runs_are_reported_without_selecting_one(tmp_path: Path) -> None:
    _write_live_run(tmp_path, "live-run-a")
    _write_live_run(tmp_path, "live-run-b")

    with TestClient(create_app(tmp_path)) as client:
        body = client.get("/api/runs").json()

    assert body["live_discovery"]["status"] == "ambiguous"
    assert body["live_discovery"]["selected_run_id"] is None
    assert body["live_discovery"]["candidate_run_ids"] == ["live-run-a", "live-run-b"]


def test_manual_run_pin_does_not_fall_back_to_another_candidate(tmp_path: Path) -> None:
    _write_live_run(tmp_path, "pinned-stale-run", activity_age=31)
    _write_live_run(tmp_path, "other-fresh-run")

    with TestClient(create_app(tmp_path, active_run_id="pinned-stale-run")) as client:
        body = client.get("/api/runs").json()
        live_snapshot = client.get(
            "/api/runs/other-fresh-run/snapshot",
            params={"data_mode": "LIVE"},
        )

    assert body["live_discovery"]["mode"] == "manual"
    assert body["live_discovery"]["status"] == "manual_unavailable"
    assert body["live_discovery"]["candidate_run_ids"] == []
    assert live_snapshot.status_code == 409


def test_live_websocket_reports_completion_after_flushed_final_events(
    tmp_path: Path,
) -> None:
    run_id = "live-completing-run"
    run_dir = _write_live_run(tmp_path, run_id)
    source = run_dir / "ryu_events.jsonl"
    app = create_app(
        tmp_path,
        active_run_id=run_id,
        poll_interval=0.1,
        heartbeat_interval=1.0,
        finalization_timeout=1.0,
    )

    with TestClient(app) as client:
        snapshot = client.get(
            f"/api/runs/{run_id}/snapshot",
            params={"data_mode": "LIVE"},
        ).json()
        query = urlencode(
            {"after": snapshot["as_of_cursor"], "data_mode": "LIVE"}
        )
        with client.websocket_connect(f"/ws/runs/{run_id}?{query}") as websocket:
            with source.open("a", encoding="utf-8") as file:
                for index in range(105):
                    file.write(
                        json.dumps(
                            {
                                "event": "v2_prediction",
                                "run_id": run_id,
                                "id": f"final-prediction-{index}",
                                "timestamp": 1795701901.0 + index,
                            }
                        )
                        + "\n"
                    )
                file.flush()
            (run_dir / "manifest.json").write_text(
                json.dumps({"run_id": run_id, "status": "complete"}),
                encoding="utf-8",
            )
            frames = []
            while True:
                frame = websocket.receive_json()
                frames.append(frame)
                if frame["type"] == "run_status" and frame["status"] == "complete":
                    break

            assert not any(frame["type"] == "run_complete" for frame in frames)
            _append_finished_phase(run_dir, "complete")

            while True:
                frame = websocket.receive_json()
                frames.append(frame)
                if frame["type"] == "run_complete":
                    break

    final_events = [frame for frame in frames if frame["type"] == "event"]
    assert len(final_events) == 106
    assert final_events[104]["event"]["keys"]["sample_id"] == "final-prediction-104"
    assert final_events[-1]["event"]["kind"] == "run.phase"
    assert final_events[-1]["event"]["payload"]["traffic_mode"] == "finished"
    assert frames[-1]["type"] == "run_complete"
    assert frames[-1]["status"] == "complete"
    assert frames[-1]["finalization_status"] == "confirmed"

    with TestClient(create_app(tmp_path, active_run_id=run_id)) as client:
        final_snapshot = client.get(
            f"/api/runs/{run_id}/snapshot",
            params={"data_mode": "REPLAY"},
        ).json()
        reconnect_query = urlencode(
            {"after": frames[-1]["cursor"], "data_mode": "LIVE"}
        )
        with client.websocket_connect(
            f"/ws/runs/{run_id}?{reconnect_query}"
        ) as websocket:
            reconnect_frame = websocket.receive_json()

    assert final_snapshot["state"]["prediction_count"] == 106
    assert any(
        event["kind"] == "run.phase"
        and event["payload"]["traffic_mode"] == "finished"
        for event in final_snapshot["state"]["observations"]
    )
    assert reconnect_frame["type"] == "run_complete"
    assert reconnect_frame["finalization_status"] == "confirmed"


def test_live_websocket_waits_for_finished_phase_after_terminal_manifest(
    tmp_path: Path,
) -> None:
    run_id = "live-reconnect-finalizing-run"
    run_dir = _write_live_run(tmp_path, run_id)
    app = create_app(
        tmp_path,
        active_run_id=run_id,
        poll_interval=0.05,
        finalization_timeout=1.0,
    )

    with TestClient(app) as client:
        snapshot = client.get(
            f"/api/runs/{run_id}/snapshot",
            params={"data_mode": "LIVE"},
        ).json()
        cursor = snapshot["as_of_cursor"]
        (run_dir / "manifest.json").write_text(
            json.dumps({"run_id": run_id, "status": "completed"}),
            encoding="utf-8",
        )

        with client.websocket_connect(
            f"/ws/runs/{run_id}?{urlencode({'after': cursor, 'data_mode': 'LIVE'})}"
        ) as first_socket:
            while True:
                frame = first_socket.receive_json()
                if frame["type"] == "run_status" and frame["status"] == "completed":
                    break
            assert frame["terminal"] is True
            _append_finished_phase(run_dir, "completed")

        with client.websocket_connect(
            f"/ws/runs/{run_id}?{urlencode({'after': cursor, 'data_mode': 'LIVE'})}"
        ) as reconnected_socket:
            frames = []
            while True:
                frame = reconnected_socket.receive_json()
                frames.append(frame)
                if frame["type"] == "run_complete":
                    break

    phase_events = [
        frame for frame in frames
        if frame["type"] == "event" and frame["event"]["kind"] == "run.phase"
    ]
    assert len(phase_events) == 1
    assert phase_events[0]["event"]["payload"]["traffic_mode"] == "finished"
    assert frames[-1]["type"] == "run_complete"
    assert frames[-1]["finalization_status"] == "confirmed"


def test_finished_marker_status_must_match_terminal_manifest(
    tmp_path: Path,
) -> None:
    run_id = "live-finished-status-mismatch"
    run_dir = _write_live_run(tmp_path, run_id)
    app = create_app(
        tmp_path,
        active_run_id=run_id,
        poll_interval=0.02,
        finalization_timeout=0.12,
    )

    with TestClient(app) as client:
        snapshot = client.get(
            f"/api/runs/{run_id}/snapshot",
            params={"data_mode": "LIVE"},
        ).json()
        (run_dir / "manifest.json").write_text(
            json.dumps({"run_id": run_id, "status": "complete"}),
            encoding="utf-8",
        )
        _append_finished_phase(run_dir, "aborted")
        query = urlencode(
            {"after": snapshot["as_of_cursor"], "data_mode": "LIVE"}
        )
        with client.websocket_connect(f"/ws/runs/{run_id}?{query}") as websocket:
            while True:
                frame = websocket.receive_json()
                if frame["type"] == "run_complete":
                    break

    assert frame["status"] == "complete"
    assert frame["finalization_status"] == "timeout"


def test_terminal_runs_present_before_backend_start_reconnect_without_duplicates(
    tmp_path: Path,
) -> None:
    terminal_runs = (
        ("already-complete", "complete"),
        ("already-aborted", "aborted"),
    )
    for run_id, status in terminal_runs:
        run_dir = _write_live_run(tmp_path, run_id, status=status)
        _append_finished_phase(run_dir, status)

    with TestClient(create_app(tmp_path, poll_interval=0.02)) as client:
        for run_id, status in terminal_runs:
            snapshot = client.get(
                f"/api/runs/{run_id}/snapshot",
                params={"data_mode": "REPLAY"},
            ).json()
            query = urlencode(
                {"after": snapshot["as_of_cursor"], "data_mode": "LIVE"}
            )
            with client.websocket_connect(
                f"/ws/runs/{run_id}?{query}"
            ) as websocket:
                frames = []
                while True:
                    frame = websocket.receive_json()
                    frames.append(frame)
                    if frame["type"] == "run_complete":
                        break

            assert frames[-1]["status"] == status
            assert frames[-1]["finalization_status"] == "confirmed"
            assert not any(frame["type"] == "event" for frame in frames)


def test_aborted_run_without_finished_phase_completes_after_finite_wait(
    tmp_path: Path,
) -> None:
    run_id = "live-aborted-without-finished"
    run_dir = _write_live_run(tmp_path, run_id)
    app = create_app(
        tmp_path,
        active_run_id=run_id,
        poll_interval=0.02,
        finalization_timeout=0.15,
    )

    with TestClient(app) as client:
        snapshot = client.get(
            f"/api/runs/{run_id}/snapshot",
            params={"data_mode": "LIVE"},
        ).json()
        query = urlencode(
            {"after": snapshot["as_of_cursor"], "data_mode": "LIVE"}
        )
        started = time.monotonic()
        with client.websocket_connect(f"/ws/runs/{run_id}?{query}") as websocket:
            (run_dir / "manifest.json").write_text(
                json.dumps({"run_id": run_id, "status": "aborted"}),
                encoding="utf-8",
            )
            while True:
                frame = websocket.receive_json()
                if frame["type"] == "run_complete":
                    break

    assert frame["status"] == "aborted"
    assert frame["finalization_status"] == "timeout"
    assert time.monotonic() - started < 1.0


def test_live_websocket_reads_appended_complete_jsonl_lines(tmp_path: Path) -> None:
    run_id = "live-run"
    run_dir = tmp_path / run_id
    run_dir.mkdir()
    (run_dir / "manifest.json").write_text(
        json.dumps(
            {
                "run_id": run_id,
                "scenario": "S1",
                "seed": 701,
                "mode": "MITIGATE",
                "status": "running",
            }
        ),
        encoding="utf-8",
    )
    source = run_dir / "ryu_events.jsonl"
    source.write_text(
        json.dumps(
            {
                "event": "v2_prediction",
                "run_id": run_id,
                "id": "prediction-before-subscribe",
                "timestamp": 1795701900.0,
            }
        )
        + "\n",
        encoding="utf-8",
    )
    app = create_app(
        tmp_path,
        active_run_id=run_id,
        allowed_origins=["http://localhost:5173"],
        poll_interval=0.1,
        heartbeat_interval=1.0,
    )

    with TestClient(app) as client:
        snapshot = client.get(
            f"/api/runs/{run_id}/snapshot",
            params={"data_mode": "LIVE"},
        ).json()
        query = urlencode(
            {"after": snapshot["as_of_cursor"], "data_mode": "LIVE"}
        )
        with client.websocket_connect(f"/ws/runs/{run_id}?{query}") as websocket:
            with source.open("a", encoding="utf-8") as file:
                file.write(
                    json.dumps(
                        {
                            "event": "v2_prediction",
                            "run_id": run_id,
                            "id": "prediction-after-subscribe",
                            "timestamp": 1795701901.0,
                        }
                    )
                    + "\n"
                )
                file.flush()
            frame = websocket.receive_json()

    assert frame["type"] == "event"
    assert frame["event"]["data_mode"] == "LIVE"
    assert frame["event"]["keys"]["sample_id"] == "prediction-after-subscribe"


def test_non_loopback_bind_requires_token_and_specific_address() -> None:
    try:
        create_app(FIXTURES, host="192.0.2.10")
    except ValueError as error:
        assert "B8_DASHBOARD_TOKEN" in str(error)
    else:
        raise AssertionError("non-loopback binding without a token must be rejected")

    try:
        create_app(FIXTURES, host="0.0.0.0", dashboard_token="fixture-token")
    except ValueError as error:
        assert "unspecified address" in str(error)
    else:
        raise AssertionError("unspecified bind address must be rejected")
