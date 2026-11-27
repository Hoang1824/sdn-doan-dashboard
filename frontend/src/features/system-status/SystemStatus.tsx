import { BrainCircuit, Cable, Radio, Server } from 'lucide-react'
import { Panel, StatusBadge, formatTimestamp } from '../../components/ui'
import type { DashboardSnapshot, ServiceState } from '../../types/dashboard'

const labels: Record<ServiceState['status'], string> = { unconfigured: 'Chưa cấu hình', connecting: 'Đang kết nối', connected: 'Đã kết nối', disconnected: 'Mất kết nối', error: 'Lỗi kết nối' }
export function SystemStatus({ services, receivedAt }: { services: DashboardSnapshot['services']; receivedAt: string | null }) {
  const rows = [{ key: 'ai' as const, title: 'AI Inference', subtitle: 'Phân tích & phát hiện', icon: BrainCircuit }, { key: 'ryu' as const, title: 'Ryu Controller', subtitle: 'Điều khiển mạng SDN', icon: Server }, { key: 'websocket' as const, title: 'WebSocket', subtitle: 'Kênh sự kiện trực tiếp', icon: Radio }]
  return <Panel id="system" title="System Status" kicker="KẾT NỐI & DỮ LIỆU" action={<Cable size={21} className="text-muted" />}>
    <ul className="service-list">{rows.map(({ key, title, subtitle, icon: Icon }) => <li key={key}><div className="service-icon"><Icon size={18} aria-hidden="true" /></div><div className="service-description"><strong>{title}</strong><span>{subtitle}</span></div><div className="service-state"><StatusBadge tone={services[key].status === 'connected' ? 'green' : services[key].status === 'error' ? 'red' : services[key].status === 'connecting' ? 'amber' : 'muted'}>{labels[services[key].status]}</StatusBadge><small>Cập nhật: {formatTimestamp(services[key].updatedAt)}</small></div></li>)}</ul>
    <div className="panel-bottom system-bottom"><span>Dữ liệu gần nhất</span><span className="mono">{formatTimestamp(receivedAt)}</span></div>
  </Panel>
}
