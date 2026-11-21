import React, { useEffect, useState } from 'react'
import {
  Activity,
  Cpu,
  Download,
  Play,
  RefreshCw,
  ShieldAlert,
  Terminal,
  Wrench,
  CheckCircle2,
  XCircle,
  FileCode2,
  Wand2
} from 'lucide-react'
import { useS } from '../services/store'
import { Btn, inp, toast } from '../components/ui'
import {
  computeObservabilityMetrics,
  groupSpansByTrace,
  exportOpenTelemetryJson
} from '../services/observability'
import { runClinicalPlanWorkflow, resumeWorkflowRun } from '../services/workflowAgent'
import {
  listMcpTools,
  listMcpResources,
  listMcpPrompts,
  sendRawMcpRpc,
  readMcpResource,
  type McpToolName
} from '../services/mcpTools'
import { getRouterHealthSnapshot, probeGatewayHealth } from '../services/modelRouter'
import {
  RED_TEAM_SCENARIOS,
  runInputGuardrails,
  runOutputGuardrails,
  type InputGuardrailResult,
  type OutputGuardrailResult
} from '../services/guardrails'
import { runAIEvalSuite, EVAL_CASE_COUNT, type AIEvalSuiteReport } from '../evals/aiEvalSuite'

type OpsTab = 'observability' | 'workflows' | 'mcp' | 'guardrails' | 'evals'

let persistedOpsTab: OpsTab = 'observability'
let persistedEvalReport: AIEvalSuiteReport | null = null

function downloadJson(filename: string, text: string) {
  try {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  } catch {}
}

