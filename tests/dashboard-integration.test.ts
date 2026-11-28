import assert from 'node:assert/strict'
import test from 'node:test'
import {
  B8DashboardClient,
  parseSnapshot,
  type B8NormalizedEvent,
  type B8SnapshotResponse,
  type B8WebSocketLike,
} from '../frontend/src/data/b8-api.ts'
import { B8LiveFeed } from '../frontend/src/data/b8-live-feed.ts'
import { B8DashboardReducer, mapHistoryEvent, mapSnapshot } from '../frontend/src/data/b8-read-model.ts'

const browserAt = '2026-11-27T16:00:00.000Z'

function event(
  eventId: string,
  kind: string,
  payload: Record<string, unknown> = {},
  sampleId: string | null = null,
  cookie: string | null = null,
): B8NormalizedEvent {
  return {
    schema_version: 'b8.dashboard.v1',
    run_id: 'run-test',
    event_id: eventId,
    cursor: `cursor-${eventId}`,
    kind,
    raw_event: kind,
    source_stream: 'ryu_events.jsonl',
    source_timestamp: 1795701900,
    backend_received_at: '2026-11-27T15:59:59.000Z',
    data_mode: 'LIVE',
    policy_mode: 'MITIGATE',
    run_revision: { controller_revision: 'B8_ACK_IDLE_DROP_1' },
    keys: { sample_id: sampleId, cookie },
    payload,
  }
}

function wireSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    run_id: 'run-test',
    data_mode: 'REPLAY',
    policy_mode: 'MITIGATE',
    run: {
      scenario: 8,
      seed: 1101,
      status: 'completed',
      policy_mode: 'MITIGATE',
      revision: {
        profile: { model_candidate: 'manifest-candidate', training_profile: 'profile-detail' },
        controller_revision: 'B8_ACK_IDLE_DROP_1',
      },
    },
    as_of_cursor: 'snapshot-cursor',
    snapshot_received_at: '2026-11-27T15:59:58.000Z',
    state: {
      prediction_count: 5927,
      latest_prediction: {
        schema_version: 'b8.dashboard.v1',
        run_id: 'run-test',
        event_id: 'prediction-event',
        cursor: 'prediction-cursor',
        kind: 'ai.prediction',
        raw_event: 'v2_prediction',
        source_stream: 'ryu_events.jsonl',
        source_timestamp: 1795701900,
        backend_received_at: '2026-11-27T15:59:57.000Z',
        data_mode: 'REPLAY',
        policy_mode: null,
        run_revision: { model_revision: 'B7.3.5_TRIAL_3' },
        keys: { sample_id: 'sample-1', cookie: null },
        payload: { id: 'sample-1', prediction: 'syn_flood', confidence: 0.97, src_ip: '10.0.0.10' },
      },
      latest_policies: [],
      rules: [],
      verified_source_count: 0,
      observations: [],
    },
    ...overrides,
  }
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

class FakeSocket implements B8WebSocketLike {
  readyState = 0
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null

  open(): void {
    this.readyState = 1
    this.onopen?.(new Event('open'))
  }

  sendFrame(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent)
  }

  disconnect(): void {
    this.readyState = 3
    this.onclose?.(new Event('close') as CloseEvent)
  }

  close(): void {
    this.disconnect()
  }
}

