import React, { ReactNode, useEffect } from 'react'
import { X } from 'lucide-react'

export interface DialogProps {
  title: string
  onClose: () => void
  children: ReactNode
  maxWidthClass?: string
}

export function Dialog({ title, onClose, children, maxWidthClass = 'max-w-lg' }: DialogProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 bg-ink/40 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className={`bg-surface rounded-[10px] border border-rule p-6 w-full ${maxWidthClass} max-h-[90vh] overflow-auto shadow-lg`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 mb-4 pb-3 border-b border-rule">
          <h3 className="font-semibold text-base text-ink">{title}</h3>
          <button
            type="button"
            aria-label="Đóng"
            onClick={onClose}
            className="p-2 min-w-[36px] min-h-[36px] rounded-[8px] text-muted hover:text-ink hover:bg-cream2 transition-colors flex items-center justify-center cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export const Modal = Dialog
