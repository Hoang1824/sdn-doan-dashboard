import { Gauge, Timer, Workflow, Radio } from 'lucide-react'
import { Panel } from '../../components/ui'
import { formatMetric } from '../../data/presentation'
import type { DashboardSnapshot } from '../../types/dashboard'

export function PerformancePanel({ performance }: { performance: DashboardSnapshot['performance'] }) {
  const metrics = [
    { icon: Timer, title: 'Detection latency', description: 'Độ trễ phát hiện', value: performance.detectionMs },
    { icon: Workflow, title: 'Mitigation latency', description: 'Độ trễ giảm thiểu', value: performance.mitigationMs },
    { icon: Radio, title: 'Round-trip time', description: 'Thời gian khứ hồi', value: performance.roundTripMs },
  ]
  return <Panel id="performance" title="Performance" kicker="HIỆU NĂNG HỆ THỐNG" action={<Gauge size={21} className="text-muted" />}>
    <div className="performance-grid">{metrics.map(({ icon: Icon, title, description, value }) => <div className="performance-item" key={title}><Icon size={18} aria-hidden="true" /><p>{title}</p><strong>{formatMetric(value, 1)}<span>ms</span></strong><small>{description}</small></div>)}</div>
    <div className="panel-bottom"><span>Các chỉ số chỉ hiển thị khi có kết quả đo từ hệ thống.</span></div>
  </Panel>
}
