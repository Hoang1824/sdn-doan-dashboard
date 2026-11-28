import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, History, Search } from 'lucide-react'
import { EmptyState, Panel, StatusBadge } from '../../components/ui'
import { useDashboard } from '../../data/useDashboard'
import type { DashboardDataMode, HistoryEvent, HistoryEventPage } from '../../types/dashboard'

const pageSize = 6
const maxHistorySearchPages = 200
const maxHistorySearchResults = 500
const filters = [
  { value: 'all', label: 'Tất cả' },
  { value: 'ai_attack', label: 'AI Attack Detection' },
  { value: 'ryu_policy', label: 'Ryu Policy' },
  { value: 'drop_control', label: 'DROP Requested / Confirmed' },
  { value: 'verified_counter', label: 'Verified DROP Counter' },
  { value: 'removed_cleaned', label: 'Removed / Cleaned' },
] as const
type TimelineFilter = (typeof filters)[number]['value']
type SearchProgress = {
  readonly status: 'searching' | 'complete' | 'partial' | 'cancelled'
  readonly pagesScanned: number
  readonly eventsScanned: number
  readonly message: string
}

const kindLabels: Record<HistoryEvent['kind'], string> = {
  detection: 'Phát hiện',
  mitigation: 'Giảm thiểu',
  system: 'Hệ thống',
}
const severityLabels: Record<HistoryEvent['severity'], string> = {
  info: 'Thông tin',
  warning: 'Cảnh báo',
  critical: 'Nghiêm trọng',
}
const severityTones = { info: 'cyan', warning: 'amber', critical: 'red' } as const
const confirmedDropStatuses = new Set([
  'confirmed',
  'verified',
  'dropping',
  'removed',
  'removed_idle',
  'cleaned',
])

function matchesTimelineEvent(
  event: HistoryEvent,
  filter: TimelineFilter,
  query: string,
): boolean {
  const search = query.trim().toLocaleLowerCase('vi')
  return (filter === 'all' || event.timelineCategory === filter)
    && `${event.id} ${event.sourceIp ?? ''} ${event.description}`
      .toLocaleLowerCase('vi')
      .includes(search)
}

function uniqueHistoryEvents(events: readonly HistoryEvent[]): HistoryEvent[] {
  const unique = new Map<string, HistoryEvent>()
  for (const event of events) {
    if (!unique.has(event.id)) unique.set(event.id, event)
  }
  return [...unique.values()]
}

function formatTime(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh', hour12: false,
  }).format(date)
}

