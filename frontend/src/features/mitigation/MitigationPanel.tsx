import { Fragment, useId, useState } from 'react'
import { ChevronDown, LockKeyhole, ShieldCheck } from 'lucide-react'
import { EmptyState, Panel, StatusBadge } from '../../components/ui'
import { getMitigationStatus } from '../../data/presentation'
import type { MitigationRule } from '../../types/dashboard'

const statusLabels = {
  requested: 'REQUESTED',
  confirmed: 'CONFIRMED',
  dropping: 'DROPPING',
  pending: 'PENDING', installed: 'INSTALLED', verified: 'VERIFIED',
  removed: 'REMOVED', removed_idle: 'REMOVED · IDLE',
  cleaned: 'CLEANED', unknown: 'UNKNOWN',
  expired: 'EXPIRED', failed: 'FAILED', unverified: 'CHƯA XÁC MINH',
} as const
const statusTones = {
  requested: 'amber', confirmed: 'cyan', dropping: 'green',
  pending: 'amber', installed: 'cyan', verified: 'green',
  removed: 'muted', removed_idle: 'muted', cleaned: 'muted',
  unknown: 'muted', expired: 'muted', failed: 'red', unverified: 'amber',
} as const

function formatTime(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Ho_Chi_Minh',
  }).format(date)
}

function protocolLabel(protocol: number | null): string {
  if (protocol === 6) return 'TCP'
  if (protocol === 17) return 'UDP'
  return protocol === null ? 'Chưa có dữ liệu' : `IP protocol ${protocol}`
}

export function MitigationPanel({
  rules,
  complete = true,
}: {
  rules: readonly MitigationRule[]
  complete?: boolean
}) {
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
          <thead><tr>
            <th scope="col">IP nguồn</th><th scope="col">Protocol</th>
            <th scope="col">DPID / switch</th><th scope="col">Hành động</th>
            <th scope="col">Packet count</th><th scope="col">Lifecycle</th>
          </tr></thead>
          <tbody>
            {rules.map((rule, index) => {
              const status = getMitigationStatus(rule)
              const expanded = rule.id === expandedId
              const detailId = `${controlId}-rule-${index}`
              return <Fragment key={rule.id}>
                <tr>
                  <td className="mono">{rule.sourceIp || 'Chưa có dữ liệu'}</td>
                  <td>{protocolLabel(rule.ipProtocol)}</td>
                  <td className="mono">{rule.dpid === null ? 'Chưa có dữ liệu' : `DPID ${rule.dpid}`}</td>
                  <td className="mono">{rule.rule || 'Chưa có dữ liệu'}</td>
                  <td className="mono">{rule.packetCount === null ? 'Chưa có dữ liệu' : rule.packetCount.toLocaleString('en-US')}</td>
                  <td><button type="button" className="rule-detail-button" aria-expanded={expanded}
                    aria-controls={expanded ? detailId : undefined} aria-label={`Chi tiết luật ${rule.id}`}
                    onClick={() => setExpandedId(expanded ? null : rule.id)}>
                    <StatusBadge tone={statusTones[status]}>{statusLabels[status]}</StatusBadge>
                    <ChevronDown size={14} aria-hidden="true" style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />
                  </button></td>
                </tr>
                {expanded && <tr className="detail-row" id={detailId}><td colSpan={6}>
                  <dl className="event-details">
                    <div><dt>Mã luật</dt><dd className="mono">{rule.id}</dd></div>
                    <div><dt>Cập nhật (UTC+07:00)</dt><dd>{formatTime(rule.updatedAt)}</dd></div>
                    {rule.evidence && <>
                      <div><dt>Nguồn bằng chứng</dt><dd>{rule.evidence.source}</dd></div>
                      <div><dt>Tham chiếu</dt><dd className="mono">{rule.evidence.reference || '—'}</dd></div>
                      <div><dt>Thời điểm quan sát (UTC+07:00)</dt><dd>{formatTime(rule.evidence.observedAt)}</dd></div>
                    </>}
                    <div><dt>Cookie / DPID</dt><dd className="mono">{rule.cookie ?? '—'} / {rule.dpid ?? '—'}</dd></div>
                    <div><dt>Sample ID</dt><dd className="mono">{rule.sampleId ?? '—'}</dd></div>
                    <div><dt>Đích / protocol</dt><dd className="mono">{rule.destinationIp ?? 'Chưa có dữ liệu'} / {protocolLabel(rule.ipProtocol)}</dd></div>
                    <div><dt>DROP counter lũy kế</dt><dd>{rule.packetCount ?? '—'} packets · {rule.byteCount ?? '—'} bytes</dd></div>
                    <div><dt>Counter source</dt><dd>{rule.counterSource ?? '—'}</dd></div>
                    {rule.removalReason !== null && <div><dt>FlowRemoved reason</dt><dd>{rule.removalReason}</dd></div>}
                    <div><dt>Browser nhận sự kiện</dt><dd>{formatTime(rule.times.browserReceivedAt ?? '')}</dd></div>
                  </dl>
                  {(!rule.evidence || status === 'unverified') && <p className="text-muted">Chưa có bằng chứng hợp lệ để xác minh luật trên controller hoặc switch.</p>}
                </td></tr>}
              </Fragment>
            })}
            {rules.length === 0 && <tr><td colSpan={6}>
              <EmptyState icon={LockKeyhole} title="Chưa có bản ghi giảm thiểu"
                description="IP nguồn và luật DROP sẽ hiển thị khi nhận được bản ghi từ hệ thống." />
            </td></tr>}
          </tbody>
        </table>
      </div>
      <div className="panel-note">
        <ShieldCheck size={15} aria-hidden="true" />
        <span>
          Chỉ xác minh khi có bằng chứng từ controller hoặc switch.
          CLEANED/REMOVED là trạng thái lịch sử, không có nghĩa luật đang chặn.
          {!complete && ' Danh sách đã giới hạn; verified source count không khả dụng.'}
        </span>
      </div>
    </Panel>
  )
}
