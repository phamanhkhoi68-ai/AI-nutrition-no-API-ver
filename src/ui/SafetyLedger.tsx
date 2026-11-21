import React from 'react'
import { ShieldCheck } from 'lucide-react'

export interface SafetyLedgerItem {
  label: string
  level: 'ok' | 'warn' | 'out'
  note: string
}

const LEVEL_STYLES = {
  ok: ['An toàn', 'bg-sage-50 text-brand border-brand/20'],
  warn: ['Cảnh báo', 'bg-amber-50 text-amber-ink border-turmeric/40'],
  out: ['Ngoài phạm vi hỗ trợ', 'bg-cream2 text-muted border-rule']
} as const

export function SafetyLedger({ checks }: { checks: SafetyLedgerItem[] }) {
  return (
    <div className="rounded-[10px] border border-rule bg-surface p-4">
      <div className="flex items-center justify-between gap-2 pb-2 mb-1 border-b border-rule">
        <h4 className="font-semibold text-sm text-ink flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-brand" />
          <span>Kiểm tra an toàn</span>
        </h4>
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-[6px] bg-brand-50 text-brand border border-brand/20">
          Tự động
        </span>
      </div>
      <ul className="divide-y divide-rule">
        {checks.map(c => (
          <li key={c.label} className="py-2.5 flex flex-wrap items-start justify-between gap-2 text-sm">
            <div className="min-w-0 flex-1">
              <b className="font-medium text-ink block">{c.label}</b>
              <p className="text-xs text-muted mt-0.5 leading-relaxed">{c.note}</p>
            </div>
            <span
              className={`rounded-[6px] border px-2.5 py-1 text-xs font-medium shrink-0 ${LEVEL_STYLES[c.level][1]}`}
            >
              {LEVEL_STYLES[c.level][0]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export const SafetyCheck = SafetyLedger
