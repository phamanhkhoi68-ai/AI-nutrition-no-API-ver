import React, { ReactNode } from 'react'

export interface TabOption<T extends string> {
  id: T
  label: string
  icon?: ReactNode
}

export function Tabs<T extends string>({
  items,
  active,
  onChange,
  className = ''
}: {
  items: TabOption<T>[]
  active: T
  onChange: (id: T) => void
  className?: string
}) {
  return (
    <div role="tablist" className={`flex flex-wrap gap-2 ${className}`}>
      {items.map(item => {
        const isActive = item.id === active
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(item.id)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[38px] rounded-[8px] text-xs font-semibold border transition-colors cursor-pointer ${
              isActive
                ? 'bg-brand text-white border-brand'
                : 'bg-surface text-muted border-rule hover:text-ink hover:border-brand/50'
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}
