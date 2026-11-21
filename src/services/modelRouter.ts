import { startSpan, estimateTokenCount, estimateCostUsd } from './observability'
import { AI_TIMEOUTS, DEFAULT_BASE_URL, DEFAULT_MODEL, GOOGLE_OPENAI_BASE, isGoogleKey, isModelNotFoundStatus, modelCandidates, normalizeBaseUrl, normalizeModelName } from './aiConfig'
import { extractJsonBlock } from '../utils/jsonUtils'
import { me } from './store'

export type TaskTier = 'fast' | 'clinical_reasoning' | 'vision' | 'embedding'

export type GatewayAuthStatus = 'authenticated' | 'unauthenticated' | 'offline'

export interface GatewayHealthStatus {
  reachable: boolean
  hasServerKey: boolean
  provider?: string
  models?: Record<string, string>
  checkedAt: number
  sessionActive?: boolean
  authStatus?: GatewayAuthStatus
}

export interface RoutedToolCall {
  id: string
  name: string
  arguments: Record<string, any>
  extra_content?: any
}

export interface RoutedModelResponse {
  content: string
  parsedJson?: any
  toolCalls: RoutedToolCall[]
  model: string
  tier: TaskTier
  promptTokens: number
  completionTokens: number
  costUsd: number
  viaGateway: boolean
}

let cachedHealth: GatewayHealthStatus = { reachable: false, hasServerKey: false, checkedAt: 0 }
let consecutiveFailures = 0
let circuitOpenUntil = 0
let activeSessionToken = ''
const healthListeners = new Set<() => void>()

export function setActiveSessionToken(token: string) {
  activeSessionToken = (token || '').trim()
}

export function getActiveSessionToken(): string {
  return activeSessionToken
}

export function getGatewayAuthHeaders(): Record<string, string> {
  return activeSessionToken ? { 'X-CDSS-Session-Token': activeSessionToken } : {}
}

function emitHealthChange() {
  healthListeners.forEach(fn => {
    try { fn() } catch {}
  })
}

export function subscribeRouterHealth(listener: () => void): () => void {
  healthListeners.add(listener)
  return () => { healthListeners.delete(listener) }
}

export function resetModelRouterState() {
  consecutiveFailures = 0
  circuitOpenUntil = 0
  activeSessionToken = ''
  cachedHealth = { reachable: false, hasServerKey: false, checkedAt: 0 }
  emitHealthChange()
}

export function isCircuitOpen(): boolean {
  if (circuitOpenUntil > Date.now()) return true
  if (circuitOpenUntil !== 0 && circuitOpenUntil <= Date.now()) {
    circuitOpenUntil = 0
    consecutiveFailures = 0
  }
  return false
}

export function getRouterHealthSnapshot() {
  return {
    gateway: cachedHealth,
    circuitOpen: isCircuitOpen(),
    consecutiveFailures
  }
}

export function setGatewayAuthStatus(status: GatewayAuthStatus) {
  cachedHealth = {
    ...cachedHealth,
    reachable: status === 'offline' ? false : cachedHealth.reachable,
    sessionActive: status === 'authenticated',
    authStatus: status
  }
  emitHealthChange()
}

export async function verifyGatewaySession(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof fetch !== 'function' || !window.location?.origin?.startsWith('http')) {
    setGatewayAuthStatus('offline')
    return false
  }
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), AI_TIMEOUTS.healthProbe)
    const res = await fetch('/api/auth/session', {
      method: 'GET',
      headers: getGatewayAuthHeaders(),
      credentials: 'same-origin',
      signal: controller.signal
    })
    clearTimeout(t)
    if (res.ok) {
      const data = await res.json().catch(() => ({}))
      if (data?.ok) {
        setGatewayAuthStatus('authenticated')
        return true
      }
    }
    setGatewayAuthStatus('unauthenticated')
    return false
  } catch {
    setGatewayAuthStatus('offline')
    return false
  }
}

export async function reestablishActiveUserSession(): Promise<boolean> {
  const activeUser = me()
  if (!activeUser || !activeUser.email || !activeUser.password) return false
  if (typeof window === 'undefined' || typeof fetch !== 'function' || !window.location?.origin?.startsWith('http')) {
    return false
  }
  try {
    const loginRes = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email: activeUser.email, password: activeUser.password })
    })
    if (!loginRes.ok) return false
    const loginData = await loginRes.json().catch(() => ({}))
    if (loginData?.sessionToken) {
      setActiveSessionToken(loginData.sessionToken)
    }
    return await verifyGatewaySession()
  } catch {
    return false
  }
}

