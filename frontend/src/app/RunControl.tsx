import { RefreshCw, SquareArrowOutUpRight } from 'lucide-react'
import { formatTimestamp } from '../components/formatTimestamp'
import { modelCandidateFromRevision } from '../data/b8-read-model'
import { useDashboard } from '../data/useDashboard'

function displayRevision(
  revision: Readonly<Record<string, unknown>>,
  predictionModel: string | null,
): string[] {
  const entries = Object.entries(revision)
  const model = predictionModel ?? modelCandidateFromRevision(revision)
  const controller = entries.find(([key]) => key.toLowerCase() === 'controller_revision')?.[1]
  const otherRevisions = entries
    .filter(([key, value]) => key.toLowerCase().includes('revision')
      && key.toLowerCase() !== 'controller_revision'
      && typeof value === 'string')
    .map(([key, value]) => `${key}: ${value}`)
  return [
    ...(model ? [`Model: ${model}`] : []),
    ...(typeof controller === 'string' ? [`Controller: ${controller}`] : []),
    ...otherRevisions,
  ]
}

export function RunControl() {
  const {
    snapshot,
    runs,
    liveDiscovery,
    selectedRunId,
    requestedDataMode,
    runsLoading,
    snapshotLoading,
    error,
    setSelectedRunId,
    selectLiveRun,
    setRequestedDataMode,
    loadSnapshot,
    refreshRuns,
  } = useDashboard()
  const run = snapshot.run
  const selectedRun = runs.find((item) => item.runId === selectedRunId)
  const liveStatus = snapshot.runLiveStatus ?? selectedRun?.live ?? null
  const modeLabel = snapshot.dataMode === 'LIVE'
    ? 'LIVE · theo dõi bản ghi mới'
    : snapshot.dataMode === 'REPLAY'
      ? 'REPLAY / HISTORY · snapshot'
      : 'Chưa tải snapshot'

  return (
    <section className="run-control" aria-label="Chọn run B8">
      <div className="run-control-heading">
        <div>
          <p className="run-control-kicker">B8 READ-ONLY DATA SOURCE</p>
          <h2>Run & snapshot</h2>
        </div>
        <button
          type="button"
          className="button button-ghost run-refresh"
          onClick={refreshRuns}
          disabled={runsLoading}
        >
          <RefreshCw size={14} aria-hidden="true" />
          {runsLoading ? 'Đang tải runs…' : 'Tải lại danh sách'}
        </button>
      </div>
      <div className="run-control-fields">
        <label>
          <span>Run</span>
          <select
            aria-label="Chọn run"
            value={selectedRunId}
            onChange={(event) => setSelectedRunId(event.target.value)}
            disabled={runsLoading || runs.length === 0}
          >
            <option value="">
              {runsLoading ? 'Đang tải danh sách run…' : runs.length ? 'Chọn run B8' : 'API chưa trả run nào'}
            </option>
            {runs.map((item) => (
              <option key={item.runId} value={item.runId}>
                {[item.runId, item.scenario, item.seed !== null ? `seed ${item.seed}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Chế độ dữ liệu</span>
          <select
            aria-label="Chế độ dữ liệu"
            value={requestedDataMode}
            onChange={(event) => {
              const mode = event.target.value
              if (mode === 'LIVE' || mode === 'REPLAY') setRequestedDataMode(mode)
            }}
            disabled={!selectedRunId || snapshotLoading}
          >
            <option value="REPLAY">REPLAY / HISTORY</option>
            <option value="LIVE">LIVE · theo dõi JSONL mới</option>
          </select>
        </label>
        <button
          type="button"
          className="button run-load"
          onClick={loadSnapshot}
          disabled={!selectedRunId || snapshotLoading}
        >
          <SquareArrowOutUpRight size={14} aria-hidden="true" />
          {snapshotLoading
            ? 'Đang tải snapshot…'
            : requestedDataMode === 'LIVE'
              ? 'Tải snapshot & kết nối'
              : 'Tải snapshot lịch sử'}
        </button>
      </div>
      <p className="run-control-note">
        LIVE chỉ theo dõi JSONL được backend cho phép; không khẳng định traffic hay cuộc tấn công đang chạy.
        Run lịch sử mặc định dùng REPLAY/HISTORY.
      </p>
      {liveDiscovery && (
        <div className="run-live-discovery" role="status">
          {liveDiscovery.status === 'none' && (
            <p>Chưa phát hiện run LIVE đủ mới. Backend sẽ tự cập nhật danh sách khi log hợp lệ xuất hiện.</p>
          )}
          {liveDiscovery.status === 'single' && liveDiscovery.selectedRunId && (
            <div>
              <p>Phát hiện một run LIVE mới: <span className="mono">{liveDiscovery.selectedRunId}</span>.</p>
              {selectedRunId === liveDiscovery.selectedRunId && snapshot.dataMode === 'LIVE'
                ? <p>Đang theo dõi run này.</p>
                : (
                  <button
                    type="button"
                    className="button button-ghost"
                    onClick={() => selectLiveRun(liveDiscovery.selectedRunId!)}
                  >
                    Theo dõi run LIVE
                  </button>
                )}
            </div>
          )}
          {liveDiscovery.status === 'ambiguous' && (
            <div>
              <p>Có nhiều run LIVE hợp lệ. Chọn rõ run cần theo dõi; dashboard không tự chọn.</p>
              <div className="run-live-candidates">
                {liveDiscovery.candidateRunIds.map((runId) => (
                  <button
                    key={runId}
                    type="button"
                    className="button button-ghost"
                    onClick={() => selectLiveRun(runId)}
                  >
                    Theo dõi {runId}
                  </button>
                ))}
              </div>
            </div>
          )}
          {liveDiscovery.status === 'manual_active' && (
            <p>Đang dùng run LIVE được ghim thủ công trong cấu hình backend.</p>
          )}
          {liveDiscovery.status === 'manual_unavailable' && (
            <p>Run được ghim thủ công chưa đủ mới hoặc không còn running; không tự chuyển sang run khác.</p>
          )}
        </div>
      )}
      {error && <p className="run-control-error" role="alert">{error}</p>}
      {selectedRun?.metadataError && (
        <p className="run-control-error" role="status">{selectedRun.metadataError}</p>
      )}
      {run && (
        <dl className="run-metadata">
          <div><dt>run_id</dt><dd className="mono">{run.runId}</dd></div>
          <div><dt>Scenario / seed</dt><dd>{run.scenario ?? '—'} / {run.seed ?? '—'}</dd></div>
          <div><dt>Policy mode</dt><dd>{run.policyMode ?? '—'}</dd></div>
          <div><dt>Data mode</dt><dd>{modeLabel}</dd></div>
          <div><dt>Manifest status</dt><dd>{run.status ?? '—'}</dd></div>
          <div>
            <dt>Trạng thái log LIVE</dt>
            <dd>
              {snapshot.dataMode === 'REPLAY'
                ? 'Không theo dõi LIVE (REPLAY)'
                : liveStatus
                  ? `${liveStatus.status ?? 'unknown'} · ${liveStatus.freshness}`
                  : 'Chưa có trạng thái'}
            </dd>
          </div>
          {snapshot.dataMode === 'LIVE' && liveStatus && (
            <div>
              <dt>Log mới nhất</dt>
              <dd>
                {liveStatus.lastActivityAt
                  ? `${formatTimestamp(liveStatus.lastActivityAt)} · ${liveStatus.lastActivityStream ?? 'JSONL'}`
                  : 'Chưa có dòng JSONL hoàn chỉnh'}
              </dd>
            </div>
          )}
          <div><dt>Backend snapshot time</dt><dd>{formatTimestamp(snapshot.backendSnapshotReceivedAt)}</dd></div>
          <div className="run-revision">
            <dt>Revision</dt>
            <dd>
              {displayRevision(run.revision, snapshot.detection?.modelName ?? null).join(' · ') || '—'}
              {Object.keys(run.revision).length > 0 && (
                <details className="revision-details">
                  <summary>Xem profile/revision chi tiết</summary>
                  <pre>{JSON.stringify(run.revision, null, 2)}</pre>
                </details>
              )}
            </dd>
          </div>
        </dl>
      )}
      {snapshot.dataMode === 'LIVE' && (
        <p className="run-control-live-note" role="status">
          {liveStatus?.freshness === 'fresh'
            ? 'JSONL đang được cập nhật trong ngưỡng freshness. Điều này không xác nhận AI hoặc Ryu đang hoạt động.'
            : 'Chưa có hoạt động JSONL mới trong ngưỡng freshness. Kết nối WebSocket không xác nhận AI hoặc Ryu đang hoạt động.'}
        </p>
      )}
      {snapshot.runFinalizationStatus === 'confirmed' && (
        <p className="run-control-live-note" role="status">
          Backend đã nhận pha finished và drain các dòng JSONL hoàn chỉnh trước snapshot REPLAY cuối.
        </p>
      )}
      {snapshot.runFinalizationStatus === 'timeout' && (
        <p className="run-control-error" role="alert">
          Đã hết thời gian chờ pha finished; snapshot REPLAY cuối là trạng thái tốt nhất hiện có, chưa xác nhận đủ log cuối.
        </p>
      )}
      {selectedRun && !selectedRun.metadataError && selectedRun.status && (
        <span className="sr-only">Manifest status: {selectedRun.status}</span>
      )}
    </section>
  )
}
