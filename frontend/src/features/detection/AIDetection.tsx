import { BrainCircuit, ScanLine } from 'lucide-react'
import { Panel, StatusBadge } from '../../components/ui'
import { formatTimestamp } from '../../components/formatTimestamp'
import type { Detection, PolicyDecision } from '../../types/dashboard'

export function AIDetection({
  detection,
  policy,
}: {
  detection: Detection | null
  policy: PolicyDecision | null
}) {
  const confidence = detection?.confidence
  const percentage = confidence != null && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence * 100 : null
  return <Panel id="detection" title="AI Detection" kicker="PHÂN TÍCH THÔNG MINH" action={<BrainCircuit size={21} className="text-muted" aria-hidden="true" />}>
    <div className="detection-body">
      <div className={`confidence-dial ${percentage === null ? 'confidence-unknown' : ''}`}>
        <svg viewBox="0 0 140 140" aria-hidden="true"><circle cx="70" cy="70" r="60" className="dial-track" />{percentage !== null && <circle cx="70" cy="70" r="60" className="dial-value" strokeDasharray={`${percentage * 3.77} 377`} />}</svg>
        <div><strong>{percentage === null ? '—' : `${percentage.toFixed(1)}%`}</strong><span>CONFIDENCE · DỰ ĐOÁN CUỐI</span></div>
      </div>
      <StatusBadge tone={detection ? 'cyan' : 'muted'}>{detection ? 'Đã nhận suy luận' : 'Chưa có suy luận'}</StatusBadge>
      <p className="detection-caption">{detection ? 'Kết quả gần nhất do hệ thống AI cung cấp' : 'Chờ kết quả phân tích từ hệ thống AI'}</p>
      <dl className="detail-list">
        <div><dt>Kết quả dự đoán</dt><dd>{detection?.label ?? '—'}</dd></div>
        <div><dt>Sample ID</dt><dd className="mono">{detection?.sampleId ?? '—'}</dd></div>
        <div><dt>Policy decision (cùng sample)</dt><dd>{policy?.decision ?? '—'}</dd></div>
        <div><dt>Policy mode</dt><dd>{policy?.mode ?? '—'}</dd></div>
        <div><dt>Mô hình</dt><dd>{detection?.modelName ?? 'Chưa có thông tin'}</dd></div>
        <div><dt>Accuracy mô hình</dt><dd>Chưa có dữ liệu</dd></div>
        <div><dt>Thời điểm B8</dt><dd>{formatTimestamp(detection?.times.sourceTimestamp ?? null)}</dd></div>
        <div><dt>Backend nhận</dt><dd>{formatTimestamp(detection?.times.backendReceivedAt ?? null)}</dd></div>
        <div><dt>Browser nhận</dt><dd>{formatTimestamp(detection?.times.browserReceivedAt ?? null)}</dd></div>
      </dl>
    </div>
    <div className="panel-bottom"><ScanLine size={14} aria-hidden="true" /><span>Confidence thuộc prediction cuối; không phải accuracy của mô hình.</span></div>
  </Panel>
}
