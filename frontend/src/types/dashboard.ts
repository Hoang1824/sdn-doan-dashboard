/** Dashboard read models; B8 wire responses are validated and mapped by the data adapter. */
export type ServiceStatus =
  | 'unconfigured'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'

export interface ServiceState {
  readonly status: ServiceStatus
  readonly updatedAt: string | null
}

export type DashboardDataMode = 'LIVE' | 'REPLAY'
export type RunFinalizationStatus = 'confirmed' | 'timeout' | null

export interface RunLiveStatus {
  readonly status: string | null
  readonly terminal: boolean
  readonly freshness: 'fresh' | 'stale' | 'no_activity' | 'clock_skew' | 'unknown'
  readonly eligible: boolean
  readonly lastActivityAt: string | null
  readonly lastActivityStream: string | null
  readonly ageSeconds: number | null
  readonly freshnessSeconds: number
}

export interface LiveRunDiscovery {
  readonly mode: 'automatic' | 'manual'
  readonly status: 'none' | 'single' | 'ambiguous' | 'manual_active' | 'manual_unavailable'
  readonly selectedRunId: string | null
  readonly candidateRunIds: readonly string[]
  readonly freshnessSeconds: number
}

export interface RunMetadata {
  readonly runId: string
  readonly scenario: string | null
  readonly seed: string | number | null
  readonly status: string | null
  readonly policyMode: 'ALERT_ONLY' | 'MITIGATE' | null
  readonly revision: Readonly<Record<string, unknown>>
}

export interface DashboardRunOption extends RunMetadata {
  readonly metadataError: string | null
  readonly live: RunLiveStatus | null
}

export interface TrafficPoint {
  readonly timestamp: string
  readonly ingressMbps: number
  readonly egressMbps: number
}

export interface EventTimes {
  /** Source/B8 timestamp, normalized for display without inferring latency. */
  readonly sourceTimestamp: string | null
  readonly backendReceivedAt: string | null
  readonly browserReceivedAt: string | null
}

export interface Detection {
  readonly id: string
  readonly timestamp: string
  readonly sampleId: string | null
  readonly label: string
  /** Normalized UI value from 0 to 1; null means unavailable. */
  readonly confidence: number | null
  readonly modelName: string | null
  readonly times: EventTimes
}

export interface AlertEvent {
  readonly id: string
  readonly timestamp: string
  readonly sourceIp: string | null
  readonly description: string
  readonly severity: 'critical' | 'high' | 'medium' | null
  readonly confirmed: boolean
  readonly times: EventTimes
}

export type MitigationStatus =
  | 'requested'
  | 'confirmed'
  | 'verified'
  | 'dropping'
  | 'removed'
  | 'removed_idle'
  | 'cleaned'
  | 'unknown'
  | 'pending'
  | 'installed'
  | 'expired'
  | 'failed'

export interface MitigationEvidence {
  readonly reference: string
  readonly observedAt: string
  readonly source: 'controller' | 'switch'
}

export interface MitigationRule {
  readonly id: string
  readonly sourceIp: string
  readonly switchId: string
  readonly rule: string
  readonly status: MitigationStatus
  readonly evidence: MitigationEvidence | null
  readonly updatedAt: string
  readonly cookie: string | null
  readonly dpid: number | string | null
  readonly sampleId: string | null
  readonly destinationIp: string | null
  readonly ipProtocol: number | null
  readonly packetCount: number | null
  readonly byteCount: number | null
  readonly counterDelta: number | null
  readonly counterReset: boolean
  readonly counterSource: string | null
  readonly removalReason: number | null
  readonly eventId: string | null
  readonly times: EventTimes
}

export interface PolicyDecision {
  readonly id: string
  readonly sampleId: string
  readonly decision: string | null
  readonly prediction: string | null
  readonly mode: string | null
  readonly timestamp: string
  readonly times: EventTimes
}

export interface HistoryEvent {
  readonly id: string
  readonly timestamp: string
  readonly sourceIp: string | null
  readonly kind: 'detection' | 'mitigation' | 'system'
  readonly description: string
  readonly severity: 'info' | 'warning' | 'critical'
  readonly times: EventTimes
}

export interface DashboardSnapshot {
  readonly run: RunMetadata | null
  readonly dataMode: DashboardDataMode | null
  readonly runLiveStatus: RunLiveStatus | null
  readonly runFinalizationStatus: RunFinalizationStatus
  readonly backendSnapshotReceivedAt: string | null
  /** Browser receipt time of the last snapshot/event, never page load. */
  readonly receivedAt: string | null
  readonly predictionCount: number | null
  readonly policies: PolicyDecision[]
  readonly mitigationsComplete: boolean
  readonly network: {
    readonly throughputMbps: number | null
    readonly packetsPerSecond: number | null
    readonly activeAlerts: number | null
    readonly verifiedSources: number | null
    readonly traffic: TrafficPoint[]
  }
  readonly detection: Detection | null
  readonly alerts: AlertEvent[]
  readonly mitigations: MitigationRule[]
  readonly history: HistoryEvent[]
  readonly performance: {
    readonly detectionMs: number | null
    readonly mitigationMs: number | null
    readonly roundTripMs: number | null
  }
  readonly services: {
    readonly dashboardApi: ServiceState
    readonly ai: ServiceState
    readonly ryu: ServiceState
    readonly websocket: ServiceState
  }
}

export interface DashboardContextValue {
  readonly snapshot: DashboardSnapshot
  readonly runs: readonly DashboardRunOption[]
  readonly liveDiscovery: LiveRunDiscovery | null
  readonly selectedRunId: string
  readonly requestedDataMode: DashboardDataMode
  readonly runsLoading: boolean
  readonly snapshotLoading: boolean
  readonly error: string | null
  setSelectedRunId(runId: string): void
  selectLiveRun(runId: string): void
  setRequestedDataMode(mode: DashboardDataMode): void
  loadSnapshot(): void
  refreshRuns(): void
}
