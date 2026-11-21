import React from 'react'
import { BookOpen, ExternalLink } from 'lucide-react'
import type { EvidenceBasis } from '../types'
import { Drawer } from './Drawer'

export function EvidenceDrawer({
  open,
  onClose,
  evidence,
  title = 'Cơ sở Y khoa & Dẫn chứng Lâm sàng'
}: {
  open: boolean
  onClose: () => void
  evidence: EvidenceBasis[]
  title?: string
}) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      subtitle="Các hướng dẫn y khoa và nguồn dược lý được tham chiếu từ tài liệu đã duyệt"
    >
      {evidence.length === 0 ? (
        <p className="text-xs text-muted">
          Chưa có tài liệu dẫn chứng cụ thể cho mục này. Hãy trao đổi thêm với chuyên gia dinh dưỡng.
        </p>
      ) : (
        <div className="space-y-3">
          {evidence.map((ev, idx) => (
            <div key={idx} className="p-3.5 rounded-[8px] border border-rule bg-paper space-y-2 text-xs">
              <div className="flex items-start gap-2">
                <BookOpen className="w-4 h-4 text-brand shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-sm text-ink">
                    [{idx + 1}] {ev.guideline_name}
                  </h4>
                  {ev.pharmacology_source && (
                    <span className="inline-block mt-1 text-[10px] font-mono bg-amber-50 text-amber-ink border border-turmeric/40 px-1.5 py-0.5 rounded-[6px]">
                      {ev.pharmacology_source}
                    </span>
                  )}
                </div>
              </div>
              <p className="text-ink/90 leading-relaxed">{ev.rationale}</p>
              {ev.citation_url && (
                <div className="pt-2 border-t border-rule flex items-center justify-between text-[11px]">
                  <span className="text-muted">Nguồn tham chiếu</span>
                  {ev.citation_url.startsWith('http') ? (
                    <a
                      href={ev.citation_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand hover:underline inline-flex items-center gap-1 font-medium"
                    >
                      Mở tài liệu <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : (
                    <span className="font-mono text-muted">{ev.citation_url}</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Drawer>
  )
}
