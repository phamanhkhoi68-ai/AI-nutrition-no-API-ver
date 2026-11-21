import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { seed } from '../src/data/seed'
import { handleMcpJsonRpc, type JsonRpcRequest } from '../src/services/mcpCore'
import { AI_TIMEOUTS, DEFAULT_BASE_URL as CFG_BASE_URL, DEFAULT_MODEL, FREEMODEL_OPENAI_BASE, GOOGLE_OPENAI_BASE, isFreemodelKey, isGoogleKey, isModelNotFoundStatus, modelCandidates, normalizeBaseUrl, normalizeModelName } from '../src/services/aiConfig'

/**
 * DEMO-ONLY AUTHENTICATION LAYER
 * WARNING: Demo credentials ('Demo123!') are public and hardcoded for demonstration purposes.
 * This in-memory session mechanism is strictly designed for local and test evaluation,
 * and is NOT intended for production deployment without enterprise IAM/database integration.
 */

export interface Session {
  id: string
  userId: string
  role: 'patient' | 'expert' | 'admin'
  email: string
  name: string
  createdAt: number
  expiresAt: number
}

// In-memory session registry + revoked session IDs for single-process & serverless demo gateway
const sessionStore = new Map<string, Session>()
const revokedSessionIds = new Set<string>()
const SESSION_TTL_MS = 2 * 60 * 60 * 1000 // 2 hours

export function getSessionStore() {
  return sessionStore
}

export function clearSessionStore() {
  sessionStore.clear()
  revokedSessionIds.clear()
}

function getSessionSecret(): string {
  const secret = process.env.CDSS_SESSION_SECRET
  if (secret && secret.trim().length >= 16) {
    return secret.trim()
  }
  // Safe default fallback for cloud platforms (Vercel/Render) without manual env configuration
  return 'demo-cdss-session-secret-change-in-prod-only-default123456'
}

export function signSessionId(sessionId: string): string {
  const secret = getSessionSecret()
  const hmac = crypto.createHmac('sha256', secret).update(sessionId).digest('hex')
  return `${sessionId}.${hmac}`
}

export function verifySignedSessionId(signed: string): string | null {
  if (!signed || typeof signed !== 'string' || !signed.includes('.')) return null
  const dotIdx = signed.indexOf('.')
  const sessionId = signed.slice(0, dotIdx)
  const hmac = signed.slice(dotIdx + 1)
  if (!sessionId || !hmac) return null
  try {
    const secret = getSessionSecret()
    const expectedHmac = crypto.createHmac('sha256', secret).update(sessionId).digest('hex')
    const a = Buffer.from(hmac, 'hex')
    const b = Buffer.from(expectedHmac, 'hex')
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
    return sessionId
  } catch {
    return null
  }
}

function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const list: Record<string, string> = {}
  const rc = req.headers.cookie
  if (!rc) return list
  rc.split(';').forEach(cookie => {
    const parts = cookie.split('=')
    const name = parts.shift()?.trim()
    if (!name) return
    const val = decodeURIComponent(parts.join('=').trim())
    list[name] = val
  })
  return list
}

function makeSessionCookie(token: string, maxAgeSeconds = 7200, isSecure = false): string {
  let cookie = `cdss_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`
  if (isSecure) cookie += '; Secure'
  return cookie
}

function makeClearSessionCookie(): string {
  return `cdss_session=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0`
}

