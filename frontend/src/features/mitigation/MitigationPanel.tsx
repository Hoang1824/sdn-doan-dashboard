import { Fragment, useId, useState } from 'react'
import { ChevronDown, LockKeyhole, ShieldCheck } from 'lucide-react'
import { EmptyState, Panel, StatusBadge } from '../../components/ui'
import { getMitigationStatus } from '../../data/presentation'
import type { MitigationRule } from '../../types/dashboard'

const statusLabels = {
  pending: 'PENDING', installed: 'INSTALLED', verified: 'VERIFIED',
  expired: 'EXPIRED', failed: 'FAILED', unverified: 'CHƯA XÁC MINH',
} as const
const statusTones = {
  pending: 'amber', installed: 'cyan', verified: 'green',
  expired: 'muted', failed: 'red', unverified: 'amber',
} as const

function formatTime(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Ho_Chi_Minh',
  }).format(date)
}

export function MitigationPanel({ rules }: { rules: readonly MitigationRule[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const controlId = useId()

  return (
    <Panel id="mitigation" title="Mitigation" kicker="KIỂM SOÁT & GIẢM THIỂU"
      subtitle="Trạng thái luật DROP và bằng chứng xác minh."
      className="mitigation-panel"
      action={<ShieldCheck size={19} className="text-muted" aria-hidden="true" />}>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Bảng luật giảm thiểu">
        <table className="data-table mitigation-table">
          <caption className="sr-only">Các luật giảm thiểu do hệ thống cung cấp</caption>
          <thead><tr><th scope="col">IP nguồn</th><th scope="col">Switch</th><th scope="col">Luật</th><th scope="col">Trạng thái</th></tr></thead>
          <tbody>
            {rules.map((rule, index) => {
              const status = getMitigationStatus(rule)
              const expanded = rule.id === expandedId
              const detailId = `${controlId}-rule-${index}`
              return <Fragment key={rule.id}>
                <tr>
                  <td className="mono">{rule.sourceIp}</td>
                  <td className="mono">{rule.switchId}</td>
                  <td className="mono">{rule.rule}</td>
                  <td><button type="button" className="rule-detail-button" aria-expanded={expanded}
                    aria-controls={expanded ? detailId : undefined} aria-label={`Chi tiết luật ${rule.id}`}
                    onClick={() => setExpandedId(expanded ? null : rule.id)}>
                    <StatusBadge tone={statusTones[status]}>{statusLabels[status]}</StatusBadge>
                    <ChevronDown size={14} aria-hidden="true" style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />
                  </button></td>
                </tr>
                {expanded && <tr className="detail-row" id={detailId}><td colSpan={4}>
                  <dl className="event-details">
                    <div><dt>Mã luật</dt><dd className="mono">{rule.id}</dd></div>
                    <div><dt>Cập nhật (UTC+07:00)</dt><dd>{formatTime(rule.updatedAt)}</dd></div>
                    {rule.evidence && <>
                      <div><dt>Nguồn bằng chứng</dt><dd>{rule.evidence.source}</dd></div>
                      <div><dt>Tham chiếu</dt><dd className="mono">{rule.evidence.reference || '—'}</dd></div>
                      <div><dt>Thời điểm quan sát (UTC+07:00)</dt><dd>{formatTime(rule.evidence.observedAt)}</dd></div>
                    </>}
                  </dl>
                  {(!rule.evidence || status === 'unverified') && <p className="text-muted">Chưa có bằng chứng hợp lệ để xác minh luật trên controller hoặc switch.</p>}
                </td></tr>}
              </Fragment>
            })}
            {rules.length === 0 && <tr><td colSpan={4}>
              <EmptyState icon={LockKeyhole} title="Chưa có bản ghi giảm thiểu"
                description="IP nguồn và luật DROP sẽ hiển thị khi nhận được bản ghi từ hệ thống." />
            </td></tr>}
          </tbody>
        </table>
      </div>
      <div className="panel-note"><ShieldCheck size={15} aria-hidden="true" /><span>Chỉ xác minh khi có bằng chứng từ controller hoặc switch.</span></div>
    </Panel>
  )
}
