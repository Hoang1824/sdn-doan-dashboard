import type {
  DashboardDataMode,
  DashboardRunOption,
  LiveRunDiscovery,
  RunLiveStatus,
} from '../types/dashboard'

export interface B8RunListItem {
  readonly run_id: string
  readonly manifest: Readonly<Record<string, unknown>> | null
  readonly metadata_error?: string
  readonly live?: RunLiveStatus | null
}

export interface B8RunCatalog {
  readonly runs: readonly DashboardRunOption[]
  readonly liveDiscovery: LiveRunDiscovery | null
}

export interface B8NormalizedEvent {
  readonly schema_version: 'b8.dashboard.v1'
  readonly run_id: string
  readonly event_id: string
  readonly cursor: string
  readonly kind: string
  readonly raw_event: string
  readonly source_stream: string
  readonly source_timestamp: number | string | null
  readonly backend_received_at: string
  readonly data_mode: DashboardDataMode
  readonly policy_mode: string | null
  readonly run_revision: Readonly<Record<string, unknown>>
  readonly keys: Readonly<{
    sample_id: string | null
    cookie: string | null
  }>
  readonly payload: Readonly<Record<string, unknown>>
}

export interface B8RuleProjection {
  readonly id: string
  readonly dpid: number | string | null
  readonly cookie: string
  readonly sample_id: string | null
  readonly src_ip: string | null
  readonly dst_ip: string | null
  readonly ip_proto: number | null
  readonly mitigation_action: string | null
  readonly status: string
  readonly packet_count: number | null
  readonly byte_count: number | null
  readonly counter_delta: number | null
  readonly counter_reset: boolean
  readonly counter_source: string | null
  readonly evidence: Readonly<{
    source: string
    reference: string
    source_timestamp: number | string | null
  }> | null
  readonly reason: number | null
  readonly source_timestamp: number | string | null
  readonly last_event_id: string | null
}

export interface B8SnapshotResponse {
  readonly run_id: string
  readonly data_mode: DashboardDataMode
  readonly policy_mode: string | null
  readonly live_monitor: RunLiveStatus | null
  readonly run: Readonly<{
    scenario: unknown
    seed: unknown
    status: unknown
    policy_mode: string | null
    revision: Readonly<Record<string, unknown>>
  }>
  readonly as_of_cursor: string
  readonly snapshot_received_at: string
  readonly state: Readonly<{
    prediction_count: number
    latest_prediction: B8NormalizedEvent | null
    latest_policies: readonly B8NormalizedEvent[]
    rules: readonly B8RuleProjection[]
    verified_source_count: number
    observations: readonly B8NormalizedEvent[]
  }>
}

export interface B8WebSocketLike {
  readonly readyState: number
  onopen: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: Event) => void) | null
  onclose: ((event: CloseEvent) => void) | null
  close(code?: number, reason?: string): void
}

export type B8WebSocketFactory = (url: string) => B8WebSocketLike

export interface B8DashboardClientOptions {
  readonly apiBaseUrl?: string
  readonly websocketBaseUrl?: string
  readonly fetcher?: typeof fetch
  readonly websocketFactory?: B8WebSocketFactory
}

export class B8ApiError extends Error {
  readonly status: number | null

  constructor(
    message: string,
    status: number | null = null,
  ) {
    super(message)
    this.name = 'B8ApiError'
    this.status = status
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new B8ApiError(`Invalid ${label} response shape.`)
  return value
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new B8ApiError(`Invalid ${label} response field.`)
  }
  return value
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw new B8ApiError(`Invalid ${label} response field.`)
  return value
}

function finiteNumber(value: unknown, label: string, nullable = false): number | null {
  if (nullable && value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new B8ApiError(`Invalid ${label} response field.`)
  }
  return value
}

function requiredFiniteNumber(value: unknown, label: string): number {
  const parsed = finiteNumber(value, label)
  if (parsed === null) throw new B8ApiError(`Invalid ${label} response field.`)
  return parsed
}

function requireDataMode(value: unknown): DashboardDataMode {
  if (value !== 'LIVE' && value !== 'REPLAY') throw new B8ApiError('Invalid data_mode in response.')
  return value
}

