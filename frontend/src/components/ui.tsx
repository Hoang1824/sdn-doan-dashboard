import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export function Panel({ id, title, kicker, subtitle, action, className = '', children }: {
  id?: string; title: string; kicker?: string; subtitle?: string
  action?: ReactNode; className?: string; children: ReactNode
}) {
  return <section id={id} className={`panel ${className}`} aria-label={title}>
    <div className="panel-header">
      <div>{kicker && <p className="panel-kicker">{kicker}</p>}<h2>{title}</h2>{subtitle && <p className="panel-subtitle">{subtitle}</p>}</div>
      {action && <div className="panel-action">{action}</div>}
    </div>
    {children}
  </section>
}

export function StatusBadge({ tone = 'muted', children }: {
  tone?: 'muted' | 'cyan' | 'amber' | 'red' | 'green'; children: ReactNode
}) {
  return <span className={`status-badge status-${tone}`}><span className="status-dot" aria-hidden="true" />{children}</span>
}

export function EmptyState({ icon: Icon, title, description, compact = false }: {
  icon: LucideIcon; title: string; description: string; compact?: boolean
}) {
  return <div className={`empty-state ${compact ? 'empty-compact' : ''}`}>
    <div className="empty-icon"><Icon size={23} strokeWidth={1.4} aria-hidden="true" /></div>
    <h3>{title}</h3><p>{description}</p>
  </div>
}

export function MetricCard({ icon: Icon, label, value, unit, note, accent = 'cyan' }: {
  icon: LucideIcon; label: string; value: string; unit?: string; note: string; accent?: 'cyan' | 'blue' | 'amber' | 'violet'
}) {
  return <article className={`metric-card metric-${accent}`}>
    <div className="metric-heading"><span>{label}</span><span className="metric-icon"><Icon size={18} aria-hidden="true" /></span></div>
    <div className="metric-value"><strong>{value}</strong>{unit && <span>{unit}</span>}</div>
    <div className="metric-note"><span className="tiny-dash" aria-hidden="true" />{note}</div>
  </article>
}

export function formatTimestamp(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return '—'
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(value))
}
