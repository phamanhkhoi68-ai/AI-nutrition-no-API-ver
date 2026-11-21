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

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AnatomyVisualizer } from '../src/components/Anatomy3DVisualizer'
import { applyPresetMedicalRecord, get, buildClinicalPlanFromRecord } from '../src/services/store'

afterEach(cleanup)

describe('AnatomyVisualizer and System-Wide Synchronization', () => {
  it('synchronizes entire server around kidney stones when preset is applied', () => {
    applyPresetMedicalRecord('preset-kidney-stones')
    const state = get()

    // 1. Profile condition updated
    expect(state.profile.conditions).toContain('Sỏi thận')

    // 2. Kidney organ alert is warning
    expect(state.activeOrganAlerts.kidneys.severity).toBe('warning')
    expect(state.activeOrganAlerts.kidneys.reason).toContain('6.8mm')

    // 3. Other organs are normal (healthy)
    expect(state.activeOrganAlerts.heart.severity).toBe('normal')
    expect(state.activeOrganAlerts.liver.severity).toBe('normal')

    // 4. Longitudinal trend prediction exists
    expect(state.trendPrediction).toBeDefined()
  })

  it('renders ONLY diseased organs (kidneys) by default and shows animated pointer & lab metrics', () => {
    applyPresetMedicalRecord('preset-kidney-stones')
    const { container } = render(<AnatomyVisualizer />)

    // Diseased organ (Kidneys) is shown in multiple prominent locations (HUD, banner, sidebar)
    expect(screen.getAllByText(/Thận & Lọc Máu \(CKD\)/i).length).toBeGreaterThan(0)

    // Other healthy organs are hidden by default in the diseased-only mode
    expect(screen.queryByText(/Hệ Tim Mạch & Đông Máu/i)).toBeNull()
    expect(screen.queryByText(/Gan & Chuyển Hóa/i)).toBeNull()

    // Disease title is displayed
    expect(screen.getByText(/BỆNH LÝ: Sỏi thận/i)).toBeTruthy()

    // Lab metrics are displayed
    expect(screen.getAllByText(/Kích thước sỏi thận/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/6.8 mm/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/Hồng cầu niệu \(RBC\):/i)).toBeTruthy()

    // Animated pointer arrow target is rendered
    expect(screen.getByText(/🎯 VỊ TRÍ: KIDNEYS/i)).toBeTruthy()

    // Toggle button to view all 6 organs works
    const toggleBtn = screen.getByTitle(/Chuyển đổi giữa chế độ chỉ hiển thị cơ quan bị bệnh/i)
    fireEvent.click(toggleBtn)

    // Now all organs should be visible
    expect(screen.getAllByText(/Hệ Tim Mạch & Đông Máu/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Gan & Chuyển Hóa/i).length).toBeGreaterThan(0)
  })

  it('automatically synchronizes AI treatment meal plan with medical record and derives strict CDSS ceilings', () => {
    applyPresetMedicalRecord('preset-kidney-stones')
    const state = get()
    const plan = state.plans[0]

    // 1. Plan is automatically customized to the uploaded record
    expect(plan).toBeDefined()
    expect(plan.name).toContain('Sỏi thận')

    // 2. Ceilings (hard_limits) are derived from the medical condition
    expect(plan.hard_limits).toBeDefined()
    expect(plan.hard_limits?.max_sodium_mg).toBe(1500)
    expect(plan.hard_limits?.min_water_ml).toBe(2500)
    expect(plan.hard_limits?.avoid_oxalate).toBe(true)

    // 3. Clinical meals are tailored for kidney stones (hydrating, low oxalate)
    const allDishes = Object.values(plan.days[0]).flat().map(i => i.foodName).join(' ')
    expect(allDishes).toMatch(/bí đao|bí xanh|yến mạch/i)
  })

  it('generates dynamic pathology-specific plans grounded in loaded clinical documents and medical records', () => {
    const state = get()
    const liverExtraction = {
      id: 'rec-liver-test',
      name: 'Benh-An-Viem-Gan-Man-Va-Nhiem-Mo.pdf',
      date: '2026-11-18',
      type: 'Xét nghiệm men gan & Siêu âm bụng',
      metrics: [
        { name: 'AST (GOT)', value: 92, unit: 'U/L', status: 'high' as const, referenceRange: '< 40', affectedOrgan: 'liver' },
        { name: 'ALT (GPT)', value: 108, unit: 'U/L', status: 'high' as const, referenceRange: '< 40', affectedOrgan: 'liver' }
      ],
      diseases: ['Gan nhiễm mỡ độ 2 & Tăng men gan mạn tính'],
      allergies: [],
      medications: [{ name: 'Hepa-Merz', activeIngredient: 'L-ornithine L-aspartate', dosage: '3g', purpose: 'Hạ amoniac máu' }],
      has_conflict: false,
      organ_mappings: [{ organ_id: 'liver', severity: 'warning' as const, reason: 'Tế bào gan thoái hóa mỡ', nutrient_limits: { avoid_alcohol: true } }],
      raw_summary: 'Gan nhiễm mỡ tăng men gan',
      confirmed: true
    }

    const liverPlan = buildClinicalPlanFromRecord(state.profile, liverExtraction, state.activeOrganAlerts, state.docs, state.rules)

    // 1. Plan name reflects liver disease
    expect(liverPlan.name).toContain('Gan')

    // 2. Evidence basis is retrieved from loaded clinical documents (EASL 2024)
    expect(liverPlan.evidence_basis).toBeDefined()
    expect(liverPlan.evidence_basis!.length).toBeGreaterThan(0)
    expect(liverPlan.evidence_basis![0].guideline_name).toMatch(/Gan|Dược|CDSS/i)

    // 3. Dishes are tailored specifically for liver health (Antioxidants, artichoke, lean fish, zero alcohol)
    const liverDishes = Object.values(liverPlan.days[0]).flat().map((i: any) => i.foodName).join(' ')
    expect(liverDishes).toMatch(/atiso|bông cải xanh|cá quả|gạo lứt/i)
  })
})