function parseLiveStatus(value: unknown, label: string): RunLiveStatus {
  const record = requireRecord(value, label)
  const status = record.status
  if (status !== null && typeof status !== 'string') throw new B8ApiError(`Invalid ${label} status.`)
  const freshness = record.freshness
  if (!['fresh', 'stale', 'no_activity', 'clock_skew', 'unknown'].includes(String(freshness))) {
    throw new B8ApiError(`Invalid ${label} freshness.`)
  }
  if (typeof record.terminal !== 'boolean' || typeof record.eligible !== 'boolean') {
    throw new B8ApiError(`Invalid ${label} flags.`)
  }
  const ageSeconds = finiteNumber(record.age_seconds, `${label} age_seconds`, true)
  const freshnessSeconds = requiredFiniteNumber(record.freshness_seconds, `${label} freshness_seconds`)
  return {
    status,
    terminal: record.terminal,
    freshness: freshness as RunLiveStatus['freshness'],
    eligible: record.eligible,
    lastActivityAt: nullableString(record.last_activity_at, `${label} last_activity_at`),
    lastActivityStream: nullableString(record.last_activity_stream, `${label} last_activity_stream`),
    ageSeconds,
    freshnessSeconds,
  }
}

function parseLiveDiscovery(value: unknown): LiveRunDiscovery {
  const record = requireRecord(value, 'live_discovery')
  const mode = record.mode
  if (mode !== 'automatic' && mode !== 'manual') throw new B8ApiError('Invalid live_discovery mode.')
  const status = record.status
  if (!['none', 'single', 'ambiguous', 'manual_active', 'manual_unavailable'].includes(String(status))) {
    throw new B8ApiError('Invalid live_discovery status.')
  }
  const selectedRunId = nullableString(record.selected_run_id, 'live_discovery selected_run_id')
  if (!Array.isArray(record.candidate_run_ids)) {
    throw new B8ApiError('Invalid live_discovery candidate_run_ids.')
  }
  const candidateRunIds = record.candidate_run_ids.map((item) => requireString(item, 'candidate run_id'))
  return {
    mode,
    status: status as LiveRunDiscovery['status'],
    selectedRunId,
    candidateRunIds,
    freshnessSeconds: requiredFiniteNumber(record.freshness_seconds, 'live_discovery freshness_seconds'),
  }
}

function manifestPolicyMode(manifest: Readonly<Record<string, unknown>>): 'ALERT_ONLY' | 'MITIGATE' | null {
  for (const key of ['B8_POLICY_MODE', 'b8_policy_mode', 'policy_mode', 'mode']) {
    const value = manifest[key]
    if (value === 'ALERT_ONLY' || value === 'MITIGATE') return value
  }
  return null
}

function metadataString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function scenarioLabel(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return `S${value}`
  }
  if (typeof value !== 'string' || value.trim() === '') return null
  const scenario = value.trim()
  if (/^\d+$/.test(scenario)) return `S${scenario}`
  if (/^s\d+$/i.test(scenario)) return scenario.toUpperCase()
  return scenario
}

function metadataSeed(manifest: Readonly<Record<string, unknown>>): string | number | null {
  const seed = manifest.seed !== null && manifest.seed !== undefined
    ? manifest.seed
    : manifest.seed_reference
  return typeof seed === 'string' || typeof seed === 'number' ? seed : null
}

function mapRunItem(value: unknown): DashboardRunOption {
  const item = requireRecord(value, 'run list')
  const runId = requireString(item.run_id, 'run_id')
  const manifest = item.manifest === null
    ? null
    : requireRecord(item.manifest, `manifest for ${runId}`)
  const revision: Record<string, unknown> = {}

  if (manifest) {
    for (const [key, fieldValue] of Object.entries(manifest)) {
      if (key.toLowerCase().includes('revision') || ['model_sha256', 'schema_version', 'profile'].includes(key)) {
        revision[key] = fieldValue
      }
    }
  }

  return {
    runId,
    scenario: scenarioLabel(manifest?.scenario),
    seed: manifest ? metadataSeed(manifest) : null,
    status: metadataString(manifest?.status),
    policyMode: manifest ? manifestPolicyMode(manifest) : null,
    revision,
    metadataError: metadataString(item.metadata_error),
    live: item.live === undefined || item.live === null
      ? null
      : parseLiveStatus(item.live, `live status for ${runId}`),
  }
}

