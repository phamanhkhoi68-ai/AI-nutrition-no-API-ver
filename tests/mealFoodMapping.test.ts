import { describe, expect, it } from 'vitest'
import { seed } from '../src/data/seed'
import { buildClinicalPlanFromRecord, reset } from '../src/services/store'
import { calc, hasFoodNameMismatch, validatePlanInvariants } from '../src/utils/nutrition'

describe('meal names and nutrition data', () => {
  it('uses catalog names for every fallback item over one and seven days', () => {
    reset()
    const data = seed()
    for (const count of [1, 7] as const) {
      const plan = buildClinicalPlanFromRecord(data.profile, data.profile.files[0], data.activeOrganAlerts, data.docs, data.rules, count)
      for (const day of plan.days) {
        for (const item of Object.values(day).flat()) {
          const food = data.foods.find(entry => entry.id === item.foodId)
          expect(food).toBeDefined()
          expect(item.foodName).toBe(food?.name)
          expect(hasFoodNameMismatch(item, data.foods)).toBe(false)
          expect(calc([item], data.foods).kcal).toBeCloseTo(food!.kcal * item.grams / 100)
        }
      }
    }
  })

  it('detects a saved apple linked to yogurt and blocks approval validation', () => {
    const data = seed()
    const item = { foodId: 'F013', foodName: 'Táo ta gọt vỏ', grams: 120 }
    expect(hasFoodNameMismatch(item, data.foods)).toBe(true)
    const plan = structuredClone(data.plans[0])
    plan.days[0]['Bữa sáng'][0] = item
    expect(validatePlanInvariants(plan, data.profile, data).some(error => error.includes('không khớp dữ liệu'))).toBe(true)
  })
})