test('REST client parses the run catalog and maps manifest seed_reference', async () => {
  const requests: string[] = []
  const client = new B8DashboardClient({
    apiBaseUrl: 'http://127.0.0.1:8003',
    fetcher: async (input) => {
      requests.push(String(input))
      return response({
        runs: [{
          run_id: 'run-test',
          manifest: {
            scenario: 8,
            seed_reference: 1101,
            mode: 'MITIGATE',
            status: 'completed',
            controller_revision: 'B8_ACK_IDLE_DROP_1',
          },
          live: {
            status: 'running',
            terminal: false,
            freshness: 'fresh',
            eligible: true,
            last_activity_at: '2026-11-27T15:59:59Z',
            last_activity_stream: 'ryu_events.jsonl',
            age_seconds: 1,
            freshness_seconds: 30,
          },
        }],
        live_discovery: {
          mode: 'automatic',
          status: 'single',
          selected_run_id: 'run-test',
          candidate_run_ids: ['run-test'],
          freshness_seconds: 30,
        },
      })
    },
  })

  const catalog = await client.listRunCatalog()

  assert.deepEqual(requests, ['http://127.0.0.1:8003/api/runs'])
  assert.equal(catalog.runs[0].runId, 'run-test')
  assert.equal(catalog.runs[0].scenario, 'S8')
  assert.equal(catalog.runs[0].seed, 1101)
  assert.equal(catalog.runs[0].policyMode, 'MITIGATE')
  assert.equal(catalog.runs[0].status, 'completed')
  assert.equal(catalog.runs[0].live?.eligible, true)
  assert.equal(catalog.liveDiscovery?.status, 'single')
  assert.deepEqual(catalog.liveDiscovery?.candidateRunIds, ['run-test'])
})

test('REPLAY event pages use the existing cursor endpoint from the initial cursor', async () => {
  const requests: string[] = []
  const historyEvent = {
    ...event('page-event', 'ai.prediction', { prediction: 'syn_flood', src_ip: '10.0.0.10' }),
    data_mode: 'REPLAY' as const,
  }
  const client = new B8DashboardClient({
    apiBaseUrl: 'http://127.0.0.1:8003',
    fetcher: async (input) => {
      requests.push(String(input))
      const after = new URL(String(input)).searchParams.get('after')
      return response({
        run_id: 'run-test',
        data_mode: 'REPLAY',
        events: after ? [] : [historyEvent],
        next_cursor: after ? 'end-cursor' : 'page-2-cursor',
        has_more: after === null,
      })
    },
  })

  const first = await client.getEvents('run-test', null, 100)
  const next = await client.getEvents('run-test', first.next_cursor, 100)

  assert.equal(first.events[0].event_id, 'page-event')
  assert.equal(first.has_more, true)
  assert.equal(next.events.length, 0)
  assert.equal(next.has_more, false)
  assert.equal(new URL(requests[0]).pathname, '/api/runs/run-test/events')
  assert.equal(new URL(requests[0]).searchParams.get('after'), null)
  assert.equal(new URL(requests[0]).searchParams.get('limit'), '100')
  assert.equal(new URL(requests[1]).searchParams.get('after'), 'page-2-cursor')
  assert.equal(new URL(requests[1]).searchParams.get('data_mode'), 'REPLAY')
})

