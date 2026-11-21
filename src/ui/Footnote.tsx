import React from 'react'
import { BookOpen } from 'lucide-react'

export function Footnote({
  index,
  title,
  onOpen
}: {
  index: number
  title: string
  onOpen?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] border border-rule bg-paper hover:border-brand text-[11px] font-medium text-ink transition-colors cursor-pointer"
      title={title}
    >
      <BookOpen className="w-3 h-3 text-brand shrink-0" />
      <span className="tabular-nums font-semibold text-brand">[{index}]</span>
      <span className="truncate max-w-[200px]">{title}</span>
    </button>
  )
}
