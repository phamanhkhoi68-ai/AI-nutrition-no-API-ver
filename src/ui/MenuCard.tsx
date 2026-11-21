import React from 'react'
import { ArrowRightLeft, MessageCircle, Ban } from 'lucide-react'
import { Button } from './Button'

export interface MenuCardProps {
  foodName: string
  grams: number
  note?: string
  kcal?: number
  protein?: number
  sodium?: number
  mismatchNote?: string
  onEditGrams: () => void
  onSwap: () => void
  onAsk?: () => void
  onBlock?: () => void
}

export function MenuCard({
  foodName,
  grams,
  note,
  kcal,
  protein,
  sodium,
  mismatchNote,
  onEditGrams,
  onSwap,
  onAsk,
  onBlock
}: MenuCardProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-[8px] bg-paper border border-rule text-xs">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-semibold text-ink text-sm">{foodName}</span>
          <span className="text-muted tabular-nums font-medium">{grams}g</span>
          {typeof kcal === 'number' && (
            <span className="text-muted tabular-nums">
              · {Math.round(kcal)} kcal · Đạm {Math.round((protein || 0) * 10) / 10}g · Natri {Math.round(sodium || 0)}mg
            </span>
          )}
        </div>
        {mismatchNote && (
          <span className="block text-amber-ink font-medium mt-0.5">{mismatchNote}</span>
        )}
        {note && <span className="block text-muted mt-0.5">{note}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
        <Button v="s" className="!py-1 !px-2.5 !min-h-[34px] text-xs" onClick={onEditGrams}>
          Sửa gram
        </Button>
        <Button v="s" className="!py-1 !px-2.5 !min-h-[34px] text-xs gap-1" onClick={onSwap}>
          <ArrowRightLeft className="w-3.5 h-3.5" />
          <span>Đổi món</span>
        </Button>
        {onAsk && (
          <Button v="s" className="!py-1 !px-2.5 !min-h-[34px] text-xs gap-1 text-brand" onClick={onAsk}>
            <MessageCircle className="w-3.5 h-3.5" />
            <span>Hỏi về món này</span>
          </Button>
        )}
        {onBlock && (
          <button
            type="button"
            onClick={onBlock}
            title="Ẩn món này khỏi các gợi ý thay thế"
            className="p-1.5 min-h-[34px] min-w-[34px] rounded-[8px] border border-rule bg-surface text-muted hover:text-rose-ink hover:border-rose-ink/40 transition-colors cursor-pointer flex items-center justify-center"
          >
            <Ban className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
