// @vitest-environment jsdom
if (typeof window !== 'undefined' && typeof window.localStorage?.setItem !== 'function') {
  const storageMap = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (k: string) => storageMap.get(k) ?? null,
      setItem: (k: string, v: string) => storageMap.set(k, String(v)),
      removeItem: (k: string) => storageMap.delete(k),
      clear: () => storageMap.clear(),
      get length() { return storageMap.size },
      key: (i: number) => Array.from(storageMap.keys())[i] ?? null
    },
    writable: true
  })
}
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import AnatomyVisualizer from '../src/components/Anatomy3DVisualizer'
import { runInputGuardrails, runOutputGuardrails } from '../src/services/guardrails'
import { askNutritionAI, generateClinicalConsultation, setApiKey } from '../src/services/aiService'
import { runClinicalConsultAgent, runClinicalPlanWorkflow } from '../src/services/workflowAgent'
import { seed } from '../src/data/seed'
import { SAMPLE_MEDICAL_PRESETS } from '../src/services/store'
import * as store from '../src/services/store'
import { calc, hasFoodNameMismatch, validatePlanInvariants, generate, getPortionBounds } from '../src/utils/nutrition'
import { runAIEvalSuite } from '../src/evals/aiEvalSuite'
import { routeChatCompletion, resetModelRouterState } from '../src/services/modelRouter'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  resetModelRouterState()
  setApiKey('', '', '')
})

