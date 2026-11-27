import { Bell, ChevronRight, Radar } from 'lucide-react'
import { EmptyState, Panel, StatusBadge, formatTimestamp } from '../../components/ui'
import type { AlertEvent } from '../../types/dashboard'

export function AttackAlerts({ alerts }: { alerts: readonly AlertEvent[] }) {
  return <Panel id="alerts" title="Attack Alerts" kicker="GIÁM SÁT SỰ KIỆN" className="alerts-panel" action={<a className="text-link" href="#history">Lịch sử <ChevronRight size={14} /></a>}>
    {alerts.length ? <ul className="alert-list">{alerts.map(alert => <li key={alert.id}>
      <Bell size={18} aria-hidden="true" /><div><strong>{alert.sourceIp}</strong><p>{alert.description}</p><small>{formatTimestamp(alert.timestamp)}</small></div><div className="alert-badges"><StatusBadge tone={alert.severity === 'critical' ? 'red' : 'amber'}>{alert.severity}</StatusBadge><StatusBadge tone={alert.confirmed ? 'red' : 'amber'}>{alert.confirmed ? 'Đã xác nhận' : 'Mới phát hiện'}</StatusBadge></div>
    </li>)}</ul> : <div className="alert-empty"><div className="radar-mark" aria-hidden="true"><Radar size={38} strokeWidth={1} /></div><EmptyState icon={Bell} compact title="Chưa nhận dữ liệu cảnh báo" description="Các sự kiện phát hiện và xác nhận DDoS sẽ được hiển thị tại đây." /><span className="waiting-label">ĐANG CHỜ NGUỒN DỮ LIỆU</span></div>}
  </Panel>
}
