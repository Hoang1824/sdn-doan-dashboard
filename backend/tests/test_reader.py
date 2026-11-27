from __future__ import annotations

from pathlib import Path

import pytest

from b8_dashboard.normalize import normalize_record
from b8_dashboard.reader import (
    InvalidCursorError,
    InvalidJsonlError,
    JsonlRunReader,
    ResyncRequiredError,
)


def _normalize(**kwargs):
    return normalize_record(**kwargs)


def test_reader_waits_for_newline_before_consuming_record(tmp_path: Path) -> None:
    run_dir = tmp_path / "run-a"
    run_dir.mkdir()
    stream = run_dir / "ryu_events.jsonl"
    stream.write_bytes(b'{"event":"v2_prediction","id":"p1"}')
    reader = JsonlRunReader(tmp_path)
    cursor = reader.initial_cursor("run-a")

    page = reader.read_page("run-a", cursor, 10, _normalize, {}, "LIVE")
    assert page.events == []
    assert page.has_more is False
    assert page.next_cursor == cursor

    with stream.open("ab") as file:
        file.write(b"\n")
    page = reader.read_page("run-a", cursor, 10, _normalize, {}, "LIVE")
    assert [event["keys"]["sample_id"] for event in page.events] == ["p1"]
    assert page.has_more is False
    assert page.next_cursor != cursor


def test_reader_reports_malformed_complete_json_instead_of_skipping(tmp_path: Path) -> None:
    run_dir = tmp_path / "run-a"
    run_dir.mkdir()
    (run_dir / "ryu_events.jsonl").write_bytes(b"{not-json}\n")
    reader = JsonlRunReader(tmp_path)

    with pytest.raises(InvalidJsonlError, match="byte 0"):
        reader.read_page(
            "run-a",
            reader.initial_cursor("run-a"),
            10,
            _normalize,
            {},
            "REPLAY",
        )


def test_cursor_is_bound_to_run_and_detects_truncation(tmp_path: Path) -> None:
    run_dir = tmp_path / "run-a"
    run_dir.mkdir()
    stream = run_dir / "ryu_events.jsonl"
    stream.write_text('{"event":"v2_prediction","id":"p1"}\n', encoding="utf-8")
    reader = JsonlRunReader(tmp_path)
    page = reader.read_page(
        "run-a", reader.initial_cursor("run-a"), 10, _normalize, {}, "REPLAY"
    )

    (tmp_path / "run-b").mkdir()
    with pytest.raises(InvalidCursorError, match="run_id"):
        reader.read_page("run-b", page.next_cursor, 10, _normalize, {}, "REPLAY")

    stream.write_bytes(b"")
    with pytest.raises(ResyncRequiredError, match="truncated"):
        reader.read_page("run-a", page.next_cursor, 10, _normalize, {}, "REPLAY")


def test_normalized_event_preserves_b8_identity_and_omits_evaluation_fields() -> None:
    event = normalize_record(
        run_id="run-a",
        stream="ryu_events.jsonl",
        offset=12,
        identity="1:2",
        raw={
            "event": "v2_prediction",
            "run_id": "run-a",
            "id": "sample-1",
            "timestamp": 1795701942.7,
            "prediction": "benign",
            "mode": "MITIGATE",
            "model_sha256": "fixture-sha",
            "truth": "fixture-only",
            "label_valid": True,
            "auto_mitigation_allowed": False,
        },
        manifest={"controller_revision": "B8_ACK_IDLE_DROP_1"},
        data_mode="REPLAY",
        cursor="cursor",
    )

    assert event["run_id"] == "run-a"
    assert event["keys"]["sample_id"] == "sample-1"
    assert event["source_timestamp"] == 1795701942.7
    assert event["policy_mode"] is None
    assert event["run_revision"]["controller_revision"] == "B8_ACK_IDLE_DROP_1"
    assert event["payload"]["model_sha256"] == "fixture-sha"
    assert "truth" not in event["payload"]
    assert "label_valid" not in event["payload"]
    assert "auto_mitigation_allowed" not in event["payload"]


def test_source_event_run_id_mismatch_is_rejected() -> None:
    with pytest.raises(ValueError, match="does not match"):
        normalize_record(
            run_id="expected",
            stream="ryu_events.jsonl",
            offset=0,
            identity="1:2",
            raw={"event": "v2_prediction", "run_id": "other", "id": "p1"},
            manifest={},
            data_mode="REPLAY",
            cursor="cursor",
        )


def test_primary_ryu_record_still_requires_unambiguous_event_name() -> None:
    with pytest.raises(ValueError, match="unambiguous event name"):
        normalize_record(
            run_id="run-a",
            stream="ryu_events.jsonl",
            offset=0,
            identity="1:2",
            raw={"run_id": "run-a", "id": "p1"},
            manifest={},
            data_mode="REPLAY",
            cursor="cursor",
        )
