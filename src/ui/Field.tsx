import React, { ReactNode } from 'react'

export const inp =
  'w-full border border-rule rounded-[8px] px-3.5 py-2.5 text-sm bg-surface text-ink focus:border-brand focus:outline-none'

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm mb-3">
      <span className="block mb-1 text-muted font-medium">{label}</span>
      {children}
    </label>
  )
}
