import React from 'react'
import { Check } from 'lucide-react'

export interface StepItem {
  label: string
  description?: string
}

export function Stepper({
  steps,
  currentStep
}: {
  steps: StepItem[]
  currentStep: number
}) {
  return (
    <ol className="grid sm:grid-cols-3 gap-2.5" aria-label="Các bước thực hiện">
      {steps.map((step, idx) => {
        const done = idx < currentStep
        const active = idx === currentStep
        return (
          <li
            key={step.label}
            className={`p-3 rounded-[10px] border flex items-start gap-2.5 text-xs ${
              active
                ? 'bg-brand-50 border-brand text-ink'
                : done
                ? 'bg-surface border-brand/40 text-ink'
                : 'bg-surface border-rule text-muted'
            }`}
          >
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 font-semibold tabular-nums ${
                done
                  ? 'bg-brand text-white'
                  : active
                  ? 'bg-brand text-white'
                  : 'bg-cream2 text-muted'
              }`}
            >
              {done ? <Check className="w-3.5 h-3.5" /> : idx + 1}
            </span>
            <div className="min-w-0">
              <div className="font-semibold text-ink">{step.label}</div>
              {step.description && (
                <div className="text-[11px] text-muted mt-0.5 leading-snug">{step.description}</div>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
