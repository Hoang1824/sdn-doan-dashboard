from __future__ import annotations

import json
from pathlib import Path
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


def test_snapshot_accepts_phase_state_records_without_event_and_deduplicates_marker(
    tmp_path: Path,
) -> None:
    run_id = "run-phase"
    run_dir = tmp_path / run_id
    run_dir.mkdir()
    (run_dir / "manifest.json").write_text(
        json.dumps({"scenario": "S1", "seed": 701, "mode": "MITIGATE"}),
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

        reconnect_query = urlencode(
            {
                "after": resumed_events[-1]["cursor"],
                "data_mode": "REPLAY",
            }
        )
        with client.websocket_connect(f"/ws/runs/{S8_RUN}?{reconnect_query}") as websocket:
            assert websocket.receive_json()["type"] == "replay_complete"


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


def test_read_only_live_mode_requires_explicit_active_run_id() -> None:
    with _client(active_run_id=S8_RUN) as client:
        response = client.get(
            f"/api/runs/{S8_RUN}/snapshot",
            params={"data_mode": "LIVE"},
        )

    assert response.status_code == 200
    assert response.json()["data_mode"] == "LIVE"


def test_live_websocket_reads_appended_complete_jsonl_lines(tmp_path: Path) -> None:
    run_id = "live-run"
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
