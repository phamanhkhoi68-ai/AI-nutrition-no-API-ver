import React from 'react'

export interface NutrientRuleProps {
  label: string
  value: number
  limit?: number
  unit?: string
  kind?: 'max' | 'target' | 'min'
  className?: string
}

export function NutrientRule({
  label,
  value,
  limit,
  unit = '',
  kind = 'max',
  className = ''
}: NutrientRuleProps) {
  const cleanValue = Math.round(value * 10) / 10
  const hasLimit = typeof limit === 'number' && Number.isFinite(limit) && limit > 0
  const ratio = hasLimit ? value / limit! : 0

  let statusLabel = 'Theo dõi'
  let statusClass = 'text-muted bg-cream2'
  let fillClass = 'bg-brand'

  if (hasLimit) {
    if (kind === 'min') {
      if (ratio >= 1) {
        statusLabel = 'Đạt tối thiểu'
        statusClass = 'text-brand bg-sage-50'
        fillClass = 'bg-brand'
      } else if (ratio >= 0.75) {
        statusLabel = 'Gần đạt'
        statusClass = 'text-amber-ink bg-amber-50'
        fillClass = 'bg-turmeric'
      } else {
        statusLabel = 'Chưa đủ'
        statusClass = 'text-rose-ink bg-rose-50'
        fillClass = 'bg-tomato'
      }
    } else if (kind === 'target') {
      if (ratio > 1.1) {
        statusLabel = 'Vượt mục tiêu'
        statusClass = 'text-rose-ink bg-rose-50'
        fillClass = 'bg-tomato'
      } else if (ratio >= 0.8) {
        statusLabel = 'Đạt mục tiêu'
        statusClass = 'text-brand bg-sage-50'
        fillClass = 'bg-brand'
      } else {
        statusLabel = 'Còn dư'
        statusClass = 'text-muted bg-cream2'
        fillClass = 'bg-brand'
      }
    } else {
      if (value > limit!) {
        statusLabel = 'Vượt ngưỡng'
        statusClass = 'text-rose-ink bg-rose-50'
        fillClass = 'bg-tomato'
      } else if (ratio >= 0.85) {
        statusLabel = 'Sát ngưỡng'
        statusClass = 'text-amber-ink bg-amber-50'
        fillClass = 'bg-turmeric'
      } else {
        statusLabel = 'Trong ngưỡng'
        statusClass = 'text-brand bg-sage-50'
        fillClass = 'bg-brand'
      }
    }
  }

  const maxScale = hasLimit ? Math.max(limit! * 1.15, value, 1) : Math.max(value, 1)
  const fillPct = Math.min(100, Math.max(0, (value / maxScale) * 100))
  const tickPct = hasLimit ? Math.min(100, Math.max(0, (limit! / maxScale) * 100)) : null

  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-ink">{label}</span>
        <div className="flex items-center gap-2 tabular-nums">
          <span className="text-ink font-semibold">
            {cleanValue.toLocaleString('vi-VN')}
            {hasLimit ? ` / ${Math.round(limit!).toLocaleString('vi-VN')}` : ''}
            {unit ? ` ${unit}` : ''}
          </span>
          {hasLimit && (
            <span className={`px-2 py-0.5 rounded-[6px] text-[10px] font-semibold ${statusClass}`}>
              {statusLabel}
            </span>
          )}
        </div>
      </div>

      <div className="relative h-2 rounded-[6px] bg-cream2 overflow-visible">
        <div
          className={`h-full rounded-[6px] transition-all ${fillClass}`}
          style={{ width: `${fillPct}%` }}
        />
        {tickPct !== null && (
          <span
            aria-hidden="true"
            title={`Ngưỡng ${limit}${unit ? ' ' + unit : ''}`}
            className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-ink/70"
            style={{ left: `${tickPct}%` }}
          />
        )}
      </div>
    </div>
  )
}
