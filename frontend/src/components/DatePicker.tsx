import { useState, useRef, useEffect } from 'react'
import { DayPicker, CaptionProps, useNavigation } from 'react-day-picker'
import { format, parse, isValid, setMonth, setYear, getMonth, getYear } from 'date-fns'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import 'react-day-picker/dist/style.css'

interface DatePickerProps {
  value: string
  onChange: (val: string) => void
  disabled?: boolean
  className?: string
  placeholder?: string
  label?: string
  required?: boolean
}

function parseYMD(s: string): Date | undefined {
  if (!s) return undefined
  const d = parse(s, 'yyyy-MM-dd', new Date())
  return isValid(d) ? d : undefined
}

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
]

const currentYear = new Date().getFullYear()
const YEARS = Array.from({ length: 100 }, (_, i) => currentYear - 80 + i)

function CustomCaption({ displayMonth }: CaptionProps) {
  const { goToMonth } = useNavigation()

  function handleMonthChange(e: React.ChangeEvent<HTMLSelectElement>) {
    goToMonth(setMonth(displayMonth, parseInt(e.target.value)))
  }

  function handleYearChange(e: React.ChangeEvent<HTMLSelectElement>) {
    goToMonth(setYear(displayMonth, parseInt(e.target.value)))
  }

  const selClass = 'text-sm font-semibold text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 cursor-pointer'

  return (
    <div className="flex items-center gap-2 px-1 mb-2">
      <select value={getMonth(displayMonth)} onChange={handleMonthChange} className={selClass + ' flex-1'}>
        {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
      </select>
      <select value={getYear(displayMonth)} onChange={handleYearChange} className={selClass}>
        {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  )
}

export function DatePicker({ value, onChange, disabled, className, placeholder, label, required }: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const [month, setMonthState] = useState<Date>(parseYMD(value) ?? new Date())
  const ref = useRef<HTMLDivElement>(null)

  const selected = parseYMD(value)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    const d = parseYMD(value)
    if (d) setMonthState(d)
  }, [value])

  function handleSelect(day: Date | undefined) {
    if (!day) return
    onChange(format(day, 'yyyy-MM-dd'))
    setOpen(false)
  }

  const displayValue = selected ? format(selected, 'dd MMM yyyy') : ''

  return (
    <div className="relative" ref={ref}>
      {label && (
        <label className="label">
          {label}{required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        className={[
          'input text-left flex items-center justify-between gap-2',
          !displayValue ? 'text-slate-400' : 'text-slate-800',
          disabled ? 'opacity-50 cursor-not-allowed bg-slate-50' : 'cursor-pointer',
          className ?? '',
        ].join(' ')}
      >
        <span className="flex-1 truncate">{displayValue || placeholder || 'Select date'}</span>
        <CalendarDays size={15} className="flex-shrink-0 text-slate-400" />
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 bg-white border border-slate-200 rounded-xl shadow-card-lg animate-fade-in"
          style={{ minWidth: 300 }}
        >
          <DayPicker
            mode="single"
            selected={selected}
            onSelect={handleSelect}
            month={month}
            onMonthChange={setMonthState}
            showOutsideDays
            components={{
              Caption: CustomCaption,
              IconLeft: () => <ChevronLeft size={14} />,
              IconRight: () => <ChevronRight size={14} />,
            }}
            classNames={{
              root: 'p-3',
              months: 'flex flex-col',
              month: 'space-y-1',
              caption: '',
              caption_label: 'hidden',
              nav: 'hidden',
              table: 'w-full border-collapse',
              head_row: 'flex',
              head_cell: 'w-9 text-center text-[11px] font-medium text-slate-400 py-1',
              row: 'flex mt-1',
              cell: 'w-9 text-center text-sm p-0',
              day: 'w-9 h-9 flex items-center justify-center rounded-lg text-sm text-slate-700 hover:bg-brand-50 hover:text-brand-700 transition-colors cursor-pointer',
              day_selected: 'bg-brand-600 text-white hover:bg-brand-600 hover:text-white font-semibold',
              day_today: 'font-semibold text-brand-600',
              day_outside: 'text-slate-300',
              day_disabled: 'text-slate-200 cursor-not-allowed',
            }}
          />
        </div>
      )}
    </div>
  )
}
