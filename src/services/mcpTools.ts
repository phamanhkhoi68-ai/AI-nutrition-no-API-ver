import { get, me } from './store'
import { startSpan, newTraceId } from './observability'
import { runToolGuardrails } from './guardrails'
import type { State } from '../types'
import {
  MCP_TOOLS,
  MCP_RESOURCES,
  MCP_PROMPTS,
  executeMcpToolCall,
  handleMcpJsonRpc,
  readMcpResourceData,
  buildFHIRNutritionOrder,
  toOpenAIToolsSchema,
  type McpToolName,
  type McpToolDefinition,
  type JsonRpcRequest,
  type JsonRpcResponse
} from './mcpCore'

export {
  MCP_TOOLS,
  MCP_RESOURCES,
  MCP_PROMPTS,
  buildFHIRNutritionOrder,
  toOpenAIToolsSchema
}
export type { McpToolName, McpToolDefinition, JsonRpcRequest, JsonRpcResponse }

export interface McpToolResult {
  tool: McpToolName
  ok: boolean
  data: any
  durationMs: number
  transport: 'jsonrpc-http' | 'jsonrpc-inprocess'
  error?: string
}

export function listMcpTools(): McpToolDefinition[] {
  return MCP_TOOLS
}

export function listMcpResources() {
  return MCP_RESOURCES
}

export function listMcpPrompts() {
  return MCP_PROMPTS
}

export function callMcpTool(
  name: McpToolName,
  args: Record<string, any> = {},
  traceContext?: { traceId?: string; parentSpanId?: string; stepCount?: number; stateOverride?: State; skipLiveTelemetry?: boolean; patientId?: string }
): McpToolResult {
  const s = traceContext?.stateOverride || get()
  const traceId = traceContext?.traceId || newTraceId('mcp')
  const persistTelemetry = !traceContext?.skipLiveTelemetry
  const span = startSpan(traceId, `mcp:${name}`, 'mcp', traceContext?.parentSpanId, {
    toolName: name,
    patientId: traceContext?.patientId || s.activePatientId
  })

  const guard = runToolGuardrails(name, args, 'system', traceContext?.stepCount || 1)
  if (!guard.allowed) {
    const finished = span.end('blocked', { errorReason: guard.reason }, persistTelemetry)
    return {
      tool: name,
      ok: false,
      data: null,
      durationMs: finished.durationMs,
      transport: 'jsonrpc-inprocess',
      error: guard.reason
    }
  }

  try {
    const data = executeMcpToolCall(name, args, s)
    const ragDocIds = Array.isArray(data?.matchedDocs) ? data.matchedDocs.map((d: any) => d.id) : []
    const finished = span.end('ok', {
      ragDocIds,
      ragTopScore: typeof data?.topScore === 'number' ? data.topScore : undefined,
      detail: name
    }, persistTelemetry)
    return {
      tool: name,
      ok: true,
      data,
      durationMs: finished.durationMs,
      transport: 'jsonrpc-inprocess'
    }
  } catch (err: any) {
    const finished = span.end('error', { errorReason: err?.message || 'MCP_ERROR' }, persistTelemetry)
    return {
      tool: name,
      ok: false,
      data: null,
      durationMs: finished.durationMs,
      transport: 'jsonrpc-inprocess',
      error: err?.message || 'MCP_ERROR'
    }
  }
}

export async function sendRawMcpRpc(
  method: string,
  params: Record<string, any> = {},
  preferHttp = true
): Promise<{ response: JsonRpcResponse; transport: 'jsonrpc-http' | 'jsonrpc-inprocess'; durationMs: number }> {
  const t0 = Date.now()
  const s = get()
  const actor = me(s)
  const enrichedParams = {
    ...params,
    context: params.context || {
      foods: s.foods,
      docs: s.docs,
      rules: s.rules,
      profile: s.profile,
      diary: s.diary,
      plans: s.plans,
      activePatientId: s.activePatientId
    }
  }
  const req: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: Date.now(),
    method,
    params: enrichedParams
  }

  if (preferHttp && typeof fetch === 'function' && typeof window !== 'undefined' && window.location?.origin?.startsWith('http')) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 1500)
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const res = await fetch('/api/mcp', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify(req),
        signal: controller.signal
      })
      clearTimeout(timer)
      if (res.status === 401 || res.status === 403) {
        const errJson = await res.json().catch(() => ({ error: `HTTP_${res.status}` }))
        const errorMsg = errJson?.error?.message || errJson?.error || (res.status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN')
        return {
          response: {
            jsonrpc: '2.0',
            id: req.id,
            error: { code: res.status === 401 ? -32001 : -32003, message: errorMsg }
          },
          transport: 'jsonrpc-http',
          durationMs: Date.now() - t0
        }
      }
      if (res.ok) {
        const json = (await res.json()) as JsonRpcResponse
        return { response: json, transport: 'jsonrpc-http', durationMs: Date.now() - t0 }
      }
    } catch {
      // Fallback to local JSON-RPC handler ONLY when running pure static Vite build or genuine network error
    }
  }

  const localRes = handleMcpJsonRpc(req, s)
  return { response: localRes, transport: 'jsonrpc-inprocess', durationMs: Date.now() - t0 }
}

export function readMcpResource(uri: string) {
  return readMcpResourceData(uri, get())
}
