import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  ChevronRight,
  CircleHelp,
  Command,
  LayoutDashboard,
  Menu,
  Radio,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Unplug,
  X,
} from 'lucide-react'
import {
  EmptyState,
  MetricCard,
  Panel,
  StatusBadge,
} from '../components/ui'
import { formatTimestamp } from '../components/formatTimestamp'
import { useDashboard } from '../data/useDashboard'
import { modelCandidateFromRevision } from '../data/b8-read-model'
import {
  formatMetric,
  getAttackPredictionCount,
  getConfirmedDropRuleCount,
  getEverDroppedSourceCount,
  getFinalDropPacketCount,
  getVerifiedSourceCount,
} from '../data/presentation'
import { RunControl } from './RunControl'
import { NetworkOverview } from '../features/network/NetworkOverview'
import { AIDetection } from '../features/detection/AIDetection'
import { AttackAlerts } from '../features/alerts/AttackAlerts'
import { MitigationPanel } from '../features/mitigation/MitigationPanel'
import { AttackHistory } from '../features/history/AttackHistory'
import { ReplaySummary } from '../features/history/ReplaySummary'
import { PerformancePanel } from '../features/performance/PerformancePanel'
import { SystemStatus } from '../features/system-status/SystemStatus'

const TopologyPanel = lazy(() =>
  import('../features/topology/TopologyPanel').then(module => ({
    default: module.TopologyPanel,
  })),
)

const navigation = [
  { id: 'overview', label: 'Tổng quan', icon: LayoutDashboard },
  { id: 'detection', label: 'AI Detection', icon: ShieldCheck },
  { id: 'alerts', label: 'DDoS Alerts', icon: ShieldAlert },
  { id: 'mitigation', label: 'Mitigation', icon: ShieldCheck },
  { id: 'network', label: 'DROP Counter', icon: Radio },
  { id: 'history', label: 'Event Timeline', icon: Radio },
  { id: 'evidence', label: 'Evidence & chi tiết', icon: CircleHelp },
]