export async function probeGatewayHealth(force = false): Promise<GatewayHealthStatus> {
  const now = Date.now()
  if (!force && cachedHealth.reachable && cachedHealth.hasServerKey && cachedHealth.checkedAt > 0 && now - cachedHealth.checkedAt < 15_000) {
    return cachedHealth
  }
  if (typeof window === 'undefined' || typeof fetch !== 'function' || !window.location?.origin?.startsWith('http')) {
    return { reachable: false, hasServerKey: false, sessionActive: false, authStatus: 'offline', checkedAt: now }
  }
  // Avoid spurious calls inside Vitest jsdom unless explicitly probed
  if (window.location.origin === 'http://localhost:3000') {
    return { reachable: false, hasServerKey: false, sessionActive: false, authStatus: 'offline', checkedAt: now }
  }
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), AI_TIMEOUTS.healthProbe)
    const res = await fetch('/api/health', { signal: controller.signal })
    clearTimeout(t)
    if (res.ok) {
      const json = await res.json()
      cachedHealth = {
        reachable: true,
        hasServerKey: Boolean(json?.hasServerKey),
        provider: json?.provider,
        models: json?.models,
        sessionActive: cachedHealth.sessionActive,
        authStatus: cachedHealth.authStatus,
        checkedAt: now
      }
      emitHealthChange()
      return cachedHealth
    }
  } catch {}
  cachedHealth = { reachable: false, hasServerKey: false, sessionActive: false, authStatus: 'offline', checkedAt: now }
  emitHealthChange()
  return cachedHealth
}

export function selectModelForTier(tier: TaskTier, configuredModel: string, baseUrlOrKey = ''): string {
  if (cachedHealth.hasServerKey && cachedHealth.models?.[tier]) {
    return normalizeModelName(cachedHealth.models[tier], cachedHealth.provider || baseUrlOrKey)
  }
  return normalizeModelName(configuredModel || DEFAULT_MODEL, baseUrlOrKey)
}

function parseMaybeJson(text: string): any {
  const extracted = extractJsonBlock(text)
  if (extracted !== null && typeof extracted === 'object') {
    return extracted
  }
  return JSON.parse(text)
}