export function AttackHistory({
  events,
  dataMode,
  runId,
}: {
  events: readonly HistoryEvent[]
  dataMode: DashboardDataMode | null
  runId: string | null
}) {
  const { loadHistoryPage, snapshot } = useDashboard()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<TimelineFilter>('all')
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [apiPage, setApiPage] = useState<HistoryEventPage | null>(null)
  const [historySearchEvents, setHistorySearchEvents] = useState<HistoryEvent[] | null>(null)
  const [searchProgress, setSearchProgress] = useState<SearchProgress | null>(null)
  const [apiCursors, setApiCursors] = useState<Array<string | null>>([null])
  const [apiPageIndex, setApiPageIndex] = useState(0)
  const [apiLoading, setApiLoading] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const requestId = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const searchRequestId = useRef(0)
  const searchAbortRef = useRef<AbortController | null>(null)
  const controlId = useId()
  const usingApi = apiPage !== null
  const usingSearch = historySearchEvents !== null
  const sourceEvents = historySearchEvents ?? apiPage?.events ?? events
  const snapshotForRun = snapshot.run?.runId === runId ? snapshot : null
  const attackSnapshotEvents = snapshotForRun?.alerts
    .filter((event) => event.category === 'attack_prediction') ?? []
  const confirmedDropRules = snapshotForRun?.mitigations.filter((rule) => (
    rule.rule.trim().toUpperCase() === 'DROP' && confirmedDropStatuses.has(rule.status)
  )) ?? []
  const snapshotStatus = snapshotForRun?.run?.status
  const terminalSnapshot = snapshotStatus !== null
    && snapshotStatus !== undefined
    && ['aborted', 'cancelled', 'canceled', 'complete', 'completed', 'failed']
      .includes(snapshotStatus.trim().toLowerCase())
  const isSearchingAllHistory = searchProgress?.status === 'searching'

  useEffect(() => () => {
    requestId.current += 1
    abortRef.current?.abort()
    searchRequestId.current += 1
    searchAbortRef.current?.abort()
  }, [])

  const filtered = useMemo(() => {
    return sourceEvents
      .filter((event) => matchesTimelineEvent(event, filter, query))
      .sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0))
  }, [filter, query, sourceEvents])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visibleEvents = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const hasFilters = query.trim() !== '' || filter !== 'all'
  const canLoadApiHistory = dataMode === 'REPLAY' && runId !== null

  function invalidateHistorySearch() {
    searchAbortRef.current?.abort()
    searchRequestId.current += 1
    setHistorySearchEvents(null)
    setSearchProgress(null)
  }

  async function loadApiPage(index: number, cursor: string | null) {
    if (!canLoadApiHistory || !runId) return
    invalidateHistorySearch()
    if (cursor !== null && apiCursors.slice(0, index).includes(cursor)) {
      setApiError('Cursor đã được dùng cho trang trước; dừng duyệt để tránh lặp dữ liệu.')
      return
    }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const currentRequest = ++requestId.current
    setApiLoading(true)
    setApiError(null)
    try {
      const result = await loadHistoryPage(runId, cursor, controller.signal)
      if (requestId.current !== currentRequest) return
      const uniqueEvents = uniqueHistoryEvents(result.events)
      const cursorRepeats = result.hasMore
        && (result.nextCursor === cursor || apiCursors.slice(0, index + 1).includes(result.nextCursor))
      setApiPage({ ...result, events: uniqueEvents })
      setApiPageIndex(index)
      setApiCursors((current) => {
        const next = current.slice(0, index + 1)
        if (result.hasMore && !cursorRepeats) next[index + 1] = result.nextCursor
        return next
      })
      if (cursorRepeats) {
        setApiError('API trả cursor lặp; đã dừng duyệt để tránh tải trùng hoặc lặp vô hạn.')
      }
      setPage(1)
      setExpandedId(null)
    } catch (cause) {
      if (controller.signal.aborted || requestId.current !== currentRequest) return
      setApiError(cause instanceof Error ? cause.message : 'Không thể tải trang lịch sử B8.')
    } finally {
      if (requestId.current === currentRequest) setApiLoading(false)
    }
  }

  async function searchWholeHistory() {
    if (!canLoadApiHistory || !runId || !hasFilters) return
    searchAbortRef.current?.abort()
    const controller = new AbortController()
    searchAbortRef.current = controller
    const currentRequest = ++searchRequestId.current
    const seenCursors = new Set<string>()
    const seenEventIds = new Set<string>()
    const matches: HistoryEvent[] = []
    let cursor: string | null = null
    let pagesScanned = 0
    let eventsScanned = 0
    let resultLimitReached = false

    setHistorySearchEvents([])
    setSearchProgress({
      status: 'searching',
      pagesScanned: 0,
      eventsScanned: 0,
      message: 'Đang quét lịch sử REPLAY từ đầu…',
    })
    setPage(1)
    setExpandedId(null)

    try {
      while (pagesScanned < maxHistorySearchPages) {
        if (controller.signal.aborted || searchRequestId.current !== currentRequest) return
        if (cursor !== null && seenCursors.has(cursor)) {
          setSearchProgress({
            status: 'partial',
            pagesScanned,
            eventsScanned,
            message: 'Tìm kiếm một phần: API trả cursor đã dùng; đã dừng để tránh vòng lặp.',
          })
          return
        }
        if (cursor !== null) seenCursors.add(cursor)

        const result = await loadHistoryPage(runId, cursor, controller.signal)
        if (controller.signal.aborted || searchRequestId.current !== currentRequest) return
        pagesScanned += 1

        for (const event of result.events) {
          if (seenEventIds.has(event.id)) continue
          seenEventIds.add(event.id)
          eventsScanned += 1
          if (!matchesTimelineEvent(event, filter, query)) continue
          if (matches.length < maxHistorySearchResults) matches.push(event)
          else resultLimitReached = true
        }

        setHistorySearchEvents([...matches])
        setSearchProgress({
          status: 'searching',
          pagesScanned,
          eventsScanned,
          message: `Đã quét ${pagesScanned} trang, ${eventsScanned} event Ryu/phase.`,
        })

        if (resultLimitReached) {
          setSearchProgress({
            status: 'partial',
            pagesScanned,
            eventsScanned,
            message: `Tìm kiếm một phần: đạt giới hạn ${maxHistorySearchResults} kết quả phù hợp.`,
          })
          return
        }
        if (!result.hasMore) {
          setSearchProgress({
            status: 'complete',
            pagesScanned,
            eventsScanned,
            message: `Đã quét hết ${pagesScanned} trang (${eventsScanned} event Ryu/phase).`,
          })
          return
        }
        if (
          result.nextCursor === cursor
          || seenCursors.has(result.nextCursor)
        ) {
          setSearchProgress({
            status: 'partial',
            pagesScanned,
            eventsScanned,
            message: 'Tìm kiếm một phần: API trả cursor lặp; đã dừng để tránh vòng lặp.',
          })
          return
        }
        cursor = result.nextCursor
      }

      setSearchProgress({
        status: 'partial',
        pagesScanned,
        eventsScanned,
        message: `Tìm kiếm một phần: đạt giới hạn ${maxHistorySearchPages} trang.`,
      })
    } catch (cause) {
      if (controller.signal.aborted || searchRequestId.current !== currentRequest) return
      setSearchProgress({
        status: 'partial',
        pagesScanned,
        eventsScanned,
        message: `Tìm kiếm một phần; lỗi khi tải API: ${cause instanceof Error ? cause.message : 'lỗi không xác định'}`,
      })
    }
  }

  function cancelWholeHistorySearch() {
    if (!isSearchingAllHistory) return
    searchAbortRef.current?.abort()
    searchRequestId.current += 1
    setSearchProgress((current) => current ? {
      ...current,
      status: 'cancelled',
      message: `Đã hủy sau ${current.pagesScanned} trang (${current.eventsScanned} event Ryu/phase); kết quả hiện có là một phần.`,
    } : current)
  }

  function resetFilters() {
    invalidateHistorySearch()
    setQuery('')
    setFilter('all')
    setPage(1)
  }

  function showSnapshotHistory() {
    invalidateHistorySearch()
    abortRef.current?.abort()
    requestId.current += 1
    setApiPage(null)
    setApiCursors([null])
    setApiPageIndex(0)
    setApiError(null)
    setPage(1)
  }

  const nextCursor = apiPageIndex + 1 < apiCursors.length
    ? apiCursors[apiPageIndex + 1]
    : apiPage?.nextCursor ?? null
  const nextCursorRepeats = apiPage?.hasMore === true
    && apiCursors.slice(0, apiPageIndex + 1).includes(apiPage.nextCursor)
  const canGoNextApiPage = apiPage !== null
    && (apiPageIndex + 1 < apiCursors.length || (apiPage.hasMore && !nextCursorRepeats))
  const displayedSourceCount = sourceEvents.length

  return (
    <Panel
      id="history"
      title="Event Timeline"
      kicker="AI → RYU → OPENFLOW / OVS"
      subtitle={usingSearch
        ? 'Kết quả tìm kiếm trên các trang REPLAY đã quét; không phải luồng LIVE.'
        : usingApi
        ? `Lịch sử REPLAY phân trang từ API · trang ${apiPageIndex + 1}`
        : dataMode === 'REPLAY'
          ? 'Snapshot hiển thị tối đa 500 event gần nhất; có thể duyệt thêm toàn bộ nguồn qua API.'
          : dataMode === 'LIVE'
            ? 'Event mới theo cursor; buffer giới hạn 500 event gần nhất, không suy luận sự kiện ngoài phạm vi này.'
            : 'Chưa tải snapshot lịch sử hoặc luồng LIVE.'}
      className="history-panel"
      action={<span className="text-muted">UTC+07:00</span>}
    >
      <div className="history-source-controls">
        {usingSearch ? (
          <>
            <button
              type="button"
              className="button button-ghost"
              disabled={isSearchingAllHistory}
              onClick={() => {
                setHistorySearchEvents(null)
                setSearchProgress(null)
                setPage(1)
              }}
            >
              Quay lại trang/snapshot
            </button>
            {searchProgress && (
              <span role="status" aria-live="polite">
                {searchProgress.message} · tìm thấy {historySearchEvents.length} event phù hợp
              </span>
            )}
            {isSearchingAllHistory && (
              <button
                type="button"
                className="button button-ghost"
                onClick={cancelWholeHistorySearch}
              >
                Hủy tìm kiếm
              </button>
            )}
          </>
        ) : usingApi ? (
          <>
            <button type="button" className="button button-ghost" onClick={showSnapshotHistory}>
              Trở về snapshot gần nhất
            </button>
            <span>
              Trang API {apiPageIndex + 1} · {displayedSourceCount} event Ryu/phase
              {apiPage.hasMore ? ' · còn dữ liệu' : ' · hết dữ liệu hiện có'}
            </span>
            <button
              type="button"
              className="button button-ghost"
              disabled={!hasFilters || apiLoading}
              onClick={() => void searchWholeHistory()}
            >
              Tìm trên toàn bộ REPLAY
            </button>
            <div className="history-api-pagination">
              <button
                type="button"
                className="button button-ghost"
                disabled={apiLoading || apiPageIndex === 0}
                onClick={() => {
                  const previousIndex = apiPageIndex - 1
                  void loadApiPage(previousIndex, apiCursors[previousIndex])
                }}
              >
                Trang API trước
              </button>
              <button
                type="button"
                className="button button-ghost"
                disabled={apiLoading || !canGoNextApiPage || nextCursor === null}
                onClick={() => void loadApiPage(apiPageIndex + 1, nextCursor)}
              >
                Trang API tiếp theo
              </button>
            </div>
          </>
        ) : (
          <>
            <span>
              {dataMode === 'REPLAY'
                ? 'Snapshot là cửa sổ gần nhất, không đại diện đầy đủ cho toàn run.'
                : 'LIVE hiển thị buffer sự kiện gần nhất.'}
            </span>
            {canLoadApiHistory && (
              <>
                <button
                  type="button"
                  className="button button-ghost"
                  disabled={apiLoading}
                  onClick={() => void loadApiPage(0, null)}
                >
                  {apiLoading ? 'Đang tải lịch sử…' : 'Duyệt lịch sử API từ đầu'}
                </button>
                <button
                  type="button"
                  className="button button-ghost"
                  disabled={!hasFilters || apiLoading}
                  onClick={() => void searchWholeHistory()}
                >
                  Tìm trên toàn bộ REPLAY
                </button>
              </>
            )}
          </>
        )}
      </div>
      {snapshotForRun && (
        <details className="history-important">
          <summary>
            Các sự kiện quan trọng · {snapshotForRun.dataMode} snapshot
          </summary>
          <p className="history-important-note">
            Tổng prediction là số liệu tổng hợp từ snapshot. Các dòng attack bên dưới là alert event thật;
            DROP là tóm tắt trạng thái rule, không phải event được dựng thêm.
          </p>
          <div className="history-important-grid">
            <section>
              <h3>AI attack predictions · tổng hợp snapshot</h3>
              {snapshotForRun.predictionClassCounts ? (
                <p className="mono">
                  syn_flood {snapshotForRun.predictionClassCounts.syn_flood.toLocaleString('en-US')}
                  {' · '}udp_flood {snapshotForRun.predictionClassCounts.udp_flood.toLocaleString('en-US')}
                  {' · '}tổng attack {(snapshotForRun.predictionClassCounts.syn_flood
                    + snapshotForRun.predictionClassCounts.udp_flood).toLocaleString('en-US')}
                </p>
              ) : <p>Chưa có histogram prediction trong snapshot.</p>}
              <h4>Attack event có trong snapshot</h4>
              <p className="text-muted">
                {snapshotForRun.alertHistoryComplete
                  ? `${attackSnapshotEvents.length} event trong lịch sử alert snapshot.`
                  : `Tối đa 100 alert event gần nhất; tổng event được báo là ${snapshotForRun.alertEventCount ?? 'chưa có dữ liệu'}.`}
              </p>
              {attackSnapshotEvents.length > 0 ? (
                <ul className="history-important-list">
                  {attackSnapshotEvents.slice(0, 20).map((event) => (
                    <li key={event.id}>
                      <span>{event.description}</span>
                      <span className="mono">{event.sourceIp ?? 'IP chưa có'} · {event.cookie ?? 'cookie chưa có'}</span>
                      <small>{event.timestamp ? formatTime(event.timestamp) : 'Thời điểm không có trong event'}</small>
                      <small className="mono">event_id {event.id}</small>
                    </li>
                  ))}
                </ul>
              ) : <p>Snapshot không chứa attack alert event trong cửa sổ hiện tại.</p>}
            </section>
            <section>
              <h3>DROP rules · tóm tắt từ trạng thái snapshot</h3>
              <p className="text-muted">
                {snapshotForRun.mitigationsComplete
                  ? `${confirmedDropRules.length} rule DROP có lifecycle đã xác nhận.`
                  : 'Danh sách rule snapshot bị giới hạn; tổng bên dưới có thể chưa đầy đủ.'}
              </p>
              {confirmedDropRules.length > 0 ? (
                <ul className="history-important-list">
                  {confirmedDropRules.slice(0, 20).map((rule) => (
                    <li key={rule.id}>
                      <span>{rule.sourceIp || 'IP nguồn chưa có'} · cookie {rule.cookie ?? 'chưa có'}</span>
                      <span>
                        {terminalSnapshot ? 'Final packet_count' : 'packet_count snapshot'} {rule.packetCount === null
                          ? 'chưa có dữ liệu'
                          : rule.packetCount.toLocaleString('en-US')}
                        {' · '}{rule.status.toUpperCase()}
                      </span>
                      {rule.updatedAt
                        ? <small>Source timestamp {formatTime(rule.updatedAt)}</small>
                        : <small>Source timestamp không có trong snapshot</small>}
                      {rule.eventId && <small className="mono">last_event_id {rule.eventId}</small>}
                    </li>
                  ))}
                </ul>
              ) : <p>Snapshot không có DROP rule ở trạng thái đã xác nhận.</p>}
              {confirmedDropRules.length > 20 && (
                <p className="text-muted">Chỉ hiển thị 20/{confirmedDropRules.length} rule; danh sách đầy đủ ở Mitigation.</p>
              )}
            </section>
          </div>
        </details>
      )}
      {apiError && <p className="history-api-error" role="alert">{apiError}</p>}
      <div className="table-toolbar">
        <label className="search-field" htmlFor={`${controlId}-search`}>
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Tìm lịch sử theo IP, mã hoặc nội dung sự kiện</span>
          <input
            id={`${controlId}-search`}
            type="search"
            value={query}
            placeholder="Tìm IP, mã hoặc nội dung sự kiện…"
            onChange={(event) => {
              invalidateHistorySearch()
              setQuery(event.target.value)
              setPage(1)
            }}
          />
        </label>
        {hasFilters && (
          <button type="button" className="button button-ghost" onClick={resetFilters}>
            Xóa bộ lọc
          </button>
        )}
      </div>
      <div className="segmented-control timeline-filters" role="group" aria-label="Lọc nhóm sự kiện">
        {filters.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={filter === item.value}
            onClick={() => {
              invalidateHistorySearch()
              setFilter(item.value)
              setPage(1)
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Bảng lịch sử sự kiện">
        <table className="data-table">
          <caption className="sr-only">Lịch sử sự kiện, thời gian theo múi giờ Việt Nam</caption>
          <thead><tr>
            <th scope="col">Thời gian</th><th scope="col">Nguồn</th>
            <th scope="col">Sự kiện</th><th scope="col">Mức độ</th><th scope="col">Chi tiết</th>
          </tr></thead>
          <tbody>
            {visibleEvents.map((event, index) => {
              const expanded = event.id === expandedId
              const detailId = `${controlId}-detail-${index}`
              return (
                <Fragment key={event.id}>
                  <tr>
                    <td className="mono"><time dateTime={event.timestamp}>{formatTime(event.timestamp)}</time></td>
                    <td className="mono">{event.sourceIp ?? '—'}</td>
                    <td><span>{kindLabels[event.kind]}</span><p className="text-muted event-description">{event.description}</p></td>
                    <td><StatusBadge tone={severityTones[event.severity]}>{severityLabels[event.severity]}</StatusBadge></td>
                    <td>
                      <button
                        type="button"
                        className="icon-button"
                        aria-expanded={expanded}
                        aria-controls={expanded ? detailId : undefined}
                        aria-label={`Chi tiết sự kiện ${event.id}`}
                        onClick={() => setExpandedId(expanded ? null : event.id)}
                      >
                        <ChevronDown size={16} aria-hidden="true" style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />
                      </button>
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="detail-row" id={detailId}><td colSpan={5}>
                      <dl className="event-details">
                        <div><dt>Mã sự kiện</dt><dd className="mono">{event.id}</dd></div>
                        <div><dt>Nhóm</dt><dd>{filters.find((item) => item.value === event.timelineCategory)?.label ?? 'Khác'}</dd></div>
                        <div><dt>Raw event</dt><dd className="mono">{event.rawEvent ?? '—'}</dd></div>
                        <div><dt>Sample ID</dt><dd className="mono">{event.sampleId ?? '—'}</dd></div>
                        <div><dt>Cookie / DPID</dt><dd className="mono">{event.cookie ?? '—'} / {event.dpid ?? '—'}</dd></div>
                        <div><dt>Thời điểm B8</dt><dd className="mono">{event.times.sourceTimestamp ?? '—'}</dd></div>
                        <div><dt>Backend nhận</dt><dd className="mono">{event.times.backendReceivedAt ?? '—'}</dd></div>
                        <div><dt>Browser nhận</dt><dd className="mono">{event.times.browserReceivedAt ?? '—'}</dd></div>
                        <div><dt>Nội dung</dt><dd>{event.description}</dd></div>
                      </dl>
                    </td></tr>
                  )}
                </Fragment>
              )
            })}
            {visibleEvents.length === 0 && (
              <tr><td colSpan={5}>
                <EmptyState
                  icon={History}
                  title={sourceEvents.length === 0 ? 'Không có event trong phạm vi đang xem' : 'Không tìm thấy sự kiện phù hợp'}
                  description={sourceEvents.length === 0
                    ? usingSearch
                      ? searchProgress?.status === 'complete'
                        ? 'Đã quét hết phạm vi API được báo cáo nhưng không có event khớp filter.'
                        : 'Chưa có event khớp trong phần đã quét; xem tiến độ/phạm vi tìm kiếm phía trên.'
                      : usingApi
                        ? apiPage.hasMore
                          ? 'Trang API này không có event khớp. Có thể tiếp tục sang trang API kế tiếp hoặc tìm trên toàn bộ REPLAY.'
                          : 'Trang API này không có event khớp; đây là trang cuối của history.'
                      : 'Snapshot chỉ giữ tối đa 500 event gần nhất. Duyệt lịch sử API để kiểm tra các trang còn lại.'
                    : usingSearch
                      ? searchProgress?.message ?? 'Không có kết quả trong phần lịch sử đã quét.'
                      : 'Không có event khớp trên trang/buffer hiện tại; thử trang API khác hoặc xóa bộ lọc. Đây không phải kết luận toàn run không có tấn công.'}
                  compact
                />
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <span className="text-muted" aria-live="polite">
          {filtered.length === 0
            ? usingSearch
              ? `0 kết quả trong phần đã quét${searchProgress?.status === 'complete' ? ' hết lịch sử API' : ' một phần'}`
              : usingApi
                ? `0 bản ghi khớp trên trang API ${apiPageIndex + 1}`
                : '0 bản ghi trong buffer/snapshot đang xem'
            : usingSearch
              ? `${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, filtered.length)} / ${filtered.length} kết quả đã tải${searchProgress?.status === 'complete' ? ' · đã quét hết API' : ' · phạm vi một phần'}`
              : usingApi
                ? `${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, filtered.length)} / ${filtered.length} bản ghi khớp trên trang API ${apiPageIndex + 1}`
                : `${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, filtered.length)} / ${filtered.length} bản ghi trong buffer/snapshot`}
        </span>
        <div className="pagination">
          <button
            type="button"
            className="icon-button"
            aria-label="Trang lịch sử trước"
            disabled={currentPage === 1}
            onClick={() => setPage(currentPage - 1)}
          ><ChevronLeft size={16} aria-hidden="true" /></button>
          <span className="text-muted">{currentPage} / {pageCount}</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Trang lịch sử tiếp theo"
            disabled={currentPage === pageCount}
            onClick={() => setPage(currentPage + 1)}
          ><ChevronRight size={16} aria-hidden="true" /></button>
        </div>
      </div>
    </Panel>
  )
}
