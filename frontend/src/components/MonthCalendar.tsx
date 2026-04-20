import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { leaveApi, calendarApi } from '../services/api'
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  getDay, isToday, isSameMonth, isSameDay
} from 'date-fns'
import { Card } from './ui'

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface DayMeta {
  leaves:    { name: string; type: string; status: string; isHalfDay: boolean; halfDaySlot?: string }[]
  holidays:  { name: string }[]
  birthdays: { name: string; department?: string }[]
}

// ─── LEGEND ──────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-4 pt-3 border-t border-slate-100">
      {[
        { emoji: '🏖️', label: 'Public Holiday', bg: 'bg-emerald-50' },
        { emoji: '🌿', label: 'Leave',           bg: 'bg-blue-50'    },
        { emoji: '🎂', label: 'Birthday',         bg: 'bg-amber-50'  },
      ].map(({ emoji, label, bg }) => (
        <div key={label} className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className={`w-6 h-6 rounded-md ${bg} flex items-center justify-center text-sm`}>{emoji}</span>
          {label}
        </div>
      ))}
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <span className="w-6 h-6 rounded-md bg-brand-600 flex items-center justify-center text-xs font-bold text-white">T</span>
        Today
      </div>
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

  const today     = isToday(date)
  const dow       = getDay(date)
  const isWeekend = dow === 0 || dow === 6

  const hasHoliday = meta.holidays.length > 0
  const hasLeave   = meta.leaves.length > 0
  const hasBday    = meta.birthdays.length > 0

  // Tooltip lines
  const tooltipLines: string[] = [
    ...meta.holidays.map(h => `🏖️ ${h.name}`),
    ...meta.leaves.map(l => {
      const halfInfo = l.isHalfDay ? ` (half day${l.halfDaySlot === 'FIRST' ? ' - AM' : l.halfDaySlot === 'SECOND' ? ' - PM' : ''})` : ''
      return `🌿 ${l.name}${halfInfo}${l.status === 'PENDING' ? ' · pending' : ''}`
    }),
    ...meta.birthdays.map(b => `🎂 ${b.name}`),
  ]

  // Cell background
  let cellBg = ''
  if (today)         cellBg = 'bg-brand-600 ring-2 ring-brand-400 ring-offset-1'
  else if (hasHoliday) cellBg = 'bg-emerald-50 border border-emerald-200'
  else if (isWeekend)  cellBg = 'bg-slate-50'

  return (
    <div
      className="relative"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className={[
        'flex flex-col items-center gap-0.5 px-0.5 py-1 rounded-lg min-h-[64px] transition-colors duration-100',
        !isCurrentMonth ? 'opacity-20 pointer-events-none' : '',
        cellBg,
        !today && !hasHoliday ? 'hover:bg-slate-100 cursor-default' : '',
      ].filter(Boolean).join(' ')}>

        {/* Day number */}
        <span className={[
          'text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full flex-shrink-0',
          today ? 'text-white' : isWeekend ? 'text-slate-400' : 'text-slate-700',
        ].join(' ')}>
          {format(date, 'd')}
        </span>

        {/* Emoji indicators — visible icons */}
        {isCurrentMonth && (
          <div className="flex flex-col items-center gap-0.5 w-full">
            {hasHoliday && (
              <span className="text-sm leading-none" title={meta.holidays[0].name}>🏖️</span>
            )}
            {hasLeave && (
              <span className="text-sm leading-none" title={`${meta.leaves.length} on leave`}>
                🌿{meta.leaves.length > 1 ? <sup className="text-[8px] font-bold text-blue-600 ml-0.5">{meta.leaves.length}</sup> : null}
              </span>
            )}
            {hasBday && (
              <span className="text-sm leading-none" title={`${meta.birthdays[0].name}'s birthday`}>🎂</span>
            )}
          </div>
        )}
      </div>

      {/* Hover tooltip */}
      {hover && tooltipLines.length > 0 && isCurrentMonth && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-72 bg-slate-900 text-white rounded-xl shadow-xl p-2.5 pointer-events-none">
          <div className="space-y-1">
            {tooltipLines.map((t, i) => (
              <p key={i} className="text-[11px] leading-4 break-words">{t}</p>
            ))}
          </div>
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
        </div>
      )}
    </div>
  )
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

