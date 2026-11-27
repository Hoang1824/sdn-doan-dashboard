# B8 Dashboard API Contract

**Status:** Implemented for read-only replay and read-only LIVE run discovery/tailing.

**Source basis:** `docs/API_CONTRACT_B8_DASHBOARD_DRAFT.md` and `docs/B8_DASHBOARD_HANDOFF_20261127.md`.
**Scope:** Read `logs_v2/<run_id>/` only. This service does not call or control the model, Sensor, relay, Ryu, Mininet, or OVS.

The raw examples available to this workspace are the field/event observations and
the single-cookie values documented in the draft; the complete S1/S8 JSONL files
are not present here. The backend tests therefore use explicitly labeled minimal
fixtures. They test parsing, reducer and transport behavior, not the full-run S8
totals. The S8 values below remain external replay acceptance criteria.

## 1. Sources and precedence

| Source | Authority and use |
| --- | --- |
| `manifest.json` | Run metadata and revision/profile. Preserve the source values; `status` alone does not determine `data_mode`. |
| `ryu_events.jsonl` | Primary source for `v2_prediction`, policy decisions, mitigation request/confirmation, DROP counters, FlowRemoved and cleanup. |
| `timeline.jsonl` | Supplemental phase and Sensor/controller observations. Never add its prediction, rule or packet representations to the primary Ryu state. |
| `events.jsonl` | Supplemental experiment phase observations only. |
| `ovs_samples.jsonl` | Optional supplemental evidence. A missing or empty file is not evidence that no DROP rule exists. |
| `report.json`, `switch_final.json` | End-of-run reconciliation only; neither replaces the live JSONL sources. |

`http_h1.csv`–`http_h4.csv` are outside the initial API projection until their
headers and units are mapped. Do not derive Mbps/PPS from DROP counters.

Raw event names confirmed by the handoff/draft:

- Ryu primary: `v2_prediction`, `b8_live_policy_decision`,
  `b8_mitigation_requested`, `b8_mitigation_confirmed`, `b8_drop_counter`,
  `b8_mitigation_flow_removed`, `b8_mitigation_cleaned`.
- Timeline observations: `AI_BENIGN`, `AI_PHAT_HIEN`, `RYU_NHAN`,
  `RYU_DANH_GIA`, `RYU_YEU_CAU`, `OVS_DA_AP_LUAT`, `OVS_DA_LOAI_GOI`,
  `OVS_GO_LUAT`, `OVS_DON_LUAT`, `PHA_KICH_BAN`.

The raw event discriminator key is not included in the draft examples. The
reader accepts a string in one of `event`, `event_type`, `type`, or `name`;
unrecognized/missing event names are reported as source observations or parse
errors, never silently promoted to predictions or mitigation.

## 2. Normalized event envelope

REST event pages and WebSocket `event` frames use this shape:

```json
{
  "schema_version": "b8.dashboard.v1",
  "run_id": "20261126_060516_b8s8_mitigate_72aead",
  "event_id": "20261126_060516_b8s8_mitigate_72aead:ryu_events.jsonl:...",
  "cursor": "<opaque-resume-token>",
  "kind": "mitigation.counter",
  "raw_event": "b8_drop_counter",
  "source_stream": "ryu_events.jsonl",
  "source_timestamp": 1795701942.7707245,
  "backend_received_at": "2026-11-27T15:00:00.000000Z",
  "data_mode": "REPLAY",
  "policy_mode": "MITIGATE",
  "run_revision": {},
  "keys": {
    "sample_id": "v2_live_20261126_140516_862",
    "cookie": "0xb83524a71b55e4bc"
  },
  "payload": {
    "src_ip": "10.0.0.10",
    "dst_ip": "10.0.0.100",
    "ip_proto": 6,
    "dpid": 3,
    "mitigation_action": "DROP",
    "counter_source": "verified_flow_stats",
    "packet_count": 142
  }
}
```