test('S8 history categories match normalized kinds, raw events, and prediction labels', () => {
  const category = (
    kind: string,
    rawEvent: string,
    payload: Record<string, unknown> = {},
  ) => mapHistoryEvent({
    ...event(`category-${kind}-${rawEvent}`, kind, payload),
    raw_event: rawEvent,
  }, browserAt).timelineCategory

  assert.equal(category('ai.prediction', 'v2_prediction', { prediction: 'syn_flood' }), 'ai_attack')
  assert.equal(category('ai.prediction', 'v2_prediction', { label: 'udp_flood' }), 'ai_attack')
  assert.equal(category('other', 'AI_PHAT_HIEN'), 'ai_attack')
  assert.equal(category('ai.prediction', 'v2_prediction', { prediction: 'benign' }), 'other')
  assert.equal(category('ai.prediction', 'AI_PHAT_HIEN', { prediction: 'benign' }), 'other')

  assert.equal(category('policy.decision', 'policy.decision'), 'ryu_policy')
  assert.equal(category('other', 'RYU_DANH_GIA'), 'ryu_policy')
  assert.equal(category('other', 'b8_live_policy_decision'), 'ryu_policy')

  assert.equal(category('mitigation.requested', 'mitigation.requested'), 'drop_control')
  assert.equal(category('mitigation.confirmed', 'mitigation.confirmed'), 'drop_control')
  assert.equal(category('other', 'RYU_YEU_CAU'), 'drop_control')
  assert.equal(category('other', 'OVS_DA_AP_LUAT'), 'drop_control')
  assert.equal(category('other', 'b8_mitigation_requested'), 'drop_control')
  assert.equal(category('other', 'b8_mitigation_confirmed'), 'drop_control')

  const verifiedCounter = {
    mitigation_action: 'DROP',
    counter_source: 'verified_flow_stats',
    packet_count: 21,
    cookie: '0x1234',
    dpid: 3,
  }
  assert.equal(category('mitigation.counter', 'b8_drop_counter', verifiedCounter), 'verified_counter')
  assert.equal(category('other', 'OVS_DA_LOAI_GOI', verifiedCounter), 'verified_counter')
  assert.equal(category('other', 'b8_drop_counter', verifiedCounter), 'verified_counter')
  assert.equal(category('mitigation.counter', 'b8_drop_counter', {
    ...verifiedCounter,
    counter_source: 'unverified',
  }), 'other')
  assert.equal(category('mitigation.counter', 'b8_drop_counter', {
    ...verifiedCounter,
    mitigation_action: 'ALLOW',
  }), 'other')
  assert.equal(category('other', 'b8_drop_counter'), 'other')

  assert.equal(category('mitigation.removed', 'mitigation.removed'), 'removed_cleaned')
  assert.equal(category('mitigation.cleaned', 'mitigation.cleaned'), 'removed_cleaned')
  assert.equal(category('other', 'OVS_GO_LUAT'), 'removed_cleaned')
  assert.equal(category('other', 'OVS_DON_LUAT'), 'removed_cleaned')
  assert.equal(category('other', 'b8_mitigation_flow_removed'), 'removed_cleaned')
  assert.equal(category('other', 'b8_mitigation_cleaned'), 'removed_cleaned')
})

test('snapshot maps B8 metadata and leaves unavailable traffic/latency metrics null', () => {
  const wire = parseSnapshot(wireSnapshot())
  const snapshot = mapSnapshot(wire, browserAt)

  assert.deepEqual(snapshot.run, {
    runId: 'run-test',
    scenario: 'S8',
    seed: 1101,
    status: 'completed',
    policyMode: 'MITIGATE',
    revision: {
      profile: { model_candidate: 'manifest-candidate', training_profile: 'profile-detail' },
      controller_revision: 'B8_ACK_IDLE_DROP_1',
    },
  })
  assert.equal(snapshot.dataMode, 'REPLAY')
  assert.equal(snapshot.detection?.sampleId, 'sample-1')
  assert.equal(snapshot.detection?.label, 'syn_flood')
  assert.equal(snapshot.detection?.confidence, 0.97)
  assert.equal(snapshot.detection?.modelName, 'B7.3.5_TRIAL_3')
  assert.equal(snapshot.predictionCount, 5927)
  assert.equal(snapshot.detection?.times.backendReceivedAt, '2026-11-27T15:59:57.000Z')
  assert.equal(snapshot.detection?.times.browserReceivedAt, browserAt)
  assert.equal(snapshot.receivedAt, browserAt)
  assert.equal(snapshot.backendSnapshotReceivedAt, '2026-11-27T15:59:58.000Z')
  assert.equal(snapshot.network.throughputMbps, null)
  assert.equal(snapshot.network.packetsPerSecond, null)
  assert.equal(snapshot.network.activeAlerts, null)
  assert.deepEqual(snapshot.network.traffic, [])
  assert.deepEqual(snapshot.performance, {
    detectionMs: null,
    mitigationMs: null,
    mitigationSampleCount: null,
    roundTripMs: null,
  })
})

