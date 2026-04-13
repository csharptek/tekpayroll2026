import { forwardRef, ReactNode } from 'react'
import clsx from 'clsx'
import { Loader2, ChevronUp, ChevronDown, AlertCircle, CheckCircle2, Info } from 'lucide-react'

// ─── STAT CARD ────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  icon?: ReactNode
  trend?: { value: number; label: string }
  color?: 'blue' | 'green' | 'amber' | 'red' | 'purple'
  loading?: boolean
}

const colorMap = {
  blue:   { bg: 'bg-blue-50',   icon: 'text-blue-500',   bar: 'bg-blue-500' },
  green:  { bg: 'bg-emerald-50', icon: 'text-emerald-500', bar: 'bg-emerald-500' },
  amber:  { bg: 'bg-amber-50',  icon: 'text-amber-500',  bar: 'bg-amber-500' },
  red:    { bg: 'bg-red-50',    icon: 'text-red-500',    bar: 'bg-red-500' },
  purple: { bg: 'bg-purple-50', icon: 'text-purple-500', bar: 'bg-purple-500' },
}

export function StatCard({ label, value, sub, icon, trend, color = 'blue', loading }: StatCardProps) {
  const c = colorMap[color]
  return (
    <div className="card p-5 flex flex-col gap-3 hover:shadow-card-md transition-shadow duration-200">
      <div className="flex items-start justify-between">
        <div>
          <p className="stat-label">{label}</p>
          {loading
            ? <div className="h-8 w-28 bg-slate-100 animate-pulse rounded-lg mt-1" />
            : <p className="stat-value mt-1">{value}</p>
          }
          {sub && <p className="stat-sub mt-0.5">{sub}</p>}
        </div>
        {icon && (
          <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center', c.bg)}>
            <span className={c.icon}>{icon}</span>
          </div>
        )}
      </div>
      {trend && (
        <div className="flex items-center gap-1.5 text-xs">
          {trend.value >= 0
            ? <ChevronUp size={14} className="text-emerald-500" />
            : <ChevronDown size={14} className="text-red-500" />
          }
          <span className={trend.value >= 0 ? 'text-emerald-600' : 'text-red-600'}>
            {Math.abs(trend.value)}%
          </span>
          <span className="text-slate-400">{trend.label}</span>
        </div>
      )}
    </div>
  )
}

// ─── BUTTON ──────────────────────────────────────────────────────────────────

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, icon, children, className, disabled, ...props }, ref) => {
    const base = 'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed'
    const variants = {
      primary: 'bg-brand-600 hover:bg-brand-700 text-white shadow-sm hover:shadow-card-md',
      secondary: 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-sm',
      danger: 'bg-red-600 hover:bg-red-700 text-white shadow-sm',
      ghost: 'text-slate-600 hover:text-slate-900 hover:bg-slate-100',
    }
    const sizes = {
      sm: 'text-xs px-3 py-1.5',
      md: 'text-sm px-4 py-2',
      lg: 'text-sm px-5 py-2.5',
    }
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={clsx(base, variants[variant], sizes[size], className)}
        {...props}
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
        {children}
      </button>
    )
  }
)
Button.displayName = 'Button'

// ─── INPUT ────────────────────────────────────────────────────────────────────

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  leftIcon?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, leftIcon, className, ...props }, ref) => (
    <div className="flex flex-col gap-1">
      {label && <label className="label">{label}</label>}
      <div className="relative">
        {leftIcon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            {leftIcon}
          </div>
        )}
        <input
          ref={ref}
          className={clsx(
            'input',
            leftIcon && 'pl-9',
            error && 'border-red-300 focus:border-red-400 focus:ring-red-400/20',
            className
          )}
          {...props}
        />
      </div>
      {error && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={11} />{error}</p>}
      {hint && !error && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  )
)
Input.displayName = 'Input'

// ─── SELECT ──────────────────────────────────────────────────────────────────

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options: { value: string; label: string }[]
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, className, ...props }, ref) => (
    <div className="flex flex-col gap-1">
      {label && <label className="label">{label}</label>}
      <select
        ref={ref}
        className={clsx('input appearance-none', error && 'border-red-300', className)}
        {...props}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
)
Select.displayName = 'Select'

// ─── TABLE ────────────────────────────────────────────────────────────────────

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('overflow-x-auto', className)}>
      <table className="w-full border-collapse">{children}</table>
    </div>
  )
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th className={clsx('table-header bg-slate-50 border-b border-slate-100 first:rounded-tl-lg last:rounded-tr-lg', className)}>
      {children}
    </th>
  )
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={clsx('table-cell', className)}>{children}</td>
}

export function Tr({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <tr
      className={clsx('table-row', onClick && 'cursor-pointer', className)}
      onClick={onClick}
    >
      {children}
    </tr>
  )
}

// ─── BADGE ────────────────────────────────────────────────────────────────────

