import { Gauge, Timer, Workflow, Radio } from 'lucide-react'
import { Panel } from '../../components/ui'
import { formatMetric } from '../../data/presentation'
import type { DashboardSnapshot } from '../../types/dashboard'

export function PerformancePanel({ performance }: { performance: DashboardSnapshot['performance'] }) {
  const metrics = [
    { icon: Timer, title: 'Detection latency', description: 'Chưa có packet-first-seen và timestamp suy luận cùng cơ sở đo.', value: performance.detectionMs },
    {
      icon: Workflow,
      title: 'Request → first verified counter',
      description: performance.mitigationSampleCount === null
        ? 'Cần timestamp Ryu khớp DPID/cookie và counter verified_flow_stats.'
        : `${performance.mitigationSampleCount} luật có đủ timestamp; gồm chu kỳ lấy mẫu, không phải thời gian cài luật.`,
      value: performance.mitigationMs,
    },
    { icon: Radio, title: 'Round-trip time', description: 'Chưa có cặp timestamp request/response đo RTT.', value: performance.roundTripMs },
  ]
  return <Panel id="performance" title="Performance" kicker="HIỆU NĂNG HỆ THỐNG" action={<Gauge size={21} className="text-muted" />}>
    <div className="performance-grid">{metrics.map(({ icon: Icon, title, description, value }) => <div className="performance-item" key={title}><Icon size={18} aria-hidden="true" /><p>{title}</p><strong>{formatMetric(value, 1)}<span>ms</span></strong><small>{description}</small></div>)}</div>
    <div className="panel-bottom"><span>Độ trễ request → counter dùng timestamp nguồn B8; không suy ra từ thời điểm browser nhận.</span></div>
  </Panel>
}
