import React from 'react'

// ── Badge ─────────────────────────────────────────────────────────────────────
type BadgeVariant = 'green' | 'amber' | 'red' | 'blue' | 'teal' | 'gray' | 'purple'
export function Badge({ variant, children }: { variant: BadgeVariant; children: React.ReactNode }) {
  return <span className={`badge badge-${variant}`}>{children}</span>
}

export function CallBadge({ status }: { status: string }) {
  const v: Record<string, BadgeVariant> = { answered: 'green', missed: 'red', abandoned: 'amber' }
  return <Badge variant={v[status] ?? 'gray'}>{status || '—'}</Badge>
}

// ── Empty state ───────────────────────────────────────────────────────────────
export function Empty({ msg = 'No data' }: { msg?: string }) {
  return <div className="empty">{msg}</div>
}

// ── Stat card ─────────────────────────────────────────────────────────────────
export function StatCard({ label, value, color, desc }: {
  label: string; value: string | number; color?: string; desc?: string
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={color ? { color } : {}}>{value}</div>
      {desc && <div className="stat-desc">{desc}</div>}
    </div>
  )
}

// ── Button ────────────────────────────────────────────────────────────────────
interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'danger' | 'sm'
  loading?: boolean
}
export function Btn({ variant = 'default', loading, children, className, ...props }: BtnProps) {
  const cls = [
    'btn',
    variant === 'primary' ? 'btn-primary' : '',
    variant === 'danger'  ? 'btn-danger'  : '',
    variant === 'sm'      ? 'btn-sm'      : '',
    className ?? '',
  ].join(' ').trim()
  return (
    <button className={cls} disabled={loading || props.disabled} {...props}>
      {loading ? '…' : children}
    </button>
  )
}

// ── Form input ────────────────────────────────────────────────────────────────
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className="inp" {...props} />
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="inp" style={{ background: 'var(--bg2)', cursor: 'pointer' }} {...props} />
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="inp" {...props} />
}

// ── Card ──────────────────────────────────────────────────────────────────────
export function Card({
  title, subtitle, action, children, style,
}: {
  title?: React.ReactNode
  subtitle?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <div className="card" style={style}>
      {(title || action) && (
        <div className="card-header">
          <div>
            {title && <div className="card-title">{title}</div>}
            {subtitle && <div className="card-sub">{subtitle}</div>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

// ── Tab bar ───────────────────────────────────────────────────────────────────
export function TabBar({ tabs, active, onChange }: {
  tabs: { key: string; label: string }[]
  active: string
  onChange: (key: string) => void
}) {
  return (
    <div className="tab-row">
      {tabs.map(t => (
        <button
          key={t.key}
          className={`tab-btn ${active === t.key ? 'active' : ''}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ── Mono cell ─────────────────────────────────────────────────────────────────
export function Mono({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <span className="mono" style={style}>{children}</span>
}
