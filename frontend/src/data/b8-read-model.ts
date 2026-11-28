import type {
  AlertEvent,
  DashboardSnapshot,
  Detection,
  DropCounterPoint,
  EventTimes,
  HistoryEvent,
  MitigationEvidence,
  MitigationRule,
  MitigationStatus,
  PredictionClassCounts,
  PolicyDecision,
  RunMetadata,
} from '../types/dashboard'
import { scenarioLabel } from './b8-api.ts'
import type {
  B8DropCounterProjection,
  B8NormalizedEvent,
  B8RuleProjection,
  B8SnapshotResponse,
} from './b8-api.ts'
import { getMitigationStatus } from './presentation.ts'
import { createInitialSnapshot } from './initial-state.ts'

export const MAX_HISTORY_EVENTS = 500
export const MAX_ALERT_EVENTS = 100
export const MAX_POLICY_DECISIONS = 100
export const MAX_MITIGATION_RULES = 500
export const MAX_DROP_COUNTER_POINTS = 500
const MAX_SEEN_EVENT_IDS = 50_000

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function sourceTimestamp(value: number | string | null): string | null {
  if (typeof value === 'number') {
    const date = new Date(value * 1000)
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
  }
  if (typeof value === 'string') {
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
  }
  return null
}

function makeTimes(
  source: number | string | null,
  backend: string | null,
  browser: string,
): EventTimes {
  return {
    sourceTimestamp: sourceTimestamp(source),
    backendReceivedAt: backend,
    browserReceivedAt: browser,
  }
}

