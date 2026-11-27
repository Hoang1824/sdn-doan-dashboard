import type {
  AlertEvent,
  DashboardSnapshot,
  Detection,
  EventTimes,
  HistoryEvent,
  MitigationEvidence,
  MitigationRule,
  MitigationStatus,
  PolicyDecision,
  RunMetadata,
} from '../types/dashboard'
import { scenarioLabel } from './b8-api.ts'
import type { B8NormalizedEvent, B8RuleProjection, B8SnapshotResponse } from './b8-api.ts'
import { getMitigationStatus } from './presentation.ts'
import { createInitialSnapshot } from './initial-state.ts'

export const MAX_HISTORY_EVENTS = 500
export const MAX_ALERT_EVENTS = 100
export const MAX_POLICY_DECISIONS = 100
export const MAX_MITIGATION_RULES = 500
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

function mapAlert(event: B8NormalizedEvent, browserAt: string): AlertEvent | null {
  const label = eventText(event, 'prediction')
  if (label !== 'syn_flood' && label !== 'udp_flood') return null
  return {
    id: event.event_id,
    timestamp: sourceTimestamp(event.source_timestamp) ?? '',
    sourceIp: eventText(event, 'src_ip'),
    description: `AI prediction: ${label}`,
    severity: null,
    confirmed: false,
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

function describeEvent(event: B8NormalizedEvent): string {
  const prediction = eventText(event, 'prediction')
  const decision = eventText(event, 'decision')
  const action = eventText(event, 'mitigation_action')
  const detail = prediction ?? decision ?? action
  return detail ? `${event.raw_event}: ${detail}` : event.raw_event
}

function mapHistory(event: B8NormalizedEvent, browserAt: string): HistoryEvent {
  return {
    id: event.event_id,
    timestamp: sourceTimestamp(event.source_timestamp) ?? '',
    sourceIp: eventText(event, 'src_ip'),
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
    kind: 'mitigation',
    description: `${action} ${rule.status.toLowerCase()} · cookie ${rule.cookie}`,
    severity: 'info',
    times: makeTimes(rule.source_timestamp, null, browserAt),
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
  const latestAlert = latest ? mapAlert(latest, browserReceivedAt) : null
  const histories = [
    ...(latest ? [mapHistory(latest, browserReceivedAt)] : []),
    ...wire.state.latest_policies.map((event) => mapHistory(event, browserReceivedAt)),
    ...wire.state.observations.map((event) => mapHistory(event, browserReceivedAt)),
    ...rules
      .map((rule) => mapRuleHistory(rule, browserReceivedAt))
      .filter((event): event is HistoryEvent => event !== null),
  ]

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
    policies,
    mitigationsComplete: wire.state.rules.length <= MAX_MITIGATION_RULES,
    network: {
      ...initial.network,
      verifiedSources: Number.isSafeInteger(wire.state.verified_source_count)
        && wire.state.verified_source_count >= 0
        ? wire.state.verified_source_count
        : null,
    },
    detection: latest ? mapDetection(latest, browserReceivedAt, wire.run.revision) : null,
    alerts: latestAlert ? [latestAlert] : [],
    mitigations: rules.map((rule) => mapRule(rule, browserReceivedAt)),
    history: uniqueHistory(histories),
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
  return [...history, mapHistory(event, browserAt)].slice(-MAX_HISTORY_EVENTS)
}

function addAlert(
  alerts: readonly AlertEvent[],
  event: B8NormalizedEvent,
  browserAt: string,
): AlertEvent[] {
  const alert = mapAlert(event, browserAt)
  if (!alert) return [...alerts]
  return [...alerts.filter((item) => item.id !== alert.id), alert].slice(-MAX_ALERT_EVENTS)
}

export class B8DashboardReducer {
  private current: DashboardSnapshot
  private readonly seenEventIds = new Set<string>()

  constructor(initial: DashboardSnapshot) {
    this.current = initial
  }

  reset(snapshot: DashboardSnapshot): void {
    this.current = snapshot
    this.seenEventIds.clear()
  }

  currentSnapshot(): DashboardSnapshot {
    return this.current
  }

  apply(event: B8NormalizedEvent, browserAt = new Date().toISOString()): DashboardSnapshot | null {
    if (this.seenEventIds.has(event.event_id)) return null
    if (this.current.run?.runId !== event.run_id) {
      throw new Error('B8 event run_id does not match the selected dashboard run.')
    }

    let next: DashboardSnapshot = {
      ...this.current,
      receivedAt: browserAt,
      history: addHistory(this.current.history, event, browserAt),
    }

    if (event.kind === 'ai.prediction') {
      next = {
        ...next,
        detection: mapDetection(event, browserAt, this.current.run?.revision),
        alerts: addAlert(this.current.alerts, event, browserAt),
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
        }
      }
    }

    this.current = next
    this.seenEventIds.add(event.event_id)
    if (this.seenEventIds.size > MAX_SEEN_EVENT_IDS) {
      const oldest = this.seenEventIds.values().next().value
      if (typeof oldest === 'string') this.seenEventIds.delete(oldest)
    }
    return next
  }
}

