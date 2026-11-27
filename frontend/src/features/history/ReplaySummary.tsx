import { ClipboardList, ShieldCheck } from 'lucide-react'
import { Panel } from '../../components/ui'
import { formatMetric, getMitigationStatus, getVerifiedSourceCount } from '../../data/presentation'
import type { DashboardSnapshot, MitigationRule } from '../../types/dashboard'

const confirmedLifecycle = new Set([
  'confirmed',
  'verified',
  'dropping',
  'removed',
  'removed_idle',
  'cleaned',
])

function isDropRule(rule: MitigationRule): boolean {
  return rule.rule.trim().toUpperCase() === 'DROP'
}

function finalPacketCount(rule: MitigationRule): string {
  return rule.packetCount === null ? 'Chưa có dữ liệu' : formatMetric(rule.packetCount)
}

export function ReplaySummary({ snapshot }: { snapshot: DashboardSnapshot }) {
  if (snapshot.dataMode !== 'REPLAY' || !snapshot.run) return null

  const dropRules = snapshot.mitigations.filter(isDropRule)
  const confirmedDropRules = snapshot.mitigationsComplete
    ? dropRules.filter((rule) => confirmedLifecycle.has(rule.status)).length
    : null
  const verifiedSources = getVerifiedSourceCount(snapshot)

  return (
    <Panel
      title="Replay Summary"
      kicker="TỔNG KẾT RUN ĐÃ LƯU"
      subtitle={`${snapshot.run.runId} · ${snapshot.run.scenario ?? 'Scenario chưa có dữ liệu'} · seed ${snapshot.run.seed ?? 'chưa có dữ liệu'}`}
      className="replay-summary"
      action={<ClipboardList size={19} className="text-muted" aria-hidden="true" />}
    >
      <dl className="replay-summary-grid">
        <div>
          <dt>Prediction count (API)</dt>
          <dd>{snapshot.predictionCount === null ? 'Chưa có dữ liệu' : formatMetric(snapshot.predictionCount)}</dd>
        </div>
        <div>
          <dt>Phân bố benign / attack</dt>
          <dd>Chưa có dữ liệu từ API</dd>
        </div>
        <div>
          <dt>DROP rules đã CONFIRMED+</dt>
          <dd>{confirmedDropRules === null ? 'Chưa có dữ liệu' : formatMetric(confirmedDropRules)}</dd>
        </div>
        <div>
          <dt>Active verified sources</dt>
          <dd>{verifiedSources === null ? 'Chưa có dữ liệu' : formatMetric(verifiedSources)}</dd>
        </div>
      </dl>
      <div className="replay-counters">
        <h3>Counter cuối theo cookie / DPID</h3>
        {!snapshot.mitigationsComplete ? (
          <p>Chưa có dữ liệu: danh sách luật bị giới hạn.</p>
        ) : dropRules.length === 0 ? (
          <p>Không có luật DROP trong snapshot này.</p>
        ) : (
          <ul>
            {dropRules.map((rule) => (
              <li key={rule.id}>
                <span className="mono">{rule.cookie} · DPID {rule.dpid ?? '—'}</span>
                <span>{finalPacketCount(rule)} packets</span>
                <span className="replay-counter-status">{getMitigationStatus(rule) === 'unverified' ? 'CHƯA XÁC MINH' : rule.status.toUpperCase()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="replay-summary-note">
        <ShieldCheck size={14} aria-hidden="true" />
        Counter là giá trị cuối của từng flow, không cộng các lần lấy mẫu. CLEANED là lịch sử đã gỡ, không phải đang chặn.
        Phân bố lớp/accuracy không được suy ra từ latest policies hoặc prediction_count.
      </p>
    </Panel>
  )
}