export function DashboardLayout() {
  const { snapshot } = useDashboard()
  const attackPredictions = getAttackPredictionCount(snapshot)
  const confirmedDropRules = getConfirmedDropRuleCount(snapshot)
  const everDroppedSources = getEverDroppedSourceCount(snapshot)
  const finalDropPackets = getFinalDropPacketCount(snapshot)
  const activeBlockedSources = getVerifiedSourceCount(snapshot)
  const [menuOpen, setMenuOpen] = useState(false)
  const [active, setActive] = useState('overview')
  const sidebar = useRef<HTMLElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const restoreFocusOnClose = useRef(false)
  const websocket = snapshot.services.websocket.status
  const websocketLabel = snapshot.dataMode === 'REPLAY'
    ? 'REPLAY / HISTORY'
    : websocket === 'connected'
      ? 'WebSocket kết nối'
      : websocket === 'connecting'
        ? 'Đang kết nối'
        : websocket === 'error'
          ? 'Lỗi WebSocket'
          : websocket === 'disconnected'
            ? snapshot.dataMode === 'LIVE' ? 'Mất kết nối · đang thử lại' : 'WebSocket chưa kết nối'
            : 'Chưa kết nối'
  const hasReceivedData =
    snapshot.receivedAt !== null && Number.isFinite(Date.parse(snapshot.receivedAt))

  useEffect(() => {
    let frame: number | null = null
    const updateActiveSection = () => {
      frame = null
      let activeId = 'overview'
      navigation.forEach(item => {
        const element = document.getElementById(item.id)
        if (element && element.getBoundingClientRect().top <= 130) {
          activeId = item.id
        }
      })
      setActive(activeId)
    }
    const scheduleUpdate = () => {
      if (frame === null) frame = window.requestAnimationFrame(updateActiveSection)
    }

    scheduleUpdate()
    window.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('resize', scheduleUpdate, { passive: true })
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
    }
  }, [])

  useEffect(() => {
    if (!menuOpen) {
      if (!restoreFocusOnClose.current) return
      const restoreFrame = window.requestAnimationFrame(() => {
        menuButton.current?.focus()
        restoreFocusOnClose.current = false
      })
      return () => window.cancelAnimationFrame(restoreFrame)
    }

    restoreFocusOnClose.current = true
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    let focusFrame = 0
    const focusCloseButton = () => {
      const panel = sidebar.current
      if (!panel) return
      if (getComputedStyle(panel).visibility !== 'visible') {
        focusFrame = window.requestAnimationFrame(focusCloseButton)
        return
      }
      panel.querySelector<HTMLButtonElement>('button')?.focus()
    }
    focusFrame = window.requestAnimationFrame(focusCloseButton)
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
      if (event.key !== 'Tab') return
      const elements = sidebar.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])',
      )
      const first = elements?.[0]
      const last = elements?.[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    const desktop = window.matchMedia('(min-width: 1101px)')
    const onResize = () => {
      if (desktop.matches) setMenuOpen(false)
    }
    document.addEventListener('keydown', handleKey)
    desktop.addEventListener('change', onResize)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKey)
      desktop.removeEventListener('change', onResize)
    }
  }, [menuOpen])

  function closeMenu() {
    setMenuOpen(false)
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content" tabIndex={menuOpen ? -1 : undefined}>
        Chuyển đến nội dung chính
      </a>
      {menuOpen && (
        <div className="sidebar-backdrop" aria-hidden="true" onClick={closeMenu} />
      )}
      <aside
        className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}
        ref={sidebar}
        id="sidebar"
        role={menuOpen ? 'dialog' : undefined}
        aria-modal={menuOpen ? true : undefined}
        aria-label="Điều hướng dashboard"
      >
        <div className="brand">
          <span className="brand-symbol">
            <Shield size={25} strokeWidth={1.7} aria-hidden="true" />
            <span />
          </span>
          <div>
            <strong>SENTINEL<span> SDN</span></strong>
            <p>SECURITY OPERATIONS</p>
          </div>
          <button
            className="icon-button sidebar-close"
            onClick={closeMenu}
            aria-label="Đóng điều hướng"
          >
            <X size={18} />
          </button>
        </div>
        <div className="workspace-label">
          <span className="workspace-icon"><Command size={15} /></span>
          <div>
            <strong>SDN Security Lab</strong>
            <span>Network workspace</span>
          </div>
          <span className="workspace-dot" />
        </div>
        <p className="nav-caption">KHÔNG GIAN GIÁM SÁT</p>
        <nav aria-label="Các khu vực dashboard">
          {navigation.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              className={active === id ? 'nav-link nav-active' : 'nav-link'}
              aria-current={active === id ? 'location' : undefined}
              onClick={() => {
                setActive(id)
                if (menuOpen) closeMenu()
              }}
            >
              <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
              <span>{label}</span>
              {active === id && <span className="nav-active-mark" />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <div>
              <Radio size={16} />
              <span>NGUỒN DỮ LIỆU</span>
            </div>
            <strong>
              {hasReceivedData ? 'Đã nhận snapshot B8' : 'Chờ snapshot B8'}
            </strong>
            <p>Read-only REST · WebSocket events</p>
            <a
              href="#system"
              onClick={() => {
                if (menuOpen) closeMenu()
              }}
            >
              Chi tiết kết nối <ArrowRight size={13} />
            </a>
          </div>
          <div className="sidebar-signature">
            <Shield size={15} />
            <span>SDN–AI DDoS Monitoring</span>
          </div>
        </div>
      </aside>

      <div className="main-shell" inert={menuOpen}>
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button menu-toggle"
              ref={menuButton}
              onClick={() => setMenuOpen(true)}
              aria-label="Mở điều hướng"
              aria-expanded={menuOpen}
              aria-controls="sidebar"
            >
              <Menu size={19} />
            </button>
            <span className="breadcrumb-icon"><LayoutDashboard size={16} /></span>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>Security overview</strong>
          </div>
          <div className="topbar-right">
            <span className="environment-label"><span /> SDN LAB</span>
            <a href="#system" className="connection-link">
              <StatusBadge
                tone={snapshot.dataMode === 'REPLAY'
                  ? 'cyan'
                  : websocket === 'connected'
                    ? 'green'
                    : websocket === 'error' || websocket === 'disconnected'
                      ? 'red'
                      : 'muted'}
              >
                {websocketLabel}
              </StatusBadge>
            </a>
            <span className="workspace-avatar" title="Không gian giám sát SDN">
              <Shield size={16} />
            </span>
          </div>
        </header>
        <main className="dashboard-content" id="main-content" tabIndex={-1}>
          <RunControl />
          <div className="page-heading" id="overview">
            <div>
              <p className="page-eyebrow"><span /> SENTINEL SDN · B8 READ-ONLY</p>
              <h1>AI DDoS Detection & Mitigation</h1>
              <p>Tổng quan prediction, cảnh báo, luật DROP và bằng chứng theo run đã chọn.</p>
            </div>
            <div className="updated-at">
              <span>BROWSER NHẬN DỮ LIỆU</span>
              <strong>{formatTimestamp(snapshot.receivedAt)}</strong>
              <small>UTC+07:00</small>
            </div>
          </div>
          {!hasReceivedData && (
            <div className="connection-notice">
              <div className="notice-icon"><Unplug size={19} /></div>
              <div>
                <strong>Dashboard đang chờ dữ liệu run B8</strong>
                <p>
                  Chọn run và tải snapshot để xem prediction cùng mitigation đã ghi nhận.
                </p>
              </div>
              <a href="#system">Xem trạng thái <ArrowRight size={15} /></a>
            </div>
          )}
          <div className="metrics-grid" aria-label="Tổng quan run B8">
            <MetricCard
              icon={Radio}
              label="Tổng prediction"
              value={formatMetric(snapshot.predictionCount)}
              note="Prediction ID duy nhất trong run"
            />
            <MetricCard
              icon={ShieldAlert}
              label="Attack predictions"
              value={formatMetric(attackPredictions)}
              note="syn_flood + udp_flood; không phải accuracy"
              accent="amber"
            />
            <MetricCard
              icon={ShieldCheck}
              label="DROP rules đã xác nhận"
              value={formatMetric(confirmedDropRules)}
              note="CONFIRMED trở đi; không phải số source"
              accent="blue"
            />
            <MetricCard
              icon={Shield}
              label="Nguồn từng được áp DROP"
              value={formatMetric(everDroppedSources)}
              note={`Đang bị chặn: ${formatMetric(activeBlockedSources)} IP · VERIFIED/DROPPING`}
              accent="violet"
            />
            <MetricCard
              icon={ShieldCheck}
              label="Final DROP packet counter"
              value={formatMetric(finalDropPackets)}
              note="REPLAY terminal; FlowRemoved đủ, cùng DPID"
            />
          </div>
          <div className="dashboard-grid analysis-grid">
            <AIDetection
              detection={snapshot.detection}
              modelName={snapshot.detection?.modelName ?? modelCandidateFromRevision(snapshot.run?.revision)}
              predictionCount={snapshot.predictionCount}
              predictionClassCounts={snapshot.predictionClassCounts}
              policy={snapshot.detection?.sampleId
                ? snapshot.policies.find((item) => item.sampleId === snapshot.detection?.sampleId) ?? null
                : null}
            />
            <AttackAlerts
              alerts={snapshot.alerts}
              rules={snapshot.mitigations}
              alertEventCount={snapshot.alertEventCount}
              historyComplete={snapshot.alertHistoryComplete}
            />
          </div>
          <MitigationPanel rules={snapshot.mitigations} complete={snapshot.mitigationsComplete} />
          <NetworkOverview
            dropCounters={snapshot.network.dropCounterHistory}
            dropCounterSampleCount={snapshot.network.dropCounterSampleCount}
            dropCounterHistoryComplete={snapshot.network.dropCounterHistoryComplete}
          />
          <AttackHistory
            key={`${snapshot.run?.runId ?? 'none'}:${snapshot.dataMode ?? 'none'}`}
            events={snapshot.history}
            dataMode={snapshot.dataMode}
            runId={snapshot.run?.runId ?? null}
          />
          <details className="dashboard-details" id="evidence">
            <summary>Evidence & chi tiết kỹ thuật</summary>
            <div className="evidence-grid">
              <ReplaySummary snapshot={snapshot} />
              <PerformancePanel performance={snapshot.performance} />
              {(snapshot.performance.mitigationMs === null
                || snapshot.performance.mitigationSampleCount === null
                || snapshot.performance.mitigationSampleCount === 0) && (
                <p className="measurement-note">
                  Chưa có request→counter đủ timestamp trong run này. Detection latency cần packet-first-seen;
                  RTT cần cặp request/response. Hai phép đo đó chưa có nguồn trong contract hiện tại.
                </p>
              )}
              <SystemStatus
                services={snapshot.services}
                receivedAt={snapshot.receivedAt}
                dataMode={snapshot.dataMode}
              />
              <Suspense
                fallback={
                  <Panel id="topology" title="SDN Topology" kicker="HẠ TẦNG MẠNG">
                    <EmptyState
                      icon={Shield}
                      title="Đang tải khung topology"
                      description="Đang chuẩn bị công cụ xem sơ đồ mạng."
                    />
                  </Panel>
                }
              >
                <TopologyPanel />
              </Suspense>
            </div>
          </details>
          <footer className="dashboard-footer">
            <span>
              <Shield size={13} /> SENTINEL SDN <span className="footer-separator">/</span> AI-powered network security
            </span>
            <span>
              <CircleHelp size={13} /> Chỉ số “—” biểu thị chưa có dữ liệu
            </span>
          </footer>
        </main>
      </div>
    </div>
  )
}
