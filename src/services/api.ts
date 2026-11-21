import type {
  Doc,
  Food,
  Item,
  MedicalRecordExtraction,
  Plan,
  Profile,
  Rule,
  WorkflowRun
} from '../types'
import type { SafetyLedgerItem } from '../ui/SafetyLedger'
import {
  confirmMedicalRecord,
  get,
  setPendingRecordDraft
} from './store'
import {
  calc,
  deriveClinicalCeilings,
  evaluateDrugDietInteractions,
  mealPlanProfileBasis,
  safety,
  validatePlanInvariants
} from '../utils/nutrition'
import { runClinicalPlanWorkflow } from './workflowAgent'
import { computeRecordDiff, type RecordDiffSummary } from '../ui/RecordDiff'

export interface ProfileContextOut {
  patientId?: string
  profileVersion: number
  contextHash: string
  profile: Profile
  hardLimits: ReturnType<typeof deriveClinicalCeilings>
  approvedRulesCount: number
}

export interface SwapSuggestion {
  food: Food
  suggestedGrams: number
  deltaKcal: number
  deltaProtein: number
  deltaSodium: number
  reason: string
}

export interface PlanPreviewOut {
  ok: boolean
  totals: ReturnType<typeof calc>
  violations: string[]
  checks: SafetyLedgerItem[]
}

export interface DomainEvent {
  type: 'record_confirmed' | 'plan_generated' | 'plan_reviewed' | 'food_blocked'
  timestamp: string
  detail: string
}

export interface Api {
  getProfileContext(): Promise<ProfileContextOut>
  getRecord(id: string): Promise<MedicalRecordExtraction | undefined>
  stageRecordDraft(draft: MedicalRecordExtraction): Promise<void>
  confirmRecord(idOrDraft: string | MedicalRecordExtraction): Promise<void>
  diffRecord(profile: Profile, draft: MedicalRecordExtraction): RecordDiffSummary
  getPlans(): Promise<Plan[]>
  generatePlan(opts: { daysCount: 1 | 7; mealsCount: number }): Promise<{ run: WorkflowRun; plan?: Plan }>
  previewPlan(planId: string, dayIdx: number): Promise<PlanPreviewOut>
  suggestSwaps(planId: string, dayIdx: number, slot: string, itemIdx: number, k?: number): Promise<SwapSuggestion[]>
  blockFood(foodId: string): Promise<string[]>
  unblockFood(foodId: string): Promise<string[]>
  getBlockedFoods(): string[]
  getReviewQueue(): Promise<{ plans: Plan[]; rules: Rule[]; docs: Doc[] }>
  getPipelineStatus(runId: string): Promise<WorkflowRun | undefined>
  getAdminHealth(): Promise<{ queueSize: number; tracesCount: number; workflowCount: number }>
  subscribeEvents(listener: (event: DomainEvent) => void): () => void
}

const BLOCKED_FOODS_KEY = 'ainp_blocked_foods'
let inMemoryBlockedFoods: string[] = []
const eventListeners = new Set<(ev: DomainEvent) => void>()
const askDishListeners = new Set<(question: string) => void>()

export function emitDomainEvent(event: DomainEvent) {
  eventListeners.forEach(fn => {
    try {
      fn(event)
    } catch {}
  })
}

export function openAskDishDrawer(question: string) {
  askDishListeners.forEach(fn => {
    try {
      fn(question)
    } catch {}
  })
}

export function subscribeAskDishDrawer(listener: (question: string) => void): () => void {
  askDishListeners.add(listener)
  return () => {
    askDishListeners.delete(listener)
  }
}

function stableHash(input: string): string {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return 'ctx-' + (h >>> 0).toString(16).padStart(8, '0')
}

function readBlockedFoodIds(): string[] {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(BLOCKED_FOODS_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) return parsed.filter(x => typeof x === 'string')
      }
    }
  } catch {}
  return [...inMemoryBlockedFoods]
}

function writeBlockedFoodIds(ids: string[]) {
  const unique = Array.from(new Set(ids))
  inMemoryBlockedFoods = unique
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(BLOCKED_FOODS_KEY, JSON.stringify(unique))
    }
  } catch {}
  return unique
}