test('snapshot maps complete class aggregates, alert history and per-cookie counter samples', () => {
  const baseState = wireSnapshot().state as Record<string, unknown>
  const attack = event(
    'attack-history-1',
    'ai.prediction',
    { id: 'sample-attack', prediction: 'syn_flood', src_ip: '10.0.0.10' },
    'sample-attack',
  )
  const confirmation = event(
    'mitigation-confirmed-1',
    'mitigation.confirmed',
    { src_ip: '10.0.0.10', dpid: 3, mitigation_action: 'DROP' },
    'sample-attack',
    '0xb8',
  )
  const drop = event(
    'drop-observed-1',
    'mitigation.counter',
    {
      src_ip: '10.0.0.10',
      dpid: 3,
      mitigation_action: 'DROP',
      counter_source: 'verified_flow_stats',
      packet_count: 142,
    },
    'sample-attack',
    '0xb8',
  )
  const wire = parseSnapshot(wireSnapshot({
    state: {
      ...baseState,
      prediction_class_counts: { benign: 5920, syn_flood: 5, udp_flood: 2 },
      alert_event_count: 3,
      alert_events: [attack, confirmation, drop],
      recent_events: [
        event(
          'history-policy-1',
          'policy.decision',
          { src_ip: '10.0.0.10', decision: 'mitigate' },
          'sample-attack',
        ),
      ],
      drop_counter_sample_count: 1,
      drop_counter_history: [{
        event_id: 'drop-observed-1',
        timestamp: 1795701900,
        cookie: '0xb8',
        dpid: 3,
        src_ip: '10.0.0.10',
        sample_id: 'sample-attack',
        packet_count: 142,
        delta: null,
        counter_reset: false,
      }],
      mitigation_observation_ms: 25,
      mitigation_observation_count: 1,
    },
  }))
  const snapshot = mapSnapshot(wire, browserAt)

  assert.deepEqual(snapshot.predictionClassCounts, {
    benign: 5920,
    syn_flood: 5,
    udp_flood: 2,
  })
  assert.equal(snapshot.alertEventCount, 3)
  assert.equal(snapshot.alertHistoryComplete, true)
  assert.deepEqual(snapshot.alerts.map((item) => item.category), [
    'attack_prediction',
    'mitigation_confirmed',
    'drop_observed',
  ])
  assert.ok(snapshot.alerts.every((item) => item.scope === 'historical'))
  assert.equal(snapshot.alerts[0].sourceIp, '10.0.0.10')
  assert.equal(snapshot.alerts[2].sampleId, 'sample-attack')
  assert.equal(snapshot.alerts[2].cookie, '0xb8')
  assert.equal(snapshot.history[0].sourceIp, '10.0.0.10')
  assert.deepEqual(snapshot.network.dropCounterHistory, [{
    id: 'drop-observed-1',
    timestamp: new Date(1795701900 * 1000).toISOString(),
    cookie: '0xb8',
    dpid: 3,
    sourceIp: '10.0.0.10',
    sampleId: 'sample-attack',
    packetCount: 142,
    delta: null,
    counterReset: false,
  }])
  assert.equal(snapshot.network.dropCounterSampleCount, 1)
  assert.equal(snapshot.network.dropCounterHistoryComplete, true)
  assert.equal(snapshot.performance.mitigationMs, 25)
  assert.equal(snapshot.performance.mitigationSampleCount, 1)
  assert.equal(snapshot.network.throughputMbps, null)
  assert.equal(snapshot.network.packetsPerSecond, null)
  assert.equal(snapshot.performance.detectionMs, null)
  assert.equal(snapshot.performance.roundTripMs, null)
})

