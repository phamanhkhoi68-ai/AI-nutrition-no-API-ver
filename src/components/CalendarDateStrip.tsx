import React, { useMemo } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock
} from 'lucide-react'
import { useS } from '../services/store'
import { localDateIso, calc } from '../utils/nutrition'

export interface CalendarDateStripProps {
  selectedDate: string
  onSelectDate: (date: string) => void
  title?: string
  className?: string
  compact?: boolean
}

/**
 * Format ISO date string (YYYY-MM-DD) into readable Vietnamese format.
 * Example: "Thứ Bảy, 21/11/2026"
 */
export function formatVietnameseDate(isoDate: string): string {
  try {
    const [y, m, d] = isoDate.split('-').map(Number)
    const date = new Date(y, m - 1, d)
    const weekdays = ['Chủ Nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']
    const weekday = weekdays[date.getDay()]
    return `${weekday}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
  } catch {
    return isoDate
  }
}

/**
 * Shift an ISO date by N days (+/-).
 */
export function shiftDateIso(isoDate: string, days: number): string {
  try {
    const [y, m, d] = isoDate.split('-').map(Number)
    const date = new Date(y, m - 1, d)
    date.setDate(date.getDate() + days)
    return localDateIso(date)
  } catch {
    return isoDate
  }
}

export const CalendarDateStrip: React.FC<CalendarDateStripProps> = ({
  selectedDate,
  onSelectDate,
  title = 'Lịch Nhật ký & Sơ đồ Dinh dưỡng',
  className = '',
  compact = false
}) => {
  const s = useS()
  const todayIso = localDateIso()
  const isToday = selectedDate === todayIso

  // Build a sliding 7-day strip centered around the selected date (-3 to +3 days)
  const stripDates = useMemo(() => {
    const dates: string[] = []
    for (let offset = -3; offset <= 3; offset++) {
      dates.push(shiftDateIso(selectedDate, offset))
    }
    return dates
  }, [selectedDate])

  const selectedItems = useMemo(() => {
    return Object.values(s.diary[selectedDate] || {}).flat()
  }, [s.diary, selectedDate])

  const selectedNutrients = useMemo(() => {
    return calc(selectedItems, s.foods)
  }, [selectedItems, s.foods])

  return (
    <div
      className={`apple-liquid-glass p-3.5 sm:p-4 rounded-2xl border border-[#0B4F4A]/15 shadow-sm space-y-3 ${className}`}
    >
      {/* Top Header Row: Title, Date text, Navigation Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-mono-code uppercase tracking-wider text-[#738A87] font-medium flex items-center gap-2">
            <span>{title}</span>
            {isToday && (
              <span className="px-1.5 py-0.2 rounded-md bg-[#E1F2EF] text-[#0B4F4A] text-[9px] font-semibold border border-[#0B4F4A]/20">
                HÔM NAY
              </span>
            )}
          </div>
          <div className="font-serifDisplay text-base sm:text-lg font-semibold text-[#0F2422]">
            {formatVietnameseDate(selectedDate)}
          </div>
        </div>

        {/* Date Navigation Controls */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Visible standard Date Input */}
          <div className="flex items-center gap-1 porcelain-core px-2.5 py-1 rounded-2xl border border-black/10">
            <input
              type="date"
              value={selectedDate}
              onChange={e => {
                if (e.target.value) onSelectDate(e.target.value)
              }}
              className="bg-transparent text-xs text-[#0F2422] font-mono-code outline-none cursor-pointer"
              title="Nhập hoặc bấm chọn ngày trên lịch"
            />
          </div>

          <button
            type="button"
            onClick={() => onSelectDate(shiftDateIso(selectedDate, -1))}
            className="p-1.5 rounded-2xl porcelain-core hover:bg-white text-[#0F2422] transition-colors border border-black/5 cursor-pointer"
            title="Lùi 1 ngày"
            aria-label="Ngày trước"
          >
            <ChevronLeft size={16} />
          </button>

          {!isToday && (
            <button
              type="button"
              onClick={() => onSelectDate(todayIso)}
              className="px-2.5 py-1.5 rounded-2xl bg-[#E1F2EF] hover:bg-[#ccece6] text-[#0B4F4A] text-xs font-semibold font-mono-code transition-colors border border-[#0B4F4A]/25 cursor-pointer"
              title="Về ngày hôm nay"
            >
              Hôm nay
            </button>
          )}

          <button
            type="button"
            onClick={() => onSelectDate(shiftDateIso(selectedDate, 1))}
            className="p-1.5 rounded-2xl porcelain-core hover:bg-white text-[#0F2422] transition-colors border border-black/5 cursor-pointer"
            title="Tiến 1 ngày"
            aria-label="Ngày sau"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* 7-Day Interactive Sliding Strip */}
      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {stripDates.map(dateIso => {
          const isSelected = dateIso === selectedDate
          const isCurrentToday = dateIso === todayIso
          const [y, m, d] = dateIso.split('-').map(Number)
          const dateObj = new Date(y, m - 1, d)
          const weekdayShort = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][dateObj.getDay()]
          const dayItems = Object.values(s.diary[dateIso] || {}).flat()
          const hasFood = dayItems.length > 0

          return (
            <button
              key={dateIso}
              type="button"
              onClick={() => onSelectDate(dateIso)}
              className={`p-2 rounded-2xl flex flex-col items-center justify-center transition-all cursor-pointer relative ${
                isSelected
                  ? 'bg-[#0B4F4A] text-white shadow-md shadow-[#0B4F4A]/20 scale-102 font-bold'
                  : isCurrentToday
                    ? 'bg-[#E1F2EF] text-[#0B4F4A] border border-[#0B4F4A]/30 font-semibold hover:bg-[#d6eee9]'
                    : 'porcelain-core hover:bg-white text-[#0F2422] border border-black/5'
              }`}
              title={`Ngày ${dateIso}: ${hasFood ? `Đã ghi ${dayItems.length} món` : 'Chưa có nhật ký'}`}
            >
              <span
                className={`text-[10px] uppercase font-mono-code leading-none ${
                  isSelected ? 'text-[#A3E5DD]' : isCurrentToday ? 'text-[#0B4F4A]' : 'text-[#738A87]'
                }`}
              >
                {weekdayShort}
              </span>
              <span className="text-sm sm:text-base font-serifDisplay font-semibold mt-0.5 leading-tight">
                {d}
              </span>

              {/* Status Indicator Dot: Teal if food logged */}
              <div className="h-1.5 flex items-center justify-center mt-1">
                {hasFood ? (
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isSelected ? 'bg-[#A3E5DD]' : 'bg-[#0B4F4A]'
                    }`}
                  />
                ) : (
                  <span className="w-1 h-1 rounded-full bg-transparent" />
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* Dynamic Summary status footer for currently selected day */}
      <div className="pt-1 flex flex-wrap items-center justify-between gap-2 text-xs border-t border-black/5">
        <div className="flex items-center gap-2">
          {selectedItems.length > 0 ? (
            <>
              <CheckCircle2 size={14} className="text-[#0B4F4A] shrink-0" />
              <span className="text-[#0F2422] font-medium">
                Đã ghi nhận <b>{selectedItems.length} món</b> trong Nhật ký ngày {selectedDate}
              </span>
              <span className="hidden sm:inline-block text-[#738A87] font-mono-code text-[11px]">
                · {Math.round(selectedNutrients.kcal)} kcal · {Math.round(selectedNutrients.protein)}g Đạm ·{' '}
                {Math.round(selectedNutrients.sodium)}mg Natri
              </span>
            </>
          ) : (
            <>
              <Clock size={14} className="text-[#738A87] shrink-0" />
              <span className="text-[#738A87]">
                Chưa ghi nhận món ăn nào trong Nhật ký ngày {selectedDate} (Chỉ số dinh dưỡng & sơ đồ đang ở mức nền).
              </span>
            </>
          )}
        </div>

        {selectedItems.length > 0 && (
          <span className="font-mono-code text-[11px] text-[#0B4F4A] font-semibold bg-[#E1F2EF] px-2 py-0.5 rounded-md border border-[#0B4F4A]/20">
            {Math.round(selectedNutrients.kcal)} kcal
          </span>
        )}
      </div>
    </div>
  )
}
