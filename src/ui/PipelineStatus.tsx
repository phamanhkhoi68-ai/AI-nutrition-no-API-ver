import React from 'react'
import { Check, Loader2, AlertCircle } from 'lucide-react'

export interface PipelineStep {
  key: string
  label: string
  status: 'done' | 'active' | 'pending' | 'error'
  detail?: string
}

export function PipelineStatus({
  title,
  steps,
  className = ''
}: {
  title?: string
  steps: PipelineStep[]
  className?: string
}) {
  return (
    <div className={`rounded-[10px] border border-rule bg-surface p-3.5 ${className}`}>
      {title && <div className="text-xs font-semibold text-ink mb-2.5">{title}</div>}
      <div className="flex flex-wrap items-center gap-2">
        {steps.map((step, idx) => {
          const pillTone =
            step.status === 'done'
              ? 'bg-sage-50 border-brand/30 text-brand'
              : step.status === 'active'
              ? 'bg-amber-50 border-turmeric/50 text-amber-ink'
              : step.status === 'error'
              ? 'bg-rose-50 border-rose-ink/40 text-rose-ink'
              : 'bg-paper border-rule text-muted'

          return (
            <React.Fragment key={step.key}>
              <div
                title={step.detail}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] border text-xs font-medium ${pillTone}`}
              >
                {step.status === 'done' ? (
                  <Check className="w-3.5 h-3.5 shrink-0" />
                ) : step.status === 'active' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                ) : step.status === 'error' ? (
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-current opacity-50 shrink-0" />
                )}
                <span>{step.label}</span>
              </div>
              {idx < steps.length - 1 && (
                <span aria-hidden="true" className="text-muted text-xs">
                  →
                </span>
              )}
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}
