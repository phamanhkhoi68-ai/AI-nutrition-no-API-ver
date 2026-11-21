import React from 'react'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  v?: 'p' | 's' | 'd'
  variant?: 'p' | 's' | 'd'
}

export function Button({ v, variant, className = '', type = 'button', ...rest }: ButtonProps) {
  const tone = variant ?? v ?? 'p'
  const palette =
    tone === 'p'
      ? 'bg-brand text-white hover:bg-brand-900 border border-transparent'
      : tone === 'd'
      ? 'bg-rose-ink text-white hover:bg-brand-900 border border-transparent'
      : 'bg-surface text-ink border border-rule hover:bg-cream2'

  return (
    <button
      type={type}
      {...rest}
      className={`inline-flex items-center justify-center px-4 py-2 min-h-[40px] rounded-[8px] text-sm font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${palette} ${className}`}
    />
  )
}

export const Btn = Button
