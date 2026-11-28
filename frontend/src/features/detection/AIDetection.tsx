import { BrainCircuit, ScanLine } from 'lucide-react'
import { Panel, StatusBadge } from '../../components/ui'
import { formatTimestamp } from '../../components/formatTimestamp'
import { formatMetric } from '../../data/presentation'
import type { Detection, PolicyDecision, PredictionClassCounts } from '../../types/dashboard'

export function AIDetection({
  detection,
  modelName,
  policy,
  predictionCount,
  predictionClassCounts,
}: {
  detection: Detection | null
  modelName: string | null
  policy: PolicyDecision | null
  predictionCount: number | null
  predictionClassCounts: PredictionClassCounts | null
}) {
  const confidence = detection?.confidence
  const percentage = confidence != null && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1
    ? confidence * 100
    : null
  const classRows = [
    { key: 'benign' as const, label: 'Benign', color: 'benign' },
    { key: 'syn_flood' as const, label: 'SYN flood', color: 'syn' },
    { key: 'udp_flood' as const, label: 'UDP flood', color: 'udp' },
  ]
  const classTotal = predictionClassCounts
    ? predictionClassCounts.benign + predictionClassCounts.syn_flood + predictionClassCounts.udp_flood
    : null
  const distributionTotal = predictionCount ?? classTotal

  return (
    <Panel
      id="detection"
      title="AI Detection"
      kicker="PHÂN TÍCH CNN–MLP"
      action={<BrainCircuit size={21} className="text-muted" aria-hidden="true" />}
    >
      <div className="detection-body">
        <section className="prediction-distribution" aria-label="Phân bố prediction theo lớp">
          <div className="prediction-distribution-heading">
            <strong>Phân bố lớp</strong>
            <span>{predictionClassCounts ? `${formatMetric(distributionTotal)} prediction` : 'Chưa có histogram từ API'}</span>
          </div>
          {predictionClassCounts && classRows.map(({ key, label, color }) => {
            const count = predictionClassCounts[key]
            const width = distributionTotal && distributionTotal > 0
              ? Math.min(100, count / distributionTotal * 100)
              : 0
            return (
              <div className="prediction-class-row" key={key}>
                <span>{label}</span>
                <span className="prediction-class-track">
                  <i className={`prediction-class-fill prediction-${color}`} style={{ width: `${width}%` }} />
                </span>
                <strong>{formatMetric(count)}</strong>
              </div>
            )
          })}
        </section>

        <div className="detection-result">
          <div className={`confidence-dial ${percentage === null ? 'confidence-unknown' : ''}`}>
            <svg viewBox="0 0 140 140" aria-hidden="true">
              <circle cx="70" cy="70" r="60" className="dial-track" />
              {percentage !== null && (
                <circle
                  cx="70"
                  cy="70"
                  r="60"
                  className="dial-value"
                  strokeDasharray={`${percentage * 3.77} 377`}
                />
              )}
            </svg>
            <div>
              <strong>{percentage === null ? '—' : `${percentage.toFixed(1)}%`}</strong>
              <span>CONFIDENCE · DỰ ĐOÁN CUỐI</span>
            </div>
          </div>
          <StatusBadge tone={detection ? 'cyan' : 'muted'}>
            {detection ? 'Đã nhận suy luận' : 'Chưa có suy luận'}
          </StatusBadge>
          <p className="detection-caption">
            {detection ? `Kết quả gần nhất: ${detection.label}` : 'Chờ prediction từ run đã chọn'}
          </p>
        </div>

        <dl className="detail-list">
          <div><dt>Sample ID</dt><dd className="mono">{detection?.sampleId ?? '—'}</dd></div>
          <div><dt>Policy decision · cùng sample</dt><dd>{policy?.decision ?? '—'}</dd></div>
          <div><dt>Policy mode</dt><dd>{policy?.mode ?? '—'}</dd></div>
          <div><dt>Model revision</dt><dd>{modelName ?? 'Chưa có thông tin'}</dd></div>
        </dl>
        {detection && (
          <details className="detection-evidence">
            <summary>Thời điểm và prediction evidence</summary>
            <dl>
              <div><dt>Thời điểm B8</dt><dd>{formatTimestamp(detection.times.sourceTimestamp)}</dd></div>
              <div><dt>Backend nhận</dt><dd>{formatTimestamp(detection.times.backendReceivedAt)}</dd></div>
              <div><dt>Browser nhận</dt><dd>{formatTimestamp(detection.times.browserReceivedAt)}</dd></div>
            </dl>
          </details>
        )}
      </div>
      <div className="panel-bottom">
        <ScanLine size={14} aria-hidden="true" />
        <span>Histogram là tổng prediction ID duy nhất. Confidence không phải accuracy.</span>
      </div>
    </Panel>
  )
}
