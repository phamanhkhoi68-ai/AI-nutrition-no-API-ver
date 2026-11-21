// @vitest-environment jsdom
const storageMap = new Map<string, string>()
const mockStorage = {
  getItem: (k: string) => storageMap.get(k) ?? null,
  setItem: (k: string, v: string) => storageMap.set(k, String(v)),
  removeItem: (k: string) => storageMap.delete(k),
  clear: () => storageMap.clear(),
  get length() { return storageMap.size },
  key: (i: number) => Array.from(storageMap.keys())[i] ?? null
}
Object.defineProperty(globalThis, 'localStorage', { value: mockStorage, configurable: true })
Object.defineProperty(window, 'localStorage', { value: mockStorage, configurable: true })

import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import Login from '../src/pages/Login'
import Diary from '../src/pages/Diary'
import * as imageUtils from '../src/utils/imageUtils'
import { extractJsonBlock } from '../src/utils/jsonUtils'
import { normalizeFoodScanRaw, analyzeFoodLabelOrMenu, setApiKey } from '../src/services/aiService'
import { resetModelRouterState, getRouterHealthSnapshot, probeGatewayHealth } from '../src/services/modelRouter'
import { get, reset, login } from '../src/services/store'

describe('AI Vision Food Scan Optimization & Resilient Parsing', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    reset()
    resetModelRouterState()
    setApiKey('')
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  describe('extractJsonBlock', () => {
    it('parses pure clean JSON objects', () => {
      const input = '{"dish_name": "Phở bò", "estimated_weight_g": 450}'
      const res = extractJsonBlock(input)
      expect(res).toEqual({ dish_name: 'Phở bò', estimated_weight_g: 450 })
    })

    it('extracts JSON from markdown code blocks with preceding and trailing text', () => {
      const input = `
Dưới đây là kết quả phân tích hình ảnh:
\`\`\`json
{
  "dish_name": "Bún chả Hà Nội",
  "estimated_weight_g": 400,
  "macros": { "kcal": 550, "protein": 28, "carb": 65, "fat": 18 },
  "suitability": "SAFE"
}
\`\`\`
Món ăn này rất phổ biến và thơm ngon, đảm bảo đầy đủ chất đạm và tinh bột.
      `
      const res = extractJsonBlock(input)
      expect(res).not.toBeNull()
      expect(res.dish_name).toBe('Bún chả Hà Nội')
      expect(res.macros.kcal).toBe(550)
      expect(res.suitability).toBe('SAFE')
    })

    it('extracts JSON when code fence lacks language identifier', () => {
      const input = `\`\`\`
{"dish_name": "Cơm tấm sườn bì chả", "estimated_weight_g": 500}
\`\`\`\nChúc bạn ngon miệng!`
      const res = extractJsonBlock(input)
      expect(res).not.toBeNull()
      expect(res.dish_name).toBe('Cơm tấm sườn bì chả')
    })

    it('handles trailing commas before closing braces/brackets', () => {
      const input = `{"dish_name": "Bánh mì pate", "ingredients": ["bánh mì", "pate",], "macros": {"kcal": 380,},}`
      const res = extractJsonBlock(input)
      expect(res).not.toBeNull()
      expect(res.dish_name).toBe('Bánh mì pate')
      expect(res.macros.kcal).toBe(380)
    })

    it('extracts balanced curly braces even without markdown fences when trailing text exists', () => {
      const input = `{"dish_name": "Bò bít tết sốt tiêu đen", "macros": {"kcal": 620, "protein": 45, "carb": 15, "fat": 38}}\n\nBữa ăn có nhiều đạm chất lượng cao từ thịt bò.`
      const res = extractJsonBlock(input)
      expect(res).not.toBeNull()
      expect(res.dish_name).toBe('Bò bít tết sốt tiêu đen')
      expect(res.macros.protein).toBe(45)
    })

    it('returns null for unrecoverable broken JSON', () => {
      const input = '{"dish_name": "Broken'
      const res = extractJsonBlock(input)
      expect(res).toBeNull()
    })
  })

  describe('normalizeFoodScanRaw - Universal Dish Support', () => {
    it('normalizes Vietnamese Phở bò correctly with calculated energy', () => {
      const raw = {
        dish_name: 'Phở bò tái nạm',
        estimated_weight_g: 450,
        ingredients: [
          { name: 'Bánh phở', weight_g: 200 },
          { name: 'Thịt bò', weight_g: 100 },
          { name: 'Nước dùng', weight_g: 150 }
        ],
        macros: { protein: 28, carb: 58, fat: 12 }, // kcal omitted
        micros: { sodium_mg: 1450, purine: 'Vừa' },
        suitability: 'CẦN LƯU Ý',
        suitability_reason: 'Nước dùng phở có lượng muối tương đối cao'
      }
      const res = normalizeFoodScanRaw(raw)
      expect(res.dish_name).toBe('Phở bò tái nạm')
      expect(res.estimated_weight_g).toBe(450)
      expect(res.macros.kcal).toBe(28 * 4 + 58 * 4 + 12 * 9) // 444 kcal auto-calculated
      expect(res.suitability).toBe('CAUTION')
      expect(res.micros.purine).toBe('Vừa')
    })

    it('normalizes Family Meal Tray (Mâm cơm gia đình)', () => {
      const raw = {
        dish: 'Mâm cơm gia đình: Cơm trắng, Thịt kho trứng, Canh cải thịt băm',
        ingredients: [
          { name: 'Cơm trắng', weight_g: 150 },
          { name: 'Thịt kho trứng', weight_g: 120 },
          { name: 'Canh cải nấu thịt', weight_g: 150 }
        ],
        macros: { kcal: 680, protein: 32, carb: 75, fat: 24 },
        micros: { sodium_mg: 1100, purine: 'Vừa' },
        suitability: 'SAFE'
      }
      const res = normalizeFoodScanRaw(raw)
      expect(res.dish_name).toContain('Mâm cơm gia đình')
      expect(res.estimated_weight_g).toBe(420) // derived from sum of ingredients
      expect(res.macros.kcal).toBe(680)
      expect(res.suitability).toBe('SAFE')
    })

    it('normalizes Western dishes like Steak or Pasta', () => {
      const raw = `\`\`\`json
{
  "name": "Australian Beef Steak with Mashed Potato",
  "portion_g": 350,
  "macros": { "kcal": 580, "protein": 42, "carb": 28, "fat": 30 },
  "micros": { "sodium_mg": 680, "potassium_mg": 720, "purine": "Cao" },
  "suitability": "CAUTION",
  "suitability_reason": "Thịt đỏ giàu purine, người bệnh Gout nên ăn lượng vừa phải"
}
\`\`\`\nẢnh bít tết bò áp chảo.`
      const res = normalizeFoodScanRaw(raw)
      expect(res.dish_name).toBe('Australian Beef Steak with Mashed Potato')
      expect(res.estimated_weight_g).toBe(350)
      expect(res.macros.protein).toBe(42)
      expect(res.micros.purine).toBe('Cao')
      expect(res.suitability).toBe('CAUTION')
    })

    it('normalizes Asian dishes like Sushi / Ramen / Dimsum', () => {
      const raw = {
        ten_mon: 'Ramen Tonkotsu Nhật Bản',
        khoi_luong: 500,
        dinh_duong: { kcal: 590, dam: 26, tinh_bot: 65, chat_beo: 22 },
        vi_luong: { natri: 1800, kali: 350 },
        muc_do_an_toan: 'VƯỢT NGƯỠNG'
      }
      const res = normalizeFoodScanRaw(raw)
      expect(res.dish_name).toBe('Ramen Tonkotsu Nhật Bản')
      expect(res.estimated_weight_g).toBe(500)
      expect(res.macros.protein).toBe(26)
      expect(res.macros.carb).toBe(65)
      expect(res.micros.sodium_mg).toBe(1800)
      expect(res.suitability).toBe('DANGER')
    })

    it('normalizes Beverage / Dessert / Snacks', () => {
      const raw = {
        dish_name: 'Trà sữa trân châu đường đen',
        estimated_weight_g: 400,
        macros: { kcal: 360, protein: 4, carb: 68, fat: 8 },
        micros: { sugar_g: 48, sodium_mg: 120 },
        suitability: 'DANGER',
        suitability_reason: 'Lượng đường rất cao (48g), không phù hợp cho người đái tháo đường'
      }
      const res = normalizeFoodScanRaw(raw)
      expect(res.dish_name).toBe('Trà sữa trân châu đường đen')
      expect(res.micros.sugar_g).toBe(48)
      expect(res.suitability).toBe('DANGER')
      expect(res.gi).toBeGreaterThanOrEqual(60) // high GI inferred from sugar
    })

    it('harmonizes macro discrepancy so verifyNutritionalMath is valid', () => {
      // Discrepancy: reported 800 kcal, but macros 20g protein + 40g carb + 10g fat = 330 kcal
      const raw = {
        dish_name: 'Canh rau cải thịt băm',
        estimated_weight_g: 250,
        macros: { kcal: 800, protein: 20, carb: 40, fat: 10 },
        suitability: 'SAFE'
      }
      const res = normalizeFoodScanRaw(raw)
      // Expect kcal harmonized to calculated 330 kcal
      expect(res.macros.kcal).toBe(330)
    })

    it('identifies non-food objects with is_food false', () => {
      const raw = {
        is_food: false,
        dish_name: 'Đồng hồ đeo tay',
        suitability_reason: 'Ảnh chụp phụ kiện thời trang, không phải đồ ăn thức uống.'
      }
      const res = normalizeFoodScanRaw(raw)
      expect(res.is_food).toBe(false)
      expect(res.dish_name).toBe('Đồng hồ đeo tay')
      expect(res.suitability_reason).toContain('không phải đồ ăn')
    })
  })

  describe('analyzeFoodLabelOrMenu - End-to-End Vision Flow', () => {
    it('successfully processes AI response with markdown code fence and trailing conversational text', async () => {
      setApiKey('test-key-vision')
      const mockAiOutput = `
\`\`\`json
{
  "is_food": true,
  "dish_name": "Phở Bò Tái",
  "confidence": 0.96,
  "estimated_weight_g": 480,
  "scan_type": "meal",
  "ingredients": [
    { "name": "Bánh phở", "weight_g": 200, "note": "tinh bột hấp thu vừa" },
    { "name": "Thịt bò tái", "weight_g": 120, "note": "giàu sắt và protein" },
    { "name": "Nước dùng phở", "weight_g": 160, "note": "nhiều natri" }
  ],
  "macros": { "kcal": 490, "protein": 30, "carb": 60, "fat": 13 },
  "micros": { "sodium_mg": 1350, "potassium_mg": 400, "purine": "Vừa", "sugar_g": 3 },
  "gi": 58,
  "suitability": "CAUTION",
  "suitability_reason": "Bát phở bò đầy đặn, người tăng huyết áp nên hạn chế húp hết nước dùng.",
  "cooking_tips": ["Không húp cạn nước dùng để giảm natri"],
  "menu_recommendations": [{ "name": "Phở gà ức", "suitability": "SAFE", "reason": "Ít chất béo hơn" }]
}
\`\`\`

Ảnh bạn vừa tải lên là một bát phở bò rất ngon miệng và đặc trưng của ẩm thực Việt Nam!
      `

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        const u = String(url)
        if (u.includes('/api/health')) {
          return new Response(JSON.stringify({ hasServerKey: true, reachable: true }), { status: 200 })
        }
        return new Response(JSON.stringify({
          choices: [{ message: { content: mockAiOutput } }],
          usage: { prompt_tokens: 150, completion_tokens: 280 }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      })

      const s = get()
      const res = await analyzeFoodLabelOrMenu('data:image/jpeg;base64,mockBase64Data', 'image/jpeg', s.profile, 'meal')

      expect(res.isFallback).toBe(false)
      expect(res.unverified).toBe(false)
      expect(res.dish_name).toBe('Phở Bò Tái')
      expect(res.estimated_weight_g).toBe(480)
      expect(res.macros.kcal).toBe(490)
      expect(res.macros.protein).toBe(30)
      expect(res.micros.sodium_mg).toBe(1350)
      expect(res.suitability).toBe('CAUTION')
      expect(res.ingredients.length).toBe(3)
    })

    it('does NOT silently auto-login on 401 UNAUTHENTICATED and returns honest unverified fallback requiring re-login', async () => {
      const origOrigin = window.location.origin
      Object.defineProperty(window, 'location', {
        value: { ...window.location, origin: 'http://localhost:5173' },
        writable: true,
        configurable: true
      })
      setApiKey('')
      let silentLoginCalled = false

      try {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
          const u = String(url)
          if (u.includes('/api/health')) {
            return new Response(JSON.stringify({ hasServerKey: true, reachable: true }), { status: 200 })
          }
          if (u.includes('/api/auth/login')) {
            silentLoginCalled = true
            return new Response(JSON.stringify({ ok: true }), { status: 200 })
          }
          if (u.includes('/api/ai/chat')) {
            return new Response(JSON.stringify({ error: 'UNAUTHENTICATED' }), { status: 401 })
          }
          return new Response('Not found', { status: 404 })
        })

        const s = get()
        const res = await analyzeFoodLabelOrMenu('data:image/jpeg;base64,mock', 'image/jpeg', s.profile, 'meal')

        expect(silentLoginCalled).toBe(false)
        expect(getRouterHealthSnapshot().gateway.authStatus).toBe('unauthenticated')
        expect(res.isFallback).toBe(true)
        expect(res.unverified).toBe(true)
        expect(res.dish_name).toBe('Không thể xác minh hình ảnh từ AI')
        expect(res.macros.kcal).toBe(0)
        expect(res.macros.protein).toBe(0)
        expect(res.gi).toBeUndefined()
        expect(res.suitability_reason).toContain('Phiên xác thực Backend AI Gateway')
        expect(res.suitability_reason).not.toContain('52 GI')
      } finally {
        Object.defineProperty(window, 'location', {
          value: { ...window.location, origin: origOrigin },
          writable: true,
          configurable: true
        })
      }
    })

    it('successfully scans meal via Vision tier when Gateway session is valid', async () => {
      const origOrigin = window.location.origin
      Object.defineProperty(window, 'location', {
        value: { ...window.location, origin: 'http://localhost:5173' },
        writable: true,
        configurable: true
      })
      setApiKey('')
      let receivedTier = ''

      try {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, opts: any) => {
          const u = String(url)
          if (u.includes('/api/health')) {
            return new Response(JSON.stringify({ hasServerKey: true, reachable: true }), { status: 200 })
          }
          if (u.includes('/api/ai/chat')) {
            const parsedBody = JSON.parse(String(opts?.body || '{}'))
            receivedTier = parsedBody.tier
            return new Response(JSON.stringify({
              choices: [{ message: { content: '{"is_food": true, "dish_name": "Cơm rang dưa bò", "macros": {"kcal": 520, "protein": 22, "carb": 68, "fat": 16}, "suitability": "SAFE"}' } }],
              usage: { prompt_tokens: 100, completion_tokens: 150 }
            }), { status: 200, headers: { 'Content-Type': 'application/json' } })
          }
          return new Response('Not found', { status: 404 })
        })

        const s = get()
        const res = await analyzeFoodLabelOrMenu('data:image/jpeg;base64,mock', 'image/jpeg', s.profile, 'meal')

        expect(receivedTier).toBe('vision')
        expect(getRouterHealthSnapshot().gateway.authStatus).toBe('authenticated')
        expect(res.isFallback).toBe(false)
        expect(res.unverified).toBe(false)
        expect(res.dish_name).toBe('Cơm rang dưa bò')
        expect(res.macros.kcal).toBe(520)
      } finally {
        Object.defineProperty(window, 'location', {
          value: { ...window.location, origin: origOrigin },
          writable: true,
          configurable: true
        })
      }
    })

    it('BYOK mode bypasses backend gateway session and calls OpenAI/Gemini directly', async () => {
      setApiKey('test-user-byok-key')
      let chatEndpointCalled = ''

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, opts: any) => {
        chatEndpointCalled = String(url)
        const auth = opts?.headers?.Authorization || ''
        expect(auth).toBe('Bearer test-user-byok-key')
        return new Response(JSON.stringify({
          choices: [{ message: { content: '{"dish_name": "Salad cá hồi", "macros": {"kcal": 310, "protein": 24, "carb": 8, "fat": 14}, "suitability": "SAFE"}' } }],
          usage: { prompt_tokens: 50, completion_tokens: 80 }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      })

      const s = get()
      const res = await analyzeFoodLabelOrMenu('data:image/jpeg;base64,mock', 'image/jpeg', s.profile, 'meal')
      expect(chatEndpointCalled).not.toContain('/api/ai/chat')
      expect(res.isFallback).toBe(false)
      expect(res.dish_name).toBe('Salad cá hồi')
      expect(res.macros.kcal).toBe(254)
    })

    it('preview Data URL formatting never double-prefixes data:image/jpeg;base64', () => {
      const rawBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      const withPrefix = `data:image/jpeg;base64,${rawBase64}`

      const formatPreview = (b64: string, mime: string) => {
        return b64.startsWith('data:') ? b64 : `data:${mime || 'image/jpeg'};base64,${b64}`
      }

      const p1 = formatPreview(withPrefix, 'image/jpeg')
      const p2 = formatPreview(rawBase64, 'image/jpeg')

      expect(p1.startsWith('data:image/jpeg;base64,')).toBe(true)
      expect(p1).not.toContain('data:image/jpeg;base64,data:')
      expect(p2.startsWith('data:image/jpeg;base64,')).toBe(true)
      expect(p2).not.toContain('data:image/jpeg;base64,data:')
      expect(p1).toBe(p2)
    })
  })

  describe('Frontend Login Synchronization & Food Lens UI Protection', () => {
    it('Login waits for /api/auth/login and verifies /api/auth/session before marking Gateway authenticated', async () => {
      const origOrigin = window.location.origin
      Object.defineProperty(window, 'location', {
        value: { ...window.location, origin: 'http://localhost:5173' },
        writable: true,
        configurable: true
      })

      const callOrder: string[] = []
      try {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
          const u = String(url)
          callOrder.push(u)
          if (u === '/api/auth/login') {
            await new Promise(r => setTimeout(r, 15))
            return new Response(JSON.stringify({ ok: true, user: { id: 'u1', role: 'patient' } }), { status: 200 })
          }
          if (u === '/api/auth/session') {
            return new Response(JSON.stringify({ ok: true, user: { id: 'u1', role: 'patient' } }), { status: 200 })
          }
          return new Response('Not found', { status: 404 })
        })

        render(React.createElement(Login))
        fireEvent.click(screen.getByText('Đăng nhập', { selector: 'button' }))

        // Must NOT have completed client login synchronously before backend resolves
        expect(get().session).toBeNull()

        await waitFor(() => {
          expect(get().session).toBe('u1')
        })
        expect(callOrder).toEqual(['/api/auth/login', '/api/auth/session'])
        expect(getRouterHealthSnapshot().gateway.authStatus).toBe('authenticated')
      } finally {
        Object.defineProperty(window, 'location', {
          value: { ...window.location, origin: origOrigin },
          writable: true,
          configurable: true
        })
      }
    })

    it('Login aborts without fake local login when Backend rejects CSRF/auth', async () => {
      const origOrigin = window.location.origin
      Object.defineProperty(window, 'location', {
        value: { ...window.location, origin: 'http://localhost:5173' },
        writable: true,
        configurable: true
      })

      try {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
          if (String(url) === '/api/auth/login') {
            return new Response(JSON.stringify({ error: 'CSRF_REJECTED' }), { status: 403 })
          }
          return new Response('Not found', { status: 404 })
        })

        render(React.createElement(Login))
        fireEvent.click(screen.getByText('Đăng nhập', { selector: 'button' }))

        await waitFor(() => {
          expect(screen.getByRole('alert').textContent).toContain('CSRF_REJECTED')
        })
        expect(get().session).toBeNull()
        expect(getRouterHealthSnapshot().gateway.authStatus).toBe('unauthenticated')
      } finally {
        Object.defineProperty(window, 'location', {
          value: { ...window.location, origin: origOrigin },
          writable: true,
          configurable: true
        })
      }
    })

    it('Login marks Gateway Offline and allows local demo mode only when Backend is unreachable', async () => {
      const origOrigin = window.location.origin
      Object.defineProperty(window, 'location', {
        value: { ...window.location, origin: 'http://localhost:5173' },
        writable: true,
        configurable: true
      })

      try {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))

        render(React.createElement(Login))
        fireEvent.click(screen.getByText('Đăng nhập', { selector: 'button' }))

        await waitFor(() => {
          expect(get().session).toBe('u1')
        })
        expect(getRouterHealthSnapshot().gateway.authStatus).toBe('offline')
      } finally {
        Object.defineProperty(window, 'location', {
          value: { ...window.location, origin: origOrigin },
          writable: true,
          configurable: true
        })
      }
    })

    it('Diary Food Lens displays dashes (no 52 GI), disables save, keeps preview valid and renders re-login on 401 failure', async () => {
      login('patient@demo.vn', 'Demo123!')
      const origOrigin = window.location.origin
      Object.defineProperty(window, 'location', {
        value: { ...window.location, origin: 'http://localhost:5173' },
        writable: true,
        configurable: true
      })

      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP'
      vi.spyOn(imageUtils, 'compressImageFile').mockResolvedValue({
        base64: dataUrl,
        mimeType: 'image/jpeg',
        originalSizeKB: 100,
        compressedSizeKB: 30,
        reductionPercent: 70,
        width: 512,
        height: 512
      })

      try {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
          const u = String(url)
          if (u.includes('/api/health')) {
            return new Response(JSON.stringify({ hasServerKey: true, reachable: true }), { status: 200 })
          }
          if (u.includes('/api/ai/chat')) {
            return new Response(JSON.stringify({ error: 'UNAUTHENTICATED' }), { status: 401 })
          }
          return new Response('Not found', { status: 404 })
        })

        const diaryBefore = JSON.stringify(get().diary)
        const { container } = render(React.createElement(Diary))
        const fileInput = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement
        const fakeFile = new File(['dummy'], 'pho.jpg', { type: 'image/jpeg' })
        fireEvent.change(fileInput, { target: { files: [fakeFile] } })

        await waitFor(() => {
          expect(screen.getByText('Không thể xác minh hình ảnh từ AI')).toBeTruthy()
        })

        // Preview image src must NOT have nested data URL prefix
        const previewImg = screen.getByAltText('Không thể xác minh hình ảnh từ AI') as HTMLImageElement
        expect(previewImg.getAttribute('src')).toBe(dataUrl)
        expect(previewImg.getAttribute('src')).not.toContain('data:image/jpeg;base64,data:')

        // Must NOT show default 52 GI or allow saving fallback
        expect(screen.queryByText('52')).toBeNull()
        const saveBtn = screen.getByRole('button', { name: /Lưu vào/i }) as HTMLButtonElement
        expect(saveBtn.disabled).toBe(true)

        // Must provide re-login and scan another dish buttons
        expect(screen.getByRole('button', { name: /Đăng nhập lại/i })).toBeTruthy()
        expect(screen.getByRole('button', { name: /Quét món khác/i })).toBeTruthy()

        // Clicking disabled Save button must NOT add fake item to diary
        fireEvent.click(saveBtn)
        expect(JSON.stringify(get().diary)).toBe(diaryBefore)
      } finally {
        Object.defineProperty(window, 'location', {
          value: { ...window.location, origin: origOrigin },
          writable: true,
          configurable: true
        })
      }
    })

    it('probeGatewayHealth never negative-caches offline state and retries fresh /api/health when server recovers', async () => {
      const origOrigin = window.location.origin
      Object.defineProperty(window, 'location', {
        value: { ...window.location, origin: 'http://localhost:5173' },
        writable: true,
        configurable: true
      })
      setApiKey('')
      let healthCalls = 0

      try {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
          if (String(url).includes('/api/health')) {
            healthCalls++
            if (healthCalls === 1) {
              throw new TypeError('Failed to fetch during server restart')
            }
            return new Response(JSON.stringify({ ok: true, hasServerKey: true, reachable: true }), { status: 200 })
          }
          if (String(url).includes('/api/ai/chat')) {
            return new Response(JSON.stringify({
              choices: [{ message: { content: '{"is_food": true, "dish_name": "Thanh long đỏ & Bánh quy", "macros": {"kcal": 210, "protein": 3, "carb": 42, "fat": 3}, "suitability": "SAFE"}' } }]
            }), { status: 200, headers: { 'Content-Type': 'application/json' } })
          }
          return new Response('Not found', { status: 404 })
        })

        // 1st probe fails while gateway restarts
        const firstProbe = await probeGatewayHealth()
        expect(firstProbe.reachable).toBe(false)

        // Immediately afterward (without waiting 15s), probeGatewayHealth() must hit /api/health again instead of returning stale negative cache
        const res = await analyzeFoodLabelOrMenu('data:image/jpeg;base64,mock', 'image/jpeg', get().profile, 'meal')
        expect(healthCalls).toBe(2)
        expect(res.isFallback).toBe(false)
        expect(res.dish_name).toBe('Thanh long đỏ & Bánh quy')
      } finally {
        Object.defineProperty(window, 'location', {
          value: { ...window.location, origin: origOrigin },
          writable: true,
          configurable: true
        })
      }
    })

    it('re-establishes Gateway session for already logged-in frontend user after backend RAM restart and retries once', async () => {
      login('patient@demo.vn', 'Demo123!')
      const origOrigin = window.location.origin
      Object.defineProperty(window, 'location', {
        value: { ...window.location, origin: 'http://localhost:5173' },
        writable: true,
        configurable: true
      })
      setApiKey('')
      let chatAttempts = 0
      let loginBodyEmail = ''
      let sessionVerified = false

      try {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, opts: any) => {
          const u = String(url)
          if (u.includes('/api/health')) {
            return new Response(JSON.stringify({ ok: true, hasServerKey: true, reachable: true }), { status: 200 })
          }
          if (u.includes('/api/auth/login')) {
            loginBodyEmail = JSON.parse(String(opts?.body || '{}')).email
            return new Response(JSON.stringify({ ok: true, user: { id: 'u1', role: 'patient' } }), { status: 200 })
          }
          if (u.includes('/api/auth/session')) {
            sessionVerified = true
            return new Response(JSON.stringify({ ok: true, user: { id: 'u1', role: 'patient' } }), { status: 200 })
          }
          if (u.includes('/api/ai/chat')) {
            chatAttempts++
            if (chatAttempts === 1) {
              return new Response(JSON.stringify({ error: 'UNAUTHENTICATED' }), { status: 401 })
            }
            return new Response(JSON.stringify({
              choices: [{ message: { content: '{"is_food": true, "dish_name": "Bún chả", "macros": {"kcal": 480, "protein": 24, "carb": 55, "fat": 18}, "suitability": "CAUTION"}' } }]
            }), { status: 200, headers: { 'Content-Type': 'application/json' } })
          }
          return new Response('Not found', { status: 404 })
        })

        const res = await analyzeFoodLabelOrMenu('data:image/jpeg;base64,mock', 'image/jpeg', get().profile, 'meal')
        expect(loginBodyEmail).toBe('patient@demo.vn')
        expect(sessionVerified).toBe(true)
        expect(chatAttempts).toBe(2)
        expect(res.isFallback).toBe(false)
        expect(res.dish_name).toBe('Bún chả')
        expect(getRouterHealthSnapshot().gateway.authStatus).toBe('authenticated')
      } finally {
        Object.defineProperty(window, 'location', {
          value: { ...window.location, origin: origOrigin },
          writable: true,
          configurable: true
        })
      }
    })
  })
})
