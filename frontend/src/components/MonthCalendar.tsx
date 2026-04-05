import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { leaveApi, calendarApi } from '../services/api'
import { format, startOfMonth, endOfMonth, eachDayOfInterval,
         getDay, isSameDay, isToday, isSameMonth } from 'date-fns'
import { Card } from './ui'

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface DayMeta {
  leaves:    { name: string; type: string; status: string }[]
  holidays:  { name: string }[]
  birthdays: { name: string; department?: string }[]
}

// ─── LEGEND PILL ─────────────────────────────────────────────────────────────

function LegendPill({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-500">
      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${color}`} />
      {label}
    </div>
  )
}

// ─── DAY CELL ────────────────────────────────────────────────────────────────

function DayCell({ date, meta, isCurrentMonth }: {
  date: Date
  meta: DayMeta
  isCurrentMonth: boolean
}) {
  const [hover, setHover] = useState(false)
  const today      = isToday(date)
  const dayOfWeek  = getDay(date) // 0=Sun, 6=Sat
  const isWeekend  = dayOfWeek === 0 || dayOfWeek === 6
  const hasHoliday = meta.holidays.length > 0
  const hasLeave   = meta.leaves.length > 0
  const hasBday    = meta.birthdays.length > 0
  const hasAny     = hasHoliday || hasLeave || hasBday

  const tooltip: string[] = [
    ...meta.holidays.map(h => `🟢 ${h.name}`),
    ...meta.leaves.map(l => `🔵 ${l.name} (${l.type.replace('_', ' ')})`),
    ...meta.birthdays.map(b => `🎂 ${b.name}'s Birthday`),
  ]

  return (
    <div
      className="relative"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className={[
        'relative flex flex-col items-center justify-start p-1 rounded-lg min-h-[52px] cursor-default transition-colors duration-100',
        !isCurrentMonth ? 'opacity-25' : '',
        today ? 'bg-brand-600 text-white ring-2 ring-brand-400 ring-offset-1' : '',
        !today && hasHoliday ? 'bg-emerald-50' : '',
        !today && isWeekend && !hasHoliday ? 'bg-slate-50 text-slate-400' : '',
        !today && !hasHoliday && !isWeekend ? 'hover:bg-slate-50' : '',
      ].join(' ')}>
        <span className={[
          'text-xs font-semibold leading-5 w-6 h-6 flex items-center justify-center rounded-full',
          today ? 'text-white' : isWeekend ? 'text-slate-400' : 'text-slate-700',
        ].join(' ')}>
          {format(date, 'd')}
        </span>

        {/* Dot indicators */}
        {isCurrentMonth && (
          <div className="flex gap-0.5 mt-0.5 flex-wrap justify-center">
            {hasHoliday && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
            )}
            {hasLeave && (
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
            )}
            {hasBday && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
            )}
          </div>
        )}
      </div>

      {/* Tooltip */}
      {hover && hasAny && isCurrentMonth && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 bg-slate-900 text-white rounded-xl shadow-lg p-2.5 pointer-events-none">
          <div className="space-y-1">
            {tooltip.map((t, i) => (
              <p key={i} className="text-[11px] leading-4">{t}</p>
            ))}
          </div>
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-slate-900" />
        </div>
      )}
    </div>
  )
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function MonthCalendar() {
  const [current, setCurrent] = useState(new Date())

  const year  = current.getFullYear()
  const month = current.getMonth() + 1 // 1-indexed

  // Fetch all leaves (all applications visible to everyone)
  const { data: allLeaves } = useQuery({
    queryKey: ['calendar-leaves', year, month],
    queryFn: () => leaveApi.allApplications({ year, month, limit: 200 }).then(r => r.data.data),
  })

  // Fetch public holidays
  const { data: holidays } = useQuery({
    queryKey: ['calendar-holidays', year],
    queryFn: () => leaveApi.holidays(year).then(r => r.data.data),
  })

  // Fetch birthdays for this month
  const { data: birthdays } = useQuery({
    queryKey: ['calendar-birthdays', month],
    queryFn: () => calendarApi.birthdays(month).then(r => r.data.data),
  })

  // Build day map
  const start = startOfMonth(current)
  const end   = endOfMonth(current)
  const days  = eachDayOfInterval({ start, end })

  // Leading empty cells for grid alignment (Mon-start grid)
  const startDow = (getDay(start) + 6) % 7 // 0=Mon
  const leadingBlanks = Array(startDow).fill(null)

  // Build date→meta map
  const metaMap = new Map<string, DayMeta>()
  const getOrCreate = (key: string): DayMeta => {
    if (!metaMap.has(key)) metaMap.set(key, { leaves: [], holidays: [], birthdays: [] })
    return metaMap.get(key)!
  }

  // Leaves — expand date range
  ;(allLeaves || []).forEach((lv: any) => {
    if (!['APPROVED', 'PENDING'].includes(lv.status)) return
    const s = new Date(lv.startDate)
    const e = new Date(lv.endDate)
    eachDayOfInterval({ start: s, end: e }).forEach(d => {
      if (d.getMonth() + 1 !== month || d.getFullYear() !== year) return
      const key = format(d, 'yyyy-MM-dd')
      getOrCreate(key).leaves.push({
        name:   lv.employee?.name || 'Unknown',
        type:   lv.leaveType || lv.reason?.leaveType || '',
        status: lv.status,
      })
    })
  })

  // Holidays
  ;(holidays || []).forEach((h: any) => {
    const d = new Date(h.date)
    if (d.getMonth() + 1 !== month || d.getFullYear() !== year) return
    const key = format(d, 'yyyy-MM-dd')
    getOrCreate(key).holidays.push({ name: h.name })
  })

  // Birthdays — match by month+day regardless of year
  ;(birthdays || []).forEach((b: any) => {
    if (!b.dateOfBirth) return
    const bd = new Date(b.dateOfBirth)
    // Find matching day in current displayed month
    const matchDay = days.find(d =>
      d.getDate() === bd.getDate() && d.getMonth() === bd.getMonth()
    )
    if (!matchDay) return
    const key = format(matchDay, 'yyyy-MM-dd')
    getOrCreate(key).birthdays.push({ name: b.name, department: b.department })
  })

  const prevMonth = () => setCurrent(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))
  const nextMonth = () => setCurrent(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))
  const goToday   = () => setCurrent(new Date())

  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  // Upcoming events sidebar (next 7 days)
  const today = new Date()
  const upcoming: { date: Date; label: string; color: string }[] = []
  for (let i = 0; i < 14; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i)
    if (!isSameMonth(d, current) && i > 0) break
    const key = format(d, 'yyyy-MM-dd')
    const meta = metaMap.get(key)
    if (!meta) continue
    meta.holidays.forEach(h => upcoming.push({ date: d, label: h.name, color: 'bg-emerald-100 text-emerald-800' }))
    meta.birthdays.forEach(b => upcoming.push({ date: d, label: `${b.name}'s Birthday`, color: 'bg-amber-100 text-amber-800' }))
    meta.leaves.slice(0, 2).forEach(l => upcoming.push({ date: d, label: `${l.name} on leave`, color: 'bg-blue-100 text-blue-800' }))
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
      {/* Calendar */}
      <Card className="xl:col-span-2 p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
              <ChevronLeft size={16} />
            </button>
            <h3 className="text-sm font-semibold text-slate-800 min-w-[130px] text-center">
              {format(current, 'MMMM yyyy')}
            </h3>
            <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>
          <button onClick={goToday} className="text-xs font-medium text-brand-600 hover:text-brand-800 px-2.5 py-1 rounded-lg hover:bg-brand-50 transition-colors">
            Today
          </button>
        </div>

        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 mb-1">
          {DOW.map(d => (
            <div key={d} className="text-center text-[10px] font-semibold text-slate-400 uppercase py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Grid */}
        <div className="grid grid-cols-7 gap-0.5">
          {leadingBlanks.map((_, i) => <div key={`b-${i}`} />)}
          {days.map(day => {
            const key  = format(day, 'yyyy-MM-dd')
            const meta = metaMap.get(key) || { leaves: [], holidays: [], birthdays: [] }
            return (
              <DayCell
                key={key}
                date={day}
                meta={meta}
                isCurrentMonth={isSameMonth(day, current)}
              />
            )
          })}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 mt-4 pt-3 border-t border-slate-100">
          <LegendPill color="bg-emerald-500" label="Public Holiday" />
          <LegendPill color="bg-blue-500"    label="Leave" />
          <LegendPill color="bg-amber-400"   label="Birthday" />
          <LegendPill color="bg-brand-600"   label="Today" />
        </div>
      </Card>

      {/* Upcoming sidebar */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Upcoming Events</h3>
        {upcoming.length === 0 ? (
          <p className="text-xs text-slate-400 py-4 text-center">No upcoming events</p>
        ) : (
          <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
            {upcoming.map((ev, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <div className="flex-shrink-0 text-center w-9">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase leading-none">
                    {format(ev.date, 'MMM')}
                  </p>
                  <p className="text-lg font-bold text-slate-700 leading-tight">
                    {format(ev.date, 'd')}
                  </p>
                </div>
                <span className={`text-[11px] font-medium px-2 py-1 rounded-lg leading-4 ${ev.color}`}>
                  {ev.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
