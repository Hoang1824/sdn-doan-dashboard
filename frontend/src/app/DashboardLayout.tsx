import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import {
  Activity,
  ArrowRight,
  Bell,
  BrainCircuit,
  ChevronRight,
  CircleHelp,
  Command,
  Gauge,
  History,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  Network,
  Radio,
  Server,
  Shield,
  ShieldCheck,
  Unplug,
  X,
} from 'lucide-react'
import {
  EmptyState,
  MetricCard,
  Panel,
  StatusBadge,
  formatTimestamp,
} from '../components/ui'
import { useDashboard } from '../data/useDashboard'
import { formatMetric, getVerifiedSourceCount } from '../data/presentation'
import { NetworkOverview } from '../features/network/NetworkOverview'
import { AIDetection } from '../features/detection/AIDetection'
import { AttackAlerts } from '../features/alerts/AttackAlerts'
import { MitigationPanel } from '../features/mitigation/MitigationPanel'
import { AttackHistory } from '../features/history/AttackHistory'
import { PerformancePanel } from '../features/performance/PerformancePanel'
import { SystemStatus } from '../features/system-status/SystemStatus'

const TopologyPanel = lazy(() =>
  import('../features/topology/TopologyPanel').then(module => ({
    default: module.TopologyPanel,
  })),
)

const navigation = [
  { id: 'overview', label: 'Tổng quan', icon: LayoutDashboard },
  { id: 'network', label: 'Network Overview', icon: Activity },
  { id: 'detection', label: 'AI Detection', icon: BrainCircuit },
  { id: 'alerts', label: 'Attack Alerts', icon: Bell },
  { id: 'topology', label: 'SDN Topology', icon: Network },
  { id: 'mitigation', label: 'Mitigation', icon: ShieldCheck },
  { id: 'history', label: 'Attack History', icon: History },
  { id: 'performance', label: 'Performance', icon: Gauge },
  { id: 'system', label: 'System Status', icon: Server },
]

export function DashboardLayout() {
  const snapshot = useDashboard()
  const [menuOpen, setMenuOpen] = useState(false)
  const [active, setActive] = useState('overview')
  const sidebar = useRef<HTMLElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const restoreFocusOnClose = useRef(false)
  const websocket = snapshot.services.websocket.status
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
    const focusFrame = window.requestAnimationFrame(() => {
      // Apply the responsive sidebar's visible layout before moving focus.
      sidebar.current?.getBoundingClientRect()
      sidebar.current?.querySelector<HTMLButtonElement>('button')?.focus()
    })
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
              {hasReceivedData ? 'Đã nhận dữ liệu hệ thống' : 'Chờ kết nối hệ thống'}
            </strong>
            <p>AI inference · Ryu controller</p>
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
                tone={websocket === 'connected' ? 'green' : websocket === 'error' ? 'red' : 'muted'}
              >
                {websocket === 'connected'
                  ? 'WebSocket kết nối'
                  : websocket === 'connecting'
                    ? 'Đang kết nối'
                    : websocket === 'error'
                      ? 'Lỗi WebSocket'
                      : websocket === 'disconnected'
                        ? 'Mất kết nối'
                        : 'Chưa kết nối'}
              </StatusBadge>
            </a>
            <span className="workspace-avatar" title="Không gian giám sát SDN">
              <Shield size={16} />
            </span>
          </div>
        </header>
        <main className="dashboard-content" id="main-content" tabIndex={-1}>
          <div className="page-heading" id="overview">
            <div>
              <p className="page-eyebrow"><span /> SECURITY OPERATIONS CENTER</p>
              <h1>Tổng quan an ninh mạng</h1>
              <p>Giám sát, phát hiện và theo dõi giảm thiểu DDoS trong mạng SDN.</p>
            </div>
            <div className="updated-at">
              <span>DỮ LIỆU GẦN NHẤT</span>
              <strong>{formatTimestamp(snapshot.receivedAt)}</strong>
              <small>UTC+07:00</small>
            </div>
          </div>
          {!hasReceivedData && (
            <div className="connection-notice">
              <div className="notice-icon"><Unplug size={19} /></div>
              <div>
                <strong>Dashboard đang chờ dữ liệu hệ thống</strong>
                <p>
                  Các chỉ số sẽ xuất hiện khi kết nối nguồn AI và SDN. Hiện chưa có dữ liệu giám sát.
                </p>
              </div>
              <a href="#system">Xem trạng thái <ArrowRight size={15} /></a>
            </div>
          )}
          <div className="metrics-grid" aria-label="Thống kê mạng tổng quan">
            <MetricCard
              icon={Activity}
              label="Lưu lượng mạng"
              value={formatMetric(snapshot.network.throughputMbps, 2)}
              unit="Mbps"
              note="Tổng lưu lượng đo được"
            />
            <MetricCard
              icon={Network}
              label="Tốc độ gói tin"
              value={formatMetric(snapshot.network.packetsPerSecond)}
              unit="pps"
              note="Số gói tin mỗi giây"
              accent="blue"
            />
            <MetricCard
              icon={Bell}
              label="Cảnh báo đang hoạt động"
              value={formatMetric(snapshot.network.activeAlerts)}
              note="Theo trạng thái từ hệ thống"
              accent="amber"
            />
            <MetricCard
              icon={LockKeyhole}
              label="Nguồn đã chặn xác minh"
              value={formatMetric(getVerifiedSourceCount(snapshot))}
              note="Có bằng chứng controller / switch"
              accent="violet"
            />
          </div>
          <div className="dashboard-grid analysis-grid">
            <NetworkOverview traffic={snapshot.network.traffic} />
            <AIDetection detection={snapshot.detection} />
          </div>
          <AttackAlerts alerts={snapshot.alerts} />
          <div className="section-divider">
            <span>HẠ TẦNG & PHẢN ỨNG</span>
            <div />
          </div>
          <div className="dashboard-grid operations-grid">
            <Suspense
              fallback={
                <Panel id="topology" title="SDN Topology" kicker="HẠ TẦNG MẠNG">
                  <EmptyState
                    icon={Network}
                    title="Đang tải khung topology"
                    description="Đang chuẩn bị công cụ xem sơ đồ mạng."
                  />
                </Panel>
              }
            >
              <TopologyPanel />
            </Suspense>
            <MitigationPanel rules={snapshot.mitigations} />
          </div>
          <AttackHistory events={snapshot.history} />
          <div className="dashboard-grid health-grid">
            <PerformancePanel performance={snapshot.performance} />
            <SystemStatus
              services={snapshot.services}
              receivedAt={snapshot.receivedAt}
            />
          </div>
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
