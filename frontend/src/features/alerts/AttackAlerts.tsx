import { Bell, ChevronRight, Radar } from 'lucide-react'
import { EmptyState, Panel, StatusBadge } from '../../components/ui'
import { formatTimestamp } from '../../components/formatTimestamp'
import type { AlertEvent } from '../../types/dashboard'

const categoryLabels: Record<AlertEvent['category'], string> = {
  attack_prediction: 'AI prediction',
  mitigation_requested: 'Yêu cầu DROP',
  mitigation_confirmed: 'Controller confirmed · chưa VERIFIED',
  drop_observed: 'Có bằng chứng counter DROP',
}

export function AttackAlerts({ alerts }: { alerts: readonly AlertEvent[] }) {
  const liveAlerts = alerts.filter((alert) => alert.scope === 'live')
  const historicalAlerts = alerts.filter((alert) => alert.scope === 'historical')
  const groups = [
    { title: 'Sự kiện mới nhận qua LIVE', events: liveAlerts, label: 'LIVE' },
    { title: 'Lịch sử từ snapshot / REPLAY', events: historicalAlerts, label: 'HISTORY' },
  ].filter((group) => group.events.length > 0)

  return <Panel id="alerts" title="Attack Alerts" kicker="GIÁM SÁT SỰ KIỆN" className="alerts-panel" action={<a className="text-link" href="#history">Lịch sử <ChevronRight size={14} /></a>}>
    {groups.length ? groups.map((group) => <section key={group.label} className="alert-group" aria-label={group.title}>
      <h3>{group.title}</h3>
      <ul className="alert-list">{group.events.map(alert => <li key={alert.id}>
        <Bell size={18} aria-hidden="true" />
        <div>
          <strong>{alert.sourceIp ?? '—'}</strong>
          <p>{alert.description}</p>
          <small>{formatTimestamp(alert.timestamp)} · Sample {alert.sampleId ?? '—'}{alert.cookie ? ` · Cookie ${alert.cookie}` : ''}</small>
        </div>
        <div className="alert-badges">
          <StatusBadge tone={alert.category === 'drop_observed' ? 'green' : 'muted'}>
            {categoryLabels[alert.category]}
          </StatusBadge>
          <StatusBadge tone={alert.scope === 'live' ? 'cyan' : 'muted'}>{group.label}</StatusBadge>
        </div>
      </li>)}</ul>
    </section>) : <div className="alert-empty"><div className="radar-mark" aria-hidden="true"><Radar size={38} strokeWidth={1} /></div><EmptyState icon={Bell} compact title="Chưa nhận dữ liệu cảnh báo" description="Các sự kiện AI attack, mitigation và DROP evidence sẽ xuất hiện khi có nguồn tương ứng." /><span className="waiting-label">CHƯA CÓ DỮ LIỆU</span></div>}
    <div className="panel-bottom alert-observability-note">
      LIVE chỉ đánh dấu event mới nhận trong run đang chạy; API chưa có trạng thái mở/đóng để khẳng định một cuộc tấn công còn active.
    </div>
  </Panel>
}
