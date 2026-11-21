import React from 'react'

export interface WeekStripDay {
  label: string
  kcal: number
  withinLimits?: boolean
}

export function WeekStrip({
  days,
  activeIdx,
  onSelect
}: {
  days: WeekStripDay[]
  activeIdx: number
  onSelect: (index: number) => void
}) {
  return (
    <div className="flex items-stretch gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Chọn ngày trong tuần">
      {days.map((day, idx) => {
        const active = idx === activeIdx
        return (
          <button
            key={idx}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(idx)}
            className={`px-3.5 py-2 min-h-[44px] rounded-[8px] text-xs font-semibold shrink-0 transition-colors cursor-pointer border text-left flex flex-col justify-center ${
              active
                ? 'bg-brand text-white border-brand'
                : 'bg-surface border-rule text-ink hover:border-brand/60'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  day.withinLimits === false
                    ? 'bg-tomato'
                    : active
                    ? 'bg-white'
                    : 'bg-brand'
                }`}
              />
              <span>{day.label}</span>
            </div>
            <span
              className={`text-[11px] tabular-nums font-normal mt-0.5 ${
                active ? 'text-white/85' : 'text-muted'
              }`}
            >
              {Math.round(day.kcal).toLocaleString('vi-VN')} kcal
            </span>
          </button>
        )
      })}
    </div>
  )
}
