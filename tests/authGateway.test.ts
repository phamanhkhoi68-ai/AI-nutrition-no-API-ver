// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { Server } from 'node:http'
import { createGatewayServer, clearSessionStore, signSessionId, getSessionStore } from '../server/index'
import { sendRawMcpRpc } from '../src/services/mcpTools'

describe('PHASE 2A: Backend Authentication, Authorization & Route Protection', () => {
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    server = createGatewayServer()
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const addr = server.address() as any
    baseUrl = `http://127.0.0.1:${addr.port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    clearSessionStore()
  })

  // 1. Patient, expert, admin login
  it('authenticates patient, expert and admin demo accounts with HttpOnly cookies', async () => {
    const roles = [
      { email: 'patient@demo.vn', expectedRole: 'patient', expectedId: 'u1' },
      { email: 'expert@demo.vn', expectedRole: 'expert', expectedId: 'u2' },
      { email: 'admin@demo.vn', expectedRole: 'admin', expectedId: 'u3' }
    ]

    for (const r of roles) {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: r.email, password: 'Demo123!' })
      })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
      expect(data.user.role).toBe(r.expectedRole)
      expect(data.user.id).toBe(r.expectedId)

      const setCookie = res.headers.get('set-cookie') || ''
      expect(setCookie).toContain('cdss_session=')
      expect(setCookie).toContain('HttpOnly')
      expect(setCookie).toContain('SameSite=Lax')
    }
  })

  // 2. Invalid credentials
  it('rejects invalid credentials and missing fields with 401/400', async () => {
    // Wrong password
    const res1 = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'patient@demo.vn', password: 'WrongPassword!' })
    })
    expect(res1.status).toBe(401)
    const data1 = await res1.json()
    expect(data1.ok).toBe(false)
    expect(data1.error).toBe('Email hoặc mật khẩu không đúng.')

    // Non-existent email
    const res2 = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'unknown@demo.vn', password: 'Demo123!' })
    })
    expect(res2.status).toBe(401)

    // Missing body fields
    const res3 = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })
    expect(res3.status).toBe(400)
  })

  // 3. Missing, forged and expired sessions
  it('rejects missing, forged and expired sessions on protected session verification', async () => {
    // Missing session
    const resNoCookie = await fetch(`${baseUrl}/api/auth/session`)
    expect(resNoCookie.status).toBe(401)
    const dataNoCookie = await resNoCookie.json()
    expect(dataNoCookie.error).toBe('UNAUTHENTICATED')

    // Forged session token (invalid HMAC signature)
    const forgedToken = 'fakeSessionId12345.00112233445566778899aabbccddeeff'
    const resForged = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: `cdss_session=${forgedToken}` }
    })
    expect(resForged.status).toBe(401)

    // Tampered payload with valid-looking structure
    const resTampered = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: `cdss_session=malicious.invalid` }
    })
    expect(resTampered.status).toBe(401)

    // Expired session
    const expiredId = 'expired-session-id'
    getSessionStore().set(expiredId, {
      id: expiredId,
      userId: 'u1',
      role: 'patient',
      email: 'patient@demo.vn',
      name: 'Nguyễn Văn An',
      createdAt: Date.now() - 10000,
      expiresAt: Date.now() - 1000 // Expired
    })
    const expiredToken = signSessionId(expiredId)
    const resExpired = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: `cdss_session=${expiredToken}` }
    })
    expect(resExpired.status).toBe(401)
  })

  // 4. Forged role headers cannot elevate privileges
  it('ignores client-submitted role headers and prevents patient privilege escalation', async () => {
    // Login as patient
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'patient@demo.vn', password: 'Demo123!' })
    })
    const cookie = loginRes.headers.get('set-cookie')!.split(';')[0]

    // Attempt to call expert-only approve_plan while spoofing admin/expert headers
    const res = await fetch(`${baseUrl}/api/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'X-CDSS-User-Role': 'admin',
        'X-CDSS-User-Id': 'u3'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'approve_plan', arguments: { planId: 'p1' } }
      })
    })

    // Server must reject with 403 because session role is patient
    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.error).toContain('RBAC_DENIED')
  })

  // 5. Patient isolation
  it('enforces patient isolation: patient cannot access other patient data, but expert can', async () => {
    // Login as patient u1
    const pLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'patient@demo.vn', password: 'Demo123!' })
    })
    const pCookie = pLogin.headers.get('set-cookie')!.split(';')[0]

    // Patient u1 requests context of patient u-test-patient
    const crossRes = await fetch(`${baseUrl}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: pCookie },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'lookup_food_nutrients',
          arguments: { query: 'F001' },
          context: { activePatientId: 'u-test-patient' }
        }
      })
    })
    expect(crossRes.status).toBe(403)
    const crossData = await crossRes.json()
    expect(crossData.error).toBe('CROSS_PATIENT_ACCESS_DENIED')

    // Expert login
    const expLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'expert@demo.vn', password: 'Demo123!' })
    })
    const expCookie = expLogin.headers.get('set-cookie')!.split(';')[0]

    // Expert requests context of patient u-test-patient -> Allowed
    const expRes = await fetch(`${baseUrl}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: expCookie },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'lookup_food_nutrients',
          arguments: { query: 'F001' },
          context: { activePatientId: 'u-test-patient' }
        }
      })
    })
    expect(expRes.status).toBe(200)
    const expData = await expRes.json()
    expect(expData.result).toBeDefined()
  })

  // 6. Role switching and logout
  it('supports role switching and invalidates session server-side on logout', async () => {
    // Login as patient
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'patient@demo.vn', password: 'Demo123!' })
    })
    const cookie = loginRes.headers.get('set-cookie')!.split(';')[0]

    // Verify session
    const verify1 = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: cookie } })
    expect(verify1.status).toBe(200)
    expect((await verify1.json()).user.role).toBe('patient')

    // Logout
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookie }
    })
    expect(logoutRes.status).toBe(200)
    const clearCookie = logoutRes.headers.get('set-cookie') || ''
    expect(clearCookie).toContain('Max-Age=0')

    // Verified session is now dead
    const verifyAfterLogout = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: cookie } })
    expect(verifyAfterLogout.status).toBe(401)

    // Switch role to expert
    const expertLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'expert@demo.vn', password: 'Demo123!' })
    })
    const expertCookie = expertLogin.headers.get('set-cookie')!.split(';')[0]
    const verifyExpert = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: expertCookie } })
    expect(verifyExpert.status).toBe(200)
    expect((await verifyExpert.json()).user.role).toBe('expert')
  })

  // 7. Protected model API requests
  it('protects /api/ai/* endpoints requiring authentication while keeping /api/health public', async () => {
    // /api/health is public
    const healthRes = await fetch(`${baseUrl}/api/health`)
    expect(healthRes.status).toBe(200)
    const healthData = await healthRes.json()
    expect(healthData.ok).toBe(true)

    // /api/ai/chat unauthenticated -> 401
    const chatRes = await fetch(`${baseUrl}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'test' }] })
    })
    expect(chatRes.status).toBe(401)

    // /api/ai/stream unauthenticated -> 401
    const streamRes = await fetch(`${baseUrl}/api/ai/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'test' }] })
    })
    expect(streamRes.status).toBe(401)

    // /api/ai/embeddings unauthenticated -> 401
    const embRes = await fetch(`${baseUrl}/api/ai/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'test' })
    })
    expect(embRes.status).toBe(401)

    // /api/ai/test unauthenticated -> 401
    const testRes = await fetch(`${baseUrl}/api/ai/test`)
    expect(testRes.status).toBe(401)
  })

  // 8. MCP 401/403 never invokes silent local fallback
  it('ensures MCP 401/403 authorization errors never trigger silent in-process fallback', async () => {
    const origOrigin = window.location.origin
    Object.defineProperty(window, 'location', {
      value: { ...window.location, origin: 'http://localhost:5173' },
      writable: true,
      configurable: true
    })

    try {
      // Case A: Server returns 401 Unauthorized
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'UNAUTHENTICATED' }), { status: 401 })
      ))

      const rpc401 = await sendRawMcpRpc('tools/call', { name: 'lookup_food_nutrients', arguments: { query: 'F001' } }, true)
      expect(rpc401.transport).toBe('jsonrpc-http')
      expect(rpc401.response.error).toBeDefined()
      expect(rpc401.response.error?.message).toContain('UNAUTHENTICATED')
      expect(rpc401.response.result).toBeUndefined()

      // Case B: Server returns 403 Forbidden
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'CROSS_PATIENT_ACCESS_DENIED' }), { status: 403 })
      ))

      const rpc403 = await sendRawMcpRpc('tools/call', { name: 'lookup_food_nutrients', arguments: { query: 'F001' } }, true)
      expect(rpc403.transport).toBe('jsonrpc-http')
      expect(rpc403.response.error).toBeDefined()
      expect(rpc403.response.error?.message).toContain('CROSS_PATIENT_ACCESS_DENIED')
      expect(rpc403.response.result).toBeUndefined()

      // Case C: Genuine network outage / server down (fetch throws TypeError) -> allowed fallback
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
      const rpcOffline = await sendRawMcpRpc('tools/call', { name: 'lookup_food_nutrients', arguments: { query: 'F001' } }, true)
      expect(rpcOffline.transport).toBe('jsonrpc-inprocess')
      expect(rpcOffline.response.result).toBeDefined()
    } finally {
      Object.defineProperty(window, 'location', {
        value: { ...window.location, origin: origOrigin },
        writable: true,
        configurable: true
      })
      vi.unstubAllGlobals()
    }
  })

  // 9. CSRF Origin Allowlist (localhost dev, production CDSS_ALLOWED_ORIGINS, wildcard rejection)
  it('enforces CSRF Origin allowlist with CDSS_ALLOWED_ORIGINS and rejects unauthorized or wildcard origins', async () => {
    const origNodeEnv = process.env.NODE_ENV
    const origAllowed = process.env.CDSS_ALLOWED_ORIGINS
    const origSecret = process.env.CDSS_SESSION_SECRET

    try {
      // Development mode allows localhost
      process.env.NODE_ENV = 'test'
      process.env.CDSS_ALLOWED_ORIGINS = 'https://app.nutrition.vn, https://clinic.example.org/'
      const localRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({ email: 'patient@demo.vn', password: 'Demo123!' })
      })
      expect(localRes.status).toBe(200)
      expect(localRes.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')

      // Production mode allows explicitly configured multi-origin allowlist
      process.env.NODE_ENV = 'production'
      process.env.CDSS_SESSION_SECRET = 'prod-test-session-secret-0123456789'
      const prodRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://clinic.example.org' },
        body: JSON.stringify({ email: 'patient@demo.vn', password: 'Demo123!' })
      })
      expect(prodRes.status).toBe(200)
      expect(prodRes.headers.get('access-control-allow-origin')).toBe('https://clinic.example.org')
      expect(prodRes.headers.get('set-cookie')).toContain('cdss_session=')

      // Production mode rejects localhost unless explicitly listed
      const prodLocalReject = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({ email: 'patient@demo.vn', password: 'Demo123!' })
      })
      expect(prodLocalReject.status).toBe(403)
      expect((await prodLocalReject.json()).error).toBe('CSRF_REJECTED')

      // Rejects unauthorized external origin
      const evilRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://evil-attacker.com' },
        body: JSON.stringify({ email: 'patient@demo.vn', password: 'Demo123!' })
      })
      expect(evilRes.status).toBe(403)
      expect((await evilRes.json()).error).toBe('CSRF_REJECTED')

      // Wildcard '*' in CDSS_ALLOWED_ORIGINS must never allow arbitrary origins
      process.env.CDSS_ALLOWED_ORIGINS = '*, https://*.example.org'
      const wildcardRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://any.example.org' },
        body: JSON.stringify({ email: 'patient@demo.vn', password: 'Demo123!' })
      })
      expect(wildcardRes.status).toBe(403)
      expect((await wildcardRes.json()).error).toBe('CSRF_REJECTED')
    } finally {
      if (origNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = origNodeEnv
      if (origAllowed === undefined) delete process.env.CDSS_ALLOWED_ORIGINS
      else process.env.CDSS_ALLOWED_ORIGINS = origAllowed
      if (origSecret === undefined) delete process.env.CDSS_SESSION_SECRET
      else process.env.CDSS_SESSION_SECRET = origSecret
    }
  })

  // 10. Authenticated /api/ai/chat forwards to upstream when valid session cookie is present
  it('allows authenticated /api/ai/chat with valid session cookie while blocking unauthenticated calls', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: JSON.stringify({ email: 'patient@demo.vn', password: 'Demo123!' })
    })
    expect(loginRes.status).toBe(200)
    const cookie = loginRes.headers.get('set-cookie')!.split(';')[0]

    const sessionRes = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: cookie }
    })
    expect(sessionRes.status).toBe(200)
    expect((await sessionRes.json()).ok).toBe(true)

    const origFetch = globalThis.fetch
    const origAiKey = process.env.AI_API_KEY
    process.env.AI_API_KEY = 'test-server-key-123'

    try {
      vi.stubGlobal('fetch', vi.fn(async (url: any, opts?: any) => {
        const u = String(url)
        if (u.startsWith(baseUrl)) {
          return origFetch(url, opts)
        }
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"is_food":true,"dish_name":"Phở bò","macros":{"kcal":450}}' } }]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }))

      const chatOk = await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173', Cookie: cookie },
        body: JSON.stringify({ tier: 'vision', messages: [{ role: 'user', content: 'analyze' }] })
      })
      expect(chatOk.status).toBe(200)
      const data = await chatOk.json()
      expect(data.choices[0].message.content).toContain('Phở bò')
    } finally {
      if (origAiKey === undefined) delete process.env.AI_API_KEY
      else process.env.AI_API_KEY = origAiKey
      vi.unstubAllGlobals()
    }
  })
})
