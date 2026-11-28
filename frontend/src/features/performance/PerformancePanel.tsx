import { Timer } from 'lucide-react'
import { Panel } from '../../components/ui'
import { formatMetric } from '../../data/presentation'
import type { DashboardSnapshot } from '../../types/dashboard'

export function PerformancePanel({ performance }: { performance: DashboardSnapshot['performance'] }) {
  if (
    performance.mitigationMs === null
    || performance.mitigationSampleCount === null
    || performance.mitigationSampleCount === 0
  ) return null

  return (
    <Panel
      id="performance"
      title="Mitigation observation"
      kicker="PERFORMANCE · ĐO TỪ TIMESTAMP B8"
      action={<Timer size={20} className="text-muted" aria-hidden="true" />}
    >
      <div className="measured-performance">
        <strong>{formatMetric(performance.mitigationMs, 2)}<span>ms</span></strong>
        <p>Median từ mitigation request đến counter `verified_flow_stats` đầu tiên cùng DPID/cookie.</p>
        <small>{performance.mitigationSampleCount} luật đủ timestamp; bao gồm chu kỳ polling, không phải detection latency hay thời gian cài FlowMod.</small>
      </div>
    </Panel>
  )
}