export function parseEvent(value: unknown): B8NormalizedEvent {
  const event = requireRecord(value, 'event')
  const keys = requireRecord(event.keys, 'event keys')
  const payload = requireRecord(event.payload, 'event payload')
  const revision = requireRecord(event.run_revision, 'event run_revision')
  const sourceTimestamp = event.source_timestamp
  if (
    sourceTimestamp !== null &&
    typeof sourceTimestamp !== 'string' &&
    (typeof sourceTimestamp !== 'number' || !Number.isFinite(sourceTimestamp))
  ) {
    throw new B8ApiError('Invalid event source_timestamp.')
  }

  if (event.schema_version !== 'b8.dashboard.v1') {
    throw new B8ApiError('Unsupported event schema_version.')
  }

  return {
    schema_version: 'b8.dashboard.v1',
    run_id: requireString(event.run_id, 'event run_id'),
    event_id: requireString(event.event_id, 'event event_id'),
    cursor: requireString(event.cursor, 'event cursor'),
    kind: requireString(event.kind, 'event kind'),
    raw_event: requireString(event.raw_event, 'event raw_event'),
    source_stream: requireString(event.source_stream, 'event source_stream'),
    source_timestamp: sourceTimestamp,
    backend_received_at: requireString(event.backend_received_at, 'event backend_received_at'),
    data_mode: requireDataMode(event.data_mode),
    policy_mode: nullableString(event.policy_mode, 'event policy_mode'),
    run_revision: revision,
    keys: {
      sample_id: nullableString(keys.sample_id, 'event sample_id'),
      cookie: nullableString(keys.cookie, 'event cookie'),
    },
    payload,
  }
}

function parseRule(value: unknown): B8RuleProjection {
  const rule = requireRecord(value, 'rule')
  const evidenceValue = rule.evidence
  let evidence: B8RuleProjection['evidence'] = null
  if (evidenceValue !== null) {
    const evidenceRecord = requireRecord(evidenceValue, 'rule evidence')
    const evidenceTimestamp = evidenceRecord.source_timestamp
    if (
      evidenceTimestamp !== null &&
      typeof evidenceTimestamp !== 'string' &&
      (typeof evidenceTimestamp !== 'number' || !Number.isFinite(evidenceTimestamp))
    ) {
      throw new B8ApiError('Invalid rule evidence timestamp.')
    }
    evidence = {
      source: requireString(evidenceRecord.source, 'evidence source'),
      reference: requireString(evidenceRecord.reference, 'evidence reference'),
      source_timestamp: evidenceTimestamp,
    }
  }

  const dpid = rule.dpid
  if (dpid !== null && typeof dpid !== 'string' && typeof dpid !== 'number') {
    throw new B8ApiError('Invalid rule dpid.')
  }

  return {
    id: requireString(rule.id, 'rule id'),
    dpid,
    cookie: requireString(rule.cookie, 'rule cookie'),
    sample_id: nullableString(rule.sample_id, 'rule sample_id'),
    src_ip: nullableString(rule.src_ip, 'rule src_ip'),
    dst_ip: nullableString(rule.dst_ip, 'rule dst_ip'),
    ip_proto: finiteNumber(rule.ip_proto, 'rule ip_proto', true),
    mitigation_action: nullableString(rule.mitigation_action, 'rule mitigation_action'),
    status: requireString(rule.status, 'rule status'),
    packet_count: finiteNumber(rule.packet_count, 'rule packet_count', true),
    byte_count: finiteNumber(rule.byte_count, 'rule byte_count', true),
    counter_delta: finiteNumber(rule.counter_delta, 'rule counter_delta', true),
    counter_reset: (() => {
      if (typeof rule.counter_reset !== 'boolean') {
        throw new B8ApiError('Invalid rule counter_reset.')
      }
      return rule.counter_reset
    })(),
    counter_source: nullableString(rule.counter_source, 'rule counter_source'),
    evidence,
    reason: finiteNumber(rule.reason, 'rule reason', true),
    source_timestamp: (() => {
      const timestamp = rule.source_timestamp
      if (
        timestamp !== null &&
        typeof timestamp !== 'string' &&
        (typeof timestamp !== 'number' || !Number.isFinite(timestamp))
      ) {
        throw new B8ApiError('Invalid rule source_timestamp.')
      }
      return timestamp
    })(),
    last_event_id: nullableString(rule.last_event_id, 'rule last_event_id'),
  }
}