export function getSessionFromRequest(req: http.IncomingMessage): Session | null {
  const cookies = parseCookies(req)
  const headerToken = typeof req.headers['x-cdss-session-token'] === 'string'
    ? req.headers['x-cdss-session-token'].trim()
    : ''
  const rawToken = cookies['cdss_session'] || headerToken
  if (!rawToken) return null
  const sessionId = verifySignedSessionId(rawToken)
  if (!sessionId || revokedSessionIds.has(sessionId)) return null
  const session = sessionStore.get(sessionId)
  if (session) {
    if (Date.now() > session.expiresAt) {
      sessionStore.delete(sessionId)
      return null
    }
    return session
  }
  // Stateless recovery for signed tokens across server restarts or Vercel Serverless instances
  const statelessMatch = sessionId.match(/^([a-z0-9]+)_(\d+)_[a-f0-9]+$/i)
  if (statelessMatch) {
    const [, userId, expStr] = statelessMatch
    const expiresAt = Number(expStr)
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null
    const user = seed().users.find(u => u.id === userId && u.active)
    if (!user) return null
    const restored: Session = {
      id: sessionId,
      userId: user.id,
      role: user.role,
      email: user.email,
      name: user.name,
      createdAt: expiresAt - SESSION_TTL_MS,
      expiresAt
    }
    sessionStore.set(sessionId, restored)
    return restored
  }
  return null
}

const LOCAL_DEV_ORIGIN_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/i,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/i,
  /^https?:\/\/\[::1\](:\d+)?$/i,
  /^https?:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|26\.\d+\.\d+\.\d+)(:\d+)?$/i
]

function parseConfiguredOrigins(raw = process.env.CDSS_ALLOWED_ORIGINS || ''): string[] {
  const list = raw
    .split(',')
    .map(item => item.trim().replace(/\/+$/, '').toLowerCase())
    .filter(item => item.length > 0 && !item.includes('*'))

  // Auto-allow Vercel deployment URL if present
  if (process.env.VERCEL_URL) {
    list.push(`https://${process.env.VERCEL_URL.trim().replace(/\/+$/, '').toLowerCase()}`)
  }
  return list
}

export function isAllowedOrigin(origin?: string): boolean {
  if (!origin || typeof origin !== 'string') return false
  const normalized = origin.trim().replace(/\/+$/, '').toLowerCase()
  if (!normalized || normalized.includes('*')) return false

  const configured = parseConfiguredOrigins()
  if (configured.includes(normalized)) return true

  // Allow vercel preview / production URLs (*.vercel.app)
  if (/^https:\/\/[a-z0-9_-]+\.vercel\.app$/i.test(normalized)) {
    return true
  }

  if (process.env.NODE_ENV !== 'production') {
    return LOCAL_DEV_ORIGIN_PATTERNS.some(re => re.test(normalized))
  }
  return false
}

function setCorsHeaders(req: http.IncomingMessage, res: http.ServerResponse) {
  const origin = req.headers.origin
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CDSS-Session-Token')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
}

function isCsrfSafe(req: http.IncomingMessage): boolean {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return true
  const origin = req.headers.origin
  if (origin) return isAllowedOrigin(origin)
  const referer = req.headers.referer
  if (referer) {
    try {
      const u = new URL(referer)
      return isAllowedOrigin(u.origin)
    } catch {
      return false
    }
  }
  return true
}

// Lightweight .env loader (no external dependency required)
function loadDotEnv(override = false) {
  for (const filename of ['.env.local', '.env']) {
    const envPath = path.resolve(process.cwd(), filename)
    if (!fs.existsSync(envPath)) continue
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const k = trimmed.slice(0, eq).trim()
      const v = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
      if (override || !process.env[k]) process.env[k] = v
    }
  }
}

loadDotEnv(true)

const PORT = Number(process.env.PORT || process.env.AI_GATEWAY_PORT || 8787)
const SYSTEM_DEFAULT_GOOGLE_KEY = 'AQ.Ab8RN6Lk6I3CnAZvaGyNDyargY5fsfifOt3JqzZR1j9GbKPM8Q'
const SYSTEM_DEFAULT_FM_KEYS = [
  'fm_4bc53e211ef3034730ece7df11d4687a226339363833f814',
  'fm_5e7dfc68813ad296d872ddd7e3f94920be0327d63d0d6190'
]
const lowQuotaKeys = new Set<string>()

