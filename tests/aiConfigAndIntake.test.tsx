// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import * as store from '../src/services/store'
import { normalizeBaseUrl, normalizeModelName, modelCandidates, isModelNotFoundStatus, AI_TIMEOUTS, DEFAULT_MODEL, GOOGLE_OPENAI_BASE } from '../src/services/aiConfig'
import { routeChatCompletion, resetModelRouterState } from '../src/services/modelRouter'
import { ingestMedicalRecordText } from '../src/services/recordIntake'
import GlobalMedicalIntake from '../src/features/intake/GlobalMedicalIntake'
import { setApiKey, subscribeAiConfigChange, analyzeMedicalRecordPDF } from '../src/services/aiService'

describe('aiConfig: cấu hình AI thống nhất', () => {
  it('chuẩn hoá cấu hình cũ (freemodel.in, gemini-3.7/3.8) về mặc định hợp lệ', () => {
    expect(normalizeBaseUrl('https://freemodel.in/v1', 'AQ.abc')).toBe(GOOGLE_OPENAI_BASE)
    expect(normalizeBaseUrl('', '')).toBe(GOOGLE_OPENAI_BASE)
    expect(normalizeBaseUrl('https://api.openai.com/v1/', 'sk-1')).toBe('https://api.openai.com/v1')
    expect(normalizeModelName('gemini-3.7-flash')).toBe(DEFAULT_MODEL)
    expect(normalizeModelName('gemini-3.8-flash')).toBe(DEFAULT_MODEL)
    expect(normalizeModelName('gpt-4o-mini')).toBe('gpt-4o-mini')
  })
  it('timeout đủ dài cho model suy luận và có chuỗi model dự phòng', () => {
    expect(AI_TIMEOUTS.textExtract).toBeGreaterThanOrEqual(30_000)
    expect(AI_TIMEOUTS.chatTurn).toBeGreaterThanOrEqual(45_000)
    expect(modelCandidates('x-model')[0]).toBe('x-model')
    expect(new Set(modelCandidates('x-model')).size).toBe(modelCandidates('x-model').length)
    expect(isModelNotFoundStatus(404, '')).toBe(true)
    expect(isModelNotFoundStatus(400, 'model foo is not found')).toBe(true)
    expect(isModelNotFoundStatus(500, 'model not found')).toBe(false)
  })
  it('router tự chuyển model dự phòng khi nhà cung cấp trả 404 model not found', async () => {
    resetModelRouterState()
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
      const model = JSON.parse(init.body).model
      calls.push(model)
      if (model === 'ghost-model') return new Response('model ghost-model not found', { status: 404 })
      return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 })
    }))
    const out = await routeChatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'AQ.fake', baseUrl: GOOGLE_OPENAI_BASE, configuredModel: 'ghost-model', expectJson: false
    })
    expect(out.content).toBe('OK')
    expect(calls[0]).toBe('ghost-model')
    expect(calls.length).toBe(2)
    expect(out.model).not.toBe('ghost-model')
    vi.unstubAllGlobals()
  })
  it('setApiKey thông báo cho các component đăng ký và reset trạng thái router', () => {
    let notified = 0
    const unsub = subscribeAiConfigChange(() => { notified++ })
    setApiKey('AIzaSyTestKey123', GOOGLE_OPENAI_BASE, DEFAULT_MODEL)
    expect(notified).toBe(1)
    setApiKey('', '', '')
    expect(notified).toBe(2)
    unsub()
  })
  it('analyzeMedicalRecordPDF đồng bộ qua server AI Gateway khi browser chưa nhập API key', async () => {
    resetModelRouterState()
    setApiKey('', '', '')
    const origOrigin = window.location.origin
    Object.defineProperty(window, 'location', {
      value: { ...window.location, origin: 'http://localhost:5173' },
      writable: true,
      configurable: true
    })
    const endpoints: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      endpoints.push(String(url))
      if (String(url) === '/api/health') {
        return new Response(JSON.stringify({ ok: true, hasServerKey: true, provider: GOOGLE_OPENAI_BASE, models: { fast: DEFAULT_MODEL } }), { status: 200 })
      }
      if (String(url) === '/api/ai/chat') {
        return new Response(JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                title: 'benh-an.txt',
                date: '2026-11-20',
                type: 'Phiếu xét nghiệm',
                metrics: [{ name: 'HbA1c', value: 7.8, unit: '%', status: 'high', referenceRange: '< 6.5%', affectedOrgan: 'pancreas' }],
                diseases: ['Đái tháo đường type 2'],
                allergies: [],
                medications: [],
                has_conflict: false,
                organ_mappings: [],
                raw_summary: 'Đồng bộ từ AI Gateway thành công.'
              })
            }
          }]
        }), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    }))
    try {
      const file = new File(['Chẩn đoán: Đái tháo đường type 2. HbA1c 7.8%.'], 'benh-an.txt', { type: 'text/plain' })
      const res = await analyzeMedicalRecordPDF(file, 'text/plain', 'benh-an.txt')
      expect(endpoints).toContain('/api/health')
      expect(endpoints).toContain('/api/ai/chat')
      expect(res.raw_summary).toContain('AI Gateway')
    } finally {
      Object.defineProperty(window, 'location', {
        value: { ...window.location, origin: origOrigin },
        writable: true,
        configurable: true
      })
      vi.unstubAllGlobals()
    }
  })
})