const badgeVariants: Record<string, string> = {
  ACTIVE:      'badge-green',
  INACTIVE:    'badge-gray',
  ON_NOTICE:   'badge-yellow',
  SEPARATED:   'badge-red',
  DRAFT:       'badge-gray',
  CALCULATED:  'badge-blue',
  LOCKED:      'badge-purple',
  DISBURSED:   'badge-green',
  PENDING:     'badge-gray',
  GENERATED:   'badge-blue',
  EMAILED:     'badge-green',
  FAILED:      'badge-red',
  ADJUSTED:    'badge-yellow',
  ACTIVE_LOAN: 'badge-blue',
  CLOSED:      'badge-gray',
  // Asset statuses
  AVAILABLE:   'badge-green',
  ASSIGNED:    'badge-blue',
  UNDER_REPAIR:'badge-yellow',
  RETIRED:     'badge-gray',
  // Asset condition
  GOOD:        'badge-green',
  DAMAGED:     'badge-yellow',
  LOST:        'badge-red',
  // Asset request
  APPROVED:    'badge-green',
  REJECTED:    'badge-red',
  NEEDED:      'badge-blue',
  RETURN:      'badge-yellow',
}

export function StatusBadge({ status }: { status: string }) {
  const cls = badgeVariants[status] || 'badge-gray'
  return (
    <span className={clsx('badge', cls)}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

// ─── EMPTY STATE ──────────────────────────────────────────────────────────────

export function EmptyState({ icon, title, description, action }: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {icon && (
        <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-4 text-slate-400">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-slate-700 mb-1">{title}</p>
      {description && <p className="text-xs text-slate-400 mb-4 max-w-xs">{description}</p>}
      {action}
    </div>
  )
}

// ─── LOADING SKELETON ─────────────────────────────────────────────────────────

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('bg-slate-100 animate-pulse rounded-lg', className)} />
}

export function TableSkeleton({ rows = 5, cols = 5 }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={j} className={clsx('h-5', j === 0 ? 'w-28' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  )
}

// ─── PAGE HEADER ─────────────────────────────────────────────────────────────

export function PageHeader({ title, subtitle, actions }: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  )
}

// ─── CARD ────────────────────────────────────────────────────────────────────

export function Card({ children, className, title, action }: {
  children: ReactNode
  className?: string
  title?: string
  action?: ReactNode
}) {
  return (
    <div className={clsx('card', className)}>
      {title && (
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <p className="section-title">{title}</p>
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

// ─── ALERT ────────────────────────────────────────────────────────────────────

export function Alert({ type = 'info', title, message }: {
  type?: 'info' | 'success' | 'warning' | 'error'
  title?: string
  message: string
}) {
  const styles = {
    info:    { wrap: 'bg-blue-50 border-blue-200',   icon: <Info size={16} className="text-blue-500" />,          text: 'text-blue-800' },
    success: { wrap: 'bg-emerald-50 border-emerald-200', icon: <CheckCircle2 size={16} className="text-emerald-500" />, text: 'text-emerald-800' },
    warning: { wrap: 'bg-amber-50 border-amber-200', icon: <AlertCircle size={16} className="text-amber-500" />,   text: 'text-amber-800' },
    error:   { wrap: 'bg-red-50 border-red-200',     icon: <AlertCircle size={16} className="text-red-500" />,     text: 'text-red-800' },
  }
  const s = styles[type]
  return (
    <div className={clsx('flex gap-3 p-4 rounded-xl border text-sm', s.wrap)}>
      <span className="flex-shrink-0 mt-0.5">{s.icon}</span>
      <div>
        {title && <p className={clsx('font-semibold mb-0.5', s.text)}>{title}</p>}
        <p className={clsx(s.text, 'opacity-90')}>{message}</p>
      </div>
    </div>
  )
}

// ─── MODAL ────────────────────────────────────────────────────────────────────

export function Modal({ open, onClose, title, children, footer }: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg animate-slide-up">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5">{children}</div>
        {footer && (
          <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2 bg-slate-50 rounded-b-2xl">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── RUPEE FORMAT ────────────────────────────────────────────────────────────

export function Rupee({ amount, className }: { amount: number | string; className?: string }) {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num)
  return (
    <span className={clsx('rupee', className)}>₹{formatted}</span>
  )
}

// ─── SEARCH BAR ──────────────────────────────────────────────────────────────

export function SearchBar({ value, onChange, placeholder = 'Search...' }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="relative">
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input pl-9 w-full"
      />
    </div>
  )
}

// ─── DIVIDER ─────────────────────────────────────────────────────────────────

export function Divider({ label }: { label?: string }) {
  if (!label) return <hr className="border-slate-100 my-4" />
  return (
    <div className="flex items-center gap-3 my-4">
      <hr className="flex-1 border-slate-100" />
      <span className="text-xs text-slate-400 font-medium">{label}</span>
      <hr className="flex-1 border-slate-100" />
    </div>
  )
}