describe('Adversarial QA Regression Suite (BAO_CAO_KIEM_THU_LOCALHOST_5173 QA-01..QA-10)', () => {
  it('QA-01: Blocks natural symptom-cluster emergency phrasing (with & without accents) and blocks |gi false trigger', () => {
    const accented = runInputGuardrails('Ngực như bị vật nặng đè, tôi thở không nổi, cứ vã mồ hôi. Tôi cần làm gì ngay?')
    expect(accented.allowed).toBe(false)
    expect(accented.blockedReason).toBe('EMERGENCY_115')

    const unaccented = runInputGuardrails('Nguc nhu bi vat nang de, tho khong noi, va mo hoi lanh, toi can lam gi?')
    expect(unaccented.allowed).toBe(false)
    expect(unaccented.blockedReason).toBe('EMERGENCY_115')

    const control = runInputGuardrails('Tôi cần làm gì để ăn gạo lứt đúng khẩu phần?')
    expect(control.allowed).toBe(true)
  })

  it('QA-01: Empty patient profile (patient.test@demo.vn) never receives fabricated Glucose 8.4 / HbA1c 7.8% / eGFR 28', async () => {
    const emptyProfile = {
      dob: '1992-05-10',
      height: 165,
      weight: 60,
      activity: 1.375,
      goal: 'Ăn lành mạnh',
      allergies: '',
      conditions: [],
      medications: [],
      files: []
    }
    const consult1 = generateClinicalConsultation('Tôi cần làm gì để ăn sáng cân đối?', emptyProfile, seed().docs)
    expect(consult1.text).not.toMatch(/8\.4|7\.8%|28 ml\/phút|510|145\/92|Nguyễn Văn An/i)

    const consult2 = await askNutritionAI('Cơm trắng có tốt cho bữa trưa không?', emptyProfile, seed().docs, undefined, seed().foods, {
      skipRemoteModel: true
    })
    expect(consult2.text).not.toMatch(/8\.4|7\.8%/)
  })

  it('QA-02 & QA-03: All preset 7-day & 1-day plans have zero F014 olive-oil mislinks, zero name mismatch, and >=1200 kcal/day within hard_limits', () => {
    store.reset()
    const baseState = seed()
    const qaProfile = {
      dob: '1992-01-15',
      height: 168,
      weight: 68,
      activity: 1.375,
      goal: 'Duy trì cân nặng',
      allergies: '',
      conditions: [] as string[],
      medications: [] as string[],
      files: []
    }

    for (const preset of SAMPLE_MEDICAL_PRESETS) {
      for (const daysCount of [1, 7] as const) {
        for (const mealsCount of [3, 4]) {
          const plan = store.buildClinicalPlanFromRecord(
            qaProfile,
            preset.extraction,
            undefined,
            baseState.docs,
            baseState.rules,
            daysCount,
            mealsCount
          )
          expect(plan.days.length).toBe(daysCount)
          const invErrs = validatePlanInvariants(plan, qaProfile, baseState, mealsCount)
          expect(invErrs).toEqual([])

          for (const day of plan.days) {
            const items = Object.values(day).flat()
            items.forEach(it => {
              expect(hasFoodNameMismatch(it, baseState.foods)).toBe(false)
              if (it.foodId === 'F014') {
                expect(it.foodName?.toLowerCase()).toContain('oliu')
              }
            })
            const totals = calc(items, baseState.foods)
            expect(totals.kcal).toBeGreaterThanOrEqual(1200)
          }
        }
      }
    }
  })

  it('keeps realistic portion bounds (>= 60g-80g protein foods, <= 180g-200g rice) across clinical plans & generate()', () => {
    store.reset()
    const baseState = seed()
    const qaProfile = {
      dob: '1992-01-15',
      height: 168,
      weight: 68,
      activity: 1.375,
      goal: 'Duy trì cân nặng',
      allergies: '',
      conditions: [] as string[],
      medications: [] as string[],
      files: []
    }

    for (const preset of SAMPLE_MEDICAL_PRESETS) {
      const isCkdPreset = preset.id === 'preset-ckd-heart'
      const plan = store.buildClinicalPlanFromRecord(
        qaProfile,
        preset.extraction,
        undefined,
        baseState.docs,
        baseState.rules,
        7,
        3
      )
      for (const day of plan.days) {
        const items = Object.values(day).flat()
        for (const it of items) {
          const ref = baseState.foods.find(f => f.id === it.foodId)
          if (!ref) continue
          const bounds = getPortionBounds(ref)
          if (bounds.kind === 'rice') {
            expect(it.grams).toBeLessThanOrEqual(200)
            if (/cơm\s*trắng|gạo\s*tẻ/i.test(ref.name)) {
              expect(it.grams).toBeLessThanOrEqual(180)
            }
          }
          if (ref.category === 'Đạm') {
            expect(it.grams).toBeGreaterThanOrEqual(isCkdPreset ? 45 : 60)
          }
        }
      }
    }

    const genDays = generate({ ...qaProfile, conditions: ['Đái tháo đường type 2'] }, baseState, 1, 3, true)
    Object.values(genDays[0]).flat().forEach(it => {
      const ref = baseState.foods.find(f => f.id === it.foodId)
      if (!ref) return
      const bounds = getPortionBounds(ref)
      if (ref.category === 'Đạm') expect(it.grams).toBeGreaterThanOrEqual(60)
      if (bounds.kind === 'rice') expect(it.grams).toBeLessThanOrEqual(200)
    })
  })

  it('QA-03: Strict validatePlanInvariants rejects negative grams, 15kcal days, and strict 1.0x hard_limit overruns', () => {
    const base = seed()
    const prof = base.profile
    const overPlan: any = {
      id: 'p-qa03',
      name: 'QA03',
      created: new Date().toISOString(),
      personalized: true,
      has_conflict: false,
      status: 'PENDING_EXPERT_REVIEW',
      expert_notes: '',
      history: [],
      hard_limits: { max_sodium_mg: 1000, max_protein_g: 100, max_gi: 55 },
      days: [
        {
          'Bữa sáng': [{ foodId: 'F001', foodName: 'Gạo lứt', grams: -100 }],
          'Bữa trưa': [{ foodId: 'F004', foodName: 'Ức gà phi lê', grams: 360 }],
          'Bữa tối': [{ foodId: 'F002', foodName: 'Khoai lang luộc', grams: 500 }]
        }
      ]
    }
    const errs = validatePlanInvariants(overPlan, prof, base, 3)
    expect(errs.some(e => e.includes('khẩu phần không hợp lệ'))).toBe(true)
    expect(errs.some(e => e.includes('vượt trần Đạm'))).toBe(true)

    const low15Plan: any = {
      ...overPlan,
      days: [
        {
          'Bữa sáng': [{ foodId: 'F011', foodName: 'Dưa leo thái lát', grams: 33 }],
          'Bữa trưa': [{ foodId: 'F011', foodName: 'Dưa leo thái lát', grams: 33 }],
          'Bữa tối': [{ foodId: 'F011', foodName: 'Dưa leo thái lát', grams: 34 }]
        }
      ]
    }
    const errsLow = validatePlanInvariants(low15Plan, prof, base, 3)
    expect(errsLow.some(e => e.includes('thiếu năng lượng tối thiểu'))).toBe(true)
  })

  it('QA-04: Running AI Evals preserves active admin/expert session, selected patient, and concurrent store mutations', async () => {
    store.reset()
    expect(store.login('admin@demo.vn', 'Demo123!')).toBe('')
    store.selectPatient('u-test-patient')
    store.set(d => {
      d.profile.goal = 'QA_EDIT_DURING_EVAL'
    })

    const rep = await runAIEvalSuite()
    expect(rep.passed).toBe(rep.total)
    expect(rep.total).toBeGreaterThanOrEqual(30)
    expect(store.me()?.email).toBe('admin@demo.vn')
    expect(store.get().activePatientId).toBe('u-test-patient')
    expect(store.get().profile.goal).toBe('QA_EDIT_DURING_EVAL')
  })

  it('QA-06: Stage 3 Output Guardrail blocks fabricated patient lab metrics BEFORE onToken emits to UI', async () => {
    store.reset()
    expect(store.login('patient.test@demo.vn', 'Demo123!')).toBe('')
    setApiKey('test-key', 'https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-flash-latest')

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Kết quả Glucose đói 8.4 mmol/L và HbA1c 7.8% của bác rất cao.', tool_calls: [] } }],
          usage: { prompt_tokens: 10, completion_tokens: 20 }
        })
      })
    )

    const emittedChunks: string[] = []
    const res = await runClinicalConsultAgent('Hôm nay ăn cơm thế nào?', chunk => emittedChunks.push(chunk))
    expect(res.source_type).toBe('HIGH_RISK_GUARDRAIL')
    expect(emittedChunks.join('')).not.toContain('8.4')
    expect(emittedChunks.join('')).not.toContain('7.8%')
    expect(res.text).toContain('Guardrail')
  })

  it('QA-07: Expert approvePlan & rejectPlan sync workflowRuns from PAUSED_HITL to COMPLETED', async () => {
    store.reset()
    expect(store.login('patient@demo.vn', 'Demo123!')).toBe('')
    const wf = await runClinicalPlanWorkflow({ daysCount: 1, mealsCount: 3 })
    expect(wf.run.status).toBe('PAUSED_HITL')
    expect(wf.plan).toBeDefined()

    if (!wf.plan) throw new Error('Expected plan')

    expect(store.login('expert@demo.vn', 'Demo123!')).toBe('')
    const err = store.approvePlan(wf.plan.id, 'Duyệt QA-07')
    expect(err).toBe('')

    const updatedRun = store.get().workflowRuns?.find(r => r.id === wf.run.id)
    expect(updatedRun?.status).toBe('COMPLETED')
    expect(updatedRun?.currentStep).toBe('hitl_approved')
    expect(store.get().traceSpans?.some(sp => sp.name === 'hitl:expert_approved')).toBe(true)
  })

  it('QA-08: Anatomy3DVisualizer distinguishes empty unassessed profile from evaluated healthy checkup', () => {
    store.reset()
    expect(store.login('patient.test@demo.vn', 'Demo123!')).toBe('')
    render(<AnatomyVisualizer />)
    expect(screen.getByText('CHƯA CÓ DỮ LIỆU BỆNH ÁN')).toBeTruthy()
    expect(screen.queryByText('KHỎE MẠNH')).toBeNull()
    expect(screen.queryByText(/Toàn bộ hệ thống cơ quan hoạt động tối ưu/i)).toBeNull()

    cleanup()
    store.applyPresetMedicalRecord('preset-healthy')
    render(<AnatomyVisualizer />)
    expect(screen.getByText(/ĐÃ ĐÁNH GIÁ · ỔN ĐỊNH/i)).toBeTruthy()
  })

  it('QA-10: Aborted/timeout upstream call does not cascade into 4 requests across ReAct + askNutritionAI', async () => {
    store.reset()
    expect(store.login('patient.test@demo.vn', 'Demo123!')).toBe('')
    setApiKey('test-key', 'https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-flash-latest')

    const abortErr = Object.assign(new Error('signal is aborted without reason'), { name: 'AbortError' })
    const fetchSpy = vi.fn().mockRejectedValue(abortErr)
    vi.stubGlobal('fetch', fetchSpy)

    await expect(
      routeChatCompletion({
        messages: [{ role: 'user', content: 'test' }],
        apiKey: 'test-key',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        configuredModel: 'gemini-flash-latest',
        timeoutMs: 100
      })
    ).rejects.toThrow(/TIMEOUT/i)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    fetchSpy.mockClear()
    const agentRes = await runClinicalConsultAgent('Tôi cần ăn gì cho cân đối?')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(agentRes.text).toContain('TIMEOUT')
  })

  it('RAG FALLBACK summarizes actual stored medical record faithfully without fabricating HbA1c or false-triggering Output Guardrail', async () => {
    store.reset()
    expect(store.login('patient.test@demo.vn', 'Demo123!')).toBe('')
    setApiKey('', '', '')

    // Case A: Patient actually has HbA1c "8.1%" and Creatinine 168 in confirmed record
    store.addMedicalRecord({
      id: 'rec-real-hba1c',
      name: 'Ho-so-da-benh-ly.docx',
      date: '2026-11-20',
      type: 'Bệnh án',
      metrics: [
        { name: 'Creatinine', value: 168, unit: 'µmol/L', status: 'high', referenceRange: '62 - 106', affectedOrgan: 'kidneys' },
        { name: 'HbA1c', value: '8.1%', unit: '', status: 'high', referenceRange: '< 5.7%', affectedOrgan: 'pancreas' }
      ],
      diseases: ['Đái tháo đường Type 2', 'Suy thận mạn'],
      allergies: [],
      medications: [{ name: 'Metformin', activeIngredient: 'Metformin', dosage: '850mg', purpose: 'Đường huyết' }],
      has_conflict: true,
      organ_mappings: [],
      raw_summary: 'Bệnh án thật có HbA1c 8.1%',
      confirmed: true
    })

    const resA = await runClinicalConsultAgent('Tóm tắt hồ sơ bệnh án của tôi', undefined, { offlineOnly: true })
    expect(resA.source_type).not.toBe('HIGH_RISK_GUARDRAIL')
    expect(resA.text).not.toContain('Guardrail Kiểm soát Đầu ra Đã Chặn')
    expect(resA.text).toContain('8.1%')
    expect(resA.text).toContain('168')
    expect(resA.text).toContain('Metformin')

    // Case B: Patient has Gout + Hypertension WITHOUT any HbA1c metric in record
    store.clearMedicalRecord()
    store.addMedicalRecord({
      id: 'rec-no-hba1c',
      name: 'Ho-so-gout.pdf',
      date: '2026-11-20',
      type: 'Bệnh án',
      metrics: [
        { name: 'Acid Uric', value: 520, unit: 'µmol/L', status: 'high', referenceRange: '200 - 420', affectedOrgan: 'joints' }
      ],
      diseases: ['Gout mạn tính', 'Tăng huyết áp độ 2'],
      allergies: [],
      medications: [{ name: 'Zyloric', activeIngredient: 'Allopurinol', dosage: '300mg', purpose: 'Hạ uric' }],
      has_conflict: false,
      organ_mappings: [],
      raw_summary: 'Gout và tăng huyết áp',
      confirmed: true
    })

    const resB = await runClinicalConsultAgent(
      'Hồ sơ bệnh án hiện tại của tôi có những bệnh gì và chỉ số xét nghiệm nào?',
      undefined,
      { offlineOnly: true }
    )
    expect(resB.source_type).not.toBe('HIGH_RISK_GUARDRAIL')
    expect(resB.text).not.toContain('Guardrail Kiểm soát Đầu ra Đã Chặn')
    expect(resB.text).toContain('Gout mạn tính')
    expect(resB.text).toContain('520')
    expect(resB.text).not.toMatch(/HbA1c/i)

    const resBUnaccented = await askNutritionAI(
      'Ho so cua toi co benh gi?',
      store.get().profile,
      store.get().docs,
      undefined,
      store.get().foods,
      { skipRemoteModel: true }
    )
    expect(resBUnaccented.source_type).not.toBe('HIGH_RISK_GUARDRAIL')
    expect(resBUnaccented.text).toContain('Gout mạn tính')
    expect(resBUnaccented.text).not.toMatch(/HbA1c/i)
  })
})
