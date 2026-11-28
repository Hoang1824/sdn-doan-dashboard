# B8 Dashboard Read-Only Backend

This FastAPI service reads run files from `logs_v2/<run_id>/`. It does not call
the inference API, relay, Ryu, Mininet, or OVS, and it never writes to the
experiment logs. The event/API contract is in `../docs/API_CONTRACT.md`.

## Separate Python environment

Use Python 3.10 or later. Create a backend-only environment; do not activate
or install into the AI project's environment:

```bash
cd /home/mininet/doan-ddos-sdn
python3 -m venv backend/.venv
source backend/.venv/bin/activate
python -m pip install -r backend/requirements.txt
```

Set the log root explicitly and run from the backend directory:

```bash
export B8_LOG_ROOT=/home/mininet/doan-ddos-sdn/logs_v2
export B8_DASHBOARD_HOST=127.0.0.1
export B8_DASHBOARD_PORT=8003
cd /home/mininet/doan-ddos-sdn/backend
python -m uvicorn b8_dashboard.app:app --host "$B8_DASHBOARD_HOST" --port "$B8_DASHBOARD_PORT"
```

Port `8003` is a dedicated dashboard example, not a claim that it is free.
Check the VM's listener table before selecting a port. The safe default binds
to loopback and is not reachable directly from Windows. Do not bind to a VM
interface or `0.0.0.0` until the VMware path, firewall, authentication, and
allowed browser origins have been reviewed. A non-loopback bind requires
`B8_DASHBOARD_TOKEN` and the browser must use the `b8-token.<token>` WebSocket
subprotocol in addition to the `b8.dashboard.v1` protocol. Never put tokens in
URLs or commit them.

When `B8_ACTIVE_RUN_ID` is unset, `GET /api/runs` discovers LIVE candidates
without restarting FastAPI. A candidate must have a matching manifest `run_id`,
manifest `status="running"`, and a complete-line JSONL file updated within 30
seconds. Multiple candidates
are reported as ambiguous; the dashboard requires an explicit choice. Set
`B8_ACTIVE_RUN_ID` to pin one run manually; a stale or completed pin does not
fall back to another run. Historical runs remain `REPLAY`. The reader only
consumes newline-terminated JSONL records; a partial trailing line is held for
the next poll.

## API

- `GET /api/health`
- `GET /api/runs`
- `GET /api/runs/{run_id}/snapshot?data_mode=REPLAY|LIVE`
- `GET /api/runs/{run_id}/events?after=<cursor>&limit=100&data_mode=REPLAY`
- `WS /ws/runs/{run_id}?after=<cursor>&data_mode=REPLAY|LIVE`

The frontend refreshes the run catalog every five seconds. Call the snapshot
endpoint first and pass its `as_of_cursor` to the WebSocket. Without a manual
pin, LIVE is allowed for an explicitly selected, fresh running candidate; with
a pin, the run ID must match `B8_ACTIVE_RUN_ID`. The WebSocket replays records
after the cursor before following appends and reports log freshness separately
from socket connectivity. A terminal manifest produces `run_complete` after
complete lines are drained and `events.jsonl` confirms a phase-state record
with `traffic_mode="finished"` and a status matching the terminal manifest
(case-insensitively). The `phase` field is not used as the finalization marker.
The wait is capped at five seconds; an absent or mismatched marker produces
`finalization_status="timeout"` rather than a hung socket. The frontend then
loads a final REPLAY snapshot and warns on timeout. A stale/replaced-file
cursor requires a new snapshot. Neither JSONL freshness nor WebSocket
connectivity is a health check for AI or Ryu.

## Tests

From `backend/` with this environment activated:

```bash
python -m pytest -q
```

The fixtures are minimal, explicitly synthetic contract fixtures based on
documented B8 event names/values. They are not copies of the full S1/S8 logs and
cannot certify the 5927-prediction S8 run.