`source_timestamp` preserves the source value and unit; the documented B8
prediction/counter timestamps are Unix seconds. `backend_received_at` is when
the reader parsed a complete line, not an AI, packet, or browser timestamp.
For replay it is the time of replay parsing, not the historical receipt time.
Do not calculate end-to-end latency from unlike or unsynchronized clocks.

`event_id` is stable for the same run, stream, file identity and byte offset.
`cursor` is opaque to clients and records completed-line offsets for each source
stream. Only complete newline-terminated JSONL records advance a cursor.

Normalized `kind` values:

| Ryu raw event | Normalized kind |
| --- | --- |
| `v2_prediction` | `ai.prediction` |
| `b8_live_policy_decision` | `policy.decision` |
| `b8_mitigation_requested` | `mitigation.requested` |
| `b8_mitigation_confirmed` | `mitigation.confirmed` |
| `b8_drop_counter` | `mitigation.counter` |
| `b8_mitigation_flow_removed` | `mitigation.removed` |
| `b8_mitigation_cleaned` | `mitigation.cleaned` |
| timeline records | `timeline.observation` |
| `events.jsonl` records | `run.phase` |
| unrecognized named records | `source.observation` |

The Ryu payload uses an allowlist of documented B8 fields. Evaluation-only
`truth` and `label_valid`, and `auto_mitigation_allowed`, are not exposed as
live ground truth or B8 policy. Unknown event names do not mutate prediction,
rule, or counter state.

## 3. Event identity and correlation

- Prediction identity: `(run_id, v2_prediction.id)`.
- Policy decision: `(run_id, sample_id)`; `sample_id` links to the prediction
  ID and does not create another prediction.
- Rule identity: `(run_id, dpid, cookie)`; `sample_id` is retained as a
  correlation field. Cookie is not an event ID: multiple counter samples for
  one cookie are distinct observations.
- Event delivery identity: `(run_id, source_stream, file_identity, byte_offset)`.
  Timeline observations remain observations; they do not increment primary
  prediction/rule/counter totals.
- If a source file is truncated/replaced after a cursor was issued, that cursor
  is invalidated and the client must resnapshot. The reader does not modify or
  rotate source files.

## 4. Mitigation lifecycle and verification

The reducer retains distinct states:

`REQUESTED -> CONFIRMED -> VERIFIED -> DROPPING -> REMOVED_IDLE -> CLEANED`

The stages are evidence-driven, not inferred from event names:

- `b8_mitigation_requested` creates/updates `REQUESTED`.
- `b8_mitigation_confirmed` creates/updates `CONFIRMED`; it is not by itself
  switch verification.
- `VERIFIED` requires a usable controller/switch evidence record. In this
  implementation the documented `b8_drop_counter` is accepted as switch-flow
  evidence only when it has `counter_source="verified_flow_stats"`, a cookie,
  DPID, valid nonnegative packet count, and source timestamp. The evidence
  reference is the stable source event ID. A timeline message alone cannot
  promote a rule to verified.
- A verified positive counter yields `DROPPING`. Counter values are
  cumulative; the snapshot exposes the latest value and a delta only against a
  compatible prior sample. A decreasing/reset value is preserved as the latest
  raw observation and has no computed delta.
- `b8_mitigation_flow_removed` sets a removed state. With OpenFlow 1.3,
  `reason=0` is exposed as `REMOVED_IDLE`, while the raw reason remains
  available. Its final packet/byte counters replace the prior cumulative
  sample rather than being added to it. `removed` does not mean the rule never
  blocked traffic.
- `b8_mitigation_cleaned` sets `CLEANED` only when that event is present.
  Cleaning changes the lifecycle status but does not delete the rule from the
  snapshot or discard its evidence and final counters.

For the documented cookie `0xb83524a71b55e4bc`, the expected replay sequence
includes a counter of 142 and final `FlowRemoved.packet_count=7300`. The final
count is 7300, not `142 + 7300`. Timeline `delta`/`total` presentations are
observations of this state, not additional packets.