export default function AIOpsCenter() {
  const s = useS()
  const [tab, setTabState] = useState<OpsTab>(persistedOpsTab)
  const setTab = (next: OpsTab) => {
    persistedOpsTab = next
    setTabState(next)
  }
  const [selectedTraceId, setSelectedTraceId] = useState<string>('')

  // Workflow state
  const [wfLoading, setWfLoading] = useState(false)

  // MCP Inspector state
  const tools = listMcpTools()
  const resources = listMcpResources()
  const prompts = listMcpPrompts()
  const [selectedTool, setSelectedTool] = useState<McpToolName>('compute_patient_ceilings')
  const [toolArgsText, setToolArgsText] = useState<string>('{}')
  const [mcpRpcOutput, setMcpRpcOutput] = useState<string>('')
  const [mcpMeta, setMcpMeta] = useState<{ transport: string; ms: number } | null>(null)
  const [resourcePreview, setResourcePreview] = useState<string>('')

  // Guardrails Red-Team Lab state
  const [rtPrompt, setRtPrompt] = useState<string>(RED_TEAM_SCENARIOS[0].prompt)
  const [rtInputOut, setRtInputOut] = useState<InputGuardrailResult | null>(null)
  const [rtOutputOut, setRtOutputOut] = useState<OutputGuardrailResult | null>(null)

  // Evals state
  const [evalRunning, setEvalRunning] = useState(false)
  const [evalReport, setEvalReportState] = useState<AIEvalSuiteReport | null>(persistedEvalReport)
  const setEvalReport = (next: AIEvalSuiteReport | null) => {
    persistedEvalReport = next
    setEvalReportState(next)
  }

  // Router / Gateway health
  const [gwHealth, setGwHealth] = useState(() => getRouterHealthSnapshot())
  useEffect(() => {
    probeGatewayHealth().then(() => setGwHealth(getRouterHealthSnapshot())).catch(() => {})
  }, [])

  const spans = s.traceSpans || []
  const metrics = computeObservabilityMetrics(spans)
  const groupedTraces = groupSpansByTrace(spans)
  const activeTrace = groupedTraces.find(t => t.traceId === selectedTraceId) || groupedTraces[0]
  const workflowRuns = s.workflowRuns || []
  const activePatient = s.users.find(u => u.id === s.activePatientId)

  const handleRunToolRpc = async () => {
    try {
      const args = JSON.parse(toolArgsText || '{}')
      const res = await sendRawMcpRpc('tools/call', { name: selectedTool, arguments: args })
      setMcpMeta({ transport: res.transport, ms: res.durationMs })
      setMcpRpcOutput(JSON.stringify(res.response, null, 2))
      toast(`MCP tools/call (${res.transport}) xong trong ${res.durationMs}ms!`)
    } catch (e: any) {
      toast('Lỗi JSON đối số hoặc thực thi MCP: ' + (e.message || 'Invalid JSON'))
    }
  }

  const handleSelectTool = (name: McpToolName) => {
    setSelectedTool(name)
    if (name === 'search_clinical_guidelines') {
      setToolArgsText(JSON.stringify({ query: 'warfarin vitamin k suy thận', topK: 2 }, null, 2))
    } else if (name === 'lookup_food_nutrients') {
      setToolArgsText(JSON.stringify({ query: 'gạo lứt' }, null, 2))
    } else if (name === 'check_clinical_safety_guardrails') {
      setToolArgsText(JSON.stringify({ items: [{ foodId: 'F022', foodName: 'Rau chân vịt luộc (Spinach)', grams: 150 }] }, null, 2))
    } else if (name === 'get_patient_daily_intake') {
      setToolArgsText(JSON.stringify({}, null, 2))
    } else {
      setToolArgsText('{}')
    }
  }

  const handleRunRedTeam = (text: string) => {
    setRtPrompt(text)
    const inRes = runInputGuardrails(text)
    setRtInputOut(inRes)
    const testItems = /tôm|chân vịt|bưởi|rau/i.test(text)
      ? [
          ...( /tôm/i.test(text) ? [{ foodId: 'F008', foodName: 'Tôm sú hấp', grams: 120 }] : [] ),
          ...( /chân vịt/i.test(text) ? [{ foodId: 'F022', foodName: 'Rau chân vịt luộc (Spinach)', grams: 150 }] : [] )
        ]
      : []
    const outRes = runOutputGuardrails({
      responseText: text,
      profile: s.profile,
      foods: s.foods,
      items: testItems
    })
    setRtOutputOut(outRes)
  }

  const handleRunEvals = async () => {
    setEvalRunning(true)
    try {
      const rep = await runAIEvalSuite()
      setEvalReport(rep)
      toast(`Hoàn tất ${rep.passed}/${rep.total} ca đánh giá AI (Safety Recall: ${(rep.safetyRecall * 100).toFixed(0)}%)!`)
    } finally {
      setEvalRunning(false)
    }
  }

  const TABS: Array<{ id: OpsTab; label: string; icon: any }> = [
    { id: 'observability', label: 'Observability Waterfall', icon: Activity },
    { id: 'workflows', label: 'Workflow DAG & Resume', icon: RefreshCw },
    { id: 'mcp', label: 'Real MCP Inspector', icon: Wrench },
    { id: 'guardrails', label: 'Guardrails Red-Team', icon: ShieldAlert },
    { id: 'evals', label: `AI Evals (${EVAL_CASE_COUNT} Ca)`, icon: CheckCircle2 }
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="staff-kicker">Giám sát Kỹ thuật & Kiểm thử</span>
          <h1 className="staff-section-title text-xl sm:text-2xl font-semibold flex items-center gap-2 mt-0.5">
            <Cpu className="w-6 h-6 text-brand shrink-0" />
            Trung tâm Kỹ thuật AI CDSS (AI Control Center)
          </h1>
          <p className="text-xs text-muted mt-0.5">
            Giám sát OpenTelemetry Spans, Stateful Workflow Agent + Self-Repair, MCP JSON-RPC 2.0, Guardrails 3 tầng & Benchmark Evals.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`px-3 py-1 rounded-full staff-num font-semibold border ${
              gwHealth.gateway.hasServerKey
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-amber-50 text-amber-800 border-amber-200'
            }`}
          >
            Gateway: {gwHealth.gateway.hasServerKey ? 'SERVER KEY ACTIVE' : gwHealth.gateway.reachable ? 'REACHABLE (NO KEY)' : 'LOCAL / HYBRID MODE'}
          </span>
          <span
            className={`px-3 py-1 rounded-full staff-num font-semibold border ${
              gwHealth.circuitOpen ? 'bg-rose-50 text-rose-800 border-rose-200' : 'bg-white text-ink border-line'
            }`}
          >
            Circuit Breaker: {gwHealth.circuitOpen ? 'OPEN' : 'CLOSED'}
          </span>
        </div>
      </div>

      {/* Honest Telemetry Scope Banner */}
      <div className="staff-context-banner px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="staff-scope-chip">Hồ sơ đang chọn (Patient context)</span>
          <span className="font-semibold text-ink">
            {activePatient?.name || 'Bệnh nhân'} ({s.activePatientId || 'N/A'})
          </span>
        </div>
        <span className="text-[11px] text-muted">
          Traces, Spans và Workflow Runs thuộc hồ sơ bệnh nhân đang chọn trong phiên cục bộ.
        </span>
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Bảng điều khiển kỹ thuật AI">
        {TABS.map(t => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-full text-xs font-semibold flex items-center gap-1.5 border transition-colors cursor-pointer ${
                active
                  ? 'bg-brand text-white border-brand shadow-xs'
                  : 'bg-white text-muted border-line hover:text-ink hover:border-brand/50'
              }`}
            >
              <Icon size={14} />
              <span>{t.label}</span>
            </button>
          )
        })}
      </div>

      {/* ==================== TAB 1: OBSERVABILITY WATERFALL ==================== */}
      {tab === 'observability' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {[
              ['Traces / Spans', `${metrics.totalTraces} / ${metrics.totalSpans}`],
              ['Success / Fallback', `${Math.round(metrics.successRate * 100)}% / ${Math.round(metrics.fallbackRate * 100)}%`],
              ['P50 / P95 Latency', `${metrics.p50LatencyMs} / ${metrics.p95LatencyMs} ms`],
              ['Tokens (In+Out)', `${metrics.totalPromptTokens + metrics.totalCompletionTokens}`],
              ['Est. Cost / Grounding', `$${metrics.totalCostUsd} · ${Math.round(metrics.avgGroundingScore * 100)}%`],
              ['Guardrail Blocks / PII', `${Math.round(metrics.blockRate * 100)}% · ${metrics.piiRedactedCount} PII`]
            ].map(([label, val]) => (
              <div key={label} className="staff-bento-card !p-3.5">
                <span className="text-[11px] text-muted block">{label}</span>
                <b className="text-sm staff-num text-ink mt-1 block">{val}</b>
              </div>
            ))}
          </div>

          <div className="staff-surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <h2 className="font-semibold text-base text-ink">Hierarchical Trace & Span Waterfall</h2>
                <span className="text-[11px] text-muted">
                  Dữ liệu của Hồ sơ đang chọn (Patient context): {activePatient?.name || 'N/A'}
                </span>
              </div>
              <Btn
                v="s"
                className="!py-1.5 !px-3 text-xs inline-flex items-center gap-1.5"
                onClick={() => {
                  downloadJson('cdss-telemetry.json', exportOpenTelemetryJson(spans))
                  toast('Đã xuất file OpenTelemetry JSON!')
                }}
              >
                <Download size={13} /> Export OTLP JSON
              </Btn>
            </div>

            {groupedTraces.length === 0 ? (
              <div className="staff-empty-state p-6 text-center text-xs text-muted">
                Chưa có trace nào trong hồ sơ đang chọn. Hãy thử hỏi Trợ lý AI, chạy Workflow hoặc gọi MCP Tool để tạo dữ liệu quan sát phân cấp.
              </div>
            ) : (
              <div className="grid md:grid-cols-3 gap-4">
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {groupedTraces.slice(0, 20).map(tr => (
                    <button
                      key={tr.traceId}
                      type="button"
                      onClick={() => setSelectedTraceId(tr.traceId)}
                      className={`w-full text-left p-2.5 rounded-xl border text-xs transition-colors cursor-pointer ${
                        activeTrace?.traceId === tr.traceId
                          ? 'bg-[#E1F2EF] border-brand text-ink'
                          : 'bg-white border-line hover:border-brand/50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <b className="truncate">{tr.root.name}</b>
                        <span className="staff-num text-[10px] text-muted">{tr.root.durationMs}ms</span>
                      </div>
                      <div className="text-[10px] text-muted mt-0.5 flex justify-between">
                        <span>{tr.root.status} · {tr.children.length + 1} spans</span>
                        <span className="staff-num">{tr.traceId.slice(0, 14)}</span>
                      </div>
                    </button>
                  ))}
                </div>

                <div className="md:col-span-2 p-4 rounded-2xl bg-[#F7FAFB] border border-line space-y-2">
                  {activeTrace && (
                    <>
                      <div className="flex items-center justify-between border-b border-line pb-2 text-xs">
                        <span className="staff-num font-semibold text-ink">Trace: {activeTrace.traceId}</span>
                        <span className="text-muted staff-num">{new Date(activeTrace.root.startTime).toLocaleString('vi-VN')}</span>
                      </div>
                      {[activeTrace.root, ...activeTrace.children].map((sp, i) => {
                        const widthPct = Math.max(8, Math.min(100, (sp.durationMs / Math.max(1, activeTrace.root.durationMs)) * 100))
                        return (
                          <div key={sp.spanId} className={`p-2.5 rounded-xl bg-white border border-line text-xs ${i > 0 ? 'ml-4' : ''}`}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="px-1.5 py-0.5 rounded bg-slate-100 staff-num text-[10px]">{sp.kind}</span>
                                <b className="text-ink">{sp.name}</b>
                              </div>
                              <div className="flex items-center gap-2 staff-num text-[11px]">
                                <span className={sp.status === 'ok' ? 'text-emerald-700' : sp.status === 'blocked' ? 'text-amber-700' : 'text-rose-700'}>
                                  {sp.status}
                                </span>
                                <span>{sp.durationMs} ms</span>
                              </div>
                            </div>
                            <div className="h-1.5 rounded-full bg-slate-100 mt-1.5 overflow-hidden">
                              <div className="h-full bg-brand rounded-full" style={{ width: `${widthPct}%` }} />
                            </div>
                            <div className="text-[10px] text-muted mt-1 flex flex-wrap gap-3">
                              {sp.attributes.ragDocIds?.length ? <span>RAG Docs: {sp.attributes.ragDocIds.join(', ')}</span> : null}
                              {sp.attributes.groundingScore !== undefined ? <span>Grounding: {sp.attributes.groundingScore}</span> : null}
                              {sp.attributes.piiRedactedTypes?.length ? <span>PII Masked: {sp.attributes.piiRedactedTypes.join(', ')}</span> : null}
                              {sp.attributes.errorReason ? <span className="text-rose-700">Note: {sp.attributes.errorReason}</span> : null}
                              {sp.attributes.detail ? <span>{sp.attributes.detail}</span> : null}
                            </div>
                          </div>
                        )
                      })}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== TAB 2: WORKFLOW AGENT DAG & RESUME ==================== */}
      {tab === 'workflows' && (
        <div className="staff-surface p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold text-base text-ink">Stateful Workflow Agent Orchestrator</h2>
                <span className="staff-scope-chip">Hồ sơ đang chọn (Patient context)</span>
              </div>
              <p className="text-xs text-muted mt-0.5">
                Chạy thực đơn tự sửa lỗi (Self-Repair DAG) hoặc mô phỏng lỗi bước trung gian để kiểm chứng Resume từ checkpoint.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Btn
                disabled={wfLoading}
                className="!py-1.5 !px-3 text-xs inline-flex items-center gap-1.5"
                onClick={async () => {
                  setWfLoading(true)
                  try {
                    const out = await runClinicalPlanWorkflow({ daysCount: 1, mealsCount: 3, injectRepairableViolation: true })
                    toast(`Self-Repair Workflow hoàn tất (${out.run.status})!`)
                  } finally {
                    setWfLoading(false)
                  }
                }}
              >
                <Wand2 size={13} /> Chạy Self-Repair Demo
              </Btn>
              <Btn
                v="s"
                disabled={wfLoading}
                className="!py-1.5 !px-3 text-xs inline-flex items-center gap-1.5"
                onClick={async () => {
                  setWfLoading(true)
                  try {
                    await runClinicalPlanWorkflow({ daysCount: 1, mealsCount: 3, simulateStepFailure: 'guardrail_verification' })
                    toast('Đã mô phỏng lỗi tại bước guardrail_verification — bấm Resume ở dưới!')
                  } finally {
                    setWfLoading(false)
                  }
                }}
              >
                <ShieldAlert size={13} /> Mô phỏng Lỗi & Checkpoint
              </Btn>
            </div>
          </div>

          <div className="space-y-3">
            {workflowRuns.length === 0 ? (
              <div className="staff-empty-state p-6 text-center text-xs text-muted">
                Chưa có Workflow Run nào trong hồ sơ đang chọn.
              </div>
            ) : (
              workflowRuns.map(wf => (
                <div key={wf.id} className="p-3.5 rounded-2xl bg-[#F7FAFB] border border-line space-y-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <b className="staff-num text-ink">{wf.workflowName}</b>
                      <span className="text-muted ml-2 staff-num">ID: {wf.id}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2.5 py-0.5 rounded-full font-semibold ${
                          wf.status === 'COMPLETED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : wf.status === 'PAUSED_HITL'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {wf.status}
                      </span>
                      {wf.status === 'FAILED' && (
                        <Btn
                          className="!py-1 !px-2.5 text-xs inline-flex items-center gap-1"
                          onClick={async () => {
                            const resumed = await resumeWorkflowRun(wf.id)
                            if (resumed) toast(`Đã Resume thành công (${resumed.run.status})!`)
                          }}
                        >
                          <Play size={12} /> Resume từ bước lỗi
                        </Btn>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {wf.steps.map((st, idx) => (
                      <div
                        key={idx}
                        title={st.detail}
                        className={`px-2.5 py-1 rounded-xl border text-[11px] staff-num ${
                          st.status === 'completed'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                            : st.status === 'paused'
                            ? 'bg-amber-50 border-amber-200 text-amber-900'
                            : 'bg-rose-50 border-rose-200 text-rose-800'
                        }`}
                      >
                        {idx + 1}. {st.name} [{st.status}]
                      </div>
                    ))}
                  </div>
                  {wf.error && <p className="text-rose-700 staff-num text-[11px]">Error: {wf.error}</p>}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ==================== TAB 3: REAL MCP INSPECTOR ==================== */}
      {tab === 'mcp' && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="staff-surface p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold text-base text-ink">MCP Tools & JSON-RPC 2.0 Caller</h2>
              <span className="text-[10px] staff-num px-2 py-0.5 rounded bg-slate-100 text-ink border border-line">
                JSON-RPC 2.0
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {tools.map(t => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => handleSelectTool(t.name)}
                  className={`px-2.5 py-1 rounded-xl text-xs staff-num border cursor-pointer transition-colors ${
                    selectedTool === t.name ? 'bg-brand text-white border-brand' : 'bg-white border-line text-ink hover:border-brand'
                  }`}
                >
                  {t.name}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted">{tools.find(t => t.name === selectedTool)?.description}</p>
            <div>
              <span className="text-xs font-semibold text-ink block mb-1">JSON Arguments:</span>
              <textarea
                rows={4}
                value={toolArgsText}
                onChange={e => setToolArgsText(e.target.value)}
                className={inp + ' font-mono text-xs'}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Btn onClick={handleRunToolRpc} className="!py-1.5 !px-3.5 text-xs inline-flex items-center gap-1">
                <Play size={13} /> Execute JSON-RPC tools/call
              </Btn>
              <Btn
                v="s"
                className="!py-1.5 !px-3 text-xs"
                onClick={async () => {
                  const res = await sendRawMcpRpc('tools/list')
                  setMcpMeta({ transport: res.transport, ms: res.durationMs })
                  setMcpRpcOutput(JSON.stringify(res.response, null, 2))
                }}
              >
                tools/list
              </Btn>
            </div>
            {mcpMeta && (
              <div className="text-[11px] staff-num text-brand">
                Transport: {mcpMeta.transport} · Latency: {mcpMeta.ms} ms
              </div>
            )}
            <pre className="p-3 rounded-xl bg-slate-900 text-emerald-300 text-[11px] font-mono max-h-64 overflow-auto">
              {mcpRpcOutput || '// Chọn tool và bấm Execute JSON-RPC để xem response...'}
            </pre>
          </div>

          <div className="staff-surface p-5 space-y-3">
            <h2 className="font-semibold text-base text-ink flex items-center gap-1.5">
              <FileCode2 size={16} className="text-brand" /> MCP Resources ({resources.length}) & Prompts ({prompts.length})
            </h2>
            <div className="space-y-1.5">
              {resources.map(r => (
                <div key={r.uri} className="p-2.5 rounded-xl border border-line bg-[#F7FAFB] flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <b className="staff-num text-ink block truncate">{r.uri}</b>
                    <span className="text-muted text-[11px] block truncate">{r.description}</span>
                  </div>
                  <Btn
                    v="s"
                    className="!py-1 !px-2.5 text-xs shrink-0"
                    onClick={() => {
                      const data = readMcpResource(r.uri)
                      setResourcePreview(data.text)
                    }}
                  >
                    Read
                  </Btn>
                </div>
              ))}
            </div>
            <div className="space-y-1.5 pt-2 border-t border-line">
              {prompts.map(pr => (
                <div key={pr.name} className="p-2.5 rounded-xl border border-line bg-white text-xs">
                  <b className="staff-num text-brand">{pr.name}</b>
                  <span className="text-muted block text-[11px]">{pr.description}</span>
                </div>
              ))}
            </div>
            {resourcePreview && (
              <pre className="p-3 rounded-xl bg-slate-900 text-sky-200 text-[11px] font-mono max-h-56 overflow-auto">
                {resourcePreview}
              </pre>
            )}
          </div>
        </div>
      )}

      {/* ==================== TAB 4: GUARDRAILS RED-TEAM LAB ==================== */}
      {tab === 'guardrails' && (
        <div className="staff-surface p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-semibold text-base text-ink">3-Stage Guardrails & Red-Team Lab</h2>
              <p className="text-xs text-muted">
                Kiểm thử trực tiếp PII Redaction (CCCD/SĐT/Email/BHYT), Prompt Injection/Jailbreak, Cấp cứu 115, Ngăn đổi liều thuốc và Output DDI/Allergy theo Hồ sơ đang chọn (Patient context).
              </p>
            </div>
            <span className="staff-scope-chip">Patient context: {activePatient?.name || 'N/A'}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {RED_TEAM_SCENARIOS.map(sc => (
              <button
                key={sc.id}
                type="button"
                onClick={() => handleRunRedTeam(sc.prompt)}
                className="px-3 py-1.5 rounded-xl border border-line bg-white hover:border-brand text-xs font-medium text-ink cursor-pointer"
              >
                [{sc.id}] {sc.title}
              </button>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={rtPrompt}
              onChange={e => setRtPrompt(e.target.value)}
              placeholder="Nhập câu tấn công Red-Team hoặc chứa CCCD/SĐT để kiểm tra..."
              className={inp + ' flex-1'}
            />
            <Btn onClick={() => handleRunRedTeam(rtPrompt)} className="shrink-0">
              Kiểm tra Guardrails
            </Btn>
          </div>

          {rtInputOut && (
            <div className="grid md:grid-cols-2 gap-4 text-xs">
              <div className={`p-3.5 rounded-2xl border ${rtInputOut.allowed ? 'bg-emerald-50/60 border-emerald-300' : 'bg-rose-50/70 border-rose-300'}`}>
                <b className="block mb-1">Stage 1: Input Guardrail</b>
                <p>Status: <b>{rtInputOut.allowed ? 'ALLOWED' : `BLOCKED (${rtInputOut.blockedReason})`}</b></p>
                <p className="mt-1">PII Masked ({rtInputOut.piiRedactionCount}): <code>{rtInputOut.piiRedactedTypes.join(', ') || 'Không có'}</code></p>
                <p className="mt-1 font-mono bg-white p-2 rounded-xl border border-line">{rtInputOut.sanitizedText}</p>
                {rtInputOut.blockMessage && <p className="mt-2 text-rose-800">{rtInputOut.blockMessage}</p>}
              </div>
              {rtOutputOut && (
                <div className={`p-3.5 rounded-2xl border ${rtOutputOut.passed ? 'bg-emerald-50/60 border-emerald-300' : 'bg-amber-50/80 border-amber-300'}`}>
                  <b className="block mb-1">Stage 3: Output & Biological Safety Guardrail</b>
                  <p>Status: <b>{rtOutputOut.passed ? 'PASSED' : 'VIOLATION FLAGGED'}</b> · Grounding: <b>{rtOutputOut.groundingScore}</b></p>
                  <p className="mt-1">Allergy Hits: <b>{rtOutputOut.allergyHits.join(', ') || 'None'}</b></p>
                  <p className="mt-1">DDI Warnings: <b>{rtOutputOut.ddiWarnings.join(' | ') || 'None'}</b></p>
                  {rtOutputOut.violations.length > 0 && (
                    <ul className="list-disc ml-4 mt-1 text-rose-800">
                      {rtOutputOut.violations.map((v, i) => <li key={i}>{v}</li>)}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ==================== TAB 5: GOLDEN EVALS RUNNER ==================== */}
      {tab === 'evals' && (
        <div className="staff-surface p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold text-base text-ink flex items-center gap-1.5">
                <Terminal size={16} className="text-brand" /> Quantitative AI Benchmark & Regression Evals ({EVAL_CASE_COUNT} Cases)
              </h2>
              <p className="text-xs text-muted">
                Đo lường tự động Extraction, Hybrid RAG (Recall@3, MRR), Safety Guardrails (100% Gate), Math Invariants, MCP & Agent Self-Repair.
              </p>
            </div>
            <div className="flex gap-2">
              {evalReport && (
                <Btn
                  v="s"
                  className="!py-1.5 !px-3 text-xs inline-flex items-center gap-1"
                  onClick={() => downloadJson('eval-report.json', JSON.stringify(evalReport, null, 2))}
                >
                  <Download size={13} /> Export eval-report.json
                </Btn>
              )}
              <Btn disabled={evalRunning} onClick={handleRunEvals} className="!py-1.5 !px-4 text-xs inline-flex items-center gap-1.5">
                <Play size={13} />
                <span>{evalRunning ? `Đang chạy ${EVAL_CASE_COUNT} ca...` : 'Chạy Bộ Đánh giá AI'}</span>
              </Btn>
            </div>
          </div>

          {evalReport ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                <div className="staff-bento-card !p-3 bg-emerald-50/60 border-emerald-200">
                  <span className="text-muted block">Pass Rate</span>
                  <b className="text-lg staff-num text-emerald-800">{evalReport.passed}/{evalReport.total} ({Math.round(evalReport.passRate * 100)}%)</b>
                </div>
                <div className="staff-bento-card !p-3 bg-[#E1F2EF]/60 border-[#0B4F4A]/20">
                  <span className="text-muted block">Safety Recall</span>
                  <b className="text-lg staff-num text-brand">{Math.round(evalReport.safetyRecall * 100)}%</b>
                </div>
                <div className="staff-bento-card !p-3">
                  <span className="text-muted block">RAG Recall@3</span>
                  <b className="text-lg staff-num text-ink">{evalReport.irMetrics.ragRecallAt3}</b>
                </div>
                <div className="staff-bento-card !p-3">
                  <span className="text-muted block">RAG MRR</span>
                  <b className="text-lg staff-num text-ink">{evalReport.irMetrics.ragMRR}</b>
                </div>
                <div className="staff-bento-card !p-3">
                  <span className="text-muted block">Approved-Only Prec.</span>
                  <b className="text-lg staff-num text-ink">{evalReport.irMetrics.approvedOnlyPrecision}</b>
                </div>
              </div>

              <div className="staff-table-wrap max-h-96 overflow-y-auto overflow-x-auto">
                <table className="text-xs">
                  <thead className="sticky top-0">
                    <tr>
                      <th>ID</th>
                      <th>Category</th>
                      <th>Evaluation Case</th>
                      <th>Status</th>
                      <th>Score</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {evalReport.cases.map(c => (
                      <tr key={c.id}>
                        <td className="p-2.5 staff-num font-semibold">{c.id}</td>
                        <td className="p-2.5 staff-num text-[11px] text-muted">{c.category}</td>
                        <td className="p-2.5 font-medium text-ink">{c.name}</td>
                        <td className="p-2.5">
                          {c.passed ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                              <CheckCircle2 size={13} /> PASS
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-rose-700 font-semibold">
                              <XCircle size={13} /> FAIL
                            </span>
                          )}
                        </td>
                        <td className="p-2.5 staff-num">{c.score}</td>
                        <td className="p-2.5 text-[11px] text-muted">{c.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="staff-empty-state p-6 text-center text-xs text-muted">
              Nhấn nút <b>Chạy Bộ Đánh giá AI</b> để thực thi trực tiếp toàn bộ {EVAL_CASE_COUNT} ca đánh giá chuẩn trên trình duyệt.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
