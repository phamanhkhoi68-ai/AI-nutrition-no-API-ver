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
Object.defineProperty(window, 'localStorage', { value: mockStorage, writable: true })

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  reset,
  get,
  set,
  me,
  login,
  approvePlan,
  addMedicalRecord,
  confirmMedicalRecord,
  buildClinicalPlanFromRecord,
  syncDailyNutrientAlerts
} from '../src/services/store'
import {
  analyzeMedicalRecordPDF,
  askNutritionAI,
  generateMenuPlanAI,
  setApiKey,
  getApiKey
} from '../src/services/aiService'
import { extractClinicalDataFromText, extractDocxContent } from '../src/utils/pdfExtractor'
import { calc, localDateIso } from '../src/utils/nutrition'
import { Dashboard, Planner } from '../src/pages/Patient'
import { listMcpTools, callMcpTool } from '../src/services/mcpTools'
import { runClinicalPlanWorkflow, resumeWorkflowRun } from '../src/services/workflowAgent'

beforeEach(() => {
  mockStorage.clear()
  reset()
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('BAO_CAO_QA.md Remaining Issues (L01-L16) & MCP / Workflow Agent', () => {
  it('L01: Auto-created rules from medical record stay Chờ duyệt and plans start PENDING_EXPERT_REVIEW', () => {
    const ext = extractClinicalDataFromText('Chẩn đoán: Sỏi thận phải 7mm.\nCreatinine: 135 µmol/L', 'soi_than.txt')
    addMedicalRecord({ ...ext, confirmed: true })
    const after = get()
    const autoRule = after.rules.find(r => r.reference.includes('soi_than.txt'))
    expect(autoRule?.status).toBe('Chờ duyệt')
    expect(after.plans[0].status).toBe('PENDING_EXPERT_REVIEW')
  })

  it('saves labs without a plan, blocks incomplete profiles and rejects draft plans from before the fix', async () => {
    const legacy = { ...structuredClone(get().plans[0]), id: 'plan-cdss-1760000000000' }
    login('patient.test@demo.vn', 'Demo123!')
    const lab = extractClinicalDataFromText('Creatinine 145 µmol/L\nGlucose 8.4 mmol/L', 'qa-labs.pdf')
    confirmMedicalRecord(lab)
    expect(get().profile.files[0].metrics.length).toBeGreaterThan(0)
    expect(get().plans).toEqual([])

    const diagnosis = extractClinicalDataFromText('Chẩn đoán: Sỏi thận phải 7mm.', 'qa-diagnosis.pdf')
    confirmMedicalRecord(diagnosis)
    expect(get().profile.conditions.length).toBeGreaterThan(0)
    expect(get().plans).toEqual([])

    set(d => {
      d.profile.height = 170
      d.profile.weight = 60
      d.plans.push(legacy)
    })
    const run = await runClinicalPlanWorkflow({ daysCount: 7, mealsCount: 3 })
    expect(run.plan).toBeUndefined()
    expect(run.run.currentStep).toBe('ingest_and_validate')
    expect(callMcpTool('export_fhir_nutrition_order', { planId: legacy.id }).ok).toBe(false)
    expect(callMcpTool('get_patient_daily_intake').data.remainingBudget).toBeNull()
    render(<MemoryRouter><Planner /></MemoryRouter>)
    expect((screen.getByRole('button', { name: /Tạo Thực đơn Mới/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText(/GIỚI HẠN THAM CHIẾU/)).toBeNull()

    set(d => { d.profile.dob = '1990-01-01' })
    confirmMedicalRecord(lab)
    expect(get().profile.conditions.length).toBeGreaterThan(0)
    expect(get().plans.map(plan => plan.id)).toEqual([legacy.id])
    expect(callMcpTool('export_fhir_nutrition_order', { planId: legacy.id }).ok).toBe(false)
    login('expert@demo.vn', 'Demo123!')
    expect(approvePlan(legacy.id)).toContain('tạo lại thực đơn')
  })

  it('L02: Excludes negated medications and preserves exact source dosage string', () => {
    const neg = extractClinicalDataFromText(
      'Chẩn đoán: Không có suy thận mạn. Không dùng metformin hay warfarin.',
      'neg_meds.txt'
    )
    expect(neg.diseases).toEqual([])
    expect(neg.medications).toEqual([])

    const dose = extractClinicalDataFromText(
      'Chẩn đoán: Đái tháo đường Type 2\nĐơn thuốc: Metformin 850 mg một viên/ngày sau ăn trưa.',
      'dose.txt'
    )
    const met = dose.medications.find(m => /metformin/i.test(m.activeIngredient))
    expect(met).toBeDefined()
    expect(met?.dosage).toContain('850 mg')
    expect(met?.dosage).not.toContain('500mg')
  })

  it('L03: Two identically named and sized files with different content do not collide in cache', async () => {
    setApiKey('')
    const textA = 'Bệnh nhân mắc suy thận mạn CKD giai đoạn 4 và tăng huyết áp độ 2.'
    const textB = 'Bệnh nhân mắc viêm gan B mạn tính, gan nhiễm mỡ men gan AST 140.'
    const paddedA = textA.padEnd(73, ' ')
    const paddedB = textB.padEnd(73, ' ')
    expect(paddedA.length).toBe(paddedB.length)

    const fileA = new File([paddedA], 'qa-shared.txt', { type: 'text/plain' })
    const fileB = new File([paddedB], 'qa-shared.txt', { type: 'text/plain' })
    const resA = await analyzeMedicalRecordPDF(fileA, 'text/plain', 'qa-shared.txt')
    const resB = await analyzeMedicalRecordPDF(fileB, 'text/plain', 'qa-shared.txt')
    expect(resA.diseases.join(' ')).not.toEqual(resB.diseases.join(' '))
    expect(resB.diseases.some(d => /gan/i.test(d))).toBe(true)
  })

  it('L04: Seeded profile aligns with OCR record and Dashboard shows unified clinical protein ceiling', () => {
    login('patient@demo.vn', 'Demo123!')
    set(d => { d.plans[0].status = 'EXPERT_APPROVED' })
    const s = get()
    expect(s.profile.allergies).toContain('Đậu phộng')
    expect(s.profile.files[0]?.diseases.length).toBeGreaterThanOrEqual(4)

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    )
    expect(screen.getByText('/ 45 g')).toBeTruthy()
    expect(screen.queryByText('/ 56 g')).toBeNull()
  })

  it('L05 & L07: generateMenuPlanAI does not leak FA_ foods on invalid day count, respects 3-meal cap, and fallback has zero missing foodIds', async () => {
    setApiKey('test-key')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                name: 'Incomplete 7d',
                days: [{
                  'Bữa sáng': [{ foodName: 'Món Lạ Chưa Xác Minh', grams: 120, kcal: 200, protein: 10, carb: 30, fat: 3, sodium: 50 }],
                  'Bữa trưa': [{ foodName: 'Cơm gạo lứt', grams: 120, kcal: 140, protein: 4, carb: 28, fat: 1, sodium: 10 }],
                  'Bữa tối': [{ foodName: 'Cá hấp gừng hành', grams: 100, kcal: 115, protein: 19, carb: 1, fat: 4, sodium: 90 }],
                  'Bữa phụ': [{ foodName: 'Món phụ thừa', grams: 100, kcal: 90, protein: 2, carb: 15, fat: 1, sodium: 10 }]
                }]
              })
            }
          }]
        }),
        { status: 200 }
      )
    )
    const foodsCopy = structuredClone(get().foods)
    const beforeCount = foodsCopy.length
    const plan7 = await generateMenuPlanAI(get().profile, foodsCopy, get().rules, 7, 3, get().profile.files[0], get().activeOrganAlerts, get().docs)
    // 7-day validation failed on incomplete 1-day response -> no stranded FA_ food leaked into catalog!
    expect(foodsCopy.length).toBe(beforeCount)
    expect(plan7.days).toHaveLength(7)
    expect(plan7.status).toBe('PENDING_EXPERT_REVIEW')
    plan7.days.forEach(dayObj => {
      // Requested 3 meals -> Bữa phụ stripped cleanly
      expect(dayObj['Bữa phụ']).toBeUndefined()
      const items = Object.values(dayObj).flat()
      items.forEach(it => {
        expect(foodsCopy.some(f => f.id === it.foodId) || Boolean(it.snapshot)).toBe(true)
      })
      const totals = calc(items, foodsCopy)
      expect(totals.protein).toBeLessThanOrEqual((plan7.hard_limits?.max_protein_g as number) || 45)
    })

    // Kidney stone 7-day fallback has ZERO missing foodIds and clamps protein within limit
    const stonePlan = buildClinicalPlanFromRecord(
      { ...get().profile, conditions: ['Sỏi thận'], medications: [] },
      {
        id: 'stone-1', name: 'soi.pdf', date: '2026-11-19', type: 'Xét nghiệm',
        metrics: [], diseases: ['Sỏi thận'], allergies: [], medications: [],
        has_conflict: false, organ_mappings: [], raw_summary: '', confirmed: true
      },
      get().activeOrganAlerts,
      get().docs,
      get().rules,
      7
    )
    const maxP = Number(stonePlan.hard_limits?.max_protein_g || 56)
    stonePlan.days.forEach(dObj => {
      const items = Object.values(dObj).flat()
      items.forEach(it => expect(get().foods.some(f => f.id === it.foodId)).toBe(true))
      expect(calc(items, get().foods).protein).toBeLessThanOrEqual(maxP)
    })
  })

  it('L08: Locked accounts revoke active session & duplicate approvePlan calls do not duplicate history', () => {
    login('expert@demo.vn', 'Demo123!')
    const planId = get().plans[0].id
    const firstErr = approvePlan(planId, 'Đã thẩm định chuẩn.')
    expect(firstErr).toBe('')
    const histLen = get().plans[0].history.length
    approvePlan(planId, 'Đã thẩm định chuẩn.')
    expect(get().plans[0].history.length).toBe(histLen)

    set(d => { d.users.find(u => u.email === 'expert@demo.vn')!.active = false })
    expect(me(get())).toBeUndefined()
  })

  it('L09: Concurrent multi-tab writes merge profile changes & storage quota error rolls back cleanly', () => {
    const snapshot = get()
    // Simulate another tab advancing disk version & weight while RAM still holds previous snapshot
    const otherTab = structuredClone(snapshot)
    otherTab.version = (snapshot.version || 1) + 1
    otherTab.profile.weight = 62
    mockStorage.setItem('ainp_v4', JSON.stringify(otherTab))

    set(d => { d.profile.goal = 'Kiểm soát muối nghiêm ngặt' })
    expect(get().profile.goal).toBe('Kiểm soát muối nghiêm ngặt')
    expect(get().profile.weight).toBe(62)

    // QuotaExceededError rollback check
    const beforeWeight = get().profile.weight
    vi.spyOn(mockStorage, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
    set(d => { d.profile.weight = 99 })
    expect(get().profile.weight).toBe(beforeWeight)
  })

  it('L11 & L12: Chat citations point to real matching QA doc ID/title instead of KDIGO', async () => {
    setApiKey('test-key')
    const qaDoc = {
      id: 'D_QA_739',
      title: 'Tài liệu QA-CITATION-739',
      condition: 'Suy thận mạn',
      content: 'Quy tắc QA-CITATION-739 đặc hiệu cho món khoai môn nướng mật ong.',
      status: 'Đã duyệt' as const,
      comment: 'QA fixture'
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                text: 'Theo QA-CITATION-739, cần cân đối khẩu phần.',
                source_type: 'INTERNAL_RAG',
                evidence_basis: [{ guideline_name: 'WRONG KDIGO', citation_url: 'https://kdigo.org', rationale: 'fake' }]
              })
            }
          }]
        }),
        { status: 200 }
      )
    )
    const res = await askNutritionAI('Món khoai môn nướng mật ong QA-CITATION-739 dùng được không?', get().profile, [...get().docs, qaDoc])
    expect(res.source_type).toBe('INTERNAL_RAG')
    expect(res.evidence_basis[0].guideline_name).toBe('Tài liệu QA-CITATION-739')
    expect(res.evidence_basis[0].citation_url).toBe('internal://docs/D_QA_739')
  })

  it('L13 & L15 & L16: No hardcoded leaked key, localDateIso resets sodium alerts on clear, and DOCX handles invalid buffers without rejections', async () => {
    expect(getApiKey()).toBe('')
    const today = localDateIso()
    set(d => {
      d.plans[0].status = 'EXPERT_APPROVED'
      d.diary[today] = {
        'Bữa trưa': [{
          foodId: 'HIGH_NA', grams: 200,
          snapshot: { kcal: 200, protein: 10, fat: 5, carb: 20, fiber: 1, sodium: 1200 }
        }]
      }
      syncDailyNutrientAlerts(d, today)
    })
    expect(get().activeOrganAlerts.kidneys.reason).toContain('Cảnh báo vi chất')

    set(d => {
      d.diary[today] = {}
      syncDailyNutrientAlerts(d, today)
    })
    expect(get().activeOrganAlerts.kidneys.reason).not.toContain('Cảnh báo vi chất')

    const corruptDocx = await extractDocxContent(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 8, 0, 1, 2, 3]))
    expect(typeof corruptDocx).toBe('string')
  })

  it('MCP Tool Layer & Stateful Workflow Agent support multi-step execution and resume from failure', async () => {
    expect(listMcpTools().map(t => t.name)).toContain('check_clinical_safety_guardrails')
    const mcpRes = callMcpTool('compute_patient_ceilings')
    expect(mcpRes.ok).toBe(true)
    expect(mcpRes.data.ceilings.max_sodium_mg).toBeLessThanOrEqual(1500)

    const failed = await runClinicalPlanWorkflow({
      daysCount: 1,
      mealsCount: 3,
      simulateStepFailure: 'guardrail_verification'
    })
    expect(failed.run.status).toBe('FAILED')
    expect(failed.run.currentStep).toBe('guardrail_verification')

    const resumed = await resumeWorkflowRun(failed.run.id)
    expect(resumed).not.toBeNull()
    expect(resumed?.plan).toBeDefined()
    expect(['COMPLETED', 'PAUSED_HITL']).toContain(resumed?.run.status)
    expect((get().aiTraces || []).some(t => t.operation.startsWith('mcp:'))).toBe(true)
  })
})
