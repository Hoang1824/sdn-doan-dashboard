import type { HistoryEvent } from '../types/dashboard'

export const MAX_REPLAY_HISTORY_CACHE_ENTRIES = 12
export const MAX_REPLAY_HISTORY_CACHE_EVENTS = 500
export const MAX_REPLAY_HISTORY_CACHE_CURSORS = 200
export const MAX_REPLAY_HISTORY_SEARCH_PAGES = 200

export type ReplayHistorySearchStatus = 'searching' | 'complete' | 'partial' | 'cancelled'

export interface ReplayHistorySearchCacheEntry {
  readonly runId: string
  readonly dataMode: 'REPLAY'
  readonly filter: string
  readonly query: string
  readonly events: readonly HistoryEvent[]
  readonly pagesScanned: number
  readonly eventsScanned: number
  readonly status: ReplayHistorySearchStatus
  readonly message: string
  readonly nextCursor: string | null
  readonly cursorHistory: readonly string[]
  readonly resumeAllowed: boolean
}

const entries = new Map<string, ReplayHistorySearchCacheEntry>()

export function replayHistorySearchKey(
  runId: string,
  dataMode: 'REPLAY',
  filter: string,
  query: string,
): string {
  return JSON.stringify([runId, dataMode, filter, query.trim().toLocaleLowerCase('vi')])
}

export function getReplayHistorySearch(
  key: string,
): ReplayHistorySearchCacheEntry | null {
  const entry = entries.get(key)
  if (!entry) return null
  entries.delete(key)
  entries.set(key, entry)
  return entry
}

export function setReplayHistorySearch(
  key: string,
  entry: ReplayHistorySearchCacheEntry,
): void {
  const unique = new Map<string, HistoryEvent>()
  for (const event of entry.events) {
    if (!unique.has(event.id)) unique.set(event.id, event)
    if (unique.size >= MAX_REPLAY_HISTORY_CACHE_EVENTS) break
  }
  const bounded: ReplayHistorySearchCacheEntry = {
    ...entry,
    events: [...unique.values()],
    cursorHistory: entry.cursorHistory.slice(-MAX_REPLAY_HISTORY_CACHE_CURSORS),
  }
  entries.delete(key)
  entries.set(key, bounded)
  while (entries.size > MAX_REPLAY_HISTORY_CACHE_ENTRIES) {
    const oldestKey = entries.keys().next().value
    if (oldestKey === undefined) break
    entries.delete(oldestKey)
  }
}

export function clearReplayHistorySearchCache(): void {
  entries.clear()
}
