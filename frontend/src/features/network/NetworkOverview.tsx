import { lazy, Suspense, useMemo } from 'react'
import { ChartNoAxesCombined } from 'lucide-react'
import { EmptyState, Panel } from '../../components/ui'
import type { DropCounterPoint } from '../../types/dashboard'

const DropCounterChart = lazy(() => import('./DropCounterChart'))

export function NetworkOverview({
  dropCounters,
  dropCounterSampleCount,
  dropCounterHistoryComplete,
}: {
  dropCounters: readonly DropCounterPoint[]
  dropCounterSampleCount: number | null
  dropCounterHistoryComplete: boolean
}) {
  const latestDropCounters = useMemo(() => {
    const latest = new Map<string, DropCounterPoint>()
    for (const point of dropCounters) {
      const key = `${point.dpid}:${point.cookie}`
      const previous = latest.get(key)
      if (!previous || Date.parse(point.timestamp) >= Date.parse(previous.timestamp)) {
        latest.set(key, point)
      }
    }
    return [...latest.values()]
      .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
      .slice(0, 6)
  }, [dropCounters])

  return (
    <Panel
      id="network"
      className="network-panel drop-counter-panel"
      title="DROP Counter Timeline"
      kicker="BẰNG CHỨNG FLOW STATS"
      subtitle="Packet counter lũy kế theo từng DPID/cookie; không phải tổng traffic PPS."
      action={
        <span className="drop-counter-sample-count">
          {dropCounterSampleCount === null ? 'Chưa có số mẫu' : `${dropCounterSampleCount} mẫu verified`}
          {!dropCounterHistoryComplete && dropCounters.length > 0
            ? ' · đang hiển thị tối đa 500 mẫu gần nhất'
            : ''}
        </span>
      }
    >
      <div className={`drop-counter-chart ${dropCounters.length ? '' : 'drop-counter-chart-empty'}`}>
        {dropCounters.length > 0 ? (
          <Suspense fallback={<div role="status">Đang tải biểu đồ…</div>}>
            <DropCounterChart points={dropCounters} />
          </Suspense>
        ) : (
          <EmptyState
            icon={ChartNoAxesCombined}
            title="Chưa có counter DROP hợp lệ"
            description="Cần b8_drop_counter từ verified_flow_stats, có cookie, DPID và timestamp."
          />
        )}
      </div>
      {latestDropCounters.length > 0 && (
        <ul className="drop-counter-latest" aria-label="Counter DROP mới nhất theo cookie">
          {latestDropCounters.map((point) => (
            <li key={`${point.dpid}:${point.cookie}`}>
              <span className="mono">{point.cookie} · DPID {point.dpid}</span>
              <span>{point.packetCount.toLocaleString('en-US')} packets lũy kế</span>
              <small>
                {point.counterReset
                  ? 'reset; delta không khả dụng'
                  : point.delta === null
                    ? 'delta chưa có mẫu trước'
                    : `Δ ${point.delta.toLocaleString('en-US')} packets`}
              </small>
            </li>
          ))}
        </ul>
      )}
      <div className="panel-bottom">
        <span>
          packet_count là counter lũy kế; delta là mức tăng giữa hai mẫu hợp lệ.
          delta = 0 không có nghĩa cả run không DROP gói nào. Không cộng lặp mẫu hay coi đây là PPS/băng thông toàn mạng.
        </span>
      </div>
    </Panel>
  )
}