function resolveServerKey(clientHeaderKey?: string): string {
  loadDotEnv(true)
  const raw = (
    process.env.AI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.FREEMODEL_API_KEY ||
    clientHeaderKey ||
    SYSTEM_DEFAULT_GOOGLE_KEY
  ).trim()
  const firstKey = raw.split(',').map(k => k.trim()).find(Boolean) || SYSTEM_DEFAULT_GOOGLE_KEY
  if (lowQuotaKeys.has(firstKey)) {
    if (firstKey !== SYSTEM_DEFAULT_GOOGLE_KEY && !lowQuotaKeys.has(SYSTEM_DEFAULT_GOOGLE_KEY)) {
      return SYSTEM_DEFAULT_GOOGLE_KEY
    }
    const backup = SYSTEM_DEFAULT_FM_KEYS.find(k => !lowQuotaKeys.has(k))
    if (backup) return backup
  }
  return firstKey
}

function resolveBaseUrl(key = ''): string {
  loadDotEnv(true)
  const raw = (process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || '').trim().replace(/\/+$/, '')
  if (raw) return normalizeBaseUrl(raw, key)
  if (isFreemodelKey(key)) return FREEMODEL_OPENAI_BASE
  return CFG_BASE_URL
}

function resolveTierModel(tier?: string, overrideModel?: string, baseUrl = ''): string {
  const pick = (v?: string) => (v && v.trim() ? v.trim() : '')
  const configured =
    tier === 'clinical_reasoning' ? pick(process.env.AI_MODEL_CLINICAL)
    : tier === 'vision' ? pick(process.env.AI_MODEL_VISION)
    : pick(process.env.AI_MODEL_FAST) || pick(process.env.VITE_AI_MODEL)
  const cleanOverride = pick(overrideModel)
  const effectiveOverride = (baseUrl.includes('freemodel.in') && cleanOverride === DEFAULT_MODEL) ? '' : cleanOverride
  return normalizeModelName(effectiveOverride || configured || (baseUrl.includes('freemodel.in') ? '' : DEFAULT_MODEL), baseUrl)
}

function chatEndpoint(baseUrl: string): string {
  return `${baseUrl}/chat/completions`
}