test('LIVE reducer updates class counts and per-cookie counters once and marks new alerts LIVE', () => {
  const baseState = wireSnapshot().state as Record<string, unknown>
  const wire = parseSnapshot(wireSnapshot({
    data_mode: 'LIVE',
    run: {
      ...(wireSnapshot().run as Record<string, unknown>),
      status: 'running',
    },
    state: {
      ...baseState,
      prediction_class_counts: { benign: 10, syn_flood: 2, udp_flood: 1 },
      alert_event_count: 0,
      alert_events: [],
      recent_events: [],
      drop_counter_sample_count: 0,
      drop_counter_history: [],
      mitigation_observation_ms: null,
      mitigation_observation_count: 0,
    },
  }))
  const reducer = new B8DashboardReducer(mapSnapshot(wire, browserAt))
  const prediction = event(
    'live-syn-prediction',
    'ai.prediction',
    { id: 'live-syn-sample', prediction: 'syn_flood', src_ip: '10.0.0.10' },
    'live-syn-sample',
  )

  reducer.apply(prediction, browserAt)
  reducer.apply({ ...prediction, event_id: 'same-sample-new-event-id' }, browserAt)
  assert.equal(reducer.currentSnapshot().predictionCount, 5928)
  assert.deepEqual(reducer.currentSnapshot().predictionClassCounts, {
    benign: 10,
    syn_flood: 3,
    udp_flood: 1,
  })

  const common = {
    src_ip: '10.0.0.10',
    dst_ip: '10.0.0.100',
    ip_proto: 6,
    dpid: 3,
    mitigation_action: 'DROP',
  }
  reducer.apply({
    ...event('live-request', 'mitigation.requested', common, 'live-syn-sample', '0xb8'),
    source_timestamp: 1795701900,
  }, browserAt)
  reducer.apply({
    ...event('live-counter-142', 'mitigation.counter', {
      ...common,
      packet_count: 142,
      counter_source: 'verified_flow_stats',
    }, 'live-syn-sample', '0xb8'),
    source_timestamp: 1795701900.1,
  }, browserAt)
  reducer.apply({
    ...event('live-counter-200', 'mitigation.counter', {
      ...common,
      packet_count: 200,
      counter_source: 'verified_flow_stats',
    }, 'live-syn-sample', '0xb8'),
    source_timestamp: 1795701900.2,
  }, browserAt)

  const current = reducer.currentSnapshot()
  assert.deepEqual(current.network.dropCounterHistory.map((point) => point.packetCount), [142, 200])
  assert.deepEqual(current.network.dropCounterHistory.map((point) => point.delta), [null, 58])
  assert.equal(current.network.dropCounterSampleCount, 2)
  assert.equal(current.alertEventCount, 3)
  assert.ok(current.alerts.every((item) => item.scope === 'live'))
  assert.equal(current.alerts.filter((item) => item.category === 'drop_observed').length, 1)
  assert.equal(current.alerts.find((item) => item.category === 'drop_observed')?.cookie, '0xb8')
})

test('idempotent reducer joins policy by sample_id and keeps cumulative counters as latest values', () => {
  const base = mapSnapshot(parseSnapshot(wireSnapshot()), browserAt)
  const reducer = new B8DashboardReducer(base)
  const prediction = event(
    'prediction-1',
    'ai.prediction',
    { id: 'sample-shared', prediction: 'udp_flood', confidence: 0.91, src_ip: '10.0.0.11' },
    'sample-shared',
  )
  const policy = event(
    'policy-1',
    'policy.decision',
    { decision: 'mitigate', prediction: 'udp_flood' },
    'sample-shared',
  )

  assert.ok(reducer.apply(prediction, browserAt))
  assert.ok(reducer.apply(policy, browserAt))
  assert.equal(reducer.apply(policy, browserAt), null)
  const afterPolicy = reducer.currentSnapshot()
  assert.equal(afterPolicy.detection?.sampleId, 'sample-shared')
  assert.equal(afterPolicy.policies.length, 1)
  assert.equal(afterPolicy.policies[0].sampleId, afterPolicy.detection?.sampleId)

  const common = {
    dpid: 3,
    src_ip: '10.0.0.10',
    dst_ip: '10.0.0.100',
    ip_proto: 6,
    mitigation_action: 'DROP',
  }
  reducer.apply(event('confirmed', 'mitigation.confirmed', common, 'sample-shared', '0xb8'), browserAt)
  assert.equal(reducer.currentSnapshot().mitigations[0].status, 'confirmed')
  reducer.apply(event('counter-142', 'mitigation.counter', {
    ...common,
    counter_source: 'verified_flow_stats',
    packet_count: 142,
    byte_count: 10000,
  }, 'sample-shared', '0xb8'), browserAt)
  reducer.apply(event('counter-7300', 'mitigation.counter', {
    ...common,
    counter_source: 'verified_flow_stats',
    packet_count: 7300,
    byte_count: 394200,
  }, 'sample-shared', '0xb8'), browserAt)
  const dropping = reducer.currentSnapshot().mitigations[0]
  assert.equal(dropping.status, 'dropping')
  assert.equal(dropping.packetCount, 7300)
  assert.equal(dropping.counterDelta, 7158)
  assert.equal(reducer.currentSnapshot().network.verifiedSources, 1)

  reducer.apply(event('removed', 'mitigation.removed', {
    ...common,
    reason: 0,
    packet_count: 7300,
    byte_count: 394200,
  }, 'sample-shared', '0xb8'), browserAt)
  reducer.apply(event('cleaned', 'mitigation.cleaned', common, 'sample-shared', '0xb8'), browserAt)
  const cleaned = reducer.currentSnapshot()
  assert.equal(cleaned.mitigations.length, 1)
  assert.equal(cleaned.mitigations[0].status, 'cleaned')
  assert.equal(cleaned.mitigations[0].packetCount, 7300)
  assert.equal(cleaned.mitigations[0].evidence?.reference, 'counter-7300')
  assert.equal(cleaned.network.verifiedSources, 0)
})

