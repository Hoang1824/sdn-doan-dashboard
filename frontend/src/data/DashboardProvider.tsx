import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DashboardContext } from './dashboard-context'
import { b8DashboardClient } from './b8-runtime'
import { B8LiveFeed, type LiveFeedStatus } from './b8-live-feed'
import { B8DashboardReducer, mapSnapshot } from './b8-read-model'
import { createInitialSnapshot } from './initial-state'
import type {
  DashboardDataMode,
  DashboardSnapshot,
  RunFinalizationStatus,
  ServiceState,
} from '../types/dashboard'

interface DashboardProviderProps {
  children: ReactNode
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function withService(
  snapshot: DashboardSnapshot,
  name: keyof DashboardSnapshot['services'],
  service: ServiceState,
): DashboardSnapshot {
  return {
    ...snapshot,
    services: { ...snapshot.services, [name]: service },
  }
}

function feedServiceStatus(status: LiveFeedStatus): ServiceState['status'] {
  return status === 'resyncing' ? 'connecting' : status
}

export function DashboardProvider({ children }: DashboardProviderProps) {
  const [snapshot, setSnapshot] = useState(createInitialSnapshot)
  const [runs, setRuns] = useState<Awaited<ReturnType<typeof b8DashboardClient.listRuns>>>([])
  const [liveDiscovery, setLiveDiscovery] = useState<Awaited<ReturnType<typeof b8DashboardClient.listRunCatalog>>['liveDiscovery']>(null)
  const [selectedRunId, updateSelectedRunId] = useState('')
  const [requestedDataMode, setRequestedDataMode] = useState<DashboardDataMode>('REPLAY')
  const [runsLoading, setRunsLoading] = useState(true)
  const [snapshotLoading, setSnapshotLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [runsRefreshKey, setRunsRefreshKey] = useState(0)
  const [loadRequest, setLoadRequest] = useState(0)
  const snapshotRef = useRef(snapshot)
  const runFinalizationRef = useRef<RunFinalizationStatus>(null)
  const reducerRef = useRef<B8DashboardReducer | null>(null)
  const renderFrameRef = useRef<number | null>(null)

  const commitSnapshot = useCallback((next: DashboardSnapshot, immediate = true) => {
    snapshotRef.current = next
    if (renderFrameRef.current !== null) {
      window.cancelAnimationFrame(renderFrameRef.current)
      renderFrameRef.current = null
    }
    if (immediate) setSnapshot(next)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    void Promise.resolve().then(() => {
      if (!active) return null
      setRunsLoading(true)
      return b8DashboardClient.listRunCatalog(controller.signal)
    }).then((result) => {
      if (!active || result === null) return
      setRuns([...result.runs])
      setLiveDiscovery(result.liveDiscovery)
      setError(null)
      const current = snapshotRef.current
      commitSnapshot(withService(current, 'dashboardApi', {
        status: 'connected',
        updatedAt: new Date().toISOString(),
      }))
    }).catch((cause: unknown) => {
      if (!active || isAbort(cause)) return
      const message = cause instanceof Error ? cause.message : 'Không thể tải danh sách run.'
      setError(message)
      commitSnapshot(withService(snapshotRef.current, 'dashboardApi', {
        status: 'error',
        updatedAt: new Date().toISOString(),
      }))
    }).finally(() => {
      if (active) {
        setRunsLoading(false)
        const timer = window.setTimeout(() => {
          if (active) setRunsRefreshKey((current) => current + 1)
        }, 5_000)
        controller.signal.addEventListener('abort', () => window.clearTimeout(timer), { once: true })
      }
    })
    return () => {
      active = false
      controller.abort()
    }
  }, [commitSnapshot, runsRefreshKey])

  useEffect(() => {
    if (loadRequest === 0 || !selectedRunId) return
    const controller = new AbortController()
    let active = true
    let feed: B8LiveFeed | null = null
    void Promise.resolve().then(() => {
      if (!active) return null
      setSnapshotLoading(true)
      setError(null)
      reducerRef.current = null
      const empty = createInitialSnapshot()
      const loadingSnapshot = withService(empty, 'dashboardApi', {
        status: 'connecting',
        updatedAt: null,
      })
      commitSnapshot(withService(loadingSnapshot, 'websocket', {
        status: requestedDataMode === 'LIVE' ? 'connecting' : 'disconnected',
        updatedAt: null,
      }))
      return b8DashboardClient.getSnapshot(
        selectedRunId,
        requestedDataMode,
        controller.signal,
      )
    }).then((wireSnapshot) => {
      if (!active || wireSnapshot === null) return
      if (wireSnapshot.run_id !== selectedRunId || wireSnapshot.data_mode !== requestedDataMode) {
        throw new Error('Backend snapshot does not match the selected run and data mode.')
      }
      const receivedAt = new Date().toISOString()
      const mapped = {
        ...mapSnapshot(wireSnapshot, receivedAt),
        runFinalizationStatus: runFinalizationRef.current,
      }
      reducerRef.current = new B8DashboardReducer(mapped)
      commitSnapshot(mapped)
      setSnapshotLoading(false)

      if (wireSnapshot.data_mode !== 'LIVE') return

      feed = new B8LiveFeed(
        b8DashboardClient,
        selectedRunId,
        wireSnapshot.as_of_cursor,
        {
          onEvent: (event, browserReceivedAt) => {
            if (!active || !reducerRef.current) return false
            const next = reducerRef.current.apply(event, browserReceivedAt)
            if (!next) return false
            snapshotRef.current = next
            if (renderFrameRef.current === null) {
              renderFrameRef.current = window.requestAnimationFrame(() => {
                renderFrameRef.current = null
                if (active) setSnapshot(snapshotRef.current)
              })
            }
            return true
          },
          onSnapshot: (resynced, browserReceivedAt) => {
            if (!active) return
            const next = {
              ...mapSnapshot(resynced, browserReceivedAt),
              runFinalizationStatus: runFinalizationRef.current,
            }
            reducerRef.current = new B8DashboardReducer(next)
            commitSnapshot(next)
          },
          onRunStatus: (status) => {
            if (!active) return
            commitSnapshot({
              ...snapshotRef.current,
              runLiveStatus: status,
              alerts: status.terminal
                ? snapshotRef.current.alerts.map((alert) => ({ ...alert, scope: 'historical' }))
                : snapshotRef.current.alerts,
              receivedAt: new Date().toISOString(),
            })
          },
          onRunComplete: (status, finalizationStatus) => {
            if (!active) return
            runFinalizationRef.current = finalizationStatus
            const current = snapshotRef.current
            commitSnapshot({
              ...current,
              runLiveStatus: current.runLiveStatus
                ? { ...current.runLiveStatus, status, terminal: true, eligible: false }
                : current.runLiveStatus,
              alerts: current.alerts.map((alert) => ({ ...alert, scope: 'historical' })),
            })
            setRequestedDataMode('REPLAY')
          },
          onStatus: (status, detail) => {
            if (!active) return
            const next = withService(snapshotRef.current, 'websocket', {
              status: feedServiceStatus(status),
              updatedAt: new Date().toISOString(),
            })
            commitSnapshot(next)
            if (status === 'error') setError(detail ?? 'WebSocket B8 gặp lỗi.')
            else if (status === 'connected') setError(null)
          },
        },
      )
      feed.start()
    }).catch((cause: unknown) => {
      if (!active || isAbort(cause)) return
      const message = cause instanceof Error ? cause.message : 'Không thể tải snapshot B8.'
      setError(message)
      setSnapshotLoading(false)
      reducerRef.current = null
      const failed = withService(snapshotRef.current, 'dashboardApi', {
        status: 'error',
        updatedAt: new Date().toISOString(),
      })
      commitSnapshot(withService(failed, 'websocket', {
        status: 'disconnected',
        updatedAt: new Date().toISOString(),
      }))
    })

    return () => {
      active = false
      controller.abort()
      feed?.stop()
      if (renderFrameRef.current !== null) {
        window.cancelAnimationFrame(renderFrameRef.current)
        renderFrameRef.current = null
      }
    }
  }, [commitSnapshot, loadRequest, requestedDataMode, selectedRunId])

  const setSelectedRunId = useCallback((runId: string) => {
    runFinalizationRef.current = null
    updateSelectedRunId(runId)
    setRequestedDataMode('REPLAY')
    setError(null)
  }, [])

  const selectLiveRun = useCallback((runId: string) => {
    const candidate = runs.find((run) => run.runId === runId && run.live?.eligible)
    if (!candidate) return
    runFinalizationRef.current = null
    updateSelectedRunId(runId)
    setRequestedDataMode('LIVE')
    setError(null)
    setLoadRequest((current) => current + 1)
  }, [runs])

  const loadSnapshot = useCallback(() => {
    if (selectedRunId) {
      if (requestedDataMode === 'LIVE') runFinalizationRef.current = null
      setLoadRequest((current) => current + 1)
    }
  }, [requestedDataMode, selectedRunId])

  const refreshRuns = useCallback(() => {
    setRunsRefreshKey((current) => current + 1)
  }, [])

  useEffect(() => () => {
    if (renderFrameRef.current !== null) window.cancelAnimationFrame(renderFrameRef.current)
  }, [])

  const value = useMemo(() => ({
    snapshot,
    runs,
    liveDiscovery,
    selectedRunId,
    requestedDataMode,
    runsLoading,
    snapshotLoading,
    error,
    setSelectedRunId,
    selectLiveRun,
    setRequestedDataMode,
    loadSnapshot,
    refreshRuns,
  }), [
    snapshot,
    runs,
    liveDiscovery,
    selectedRunId,
    requestedDataMode,
    runsLoading,
    snapshotLoading,
    error,
    setSelectedRunId,
    selectLiveRun,
    loadSnapshot,
    refreshRuns,
  ])

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>
}