function textFromRevision(value: unknown): string | null {
  const visited = new Set<object>()
  const find = (candidateValue: unknown): string | null => {
    if (typeof candidateValue === 'string') {
      return candidateValue.trim() && !/^[{[]/.test(candidateValue.trim()) ? candidateValue.trim() : null
    }
    if (
      !candidateValue ||
      typeof candidateValue !== 'object' ||
      Array.isArray(candidateValue) ||
      visited.has(candidateValue)
    ) return null
    visited.add(candidateValue)
    const record = candidateValue as Readonly<Record<string, unknown>>
    const entries = Object.entries(record)
    const preferredKeys = ['model_revision', 'model_candidate', 'candidate', 'model_name', 'model_version', 'model']
    for (const key of preferredKeys) {
      const entry = entries.find(([name]) => name.toLowerCase() === key)
      if (entry && typeof entry[1] === 'string' && entry[1].trim()) return entry[1].trim()
    }
    for (const [key, nested] of entries) {
      if (key.toLowerCase().endsWith('_sha256')) continue
      if (/model|candidate|profile/i.test(key)) {
        const found = find(nested)
        if (found) return found
      }
    }
    return null
  }
  return find(value)
}

export function modelCandidateFromRevision(value: unknown): string | null {
  return textFromRevision(value)
}

function eventText(event: B8NormalizedEvent, field: string): string | null {
  return stringValue(event.payload[field])
}

function mapDetection(
  event: B8NormalizedEvent,
  browserAt: string,
  runRevision?: Readonly<Record<string, unknown>>,
): Detection {
  const confidence = numberValue(event.payload.confidence)
  return {
    id: event.event_id,
    timestamp: sourceTimestamp(event.source_timestamp) ?? '',
    sampleId: event.keys.sample_id ?? eventText(event, 'id'),
    label: eventText(event, 'prediction') ?? 'Unknown',
    confidence: confidence !== null && confidence >= 0 && confidence <= 1 ? confidence : null,
    modelName: textFromRevision(event.run_revision)
      ?? textFromRevision(event.payload)
      ?? textFromRevision(runRevision),
    times: makeTimes(event.source_timestamp, event.backend_received_at, browserAt),
  }
}

function mapAlert(
  event: B8NormalizedEvent,
  browserAt: string,
  scope: AlertEvent['scope'],
): AlertEvent | null {
  const label = eventText(event, 'prediction')
  const action = eventText(event, 'mitigation_action')
  const packetCount = numberValue(event.payload.packet_count)
  const cookie = event.keys.cookie ?? eventText(event, 'cookie')
  const dpidValue = event.payload.dpid
  const dpid = typeof dpidValue === 'number' || typeof dpidValue === 'string'
    ? dpidValue
    : null
  let category: AlertEvent['category']
  let description: string

  if (event.kind === 'ai.prediction' && (label === 'syn_flood' || label === 'udp_flood')) {
    category = 'attack_prediction'
    description = `AI prediction: ${label}`
  } else if (event.kind === 'mitigation.requested' && action === 'DROP') {
    category = 'mitigation_requested'
    description = 'Controller requested DROP mitigation'
  } else if (event.kind === 'mitigation.confirmed') {
    category = 'mitigation_confirmed'
    description = 'Controller confirmed mitigation; this is not switch verification'
  } else if (
    event.kind === 'mitigation.counter'
    && action === 'DROP'
    && event.payload.counter_source === 'verified_flow_stats'
    && typeof event.source_timestamp === 'number'
    && Number.isFinite(event.source_timestamp)
    && packetCount !== null
    && Number.isSafeInteger(packetCount)
    && packetCount > 0
    && cookie
    && typeof dpid === 'number'
    && Number.isInteger(dpid)
    && dpid >= 0
  ) {
    category = 'drop_observed'
    description = `DROP counter observed: ${packetCount.toLocaleString('en-US')} packets`
  } else if (
    event.kind === 'mitigation.removed'
    && action === 'DROP'
    && typeof event.source_timestamp === 'number'
    && Number.isFinite(event.source_timestamp)
    && packetCount !== null
    && Number.isSafeInteger(packetCount)
    && packetCount > 0
    && cookie
    && dpid !== null
  ) {
    category = 'drop_observed'
    description = `FlowRemoved final count: ${packetCount.toLocaleString('en-US')} packets`
  } else {
    return null
  }

  return {
    id: event.event_id,
    timestamp: sourceTimestamp(event.source_timestamp) ?? '',
    sourceIp: eventText(event, 'src_ip'),
    description,
    severity: null,
    category,
    scope,
    sampleId: event.keys.sample_id ?? eventText(event, 'sample_id'),
    cookie,
    dpid,
    packetCount,
    times: makeTimes(event.source_timestamp, event.backend_received_at, browserAt),
  }
}

function mapPolicy(event: B8NormalizedEvent, browserAt: string): PolicyDecision | null {
  const sampleId = event.keys.sample_id ?? eventText(event, 'sample_id')
  if (!sampleId) return null
  return {
    id: event.event_id,
    sampleId,
    decision: eventText(event, 'decision'),
    prediction: eventText(event, 'prediction'),
    mode: event.policy_mode,
    timestamp: sourceTimestamp(event.source_timestamp) ?? '',
    times: makeTimes(event.source_timestamp, event.backend_received_at, browserAt),
  }
}

function historyKind(kind: string): HistoryEvent['kind'] {
  if (kind === 'ai.prediction') return 'detection'
  if (kind.startsWith('mitigation.')) return 'mitigation'
  return 'system'
}

function historyCategory(event: B8NormalizedEvent): HistoryEvent['timelineCategory'] {
  const kind = event.kind.trim().toLowerCase()
  const rawEvent = event.raw_event.trim().toLowerCase()
  const predictionLabels = [eventText(event, 'prediction'), eventText(event, 'label')]
    .map((value) => value?.trim().toLowerCase())
  const action = eventText(event, 'mitigation_action')?.trim().toUpperCase()
  const counterSource = eventText(event, 'counter_source')?.trim().toLowerCase()
  const packetCount = numberValue(event.payload.packet_count)
  const cookie = event.keys.cookie ?? eventText(event, 'cookie')
  const dpid = event.payload.dpid
  const hasVerifiedDropCounter = action === 'DROP'
    && counterSource === 'verified_flow_stats'
    && packetCount !== null
    && Number.isSafeInteger(packetCount)
    && packetCount >= 0
    && cookie !== null
    && cookie.trim() !== ''
    && (
      (typeof dpid === 'number' && Number.isSafeInteger(dpid) && dpid >= 0)
      || (typeof dpid === 'string' && dpid.trim() !== '')
    )

  if (kind === 'ai.prediction') {
    return predictionLabels.some((label) => label === 'syn_flood' || label === 'udp_flood')
      ? 'ai_attack'
      : 'other'
  }
  if (kind === 'policy.decision') return 'ryu_policy'
  if (kind === 'mitigation.requested' || kind === 'mitigation.confirmed') return 'drop_control'
  if (kind === 'mitigation.counter') return hasVerifiedDropCounter ? 'verified_counter' : 'other'
  if (kind === 'mitigation.removed' || kind === 'mitigation.cleaned') return 'removed_cleaned'

  if (rawEvent === 'ai_phat_hien') return 'ai_attack'
  if (rawEvent === 'ryu_danh_gia' || rawEvent === 'b8_live_policy_decision') return 'ryu_policy'
  if (
    rawEvent === 'ryu_yeu_cau'
    || rawEvent === 'ovs_da_ap_luat'
    || rawEvent === 'b8_mitigation_requested'
    || rawEvent === 'b8_mitigation_confirmed'
  ) return 'drop_control'
  if (
    (rawEvent === 'ovs_da_loai_goi' || rawEvent === 'b8_drop_counter')
    && hasVerifiedDropCounter
  ) return 'verified_counter'
  if (
    rawEvent === 'ovs_go_luat'
    || rawEvent === 'ovs_don_luat'
    || rawEvent === 'b8_mitigation_flow_removed'
    || rawEvent === 'b8_mitigation_cleaned'
  ) return 'removed_cleaned'
  return 'other'
}

function describeEvent(event: B8NormalizedEvent): string {
  const prediction = eventText(event, 'prediction')
  const decision = eventText(event, 'decision')
  const action = eventText(event, 'mitigation_action')
  const packetCount = numberValue(event.payload.packet_count)
  const phase = eventText(event, 'phase')
  const status = eventText(event, 'status')
  const details = [
    prediction,
    decision,
    action,
    packetCount === null ? null : `${packetCount.toLocaleString('en-US')} packets`,
    phase,
    status,
  ].filter((value): value is string => value !== null)
  return details.length > 0 ? `${event.raw_event}: ${details.join(' · ')}` : event.raw_event
}

export function mapHistoryEvent(event: B8NormalizedEvent, browserAt: string): HistoryEvent {
  return {
    id: event.event_id,
    timestamp: sourceTimestamp(event.source_timestamp) ?? '',
    sourceIp: eventText(event, 'src_ip'),
    rawEvent: event.raw_event,
    sampleId: event.keys.sample_id ?? eventText(event, 'sample_id'),
    cookie: event.keys.cookie ?? eventText(event, 'cookie'),
    dpid: typeof event.payload.dpid === 'number' || typeof event.payload.dpid === 'string'
      ? event.payload.dpid
      : null,
    timelineCategory: historyCategory(event),
    kind: historyKind(event.kind),
    description: describeEvent(event),
    severity: 'info',
    times: makeTimes(event.source_timestamp, event.backend_received_at, browserAt),
  }
}

function statusFromWire(value: string): MitigationStatus {
  switch (value) {
    case 'REQUESTED': return 'requested'
    case 'CONFIRMED': return 'confirmed'
    case 'VERIFIED': return 'verified'
    case 'DROPPING': return 'dropping'
    case 'REMOVED': return 'removed'
    case 'REMOVED_IDLE': return 'removed_idle'
    case 'CLEANED': return 'cleaned'
    default: return 'unknown'
  }
}

function mapEvidence(
  value: B8RuleProjection['evidence'],
): MitigationEvidence | null {
  if (
    !value ||
    (value.source !== 'controller' && value.source !== 'switch')
  ) return null
  const observedAt = sourceTimestamp(value.source_timestamp)
  if (!observedAt || !value.reference.trim()) return null
  return {
    source: value.source,
    reference: value.reference,
    observedAt,
  }
}

function mapRule(rule: B8RuleProjection, browserAt: string): MitigationRule {
  const updatedAt = sourceTimestamp(rule.source_timestamp) ?? ''
  return {
    id: rule.id,
    sourceIp: rule.src_ip ?? '',
    switchId: rule.dpid === null ? '' : String(rule.dpid),
    rule: rule.mitigation_action ?? '',
    status: statusFromWire(rule.status),
    evidence: mapEvidence(rule.evidence),
    updatedAt,
    cookie: rule.cookie,
    dpid: rule.dpid,
    sampleId: rule.sample_id,
    destinationIp: rule.dst_ip,
    ipProtocol: rule.ip_proto,
    packetCount: rule.packet_count,
    byteCount: rule.byte_count,
    counterDelta: rule.counter_delta,
    counterReset: rule.counter_reset,
    counterSource: rule.counter_source,
    removalReason: rule.reason,
    eventId: rule.last_event_id,
    times: makeTimes(rule.source_timestamp, null, browserAt),
  }
}

function mapRuleHistory(rule: B8RuleProjection, browserAt: string): HistoryEvent | null {
  if (!rule.last_event_id) return null
  const timestamp = sourceTimestamp(rule.source_timestamp)
  const action = rule.mitigation_action ?? 'mitigation'
  return {
    id: rule.last_event_id,
    timestamp: timestamp ?? '',
    sourceIp: rule.src_ip,
    rawEvent: null,
    sampleId: rule.sample_id,
    cookie: rule.cookie,
    dpid: rule.dpid,
    timelineCategory: ['removed', 'removed_idle', 'cleaned'].includes(statusFromWire(rule.status))
      ? 'removed_cleaned'
      : ['verified', 'dropping'].includes(statusFromWire(rule.status))
        ? 'verified_counter'
        : ['requested', 'confirmed'].includes(statusFromWire(rule.status))
          ? 'drop_control'
          : 'other',
    kind: 'mitigation',
    description: `${action} ${rule.status.toLowerCase()} · cookie ${rule.cookie}`,
    severity: 'info',
    times: makeTimes(rule.source_timestamp, null, browserAt),
  }
}

function mapDropCounter(
  sample: B8DropCounterProjection,
): DropCounterPoint | null {
  const timestamp = sourceTimestamp(sample.timestamp)
  if (!timestamp) return null
  return {
    id: sample.event_id,
    timestamp,
    cookie: sample.cookie,
    dpid: sample.dpid,
    sourceIp: sample.src_ip,
    sampleId: sample.sample_id,
    packetCount: sample.packet_count,
    delta: sample.delta,
    counterReset: sample.counter_reset,
  }
}

function uniqueHistory(events: readonly HistoryEvent[]): HistoryEvent[] {
  const unique = new Map<string, HistoryEvent>()
  for (const event of events) unique.set(event.id, event)
  return [...unique.values()]
    .sort((left, right) => (Date.parse(left.timestamp) || 0) - (Date.parse(right.timestamp) || 0))
    .slice(-MAX_HISTORY_EVENTS)
}

function runMetadata(snapshot: B8SnapshotResponse): RunMetadata {
  const { run } = snapshot
  const seed = typeof run.seed === 'string' || typeof run.seed === 'number' ? run.seed : null
  return {
    runId: snapshot.run_id,
    scenario: scenarioLabel(run.scenario),
    seed,
    status: stringValue(run.status),
    policyMode: run.policy_mode === 'ALERT_ONLY' || run.policy_mode === 'MITIGATE'
      ? run.policy_mode
      : null,
    revision: run.revision,
  }
}

function terminalRunStatus(status: string | null): boolean {
  return status !== null
    && ['aborted', 'cancelled', 'canceled', 'complete', 'completed', 'failed']
      .includes(status.trim().toLowerCase())
}

export function mapSnapshot(
  wire: B8SnapshotResponse,
  browserReceivedAt = new Date().toISOString(),
): DashboardSnapshot {
  const initial = createInitialSnapshot()
  const policies = wire.state.latest_policies
    .map((event) => mapPolicy(event, browserReceivedAt))
    .filter((policy): policy is PolicyDecision => policy !== null)
    .slice(-MAX_POLICY_DECISIONS)
  const rules = wire.state.rules.slice(-MAX_MITIGATION_RULES)
  const latest = wire.state.latest_prediction
  const fallbackAlert = latest
    ? mapAlert(latest, browserReceivedAt, 'historical')
    : null
  const alerts = wire.state.alert_events
    ? wire.state.alert_events
      .map((event) => mapAlert(event, browserReceivedAt, 'historical'))
      .filter((alert): alert is AlertEvent => alert !== null)
      .slice(-MAX_ALERT_EVENTS)
    : fallbackAlert ? [fallbackAlert] : []
  const histories = wire.state.recent_events
    ? wire.state.recent_events.map((event) => mapHistoryEvent(event, browserReceivedAt))
    : [
      ...(latest ? [mapHistoryEvent(latest, browserReceivedAt)] : []),
      ...wire.state.latest_policies.map((event) => mapHistoryEvent(event, browserReceivedAt)),
      ...wire.state.observations.map((event) => mapHistoryEvent(event, browserReceivedAt)),
      ...rules
        .map((rule) => mapRuleHistory(rule, browserReceivedAt))
        .filter((event): event is HistoryEvent => event !== null),
    ]
  const dropCounterHistory = (wire.state.drop_counter_history ?? [])
    .map(mapDropCounter)
    .filter((point): point is DropCounterPoint => point !== null)
    .slice(-MAX_DROP_COUNTER_POINTS)
  const predictionClassCounts: PredictionClassCounts | null =
    wire.state.prediction_class_counts
      ? { ...wire.state.prediction_class_counts }
      : null

  return {
    ...initial,
    run: runMetadata(wire),
    dataMode: wire.data_mode,
    runLiveStatus: wire.live_monitor,
    backendSnapshotReceivedAt: wire.snapshot_received_at,
    receivedAt: browserReceivedAt,
    predictionCount: Number.isSafeInteger(wire.state.prediction_count) && wire.state.prediction_count >= 0
      ? wire.state.prediction_count
      : null,
    predictionClassCounts,
    alertEventCount: wire.state.alert_event_count,
    alertHistoryComplete: wire.state.alert_event_count !== null
      && wire.state.alert_event_count === alerts.length,
    policies,
    mitigationsComplete: wire.state.rules.length <= MAX_MITIGATION_RULES,
    network: {
      ...initial.network,
      verifiedSources: Number.isSafeInteger(wire.state.verified_source_count)
        && wire.state.verified_source_count >= 0
        ? wire.state.verified_source_count
        : null,
      dropCounterHistory,
      dropCounterSampleCount: wire.state.drop_counter_sample_count,
      dropCounterHistoryComplete: wire.state.drop_counter_sample_count !== null
        && wire.state.drop_counter_sample_count === dropCounterHistory.length,
    },
    detection: latest ? mapDetection(latest, browserReceivedAt, wire.run.revision) : null,
    alerts,
    mitigations: rules.map((rule) => mapRule(rule, browserReceivedAt)),
    history: uniqueHistory(histories),
    performance: {
      ...initial.performance,
      mitigationMs: wire.state.mitigation_observation_ms,
      mitigationSampleCount: wire.state.mitigation_observation_count,
    },
    services: {
      dashboardApi: { status: 'connected', updatedAt: browserReceivedAt },
      ai: initial.services.ai,
      ryu: initial.services.ryu,
      websocket: {
        status: wire.data_mode === 'LIVE' ? 'connecting' : 'disconnected',
        updatedAt: browserReceivedAt,
      },
    },
  }
}

function eventRuleKey(dpid: unknown, cookie: unknown): string | null {
  if (
    (typeof dpid !== 'number' && typeof dpid !== 'string') ||
    (typeof cookie !== 'string' || cookie.trim() === '')
  ) return null
  return `${String(dpid)}:${cookie}`
}

function validCounterEvidence(
  event: B8NormalizedEvent,
  rule: MitigationRule,
  packetCount: number | null,
): MitigationEvidence | null {
  const timestamp = event.source_timestamp
  if (
    event.payload.counter_source !== 'verified_flow_stats' ||
    !rule.cookie?.trim() ||
    typeof rule.dpid !== 'number' ||
    !Number.isInteger(rule.dpid) ||
    rule.dpid < 0 ||
    packetCount === null ||
    !Number.isSafeInteger(packetCount) ||
    (typeof timestamp !== 'number' || !Number.isFinite(timestamp))
  ) return null
  const observedAt = sourceTimestamp(timestamp)
  if (!observedAt) return null
  return { source: 'controller', reference: event.event_id, observedAt }
}

function mapCounterEvent(
  event: B8NormalizedEvent,
  rule: MitigationRule,
): DropCounterPoint | null {
  const packetCount = numberValue(event.payload.packet_count)
  const cookie = event.keys.cookie ?? stringValue(event.payload.cookie)
  const dpid = event.payload.dpid
  if (
    event.kind !== 'mitigation.counter'
    || event.payload.mitigation_action !== 'DROP'
    || !cookie
    || typeof dpid !== 'number'
    || !Number.isInteger(dpid)
    || dpid < 0
    || packetCount === null
    || !Number.isSafeInteger(packetCount)
    || packetCount < 0
    || !validCounterEvidence(event, rule, packetCount)
  ) return null

  const timestamp = sourceTimestamp(event.source_timestamp)
  if (!timestamp) return null
  return {
    id: event.event_id,
    timestamp,
    cookie,
    dpid,
    sourceIp: stringValue(event.payload.src_ip),
    sampleId: event.keys.sample_id,
    packetCount,
    delta: rule.counterReset ? null : rule.counterDelta,
    counterReset: rule.counterReset,
  }
}

function updateCounter(
  previous: number | null,
  value: unknown,
): { value: number | null; delta: number | null; reset: boolean } {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return { value: previous, delta: null, reset: false }
  }
  if (previous === null) return { value, delta: null, reset: false }
  if (value >= previous) return { value, delta: value - previous, reset: false }
  return { value, delta: null, reset: true }
}

function applyRuleEvent(
  existing: MitigationRule | undefined,
  event: B8NormalizedEvent,
  browserAt: string,
): MitigationRule | null {
  const payload = event.payload
  const cookie = event.keys.cookie ?? stringValue(payload.cookie)
  const dpid = payload.dpid
  const id = eventRuleKey(dpid, cookie)
  if (!id) return null

  const sourceTimestampValue = event.source_timestamp
  const updatedAt = sourceTimestamp(sourceTimestampValue) ?? ''
  const base: MitigationRule = existing ?? {
    id,
    sourceIp: '',
    switchId: String(dpid),
    rule: '',
    status: 'unknown',
    evidence: null,
    updatedAt,
    cookie,
    dpid: typeof dpid === 'number' || typeof dpid === 'string' ? dpid : null,
    sampleId: event.keys.sample_id,
    destinationIp: null,
    ipProtocol: null,
    packetCount: null,
    byteCount: null,
    counterDelta: null,
    counterReset: false,
    counterSource: null,
    removalReason: null,
    eventId: null,
    times: makeTimes(sourceTimestampValue, event.backend_received_at, browserAt),
  }

  const next: MitigationRule = {
    ...base,
    sourceIp: stringValue(payload.src_ip) ?? base.sourceIp,
    switchId: String(dpid),
    rule: stringValue(payload.mitigation_action) ?? base.rule,
    cookie,
    dpid: typeof dpid === 'number' || typeof dpid === 'string' ? dpid : base.dpid,
    sampleId: event.keys.sample_id ?? base.sampleId,
    destinationIp: stringValue(payload.dst_ip) ?? base.destinationIp,
    ipProtocol: numberValue(payload.ip_proto) ?? base.ipProtocol,
    updatedAt,
    eventId: event.event_id,
    times: makeTimes(sourceTimestampValue, event.backend_received_at, browserAt),
  }

  switch (event.kind) {
    case 'mitigation.requested':
      if (['unknown', 'requested'].includes(base.status)) return { ...next, status: 'requested' }
      return next
    case 'mitigation.confirmed':
      if (['verified', 'dropping', 'removed', 'removed_idle', 'cleaned'].includes(base.status)) return next
      return { ...next, status: 'confirmed' }
    case 'mitigation.counter': {
      const packets = updateCounter(base.packetCount, payload.packet_count)
      const bytes = updateCounter(base.byteCount, payload.byte_count)
      const withCounts: MitigationRule = {
        ...next,
        packetCount: packets.value,
        byteCount: bytes.value,
        counterDelta: packets.delta,
        counterReset: packets.reset,
        counterSource: stringValue(payload.counter_source) ?? base.counterSource,
      }
      const evidence = validCounterEvidence(event, withCounts, packets.value)
      if (!evidence) return withCounts
      const isTerminal = ['removed', 'removed_idle', 'cleaned'].includes(base.status)
      return {
        ...withCounts,
        evidence,
        status: isTerminal ? base.status : packets.value !== null && packets.value > 0 ? 'dropping' : 'verified',
      }
    }
    case 'mitigation.removed': {
      const packets = updateCounter(base.packetCount, payload.packet_count)
      const bytes = updateCounter(base.byteCount, payload.byte_count)
      const reason = numberValue(payload.reason)
      return {
        ...next,
        packetCount: packets.value,
        byteCount: bytes.value,
        counterDelta: packets.delta,
        counterReset: packets.reset,
        removalReason: reason,
        status: reason === 0 ? 'removed_idle' : 'removed',
      }
    }
    case 'mitigation.cleaned':
      return { ...next, status: 'cleaned' }
    default:
      return next
  }
}

function verifiedSourceCount(rules: readonly MitigationRule[], complete: boolean): number | null {
  if (!complete) return null
  const sources = new Set(
    rules
      .filter((rule) => {
        const status = getMitigationStatus(rule)
        return status === 'verified' || status === 'dropping'
      })
      .map((rule) => rule.sourceIp.trim())
      .filter(Boolean),
  )
  return sources.size
}

function addHistory(
  history: readonly HistoryEvent[],
  event: B8NormalizedEvent,
  browserAt: string,
): HistoryEvent[] {
  return [...history, mapHistoryEvent(event, browserAt)].slice(-MAX_HISTORY_EVENTS)
}

function hasAlert(alerts: readonly AlertEvent[], alert: AlertEvent): boolean {
  if (alerts.some((item) => item.id === alert.id)) return true
  return alert.category === 'drop_observed' && alerts.some((item) => (
    item.category === 'drop_observed'
    && item.cookie === alert.cookie
    && String(item.dpid) === String(alert.dpid)
  ))
}

function addAlert(
  alerts: readonly AlertEvent[],
  alert: AlertEvent,
): AlertEvent[] {
  return [...alerts, alert].slice(-MAX_ALERT_EVENTS)
}

export class B8DashboardReducer {
  private current: DashboardSnapshot
  private readonly seenEventIds = new Set<string>()
  private readonly seenPredictionIds = new Set<string>()

  constructor(initial: DashboardSnapshot) {
    this.current = initial
  }

  reset(snapshot: DashboardSnapshot): void {
    this.current = snapshot
    this.seenEventIds.clear()
    this.seenPredictionIds.clear()
  }

  currentSnapshot(): DashboardSnapshot {
    return this.current
  }

  apply(event: B8NormalizedEvent, browserAt = new Date().toISOString()): DashboardSnapshot | null {
    if (this.seenEventIds.has(event.event_id)) return null
    if (this.current.run?.runId !== event.run_id) {
      throw new Error('B8 event run_id does not match the selected dashboard run.')
    }

    const predictionId = event.kind === 'ai.prediction'
      ? event.keys.sample_id ?? eventText(event, 'id')
      : null
    const duplicatePrediction = predictionId !== null
      && this.seenPredictionIds.has(predictionId)
    if (predictionId !== null) this.seenPredictionIds.add(predictionId)

    let next: DashboardSnapshot = {
      ...this.current,
      receivedAt: browserAt,
      history: event.source_stream === 'ryu_events.jsonl' || event.kind === 'run.phase'
        ? addHistory(this.current.history, event, browserAt)
        : this.current.history,
    }

    const scope: AlertEvent['scope'] = this.current.dataMode === 'LIVE'
      && this.current.runLiveStatus?.terminal !== true
      && !terminalRunStatus(this.current.run?.status ?? null)
      ? 'live'
      : 'historical'
    const candidateAlert = duplicatePrediction
      ? null
      : mapAlert(event, browserAt, scope)
    if (candidateAlert && !hasAlert(this.current.alerts, candidateAlert)) {
      const alerts = addAlert(this.current.alerts, candidateAlert)
      const alertEventCount = this.current.alertEventCount === null
        ? null
        : this.current.alertEventCount + 1
      next = {
        ...next,
        alerts,
        alertEventCount,
        alertHistoryComplete: this.current.alertHistoryComplete
          && alertEventCount !== null
          && alerts.length === alertEventCount,
      }
    }

    if (event.kind === 'ai.prediction') {
      const label = eventText(event, 'prediction')
      const knownLabel = label === 'benign' || label === 'syn_flood' || label === 'udp_flood'
      next = {
        ...next,
        detection: mapDetection(event, browserAt, this.current.run?.revision),
        predictionCount: predictionId !== null && !duplicatePrediction
          && this.current.predictionCount !== null
          ? this.current.predictionCount + 1
          : this.current.predictionCount,
        predictionClassCounts: knownLabel
          && predictionId !== null
          && !duplicatePrediction
          && this.current.predictionClassCounts !== null
          ? {
            ...this.current.predictionClassCounts,
            [label]: this.current.predictionClassCounts[label] + 1,
          }
          : this.current.predictionClassCounts,
      }
    } else if (event.kind === 'policy.decision') {
      const policy = mapPolicy(event, browserAt)
      if (policy) {
        next = {
          ...next,
          policies: [
            ...this.current.policies.filter((item) => item.sampleId !== policy.sampleId),
            policy,
          ].slice(-MAX_POLICY_DECISIONS),
        }
      }
    } else if (event.kind.startsWith('mitigation.')) {
      const cookie = event.keys.cookie ?? stringValue(event.payload.cookie)
      const key = eventRuleKey(event.payload.dpid, cookie)
      if (key) {
        const existing = this.current.mitigations.find((rule) => rule.id === key)
        const updated = applyRuleEvent(existing, event, browserAt)
        if (updated) {
          const allRules = [
            ...this.current.mitigations.filter((rule) => rule.id !== key),
            updated,
          ]
          const complete = this.current.mitigationsComplete && allRules.length <= MAX_MITIGATION_RULES
          const rules = allRules.slice(-MAX_MITIGATION_RULES)
          next = {
            ...next,
            mitigations: rules,
            mitigationsComplete: complete,
            network: {
              ...next.network,
              verifiedSources: verifiedSourceCount(rules, complete),
            },
          }
          const counterPoint = updated.evidence?.reference === event.event_id
            ? mapCounterEvent(event, updated)
            : null
          if (counterPoint) {
            const dropCounterHistory = [
              ...next.network.dropCounterHistory,
              counterPoint,
            ].slice(-MAX_DROP_COUNTER_POINTS)
            const dropCounterSampleCount = next.network.dropCounterSampleCount === null
              ? null
              : next.network.dropCounterSampleCount + 1
            next = {
              ...next,
              network: {
                ...next.network,
                dropCounterHistory,
                dropCounterSampleCount,
                dropCounterHistoryComplete: next.network.dropCounterHistoryComplete
                  && dropCounterSampleCount !== null
                  && dropCounterSampleCount === dropCounterHistory.length,
              },
            }
          }
        }
      }
    }

    this.current = next
    this.seenEventIds.add(event.event_id)
    if (this.seenEventIds.size > MAX_SEEN_EVENT_IDS) {
      const oldest = this.seenEventIds.values().next().value
      if (typeof oldest === 'string') this.seenEventIds.delete(oldest)
    }
    if (this.seenPredictionIds.size > MAX_SEEN_EVENT_IDS) {
      const oldest = this.seenPredictionIds.values().next().value
      if (typeof oldest === 'string') this.seenPredictionIds.delete(oldest)
    }
    return next
  }
}

