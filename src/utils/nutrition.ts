import type { Food, Item, MedicalRecordExtraction, Plan, Profile, Rule, State, Slot } from '../types'

export const SLOTS: Slot[] = ['Bữa sáng', 'Bữa trưa', 'Bữa tối', 'Bữa phụ']
export const zero = { kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0, sodium: 0 }

export function hasFoodNameMismatch(item: Item, foods: Food[]): boolean {
  const food = foods.find(f => f.id === item.foodId)
  return Boolean(food && item.foodName && item.foodName.trim().toLocaleLowerCase('vi') !== food.name.trim().toLocaleLowerCase('vi'))
}

export function localDateIso(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export const calc = (items: Item[], foods: Food[]) =>
  items.reduce((t, i) => {
    const f = foods.find(x => x.id === i.foodId) || i.snapshot
    if (!f) return t
    const k = i.grams / 100
    return {
      kcal: t.kcal + f.kcal * k,
      protein: t.protein + f.protein * k,
      fat: t.fat + f.fat * k,
      carb: t.carb + f.carb * k,
      fiber: t.fiber + f.fiber * k,
      sodium: t.sodium + f.sodium * k
    }
  }, { ...zero })

export const age = (dob: string) => (dob ? Math.floor((Date.now() - new Date(dob).getTime()) / 3.156e10) : 0)
export const tdee = (p: Profile) => Math.round((10 * p.weight + 6.25 * p.height - 5 * age(p.dob) + 5) * p.activity)

export function nutritionProfileIssue(p: Profile): string | undefined {
  const birthDate = new Date(p.dob)
  const validBirthDate = /^\d{4}-\d{2}-\d{2}$/.test(p.dob) &&
    Number.isFinite(birthDate.getTime()) &&
    birthDate.toISOString().slice(0, 10) === p.dob &&
    p.dob <= localDateIso()
  if (!validBirthDate || !Number.isFinite(p.height) || p.height <= 0 ||
    !Number.isFinite(p.weight) || p.weight <= 0) {
    return 'Hồ sơ cần ngày sinh, chiều cao và cân nặng hợp lệ trước khi lập thực đơn.'
  }
  if (!Number.isFinite(p.activity) || p.activity <= 0) {
    return 'Hồ sơ cần mức vận động hợp lệ trước khi lập thực đơn.'
  }
}

export function mealPlanProfileBasis(p: Profile): string {
  return JSON.stringify([
    p.dob, p.height, p.weight, p.activity, p.goal, p.allergies,
    p.conditions, p.medications, p.files.map(file => [file.id, file.date, file.confirmed, file.metrics])
  ])
}

export function isCurrentMealPlan(plan: Plan, p: Profile): boolean {
  if (nutritionProfileIssue(p)) return false
  if (plan.profileBasis !== undefined) return plan.profileBasis === mealPlanProfileBasis(p)
  // Legacy plans created by record import could have used guessed measurements.
  return plan.id === 'plan-cdss-init' || !/^plan-(cdss|ai)-/.test(plan.id)
}

export function approvedNutritionLimits(p: Profile, plans: Plan[]) {
  return plans.find(plan => plan.status === 'EXPERT_APPROVED' && isCurrentMealPlan(plan, p))?.hard_limits
}

export function gate(p: Profile, d: Pick<State, 'conditions' | 'rules'>): string[] {
  const r: string[] = []
  const profileIssue = nutritionProfileIssue(p)
  if (profileIssue) r.push(profileIssue)
  p.conditions.forEach(n => {
    const c = d.conditions.find(x => x.name.toLowerCase() === n.toLowerCase())
    if (!c || c.status !== 'Hỗ trợ') {
      r.push(`Bệnh lý "${n}" chưa được hỗ trợ cá nhân hóa (trạng thái: ${c?.status || 'Chưa cấu hình'}).`)
    } else if (!d.rules.some(x => x.condition.toLowerCase() === n.toLowerCase() && x.status === 'Đã duyệt')) {
      r.push(`"${n}" chưa có quy tắc được chuyên gia duyệt.`)
    }
  })
  if (p.conditions.length > 1) {
    r.push('Nhiều bệnh lý cùng lúc: chưa có quy trình giải quyết xung đột đã duyệt.')
  }
  return r
}

export function summarizeGateIssues(gateIssues: string[]): string {
  const conditionCount = gateIssues.filter(g => /chưa được hỗ trợ|chưa có quy tắc/i.test(g)).length
  const extraCount = gateIssues.length - conditionCount
  if (conditionCount > 0) {
    return `Có ${conditionCount} bệnh lý ngoài phạm vi quy tắc đã duyệt${extraCount > 0 ? ` (+${extraCount} lưu ý)` : ''}.`
  }
  return `Có ${gateIssues.length} lưu ý kiểm soát phạm vi.`
}

export type PortionKind = 'protein' | 'rice' | 'starch' | 'veg' | 'snack' | 'fat' | 'other'

export interface PortionBounds {
  minGrams: number
  maxGrams: number
  kind: PortionKind
}

export function getPortionBounds(food: Pick<Food, 'name' | 'category' | 'protein' | 'kcal'>): PortionBounds {
  const name = (food.name || '').toLowerCase()
  const cat = (food.category || '').toLowerCase()

  if (cat.includes('dầu') || /^dầu\s+/i.test(name)) {
    return { minGrams: 5, maxGrams: 45, kind: 'fat' }
  }

  if (cat === 'đạm') {
    if (/đậu\s*phụ|đậu\s*hũ|trứng/i.test(name)) {
      return { minGrams: 80, maxGrams: 160, kind: 'protein' }
    }
    return { minGrams: 60, maxGrams: 140, kind: 'protein' }
  }

  if (cat === 'tinh bột') {
    const isRice = /(?:cơm|gạo)/i.test(name) && !/cháo|phở|bún|bánh|miến|hủ\s*tiếu|súp|nước/i.test(name)
    if (isRice) {
      const isWhiteRice = /cơm\s*trắng|gạo\s*tẻ|gạo\s*tám|séng\s*cù/i.test(name)
      return { minGrams: 100, maxGrams: isWhiteRice ? 180 : 200, kind: 'rice' }
    }
    if (/cháo|súp/i.test(name)) {
      return { minGrams: 150, maxGrams: 260, kind: 'starch' }
    }
    if (/khoai/i.test(name)) {
      return { minGrams: 100, maxGrams: 240, kind: 'starch' }
    }
    if (/yến\s*mạch|bánh\s*mì/i.test(name)) {
      return { minGrams: 50, maxGrams: 120, kind: 'starch' }
    }
    return { minGrams: 100, maxGrams: 200, kind: 'starch' }
  }

  if (cat === 'rau') {
    return { minGrams: 80, maxGrams: 240, kind: 'veg' }
  }

  if (cat === 'trái cây' || cat === 'sữa') {
    return { minGrams: 100, maxGrams: 240, kind: 'snack' }
  }

  // Fallback inference when category is absent or custom (e.g. food.snapshot)
  const isRiceName = /(?:cơm|gạo)/i.test(name) && !/cháo|phở|bún|bánh|miến|hủ\s*tiếu|súp|nước/i.test(name)
  if (isRiceName) {
    return { minGrams: 100, maxGrams: /cơm\s*trắng|gạo\s*tẻ|gạo\s*tám|séng\s*cù/i.test(name) ? 180 : 200, kind: 'rice' }
  }
  if (/khoai/i.test(name)) {
    return { minGrams: 100, maxGrams: 240, kind: 'starch' }
  }
  if (/đậu\s*phụ|đậu\s*hũ|trứng/i.test(name) && !/cháo|súp|canh/i.test(name)) {
    return { minGrams: 80, maxGrams: 160, kind: 'protein' }
  }
  if (food.protein >= 12 || (/thịt|cá|gà|tôm/i.test(name) && !/canh|cháo|phở|bún|miến|súp|bánh/i.test(name))) {
    return { minGrams: 60, maxGrams: 140, kind: 'protein' }
  }
  if (/canh|rau|bí|su\s*hào|cải|mồng\s*tơi|dưa\s*leo/i.test(name)) {
    return { minGrams: 80, maxGrams: 240, kind: 'veg' }
  }
  return { minGrams: 50, maxGrams: 200, kind: 'other' }
}

const roundGrams5 = (n: number) => Math.max(5, Math.round(n / 5) * 5)

const clampByBounds = (grams: number, bounds: PortionBounds, minOverride?: number) => {
  const lo = minOverride !== undefined ? minOverride : bounds.minGrams
  return roundGrams5(Math.min(bounds.maxGrams, Math.max(lo, grams)))
}

type RebalanceFoodRef = Pick<Food, 'id' | 'name' | 'category' | 'kcal' | 'protein' | 'fat' | 'carb' | 'fiber' | 'sodium'>

export function rebalanceDayPortions(params: {
  day: Record<string, Item[]>
  foods: Food[]
  maxProtein: number
  maxSodium: number
  minSafeKcal: number
  activeSlots: string[]
  isSafeFood?: (f: Food | undefined) => boolean
  usedNamesInPlan?: Set<string>
}): void {
  const { day, foods, maxProtein, maxSodium, minSafeKcal, activeSlots, isSafeFood, usedNamesInPlan } = params
  const byId = (id: string) => foods.find(f => f.id === id)
  const resolveRef = (it: Item): RebalanceFoodRef | undefined => {
    const f = byId(it.foodId)
    if (f) return f
    if (it.snapshot) {
      return {
        id: it.foodId,
        name: it.foodName || '',
        category: '',
        kcal: it.snapshot.kcal,
        protein: it.snapshot.protein,
        fat: it.snapshot.fat,
        carb: it.snapshot.carb,
        fiber: it.snapshot.fiber,
        sodium: it.snapshot.sodium
      }
    }
    return undefined
  }
  const getTotals = () => calc(Object.values(day).flat(), foods)
  const isUnused = (cand: Food) => !usedNamesInPlan || !usedNamesInPlan.has(cand.name.toLowerCase())

  const applySwap = (item: Item, cand: Food, grams: number) => {
    usedNamesInPlan?.add(cand.name.toLowerCase())
    item.foodId = cand.id
    item.foodName = cand.name
    item.grams = grams
    item.snapshot = {
      kcal: cand.kcal,
      protein: cand.protein,
      fat: cand.fat,
      carb: cand.carb,
      fiber: cand.fiber,
      sodium: cand.sodium,
      potassium: cand.potassium,
      gi: cand.gi,
      purine: cand.purine,
      allergens: cand.allergens
    }
  }

  // Pass 0: Normalize initial portions within category realistic bounds
  for (const slotItems of Object.values(day)) {
    for (const it of slotItems || []) {
      const ref = resolveRef(it)
      if (!ref) continue
      const bounds = getPortionBounds(ref)
      if (bounds.kind === 'fat') {
        it.grams = Math.min(bounds.maxGrams, Math.max(bounds.minGrams, roundGrams5(it.grams)))
      } else {
        it.grams = clampByBounds(it.grams, bounds)
      }
    }
  }

  // Pass 1: Hard Protein & Sodium Resolution FIRST (up to 16 iterations)
  for (let pass = 0; pass < 16; pass++) {
    const totals = getTotals()
    if (totals.protein <= maxProtein && totals.sodium <= maxSodium) break
    let changed = false

    if (totals.protein > maxProtein) {
      // Step 1a: Trim protein dishes down to their realistic floor (60g meat/fish, 80g tofu/egg)
      for (const slotItems of Object.values(day)) {
        for (const it of slotItems || []) {
          const ref = resolveRef(it)
          if (!ref) continue
          const bounds = getPortionBounds(ref)
          if (bounds.kind === 'protein' && it.grams > bounds.minGrams) {
            const curPro = getTotals().protein
            if (curPro <= maxProtein) break
            const desired = Math.floor((it.grams * (maxProtein * 0.94)) / curPro)
            const nextG = clampByBounds(desired, bounds)
            if (nextG < it.grams) {
              it.grams = nextG
              changed = true
            }
          }
        }
        if (getTotals().protein <= maxProtein) break
      }

      // Step 1b: Swap heavy protein or high-protein starch sources when protein remains over ceiling
      if (getTotals().protein > maxProtein && isSafeFood) {
        let swapped = false

        const proteinEntries: { item: Item; ref: RebalanceFoodRef }[] = []
        const starchEntries: { item: Item; ref: RebalanceFoodRef }[] = []
        for (const slotItems of Object.values(day)) {
          for (const it of slotItems || []) {
            const ref = resolveRef(it)
            if (!ref) continue
            const bounds = getPortionBounds(ref)
            if (bounds.kind === 'protein') proteinEntries.push({ item: it, ref })
            else if (bounds.kind === 'starch') starchEntries.push({ item: it, ref })
          }
        }
        proteinEntries.sort((a, b) => (b.ref.protein * b.item.grams) - (a.ref.protein * a.item.grams))
        starchEntries.sort((a, b) => (b.ref.protein * b.item.grams) - (a.ref.protein * a.item.grams))

        // 1b-i: Swap highest-protein Đạm (>= 16g/100g) for unused Đạm <= 12g/100g at >= 80g
        const heavyMeat = proteinEntries.find(e => e.ref.protein >= 16)
        if (heavyMeat) {
          const swapCand = foods
            .filter(cand => cand.category === 'Đạm' && cand.protein <= 12 && isSafeFood(cand) && isUnused(cand))
            .sort((a, b) => a.protein - b.protein)[0]
          if (swapCand) {
            const candBounds = getPortionBounds(swapCand)
            applySwap(heavyMeat.item, swapCand, clampByBounds(Math.max(80, candBounds.minGrams), candBounds))
            changed = true
            swapped = true
          }
        }

        // 1b-ii: Swap highest-protein starch (>= 5.5g/100g) for unused low-protein Tinh bột (<= 3.5g/100g, non-rice preferred)
        if (!swapped && getTotals().protein > maxProtein) {
          const heavyStarch = starchEntries.find(e => e.ref.protein >= 5.5)
          if (heavyStarch) {
            const swapStarch = foods
              .filter(cand => cand.category === 'Tinh bột' && cand.protein <= 3.5 && isSafeFood(cand) && isUnused(cand))
              .sort((a, b) => {
                const aRice = getPortionBounds(a).kind === 'rice' ? 1 : 0
                const bRice = getPortionBounds(b).kind === 'rice' ? 1 : 0
                if (aRice !== bRice) return aRice - bRice
                if (a.protein !== b.protein) return a.protein - b.protein
                return b.kcal - a.kcal
              })[0]
            if (swapStarch) {
              const candBounds = getPortionBounds(swapStarch)
              applySwap(heavyStarch.item, swapStarch, clampByBounds(Math.min(candBounds.maxGrams, 160), candBounds))
              changed = true
              swapped = true
            }
          }
        }

        // 1b-iii: If highest-protein Đạm has >= 22g/100g, swap for unused lighter Đạm (<= 18.5g/100g) at >= 60g
        if (!swapped && getTotals().protein > maxProtein) {
          const ultraHeavy = proteinEntries.find(e => e.ref.protein >= 22)
          if (ultraHeavy) {
            const lightCand = foods
              .filter(cand => cand.category === 'Đạm' && cand.protein <= 18.5 && isSafeFood(cand) && isUnused(cand))
              .sort((a, b) => a.protein - b.protein)[0]
            if (lightCand) {
              const candBounds = getPortionBounds(lightCand)
              applySwap(ultraHeavy.item, lightCand, clampByBounds(Math.max(60, candBounds.minGrams), candBounds))
              changed = true
              swapped = true
            }
          }
        }

        // 1b-iv: If >= 2 Đạm items exist today, replace the highest-protein Đạm item with a low-protein Tinh bột/Trái cây/Rau
        if (!swapped && getTotals().protein > maxProtein && proteinEntries.length >= 2) {
          const redundant = proteinEntries[0]
          const lowProCand = foods
            .filter(cand =>
              isSafeFood(cand) &&
              isUnused(cand) &&
              ((cand.category === 'Tinh bột' && cand.protein <= 3.5) ||
                ((cand.category === 'Trái cây' || cand.category === 'Rau') && cand.protein <= 2.5))
            )
            .sort((a, b) => {
              const rank = (c: Food) => {
                if (c.category === 'Tinh bột') return getPortionBounds(c).kind === 'rice' ? 1 : 0
                if (c.category === 'Trái cây') return 2
                return 3
              }
              const rDiff = rank(a) - rank(b)
              if (rDiff !== 0) return rDiff
              return a.protein - b.protein
            })[0]
          if (lowProCand) {
            const candBounds = getPortionBounds(lowProCand)
            applySwap(redundant.item, lowProCand, clampByBounds(Math.min(candBounds.maxGrams, 160), candBounds))
            changed = true
          }
        }
      }

      // Step 1c: If still over protein ceiling, trim non-protein/non-fat items down toward minGrams
      if (getTotals().protein > maxProtein) {
        for (const slotItems of Object.values(day)) {
          for (const it of slotItems || []) {
            const ref = resolveRef(it)
            if (!ref || ref.protein < 2) continue
            const bounds = getPortionBounds(ref)
            if (bounds.kind !== 'protein' && bounds.kind !== 'fat' && it.grams > bounds.minGrams) {
              if (getTotals().protein <= maxProtein) break
              const nextG = Math.max(bounds.minGrams, roundGrams5(it.grams - 25))
              if (nextG < it.grams) {
                it.grams = nextG
                changed = true
              }
            }
          }
          if (getTotals().protein <= maxProtein) break
        }
      }
    }

    // Step 1d: Enforce sodium ceiling
    if (getTotals().sodium > maxSodium) {
      for (const slotItems of Object.values(day)) {
        for (const it of slotItems || []) {
          const ref = resolveRef(it)
          if (!ref || ref.sodium < 35) continue
          const bounds = getPortionBounds(ref)
          const floor = bounds.kind === 'veg' ? 60 : bounds.minGrams
          if (it.grams > floor) {
            const cur = getTotals()
            const nextG = Math.max(floor, roundGrams5(it.grams * ((maxSodium * 0.92) / cur.sodium)))
            if (nextG < it.grams) {
              it.grams = nextG
              changed = true
            }
          }
        }
      }
    }

    // Step 1e: Last-resort hard-ceiling fallback ONLY if nothing above changed and STILL over protein/sodium
    if (!changed) {
      if (getTotals().protein > maxProtein) {
        for (const slotItems of Object.values(day)) {
          for (const it of slotItems || []) {
            const ref = resolveRef(it)
            if (!ref || ref.protein < 1.5) continue
            const bounds = getPortionBounds(ref)
            if (bounds.kind !== 'protein' && bounds.kind !== 'fat' && it.grams > 60) {
              it.grams = Math.max(60, roundGrams5(it.grams - 25))
              changed = true
              if (getTotals().protein <= maxProtein) break
            }
          }
          if (getTotals().protein <= maxProtein) break
        }
      }

      if (getTotals().protein > maxProtein) {
        const fallbackProteins: { item: Item; ref: RebalanceFoodRef }[] = []
        for (const slotItems of Object.values(day)) {
          for (const it of slotItems || []) {
            const ref = resolveRef(it)
            if (!ref) continue
            const bounds = getPortionBounds(ref)
            if (bounds.kind === 'protein' || ref.protein >= 6) fallbackProteins.push({ item: it, ref })
          }
        }
        fallbackProteins.sort((a, b) => (b.ref.protein * b.item.grams) - (a.ref.protein * a.item.grams))
        for (const entry of fallbackProteins) {
          if (getTotals().protein <= maxProtein) break
          const hardMin = entry.item.grams > 45 ? 45 : 25
          if (entry.item.grams > hardMin) {
            entry.item.grams = Math.max(hardMin, entry.item.grams - 15)
            changed = true
          }
        }
      }

      if (getTotals().sodium > maxSodium) {
        for (const slotItems of Object.values(day)) {
          for (const it of slotItems || []) {
            const ref = resolveRef(it)
            if (!ref || ref.sodium < 35) continue
            if (it.grams > 45) {
              it.grams = Math.max(45, roundGrams5(it.grams * ((maxSodium * 0.94) / getTotals().sodium)))
              changed = true
            }
          }
        }
      }
    }

    if (!changed) break
  }

  // Pass 2: Clean Energy Boost >= minSafeKcal AFTER Pass 1 guarantees protein/sodium ceilings
  let oilAddedToday = Object.values(day)
    .flat()
    .some(it => {
      const ref = resolveRef(it)
      return ref ? getPortionBounds(ref).kind === 'fat' : false
    })

  const PRO_CEIL = maxProtein - 0.05
  const NA_CEIL = maxSodium - 1

  for (let pass = 0; pass < 24; pass++) {
    const curTotals = getTotals()
    if (curTotals.kcal >= minSafeKcal) break
    let adjusted = false

    // Step 2a: Top up adjustable items sorted by kcal per gram of protein (descending)
    const adjustable: { it: Item; ref: RebalanceFoodRef; bounds: PortionBounds }[] = []
    for (const slotItems of Object.values(day)) {
      for (const it of slotItems || []) {
        const ref = resolveRef(it)
        if (!ref) continue
        const bounds = getPortionBounds(ref)
        if (bounds.kind === 'protein' && ref.protein >= 12) continue
        if (ref.sodium >= 120 || it.grams >= bounds.maxGrams || ref.kcal <= 0) continue
        adjustable.push({ it, ref, bounds })
      }
    }
    adjustable.sort((a, b) => (b.ref.kcal / Math.max(0.1, b.ref.protein)) - (a.ref.kcal / Math.max(0.1, a.ref.protein)))

    for (const { it, ref, bounds } of adjustable) {
      if (getTotals().kcal >= minSafeKcal) break
      const stepsToTry = bounds.kind === 'fat' ? [5] : [20, 10, 5]
      for (const tryStep of stepsToTry) {
        const nextGrams = Math.min(bounds.maxGrams, it.grams + tryStep)
        const deltaG = nextGrams - it.grams
        if (deltaG <= 0) continue
        const cur = getTotals()
        const deltaPro = ref.protein * (deltaG / 100)
        const deltaNa = ref.sodium * (deltaG / 100)
        if ((deltaPro === 0 || cur.protein + deltaPro <= PRO_CEIL) && (deltaNa === 0 || cur.sodium + deltaNa <= NA_CEIL)) {
          it.grams = nextGrams
          adjusted = true
          break
        }
      }
    }

    // Step 2b: Add clean oil (0g pro) first, then unused non-rice non-Đạm energy food
    if (getTotals().kcal < minSafeKcal && isSafeFood) {
      const cur = getTotals()
      const remPro = Math.max(0, PRO_CEIL - cur.protein)
      const remNa = Math.max(0, NA_CEIL - cur.sodium)
      const neededKcal = Math.max(0, minSafeKcal - cur.kcal)

      const candidates = foods
        .filter(cand => isSafeFood(cand) && isUnused(cand))
        .filter(cand => {
          const bounds = getPortionBounds(cand)
          if (bounds.kind === 'rice' || cand.category === 'Đạm') return false
          if (oilAddedToday && cand.category === 'Dầu mỡ') return false
          return true
        })
        .sort((a, b) => {
          if (!oilAddedToday) {
            if (a.category === 'Dầu mỡ' && b.category !== 'Dầu mỡ') return -1
            if (b.category === 'Dầu mỡ' && a.category !== 'Dầu mỡ') return 1
          }
          return (b.kcal / Math.max(0.1, b.protein)) - (a.kcal / Math.max(0.1, a.protein))
        })

      for (const cand of candidates) {
        const bounds = getPortionBounds(cand)
        const targetSlotName =
          cand.category === 'Trái cây' || cand.category === 'Sữa'
            ? (activeSlots.includes('Bữa phụ') ? 'Bữa phụ' : activeSlots[activeSlots.length - 1])
            : (activeSlots.includes('Bữa tối') ? 'Bữa tối' : activeSlots[activeSlots.length - 1])
        const targetSlot = day[targetSlotName] || day[activeSlots[0]]
        if (!targetSlot) continue

        const maxByPro = cand.protein > 0 ? Math.floor(((remPro / cand.protein) * 100) / 5) * 5 : bounds.maxGrams
        const maxByNa = cand.sodium > 0 ? Math.floor(((remNa / cand.sodium) * 100) / 5) * 5 : bounds.maxGrams
        let testGrams = Math.min(bounds.maxGrams, maxByPro, maxByNa)
        if (cand.category === 'Dầu mỡ') {
          const desired = Math.max(15, Math.ceil(((neededKcal / Math.max(1, cand.kcal)) * 100) / 5) * 5)
          testGrams = Math.min(bounds.maxGrams, maxByPro, maxByNa, desired)
        }

        if (
          testGrams >= bounds.minGrams &&
          cand.kcal * (testGrams / 100) >= 45 &&
          (cand.protein === 0 || cur.protein + cand.protein * (testGrams / 100) <= PRO_CEIL) &&
          (cand.sodium === 0 || cur.sodium + cand.sodium * (testGrams / 100) <= NA_CEIL)
        ) {
          if (cand.category === 'Dầu mỡ') oilAddedToday = true
          usedNamesInPlan?.add(cand.name.toLowerCase())
          targetSlot.push({
            foodId: cand.id,
            foodName: cand.name,
            grams: testGrams,
            note: 'Bổ sung năng lượng sạch cân đối khẩu phần',
            snapshot: {
              kcal: cand.kcal, protein: cand.protein, fat: cand.fat, carb: cand.carb,
              fiber: cand.fiber, sodium: cand.sodium, potassium: cand.potassium,
              gi: cand.gi, purine: cand.purine, allergens: cand.allergens
            }
          })
          adjusted = true
          break
        }
      }
    }

    // Step 2c: If stalled below minSafeKcal due to tight protein headroom, trade grams from lowest kcal/protein item toward higher kcal/protein item
    if (!adjusted && getTotals().kcal < minSafeKcal) {
      const allEntries: { it: Item; ref: RebalanceFoodRef; bounds: PortionBounds }[] = []
      for (const slotItems of Object.values(day)) {
        for (const it of slotItems || []) {
          const ref = resolveRef(it)
          if (!ref) continue
          allEntries.push({ it, ref, bounds: getPortionBounds(ref) })
        }
      }
      const trimCands = allEntries
        .filter(e =>
          e.bounds.kind !== 'protein' &&
          e.bounds.kind !== 'fat' &&
          e.ref.protein >= 1.5 &&
          e.it.grams > e.bounds.minGrams
        )
        .sort((a, b) => (a.ref.kcal / a.ref.protein) - (b.ref.kcal / b.ref.protein))

      const boostCands = allEntries
        .filter(e =>
          !(e.bounds.kind === 'protein' && e.ref.protein >= 12) &&
          e.ref.sodium < 120 &&
          e.it.grams < e.bounds.maxGrams &&
          e.ref.kcal > 0
        )
        .sort((a, b) => (b.ref.kcal / Math.max(0.1, b.ref.protein)) - (a.ref.kcal / Math.max(0.1, a.ref.protein)))

      for (const low of trimCands) {
        const trimG = Math.min(25, Math.floor((low.it.grams - low.bounds.minGrams) / 5) * 5)
        if (trimG < 5) continue
        const lowDensity = low.ref.kcal / low.ref.protein
        const high = boostCands.find(h => h.it !== low.it && (h.ref.kcal / Math.max(0.1, h.ref.protein)) > lowDensity * 1.25)
        if (!high) continue

        const cur = getTotals()
        const proAfterTrim = cur.protein - low.ref.protein * (trimG / 100)
        const naAfterTrim = cur.sodium - low.ref.sodium * (trimG / 100)
        const remPro = Math.max(0, PRO_CEIL - proAfterTrim)
        const remNa = Math.max(0, NA_CEIL - naAfterTrim)
        const maxBoostByBound = Math.floor((high.bounds.maxGrams - high.it.grams) / 5) * 5
        const maxBoostByPro = high.ref.protein > 0 ? Math.floor(((remPro / high.ref.protein) * 100) / 5) * 5 : maxBoostByBound
        const maxBoostByNa = high.ref.sodium > 0 ? Math.floor(((remNa / high.ref.sodium) * 100) / 5) * 5 : maxBoostByBound
        const boostG = Math.min(maxBoostByBound, maxBoostByPro, maxBoostByNa)
        if (boostG >= 5 && (high.ref.kcal * (boostG / 100)) > (low.ref.kcal * (trimG / 100))) {
          low.it.grams -= trimG
          high.it.grams += boostG
          adjusted = true
          break
        }
      }
    }

    if (!adjusted) break
  }

  // Pass 3: Floating-point micro-guard to ensure strict <= maxProtein and <= maxSodium
  for (let guard = 0; guard < 12; guard++) {
    const totals = getTotals()
    if (totals.protein <= maxProtein && totals.sodium <= maxSodium) break
    let trimmed = false

    const entries: { it: Item; ref: RebalanceFoodRef; isProtein: boolean }[] = []
    for (const slotItems of Object.values(day)) {
      for (const it of slotItems || []) {
        const ref = resolveRef(it)
        if (!ref) continue
        entries.push({ it, ref, isProtein: getPortionBounds(ref).kind === 'protein' })
      }
    }

    if (totals.protein > maxProtein) {
      const nonPro = entries
        .filter(e => !e.isProtein && e.ref.protein > 0 && e.it.grams > 50)
        .sort((a, b) => (b.ref.protein * b.it.grams) - (a.ref.protein * a.it.grams))
      const target = nonPro[0] || entries.filter(e => e.ref.protein > 0 && e.it.grams > 25).sort((a, b) => (b.ref.protein * b.it.grams) - (a.ref.protein * a.it.grams))[0]
      if (target) {
        target.it.grams = Math.max(25, target.it.grams - 5)
        trimmed = true
      }
    }

    if (getTotals().sodium > maxSodium) {
      const naTarget = entries
        .filter(e => e.ref.sodium > 0 && e.it.grams > 45)
        .sort((a, b) => (b.ref.sodium * b.it.grams) - (a.ref.sodium * a.it.grams))[0]
      if (naTarget) {
        naTarget.it.grams = Math.max(45, naTarget.it.grams - 5)
        trimmed = true
      }
    }

    if (!trimmed) break
  }
}

const pick = (foods: Food[], cat: string, i: number) => {
  const l = foods.filter(f => f.category === cat)
  return l[i % Math.max(l.length, 1)]
}

export function generate(p: Profile, d: State, days: 1 | 7, meals: number, personalized: boolean): Plan['days'] {
  const rules = personalized ? d.rules.filter(x => x.status === 'Đã duyệt' && p.conditions.includes(x.condition)) : []
  const al = p.allergies.toLowerCase().split(',').map(x => x.trim()).filter(Boolean)
  const ok = d.foods.filter(
    f =>
      !al.some(a => f.allergens.toLowerCase().includes(a)) &&
      rules.every(r => {
        const per100gSodiumLimit = r.maxSodium >= 400 ? Math.round(r.maxSodium * 0.08) : r.maxSodium
        return (
          f.sodium <= per100gSodiumLimit &&
          ((f.category !== 'Tinh bột' && f.category !== 'Trái cây') || f.gi <= r.maxGI) &&
          !r.avoidCategories.split(',').map(x => x.trim()).includes(f.category)
        )
      })
  )
  const per = tdee(p) / meals
  return Array.from({ length: days }, (_, di) => {
    const o: Record<string, Item[]> = {}
    SLOTS.slice(0, Math.min(meals, 4)).forEach((s, si) => {
      const base =
        s === 'Bữa phụ'
          ? [pick(ok, 'Trái cây', di), pick(ok, 'Sữa', di)]
          : [pick(ok, 'Tinh bột', di + si), pick(ok, 'Đạm', di * 2 + si), pick(ok, 'Rau', di + si)]
      const fs = base.filter(Boolean)
      const raw = calc(fs.map(f => ({ foodId: f.id, grams: 100 })), ok).kcal || 1
      const m = Math.min(2.2, Math.max(0.6, per / raw))
      o[s] = fs.map(f => {
        const bounds = getPortionBounds(f)
        return { foodId: f.id, grams: clampByBounds(100 * m, bounds) }
      })
    })
    return o
  })
}

export interface ClinicalCeilings {
  max_sodium_mg: number
  max_protein_g: number
  max_gi: number
  min_water_ml: number
  max_potassium_mg?: number
  avoid_oxalate?: boolean
  purine_level?: string
  matched_pathologies: string[]
}

/**
 * Multi-disease clinical ceiling intersection (never drops comorbidities via if/else-if).
 */
export function deriveClinicalCeilings(
  profile: Profile,
  latestRecord?: MedicalRecordExtraction | null,
  rules: Rule[] = []
): ClinicalCeilings {
  const allDiseases = Array.from(
    new Set([...(profile.conditions || []), ...(latestRecord?.diseases || [])])
  ).filter(Boolean)
  const condStr = allDiseases.join(' ').toLowerCase()
  const weight = profile.weight

  let maxSodium = 1500
  let maxProtein = Math.round(weight * 0.8)
  let maxGi = 55
  let minWater = 2000
  let maxPotassium: number | undefined
  let avoidOxalate: boolean | undefined
  let purineLevel: string | undefined
  const matched: string[] = []

  if (condStr.includes('sỏi') || condStr.includes('stone') || condStr.includes('oxalate')) {
    minWater = Math.max(minWater, 2500)
    avoidOxalate = true
    maxSodium = Math.min(maxSodium, 1500)
    matched.push('Sỏi thận (EAU/AUA)')
  }
  if (condStr.includes('ckd') || condStr.includes('suy thận') || condStr.includes('thận mạn')) {
    maxProtein = Math.min(maxProtein, Math.round(weight * 0.6))
    maxSodium = Math.min(maxSodium, 1400)
    maxPotassium = maxPotassium ? Math.min(maxPotassium, 1800) : 1800
    matched.push('Suy thận mạn CKD (KDIGO 2024)')
  }
  if (condStr.includes('gout') || condStr.includes('gút') || condStr.includes('uric')) {
    purineLevel = 'Thấp (Kiêng nội tạng, hải sản, thịt đỏ)'
    minWater = Math.max(minWater, 2500)
    maxProtein = Math.min(maxProtein, Math.round(weight * 0.8))
    matched.push('Gout & Tăng Acid Uric (ACR)')
  }
  if (condStr.includes('dạ dày') || condStr.includes('gerd') || condStr.includes('hang vị') || condStr.includes('loét')) {
    maxGi = Math.min(maxGi, 55)
    maxSodium = Math.min(maxSodium, 1500)
    matched.push('Viêm dạ dày / GERD (ACG)')
  }
  if (condStr.includes('đái tháo đường') || condStr.includes('tiểu đường') || condStr.includes('hba1c')) {
    maxGi = Math.min(maxGi, 50)
    maxSodium = Math.min(maxSodium, 1500)
    matched.push('Đái tháo đường (ADA 2024)')
  }
  if (condStr.includes('gan') || condStr.includes('men gan') || condStr.includes('liver') || condStr.includes('nhiễm mỡ') || condStr.includes('xơ gan')) {
    maxSodium = Math.min(maxSodium, 1400)
    maxProtein = Math.min(maxProtein, Math.round(weight * 0.85))
    matched.push('Bệnh lý Gan (EASL)')
  }
  if (condStr.includes('huyết áp') || condStr.includes('tim')) {
    maxSodium = Math.min(maxSodium, 1400)
    matched.push('Tim mạch / Tăng huyết áp (AHA/ESC)')
  }

  // Apply approved clinical rules as hard upper bounds when applicable
  const approvedRules = rules.filter(
    r =>
      r.status === 'Đã duyệt' &&
      allDiseases.some(d => d.toLowerCase().includes(r.condition.toLowerCase()) || r.condition.toLowerCase().includes(d.toLowerCase()))
  )
  for (const r of approvedRules) {
    if (Number.isFinite(r.maxSodium) && r.maxSodium >= 200 && r.maxSodium <= 3000) {
      maxSodium = Math.min(maxSodium, r.maxSodium)
    }
    if (Number.isFinite(r.maxGI) && r.maxGI >= 20 && r.maxGI <= 100) {
      maxGi = Math.min(maxGi, r.maxGI)
    }
  }

  const out: ClinicalCeilings = {
    max_sodium_mg: maxSodium,
    max_protein_g: maxProtein,
    max_gi: maxGi,
    min_water_ml: minWater,
    matched_pathologies: matched
  }
  if (maxPotassium !== undefined) out.max_potassium_mg = maxPotassium
  if (avoidOxalate) out.avoid_oxalate = true
  if (purineLevel) out.purine_level = purineLevel
  return out
}

export function evaluateDrugDietInteractions(p: Profile, items: Item[], foods: Food[]): string[] {
  const warnings: string[] = []
  const medsStr = (p.medications || []).join(' ').toLowerCase()
  const condStr = (p.conditions || []).join(' ').toLowerCase()

  const hasWarfarin = /warfarin|coumadin/.test(medsStr)
  const hasAceArb = /lisinopril|losartan|enalapril|zestril|cozaar/.test(medsStr)
  const hasStatinOrCcb = /atorvastatin|lipitor|amlodipine|norvasc|statin/.test(medsStr)
  const hasCkd = /thận|ckd/.test(condStr)
  const hasGout = /gout|gút|uric/.test(condStr)

  items.forEach(it => {
    const f = foods.find(x => x.id === it.foodId)
    const name = (it.foodName || f?.name || '').toLowerCase()
    const pot = f?.potassium ?? it.snapshot?.potassium ?? 0
    const purine = f?.purine ?? it.snapshot?.purine

    if (hasWarfarin && /chân vịt|spinach|cải xoăn|kale|rau bina/.test(name)) {
      warnings.push(`Warfarin + ${it.foodName || f?.name}: giàu Vitamin K gây biến thiên chỉ số đông máu INR`)
    }
    if ((hasAceArb || hasCkd) && (pot >= 300 || /chuối|nước dừa|chân vịt|spinach/.test(name))) {
      warnings.push(`${hasAceArb ? 'ACEi/ARB' : 'CKD'} + ${it.foodName || f?.name}: hàm lượng Kali cao (${pot}mg/100g) nguy cơ tăng Kali máu`)
    }
    if (hasStatinOrCcb && /(?:bưởi|grapefruit)/i.test(name)) {
      warnings.push(`Statin/CCB + ${it.foodName || f?.name}: ức chế CYP3A4 tăng độc tính thuốc`)
    }
    if (hasGout && purine === 'Cao') {
      warnings.push(`Gout + ${it.foodName || f?.name}: hàm lượng Purine cao dễ khởi phát cơn Gout cấp`)
    }
  })

  return Array.from(new Set(warnings))
}

export type Level = 'ok' | 'warn' | 'out'

export function safety(p: Profile, items: Item[], d: State): { label: string; level: Level; note: string }[] {
  const foods = items.map(i => d.foods.find(f => f.id === i.foodId)).filter(Boolean) as Food[]
  const al = p.allergies.toLowerCase().split(',').map(x => x.trim()).filter(Boolean)
  const hit = foods.filter(f => al.some(a => f.allergens.toLowerCase().includes(a) || f.name.toLowerCase().includes(a)))
  const issues = gate(p, d)
  const ddiWarnings = evaluateDrugDietInteractions(p, items, d.foods)
  const rules = d.rules.filter(r => r.status === 'Đã duyệt' && p.conditions.includes(r.condition))
  const over = foods.filter(f =>
    rules.some(r => {
      const per100gSodiumLimit = r.maxSodium >= 400 ? Math.round(r.maxSodium * 0.08) : r.maxSodium
      return f.sodium > per100gSodiumLimit || ((f.category === 'Tinh bột' || f.category === 'Trái cây') && f.gi > r.maxGI)
    })
  )

  return [
    {
      label: 'Dị ứng',
      level: hit.length ? 'warn' : 'ok',
      note: hit.length ? 'Trùng dị ứng đã khai báo: ' + hit.map(f => f.name).join(', ') : 'Không trùng dị ứng đã khai báo'
    },
    {
      label: 'Bệnh lý',
      level: issues.length ? 'out' : 'ok',
      note: issues[0] || 'Bệnh lý nằm trong phạm vi đã được duyệt'
    },
    {
      label: 'Tương tác thuốc – thực phẩm',
      level: ddiWarnings.length ? 'warn' : p.medications.length ? 'ok' : 'out',
      note: ddiWarnings.length
        ? ddiWarnings.join(' · ')
        : p.medications.length
          ? 'Không phát hiện món xung đột trực tiếp với đơn thuốc hiện tại (vẫn cần theo dõi theo chỉ dẫn bác sĩ).'
          : 'Chưa có dữ liệu được duyệt. Hãy hỏi bác sĩ hoặc dược sĩ.'
    },
    {
      label: 'Giới hạn dinh dưỡng',
      level: !rules.length ? 'out' : over.length ? 'warn' : 'ok',
      note: !rules.length
        ? 'Chưa có quy tắc đã duyệt để đối chiếu'
        : over.length
          ? 'Vượt giới hạn: ' + over.map(f => f.name).join(', ')
          : 'Trong giới hạn của quy tắc đã duyệt'
    }
  ]
}

export function validatePlanInvariants(
  plan: Plan,
  profile: Profile,
  state: Pick<State, 'foods'>,
  requiredMeals: number = 3
): string[] {
  const errs: string[] = []
  if (!plan.days || plan.days.length === 0) {
    errs.push('Thực đơn chưa có ngày nào.')
    return errs
  }
  const requiredSlots = SLOTS.slice(0, Math.min(Math.max(requiredMeals, 3), 4))
  const al = profile.allergies.toLowerCase().split(',').map(x => x.trim()).filter(Boolean)
  const hasMeasurements = !nutritionProfileIssue(profile)
  const minDailyKcal = hasMeasurements ? Math.max(1000, Math.round(tdee(profile) * 0.55)) : 1000

  plan.days.forEach((day, idx) => {
    requiredSlots.forEach(slot => {
      const slotItems = day[slot] || []
      if (slotItems.length === 0) {
        errs.push(`Ngày ${idx + 1} thiếu món ở ${slot}.`)
      }
    })

    for (const [slot, slotItems] of Object.entries(day || {})) {
      ;(slotItems || []).forEach(it => {
        if (!Number.isFinite(it.grams) || it.grams <= 0 || it.grams > 1500) {
          errs.push(`Ngày ${idx + 1} (${slot}) có khẩu phần không hợp lệ (${it.grams}g) cho món ${it.foodName || it.foodId}.`)
        }
        const f = state.foods.find(x => x.id === it.foodId)
        if (!it.foodId || !(f || it.snapshot)) {
          errs.push(`Ngày ${idx + 1} (${slot}) có món thiếu mã thực phẩm hợp lệ (${it.foodName || 'không tên'}).`)
        }
        if (hasFoodNameMismatch(it, state.foods)) {
          errs.push(`Ngày ${idx + 1} (${slot}) có tên món không khớp dữ liệu dinh dưỡng: ${it.foodName}.`)
        }
        if (f && it.snapshot && (
          Math.abs(f.kcal - it.snapshot.kcal) > 2 ||
          Math.abs(f.protein - it.snapshot.protein) > 1 ||
          Math.abs(f.sodium - it.snapshot.sodium) > 5
        )) {
          errs.push(`Ngày ${idx + 1} (${slot}) có snapshot dinh dưỡng sai lệch với danh mục gốc (${it.foodName || f.name}).`)
        }
        const allergenPool = `${f?.allergens || ''} ${f?.name || ''} ${it.foodName || ''} ${it.snapshot?.allergens || ''}`.toLowerCase()
        if (al.some(a => allergenPool.includes(a))) {
          errs.push(`Ngày ${idx + 1} (${slot}) chứa món gây dị ứng: ${f?.name || it.foodName}.`)
        }
      })
    }

    const allDayItems = Object.values(day || {}).flat()
    const ddiWarnings = evaluateDrugDietInteractions(profile, allDayItems, state.foods)
      .filter(w => /Warfarin|Statin|Gout|chuối|nước dừa|chân vịt|spinach/i.test(w))
    ddiWarnings.forEach(w => errs.push(`Ngày ${idx + 1}: ${w}`))

    const dayCalc = calc(allDayItems, state.foods)
    if (allDayItems.length > 0 && dayCalc.kcal < minDailyKcal) {
      errs.push(`Ngày ${idx + 1} thiếu năng lượng tối thiểu an toàn (${Math.round(dayCalc.kcal)} kcal < ${minDailyKcal} kcal).`)
    }
    const maxNa = typeof plan.hard_limits?.max_sodium_mg === 'number' ? plan.hard_limits.max_sodium_mg : 2000
    const maxPro = typeof plan.hard_limits?.max_protein_g === 'number' ? plan.hard_limits.max_protein_g : 120
    if (dayCalc.sodium > maxNa) {
      errs.push(`Ngày ${idx + 1} vượt trần Natri (${Math.round(dayCalc.sodium)}mg > ${maxNa}mg).`)
    }
    if (dayCalc.protein > maxPro) {
      errs.push(`Ngày ${idx + 1} vượt trần Đạm (${dayCalc.protein.toFixed(1)}g > ${maxPro}g).`)
    }
  })

  return errs
}