export function computeSwapSuggestions(
  plan: Plan | undefined,
  dayIdx: number,
  slot: string,
  itemIdx: number,
  foods: Food[],
  profile: Profile,
  rules: Rule[],
  blockedIds: string[],
  k = 3
): SwapSuggestion[] {
  const currentItem: Item | undefined = plan?.days?.[dayIdx]?.[slot]?.[itemIdx]
  if (!currentItem) return []

  const currentFood = foods.find(f => f.id === currentItem.foodId)
  const currentNutrients = calc([currentItem], foods)
  const currentKcal = currentNutrients.kcal
  const currentProtein = currentNutrients.protein
  const currentSodium = currentNutrients.sodium

  const allergies = (profile.allergies || '')
    .toLowerCase()
    .split(',')
    .map(a => a.trim())
    .filter(Boolean)
  const blockedSet = new Set(blockedIds)
  const ceilings = deriveClinicalCeilings(profile, profile.files?.[0], rules)
  const approvedRules = rules.filter(r => r.status === 'Đã duyệt')

  const candidates = foods
    .filter(f => f.id !== currentItem.foodId && !blockedSet.has(f.id))
    .filter(f => {
      const hay = `${f.name} ${f.allergens}`.toLowerCase()
      return !allergies.some(a => hay.includes(a))
    })
    .filter(f => {
      const ddi = evaluateDrugDietInteractions(profile, [{ foodId: f.id, foodName: f.name, grams: currentItem.grams }], foods)
      if (ddi.length > 0) return false
      if (ceilings.purine_level && f.purine === 'Cao') return false
      if (ceilings.avoid_oxalate && /chân vịt|spinach|cải xoăn|socola/i.test(f.name)) return false
      if (ceilings.max_potassium_mg && (f.potassium || 0) > 450) return false
      const ruleHit = approvedRules.some(
        r =>
          profile.conditions.some(c => c.toLowerCase().includes(r.condition.toLowerCase())) &&
          ((f.category === 'Tinh bột' || f.category === 'Trái cây') && f.gi > r.maxGI)
      )
      return !ruleHit
    })

  const scored = candidates.map(f => {
    const rawGrams = f.kcal > 0 && currentKcal > 0 ? Math.round(((currentKcal * 100) / f.kcal) / 5) * 5 : currentItem.grams
    const suggestedGrams = Math.min(300, Math.max(50, rawGrams || 100))
    const nextTotals = calc([{ foodId: f.id, grams: suggestedGrams }], foods)

    const sameCategory = currentFood && f.category === currentFood.category ? 0 : 120
    const kcalDiff = Math.abs(nextTotals.kcal - currentKcal)
    const proteinDiff = Math.abs(nextTotals.protein - currentProtein) * 5
    const sodiumPenalty = nextTotals.sodium > currentSodium ? (nextTotals.sodium - currentSodium) * 0.6 : 0
    const score = sameCategory + kcalDiff + proteinDiff + sodiumPenalty

    const reasonParts: string[] = []
    if (currentFood && f.category === currentFood.category) reasonParts.push(`Cùng nhóm ${f.category}`)
    if (nextTotals.sodium <= currentSodium) reasonParts.push('Ít natri hơn')
    if (f.gi <= ceilings.max_gi) reasonParts.push(`GI ${f.gi} đạt ngưỡng`)

    return {
      score,
      suggestion: {
        food: f,
        suggestedGrams,
        deltaKcal: Math.round(nextTotals.kcal - currentKcal),
        deltaProtein: Math.round((nextTotals.protein - currentProtein) * 10) / 10,
        deltaSodium: Math.round(nextTotals.sodium - currentSodium),
        reason: reasonParts.join(' · ') || 'Phù hợp ngưỡng an toàn hiện tại'
      }
    }
  })

  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, k)
    .map(entry => entry.suggestion)
}