describe('Cổng nạp bệnh án toàn cục', () => {
  beforeEach(() => {
    store.reset()
    setApiKey('', '', '')
    vi.unstubAllGlobals()
  })
  it('dán văn bản bệnh án -> tạo bản nháp chờ xác nhận -> xác nhận đồng bộ vào hồ sơ', async () => {
    expect(store.login('patient.test@demo.vn', 'Demo123!')).toBe('')
    const text = 'Chẩn đoán: Đái tháo đường type 2. Đang dùng Metformin 850 mg ngày 2 lần. HbA1c 8.1%. Creatinine 168 µmol/L.'
    const draft = await ingestMedicalRecordText(text)
    expect(draft.confirmed).toBe(false)
    expect(store.get().pendingRecordDraft).toBeTruthy()
    store.confirmMedicalRecord(store.get().pendingRecordDraft!)
    const s = store.get()
    expect(s.pendingRecordDraft).toBeNull()
    expect(s.profile.conditions.join(' ').toLowerCase()).toContain('đái tháo đường')
  })
  it('hiển thị nút "Nạp bệnh án" cho bệnh nhân ở mọi trang và không hiển thị cho khách', () => {
    store.login('patient.test@demo.vn', 'Demo123!')
    render(<MemoryRouter><GlobalMedicalIntake /></MemoryRouter>)
    expect(screen.getByLabelText('Nạp bệnh án')).toBeTruthy()
  })

  it('liên kết nạp bệnh án giữa Hồ sơ và Trợ lý AI đồng bộ vào ngữ cảnh lâm sàng', async () => {
    store.login('patient.test@demo.vn', 'Demo123!')
    const text = 'Chẩn đoán: Suy thận mạn giai đoạn 3b, Tăng huyết áp. Đang dùng Losartan 50mg, Furosemide 20mg.'
    const draft = await ingestMedicalRecordText(text, 'BenhAnThuan.txt')
    expect(draft.name).toBe('BenhAnThuan.txt')

    // Xác nhận lưu bệnh án
    store.confirmMedicalRecord(draft)
    const s = store.get()
    expect(s.profile.files?.[0]?.name).toBe('BenhAnThuan.txt')

    // Context AI tự động đồng bộ tên tệp, bệnh lý và thuốc
    const { getCompactPatientContext } = await import('../src/services/aiService')
    const ctx = getCompactPatientContext(s.profile)
    expect(ctx).toContain('Bệnh án liên kết: BenhAnThuan.txt')
    expect(ctx).toContain('Suy thận')
    expect(ctx).toContain('Losartan')
  })
})
