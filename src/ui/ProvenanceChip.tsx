import React from 'react'

export function ProvenanceChip({
  source,
  profileVersion,
  isSample = false
}: {
  source?: 'AI_LIVE' | 'LOCAL_FALLBACK' | string
  profileVersion?: number | string
  isSample?: boolean
}) {
  return (
    <div className="inline-flex flex-wrap items-center gap-1.5 text-[11px]">
      {source && (
        <span
          className={`px-2 py-0.5 rounded-[6px] font-medium border ${
            source === 'AI_LIVE'
              ? 'bg-brand-50 text-brand border-brand/25'
              : 'bg-amber-50 text-amber-ink border-turmeric/40'
          }`}
        >
          {source === 'AI_LIVE' ? 'Nguồn: AI Trực tuyến' : 'Nguồn: Dự phòng cục bộ'}
        </span>
      )}
      {profileVersion !== undefined && (
        <span className="px-2 py-0.5 rounded-[6px] bg-paper text-muted border border-rule tabular-nums font-medium">
          Hồ sơ v{profileVersion}
        </span>
      )}
      {isSample && (
        <span className="px-2 py-0.5 rounded-[6px] bg-cream2 text-muted border border-rule font-medium">
          Dữ liệu mẫu
        </span>
      )}
    </div>
  )
}
