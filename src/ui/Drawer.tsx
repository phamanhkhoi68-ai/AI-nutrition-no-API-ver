import React, { ReactNode, useEffect } from 'react'
import { X } from 'lucide-react'

export interface DrawerProps {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  widthClass?: string
}

export function Drawer({
  open,
  title,
  subtitle,
  onClose,
  children,
  widthClass = 'w-[94vw] max-w-[440px]'
}: DrawerProps) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-ink/35"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <aside
        className={`${widthClass} h-full bg-surface border-l border-rule shadow-xl flex flex-col`}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-rule flex items-start justify-between gap-3 shrink-0 bg-paper">
          <div className="min-w-0">
            <h3 className="font-semibold text-base text-ink truncate">{title}</h3>
            {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            aria-label="Đóng ngăn kéo"
            onClick={onClose}
            className="p-2 min-w-[36px] min-h-[36px] rounded-[8px] text-muted hover:text-ink hover:bg-cream2 transition-colors flex items-center justify-center cursor-pointer shrink-0"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  )
}
