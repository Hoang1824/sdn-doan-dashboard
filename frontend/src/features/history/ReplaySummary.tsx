import { ClipboardList, ShieldCheck } from 'lucide-react'
import { Panel } from '../../components/ui'
import { getMitigationStatus } from '../../data/presentation'
import type { DashboardSnapshot, MitigationRule } from '../../types/dashboard'

function isDropRule(rule: MitigationRule): boolean {
  return rule.rule.trim().toUpperCase() === 'DROP'
}

function protocolLabel(protocol: number | null): string {
  if (protocol === 6) return 'TCP'
  if (protocol === 17) return 'UDP'
  return protocol === null ? 'Chưa có dữ liệu' : `IP protocol ${protocol}`
}

export function ReplaySummary({ snapshot }: { snapshot: DashboardSnapshot }) {
  if (snapshot.dataMode !== 'REPLAY' || !snapshot.run) return null

  const dropRules = snapshot.mitigations.filter(isDropRule)

  return (
    <Panel
      title="Replay Summary"
      kicker="TỔNG KẾT RUN ĐÃ LƯU"
      subtitle={`${snapshot.run.runId} · ${snapshot.run.scenario ?? 'Scenario chưa có dữ liệu'} · seed ${snapshot.run.seed ?? 'chưa có dữ liệu'}`}
      className="replay-summary"
      action={<ClipboardList size={19} className="text-muted" aria-hidden="true" />}
    >
      <div className="replay-counters">
        <h3>Flow cuối theo IP / protocol / cookie</h3>
        {!snapshot.mitigationsComplete ? (
          <p>Danh sách luật bị giới hạn; không thể xác nhận đủ các flow cuối.</p>
        ) : dropRules.length === 0 ? (
          <p>Không có luật DROP trong snapshot này.</p>
        ) : (
          <div className="table-scroll">
          <table className="data-table replay-flow-table">
            <thead><tr>
              <th scope="col">IP nguồn</th>
              <th scope="col">Protocol</th>
              <th scope="col">Cookie / DPID</th>
              <th scope="col">Final packet_count</th>
              <th scope="col">Lifecycle / reason</th>
            </tr></thead>
            <tbody>
            {dropRules.map((rule) => (
              <tr key={rule.id}>
                <td className="mono">{rule.sourceIp || 'Chưa có dữ liệu'}</td>
                <td>{protocolLabel(rule.ipProtocol)}</td>
                <td className="mono">{rule.cookie ?? 'Chưa có dữ liệu'} · DPID {rule.dpid ?? '—'}</td>
                <td className="mono">{rule.packetCount === null
                  ? 'Chưa có dữ liệu'
                  : rule.packetCount.toLocaleString('en-US')}</td>
                <td>
                  {getMitigationStatus(rule) === 'unverified' ? 'CHƯA XÁC MINH' : rule.status.toUpperCase()}
                  {rule.removalReason !== null ? ` · reason ${rule.removalReason}` : ''}
                </td>
              </tr>
            ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
      <p className="replay-summary-note">
        {snapshot.mitigationsComplete
          ? 'Bảng thể hiện counter cuối theo từng flow, không cộng giữa các mẫu; CLEANED/REMOVED là lịch sử đã gỡ, không còn bị chặn.'
          : 'Snapshot chỉ trả danh sách luật giới hạn; tổng hợp cuối có thể chưa đầy đủ.'}
      </p>
      <p className="replay-summary-note">
        <ShieldCheck size={14} aria-hidden="true" />
        Confidence không phải accuracy. Bảng này bổ sung chứng cứ per-flow; các KPI tổng hợp chỉ hiển thị một lần ở trang chính.
      </p>
    </Panel>
  )
}
