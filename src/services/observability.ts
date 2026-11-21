import { get, recordAITrace, recordTraceSpan } from './store'
import type { SpanKind, TraceSpan } from '../types'

export interface ObservabilityMetrics {
  totalTraces: number
  totalSpans: number
  successRate: number
  fallbackRate: number
  blockRate: number
  errorRate: number
  p50LatencyMs: number
  p95LatencyMs: number
  totalPromptTokens: number
  totalCompletionTokens: number
  totalCostUsd: number
  cacheHitRate: number
  avgGroundingScore: number
  piiRedactedCount: number
}

export function newTraceId(prefix = 'trc'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function newSpanId(): string {
  return 'spn-' + Math.random().toString(36).slice(2, 10)
}

export function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil((text || '').length / 4))
}

export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const m = (model || '').toLowerCase()
  // Approximate per-1M token pricing (USD): Flash/mini tier vs Pro tier
  const inPerMillion = m.includes('pro') || m.includes('gpt-4o') && !m.includes('mini') ? 1.25 : 0.15
  const outPerMillion = m.includes('pro') || m.includes('gpt-4o') && !m.includes('mini') ? 5.0 : 0.60
  return Number((((promptTokens * inPerMillion) + (completionTokens * outPerMillion)) / 1_000_000).toFixed(6))
}

export interface ActiveSpanHandle {
  spanId: string
  traceId: string
  end: (
    status: TraceSpan['status'],
    attributes?: TraceSpan['attributes'],
    mirrorToLegacyTrace?: boolean
  ) => TraceSpan
}

export function startSpan(
  traceId: string,
  name: string,
  kind: SpanKind,
  parentSpanId?: string,
  initialAttributes: TraceSpan['attributes'] = {}
): ActiveSpanHandle {
  const spanId = newSpanId()
  const t0 = Date.now()
  const startTime = new Date(t0).toISOString()

  return {
    spanId,
    traceId,
    end(status, attributes = {}, mirrorToLegacyTrace = false) {
      const t1 = Date.now()
      const durationMs = Math.max(0, t1 - t0)
      const merged: TraceSpan['attributes'] = { ...initialAttributes, ...attributes }
      if (merged.promptTokens !== undefined || merged.completionTokens !== undefined) {
        merged.costUsd =
          merged.costUsd ??
          estimateCostUsd(merged.model || 'gemini-flash', merged.promptTokens || 0, merged.completionTokens || 0)
      }
      const span: TraceSpan = {
        spanId,
        traceId,
        parentSpanId,
        name,
        kind,
        status,
        startTime,
        endTime: new Date(t1).toISOString(),
        durationMs,
        attributes: merged
      }
      recordTraceSpan(span)

      if (mirrorToLegacyTrace) {
        recordAITrace({
          traceId,
          operation: name,
          model: merged.model || kind,
          status: status === 'ok' ? 'success' : status,
          durationMs,
          promptTokensEst: merged.promptTokens || 0,
          completionTokensEst: merged.completionTokens || 0,
          ragDocIds: merged.ragDocIds || [],
          cacheHit: Boolean(merged.cacheHit),
          errorReason: merged.errorReason
        }, merged.patientId)
      }
      return span
    }
  }
}

export function computePercentile(values: number[], pct: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1))
  return Math.round(sorted[idx])
}