export async function routeChatCompletion(params: {
  messages: Array<{ role: string; content: any; tool_call_id?: string; tool_calls?: any[] }>
  apiKey: string
  baseUrl: string
  configuredModel: string
  tier?: TaskTier
  temperature?: number
  expectJson?: boolean
  tools?: any[]
  toolChoice?: 'auto' | 'none'
  maxTokens?: number
  timeoutMs?: number
  traceId?: string
  parentSpanId?: string
  patientId?: string
}): Promise<RoutedModelResponse> {
  const tier: TaskTier = params.tier || 'fast'
  const model = selectModelForTier(tier, params.configuredModel)
  const traceId = params.traceId || 'trc-' + Date.now().toString(36)
  const span = startSpan(traceId, `llm:${tier}`, 'llm', params.parentSpanId, {
    model,
    tier,
    patientId: params.patientId
  })

  if (isCircuitOpen()) {
    span.end('blocked', { errorReason: 'CIRCUIT_BREAKER_OPEN' })
    throw new Error('CIRCUIT_BREAKER_OPEN: Provider tạm ngắt do lỗi liên tiếp.')
  }

  let useGateway = false
  if (!params.apiKey) {
    const gw = await probeGatewayHealth()
    if (gw.reachable && gw.hasServerKey) {
      useGateway = true
    } else {
      span.end('fallback', { errorReason: 'NO_KEY' })
      throw new Error('NO_KEY')
    }
  }

  const promptEst = estimateTokenCount(JSON.stringify(params.messages))
  const timeoutMs = params.timeoutMs || AI_TIMEOUTS.chatTurn
  const isGoogle = isGoogleKey(params.apiKey) || (useGateway && /generativelanguage/i.test(cachedHealth.provider || ''))
  const baseUrl = useGateway ? (cachedHealth.provider || DEFAULT_BASE_URL) : normalizeBaseUrl(params.baseUrl, params.apiKey)
  const resolvedModel = selectModelForTier(tier, params.configuredModel, useGateway ? baseUrl : (params.apiKey || baseUrl))
  const models = modelCandidates(resolvedModel, useGateway ? baseUrl : (params.apiKey || baseUrl))
  let lastError: any
  let usedReasoningEffort = isGoogle
  let sessionRecoveredOnce = false

  // Mỗi model được thử tối đa 2 lần (chỉ khi lỗi tạm thời 429/5xx). Lỗi "model không tồn tại" -> chuyển model kế tiếp.
  outer: for (const candidate of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(new Error(`TIMEOUT (${timeoutMs}ms)`)), timeoutMs)
      try {
        const endpoint = useGateway ? '/api/ai/chat' : `${baseUrl}/chat/completions`
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(useGateway ? getGatewayAuthHeaders() : {})
        }
        if (!useGateway) headers['Authorization'] = `Bearer ${params.apiKey}`

        const body: Record<string, any> = {
          model: candidate,
          messages: params.messages,
          temperature: params.temperature ?? 0.2
        }
        if (Number.isFinite(params.maxTokens) && Number(params.maxTokens) > 0) {
          body.max_tokens = Math.round(Number(params.maxTokens))
        }
        // Giảm độ "suy nghĩ" của model flash để tránh timeout; tự bỏ nếu provider từ chối tham số này.
        if (usedReasoningEffort && !params.tools?.length) body.reasoning_effort = 'low'
        if (useGateway) {
          body.tier = tier
          body.timeoutMs = timeoutMs
          if (params.expectJson) body.expectJson = true
        } else if (params.expectJson) {
          body.response_format = { type: 'json_object' }
        }
        if (Array.isArray(params.tools) && params.tools.length > 0) {
          body.tools = params.tools
          body.tool_choice = params.toolChoice || 'auto'
        }

        const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal, credentials: 'same-origin' })
        clearTimeout(timer)

        if (!res.ok) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`)
          if (useGateway && res.status === 401) {
            if (!sessionRecoveredOnce && attempt === 1) {
              sessionRecoveredOnce = true
              const recovered = await reestablishActiveUserSession().catch(() => false)
              if (recovered) {
                attempt--
                await new Promise(r => setTimeout(r, 150))
                continue
              }
            }
            setGatewayAuthStatus('unauthenticated')
            throw new Error(`AI API Error (401): ${errText.slice(0, 400)}`)
          }
          if (res.status === 400 && usedReasoningEffort && /reasoning/i.test(errText)) {
            usedReasoningEffort = false
            attempt--
            continue
          }
          if (isModelNotFoundStatus(res.status, errText) && candidate !== models[models.length - 1]) {
            lastError = new Error(`MODEL_NOT_FOUND (${candidate}): ${errText.slice(0, 160)}`)
            continue outer
          }
          if ([429, 500, 502, 503, 504].includes(res.status) && attempt < 2) {
            await new Promise(r => setTimeout(r, 600 * attempt))
            continue
          }
          throw new Error(`AI API Error (${res.status}): ${errText.slice(0, 400)}`)
        }

        const data = await res.json()
        const choice0 = data?.choices?.[0] || {}
        const finishReason = String(choice0.finish_reason || '')
        const msg = choice0.message || {}
        const rawToolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : []
        const toolCalls: RoutedToolCall[] = rawToolCalls.map((tc: any) => {
          let parsedArgs: Record<string, any> = {}
          try {
            parsedArgs = typeof tc.function?.arguments === 'string'
              ? JSON.parse(tc.function.arguments || '{}')
              : (tc.function?.arguments || {})
          } catch {}
          return {
            id: tc.id || 'tc-' + Math.random().toString(36).slice(2, 8),
            name: tc.function?.name || '',
            arguments: parsedArgs,
            ...(tc.extra_content ? { extra_content: tc.extra_content } : {})
          }
        })

        const content = String(msg.content || '')
        if (/MALFORMED_FUNCTION_CALL/i.test(finishReason) || (content.trim() === ']}' && toolCalls.length === 0)) {
          throw new Error(`AI API returned malformed function call (${finishReason || 'MALFORMED_CONTENT'}).`)
        }
        if (!content && toolCalls.length === 0) throw new Error('AI API returned empty message content.')

        const parsedJson = (params.expectJson && content && toolCalls.length === 0) ? parseMaybeJson(content) : undefined
        const pTok = Number(data?.usage?.prompt_tokens || promptEst)
        const cTok = Number(data?.usage?.completion_tokens || estimateTokenCount(content))
        const costUsd = estimateCostUsd(candidate, pTok, cTok)

        consecutiveFailures = 0
        if (useGateway) setGatewayAuthStatus('authenticated')
        span.end('ok', { promptTokens: pTok, completionTokens: cTok, costUsd, model: candidate, detail: `viaGateway=${useGateway}` })
        return { content, parsedJson, toolCalls, model: candidate, tier, promptTokens: pTok, completionTokens: cTok, costUsd, viaGateway: useGateway }
      } catch (err: any) {
        clearTimeout(timer)
        const isTimeout = err?.name === 'AbortError' || /timeout|abort/i.test(err?.message || '')
        lastError = isTimeout
          ? new Error(`TIMEOUT (${timeoutMs}ms): Nhà cung cấp model không phản hồi kịp thời.`)
          : err
        // Timeout: không thử lại cùng model (tốn thời gian); lỗi mạng thoáng qua: thử lại 1 lần.
        if (!isTimeout && attempt < 2 && /fetch failed|network|ECONN|ETIMEDOUT/i.test(err?.message || '')) {
          await new Promise(r => setTimeout(r, 600))
          continue
        }
        break outer
      }
    }
  }

  consecutiveFailures++
  if (consecutiveFailures >= 3) {
    circuitOpenUntil = Date.now() + 30_000
  }
  span.end('error', { errorReason: lastError?.message || 'ROUTER_ERROR' })
  throw lastError
}