/** Gọi upstream với timeout + tự chuyển model dự phòng khi model không tồn tại / quá tải, đồng thời tự động chuyển provider dự phòng nếu provider chính bị nghẽn (503/429). */
async function callUpstreamChat(payload: Record<string, any>, key: string, stream = false, requestedTimeoutMs?: number): Promise<{ res: Response; model: string; baseUrl: string }> {
  loadDotEnv(true)
  const primaryBase = resolveBaseUrl(key)
  const baseTimeout = Number.isFinite(requestedTimeoutMs) && Number(requestedTimeoutMs) > 0
    ? Math.min(AI_TIMEOUTS.menu7Day, Math.max(10_000, Math.round(Number(requestedTimeoutMs))))
    : AI_TIMEOUTS.gatewayUpstream
  const providersToTry: Array<{ key: string; baseUrl: string }> = [
    { key, baseUrl: primaryBase }
  ]
  const addProvider = (k: string, base: string) => {
    const clean = (k || '').trim()
    if (!clean) return
    if (!providersToTry.some(p => p.key === clean)) {
      providersToTry.push({ key: clean, baseUrl: base })
    }
  }
  for (const envVal of [process.env.AI_API_KEY, process.env.FREEMODEL_API_KEY]) {
    if (envVal) {
      for (const part of envVal.split(',')) {
        const clean = part.trim()
        if (clean && isFreemodelKey(clean)) addProvider(clean, FREEMODEL_OPENAI_BASE)
      }
    }
  }
  if (isFreemodelKey(key)) {
    for (const defKey of SYSTEM_DEFAULT_FM_KEYS) {
      addProvider(defKey, FREEMODEL_OPENAI_BASE)
    }
  }
  const geminiKey = (process.env.GEMINI_API_KEY || '').trim()
  if (geminiKey && isGoogleKey(geminiKey) && !isGoogleKey(key)) {
    addProvider(geminiKey, GOOGLE_OPENAI_BASE)
  }
  // Deprioritize keys that previously returned 402 insufficient_quota
  providersToTry.sort((a, b) => Number(lowQuotaKeys.has(a.key)) - Number(lowQuotaKeys.has(b.key)))

  let last: { res: Response; model: string; baseUrl: string } | null = null

  for (const prov of providersToTry) {
    const baseUrl = prov.baseUrl
    const currentKey = prov.key
    const googleish = isGoogleKey(currentKey) || baseUrl.includes('generativelanguage.googleapis.com')
    const candidates = modelCandidates(String(payload.model || ''), baseUrl)
    let hostConsecutiveOverload = 0
    for (const model of candidates) {
      const body: Record<string, any> = { ...payload, model }
      if (googleish && !body.tools && body.reasoning_effort === undefined) {
        body.reasoning_effort = body.tier === 'clinical_reasoning' ? 'medium' : 'low'
      }
      const modelTimeout = prov.baseUrl.includes('freemodel.in') ? Math.min(baseTimeout, 60_000) : baseTimeout
      const send = (b: Record<string, any>) => fetch(chatEndpoint(baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentKey}` },
        body: JSON.stringify(b),
        signal: AbortSignal.timeout(modelTimeout)
      })
      let res: Response
      try {
        res = await send(body)
      } catch (err: any) {
        last = { res: new Response(JSON.stringify({ error: err?.message || 'TIMEOUT' }), { status: 504 }), model, baseUrl }
        hostConsecutiveOverload++
        if (hostConsecutiveOverload >= 1 && providersToTry.length > 1) break
        continue
      }
      if (res.status === 400 && 'reasoning_effort' in body) {
        const txt = await res.clone().text().catch(() => '')
        if (/reasoning/i.test(txt)) {
          delete body.reasoning_effort
          res = await send(body).catch(() => res)
        }
      }
      if (res.ok) return { res, model, baseUrl }
      const txt = await res.clone().text().catch(() => '')
      last = { res, model, baseUrl }
      // Key-level quota exhausted (402) or unauthorized key (401/403) -> mark key and immediately switch to backup key
      if ([401, 402, 403].includes(res.status)) {
        if (res.status === 402 || /insufficient_quota|prompt_exceeds_quota/i.test(txt)) {
          lowQuotaKeys.add(currentKey)
        }
        if (providersToTry.length > 1) break
      }
      // Concurrency limit on low-balance key ("only one request can run at a time") -> switch to backup key or wait 1.5s & retry
      if (res.status === 429 && /too_many_concurrent|only one request/i.test(txt)) {
        if (providersToTry.length > 1 && prov !== providersToTry[providersToTry.length - 1]) {
          break
        }
        await new Promise(r => setTimeout(r, 1500))
        const retryRes = await send(body).catch(() => null)
        if (retryRes && retryRes.ok) return { res: retryRes, model, baseUrl }
      }
      if ([429, 502, 503, 504].includes(res.status)) {
        hostConsecutiveOverload++
        if (hostConsecutiveOverload >= 1 && providersToTry.length > 1) break
      }
      if (!(isModelNotFoundStatus(res.status, txt) && model !== candidates[candidates.length - 1])) break
    }
  }
  void stream
  return last!
}

function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', chunk => {
      raw += chunk
      if (raw.length > 8_000_000) {
        reject(new Error('PAYLOAD_TOO_LARGE'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!raw.trim()) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('INVALID_JSON'))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res: http.ServerResponse, status: number, payload: any, extraHeaders?: Record<string, string | string[]>) {
  const headers: Record<string, any> = {
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders
  }
  res.writeHead(status, headers)
  res.end(JSON.stringify(payload))
}

export function createGatewayServer() {
  return http.createServer(async (req, res) => {
    setCorsHeaders(req, res)

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (!isCsrfSafe(req)) {
      return sendJson(res, 403, { error: 'CSRF_REJECTED' })
    }

    const url = (req.url || '').split('?')[0]

    try {
      // ===== Demo Authentication Routes =====
      if (req.method === 'POST' && url === '/api/auth/login') {
        const body = await readJsonBody(req)
        const email = String(body?.email || '').trim().toLowerCase()
        const password = String(body?.password || '')
        if (!email || !password) {
          return sendJson(res, 400, { ok: false, error: 'Email và mật khẩu là bắt buộc.' })
        }
        const users = seed().users
        const user = users.find(u => u.email.toLowerCase() === email && u.password === password)
        if (!user) {
          return sendJson(res, 401, { ok: false, error: 'Email hoặc mật khẩu không đúng.' })
        }
        if (!user.active) {
          return sendJson(res, 403, { ok: false, error: 'Tài khoản đã bị khóa.' })
        }
        const now = Date.now()
        const expiresAt = now + SESSION_TTL_MS
        const sessionId = `${user.id}_${expiresAt}_${crypto.randomBytes(12).toString('hex')}`
        const session: Session = {
          id: sessionId,
          userId: user.id,
          role: user.role,
          email: user.email,
          name: user.name,
          createdAt: now,
          expiresAt
        }
        sessionStore.set(sessionId, session)
        const token = signSessionId(sessionId)
        const isSecure = req.headers['x-forwarded-proto'] === 'https'
        const cookieHeader = makeSessionCookie(token, 7200, isSecure)
        return sendJson(res, 200, {
          ok: true,
          sessionToken: token,
          user: { id: user.id, name: user.name, email: user.email, role: user.role }
        }, { 'Set-Cookie': cookieHeader })
      }

      if (req.method === 'POST' && url === '/api/auth/logout') {
        const cookies = parseCookies(req)
        const headerToken = typeof req.headers['x-cdss-session-token'] === 'string'
          ? req.headers['x-cdss-session-token'].trim()
          : ''
        const rawToken = cookies['cdss_session'] || headerToken
        if (rawToken) {
          const verifiedId = verifySignedSessionId(rawToken)
          if (verifiedId) {
            revokedSessionIds.add(verifiedId)
            sessionStore.delete(verifiedId)
          }
        }
        const session = getSessionFromRequest(req)
        if (session) {
          revokedSessionIds.add(session.id)
          sessionStore.delete(session.id)
        }
        return sendJson(res, 200, { ok: true }, { 'Set-Cookie': makeClearSessionCookie() })
      }

      if (req.method === 'GET' && url === '/api/auth/session') {
        const session = getSessionFromRequest(req)
        if (!session) {
          return sendJson(res, 401, { ok: false, error: 'UNAUTHENTICATED' })
        }
        return sendJson(res, 200, {
          ok: true,
          user: { id: session.userId, name: session.name, email: session.email, role: session.role }
        })
      }

      // ===== Public Health Route =====
      if (req.method === 'GET' && url === '/api/health') {
        const key = resolveServerKey()
        const provider = resolveBaseUrl(key)
        return sendJson(res, 200, {
          ok: true,
          service: 'ai-nutrition-gateway',
          hasServerKey: Boolean(key),
          provider,
          models: {
            fast: resolveTierModel('fast', undefined, provider),
            clinical_reasoning: resolveTierModel('clinical_reasoning', undefined, provider),
            vision: resolveTierModel('vision', undefined, provider)
          },
          mcpEndpoint: '/api/mcp'
        })
      }

      // ===== Protected MCP Layer =====
      if (req.method === 'POST' && url === '/api/mcp') {
        const session = getSessionFromRequest(req)
        if (!session) {
          return sendJson(res, 401, { error: 'UNAUTHENTICATED' })
        }
        // Strict server-side role and identity derivation (headers ignored)
        const actorRole = session.role
        const actorId = session.userId

        const body = (await readJsonBody(req)) as JsonRpcRequest
        if (body?.method === 'tools/call' && body?.params?.name === 'approve_plan' && actorRole === 'patient') {
          return sendJson(res, 403, { error: 'RBAC_DENIED: Bệnh nhân không có quyền phê duyệt HITL' })
        }
        if (actorRole === 'patient' && body?.params?.context?.activePatientId && body.params.context.activePatientId !== actorId) {
          return sendJson(res, 403, { error: 'CROSS_PATIENT_ACCESS_DENIED' })
        }
        const s = seed()
        const ctx = {
          foods: body?.params?.context?.foods || s.foods,
          docs: body?.params?.context?.docs || s.docs,
          rules: body?.params?.context?.rules || s.rules,
          profile: body?.params?.context?.profile || s.profile,
          diary: body?.params?.context?.diary || s.diary,
          plans: body?.params?.context?.plans || s.plans,
          activePatientId: actorRole === 'patient' ? actorId : (body?.params?.context?.activePatientId || actorId)
        }
        const rpcRes = handleMcpJsonRpc(body, ctx)
        return sendJson(res, 200, rpcRes)
      }

      // ===== Protected AI Routes =====
      if (req.method === 'POST' && url === '/api/ai/chat') {
        const session = getSessionFromRequest(req)
        if (!session) {
          return sendJson(res, 401, { error: 'UNAUTHENTICATED' })
        }
        const body = await readJsonBody(req)
        if (Array.isArray(body?.messages) && body.messages.length > 20) {
          return sendJson(res, 400, { error: 'TOO_MANY_MESSAGES' })
        }
        const key = resolveServerKey()
        if (!key) return sendJson(res, 503, { error: 'NO_SERVER_API_KEY' })
        const baseUrl = resolveBaseUrl(key)

        const payload: Record<string, any> = {
          model: resolveTierModel(body.tier, body.model, baseUrl),
          messages: body.messages || [],
          temperature: body.temperature ?? 0.15
        }
        if (Number.isFinite(body.max_tokens) && Number(body.max_tokens) > 0) {
          payload.max_tokens = Math.min(12000, Math.max(64, Math.round(Number(body.max_tokens))))
        }
        if (body.reasoning_effort) payload.reasoning_effort = body.reasoning_effort
        else if (body.tier === 'clinical_reasoning' && (isGoogleKey(key) || baseUrl.includes('generativelanguage.googleapis.com'))) {
          payload.reasoning_effort = 'medium'
        }
        if (body.expectJson) payload.response_format = { type: 'json_object' }
        if (Array.isArray(body.tools) && body.tools.length > 0) {
          payload.tools = body.tools
          payload.tool_choice = body.tool_choice || 'auto'
        }
        const { res: upstream, model } = await callUpstreamChat(payload, key, false, Number(body.timeoutMs) || undefined)
        const text = await upstream.text()
        let data: any
        try { data = JSON.parse(text) } catch { data = { error: text.slice(0, 500) } }
        if (!upstream.ok) {
          // Never send HTTP 401 for upstream provider key errors so client doesn't mistake it for gateway session expiration
          const statusOut = upstream.status === 401 ? 502 : upstream.status
          return sendJson(res, statusOut, data)
        }
        if (data && typeof data === 'object') data._gateway = { model }
        return sendJson(res, 200, data)
      }

      if (req.method === 'POST' && url === '/api/ai/stream') {
        const session = getSessionFromRequest(req)
        if (!session) {
          return sendJson(res, 401, { error: 'UNAUTHENTICATED' })
        }
        const body = await readJsonBody(req)
        const key = resolveServerKey()
        if (!key) return sendJson(res, 503, { error: 'NO_SERVER_API_KEY' })
        const baseUrl = resolveBaseUrl(key)

        const { res: upstream } = await callUpstreamChat({
          model: resolveTierModel(body.tier, body.model, baseUrl),
          messages: body.messages || [],
          temperature: body.temperature ?? 0.1,
          max_tokens: body.max_tokens ?? 1200,
          stream: true
        }, key, true)

        if (!upstream.ok || !upstream.body) {
          const text = await upstream.text().catch(() => 'STREAM_UPSTREAM_ERROR')
          return sendJson(res, upstream.status || 502, { error: text.slice(0, 500) })
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        })
        const reader = upstream.body.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          res.write(value)
        }
        res.end()
        return
      }

      if (req.method === 'POST' && url === '/api/ai/embeddings') {
        const session = getSessionFromRequest(req)
        if (!session) {
          return sendJson(res, 401, { error: 'UNAUTHENTICATED' })
        }
        const body = await readJsonBody(req)
        const key = resolveServerKey()
        if (!key) return sendJson(res, 503, { error: 'NO_SERVER_API_KEY' })
        const baseUrl = resolveBaseUrl(key)
        const embModel = body.model || process.env.AI_MODEL_EMBEDDING || (baseUrl.includes('generativelanguage') ? 'gemini-embedding-001' : 'text-embedding-3-small')
        const upstream = await fetch(`${baseUrl}/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
          body: JSON.stringify({ model: embModel, input: body.input || '' }),
          signal: AbortSignal.timeout(AI_TIMEOUTS.gatewayUpstream)
        })
        const data = await upstream.json()
        return sendJson(res, upstream.status, data)
      }

      // Chẩn đoán kết nối AI thật: GET /api/ai/test
      if (req.method === 'GET' && url === '/api/ai/test') {
        const session = getSessionFromRequest(req)
        if (!session) {
          return sendJson(res, 401, { ok: false, error: 'UNAUTHENTICATED' })
        }
        const key = resolveServerKey()
        if (!key) return sendJson(res, 503, { ok: false, error: 'NO_SERVER_API_KEY', hint: 'Điền AI_API_KEY trong .env rồi khởi động lại server.' })
        const baseUrl = resolveBaseUrl(key)
        const t0 = Date.now()
        try {
          const { res: upstream, model, baseUrl: activeBaseUrl } = await callUpstreamChat({
            model: resolveTierModel('fast', undefined, baseUrl),
            messages: [{ role: 'user', content: 'Trả lời đúng một từ: OK' }],
            temperature: 0,
            max_tokens: 16
          }, key)
          const text = await upstream.text()
          let data: any
          try { data = JSON.parse(text) } catch { data = { raw: text.slice(0, 300) } }
          return sendJson(res, upstream.ok ? 200 : upstream.status, {
            ok: upstream.ok,
            status: upstream.status,
            latencyMs: Date.now() - t0,
            baseUrl: activeBaseUrl || baseUrl,
            modelUsed: model,
            reply: data?.choices?.[0]?.message?.content ?? null,
            upstreamError: upstream.ok ? undefined : data
          })
        } catch (e: any) {
          return sendJson(res, 502, { ok: false, latencyMs: Date.now() - t0, baseUrl, error: e?.name === 'TimeoutError' ? 'UPSTREAM_TIMEOUT' : (e?.cause?.code || e?.message || 'FETCH_FAILED') })
        }
      }

      return sendJson(res, 404, { error: 'NOT_FOUND', path: url })
    } catch (err: any) {
      return sendJson(res, 500, { error: err?.message || 'GATEWAY_ERROR' })
    }
  })
}

// Start server when executed directly via `tsx server/index.ts`
const isDirectRun = typeof process !== 'undefined' && process.argv[1] && process.argv[1].includes('server')
if (isDirectRun) {
  const srv = createGatewayServer()
  srv.listen(PORT, '127.0.0.1', () => {
    console.log(`[AI Nutrition Gateway] Listening on http://127.0.0.1:${PORT} (Health: /api/health, MCP: /api/mcp)`)
  })
}
