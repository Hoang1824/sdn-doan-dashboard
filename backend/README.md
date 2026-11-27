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

Live tailing is disabled unless `B8_ACTIVE_RUN_ID` is set to the explicitly
selected active run. Historical runs are read as `REPLAY`; manifest status
alone never turns a replay into live data. The reader only consumes
newline-terminated JSONL records. A partial trailing line is held for the next
poll. Set `B8_ACTIVE_RUN_ID` only while intentionally following that run. The
WebSocket requires the REST snapshot cursor to avoid an implicit replay/live
boundary.

## API

- `GET /api/health`
- `GET /api/runs`
- `GET /api/runs/{run_id}/snapshot?data_mode=REPLAY|LIVE`
- `GET /api/runs/{run_id}/events?after=<cursor>&limit=100&data_mode=REPLAY`
- `WS /ws/runs/{run_id}?after=<cursor>&data_mode=REPLAY|LIVE`

Call the snapshot endpoint first and pass its `as_of_cursor` to the WebSocket.
For LIVE mode, the run ID must equal `B8_ACTIVE_RUN_ID`. The WebSocket replays
records after the cursor before following appends. A stale/replaced-file cursor
requires a new snapshot.

## Tests

From `backend/` with this environment activated:

```bash
python -m pytest -q
```

The fixtures are minimal, explicitly synthetic contract fixtures based on
documented B8 event names/values. They are not copies of the full S1/S8 logs and
cannot certify the 5927-prediction S8 run.
