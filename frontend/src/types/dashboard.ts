/**
 * Read models for the dashboard only. These are not the AI/Ryu/FastAPI wire
 * contract. A future validated adapter must map the handed-off API into them.
 */
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

export interface TrafficPoint {
  readonly timestamp: string
  readonly ingressMbps: number
  readonly egressMbps: number
}

export interface Detection {
  readonly id: string
  readonly timestamp: string
  readonly label: string
  /** Normalized UI value from 0 to 1; null means unavailable. */
  readonly confidence: number | null
  readonly modelName: string | null
}

export interface AlertEvent {
  readonly id: string
  readonly timestamp: string
  readonly sourceIp: string
  readonly description: string
  readonly severity: 'critical' | 'high' | 'medium'
  readonly confirmed: boolean
}

export type MitigationStatus = 'pending' | 'installed' | 'verified' | 'expired' | 'failed'

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
}

export interface HistoryEvent {
  readonly id: string
  readonly timestamp: string
  readonly sourceIp: string | null
  readonly kind: 'detection' | 'mitigation' | 'system'
  readonly description: string
  readonly severity: 'info' | 'warning' | 'critical'
}

export interface DashboardSnapshot {
  /** Timestamp of actual receipt of the last snapshot/event, never page load. */
  readonly receivedAt: string | null
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
    readonly ai: ServiceState
    readonly ryu: ServiceState
    readonly websocket: ServiceState
  }
}