test('LIVE feed deduplicates event IDs and reconnects from the last applied cursor', () => {
  const urls: string[] = []
  const sockets: FakeSocket[] = []
  const scheduled: Array<() => void> = []
  const statuses: string[] = []
  const applied: string[] = []
  const client = new B8DashboardClient({
    websocketBaseUrl: 'ws://127.0.0.1:8003',
    websocketFactory: (url) => {
      urls.push(url)
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
  })
  const feed = new B8LiveFeed(client, 'run-test', 'snapshot-cursor', {
    onEvent: (item) => {
      applied.push(item.event_id)
      return true
    },
    onSnapshot: () => assert.fail('Unexpected resync snapshot.'),
    onStatus: (status) => statuses.push(status),
  }, {
    schedule: (callback) => {
      scheduled.push(callback)
      return scheduled.length as ReturnType<typeof setTimeout>
    },
    cancel: () => undefined,
  })

  feed.start()
  sockets[0].open()
  const first = event('event-1', 'ai.prediction', { id: 'sample-1', prediction: 'benign' })
  sockets[0].sendFrame({ type: 'event', event: first })
  sockets[0].sendFrame({ type: 'event', event: first })
  assert.deepEqual(applied, ['event-1'])
  sockets[0].disconnect()
  assert.equal(scheduled.length, 1)
  scheduled[0]()

  const secondSocketUrl = new URL(urls[1])
  assert.equal(secondSocketUrl.searchParams.get('after'), 'cursor-event-1')
  assert.equal(secondSocketUrl.searchParams.get('data_mode'), 'LIVE')
  sockets[1].open()
  sockets[1].sendFrame({
    type: 'event',
    event: event('event-1', 'ai.prediction', { id: 'sample-1', prediction: 'benign' }),
  })
  sockets[1].sendFrame({
    type: 'event',
    event: event('event-2', 'ai.prediction', { id: 'sample-2', prediction: 'syn_flood' }),
  })
  assert.deepEqual(applied, ['event-1', 'event-2'])
  assert.ok(statuses.includes('disconnected'))
  assert.ok(statuses.includes('connected'))
  feed.stop()
})

test('LIVE resync obtains a new snapshot cursor before reopening the socket', async () => {
  const sockets: FakeSocket[] = []
  const urls: string[] = []
  const receivedSnapshots: string[] = []
  const client = new B8DashboardClient({
    apiBaseUrl: 'http://127.0.0.1:8003',
    websocketBaseUrl: 'ws://127.0.0.1:8003',
    fetcher: async () => response(wireSnapshot({
      data_mode: 'LIVE',
      as_of_cursor: 'resynced-cursor',
    })),
    websocketFactory: (url) => {
      urls.push(url)
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
  })
  const feed = new B8LiveFeed(client, 'run-test', 'stale-cursor', {
    onEvent: () => true,
    onSnapshot: (snapshot) => receivedSnapshots.push(snapshot.as_of_cursor),
    onStatus: () => undefined,
  })

  feed.start()
  sockets[0].open()
  sockets[0].sendFrame({ type: 'resync_required', reason: 'file-replaced' })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(receivedSnapshots, ['resynced-cursor'])
  assert.equal(new URL(urls[1]).searchParams.get('after'), 'resynced-cursor')
  feed.stop()
})

test('LIVE resync rejects a snapshot for a different run', async () => {
  const sockets: FakeSocket[] = []
  const scheduled: Array<() => void> = []
  const statuses: string[] = []
  const client = new B8DashboardClient({
    apiBaseUrl: 'http://127.0.0.1:8003',
    fetcher: async () => response(wireSnapshot({
      run_id: 'other-run',
      data_mode: 'LIVE',
    })),
    websocketFactory: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
  })
  const feed = new B8LiveFeed(client, 'run-test', 'initial-cursor', {
    onEvent: () => true,
    onSnapshot: () => assert.fail('Mismatched snapshot must not be applied.'),
    onStatus: (status) => statuses.push(status),
  }, {
    schedule: (callback) => {
      scheduled.push(callback)
      return scheduled.length as ReturnType<typeof setTimeout>
    },
    cancel: () => undefined,
  })

  feed.start()
  sockets[0].open()
  sockets[0].sendFrame({ type: 'resync_required', reason: 'cursor-invalid' })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.ok(statuses.includes('error'))
  assert.equal(sockets.length, 1)
  assert.equal(scheduled.length, 1)
  feed.stop()
})

test('LIVE run status is separate from WebSocket status and completion stops reconnects', () => {
  const sockets: FakeSocket[] = []
  const scheduled: Array<() => void> = []
  const runStatuses: string[] = []
  const completions: string[] = []
  const client = new B8DashboardClient({
    websocketBaseUrl: 'ws://127.0.0.1:8003',
    websocketFactory: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
  })
  const feed = new B8LiveFeed(client, 'run-test', 'snapshot-cursor', {
    onEvent: () => true,
    onSnapshot: () => undefined,
    onStatus: () => undefined,
    onRunStatus: (status) => runStatuses.push(`${status.status}:${status.freshness}`),
    onRunComplete: (status, finalization) => completions.push(`${status}:${finalization}`),
  }, {
    schedule: (callback) => {
      scheduled.push(callback)
      return scheduled.length as ReturnType<typeof setTimeout>
    },
    cancel: () => undefined,
  })

  feed.start()
  sockets[0].open()
  sockets[0].sendFrame({
    type: 'run_status',
    status: 'running',
    terminal: false,
    freshness: 'stale',
    eligible: false,
    last_activity_at: '2026-11-27T15:00:00Z',
    last_activity_stream: 'ryu_events.jsonl',
    age_seconds: 31,
    freshness_seconds: 30,
  })
  assert.deepEqual(runStatuses, ['running:stale'])

  sockets[0].sendFrame({
    type: 'run_complete',
    status: 'completed',
    cursor: 'final-cursor',
    finalization_status: 'confirmed',
    last_activity_at: '2026-11-27T15:00:01Z',
  })
  sockets[0].disconnect()

  assert.deepEqual(completions, ['completed:confirmed'])
  assert.equal(scheduled.length, 0)
  feed.stop()
})

test('LIVE completion propagates an unconfirmed finalization timeout', () => {
  const sockets: FakeSocket[] = []
  const finalizations: string[] = []
  const client = new B8DashboardClient({
    websocketBaseUrl: 'ws://127.0.0.1:8003',
    websocketFactory: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
  })
  const feed = new B8LiveFeed(client, 'run-test', 'snapshot-cursor', {
    onEvent: () => true,
    onSnapshot: () => undefined,
    onStatus: () => undefined,
    onRunComplete: (status, finalization) => finalizations.push(`${status}:${finalization}`),
  })

  feed.start()
  sockets[0].open()
  sockets[0].sendFrame({
    type: 'run_complete',
    status: 'aborted',
    cursor: 'terminal-cursor',
    finalization_status: 'timeout',
    last_activity_at: null,
  })

  assert.deepEqual(finalizations, ['aborted:timeout'])
  feed.stop()
})

