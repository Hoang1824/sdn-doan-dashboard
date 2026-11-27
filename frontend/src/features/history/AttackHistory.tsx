import { Fragment, useId, useMemo, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, History, Search } from 'lucide-react'
import { EmptyState, Panel, StatusBadge } from '../../components/ui'
import type { DashboardDataMode, HistoryEvent } from '../../types/dashboard'

const pageSize = 6
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
}: {
  events: readonly HistoryEvent[]
  dataMode: DashboardDataMode | null
}) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('all')
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const controlId = useId()
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase('vi')
    return events.filter((event) => (
      (kind === 'all' || event.kind === kind)
      && `${event.id} ${event.sourceIp ?? ''} ${event.description}`.toLocaleLowerCase('vi').includes(search)
    )).sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0))
  }, [events, kind, query])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visibleEvents = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const hasFilters = query.trim() !== '' || kind !== 'all'

  function resetFilters() {
    setQuery('')
    setKind('all')
    setPage(1)
  }

  return (
    <Panel id="history" title="Attack History" kicker="NHẬT KÝ SỰ KIỆN"
      subtitle={dataMode === 'REPLAY'
        ? 'Tối đa 500 sự kiện Ryu/pha gần nhất từ snapshot; không phải kho lưu trữ toàn bộ event.'
        : dataMode === 'LIVE'
          ? 'Tối đa 500 sự kiện Ryu/pha gần nhất; timeline trùng lặp không được cộng vào prediction/counter.'
          : 'Chưa tải snapshot lịch sử hoặc luồng LIVE.'}
      className="history-panel"
      action={<span className="text-muted">UTC+07:00</span>}>
      <div className="table-toolbar">
        <label className="search-field" htmlFor={`${controlId}-search`}>
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Tìm lịch sử theo IP, mã hoặc nội dung sự kiện</span>
          <input id={`${controlId}-search`} type="search" value={query}
            placeholder="Tìm IP, mã hoặc nội dung sự kiện…"
            onChange={(event) => { setQuery(event.target.value); setPage(1) }} />
        </label>
        <label className="select-field" htmlFor={`${controlId}-kind`}>
          <span className="sr-only">Loại sự kiện</span>
          <select id={`${controlId}-kind`} value={kind}
            onChange={(event) => { setKind(event.target.value); setPage(1) }}>
            <option value="all">Tất cả sự kiện</option>
            <option value="detection">Phát hiện</option>
            <option value="mitigation">Giảm thiểu</option>
            <option value="system">Hệ thống</option>
          </select>
        </label>
        {hasFilters && <button type="button" className="button button-ghost" onClick={resetFilters}>Xóa bộ lọc</button>}
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
              return <Fragment key={event.id}>
                <tr>
                  <td className="mono"><time dateTime={event.timestamp}>{formatTime(event.timestamp)}</time></td>
                  <td className="mono">{event.sourceIp ?? '—'}</td>
                  <td><span>{kindLabels[event.kind]}</span><p className="text-muted event-description">{event.description}</p></td>
                  <td><StatusBadge tone={severityTones[event.severity]}>{severityLabels[event.severity]}</StatusBadge></td>
                  <td><button type="button" className="icon-button" aria-expanded={expanded}
                    aria-controls={expanded ? detailId : undefined} aria-label={`Chi tiết sự kiện ${event.id}`}
                    onClick={() => setExpandedId(expanded ? null : event.id)}>
                    <ChevronDown size={16} aria-hidden="true" style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />
                  </button></td>
                </tr>
                {expanded && <tr className="detail-row" id={detailId}><td colSpan={5}>
                  <dl className="event-details">
                    <div><dt>Mã sự kiện</dt><dd className="mono">{event.id}</dd></div>
                    <div><dt>Thời điểm B8</dt><dd className="mono">{event.times.sourceTimestamp ?? '—'}</dd></div>
                    <div><dt>Backend nhận</dt><dd className="mono">{event.times.backendReceivedAt ?? '—'}</dd></div>
                    <div><dt>Browser nhận</dt><dd className="mono">{event.times.browserReceivedAt ?? '—'}</dd></div>
                    <div><dt>Nội dung</dt><dd>{event.description}</dd></div>
                  </dl>
                </td></tr>}
              </Fragment>
            })}
            {visibleEvents.length === 0 && <tr><td colSpan={5}>
              <EmptyState icon={History}
                title={events.length === 0 ? 'Chưa có lịch sử sự kiện' : 'Không tìm thấy sự kiện phù hợp'}
                description={events.length === 0
                  ? 'Lịch sử sẽ xuất hiện khi hệ thống cung cấp các sự kiện thực tế.'
                  : 'Thử tìm kiếm theo IP khác hoặc xóa bộ lọc để xem lại các bản ghi.'} />
            </td></tr>}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <span className="text-muted" aria-live="polite">{filtered.length === 0 ? '0 bản ghi trong bảng' : `${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, filtered.length)} / ${filtered.length} bản ghi`}</span>
        <div className="pagination">
          <button type="button" className="icon-button" aria-label="Trang lịch sử trước"
            disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} aria-hidden="true" /></button>
          <span className="text-muted">{currentPage} / {pageCount}</span>
          <button type="button" className="icon-button" aria-label="Trang lịch sử tiếp theo"
            disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} aria-hidden="true" /></button>
        </div>
      </div>
    </Panel>
  )
}
