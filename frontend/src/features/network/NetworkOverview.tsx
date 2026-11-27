import { lazy, Suspense, useMemo, useState } from 'react'
import { Activity, ArrowDownLeft, ArrowUpRight, ChartNoAxesCombined } from 'lucide-react'
import { EmptyState, Panel } from '../../components/ui'
import type { TrafficPoint } from '../../types/dashboard'

const TrafficChart = lazy(() => import('./TrafficChart'))
const windows = [{ label: '5 phút', minutes: 5 }, { label: '15 phút', minutes: 15 }, { label: '1 giờ', minutes: 60 }]

export function NetworkOverview({ traffic }: { traffic: readonly TrafficPoint[] }) {
  const [minutes, setMinutes] = useState(15)
  const points = useMemo(() => {
    const valid = traffic.filter(point => Number.isFinite(Date.parse(point.timestamp)) && Number.isFinite(point.ingressMbps) && Number.isFinite(point.egressMbps) && point.ingressMbps >= 0 && point.egressMbps >= 0)
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    const latest = valid.at(-1)
    if (!latest) return []
    return valid.filter(point => Date.parse(point.timestamp) >= Date.parse(latest.timestamp) - minutes * 60_000)
  }, [traffic, minutes])

  return <Panel id="network" className="network-panel" title="Network Overview" kicker="LƯU LƯỢNG MẠNG" subtitle="Theo dõi lưu lượng vào và ra trong mạng SDN" action={
    <div className="segmented-control" role="group" aria-label="Khoảng thời gian biểu đồ">
      {windows.map(window => <button key={window.minutes} aria-pressed={minutes === window.minutes} onClick={() => setMinutes(window.minutes)}>{window.label}</button>)}
    </div>
  }>
    <div className="chart-meta"><span><Activity size={13} aria-hidden="true" /> Băng thông <span className="mono">/ Mbps</span></span><div className="chart-legend"><span><i className="legend-dot ingress" />Inbound</span><span><i className="legend-dot egress" />Outbound</span></div></div>
    <div className={`traffic-chart ${points.length ? '' : 'traffic-chart-empty'}`}>
      {points.length > 0 ? <Suspense fallback={<div role="status">Đang tải biểu đồ…</div>}>
        <TrafficChart points={points} />
      </Suspense> : <EmptyState icon={ChartNoAxesCombined} title="Chờ dữ liệu lưu lượng" description="Biểu đồ sẽ cập nhật khi hệ thống gửi mẫu đo đầu tiên." />}
    </div>
    <div className="panel-bottom chart-bottom"><span><ArrowDownLeft size={14} /> Inbound</span><span><ArrowUpRight size={14} /> Outbound</span><small>{points.length ? `${points.length} mẫu · Khoảng thời gian tính từ mẫu mới nhất` : 'Chưa nhận mẫu đo'} · UTC+7</small></div>
  </Panel>
}
