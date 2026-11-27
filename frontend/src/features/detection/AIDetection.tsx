import { BrainCircuit, ScanLine } from 'lucide-react'
import { Panel, StatusBadge, formatTimestamp } from '../../components/ui'
import type { Detection } from '../../types/dashboard'

export function AIDetection({ detection }: { detection: Detection | null }) {
  const confidence = detection?.confidence
  const percentage = confidence != null && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence * 100 : null
  return <Panel id="detection" title="AI Detection" kicker="PHÂN TÍCH THÔNG MINH" action={<BrainCircuit size={21} className="text-muted" aria-hidden="true" />}>
    <div className="detection-body">
      <div className={`confidence-dial ${percentage === null ? 'confidence-unknown' : ''}`}>
        <svg viewBox="0 0 140 140" aria-hidden="true"><circle cx="70" cy="70" r="60" className="dial-track" />{percentage !== null && <circle cx="70" cy="70" r="60" className="dial-value" strokeDasharray={`${percentage * 3.77} 377`} />}</svg>
        <div><strong>{percentage === null ? '—' : `${percentage.toFixed(1)}%`}</strong><span>CONFIDENCE</span></div>
      </div>
      <StatusBadge tone={detection ? 'cyan' : 'muted'}>{detection ? 'Đã nhận suy luận' : 'Chưa có suy luận'}</StatusBadge>
      <p className="detection-caption">{detection ? 'Kết quả gần nhất do hệ thống AI cung cấp' : 'Chờ kết quả phân tích từ hệ thống AI'}</p>
      <dl className="detail-list"><div><dt>Kết quả dự đoán</dt><dd>{detection?.label ?? '—'}</dd></div><div><dt>Mô hình</dt><dd>{detection?.modelName ?? 'Chưa có thông tin'}</dd></div><div><dt>Lần phân tích</dt><dd>{formatTimestamp(detection?.timestamp ?? null)}</dd></div></dl>
    </div>
    <div className="panel-bottom"><ScanLine size={14} aria-hidden="true" /><span>Hiển thị kết quả từ nguồn AI</span></div>
  </Panel>
}