export const mockApi: Api = {
  async getProfileContext() {
    const s = get()
    const ceilings = deriveClinicalCeilings(s.profile, s.profile.files?.[0], s.rules)
    const basis = mealPlanProfileBasis(s.profile)
    return {
      patientId: s.activePatientId,
      profileVersion: s.version || 1,
      contextHash: stableHash(basis),
      profile: s.profile,
      hardLimits: ceilings,
      approvedRulesCount: s.rules.filter(r => r.status === 'Đã duyệt').length
    }
  },

  async getRecord(id) {
    const s = get()
    return s.profile.files.find(f => f.id === id) || s.ocrHistory?.find(f => f.id === id)
  },

  async stageRecordDraft(draft) {
    setPendingRecordDraft(draft)
  },

  async confirmRecord(idOrDraft) {
    confirmMedicalRecord(idOrDraft)
    emitDomainEvent({
      type: 'record_confirmed',
      timestamp: new Date().toISOString(),
      detail: typeof idOrDraft === 'string' ? idOrDraft : idOrDraft.name
    })
  },

  diffRecord(profile, draft) {
    return computeRecordDiff(profile, draft)
  },

  async getPlans() {
    return get().plans
  },

  async generatePlan(opts) {
    const out = await runClinicalPlanWorkflow(opts)
    if (out.plan) {
      emitDomainEvent({
        type: 'plan_generated',
        timestamp: new Date().toISOString(),
        detail: out.plan.id
      })
    }
    return out
  },

  async previewPlan(planId, dayIdx) {
    const s = get()
    const plan = s.plans.find(p => p.id === planId)
    const dayObj = plan?.days?.[dayIdx] || {}
    const items = Object.values(dayObj).flat()
    const totals = calc(items, s.foods)
    const violations = plan ? validatePlanInvariants(plan, s.profile, s, plan.requiredMeals || 3) : ['Không tìm thấy thực đơn.']
    const checks = safety(s.profile, items, s)
    return {
      ok: violations.length === 0,
      totals,
      violations,
      checks
    }
  },

  async suggestSwaps(planId, dayIdx, slot, itemIdx, k = 3) {
    const s = get()
    const plan = s.plans.find(p => p.id === planId)
    return computeSwapSuggestions(plan, dayIdx, slot, itemIdx, s.foods, s.profile, s.rules, readBlockedFoodIds(), k)
  },

  async blockFood(foodId) {
    const next = writeBlockedFoodIds([...readBlockedFoodIds(), foodId])
    emitDomainEvent({
      type: 'food_blocked',
      timestamp: new Date().toISOString(),
      detail: foodId
    })
    return next
  },

  async unblockFood(foodId) {
    return writeBlockedFoodIds(readBlockedFoodIds().filter(id => id !== foodId))
  },

  getBlockedFoods() {
    return readBlockedFoodIds()
  },

  async getReviewQueue() {
    const s = get()
    return {
      plans: s.plans.filter(p => p.status === 'PENDING_EXPERT_REVIEW'),
      rules: s.rules.filter(r => r.status === 'Chờ duyệt'),
      docs: s.docs.filter(d => d.status === 'Chờ duyệt')
    }
  },

  async getPipelineStatus(runId) {
    return (get().workflowRuns || []).find(w => w.id === runId)
  },

  async getAdminHealth() {
    const s = get()
    return {
      queueSize: s.plans.filter(p => p.status === 'PENDING_EXPERT_REVIEW').length + s.rules.filter(r => r.status === 'Chờ duyệt').length,
      tracesCount: (s.aiTraces || []).length,
      workflowCount: (s.workflowRuns || []).length
    }
  },

  subscribeEvents(listener) {
    eventListeners.add(listener)
    return () => {
      eventListeners.delete(listener)
    }
  }
}

async function fetchJsonWithFallback<T>(path: string, init: RequestInit | undefined, fallback: () => Promise<T>): Promise<T> {
  if (typeof window === 'undefined' || typeof fetch !== 'function' || window.location?.origin === 'http://localhost:3000') {
    return fallback()
  }
  try {
    const res = await fetch(path, init)
    if (res.ok) return (await res.json()) as T
  } catch {}
  return fallback()
}

export const httpApi: Api = {
  getProfileContext: () => fetchJsonWithFallback('/api/profile/context', undefined, () => mockApi.getProfileContext()),
  getRecord: id => mockApi.getRecord(id),
  stageRecordDraft: draft => mockApi.stageRecordDraft(draft),
  confirmRecord: idOrDraft => mockApi.confirmRecord(idOrDraft),
  diffRecord: (profile, draft) => mockApi.diffRecord(profile, draft),
  getPlans: () => fetchJsonWithFallback('/api/plans', undefined, () => mockApi.getPlans()),
  generatePlan: opts => mockApi.generatePlan(opts),
  previewPlan: (planId, dayIdx) =>
    fetchJsonWithFallback(
      '/api/plans/preview',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planId, dayIdx }) },
      () => mockApi.previewPlan(planId, dayIdx)
    ),
  suggestSwaps: (planId, dayIdx, slot, itemIdx, k = 3) =>
    fetchJsonWithFallback(
      `/api/plans/swaps?planId=${encodeURIComponent(planId)}&dayIdx=${dayIdx}&slot=${encodeURIComponent(slot)}&itemIdx=${itemIdx}&k=${k}`,
      undefined,
      () => mockApi.suggestSwaps(planId, dayIdx, slot, itemIdx, k)
    ),
  blockFood: foodId => mockApi.blockFood(foodId),
  unblockFood: foodId => mockApi.unblockFood(foodId),
  getBlockedFoods: () => mockApi.getBlockedFoods(),
  getReviewQueue: () => fetchJsonWithFallback('/api/review', undefined, () => mockApi.getReviewQueue()),
  getPipelineStatus: runId => mockApi.getPipelineStatus(runId),
  getAdminHealth: () => fetchJsonWithFallback('/api/admin/health', undefined, () => mockApi.getAdminHealth()),
  subscribeEvents(listener) {
    if (typeof window !== 'undefined' && typeof EventSource !== 'undefined' && window.location?.origin !== 'http://localhost:3000') {
      try {
        const es = new EventSource('/api/events')
        es.onmessage = ev => {
          try {
            listener(JSON.parse(ev.data))
          } catch {}
        }
        const unsubLocal = mockApi.subscribeEvents(listener)
        return () => {
          es.close()
          unsubLocal()
        }
      } catch {}
    }
    return mockApi.subscribeEvents(listener)
  }
}

export const api: Api = mockApi