## 5. Data mode versus policy mode

- `data_mode`: `LIVE` or `REPLAY`. `LIVE` is permitted for a fresh running
  candidate explicitly selected by the operator, or for the configured
  `B8_ACTIVE_RUN_ID` pin. A manifest status alone is insufficient. A live
  subscription follows appended records; the separate freshness state
  indicates whether new records are arriving.
- `policy_mode`: `ALERT_ONLY`, `MITIGATE`, or `null` if unknown. It is read only
  from explicit B8 policy metadata/event fields. Do not derive it from
  `DDOS_AI_MODE`, `auto_mitigation_allowed`, or UI defaults.
- Run revision fields are preserved from the manifest/event when present. The
  S1 sample listed in the draft uses an older scenario revision than S8 and
  must not be silently treated as the same revision.

## 6. REST API

All paths below are dashboard API routes; they do not exist on the inference,
relay, or Ryu services.

### `GET /api/health`

Returns dashboard process and configured log-root readability only. HTTP 200
does not assert that AI, Sensor, Ryu or OVS is healthy.

### `GET /api/runs`

Lists safe run directories and available manifest metadata. Invalid/missing
manifests are reported as unavailable metadata; they are not fabricated. Each
run may include `live`, containing manifest status, JSONL freshness, last
complete-line activity, and eligibility. The top-level `live_discovery` is:

```json
{
  "mode": "automatic",
  "status": "single",
  "selected_run_id": "run-id",
  "candidate_run_ids": ["run-id"],
  "freshness_seconds": 30
}
```

`status` is `none`, `single`, or `ambiguous` in automatic mode, and
`manual_active` or `manual_unavailable` when `B8_ACTIVE_RUN_ID` pins a run.
Automatic candidates must have manifest `status="running"` and at least one
newline-terminated JSONL stream updated within the 30-second freshness window.
The manifest `run_id` must match its validated directory name.
The backend reports multiple candidates without selecting one. A configured
manual pin never falls back to another run. Discovery rereads the log root for
each request; it does not require restarting FastAPI when a run is created.

### `GET /api/runs/{run_id}/snapshot?data_mode=REPLAY|LIVE`

Returns the reduced read-only state and a consistent per-stream
`as_of_cursor`. Snapshot fields include:

- run ID, manifest metadata, revision, `data_mode`, explicit `policy_mode`.
  `run.seed` uses `manifest.seed` when non-null, otherwise
  `manifest.seed_reference`;
- latest prediction and unique prediction count;
- latest policy decisions;
- mitigation rules keyed by DPID/cookie, lifecycle, evidence, latest
  cumulative packet/byte counts and valid deltas;
- `verified_source_count`, the number of distinct non-empty source IPs on
  rules whose **current** status is `VERIFIED` or `DROPPING`. This is not a
  cumulative count of sources ever verified; `REMOVED`, `REMOVED_IDLE`, and
  `CLEANED` rules are excluded even when their verification evidence remains;
- phase observations and last source/backend receive times;
- source availability. Unsupported traffic/performance values remain null.

`data_mode` defaults to `REPLAY`. `LIVE` returns conflict unless the requested
run is running and has fresh complete-line JSONL activity. When
`B8_ACTIVE_RUN_ID` is set, the requested run must also match that manual pin.
Without a pin, the API permits an explicitly selected eligible run; the UI
requires the operator to choose when discovery is ambiguous.
The response includes `live_monitor` (`status`, `terminal`, `freshness`,
`eligible`, `last_activity_at`, `last_activity_stream`, `age_seconds`, and
`freshness_seconds`). It describes manifest and log-file activity only; it is
not an AI, Sensor, Ryu, OVS, or traffic health check.

### `GET /api/runs/{run_id}/events?after=<cursor>&limit=100&data_mode=REPLAY`

