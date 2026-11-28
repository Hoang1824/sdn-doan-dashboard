import { useState } from 'react'
import { Bell, ChevronRight, Radar } from 'lucide-react'
import { EmptyState, Panel, StatusBadge } from '../../components/ui'
import { formatTimestamp } from '../../components/formatTimestamp'
import { formatMetric, getMitigationStatus } from '../../data/presentation'
import type { AlertEvent, MitigationRule } from '../../types/dashboard'

const categoryLabels: Record<AlertEvent['category'], string> = {
  attack_prediction: 'AI prediction',
  mitigation_requested: 'Yêu cầu DROP',
  mitigation_confirmed: 'Controller confirmed · chưa VERIFIED',
  drop_observed: 'Có bằng chứng counter DROP',
}
const statusLabels = {
  requested: 'REQUESTED',
  confirmed: 'CONFIRMED',
  verified: 'VERIFIED',
  dropping: 'DROPPING',
  removed: 'REMOVED',
  removed_idle: 'REMOVED · IDLE',
  cleaned: 'CLEANED',
  unknown: 'UNKNOWN',
  pending: 'PENDING',
  installed: 'INSTALLED',
  expired: 'EXPIRED',
  failed: 'FAILED',
  unverified: 'CHƯA XÁC MINH',
} as const
const statusTone = {
  requested: 'amber',
  confirmed: 'cyan',
  verified: 'green',
  dropping: 'green',
  removed: 'muted',
  removed_idle: 'muted',
  cleaned: 'muted',
  unknown: 'muted',
  pending: 'amber',
  installed: 'cyan',
  expired: 'muted',
  failed: 'red',
  unverified: 'amber',
} as const
const pageSize = 6

function relatedRules(alert: AlertEvent, rules: readonly MitigationRule[]): MitigationRule[] {
  if (alert.cookie) {
    return rules.filter((rule) => (
      rule.cookie === alert.cookie
      && (alert.dpid === null || String(rule.dpid) === String(alert.dpid))
    ))
  }
  if (alert.sampleId) return rules.filter((rule) => rule.sampleId === alert.sampleId)
  if (alert.sourceIp) return rules.filter((rule) => rule.sourceIp === alert.sourceIp)
  return []
}

function processingLabel(alert: AlertEvent, rules: readonly MitigationRule[]): string {
  const matches = relatedRules(alert, rules)
  if (matches.length === 0) {
    if (alert.category === 'attack_prediction') return 'Chưa có rule mitigation liên kết'
    if (alert.category === 'mitigation_requested') return 'REQUESTED'
    if (alert.category === 'mitigation_confirmed') return 'CONFIRMED · chưa VERIFIED'
    return 'DROP evidence'
  }
  const states = [...new Set(matches.map((rule) => statusLabels[getMitigationStatus(rule)]))]
  return matches.length > 1
    ? `${matches.length} luật · ${states.join(' / ')}`
    : states[0]
}

export function AttackAlerts({
  alerts,
  rules = [],
  alertEventCount = null,
  historyComplete = false,
}: {
  alerts: readonly AlertEvent[]
  rules?: readonly MitigationRule[]
  alertEventCount?: number | null
  historyComplete?: boolean
}) {
  const [expandedGroup, setExpandedGroup] = useState<AlertEvent['scope'] | null>(null)
  const liveAlerts = alerts
    .filter((alert) => alert.scope === 'live')
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
  const historicalAlerts = alerts
    .filter((alert) => alert.scope === 'historical')
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
  const groups = [
    { title: 'Sự kiện mới nhận qua LIVE', events: liveAlerts, label: 'LIVE', scope: 'live' as const },
    { title: 'Lịch sử từ snapshot / REPLAY', events: historicalAlerts, label: 'HISTORY', scope: 'historical' as const },
  ].filter((group) => group.events.length > 0)
  const subtitle = alertEventCount === null
    ? 'AI attack prediction, quyết định mitigation và bằng chứng DROP; event không đồng nghĩa cuộc tấn công độc lập.'
    : `${formatMetric(alertEventCount)} alert events trong run · không phải số cuộc tấn công độc lập${historyComplete ? '' : ' · danh sách lưu tối đa 100 event'}`

  return (
    <Panel
      id="alerts"
      title="DDoS Alerts"
      kicker="AI PREDICTION & XỬ LÝ"
      subtitle={subtitle}
      className="alerts-panel"
      action={<a className="text-link" href="#history">Timeline <ChevronRight size={14} /></a>}
    >
      {groups.length ? groups.map((group) => {
        const expanded = expandedGroup === group.scope
        const visibleEvents = expanded ? group.events : group.events.slice(0, pageSize)
        const hiddenCount = group.events.length - pageSize
        return (
          <section key={group.label} className="alert-group" aria-label={group.title}>
            <h3>{group.title}</h3>
            <ul className="alert-list">
              {visibleEvents.map((alert) => {
                const lifecycle = processingLabel(alert, rules)
                const state = relatedRules(alert, rules)[0]
                const stateKey = state ? getMitigationStatus(state) : null
                return (
                  <li key={alert.id}>
                    <Bell size={18} aria-hidden="true" />
                    <div className="alert-content">
                      <strong>{alert.sourceIp ?? '—'}</strong>
                      <p>{alert.description}</p>
                      <small>
                        {formatTimestamp(alert.timestamp)} · Sample {alert.sampleId ?? '—'}
                        {alert.cookie ? ` · Cookie ${alert.cookie}` : ''}
                      </small>
                    </div>
                    <div className="alert-badges">
                      <StatusBadge tone={alert.category === 'drop_observed' ? 'green' : 'muted'}>
                        {categoryLabels[alert.category]}
                      </StatusBadge>
                      <StatusBadge tone={stateKey ? statusTone[stateKey] : 'muted'}>
                        {lifecycle}
                      </StatusBadge>
                      <StatusBadge tone={alert.scope === 'live' ? 'cyan' : 'muted'}>
                        {group.label}
                      </StatusBadge>
                    </div>
                  </li>
                )
              })}
            </ul>
            {hiddenCount > 0 && (
              <button
                type="button"
                className="button button-ghost alert-more"
                onClick={() => setExpandedGroup(expanded ? null : group.scope)}
              >
                {expanded ? 'Thu gọn lịch sử' : `Xem thêm ${hiddenCount} event`}
              </button>
            )}
          </section>
        )
      }) : (
        <div className="alert-empty">
          <div className="radar-mark" aria-hidden="true"><Radar size={38} strokeWidth={1} /></div>
          <EmptyState
            icon={Bell}
            compact
            title="Chưa nhận dữ liệu cảnh báo"
            description="Cảnh báo chỉ xuất hiện khi API cung cấp prediction tấn công hoặc evidence mitigation."
          />
          <span className="waiting-label">CHƯA CÓ DỮ LIỆU</span>
        </div>
      )}
      <div className="panel-bottom alert-observability-note">
        Event lịch sử không phải alert đang active; contract chưa có vòng đời mở/đóng cảnh báo.
      </div>
    </Panel>
  )
}