export function parseSnapshot(value: unknown): B8SnapshotResponse {
  const snapshot = requireRecord(value, 'snapshot')
  const run = requireRecord(snapshot.run, 'snapshot run')
  const state = requireRecord(snapshot.state, 'snapshot state')
  const revision = requireRecord(run.revision, 'run revision')
  const runPolicyMode = nullableString(run.policy_mode, 'run policy_mode')
  const policyMode = nullableString(snapshot.policy_mode, 'policy_mode')
  const liveMonitor = snapshot.live_monitor === undefined || snapshot.live_monitor === null
    ? null
    : parseLiveStatus(snapshot.live_monitor, 'live_monitor')
  const latestPrediction = state.latest_prediction === null ? null : parseEvent(state.latest_prediction)
  const policies = state.latest_policies
  const rules = state.rules
  const observations = state.observations
  if (!Array.isArray(policies) || !Array.isArray(rules) || !Array.isArray(observations)) {
    throw new B8ApiError('Invalid snapshot state collections.')
  }

  const seed = run.seed
  if (seed !== null && typeof seed !== 'string' && typeof seed !== 'number') {
    throw new B8ApiError('Invalid run seed.')
  }

  return {
    run_id: requireString(snapshot.run_id, 'snapshot run_id'),
    data_mode: requireDataMode(snapshot.data_mode),
    policy_mode: policyMode,
    live_monitor: liveMonitor,
    run: {
      scenario: run.scenario,
      seed,
      status: run.status,
      policy_mode: runPolicyMode,
      revision,
    },
    as_of_cursor: requireString(snapshot.as_of_cursor, 'as_of_cursor'),
    snapshot_received_at: requireString(snapshot.snapshot_received_at, 'snapshot_received_at'),
    state: {
      prediction_count: requiredFiniteNumber(state.prediction_count, 'prediction_count'),
      latest_prediction: latestPrediction,
      latest_policies: policies.map(parseEvent),
      rules: rules.map(parseRule),
      verified_source_count: requiredFiniteNumber(state.verified_source_count, 'verified_source_count'),
      observations: observations.map(parseEvent),
    },
  }
}

export class B8DashboardClient {
  private readonly apiBaseUrl: string
  private readonly websocketBaseUrl: string | null
  private readonly fetcher: typeof fetch
  private readonly websocketFactory: B8WebSocketFactory

  constructor(options: B8DashboardClientOptions = {}) {
    this.apiBaseUrl = (options.apiBaseUrl ?? '').replace(/\/+$/, '')
    this.websocketBaseUrl = options.websocketBaseUrl?.replace(/\/+$/, '') || null
    this.fetcher = options.fetcher ?? ((input, init) => globalThis.fetch(input, init))
    this.websocketFactory = options.websocketFactory ?? ((url) => new WebSocket(url))
  }

  async listRuns(signal?: AbortSignal): Promise<DashboardRunOption[]> {
    return [...(await this.listRunCatalog(signal)).runs]
  }

  async listRunCatalog(signal?: AbortSignal): Promise<B8RunCatalog> {
    const response = await this.request('/api/runs', signal)
    const body = requireRecord(response, 'run list')
    if (!Array.isArray(body.runs)) throw new B8ApiError('Invalid run list response.')
    return {
      runs: body.runs.map(mapRunItem),
      liveDiscovery: body.live_discovery === undefined || body.live_discovery === null
        ? null
        : parseLiveDiscovery(body.live_discovery),
    }
  }

  async getSnapshot(
    runId: string,
    dataMode: DashboardDataMode,
    signal?: AbortSignal,
  ): Promise<B8SnapshotResponse> {
    const query = new URLSearchParams({ data_mode: dataMode })
    const response = await this.request(
      `/api/runs/${encodeURIComponent(runId)}/snapshot?${query.toString()}`,
      signal,
    )
    return parseSnapshot(response)
  }

  openLive(runId: string, cursor: string): B8WebSocketLike {
    const query = new URLSearchParams({ after: cursor, data_mode: 'LIVE' })
    const path = `/ws/runs/${encodeURIComponent(runId)}?${query.toString()}`
    const url = this.websocketUrl(path)
    return this.websocketFactory(url)
  }

  private async request(path: string, signal?: AbortSignal): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetcher(`${this.apiBaseUrl}${path}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw new B8ApiError(error instanceof Error ? error.message : 'Dashboard API request failed.')
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new B8ApiError(`Dashboard API returned invalid JSON (HTTP ${response.status}).`, response.status)
    }
    if (!response.ok) {
      const errorBody = isRecord(body) ? body.detail : null
      const detail = typeof errorBody === 'string'
        ? errorBody
        : isRecord(errorBody) && typeof errorBody.message === 'string'
          ? errorBody.message
          : `Dashboard API returned HTTP ${response.status}.`
      throw new B8ApiError(detail, response.status)
    }
    return body
  }

  private websocketUrl(path: string): string {
    if (this.websocketBaseUrl) return `${this.websocketBaseUrl}${path}`
    if (this.apiBaseUrl) {
      const apiUrl = new URL(this.apiBaseUrl)
      apiUrl.protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:'
      return `${apiUrl.origin}${path}`
    }
    if (typeof window === 'undefined') throw new B8ApiError('WebSocket URL requires browser origin or configuration.')
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}${path}`
  }
}