Returns a bounded page:

```json
{
  "run_id": "…",
  "data_mode": "REPLAY",
  "events": [],
  "next_cursor": "…",
  "has_more": false
}
```

`limit` is bounded by the server. An invalid, foreign-run, stale, or
file-identity-mismatched cursor returns an explicit client error with
`resync_required`; it is never silently reset to the beginning.

## 7. WebSocket

`WS /ws/runs/{run_id}?after=<cursor>&data_mode=LIVE|REPLAY`

The client obtains `as_of_cursor` from REST first and connects with that
cursor. `after` is required; a connection without the snapshot cursor receives
`resync_required`. Frames:

```json
{"type":"event","event":{ "...": "normalized event envelope" }}
{"type":"heartbeat","cursor":"...","data_mode":"LIVE"}
{"type":"run_status","status":"running","terminal":false,"freshness":"fresh","eligible":true,"last_activity_at":"...","last_activity_stream":"ryu_events.jsonl","age_seconds":0.2,"freshness_seconds":30}
{"type":"run_complete","status":"completed","cursor":"...","last_activity_at":"...","finalization_status":"confirmed"}
{"type":"resync_required","reason":"cursor_invalid"}
{"type":"replay_complete","cursor":"..."}
```

The server replays all complete records after the cursor before following new
appends in LIVE mode. LIVE sends `run_status` when manifest status or log
freshness changes. On a terminal manifest, the server drains complete lines
across all JSONL streams and waits for a valid `run.phase` record from
`events.jsonl` with `traffic_mode="finished"` and a `status` matching the
terminal manifest status (case-insensitively). The `phase` field is not used
as the finalization marker. The server only reports
`finalization_status="confirmed"` after the matching finished record is
covered by the delivered cursor and no complete lines remain. If no matching
marker is available, it waits at most five seconds, then reports
`finalization_status="timeout"` after draining currently available complete
lines. This bounded fallback also covers aborted runs whose final phase record
is missing or does not match the manifest. The frontend fetches a final REPLAY
snapshot in either case; it warns when finalization timed out. A confirmed
final snapshot therefore includes the matching finished record and the final
reduced state. REPLAY ends with `replay_complete`. Reconnect uses the last
cursor successfully applied by the client. A gap/file replacement causes
resync rather than silent event loss. Slow clients receive bounded pages; the
backend does not hold file locks while sending network data.

The browser refreshes `GET /api/runs` every five seconds. This discovers newly
created runs without a backend restart. Automatic selection is not performed
when more than one candidate is present. WebSocket connectivity and heartbeat
are transport state only; they do not indicate AI or Ryu health.

## 8. Security and read-only guarantee

- The configured log root is fixed at startup; validate run IDs and resolved
  paths against traversal/symlink escape.
- Open source files read-only. No API performs file writes or invokes an
  inference, relay, Ryu, Mininet, or OVS command.
- Default bind is loopback. Do not bind a VM-facing interface until access
  control, allowed origins and firewall rules are configured and reviewed.
- Never expose ports 8002, 9012 or 6653 to the dashboard network. Do not put
  relay credentials or secrets in events, URLs, frontend bundles or Git.

## 9. Replay validation limits

The workspace fixture tests verify a minimal S1/S8-shaped stream, incremental
line handling, source precedence, idempotency, counter semantics, lifecycle,
cursor pagination and WebSocket replay/reconnect. They do **not** certify the
complete S8 run. The operator has separately reported a successful replay of
the real S1/S8 logs on Ubuntu Python 3.12. For S8 the reported results are:
5927 predictions, six DROP rules across three source IPs and two protocols,
all six rules `CLEANED` at the final snapshot, `verified_source_count=0`,
`run.seed=1101` from `manifest.seed_reference`, and final
`0xb83524a71b55e4bc.packet_count=7300` (not 7442). These are externally
reported results, not a replay performed by the workspace tests.
