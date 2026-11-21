import{describe,expect,it}from'vitest'
import{calc,gate}from'../src/utils/nutrition'
import{seed}from'../src/data/seed'
import{logFoodScanToDiary,get}from'../src/services/store'
import{generateMenuPlanAI}from'../src/services/aiService'
import type{FoodScanResult}from'../src/types'

describe('nutrition',()=>{const d=seed()
it('recalculates by grams',()=>{expect(calc([{foodId:'F004',grams:200}],d.foods).protein).toBeCloseTo(62)})
it('allows single supported condition',()=>{expect(gate(d.profile,d)).toEqual([])})
it('blocks unsupported/multiple',()=>{expect(gate({...d.profile,conditions:['Bệnh thận mạn']},d).length).toBeGreaterThan(0);expect(gate({...d.profile,conditions:['Tăng huyết áp','Đái tháo đường type 2']},d).length).toBeGreaterThan(0)})})
import{generate}from'../src/utils/nutrition'
describe('generate',()=>{const d=seed()
it('excludes allergens',()=>{const p={...d.profile,allergies:'cá'};const ids=generate(p,d,1,3,true)[0];const names=Object.values(ids).flat().map(i=>d.foods.find(f=>f.id===i.foodId)!.allergens);expect(names.some(a=>a.includes('cá'))).toBe(false)})
it('applies approved sodium rule',()=>{const p={...d.profile,conditions:['Tăng huyết áp']};Object.values(generate(p,d,1,3,true)[0]).flat().forEach(i=>expect(d.foods.find(f=>f.id===i.foodId)!.sodium).toBeLessThanOrEqual(120))})
it('plans 7 days',()=>{expect(generate(d.profile,d,7,3,false)).toHaveLength(7)})
it('rejects unapproved rule',()=>{const d2=seed();d2.rules.forEach(r=>r.status='Nháp');expect(gate(d2.profile,d2).length).toBeGreaterThan(0)})})

describe('AI Food Lens Scan to Diary Integration', () => {
  it('saves scanned macros and micros EXACTLY as analyzed without multiplier distortion', () => {
    const scanSample: FoodScanResult = {
      dish_name: 'Phở bò tái chín',
      estimated_weight_g: 420,
      scan_type: 'meal',
      ingredients: [
        { name: 'Bánh phở tươi', weight_g: 160 },
        { name: 'Thịt bò phi lê', weight_g: 80 },
        { name: 'Nước dùng gia vị', weight_g: 180 }
      ],
      macros: { kcal: 450, protein: 25.5, carb: 58.0, fat: 13.5 },
      micros: { sodium_mg: 1280, potassium_mg: 340, purine: 'Cao', sugar_g: 3 },
      suitability: 'DANGER',
      suitability_reason: 'Lượng Natri cao 1280mg'
    }

    const testDay = '2026-11-20'
    logFoodScanToDiary(scanSample, 'Bữa trưa', testDay)

    const state = get()
    const dayEntry = state.diary[testDay]
    expect(dayEntry).toBeDefined()
    expect(dayEntry['Bữa trưa']).toBeDefined()

    const savedItem = dayEntry['Bữa trưa'][dayEntry['Bữa trưa'].length - 1]
    expect(savedItem.foodName).toBe('Phở bò tái chín')
    expect(savedItem.grams).toBe(420)

    // Verify nutrient calculation for this item
    const evaluatedNutrients = calc([savedItem], state.foods)
    expect(Math.round(evaluatedNutrients.kcal)).toBe(450)
    expect(Math.round(evaluatedNutrients.protein * 10) / 10).toBe(25.5)
    expect(Math.round(evaluatedNutrients.carb * 10) / 10).toBe(58.0)
    expect(Math.round(evaluatedNutrients.fat * 10) / 10).toBe(13.5)
    expect(Math.round(evaluatedNutrients.sodium)).toBe(1280)
  })

  it('accurately scales nutrients when user edits portion grams', () => {
    const scanSample: FoodScanResult = {
      dish_name: 'Sữa ngũ cốc yến mạch',
      estimated_weight_g: 250,
      ingredients: [
        { name: 'Yến mạch nguyên cám', weight_g: 150 }
      ],
      macros: { kcal: 185, protein: 7.2, carb: 28.5, fat: 4.8 },
      micros: { sodium_mg: 120, potassium_mg: 190, purine: 'Thấp', sugar_g: 6.5 },
      suitability: 'SAFE',
      suitability_reason: 'Natri thấp an toàn'
    }

    const testDay = '2026-11-21'
    logFoodScanToDiary(scanSample, 'Bữa phụ', testDay)

    const state = get()
    const savedItem = state.diary[testDay]['Bữa phụ'][0]

    // Normal portion (250g)
    const normal = calc([savedItem], state.foods)
    expect(Math.round(normal.kcal)).toBe(185)
    expect(Math.round(normal.sodium)).toBe(120)

    // Scaled portion (halved: 125g)
    const halfItem = { ...savedItem, grams: 125 }
    const halved = calc([halfItem], state.foods)
    expect(Math.round(halved.kcal)).toBe(Math.round(185 / 2))
    expect(Math.round(halved.sodium)).toBe(60)
  })

  it('generates exactly 1 day for 1-day mode and 7 days for 7-day mode', async () => {
    const state = get()
    const plan1Day = await generateMenuPlanAI(state.profile, state.foods, state.rules, 1, 3, state.ocrHistory?.[0], state.activeOrganAlerts, state.docs)
    expect(plan1Day.days).toHaveLength(1)

    const plan7Day = await generateMenuPlanAI(state.profile, state.foods, state.rules, 7, 3, state.ocrHistory?.[0], state.activeOrganAlerts, state.docs)
    expect(plan7Day.days).toHaveLength(7)
  })

  it('ensures ZERO duplicate dish names across all 7 days of the AI meal plan', async () => {
    const state = get()
    const plan = await generateMenuPlanAI(state.profile, state.foods, state.rules, 7, 3, state.ocrHistory?.[0], state.activeOrganAlerts, state.docs)
    expect(plan.days).toHaveLength(7)

    const allDishes: string[] = []
    plan.days.forEach(day => {
      Object.values(day).forEach(slotItems => {
        slotItems.forEach(it => {
          if (it.foodName) allDishes.push(it.foodName.trim().toLowerCase())
        })
      })
    })

    const uniqueDishes = new Set(allDishes)
    expect(uniqueDishes.size).toBe(allDishes.length)
  })
})