export default function MonthCalendar() {
  const [current, setCurrent] = useState(new Date())

  const year  = current.getFullYear()
  const month = current.getMonth() + 1

  const { data: allLeaves } = useQuery({
    queryKey: ['calendar-leaves', year, month],
    queryFn: () => leaveApi.allApplications({ year, month, limit: 200 }).then(r => r.data.data),
  })

  const { data: holidays } = useQuery({
    queryKey: ['calendar-holidays', year],
    queryFn: () => leaveApi.holidays(year).then(r => r.data.data),
  })

  const { data: birthdays } = useQuery({
    queryKey: ['calendar-birthdays', month],
    queryFn: () => calendarApi.birthdays(month).then(r => r.data.data),
  })

  const start = startOfMonth(current)
  const end   = endOfMonth(current)
  const days  = eachDayOfInterval({ start, end })

  // Mon-start grid leading blanks
  const leadingBlanks = Array((getDay(start) + 6) % 7).fill(null)

  // Build day→meta map
  const metaMap = new Map<string, DayMeta>()
  const get = (key: string): DayMeta => {
    if (!metaMap.has(key)) metaMap.set(key, { leaves: [], holidays: [], birthdays: [] })
    return metaMap.get(key)!
  }

  ;(allLeaves || []).forEach((lv: any) => {
    if (!['APPROVED', 'AUTO_APPROVED', 'PENDING'].includes(lv.status)) return
    eachDayOfInterval({ start: new Date(lv.startDate), end: new Date(lv.endDate) }).forEach(d => {
      if (d.getMonth() + 1 !== month || d.getFullYear() !== year) return
      get(format(d, 'yyyy-MM-dd')).leaves.push({
        name:        lv.employee?.name || 'Unknown',
        type:        lv.leaveKind || '',
        status:      lv.status,
        isHalfDay:   Boolean(lv.isHalfDay),
        halfDaySlot: lv.halfDaySlot || undefined,
      })
    })
  })

  ;(holidays || []).forEach((h: any) => {
    const d = new Date(h.date)
    if (d.getMonth() + 1 !== month || d.getFullYear() !== year) return
    get(format(d, 'yyyy-MM-dd')).holidays.push({ name: h.name })
  })

  ;(birthdays || []).forEach((b: any) => {
    if (!b.dateOfBirth) return
    const bd = new Date(b.dateOfBirth)
    const match = days.find(d => d.getDate() === bd.getDate() && d.getMonth() === bd.getMonth())
    if (!match) return
    get(format(match, 'yyyy-MM-dd')).birthdays.push({ name: b.name, department: b.department })
  })

  // All events in the displayed month, grouped by date (sorted ascending)
  type Event = { icon: string; label: string; color: string }
  const groups: { date: Date; key: string; events: Event[] }[] = []
  days.forEach(d => {
    const key  = format(d, 'yyyy-MM-dd')
    const meta = metaMap.get(key)
    if (!meta) return
    const events: Event[] = []
    meta.holidays.forEach(h => events.push({ icon: '🏖️', label: h.name, color: 'bg-emerald-50 text-emerald-800 border-emerald-200' }))
    meta.birthdays.forEach(b => events.push({ icon: '🎂', label: `${b.name}'s Birthday`, color: 'bg-amber-50 text-amber-800 border-amber-200' }))
    meta.leaves.forEach(l => {
      const halfInfo = l.isHalfDay ? ` · half day${l.halfDaySlot === 'FIRST' ? ' (AM)' : l.halfDaySlot === 'SECOND' ? ' (PM)' : ''}` : ''
      events.push({ icon: '🌿', label: `${l.name} on leave${halfInfo}`, color: 'bg-blue-50 text-blue-800 border-blue-200' })
    })
    if (events.length) groups.push({ date: d, key, events })
  })

  const totalEvents = groups.reduce((n, g) => n + g.events.length, 0)

  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

      {/* Calendar */}
      <Card className="xl:col-span-2 p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1">
            <button onClick={() => setCurrent(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
              <ChevronLeft size={16} />
            </button>
            <h3 className="text-sm font-semibold text-slate-800 min-w-[130px] text-center">
              {format(current, 'MMMM yyyy')}
            </h3>
            <button onClick={() => setCurrent(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>
          <button
            onClick={() => setCurrent(new Date())}
            className="text-xs font-medium text-brand-600 hover:text-brand-800 px-2.5 py-1 rounded-lg hover:bg-brand-50 transition-colors"
          >
            Today
          </button>
        </div>

        {/* DOW headers */}
        <div className="grid grid-cols-7 mb-1">
          {DOW.map(d => (
            <div key={d} className="text-center text-[10px] font-semibold text-slate-400 uppercase py-1">{d}</div>
          ))}
        </div>

        {/* Day grid */}
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

        <Legend />
      </Card>

      {/* Events sidebar — grouped by date, auto-scrolls to today */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">
          Events in {format(current, 'MMMM')}
        </h3>
        {totalEvents === 0 ? (
          <div className="py-8 text-center">
            <p className="text-2xl mb-2">📅</p>
            <p className="text-xs text-slate-400">No events this month</p>
          </div>
        ) : (
          <EventTimeline groups={groups} viewingCurrentMonth={isSameMonth(current, new Date())} />
        )}
      </Card>
    </div>
  )
}

// ─── EVENT TIMELINE ──────────────────────────────────────────────────────────

function EventTimeline({
  groups,
  viewingCurrentMonth,
}: {
  groups: { date: Date; key: string; events: { icon: string; label: string; color: string }[] }[]
  viewingCurrentMonth: boolean
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const todayRef  = useRef<HTMLDivElement>(null)

  // On first render (per group change), scroll today into view if present
  useEffect(() => {
    if (!viewingCurrentMonth) return
    if (!scrollRef.current || !todayRef.current) return
    const container = scrollRef.current
    const target    = todayRef.current
    // Align target near top of the scroll container
    container.scrollTop = target.offsetTop - container.offsetTop - 4
  }, [groups, viewingCurrentMonth])

  const today = new Date()

  return (
    <div ref={scrollRef} className="max-h-[420px] overflow-y-auto pr-1 space-y-3">
      {groups.map(g => {
        const isTodayGroup = isSameDay(g.date, today)
        return (
          <div
            key={g.key}
            ref={isTodayGroup ? todayRef : undefined}
          >
            <div className={[
              'sticky top-0 z-10 -mx-1 px-1 pb-1 pt-0.5 bg-white',
              'flex items-center gap-2',
            ].join(' ')}>
              <span className={[
                'inline-flex items-center justify-center min-w-[42px] px-1.5 py-0.5 rounded-md text-[10px] font-bold',
                isTodayGroup ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600',
              ].join(' ')}>
                {format(g.date, 'dd MMM')}
              </span>
              <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">
                {isTodayGroup ? 'Today · ' : ''}{format(g.date, 'EEEE')}
              </span>
            </div>
            <div className="space-y-1.5 mt-1.5">
              {g.events.map((ev, i) => (
                <div key={i} className={`flex items-start gap-2.5 p-2 rounded-lg border ${ev.color}`}>
                  <span className="text-base leading-none flex-shrink-0 mt-0.5">{ev.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold truncate">{ev.label}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