export function computeObservabilityMetrics(spansInput?: TraceSpan[]): ObservabilityMetrics {
  const spans = spansInput ?? (get().traceSpans || [])
  const traces = get().aiTraces || []
  const uniqueTraces = new Set(spans.map(s => s.traceId))

  const rootOrLlmSpans = spans.filter(s => !s.parentSpanId || s.kind === 'llm' || s.kind === 'workflow')
  const sample = rootOrLlmSpans.length > 0 ? rootOrLlmSpans : spans
  const totalCount = Math.max(sample.length, traces.length)

  if (totalCount === 0) {
    return {
      totalTraces: 0,
      totalSpans: 0,
      successRate: 1,
      fallbackRate: 0,
      blockRate: 0,
      errorRate: 0,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCostUsd: 0,
      cacheHitRate: 0,
      avgGroundingScore: 1,
      piiRedactedCount: 0
    }
  }

  const statSource = sample.length > 0
    ? sample.map(s => s.status)
    : traces.map(t => (t.status === 'success' ? 'ok' : t.status))

  const okCount = statSource.filter(st => st === 'ok').length
  const fbCount = statSource.filter(st => st === 'fallback').length
  const blkCount = statSource.filter(st => st === 'blocked').length
  const errCount = statSource.filter(st => st === 'error').length

  const latencies = sample.length > 0 ? sample.map(s => s.durationMs) : traces.map(t => t.durationMs)
  const totalPromptTokens = spans.reduce((acc, s) => acc + (s.attributes.promptTokens || 0), 0) ||
    traces.reduce((acc, t) => acc + (t.promptTokensEst || 0), 0)
  const totalCompletionTokens = spans.reduce((acc, s) => acc + (s.attributes.completionTokens || 0), 0) ||
    traces.reduce((acc, t) => acc + (t.completionTokensEst || 0), 0)
  const totalCostUsd = Number(spans.reduce((acc, s) => acc + (s.attributes.costUsd || 0), 0).toFixed(5))

  const cacheHits = spans.filter(s => s.attributes.cacheHit).length || traces.filter(t => t.cacheHit).length
  const groundingScores = spans
    .map(s => s.attributes.groundingScore)
    .filter((v): v is number => typeof v === 'number')
  const piiRedactedCount = spans.filter(s => (s.attributes.piiRedactedTypes?.length || 0) > 0).length

  return {
    totalTraces: uniqueTraces.size || traces.length,
    totalSpans: spans.length,
    successRate: Number((okCount / totalCount).toFixed(3)),
    fallbackRate: Number((fbCount / totalCount).toFixed(3)),
    blockRate: Number((blkCount / totalCount).toFixed(3)),
    errorRate: Number((errCount / totalCount).toFixed(3)),
    p50LatencyMs: computePercentile(latencies, 50),
    p95LatencyMs: computePercentile(latencies, 95),
    totalPromptTokens,
    totalCompletionTokens,
    totalCostUsd,
    cacheHitRate: Number((cacheHits / totalCount).toFixed(3)),
    avgGroundingScore: groundingScores.length > 0
      ? Number((groundingScores.reduce((a, b) => a + b, 0) / groundingScores.length).toFixed(3))
      : 1,
    piiRedactedCount
  }
}

export function groupSpansByTrace(spansInput?: TraceSpan[]): Array<{ traceId: string; root: TraceSpan; children: TraceSpan[] }> {
  const spans = spansInput ?? (get().traceSpans || [])
  const groups = new Map<string, TraceSpan[]>()
  spans.forEach(sp => {
    const arr = groups.get(sp.traceId) || []
    arr.push(sp)
    groups.set(sp.traceId, arr)
  })
  const out: Array<{ traceId: string; root: TraceSpan; children: TraceSpan[] }> = []
  groups.forEach((arr, traceId) => {
    const sorted = [...arr].sort((a, b) => a.startTime.localeCompare(b.startTime))
    const root = sorted.find(s => !s.parentSpanId) || sorted[0]
    const children = sorted.filter(s => s.spanId !== root.spanId)
    out.push({ traceId, root, children })
  })
  return out.sort((a, b) => b.root.startTime.localeCompare(a.root.startTime))
}

export function exportOpenTelemetryJson(spansInput?: TraceSpan[]): string {
  const spans = spansInput ?? (get().traceSpans || [])
  const payload = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'ai-nutrition-cdss' } },
            { key: 'service.version', value: { stringValue: '2.0.0' } },
            { key: 'compliance.standard', value: { stringValue: 'FDA-Non-Device-CDS' } }
          ]
        },
        scopeSpans: [
          {
            scope: { name: 'cdss.observability', version: '1.0.0' },
            spans: spans.map(s => ({
              traceId: s.traceId,
              spanId: s.spanId,
              parentSpanId: s.parentSpanId,
              name: s.name,
              kind: s.kind,
              startTimeUnixNano: new Date(s.startTime).getTime() * 1_000_000,
              endTimeUnixNano: new Date(s.endTime).getTime() * 1_000_000,
              status: { code: s.status === 'ok' ? 'OK' : 'ERROR', message: s.attributes.errorReason || s.status },
              attributes: Object.entries(s.attributes)
                .filter(([, v]) => v !== undefined)
                .map(([key, value]) => ({ key, value }))
            }))
          }
        ]
      }
    ]
  }
  return JSON.stringify(payload, null, 2)
}
