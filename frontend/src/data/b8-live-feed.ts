import {
  B8ApiError,
  B8DashboardClient,
  parseEvent,
  type B8NormalizedEvent,
  type B8SnapshotResponse,
  type B8WebSocketLike,
} from './b8-api.ts'
import type { RunFinalizationStatus, RunLiveStatus } from '../types/dashboard.ts'

export type LiveFeedStatus = 'connecting' | 'connected' | 'disconnected' | 'resyncing' | 'error'

export interface B8LiveFeedCallbacks {
  onEvent(event: B8NormalizedEvent, browserReceivedAt: string): boolean
  onSnapshot(snapshot: B8SnapshotResponse, browserReceivedAt: string): void
  onStatus(status: LiveFeedStatus, detail?: string): void
  onRunStatus?(status: RunLiveStatus): void
  onRunComplete?(status: string, finalizationStatus: Exclude<RunFinalizationStatus, null>): void
}

export interface B8LiveFeedOptions {
  readonly retryDelay?: (attempt: number) => number
  readonly schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  readonly cancel?: (timer: ReturnType<typeof setTimeout>) => void
}

const DEFAULT_RETRY_DELAY = (attempt: number) => Math.min(250 * 2 ** Math.min(attempt, 5), 8_000)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class B8LiveFeed {
  private readonly client: B8DashboardClient
  private readonly runId: string
  private readonly callbacks: B8LiveFeedCallbacks
  private cursor: string
  private socket: B8WebSocketLike | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = true
  private fatal = false
  private resyncing = false
  private retryAttempt = 0
  private readonly seenEventIds = new Set<string>()
  private readonly retryDelay: (attempt: number) => number
  private readonly schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  private readonly cancel: (timer: ReturnType<typeof setTimeout>) => void

  constructor(
    client: B8DashboardClient,
    runId: string,
    cursor: string,
    callbacks: B8LiveFeedCallbacks,
    options: B8LiveFeedOptions = {},
  ) {
    this.client = client
    this.runId = runId
    this.cursor = cursor
    this.callbacks = callbacks
    this.retryDelay = options.retryDelay ?? DEFAULT_RETRY_DELAY
    this.schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay))
    this.cancel = options.cancel ?? ((timer) => clearTimeout(timer))
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.openSocket()
  }

  stop(): void {
    this.stopped = true
    this.clearRetry()
    const socket = this.socket
    this.socket = null
    if (socket && socket.readyState < 2) socket.close(1000, 'Dashboard session stopped.')
  }

  private openSocket(): void {
    if (this.stopped || this.fatal || this.resyncing) return
    this.callbacks.onStatus('connecting')
    let socket: B8WebSocketLike
    try {
      socket = this.client.openLive(this.runId, this.cursor)
    } catch (error) {
      this.callbacks.onStatus('error', this.errorMessage(error))
      this.scheduleReconnect()
      return
    }

    this.socket = socket
    socket.onopen = () => {
      if (this.stopped || this.socket !== socket) return
      this.retryAttempt = 0
      this.callbacks.onStatus('connected')
    }
    socket.onmessage = (message) => {
      if (this.stopped || this.socket !== socket) return
      this.handleMessage(message.data)
    }
    socket.onerror = () => {
      if (!this.stopped && this.socket === socket) {
        this.callbacks.onStatus('disconnected', 'WebSocket transport error.')
      }
    }
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null
      if (this.stopped || this.fatal || this.resyncing) return
      this.callbacks.onStatus('disconnected')
      this.scheduleReconnect()
    }
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== 'string') {
      this.fail('WebSocket returned a non-text frame.')
      return
    }

    let frame: unknown
    try {
      frame = JSON.parse(data)
    } catch {
      this.fail('WebSocket returned invalid JSON.')
      return
    }
    if (!isRecord(frame) || typeof frame.type !== 'string') {
      this.fail('WebSocket frame does not match the B8 API contract.')
      return
    }

    if (frame.type === 'event') {
      try {
        const event = parseEvent(frame.event)
        if (event.run_id !== this.runId || event.data_mode !== 'LIVE') {
          throw new B8ApiError('WebSocket event does not match the selected LIVE run.')
        }
        if (this.seenEventIds.has(event.event_id)) return
        const applied = this.callbacks.onEvent(event, new Date().toISOString())
        if (!applied) {
          this.fail('Dashboard reducer did not apply the event; cursor was not advanced.')
          return
        }
        this.cursor = event.cursor
        this.seenEventIds.add(event.event_id)
        if (this.seenEventIds.size > 50_000) {
          const oldest = this.seenEventIds.values().next().value
          if (typeof oldest === 'string') this.seenEventIds.delete(oldest)
        }
      } catch (error) {
        this.fail(this.errorMessage(error))
      }
      return
    }

    if (frame.type === 'heartbeat') {
      if (typeof frame.cursor !== 'string' || frame.data_mode !== 'LIVE') {
        this.fail('Invalid B8 heartbeat frame.')
        return
      }
      this.cursor = frame.cursor
      return
    }

    if (frame.type === 'run_status') {
      try {
        const status = frame.status
        const freshness = frame.freshness
        const lastActivityAt = frame.last_activity_at
        const lastActivityStream = frame.last_activity_stream
        const ageSeconds = frame.age_seconds
        const freshnessSeconds = frame.freshness_seconds
        if (
          (status !== null && typeof status !== 'string') ||
          typeof frame.terminal !== 'boolean' ||
          typeof frame.eligible !== 'boolean' ||
          !['fresh', 'stale', 'no_activity', 'clock_skew', 'unknown'].includes(String(freshness)) ||
          (lastActivityAt !== null && typeof lastActivityAt !== 'string') ||
          (lastActivityStream !== null && typeof lastActivityStream !== 'string') ||
          (ageSeconds !== null && (typeof ageSeconds !== 'number' || !Number.isFinite(ageSeconds))) ||
          typeof freshnessSeconds !== 'number' ||
          !Number.isFinite(freshnessSeconds)
        ) {
          throw new B8ApiError('Invalid B8 run_status frame.')
        }
        this.callbacks.onRunStatus?.({
          status,
          terminal: frame.terminal,
          freshness: freshness as RunLiveStatus['freshness'],
          eligible: frame.eligible,
          lastActivityAt,
          lastActivityStream,
          ageSeconds,
          freshnessSeconds,
        })
      } catch (error) {
        this.fail(this.errorMessage(error))
      }
      return
    }

    if (frame.type === 'run_complete') {
      const terminalStatuses = ['aborted', 'cancelled', 'canceled', 'complete', 'completed', 'failed']
      if (
        typeof frame.status !== 'string' ||
        !terminalStatuses.includes(frame.status.trim().toLowerCase()) ||
        typeof frame.cursor !== 'string' ||
        frame.cursor.length === 0 ||
        (frame.finalization_status !== 'confirmed' && frame.finalization_status !== 'timeout')
      ) {
        this.fail('Invalid B8 run_complete frame.')
        return
      }
      this.stopped = true
      this.clearRetry()
      const socket = this.socket
      this.socket = null
      this.callbacks.onRunComplete?.(frame.status, frame.finalization_status)
      socket?.close(1000, 'Run completed.')
      return
    }

    if (frame.type === 'resync_required') {
      void this.resync()
      return
    }

    if (frame.type === 'source_error') {
      const detail = typeof frame.detail === 'string' ? frame.detail : 'B8 log source reported an error.'
      this.fail(detail)
      return
    }

    if (frame.type === 'replay_complete') {
      this.fail('Unexpected replay_complete frame on a LIVE subscription.')
      return
    }

    this.fail(`Unsupported B8 WebSocket frame: ${frame.type}.`)
  }

  private async resync(): Promise<void> {
    if (this.stopped || this.resyncing) return
    this.resyncing = true
    this.clearRetry()
    this.callbacks.onStatus('resyncing')
    this.socket?.close(1012, 'Snapshot resync required.')
    this.socket = null
    try {
      const snapshot = await this.client.getSnapshot(this.runId, 'LIVE')
      if (this.stopped) return
      if (snapshot.run_id !== this.runId || snapshot.data_mode !== 'LIVE') {
        throw new B8ApiError('Resync snapshot does not match the selected LIVE run.')
      }
      this.callbacks.onSnapshot(snapshot, new Date().toISOString())
      this.cursor = snapshot.as_of_cursor
      this.seenEventIds.clear()
      this.retryAttempt = 0
      this.resyncing = false
      this.openSocket()
    } catch (error) {
      this.resyncing = false
      if (this.stopped) return
      this.callbacks.onStatus('error', this.errorMessage(error))
      this.scheduleResync()
    }
  }

  private fail(detail: string): void {
    this.fatal = true
    this.callbacks.onStatus('error', detail)
    this.socket?.close(1011, 'Invalid B8 WebSocket stream.')
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.fatal || this.timer !== null) return
    const delay = this.retryDelay(this.retryAttempt)
    this.retryAttempt += 1
    this.timer = this.schedule(() => {
      this.timer = null
      this.openSocket()
    }, delay)
  }

  private scheduleResync(): void {
    if (this.stopped || this.timer !== null) return
    const delay = this.retryDelay(this.retryAttempt)
    this.retryAttempt += 1
    this.timer = this.schedule(() => {
      this.timer = null
      void this.resync()
    }, delay)
  }

  private clearRetry(): void {
    if (this.timer !== null) this.cancel(this.timer)
    this.timer = null
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'B8 WebSocket connection failed.'
  }
}
