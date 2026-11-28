import { BrainCircuit, Cable, Radio, Server } from 'lucide-react'
import { Panel, StatusBadge } from '../../components/ui'
import { formatTimestamp } from '../../components/formatTimestamp'
import type { DashboardDataMode, DashboardSnapshot, ServiceState } from '../../types/dashboard'

const labels: Record<ServiceState['status'], string> = { unconfigured: 'Chưa cấu hình', connecting: 'Đang kết nối', connected: 'Đã kết nối', disconnected: 'Mất kết nối', error: 'Lỗi kết nối' }
export function SystemStatus({
  services,
  receivedAt,
  dataMode,
}: {
  services: DashboardSnapshot['services']
  receivedAt: string | null
  dataMode: DashboardDataMode | null
}) {
  const rows = [
    { key: 'dashboardApi' as const, title: 'Dashboard REST API', subtitle: 'Snapshot và danh sách run', icon: Cable },
    { key: 'ai' as const, title: 'AI event source', subtitle: 'Chưa có health check trực tiếp', icon: BrainCircuit },
    { key: 'ryu' as const, title: 'Ryu event source', subtitle: 'Chưa có health check trực tiếp', icon: Server },
    { key: 'websocket' as const, title: 'WebSocket', subtitle: 'Kênh sự kiện LIVE', icon: Radio },
  ]
  const serviceLabel = (key: typeof rows[number]['key']) => {
    if (key === 'websocket' && dataMode === 'REPLAY') return 'Không sử dụng (REPLAY)'
    if ((key === 'ai' || key === 'ryu') && services[key].status === 'unconfigured') {
      return 'Chưa giám sát trực tiếp'
    }
    return labels[services[key].status]
  }
  const serviceTone = (key: typeof rows[number]['key']): 'muted' | 'green' | 'red' | 'amber' => {
    if (key === 'websocket' && dataMode === 'REPLAY') return 'muted'
    return services[key].status === 'connected' ? 'green'
      : services[key].status === 'error' ? 'red'
        : services[key].status === 'connecting' ? 'amber' : 'muted'
  }
  return <Panel id="system" title="System Status" kicker="KẾT NỐI & DỮ LIỆU" action={<Cable size={21} className="text-muted" />}>
    <ul className="service-list">{rows.map(({ key, title, subtitle, icon: Icon }) => <li key={key}><div className="service-icon"><Icon size={18} aria-hidden="true" /></div><div className="service-description"><strong>{title}</strong><span>{subtitle}</span></div><div className="service-state"><StatusBadge tone={serviceTone(key)}>{serviceLabel(key)}</StatusBadge><small>Cập nhật: {formatTimestamp(services[key].updatedAt)}</small></div></li>)}</ul>
    <div className="panel-bottom system-bottom"><span>Dữ liệu gần nhất</span><span className="mono">{formatTimestamp(receivedAt)}</span></div>
  </Panel>
}
