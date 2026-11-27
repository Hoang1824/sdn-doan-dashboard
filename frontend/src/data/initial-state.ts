import type { DashboardSnapshot } from '../types/dashboard.ts'

/** Unknown measurements are null. Empty collections do not imply a safe network. */
export function createInitialSnapshot(): DashboardSnapshot {
  return {
    run: null,
    dataMode: null,
    runLiveStatus: null,
    runFinalizationStatus: null,
    backendSnapshotReceivedAt: null,
    receivedAt: null,
    predictionCount: null,
    policies: [],
    mitigationsComplete: true,
    network: {
      throughputMbps: null,
      packetsPerSecond: null,
      activeAlerts: null,
      verifiedSources: null,
      traffic: [],
    },
    detection: null,
    alerts: [],
    mitigations: [],
    history: [],
    performance: {
      detectionMs: null,
      mitigationMs: null,
      roundTripMs: null,
    },
    services: {
      dashboardApi: { status: 'unconfigured', updatedAt: null },
      ai: { status: 'unconfigured', updatedAt: null },
      ryu: { status: 'unconfigured', updatedAt: null },
      websocket: { status: 'unconfigured', updatedAt: null },
    },
  }
}

export const initialSnapshot = createInitialSnapshot()
