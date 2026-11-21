import { useSyncExternalStore } from 'react'
import { seed, initialOrganAlerts } from '../data/seed'
import {
  cleanAndDeduplicateDiseases,
  cleanAndDeduplicateMedications,
  filterAndDeduplicateConditions,
  formatMedicationDisplay,
  isNoisyDiagnosis
} from '../utils/pdfExtractor'
import { deriveClinicalCeilings, evaluateDrugDietInteractions, localDateIso, validatePlanInvariants, calc, tdee, SLOTS, approvedNutritionLimits, isCurrentMealPlan, mealPlanProfileBasis, nutritionProfileIssue, rebalanceDayPortions } from '../utils/nutrition'
import type {
  State,
  MedicalRecordExtraction,
  OCRExtraction,
  Profile,
  EvidenceBasis,
  Food,
  FoodScanResult,
  Plan,
  PlanStatus,
  Item,
  OrganId,
  OrganMapping,
  Slot,
  DeficiencyPrediction,
  Doc,
  Rule,
  AITrace,
  TraceSpan,
  WorkflowRun,
  ChatEntry,
  PatientRecord
} from '../types'

// Ensure localStorage compatibility in Node 26 + jsdom environments
if (typeof window !== 'undefined' && window.localStorage) {
  try {
    if (!globalThis.localStorage || typeof globalThis.localStorage.getItem !== 'function') {
      Object.defineProperty(globalThis, 'localStorage', {
        value: window.localStorage,
        writable: true,
        configurable: true
      })
    }
  } catch {}
}

const K = 'ainp_v4'
const getStorage = () => (typeof window !== 'undefined' && window.localStorage ? window.localStorage : (typeof localStorage !== 'undefined' ? localStorage : null))

let s: State

try {
  const st = getStorage()
  s = JSON.parse((st && st.getItem(K)) || '')
} catch {
  s = seed()
}

if (!s || !s.users || !s.profile) {
  s = seed()
}

// Ensure organ alerts and new fields exist
if (!s.activeOrganAlerts) s.activeOrganAlerts = initialOrganAlerts
if (!s.profile.files) s.profile.files = []
if (!s.profile.medications) s.profile.medications = []
if (!s.plans) s.plans = []
if (!s.aiTraces) s.aiTraces = []
if (!s.traceSpans) s.traceSpans = []
if (!s.workflowRuns) s.workflowRuns = []
if (!s.version) s.version = 1

const patientFields: (keyof PatientRecord)[] = [
  'profile', 'plans', 'diary', 'chat', 'activeOrganAlerts', 'ocrHistory',
  'trendPrediction', 'pendingRecordDraft', 'workflowRuns', 'aiTraces', 'traceSpans',
  'selectedDiaryDate'
]

function currentPatientRecord(state: State): PatientRecord {
  const record = {} as PatientRecord
  for (const field of patientFields) {
    ;(record as any)[field] = structuredClone(state[field])
  }
  return record
}

function emptyPatientRecord(): PatientRecord {
  return {
    profile: { dob: '', height: 0, weight: 0, activity: 1.2, goal: '', allergies: '', conditions: [], medications: [], files: [] },
    plans: [], diary: {}, chat: [], activeOrganAlerts: {} as Record<OrganId, OrganMapping>,
    ocrHistory: [], trendPrediction: undefined, pendingRecordDraft: null,
    workflowRuns: [], aiTraces: [], traceSpans: [],
    selectedDiaryDate: undefined
  }
}

function selectPatientInState(state: State, patientId: string) {
  if (state.activePatientId === patientId) return
  state.patientRecords ??= {}
  if (state.activePatientId) state.patientRecords[state.activePatientId] = currentPatientRecord(state)
  const record = state.patientRecords[patientId] || emptyPatientRecord()
  for (const field of patientFields) {
    ;(state as any)[field] = structuredClone(record[field])
  }
  state.activePatientId = patientId
}

// Existing installations contained exactly one shared patient record.
if (!s.patientRecords) {
  const originalPatient = s.users.find(user => user.email === 'patient@demo.vn')
  s.activePatientId = originalPatient?.id
  s.patientRecords = originalPatient ? { [originalPatient.id]: currentPatientRecord(s) } : {}
}
if (!s.users.some(user => user.email.toLowerCase() === 'patient.test@demo.vn')) {
  s.users.push({ id: 'u-test-patient', name: 'Bệnh nhân kiểm thử', email: 'patient.test@demo.vn', password: 'Demo123!', role: 'patient', active: true })
}

// Merge standardized clinical foods (F023..F036) & repair legacy F014 olive-oil mis-links on existing plans (QA-02)
const baseFoods = seed().foods
if (Array.isArray(s.foods)) {
  for (const bf of baseFoods) {
    if (!s.foods.some(existing => existing.id === bf.id)) {
      s.foods.push(bf)
    }
  }
}
const repairMislinkedF014InPlans = (plansList?: Plan[]) => {
  if (!Array.isArray(plansList)) return
  for (const pl of plansList) {
    for (const dayObj of pl.days || []) {
      for (const items of Object.values(dayObj || {})) {
        for (const it of items || []) {
          if (it.foodId === 'F014' && it.foodName && !/oliu/i.test(it.foodName)) {
            const targetId = /đậu nành/i.test(it.foodName) ? 'F024' : /sữa chua/i.test(it.foodName) ? 'F013' : 'F023'
            const targetFood = s.foods.find(x => x.id === targetId) || baseFoods.find(x => x.id === targetId)
            if (targetFood) {
              it.foodId = targetFood.id
              it.foodName = targetFood.name
              it.snapshot = {
                kcal: targetFood.kcal, protein: targetFood.protein, fat: targetFood.fat, carb: targetFood.carb,
                fiber: targetFood.fiber, sodium: targetFood.sodium, potassium: targetFood.potassium,
                gi: targetFood.gi, purine: targetFood.purine, allergens: targetFood.allergens
              }
            }
          }
        }
      }
    }
  }
}
repairMislinkedF014InPlans(s.plans)
if (s.patientRecords) {
  Object.values(s.patientRecords).forEach(rec => repairMislinkedF014InPlans(rec?.plans))
}

// Normalize legacy unrealistic sodium rule values (9999 / 120 / 100) to medical daily ceilings (1500 - 2000mg)
if (Array.isArray(s.rules)) {
  const defaultRules = seed().rules
  s.rules.forEach(r => {
    const match = defaultRules.find(dr => dr.id === r.id)
    if (match && (r.maxSodium === 9999 || r.maxSodium === 120 || r.maxSodium === 100)) {
      r.maxSodium = match.maxSodium
    }
  })
}

// Upgrade legacy 1-day initial demo plan to varied 7-day plan in existing localStorage sessions
const upgradeLegacyInitPlan = (plansList?: Plan[]) => {
  if (!Array.isArray(plansList)) return
  const freshInit = seed().plans[0]
  plansList.forEach(pl => {
    if (pl.id === 'plan-cdss-init' && (!pl.days || pl.days.length < 7)) {
      pl.days = structuredClone(freshInit.days)
    }
  })
}
upgradeLegacyInitPlan(s.plans)
if (s.patientRecords) {
  Object.values(s.patientRecords).forEach(rec => upgradeLegacyInitPlan(rec?.plans))
}

function deduplicateCatalogConditions(conditions: State['conditions'] | undefined): State['conditions'] {
  return filterAndDeduplicateConditions(conditions)
}

function sanitizeExtraction(rec: MedicalRecordExtraction): MedicalRecordExtraction {
  return {
    ...rec,
    diseases: cleanAndDeduplicateDiseases(rec.diseases || [])
  }
}

export const CLEARED_RECORD_SYSTEM_REGEX =
  /Hồ sơ bệnh án đã được làm sạch\.\s*Sơ đồ Giải phẫu và Hệ thống CDSS đã trở về trạng thái khỏe mạnh ban đầu\./i

export function hasActiveMedicalRecord(target: {
  profile?: Profile
  ocrHistory?: MedicalRecordExtraction[]
  pendingRecordDraft?: MedicalRecordExtraction | null
}): boolean {
  return Boolean(
    (target.profile?.files && target.profile.files.length > 0) ||
    (target.profile?.conditions && target.profile.conditions.length > 0) ||
    (target.ocrHistory && target.ocrHistory.length > 0) ||
    target.pendingRecordDraft
  )
}

export function stripStaleClearedChatMessage(target: {
  chat?: ChatEntry[]
  profile?: Profile
  ocrHistory?: MedicalRecordExtraction[]
  pendingRecordDraft?: MedicalRecordExtraction | null
}) {
  if (!hasActiveMedicalRecord(target) || !Array.isArray(target.chat)) return
  target.chat = target.chat.filter(
    m => !(m.from === 'b' && CLEARED_RECORD_SYSTEM_REGEX.test(m.text || ''))
  )
}

export function getVisibleChatMessages(target: {
  chat?: ChatEntry[]
  profile?: Profile
  ocrHistory?: MedicalRecordExtraction[]
  pendingRecordDraft?: MedicalRecordExtraction | null
}): ChatEntry[] {
  const msgs = Array.isArray(target.chat) ? target.chat : []
  if (!hasActiveMedicalRecord(target)) return msgs
  const filtered = msgs.filter(
    m => !(m.from === 'b' && CLEARED_RECORD_SYSTEM_REGEX.test(m.text || ''))
  )
  if (filtered.length > 0) return filtered
  return [
    {
      id: 'msg-active-record-welcome',
      from: 'b',
      text: 'Hồ sơ bệnh án của bạn đã được cập nhật vào hệ thống CDSS. Bạn có thể hỏi về **chẩn đoán, chỉ số xét nghiệm, đơn thuốc** hoặc bất kỳ **món ăn** nào trước khi dùng.'
    }
  ]
}

function sanitizePatientRecordSlice(target: {
  profile: Profile
  ocrHistory?: MedicalRecordExtraction[]
  pendingRecordDraft?: MedicalRecordExtraction | null
  chat?: ChatEntry[]
}) {
  if (target.profile) {
    target.profile.conditions = cleanAndDeduplicateDiseases(target.profile.conditions || [])
    target.profile.medications = cleanAndDeduplicateMedications(target.profile.medications || [])
    if (Array.isArray(target.profile.files)) {
      target.profile.files = target.profile.files.map(sanitizeExtraction)
    }
  }
  if (Array.isArray(target.ocrHistory)) {
    target.ocrHistory = target.ocrHistory.map(sanitizeExtraction)
  }
  if (target.pendingRecordDraft) {
    target.pendingRecordDraft = sanitizeExtraction(target.pendingRecordDraft)
  }
  stripStaleClearedChatMessage(target)
}

s.conditions = deduplicateCatalogConditions(s.conditions)
sanitizePatientRecordSlice(s)
if (s.patientRecords) {
  Object.values(s.patientRecords).forEach(rec => {
    if (rec) sanitizePatientRecordSlice(rec)
  })
}

const ls = new Set<() => void>()
export const get = () => s

export function set(fn: (d: State) => State | void) {
  const prev = s
  const c = structuredClone(s)
  const localNext = fn(c) || c
  let merged = localNext
  try {
    const st = getStorage()
    if (st) {
      const rawDisk = st.getItem(K)
      if (rawDisk) {
        try {
          const disk = JSON.parse(rawDisk) as State
          if (disk && disk.users && (disk.version || 0) > (prev.version || 0)) {
            const diskClone = structuredClone(disk)
            // Merge top-level and profile keys modified cleanly in this call onto newer disk snapshot (L09)
            ;(Object.keys(localNext) as (keyof State)[]).forEach(k => {
              if (k === 'version') return
              if (k === 'profile') {
                ;(Object.keys(localNext.profile) as (keyof Profile)[]).forEach(pk => {
                  if (JSON.stringify(localNext.profile[pk]) !== JSON.stringify(prev.profile[pk])) {
                    ;(diskClone.profile as any)[pk] = localNext.profile[pk]
                  }
                })
              } else if (JSON.stringify(localNext[k]) !== JSON.stringify(prev[k])) {
                ;(diskClone as any)[k] = localNext[k]
              }
            })
            merged = diskClone
          }
        } catch {}
      }
      if (merged.activePatientId) {
        merged.patientRecords ??= {}
        merged.patientRecords[merged.activePatientId] = currentPatientRecord(merged)
      }
      merged.version = Math.max(prev.version || 0, merged.version || 0) + 1
      st.setItem(K, JSON.stringify(merged))
    } else {
      if (merged.activePatientId) {
        merged.patientRecords ??= {}
        merged.patientRecords[merged.activePatientId] = currentPatientRecord(merged)
      }
      merged.version = (prev.version || 0) + 1
    }
    s = merged
  } catch (e) {
    s = prev
    console.warn('localStorage error', e)
  }
  ls.forEach(l => l())
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (ev) => {
    if (ev.key === K && ev.newValue) {
      try {
        const parsed = JSON.parse(ev.newValue)
        if (parsed && parsed.users && parsed.profile) {
          s = parsed
          ls.forEach(l => l())
        }
      } catch {}
    }
  })
}

export const useS = () => useSyncExternalStore(f => {
  ls.add(f)
  return () => { ls.delete(f) }
}, get)

export const uid = () => Math.random().toString(36).slice(2, 9)
export const me = (d = s) => d.users.find(u => u.id === d.session && u.active)

export const log = (d: State, action: string, target: string) => {
  d.logs.unshift({
    id: uid(),
    user: me(d)?.name || me(d)?.email || 'Hệ thống CDSS',
    action,
    target,
    time: new Date().toISOString()
  })
}

function getPatientTargetState(
  d: State,
  targetPatientId?: string
): { chat: ChatEntry[]; aiTraces?: AITrace[]; traceSpans?: TraceSpan[]; workflowRuns?: WorkflowRun[] } {
  if (!targetPatientId || d.activePatientId === targetPatientId) {
    return d
  }
  d.patientRecords ??= {}
  if (!d.patientRecords[targetPatientId]) {
    d.patientRecords[targetPatientId] = emptyPatientRecord()
  }
  return d.patientRecords[targetPatientId]
}

export function recordAITrace(trace: Omit<AITrace, 'id' | 'time'>, targetPatientId?: string) {
  set(d => {
    const target = getPatientTargetState(d, targetPatientId)
    if (!target.aiTraces) target.aiTraces = []
    target.aiTraces.unshift({
      ...trace,
      id: 'tr-' + uid(),
      time: new Date().toISOString()
    })
    if (target.aiTraces.length > 200) {
      target.aiTraces = target.aiTraces.slice(0, 200)
    }
  })
}

export function recordTraceSpan(span: TraceSpan, targetPatientId?: string) {
  set(d => {
    const target = getPatientTargetState(d, targetPatientId ?? span.attributes?.patientId)
    if (!target.traceSpans) target.traceSpans = []
    target.traceSpans.unshift(span)
    if (target.traceSpans.length > 400) {
      target.traceSpans = target.traceSpans.slice(0, 400)
    }
  })
}

export function recordWorkflowRun(run: WorkflowRun, targetPatientId?: string) {
  set(d => {
    const target = getPatientTargetState(d, targetPatientId)
    if (!target.workflowRuns) target.workflowRuns = []
    const idx = target.workflowRuns.findIndex(w => w.id === run.id)
    if (idx >= 0) target.workflowRuns[idx] = run
    else target.workflowRuns.unshift(run)
    if (target.workflowRuns.length > 50) {
      target.workflowRuns = target.workflowRuns.slice(0, 50)
    }
  })
}

export function appendChatMessage(msg: ChatEntry, targetPatientId?: string) {
  const entry: ChatEntry = msg.id ? msg : { ...msg, id: 'msg-' + uid() }
  set(d => {
    const target = getPatientTargetState(d, targetPatientId)
    target.chat.push(entry)
  })
  return entry.id!
}

export function updateChatMessageById(
  patientId: string | undefined,
  messageId: string,
  updater: (msg: ChatEntry) => ChatEntry
) {
  set(d => {
    const target = getPatientTargetState(d, patientId)
    const idx = target.chat.findIndex(m => m.id === messageId)
    if (idx < 0) return
    const updated = updater(target.chat[idx])
    target.chat[idx] = updated.id ? updated : { ...updated, id: messageId }
  })
}

export function updateLastChatMessage(updater: (last: ChatEntry) => ChatEntry) {
  set(d => {
    if (d.chat.length === 0) return
    const idx = d.chat.length - 1
    d.chat[idx] = updater(d.chat[idx])
  })
}

export function setPendingRecordDraft(draft: MedicalRecordExtraction | null) {
  const cleanedDraft = draft ? sanitizeExtraction(draft) : null
  set(d => {
    d.pendingRecordDraft = cleanedDraft
    if (cleanedDraft) stripStaleClearedChatMessage(d)
  })
}

export const reset = () => {
  const fresh = seed()
  fresh.activePatientId = 'u1'
  fresh.patientRecords = { u1: currentPatientRecord(fresh) }
  try {
    const st = getStorage()
    if (st) st.setItem(K, JSON.stringify(fresh))
  } catch {}
  s = fresh
  ls.forEach(l => l())
}

export function login(email: string, pw: string) {
  const u = s.users.find(x => x.email === email && x.password === pw)
  if (!u) return 'Email hoặc mật khẩu không đúng.'
  if (!u.active) return 'Tài khoản đã bị khóa.'
  set(d => {
    if (u.role === 'patient') selectPatientInState(d, u.id)
    d.session = u.id
    log(d, 'Đăng nhập', `Phiên làm việc (${u.role})`)
  })
  return ''
}

export function selectPatient(patientId: string) {
  if (me()?.role !== 'expert' && me()?.role !== 'admin') return
  if (!s.users.some(user => user.id === patientId && user.role === 'patient' && user.active)) return
  set(d => {
    selectPatientInState(d, patientId)
    log(d, 'Chọn hồ sơ bệnh nhân', patientId)
  })
}

// ==================== FLOW 1: CONFIRM MEDICAL RECORD EXTRACTION ====================

export function confirmMedicalRecord(recordIdOrDraft: string | MedicalRecordExtraction) {
  if (typeof recordIdOrDraft !== 'string') {
    const confirmedRec = { ...recordIdOrDraft, confirmed: true }
    addMedicalRecord(confirmedRec)
    setPendingRecordDraft(null)
    return
  }
  const currentDraft = s.pendingRecordDraft
  if (currentDraft && currentDraft.id === recordIdOrDraft) {
    const confirmedRec = { ...currentDraft, confirmed: true }
    addMedicalRecord(confirmedRec)
    setPendingRecordDraft(null)
    return
  }
  set(d => {
    const rec = d.profile.files.find(f => f.id === recordIdOrDraft)
    if (!rec) return
    rec.confirmed = true
    rec.diseases = cleanAndDeduplicateDiseases(rec.diseases || [])
    const hasDiagnosis = rec.diseases.length > 0

    if (hasDiagnosis && rec.id !== 'rec-001' && rec.id !== 'ocr-demo-01') {
      d.profile.files = d.profile.files.filter(f => f.id !== 'rec-001' && f.id !== 'ocr-demo-01')
      if (d.ocrHistory) d.ocrHistory = d.ocrHistory.filter(f => f.id !== 'rec-001' && f.id !== 'ocr-demo-01')
    }

    // Synchronize diseases
    d.profile.conditions = hasDiagnosis
      ? rec.diseases
      : cleanAndDeduplicateDiseases([...(d.profile.conditions || []), ...rec.diseases])

    // Synchronize to Admin & Expert Conditions list
    rec.diseases.forEach(dis => {
      if (!d.conditions.some(c => c.name.trim().toLowerCase() === dis.toLowerCase())) {
        d.conditions.push({ id: uid(), name: dis, status: 'Hỗ trợ' })
      }
    })
    d.conditions = deduplicateCatalogConditions(d.conditions)

    // Synchronize medications
    if (hasDiagnosis || rec.medications.length > 0) {
      d.profile.medications = cleanAndDeduplicateMedications(
        rec.medications.map(m => formatMedicationDisplay(m.name, m.activeIngredient))
      )
    }

    // Synchronize allergies
    if (rec.allergies && rec.allergies.length > 0) {
      const existingAllergies = d.profile.allergies ? d.profile.allergies.split(',').map(x => x.trim()) : []
      const merged = Array.from(new Set([...existingAllergies, ...rec.allergies])).filter(Boolean)
      d.profile.allergies = merged.join(', ')
    }

    // Synchronize active organ alerts strictly around this confirmed medical record
    const updatedAlerts: Record<OrganId, OrganMapping> = hasDiagnosis
      ? { ...defaultHealthyOrganAlerts }
      : { ...(d.activeOrganAlerts || initialOrganAlerts) }
    rec.organ_mappings.forEach(m => {
      const sev = m.severity === 'safe' ? 'normal' : m.severity
      if (!hasDiagnosis && sev === 'normal') return
      updatedAlerts[m.organ_id] = { ...m, severity: sev }
    })
    d.activeOrganAlerts = updatedAlerts

    // If conflict detected, lock or update any active plan
    if (rec.has_conflict && d.plans.length > 0) {
      d.plans[0].has_conflict = true
      d.plans[0].status = 'PENDING_EXPERT_REVIEW'
      d.plans[0].conflict_details = rec.conflict_reason || 'Phát hiện xung đột từ hồ sơ bệnh án mới xác nhận.'
    }

    stripStaleClearedChatMessage(d)
    log(d, 'Xác nhận Hồ sơ Bệnh án', `${rec.name} (${rec.diseases.join(', ')})`)
  })
}

// ==================== FLOW 1: UPLOAD & REAL-TIME SYSTEM-WIDE SYNCHRONIZATION ====================

export function generateInstantTrendProjection(
  profile: State['profile'],
  alerts: Record<OrganId, OrganMapping>,
  latestExtraction?: MedicalRecordExtraction
): DeficiencyPrediction {
  const deficiencies: DeficiencyPrediction['deficiencies'] = []
  const organ_projections: DeficiencyPrediction['organ_projections'] = []

  // 1. Kidneys Evaluation
  if (alerts.kidneys?.severity === 'critical' || alerts.kidneys?.severity === 'warning') {
    deficiencies.push({
      nutrient: 'Vitamin D & Canxi',
      risk: alerts.kidneys.severity === 'critical' ? 'high' : 'medium',
      explanation: 'Suy giảm chức năng lọc cầu thận làm giảm hoạt hóa 1,25-(OH)2-D3 tại ống thận, dễ dẫn đến cường cận giáp thứ phát.',
      safe_food_remedies: ['Nấm hương phơi nắng', 'Sữa hạt ít kali', 'Bổ sung Canxi theo chỉ định BS']
    })
    organ_projections.push({
      organ_id: 'kidneys',
      status: alerts.kidneys.severity === 'critical' ? 'Nguy cơ quá tải ure máu' : 'Theo dõi mức lọc cầu thận',
      projection: 'Cần duy trì đạm 0.8g/kg và Natri < 1500mg để bảo tồn số lượng nephron hoạt động.'
    })
  }

  // 2. Heart Evaluation
  if (alerts.heart?.severity === 'critical' || alerts.heart?.severity === 'warning') {
    deficiencies.push({
      nutrient: 'Magnesi & CoQ10',
      risk: alerts.heart.severity === 'critical' ? 'high' : 'medium',
      explanation: 'Huyết áp cao và thuốc tim mạch làm tăng tiêu hao khoáng chất bảo vệ mạch máu.',
      safe_food_remedies: ['Hạt bí ngô nguyên hạt', 'Rau xanh hấp nhạt', 'Hạt chia']
    })
    organ_projections.push({
      organ_id: 'heart',
      status: alerts.heart.severity === 'critical' ? 'Cảnh báo huyết áp thành mạch' : 'Ổn định huyết áp mục tiêu',
      projection: 'Hạn chế tối đa natri ẩn từ nước chấm và thực phẩm chế biến sẵn để tránh giữ nước.'
    })
  }

  // 3. Stomach Evaluation
  if (alerts.stomach?.severity === 'critical' || alerts.stomach?.severity === 'warning') {
    deficiencies.push({
      nutrient: 'Vitamin B12 & Sắt',
      risk: 'medium',
      explanation: 'Tổn thương niêm mạc dạ dày hoặc dùng thuốc ức chế acid kéo dài làm giảm hấp thu B12 và Sắt.',
      safe_food_remedies: ['Thịt gia cầm nạc nấu mềm', 'Cháo đậu đỏ', 'Men vi sinh probiotics']
    })
    organ_projections.push({
      organ_id: 'stomach',
      status: 'Hồi phục niêm mạc dạ dày',
      projection: 'Chia nhỏ bữa ăn làm 4-5 lần/ngày giúp giảm áp lực tiết dịch vị acid.'
    })
  }

  // 4. Pancreas Evaluation
  if (alerts.pancreas?.severity === 'critical' || alerts.pancreas?.severity === 'warning') {
    deficiencies.push({
      nutrient: 'Crom & Kẽm',
      risk: 'medium',
      explanation: 'Đường huyết cao làm tăng bài tiết khoáng vi lượng qua nước tiểu, làm giảm độ nhạy insulin.',
      safe_food_remedies: ['Bông cải xanh', 'Yến mạch nguyên cám', 'Hạt hướng dương']
    })
    organ_projections.push({
      organ_id: 'pancreas',
      status: 'Điều hòa đường huyết nội tiết',
      projection: 'Ưu tiên tinh bột có chỉ số GI < 55 kết hợp chất xơ hòa tan để làm chậm hấp thu đường.'
    })
  }

  // 5. Joints Evaluation
  if (alerts.joints?.severity === 'critical' || alerts.joints?.severity === 'warning') {
    deficiencies.push({
      nutrient: 'Vitamin C & Omega-3 (EPA/DHA)',
      risk: 'medium',
      explanation: 'Tăng acid uric và phản ứng viêm tại khớp cần chất chống oxy hóa tự nhiên để hạ acid uric.',
      safe_food_remedies: ['Quả anh đào (Cherry)', 'Ớt chuông ngọt', 'Dầu hạt lanh']
    })
    organ_projections.push({
      organ_id: 'joints',
      status: 'Phòng ngừa kết tủa tinh thể Urat',
      projection: 'Uống đủ > 2.5 lít nước/ngày và hạn chế tuyệt đối nước luộc thịt, thịt đỏ và hải sản giàu purine.'
    })
  }

  // 6. Liver Evaluation
  if (alerts.liver?.severity === 'critical' || alerts.liver?.severity === 'warning') {
    deficiencies.push({
      nutrient: 'Choline & Glutathione',
      risk: 'medium',
      explanation: 'Tế bào gan tổn thương hoặc nhiễm mỡ làm cạn kiệt nguồn dự trữ chất chống oxy hóa nội sinh.',
      safe_food_remedies: ['Bột nghệ Nano curcumin', 'Trà atiso tươi', 'Đậu phụ hấp']
    })
    organ_projections.push({
      organ_id: 'liver',
      status: 'Hạ men gan & Giải độc gan',
      projection: 'Cắt giảm chất béo bão hòa xuống dưới 20% tổng năng lượng và kiêng cồn tuyệt đối.'
    })
  }

  if (deficiencies.length === 0) {
    deficiencies.push({
      nutrient: 'Chất xơ hòa tan & Vi khoáng',
      risk: 'low',
      explanation: 'Tình trạng dinh dưỡng cơ bản cân bằng. Cần duy trì lượng rau củ đa dạng.',
      safe_food_remedies: ['Rau củ quả tươi theo mùa', 'Các loại đậu hạt']
    })
    organ_projections.push({
      organ_id: 'heart',
      status: 'Trạng thái ổn định',
      projection: 'Duy trì chế độ ăn Địa Trung Hải giàu chất xơ và chất béo không bão hòa.'
    })
  }

  const detectedDiseases = profile.conditions.join(', ') || latestExtraction?.diseases.join(', ') || 'Chỉ số bình thường'
  return {
    trend_summary: `Dự báo động học dinh dưỡng 7 ngày đã tự động đồng bộ theo hồ sơ mới (${detectedDiseases}). Các cơ quan trọng điểm đang được bảo vệ an toàn theo khuyến nghị CDSS.`,
    deficiencies,
    organ_projections
  }
}

export function addMedicalRecord(extraction: MedicalRecordExtraction) {
  const cleanedExtraction = sanitizeExtraction(extraction)
  if (!cleanedExtraction.confirmed) {
    setPendingRecordDraft(cleanedExtraction)
    return
  }
  set(d => {
    const hasDiagnosis = cleanedExtraction.diseases.length > 0
    if (!d.profile.files) d.profile.files = []
    // Remove the demo seed record if uploading/selecting a new case so it doesn't contaminate the fresh record
    if (hasDiagnosis && cleanedExtraction.id !== 'rec-001' && cleanedExtraction.id !== 'ocr-demo-01') {
      d.profile.files = d.profile.files.filter(f => f.id !== 'rec-001' && f.id !== 'ocr-demo-01')
    }

    // Upsert to avoid duplicate records during progressive refinement
    const existingFileIdx = d.profile.files.findIndex(f => f.id === cleanedExtraction.id || f.name === cleanedExtraction.name)
    if (existingFileIdx !== -1) {
      d.profile.files[existingFileIdx] = cleanedExtraction
    } else {
      d.profile.files.unshift(cleanedExtraction)
    }

    if (!d.ocrHistory) d.ocrHistory = []
    if (hasDiagnosis && cleanedExtraction.id !== 'rec-001' && cleanedExtraction.id !== 'ocr-demo-01') {
      d.ocrHistory = d.ocrHistory.filter(f => f.id !== 'rec-001' && f.id !== 'ocr-demo-01')
    }
    const existingOcrIdx = d.ocrHistory.findIndex(f => f.id === cleanedExtraction.id || f.name === cleanedExtraction.name)
    if (existingOcrIdx !== -1) {
      d.ocrHistory[existingOcrIdx] = cleanedExtraction
    } else {
      d.ocrHistory.unshift(cleanedExtraction)
    }

    // 1. Synchronize active organ alerts strictly around this uploaded medical record
    // Default 6 core organs to healthy/normal, then apply the uploaded record's mappings
    const updatedAlerts: Record<OrganId, OrganMapping> = hasDiagnosis
      ? { ...defaultHealthyOrganAlerts }
      : { ...d.activeOrganAlerts }
    if (cleanedExtraction.organ_mappings && cleanedExtraction.organ_mappings.length > 0) {
      cleanedExtraction.organ_mappings.forEach(m => {
        const sev = m.severity === 'safe' ? 'normal' : m.severity
        if (!hasDiagnosis && sev === 'normal') return
        updatedAlerts[m.organ_id] = {
          ...m,
          severity: sev
        }
      })
    }
    d.activeOrganAlerts = updatedAlerts

    // 2. Synchronize diseases to profile strictly around this medical record
    if (hasDiagnosis) d.profile.conditions = cleanedExtraction.diseases

    // 3. Synchronize medications to profile from this medical record
    if (hasDiagnosis || cleanedExtraction.medications.length > 0) {
      d.profile.medications = cleanAndDeduplicateMedications(
        cleanedExtraction.medications.map(m => formatMedicationDisplay(m.name, m.activeIngredient))
      )
    }

    // 4. Synchronize allergies to profile
    if (cleanedExtraction.allergies && cleanedExtraction.allergies.length > 0) {
      const existingAllergies = d.profile.allergies ? d.profile.allergies.split(',').map(x => x.trim()) : []
      const merged = Array.from(new Set([...existingAllergies, ...cleanedExtraction.allergies])).filter(Boolean)
      d.profile.allergies = merged.join(', ')
    }

    // 5. System-wide Conditions Catalog Auto-Registration
    // Ensures CDSS gate(p, d) and Planner recognize newly detected diseases
    cleanedExtraction.diseases?.forEach(dis => {
      if (!d.conditions.some(c => c.name.trim().toLowerCase() === dis.toLowerCase())) {
        d.conditions.push({
          id: 'cond-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          name: dis,
          status: 'Hỗ trợ'
        })
      }
    })
    d.conditions = deduplicateCatalogConditions(d.conditions)

    // 6. System-wide Clinical Rules Synchronization
    // Creates or validates nutrition rules based on detected organ alerts
    cleanedExtraction.organ_mappings?.forEach(m => {
      if (hasDiagnosis && (m.severity === 'critical' || m.severity === 'warning')) {
        const condName = cleanedExtraction.diseases[0]
        if (!d.rules.some(r => r.condition.toLowerCase() === condName.toLowerCase())) {
          const maxNa = (m.nutrient_limits?.sodium_max_mg as number) || (m.organ_id === 'heart' ? 1200 : m.organ_id === 'kidneys' ? 1500 : 2000)
          const maxGi = (m.nutrient_limits?.gi_max as number) || (m.organ_id === 'pancreas' ? 55 : 100)
          const avoid = m.organ_id === 'stomach'
            ? 'Gia vị cay nóng, cồn, thực phẩm có tính acid'
            : m.organ_id === 'joints'
            ? 'Nội tạng động vật, hải sản đậm, thịt đỏ'
            : m.organ_id === 'kidneys'
            ? 'Muối kali, thực phẩm đóng hộp, đồ chế biến sẵn'
            : m.organ_id === 'liver'
            ? 'Rượu bia, đồ chiên rán nhiều dầu mỡ'
            : 'Thực phẩm chế biến sẵn, muối natri cao'

          d.rules.push({
            id: 'R-' + Date.now() + '-' + m.organ_id,
            title: `Quy tắc dinh dưỡng lâm sàng: ${condName}`,
            condition: condName,
            maxSodium: maxNa,
            maxGI: maxGi,
            avoidCategories: avoid,
            reference: `Khuyến nghị CDSS & Phác đồ điều trị (${cleanedExtraction.name})`,
            status: 'Chờ duyệt'
          })
        }
      }
    })

    // 7. System-wide Meal Plan Safety Synchronization & Instant Tailored Plan Generation
    // Automatically creates an AI Treatment Meal Plan strictly tailored to this medical record and its CDSS ceilings
    const canPreparePlan = hasDiagnosis && !nutritionProfileIssue(d.profile)
    if (canPreparePlan) {
      const basis = mealPlanProfileBasis(d.profile)
      if (!d.plans.some(plan => plan.profileBasis === basis)) {
        d.plans.unshift(buildClinicalPlanFromRecord(d.profile, cleanedExtraction, d.activeOrganAlerts, d.docs, d.rules))
      }
    }

    // 8. Auto-Sync 7-Day Longitudinal Trend Forecast (DeficiencyPrediction)
    d.trendPrediction = canPreparePlan
      ? generateInstantTrendProjection(d.profile, d.activeOrganAlerts, cleanedExtraction)
      : undefined

    stripStaleClearedChatMessage(d)
    log(d, 'Tải lên & Tự động Đồng bộ Toàn diện Hệ thống', `${cleanedExtraction.name} (${cleanedExtraction.diseases?.join(', ') || 'Chỉ số mới'})`)
  })
}

// ==================== AUTO CLINICAL TREATMENT PLAN GENERATOR ====================

export function buildClinicalPlanFromRecord(
  profile: Profile,
  extraction: OCRExtraction,
  alerts?: Record<OrganId, OrganMapping>,
  docs?: Doc[],
  rules?: Rule[],
  daysCount: 1 | 7 = 7,
  mealsCount: number = 4
): Plan {
  const profileIssue = nutritionProfileIssue(profile)
  if (profileIssue) throw new Error(profileIssue)
  const condStr = (extraction.diseases || profile.conditions || []).join(' ').toLowerCase()
  const ceilings = deriveClinicalCeilings(profile, extraction, rules || [])

  // 1. Clinical ceilings from multi-disease intersection (BOS-03)
  const maxSodium = ceilings.max_sodium_mg
  const maxProtein = ceilings.max_protein_g
  const maxGi = ceilings.max_gi
  const minWater = ceilings.min_water_ml
  const maxPotassium = ceilings.max_potassium_mg
  const avoidOxalate = ceilings.avoid_oxalate
  const purineLevel = ceilings.purine_level
  const conflictParts: string[] = []
  let hasConflict = (extraction.diseases || profile.conditions || []).length > 1
  const planStatus: PlanStatus = 'PENDING_EXPERT_REVIEW'

  if (condStr.includes('sỏi') || condStr.includes('stone') || condStr.includes('oxalate')) {
    conflictParts.push('Sỏi Thận (EAU/AUA): Bài niệu > 2.5L/ngày, Natri < 1500mg, kiêng Oxalate.')
  }
  if (condStr.includes('ckd') || condStr.includes('suy thận') || condStr.includes('thận mạn')) {
    hasConflict = true
    conflictParts.push('Suy thận CKD (KDIGO 2024): Siết đạm 0.6g/kg, giới hạn Kali và Natri. Cần Bác sĩ HITL duyệt.')
  }
  if (condStr.includes('gout') || condStr.includes('gút') || condStr.includes('uric')) {
    conflictParts.push('Gout / Acid Uric (ACR): Purine thấp (< 150mg), uống đủ nước.')
  }
  if (condStr.includes('dạ dày') || condStr.includes('gerd') || condStr.includes('hang vị') || condStr.includes('loét')) {
    conflictParts.push('Dạ dày / GERD (ACG): Thức ăn mềm, tránh chua cay, dầu mỡ.')
  }
  if (condStr.includes('gan') || condStr.includes('men gan') || condStr.includes('liver') || condStr.includes('nhiễm mỡ') || condStr.includes('xơ gan')) {
    conflictParts.push('Gan & Chuyển hóa Mỡ (EASL): Đạm dễ tiêu, kiêng tuyệt đối cồn.')
  }
  if (condStr.includes('đái tháo đường') || condStr.includes('tiểu đường') || condStr.includes('hba1c')) {
    conflictParts.push('Đái tháo đường (ADA 2024): Khống chế GI ≤ 50.')
  }

  // Multi-morbidity or Warfarin checks
  const hasWarfarin = (profile.medications || []).some((m: string) => /warfarin|coumadin/i.test(m)) ||
    (extraction.medications || []).some((m: any) => /warfarin|coumadin/i.test(m.name) || /warfarin/i.test(m.activeIngredient || ''))
  if (hasWarfarin) {
    hasConflict = true
    conflictParts.push('Thuốc chống đông Warfarin: Giữ mức biến thiên Vitamin K ổn định.')
  }
  const conflictDetails = conflictParts.join(' | ')

  // 2. Select disease-specific clinical dishes (Full 7-day rich variety with ZERO repeated dishes)
  let days: Record<string, Item[]>[] = []

  if (avoidOxalate || condStr.includes('sỏi')) {
    // Sỏi thận & Tiết niệu: 7 ngày phong phú, bài niệu, kiêng tuyệt đối oxalate, kiểm soát natri, không lặp món
    days = [
      {
        'Bữa sáng': [
          { foodId: 'F019', grams: 200, foodName: 'Cháo yến mạch đậu đỏ', note: 'Nhiều chất xơ hòa tan, an toàn tiết niệu' },
          { foodId: 'F023', grams: 150, foodName: 'Sữa hạt sen ít đường', note: 'Canxi thực vật vừa đủ, không lắng cặn' }
        ],
        'Bữa trưa': [
          { foodId: 'F001', grams: 160, foodName: 'Cơm gạo lứt huyết rồng', note: 'Tinh bột chuyển hóa chậm' },
          { foodId: 'F021', grams: 220, foodName: 'Canh bí đao nấu tép tươi', note: 'Lợi tiểu bài xuất sỏi, ít natri' },
          { foodId: 'F007', grams: 110, foodName: 'Cá hồi áp chảo dầu oliu', note: 'Đạm trắng giá trị sinh học cao' },
          { foodId: 'F010', grams: 150, foodName: 'Bí xanh hấp chấm mè', note: 'Kiềm hóa nước tiểu' }
        ],
        'Bữa tối': [
          { foodId: 'F002', grams: 150, foodName: 'Khoai lang mật luộc', note: 'Nguồn carb nhuận tràng' },
          { foodId: 'F004', grams: 100, foodName: 'Ức gà hấp sả gừng', note: 'Đạm nạc tinh khiết, ít purine' },
          { foodId: 'F021', grams: 180, foodName: 'Canh mồng tơi cua đồng (nấu nhạt)', note: 'Giải độc bàng quang' }
        ],
        'Bữa phụ': [
          { foodId: 'F013', grams: 120, foodName: 'Táo ta gọt vỏ', note: 'Ít oxalate, bổ sung vitamin C tự nhiên' },
          { foodId: 'F_WATER', grams: 350, foodName: 'Nước râu ngô - bông mã đề', note: 'Lợi tiểu tự nhiên, hỗ trợ tống sỏi đài bể thận' }
        ]
      },
      {
        'Bữa sáng': [
          { foodId: 'F022', grams: 200, foodName: 'Phở gạo lứt ức gà xé nước dùng thanh', note: 'Nước dùng ninh xương lọc váng dầu, ít muối' },
          { foodId: 'F023', grams: 200, foodName: 'Nước dừa xiêm tươi', note: 'Bổ sung điện giải tự nhiên, bào mòn tinh thể sỏi' }
        ],
        'Bữa trưa': [
          { foodId: 'F001', grams: 160, foodName: 'Cơm gạo tẻ thơm', note: 'Dễ hấp thu, sạch oxalate' },
          { foodId: 'F024', grams: 220, foodName: 'Canh bầu nấu tôm nõn giã dập', note: 'Thanh nhiệt, lợi niệu mạnh' },
          { foodId: 'F025', grams: 120, foodName: 'Cá thu sốt cà chua ít muối', note: 'Omega-3 bảo vệ nội mạc cầu thận' },
          { foodId: 'F026', grams: 140, foodName: 'Bông cải xanh hấp chín tới', note: 'Chất chống oxy hóa tế bào biểu mô thận' }
        ],
        'Bữa tối': [
          { foodId: 'F027', grams: 150, foodName: 'Cơm gạo lứt đỏ', note: 'Nhiều vitamin nhóm B' },
          { foodId: 'F028', grams: 120, foodName: 'Đậu phụ nhồi thịt nạc hấp nấm hương', note: 'Đạm thanh nhẹ không quá tải thận' },
          { foodId: 'F029', grams: 200, foodName: 'Canh bắp cải trắng nấu thịt băm', note: 'Ít oxalate, kiềm hóa nhẹ nước tiểu' }
        ],
        'Bữa phụ': [
          { foodId: 'F030', grams: 130, foodName: 'Quả lê ngọt gọt vỏ', note: 'Giàu nước tự nhiên, mát gan bổ thận' },
          { foodId: 'F031', grams: 100, foodName: 'Sữa chua men sống ít đường', note: 'Bổ sung lợi khuẩn đường tiêu hóa' }
        ]
      },
      {
        'Bữa sáng': [
          { foodId: 'F032', grams: 180, foodName: 'Bánh cuốn gạo lứt nhân nấm mộc nhĩ', note: 'Không dùng hành phi dầu mỡ' },
          { foodId: 'F033', grams: 250, foodName: 'Nước ép dưa hấu tươi mát', note: 'Hàm lượng nước cao, kích thích bài tiết sỏi thận' }
        ],
        'Bữa trưa': [
          { foodId: 'F001', grams: 150, foodName: 'Cơm gạo lứt tím than', note: 'Anthocyanin chống viêm đường tiết niệu' },
          { foodId: 'F034', grams: 130, foodName: 'Cá quả hấp thì là hành hoa', note: 'Đạm sinh học cao, nhanh lành tổn thương đài thận' },
          { foodId: 'F035', grams: 200, foodName: 'Canh cải xoong nấu thịt nạc dăm', note: 'Lọc máu, thanh lọc tạp chất niệu đạo' },
          { foodId: 'F036', grams: 140, foodName: 'Su hào luộc chấm kho quẹt nhạt', note: 'Chất xơ tự nhiên hỗ trợ tiêu hóa' }
        ],
        'Bữa tối': [
          { foodId: 'F037', grams: 180, foodName: 'Bún gạo lứt trộn ức gà xé rau mầm', note: 'Bữa tối nhẹ nhàng, không gây đầy bụng' },
          { foodId: 'F038', grams: 200, foodName: 'Canh mướp hương nấu tôm khô', note: 'Hương thơm tự nhiên, lợi tiểu đêm' }
        ],
        'Bữa phụ': [
          { foodId: 'F039', grams: 120, foodName: 'Ổi sẻ gọt vỏ bỏ hạt', note: 'Vitamin C tự nhiên liều vừa phải an toàn' },
          { foodId: 'F040', grams: 250, foodName: 'Trà atiso túi lọc ấm', note: 'Thông mật, mát gan, tăng bài niệu' }
        ]
      },
      {
        'Bữa sáng': [
          { foodId: 'F041', grams: 200, foodName: 'Cháo sườn heo ngô ngọt nấu loãng', note: 'Bổ sung năng lượng êm dịu dạ dày' },
          { foodId: 'F042', grams: 200, foodName: 'Nước ép táo ta và cà rốt tươi', note: 'Bảo vệ niêm mạc thận' }
        ],
        'Bữa trưa': [
          { foodId: 'F001', grams: 160, foodName: 'Cơm gạo tám thơm', note: 'Năng lượng chuẩn bữa trưa' },
          { foodId: 'F043', grams: 120, foodName: 'Thịt thăn lợn rim nghệ nhạt', note: 'Curcumin kháng viêm niêm mạc đài bể thận' },
          { foodId: 'F044', grams: 200, foodName: 'Canh bí đỏ hầm đậu xanh thanh mát', note: 'Giải nhiệt tiêu thũng' },
          { foodId: 'F045', grams: 120, foodName: 'Đậu que xào nấm rơm dầu mè', note: 'Chất xơ không gây tăng oxalate' }
        ],
        'Bữa tối': [
          { foodId: 'F046', grams: 180, foodName: 'Miến dong xào ức gà rau củ thập cẩm', note: 'Không chứa gluten, nhẹ thận' },
          { foodId: 'F047', grams: 200, foodName: 'Canh cải xanh nấu gừng nhạt', note: 'Ấm bụng, thông tiểu' }
        ],
        'Bữa phụ': [
          { foodId: 'F048', grams: 100, foodName: 'Chuối ngự chín tới', note: 'Magie tự nhiên cạnh tranh gắn kết với Canxi' },
          { foodId: 'F049', grams: 300, foodName: 'Nước chanh leo pha loãng mật ong', note: 'Citrate tự nhiên hòa tan tinh thể Calci Oxalate' }
        ]
      },
      {
        'Bữa sáng': [
          { foodId: 'F050', grams: 200, foodName: 'Cháo hạt sen bí đỏ mềm mịn', note: 'An thần, bổ khí huyết' },
          { foodId: 'F051', grams: 180, foodName: 'Sữa đậu nành không đường ấm', note: 'Đạm thực vật tinh khiết' }
        ],
        'Bữa trưa': [
          { foodId: 'F001', grams: 150, foodName: 'Cơm ngũ cốc hạt diêm mạch Quinoa', note: 'Canxi thực vật vừa đủ, không oxalate' },
          { foodId: 'F052', grams: 220, foodName: 'Canh chua cá diêu hồng nấu dọc mùng và dứa', note: 'Axit citric trong dứa giúp bào mòn sỏi' },
          { foodId: 'F053', grams: 110, foodName: 'Thịt nạc vai luộc thái mỏng', note: 'Protein dễ tiêu hóa' },
          { foodId: 'F054', grams: 140, foodName: 'Rau lang luộc chấm nước tương nhạt', note: 'Nhuận tràng, giải độc thận' }
        ],
        'Bữa tối': [
          { foodId: 'F055', grams: 180, foodName: 'Khoai tây hầm thịt bò nạc ít muối', note: 'Cung cấp sắt và kali an toàn' },
          { foodId: 'F056', grams: 200, foodName: 'Canh rau ngót nấu giò sống', note: 'Lợi tiểu thanh mát' },
          { foodId: 'F002', grams: 120, foodName: 'Khoai sọ hấp rắc mè rang', note: 'Carb phức ổn định, nhuận tràng' }
        ],
        'Bữa phụ': [
          { foodId: 'F057', grams: 140, foodName: 'Thanh long ruột trắng', note: 'Giàu nước và chất xơ hạt tự nhiên' },
          { foodId: 'F058', grams: 300, foodName: 'Nước râu mèo đun bông mã đề', note: 'Dược liệu lợi tiểu truyền thống đẩy sỏi' }
        ]
      },
      {
        'Bữa sáng': [
          { foodId: 'F059', grams: 200, foodName: 'Hủ tiếu gạo lứt giò nạc nước trong', note: 'Sợi hủ tiếu thanh lành dễ nuốt' },
          { foodId: 'F060', grams: 200, foodName: 'Nước cam tươi pha loãng không đường', note: 'Citrate tự nhiên chống kết tụ tinh thể' }
        ],
        'Bữa trưa': [
          { foodId: 'F001', grams: 160, foodName: 'Cơm gạo mầm GABA Điện Biên', note: 'No lâu, giải phóng chậm' },
          { foodId: 'F061', grams: 150, foodName: 'Canh khổ qua nhồi thịt nạc hấp', note: 'Thanh nhiệt giải độc gan thận' },
          { foodId: 'F062', grams: 120, foodName: 'Cá ba sa kho nghệ ít muối', note: 'Axit béo tốt cho thành mạch máu thận' },
          { foodId: 'F063', grams: 130, foodName: 'Giá đỗ xào hành hoa', note: 'Vitamin E và nước thực vật' }
        ],
        'Bữa tối': [
          { foodId: 'F064', grams: 150, foodName: 'Cơm mềm nấu dẻo', note: 'Nhẹ bụng buổi tối' },
          { foodId: 'F065', grams: 120, foodName: 'Tôm sú hấp sả', note: 'Đạm nạc giàu canxi hữu cơ dễ hấp thu' },
          { foodId: 'F066', grams: 200, foodName: 'Canh mướp đắng nấu sườn non', note: 'Hạ mỡ máu, bài tiết niệu' },
          { foodId: 'F067', grams: 120, foodName: 'Dưa chuột bao tử', note: 'Nước thanh lọc bù khoáng' }
        ],
        'Bữa phụ': [
          { foodId: 'F068', grams: 140, foodName: 'Đu đủ chín vàng ngọt', note: 'Enzym papain hỗ trợ tiêu hóa đạm' },
          { foodId: 'F069', grams: 300, foodName: 'Nước đậu đen xanh lòng rang nấu loãng', note: 'Bổ thận thủy, thanh nhiệt bài độc' }
        ]
      },
      {
        'Bữa sáng': [
          { foodId: 'F070', grams: 200, foodName: 'Súp gà nấm tuyết ngô non', note: 'Đậm đà dưỡng chất, phục hồi thể trạng' },
          { foodId: 'F071', grams: 250, foodName: 'Nước dừa tươi ngọt thanh', note: 'Cân bằng điện giải tự nhiên' }
        ],
        'Bữa trưa': [
          { foodId: 'F001', grams: 160, foodName: 'Cơm gạo nếp than Tây Bắc', note: 'Tăng cường đề kháng, chống oxy hóa niệu quản' },
          { foodId: 'F072', grams: 220, foodName: 'Canh cua mồng tơi rau đay mướp hương', note: 'Mát ruột, hỗ trợ bài sỏi niệu' },
          { foodId: 'F073', grams: 120, foodName: 'Chả cá thác lác hấp thì là', note: 'Đạm trắng không gây cặn sỏi' },
          { foodId: 'F074', grams: 140, foodName: 'Cải ngọt luộc', note: 'Rau xanh an toàn mức oxalate cực thấp' }
        ],
        'Bữa tối': [
          { foodId: 'F075', grams: 150, foodName: 'Cơm gạo dẻo', note: 'Năng lượng êm dịu' },
          { foodId: 'F076', grams: 120, foodName: 'Trứng gà ta đúc thịt nạc hấp', note: 'Món ăn gia đình dễ tiêu' },
          { foodId: 'F077', grams: 200, foodName: 'Canh súp lơ cà rốt nấu sườn non', note: 'Bổ sung khoáng vi lượng' }
        ],
        'Bữa phụ': [
          { foodId: 'F078', grams: 130, foodName: 'Quả bưởi da xanh tép mọng', note: 'Giàu naringenin và vitamin C' },
          { foodId: 'F079', grams: 300, foodName: 'Nước ép dưa chuột bạc hà tươi', note: 'Bù nước tối đa cho hệ bài tiết' }
        ]
      }
    ]
  } else if (purineLevel || condStr.includes('gout') || condStr.includes('gút') || condStr.includes('uric')) {
    // Gout / Tăng Acid Uric: 7 ngày kiểm soát Purine thấp, kiềm hóa nước tiểu, không lặp món
    days = [
      {
        'Bữa sáng': [
          { foodId: 'F019', grams: 200, foodName: 'Cháo hạt sen yến mạch', note: 'Không chứa purine, nhẹ bụng' },
          { foodId: 'F013', grams: 150, foodName: 'Sữa tươi ít béo', note: 'Casein và lactalbumin hạ acid uric' }
        ],
        'Bữa trưa': [
          { foodId: 'F001', grams: 160, foodName: 'Cơm gạo tẻ trắng', note: 'An toàn purine tuyệt đối' },
          { foodId: 'F017', grams: 150, foodName: 'Đậu phụ sốt cà chua ít dầu', note: 'Đạm thực vật không gây viêm khớp' },
          { foodId: 'F021', grams: 200, foodName: 'Canh rau ngót nấu thịt nạc ít', note: 'Thanh nhiệt giải độc khớp' }
        ],
        'Bữa tối': [
          { foodId: 'F002', grams: 150, foodName: 'Khoai tây nghiền', note: 'Kiềm hóa nước tiểu mạnh' },
          { foodId: 'F015', grams: 100, foodName: 'Trứng gà ta luộc (2 quả)', note: 'Nguồn đạm 0 purine' },
          { foodId: 'F010', grams: 180, foodName: 'Dưa chuột thái lát chấm mè', note: 'Cung cấp nước tự nhiên' }
        ],
        'Bữa phụ': [
          { foodId: 'F013', grams: 120, foodName: 'Chuối tiêu chín', note: 'Kali kiềm hóa nước tiểu, thải trừ acid uric' }
        ]
      },
      {
        'Bữa sáng': [
          { foodId: 'F080', grams: 200, foodName: 'Bún mọc thịt nạc thanh đạm', note: 'Không ninh xương tủy, ít purine' },
          { foodId: 'F081', grams: 200, foodName: 'Nước ép dứa tươi', note: 'Enzym bromelain kháng viêm khớp gút tự nhiên' }
        ],
        'Bữa trưa': [
          { foodId: 'F001', grams: 160, foodName: 'Cơm gạo lứt', note: 'Chất xơ hạn chế tái hấp thu urat' },
          { foodId: 'F082', grams: 120, foodName: 'Cá trắm giòn hấp gừng sả', note: 'Cá sông nước ngọt lượng purine vừa phải' },
          { foodId: 'F083', grams: 200, foodName: 'Canh bầu nấu tép khô', note: 'Lợi niệu thông khớp' },
          { foodId: 'F084', grams: 130, foodName: 'Bí đỏ hấp chín', note: 'Giàu beta-carotene' }
        ],
        'Bữa tối': [
          { foodId: 'F085', grams: 150, foodName: 'Cơm mềm nấu dẻo', note: 'Năng lượng sạch' },
          { foodId: 'F086', grams: 110, foodName: 'Trứng chiên hành hoa ít dầu oliu', note: 'Không chứa purine' },
          { foodId: 'F087', grams: 200, foodName: 'Canh bắp cải trắng nấu nạc băm', note: 'Rau họ cải kiềm hóa nước tiểu' }
        ],
        'Bữa phụ': [
          { foodId: 'F088', grams: 130, foodName: 'Quả lê ngọt gọt vỏ', note: 'Giàu nước thanh lọc máu' },
          { foodId: 'F089', grams: 100, foodName: 'Sữa chua không đường', note: 'Hạ nhẹ acid uric máu' }
        ]
      },
      {
        'Bữa sáng': [
          { foodId: 'F090', grams: 200, foodName: 'Cháo đậu xanh ngô ngọt', note: 'Thanh lọc nhiệt độc' },
          { foodId: 'F091', grams: 150, foodName: 'Sữa hạt điều nguyên chất', note: 'Chất béo lành mạnh' }
        ],
        'Bữa trưa': [
          { foodId: 'F001', grams: 160, foodName: 'Cơm gạo tám thơm', note: 'Carb lành mạnh' },
          { foodId: 'F092', grams: 130, foodName: 'Đậu phụ nhồi thịt nạc hấp', note: 'Đạm cân đối, ít acid uric' },
          { foodId: 'F093', grams: 200, foodName: 'Canh su hào cà rốt nấu sườn nạc ít', note: 'Vitamin tổng hợp tự nhiên' }
        ],
        'Bữa tối': [
          { foodId: 'F094', grams: 180, foodName: 'Bún gạo lứt xào rau củ thanh đạm', note: 'Giàu chất xơ' },
          { foodId: 'F095', grams: 200, foodName: 'Canh mướp hương nấu nấm rơm', note: 'Nhuận tràng lợi niệu' }
        ],
        'Bữa phụ': [
          { foodId: 'F096', grams: 120, foodName: 'Táo xanh giòn', note: 'Axit malic trung hòa acid uric' },
          { foodId: 'F097', grams: 250, foodName: 'Nước chanh tươi pha loãng mật ong', note: 'Kiềm hóa chuyển hóa tự nhiên' }
        ]
      },
      {
        'Bữa sáng': [
          { foodId: 'F098', grams: 200, foodName: 'Phở chay nấm đậu hũ non', note: '0 purine độc hại' },
          { foodId: 'F099', grams: 250, foodName: 'Nước dừa xiêm ngọt mát', note: 'Bù nước tối đa cho ổ khớp' }
        ],
        'Bữa trưa': [
          { foodId: 'F001', grams: 160, foodName: 'Cơm gạo lứt huyết rồng', note: 'Chống oxy hóa khớp' },
          { foodId: 'F100', grams: 110, foodName: 'Ức gà luộc xé chấm muối tiêu chanh nhạt', note: 'Đạm trắng an toàn cho bệnh gút' },
          { foodId: 'F101', grams: 200, foodName: 'Canh bí xanh nấu tôm nõn ít', note: 'Lợi niệu bài xuất urat' },
          { foodId: 'F102', grams: 130, foodName: 'Su su luộc chấm muối vừng', note: 'Chất xơ mềm' }
        ],
        'Bữa tối': [
          { foodId: 'F103', grams: 180, foodName: 'Miến dong nấu nạc băm rau cải cúc', note: 'Nhẹ gánh thận ban đêm' },
          { foodId: 'F104', grams: 120, foodName: 'Đậu que luộc', note: 'An toàn purine' }
        ],
        'Bữa phụ': [
          { foodId: 'F105', grams: 130, foodName: 'Quả dưa lê thơm', note: 'Cung cấp nước' },
          { foodId: 'F106', grams: 300, foodName: 'Nước râu ngô đun râu mèo', note: 'Tống xuất tinh thể tophi' }
        ]
      },
      {
        'Bữa sáng': [
          { foodId: 'F107', grams: 200, foodName: 'Bánh canh gạo nạc heo băm thanh nhạt', note: 'Dễ tiêu hóa' },
          { foodId: 'F108', grams: 200, foodName: 'Nước cam ép tươi nguyên chất', note: 'Vitamin C giảm acid uric máu' }
        ],
        'Bữa trưa': [
          { foodId: 'F001', grams: 160, foodName: 'Cơm trắng gạo dẻo', note: 'Thức ăn chuẩn' },
          { foodId: 'F109', grams: 120, foodName: 'Cá quả kho tộ nhạt củ nghệ', note: 'Nghệ tiêu viêm khớp' },
          { foodId: 'F110', grams: 200, foodName: 'Canh mồng tơi nấu mướp hương', note: 'Mát gan giải nhiệt' }
        ],
        'Bữa tối': [
          { foodId: 'F111', grams: 150, foodName: 'Khoai lang luộc', note: 'Carb nhuận trường' },
          { foodId: 'F112', grams: 130, foodName: 'Đậu phụ luộc chấm tương hạt', note: 'Đạm không purine' },
          { foodId: 'F113', grams: 200, foodName: 'Canh cải ngọt nấu thịt nạc ít', note: 'Giải độc niệu' }
        ],
        'Bữa phụ': [
          { foodId: 'F114', grams: 140, foodName: 'Đu đủ chín vàng ngọt lịm', note: 'Chống viêm khớp' },
          { foodId: 'F115', grams: 100, foodName: 'Sữa chua men sống', note: 'Cải thiện chuyển hóa đường ruột' }
        ]
      },
      {
        'Bữa sáng': [
          { foodId: 'F116', grams: 200, foodName: 'Cháo cá hồi bí đỏ thanh đạm', note: 'Omega-3 ức chế viêm khớp gút' },
          { foodId: 'F117', grams: 180, foodName: 'Sữa đậu nành ấm ít đường', note: 'Đạm thực vật tinh khiết' }
        ],
        'Bữa trưa': [
          { foodId: 'F001', grams: 160, foodName: 'Cơm hạt kê ngũ sắc nấu mềm', note: 'Năng lượng giải phóng chậm, kiềm hóa nhẹ' },
          { foodId: 'F118', grams: 120, foodName: 'Thịt thăn lợn ram gừng nhạt', note: 'Gừng giữ ấm tỳ vị' },
          { foodId: 'F119', grams: 200, foodName: 'Canh rau đay nấu cua đồng ít muối', note: 'Thanh nhiệt giải độc' }
        ],
        'Bữa tối': [
          { foodId: 'F120', grams: 150, foodName: 'Cơm gạo Séng Cù dẻo thơm', note: 'Dễ tiêu hóa, hỗ trợ giấc ngủ' },
          { foodId: 'F121', grams: 110, foodName: 'Trứng cuộn rau củ thái hạt lựu', note: 'Món ăn thanh đạm' },
          { foodId: 'F122', grams: 200, foodName: 'Canh mướp đắng nấu nạc dăm', note: 'Kháng viêm' }
        ],
        'Bữa phụ': [
          { foodId: 'F123', grams: 140, foodName: 'Quả bưởi năm roi tép ngọt mát', note: 'Giàu kali và nước' }
        ]
      },
      {
        'Bữa sáng': [
          { foodId: 'F124', grams: 200, foodName: 'Súp ngô non đậu hũ non hạt sen', note: 'Thanh lọc kinh mạch' },
          { foodId: 'F125', grams: 200, foodName: 'Nước ép cà rốt táo tươi', note: 'Chống oxy hóa' }
        ],
        'Bữa trưa': [
          { foodId: 'F001', grams: 160, foodName: 'Cơm gạo lứt tím than Sóc Trăng', note: 'Năng lượng trọn vẹn, chống oxy hóa khớp' },
          { foodId: 'F126', grams: 120, foodName: 'Tôm rim nước dừa nhạt', note: 'Đạm sạch vừa đủ' },
          { foodId: 'F127', grams: 200, foodName: 'Canh cải xoong nấu thịt nạc', note: 'Lọc máu tối ưu' }
        ],
        'Bữa tối': [
          { foodId: 'F128', grams: 150, foodName: 'Cơm trắng', note: 'Thanh cảnh buổi tối' },
          { foodId: 'F129', grams: 120, foodName: 'Chả cá thác lác hấp thì là', note: 'Đạm trắng lành tính' },
          { foodId: 'F130', grams: 200, foodName: 'Canh súp lơ xanh nấu nạc ít muối', note: 'Tăng kiềm nước tiểu' }
        ],
        'Bữa phụ': [
          { foodId: 'F131', grams: 140, foodName: 'Quả thanh long ruột đỏ', note: 'Bổ sung chất chống oxy hóa' },
          { foodId: 'F132', grams: 300, foodName: 'Nước lọc ion kiềm ấm', note: 'Tăng đào thải acid uric' }
        ]
      }
    ]
  } else if (condStr.includes('dạ dày') || condStr.includes('gerd') || condStr.includes('hang vị')) {
    // Dạ dày & GERD: 7 ngày món mềm, kiềm hóa nhẹ, không cay chua, không lặp món
    days = [
      {
        'Bữa sáng': [
          { foodId: 'F019', grams: 220, foodName: 'Cháo hoa thịt băm bí đỏ mềm', note: 'Bọc niêm mạc dạ dày êm dịu' },
          { foodId: 'F024', grams: 150, foodName: 'Sữa đậu nành ấm', note: 'Trung hòa acid dịch vị ban sáng' }
        ],
        'Bữa trưa': [
          { foodId: 'F001', grams: 150, foodName: 'Cơm mềm nấu dẻo', note: 'Dễ tiêu hóa, không trầy xước niêm mạc' },
          { foodId: 'F004', grams: 100, foodName: 'Ức gà hầm bí đỏ', note: 'Mềm nhừ, giàu kẽm phục hồi ổ loét' },
          { foodId: 'F021', grams: 180, foodName: 'Canh mướp hương nấu nấm', note: 'Thanh dịu, không sinh hơi' }
        ],
        'Bữa tối': [
          { foodId: 'F002', grams: 150, foodName: 'Súp khoai tây cà rốt nghiền', note: 'Bọc niêm mạc hang vị' },
          { foodId: 'F020', grams: 100, foodName: 'Cá lóc hấp thì là gừng', note: 'Đạm lành tính chống trào ngược' }
        ],
        'Bữa phụ': [
          { foodId: 'F013', grams: 120, foodName: 'Bánh mì sandwich mềm', note: 'Thấm hút acid dạ dày dư thừa' }
        ]
      },
      {
        'Bữa sáng': [
          { foodId: 'F133', grams: 220, foodName: 'Cháo hạt sen yến mạch loãng', note: 'Chất nhầy tự nhiên bảo vệ vết loét' },
          { foodId: 'F134', grams: 150, foodName: 'Sữa tươi ấm tiệt trùng', note: 'Cắt cơn cồn cào rát dạ dày' }
        ],
        'Bữa trưa': [
          { foodId: 'F135', grams: 150, foodName: 'Cơm dẻo thơm mềm', note: 'Không khô cứng' },
          { foodId: 'F136', grams: 110, foodName: 'Thịt nạc vai hấp nấm hương mộc nhĩ', note: 'Đạm mềm dễ hấp thu' },
          { foodId: 'F137', grams: 180, foodName: 'Canh bí xanh nấu tôm băm mềm', note: 'Mát ruột, không kích ứng' }
        ],
        'Bữa tối': [
          { foodId: 'F138', grams: 200, foodName: 'Cháo cá chép đậu xanh hạt sen', note: 'Bổ tỳ vị, an thần chống mất ngủ' },
          { foodId: 'F139', grams: 100, foodName: 'Bí đỏ hấp chín mềm', note: 'Giàu carotenoid làm lành tổn thương' }
        ],
        'Bữa phụ': [
          { foodId: 'F140', grams: 120, foodName: 'Chuối già luộc chín mềm', note: 'Không còn vị chát, bảo vệ dạ dày' }
        ]
      },
      {
        'Bữa sáng': [
          { foodId: 'F141', grams: 200, foodName: 'Súp gà ngô non nấm tuyết', note: 'Đậm đà dễ nuốt' },
          { foodId: 'F142', grams: 150, foodName: 'Sữa yến mạch ấm', note: 'Giảm trào ngược acid dịch vị' }
        ],
        'Bữa trưa': [
          { foodId: 'F143', grams: 150, foodName: 'Cơm mềm nấu nước dùng gà', note: 'Năng lượng êm bụng' },
          { foodId: 'F144', grams: 110, foodName: 'Tôm sú bóc vỏ hấp sả', note: 'Đạm nạc không dầu mỡ' },
          { foodId: 'F145', grams: 180, foodName: 'Canh bầu nấu tép tươi nhạt', note: 'Lợi tiêu hóa' }
        ],
        'Bữa tối': [
          { foodId: 'F146', grams: 150, foodName: 'Khoai lang hấp mềm', note: 'Chất xơ mịn không cọ xát thành dạ dày' },
          { foodId: 'F147', grams: 100, foodName: 'Thịt thăn heo luộc thái lát mỏng', note: 'Đạm nạc thanh đạm' },
          { foodId: 'F148', grams: 180, foodName: 'Canh rau ngót nấu giò nhạt', note: 'Thanh mát' }
        ],
        'Bữa phụ': [
          { foodId: 'F149', grams: 50, foodName: 'Bánh quy giòn nhạt (Crackers)', note: 'Hút dịch vị acid trước khi ngủ' }
        ]
      },
      {
        'Bữa sáng': [
          { foodId: 'F150', grams: 200, foodName: 'Cháo lòng đỏ trứng gà tía tô gừng', note: 'Gừng làm ấm tỳ vị, giảm buồn nôn' },
          { foodId: 'F151', grams: 150, foodName: 'Nước gạo lứt rang ấm', note: 'Thanh lọc dịu êm' }
        ],
        'Bữa trưa': [
          { foodId: 'F152', grams: 150, foodName: 'Cơm mềm dẻo', note: 'Không tạo áp lực lên cơ vòng thực quản' },
          { foodId: 'F153', grams: 110, foodName: 'Cá hồi áp chảo dầu oliu ít tiêu', note: 'Omega-3 phục hồi ổ trợt hang vị' },
          { foodId: 'F154', grams: 180, foodName: 'Canh bí đỏ nấu nạc băm', note: 'Bọc lớp niêm mạc mỏng' }
        ],
        'Bữa tối': [
          { foodId: 'F155', grams: 200, foodName: 'Cháo thịt băm cà rốt mềm', note: 'Nấu nhừ nhuyễn' },
          { foodId: 'F156', grams: 100, foodName: 'Trứng hấp vân mây', note: 'Mềm xốp dễ tiêu' }
        ],
        'Bữa phụ': [
          { foodId: 'F157', grams: 100, foodName: 'Sữa chua men sống không đường', note: 'Cân bằng hệ vi sinh dạ dày - ruột' }
        ]
      },
      {
        'Bữa sáng': [
          { foodId: 'F158', grams: 200, foodName: 'Bánh canh bột gạo nạc băm mềm', note: 'Sợi bánh canh mềm không gây kích ứng' },
          { foodId: 'F159', grams: 150, foodName: 'Nước mật ong ấm pha tinh bột nghệ', note: 'Curcumin làm lành sẹo ổ loét' }
        ],
        'Bữa trưa': [
          { foodId: 'F160', grams: 150, foodName: 'Cơm dẻo', note: 'Ăn chậm nhai kỹ' },
          { foodId: 'F161', grams: 110, foodName: 'Ức gà xé phay hấp lá chanh', note: 'Đạm không da, ít béo' },
          { foodId: 'F162', grams: 180, foodName: 'Canh mồng tơi nấu tôm khô', note: 'Chất nhầy tự nhiên bôi trơn thực quản' }
        ],
        'Bữa tối': [
          { foodId: 'F163', grams: 200, foodName: 'Súp bí đỏ kem sữa thực vật', note: 'Giàu dưỡng chất' },
          { foodId: 'F164', grams: 100, foodName: 'Đậu hũ non sốt nấm rơm', note: 'Mềm mượt' }
        ],
        'Bữa phụ': [
          { foodId: 'F165', grams: 130, foodName: 'Quả đu đủ chín mềm', note: 'Enzym hỗ trợ tiêu hóa' }
        ]
      },
      {
        'Bữa sáng': [
          { foodId: 'F166', grams: 200, foodName: 'Cháo đậu xanh thịt nạc giã mịn', note: 'Thanh nhiệt giải độc' },
          { foodId: 'F167', grams: 150, foodName: 'Sữa hạt sen ấm', note: 'An thần bổ dưỡng' }
        ],
        'Bữa trưa': [
          { foodId: 'F168', grams: 150, foodName: 'Cơm mềm', note: 'Carb chuẩn' },
          { foodId: 'F169', grams: 110, foodName: 'Chả cá thác lác hấp nấm mèo', note: 'Không dầu mỡ chiên rán' },
          { foodId: 'F170', grams: 180, foodName: 'Canh su su hầm sườn nạc', note: 'Nước canh trong, thanh ngọt' }
        ],
        'Bữa tối': [
          { foodId: 'F171', grams: 180, foodName: 'Miến dong nấu nạc băm thanh nhẹ', note: 'Sợi miến dai mềm' },
          { foodId: 'F172', grams: 120, foodName: 'Bí ngô hấp mật mía nhạt', note: 'Bảo vệ thành hang vị' }
        ],
        'Bữa phụ': [
          { foodId: 'F173', grams: 120, foodName: 'Táo ta gọt vỏ hấp cách thủy', note: 'Táo mềm ngọt, bảo vệ dạ dày' }
        ]
      },
      {
        'Bữa sáng': [
          { foodId: 'F174', grams: 200, foodName: 'Súp khoai môn thịt nạc băm', note: 'Khoai môn dẻo bùi bọc niêm mạc' },
          { foodId: 'F175', grams: 150, foodName: 'Sữa đậu nành ấm ít đường', note: 'Giàu protein thực vật' }
        ],
        'Bữa trưa': [
          { foodId: 'F176', grams: 150, foodName: 'Cơm hạt sen nấu mềm êm dịu dạ dày', note: 'An thần, trung hòa acid dạ dày' },
          { foodId: 'F177', grams: 110, foodName: 'Đậu phụ hấp thịt băm nấm hương', note: 'Thanh đạm' },
          { foodId: 'F178', grams: 180, foodName: 'Canh bắp cải trắng hầm nhừ', note: 'Vitamin U chống loét dạ dày' }
        ],
        'Bữa tối': [
          { foodId: 'F179', grams: 200, foodName: 'Cháo cá quả thì là gừng tươi', note: 'Ấm bụng, giảm co thắt hang vị' },
          { foodId: 'F180', grams: 100, foodName: 'Khoai tây luộc nghiền nhuyễn', note: 'Kiềm hóa acid thừa' }
        ],
        'Bữa phụ': [
          { foodId: 'F181', grams: 60, foodName: 'Bánh mì gối mềm nướng nhẹ', note: 'Hút dịch vị acid trước giờ ngủ' }
        ]
      }
    ]
  } else if (condStr.includes('gan') || condStr.includes('men gan') || condStr.includes('liver') || condStr.includes('nhiễm mỡ') || condStr.includes('xơ gan')) {
    // Bệnh lý Gan & Rối loạn chuyển hóa mỡ (EASL 2024): 7 ngày món bảo vệ tế bào gan, đạm trắng dễ tiêu, giàu chất chống oxy hóa, kiêng cồn tuyệt đối, không lặp món
    days = [
      {
        'Bữa sáng': [
          { foodId: 'F231', grams: 200, foodName: 'Cháo gạo lứt đậu phụ non cà rốt', note: 'Đạm thực vật tinh khiết, beta-carotene phục hồi tế bào gan' },
          { foodId: 'F232', grams: 180, foodName: 'Nước atiso tươi ấm', note: 'Cynarin tăng tiết mật, giải độc gan' }
        ],
        'Bữa trưa': [
          { foodId: 'F001', grams: 160, foodName: 'Cơm gạo lứt huyết rồng', note: 'Chất xơ tự nhiên ngăn cản hấp thu mỡ' },
          { foodId: 'F233', grams: 120, foodName: 'Cá quả hấp thì là hành hoa', note: 'Đạm sinh học cao, không gây ứ amoniac máu' },
          { foodId: 'F234', grams: 200, foodName: 'Canh atiso hầm giò nạc lọc váng mỡ', note: 'Hạ men gan, mát gan' },
          { foodId: 'F235', grams: 140, foodName: 'Bông cải xanh hấp chín tới', note: 'Sulforaphane tăng cường enzyme thải độc gan' }
        ],
        'Bữa tối': [
          { foodId: 'F236', grams: 150, foodName: 'Khoai lang luộc', note: 'Carb phức hợp' },
          { foodId: 'F237', grams: 110, foodName: 'Ức gà phi lê hấp sả chanh', note: 'Đạm nạc không mỡ' },
          { foodId: 'F238', grams: 180, foodName: 'Canh cải cúc nấu thịt băm nhạt', note: 'Bổ tỳ vị, mát gan' }
        ],
        'Bữa phụ': [
          { foodId: 'F239', grams: 130, foodName: 'Táo xanh gọt vỏ thái lát', note: 'Acid malic hòa tan dịch mật' },
          { foodId: 'F240', grams: 100, foodName: 'Sữa chua men sống không đường', note: 'Giảm độc tố vi khuẩn ruột lên gan' }
        ]
      },
      {
        'Bữa sáng': [
          { foodId: 'F241', grams: 200, foodName: 'Súp bí đỏ đậu hũ non hạt sen', note: 'Chống oxy hóa, an thần' },
          { foodId: 'F242', grams: 200, foodName: 'Nước ép củ dền cà rốt pha loãng', note: 'Kích thích dòng chảy dịch mật' }
        ],
        'Bữa trưa': [
          { foodId: 'F001', grams: 160, foodName: 'Cơm gạo tẻ thơm', note: 'Dễ tiêu' },
          { foodId: 'F243', grams: 120, foodName: 'Cá điêu hồng áp chảo dầu oliu ít', note: 'Chất béo không bão hòa đơn lành mạnh' },
          { foodId: 'F244', grams: 200, foodName: 'Canh mồng tơi nấu tôm nõn giã dập', note: 'Chất nhầy tự nhiên giải độc đường tiêu hóa' },
          { foodId: 'F245', grams: 130, foodName: 'Bí xanh luộc chấm mè', note: 'Thanh nhiệt cơ thể' }
        ],
        'Bữa tối': [
          { foodId: 'F246', grams: 150, foodName: 'Cơm gạo lứt đỏ', note: 'Vitamin B phức hợp' },
          { foodId: 'F247', grams: 110, foodName: 'Thịt thăn heo luộc thái mỏng', note: 'Hạn chế mỡ tối đa' },
          { foodId: 'F248', grams: 180, foodName: 'Canh bầu nấu tép tươi', note: 'Lợi mật hạ nhiệt' }
        ],
        'Bữa phụ': [
          { foodId: 'F249', grams: 120, foodName: 'Quả lê ngọt gọt vỏ', note: 'Thanh nhiệt mát gan' }
        ]
      },
      {
        'Bữa sáng': [
          { foodId: 'F250', grams: 200, foodName: 'Phở gạo lứt ức gà thanh vị', note: 'Nước dùng trong lọc sạch mỡ' },
          { foodId: 'F251', grams: 180, foodName: 'Trà hoa cúc atiso ấm', note: 'Hạ hỏa, thanh can sáng mắt' }
        ],
        'Bữa trưa': [
          { foodId: 'F001', grams: 150, foodName: 'Cơm gạo tím than', note: 'Anthocyanin kháng viêm tế bào gan' },
          { foodId: 'F252', grams: 120, foodName: 'Chả cá thác lác hấp mộc nhĩ', note: 'Đạm thanh' },
          { foodId: 'F253', grams: 200, foodName: 'Canh cải xoong nấu thịt nạc dăm', note: 'Thanh lọc máu qua tĩnh mạch cửa' },
          { foodId: 'F254', grams: 140, foodName: 'Su su luộc chấm vừng', note: 'Xơ mềm' }
        ],
        'Bữa tối': [
          { foodId: 'F255', grams: 180, foodName: 'Miến dong nấu tôm nạc băm rau ngót', note: 'Nhẹ gánh tiêu hóa ban đêm' },
          { foodId: 'F256', grams: 120, foodName: 'Đậu que luộc', note: 'Chất xơ hòa tan' }
        ],
        'Bữa phụ': [
          { foodId: 'F257', grams: 130, foodName: 'Đu đủ chín ngọt mát', note: 'Choline và vitamin C bổ gan' }
        ]
      },
      {
        'Bữa sáng': [
          { foodId: 'F258', grams: 200, foodName: 'Cháo yến mạch nấm rơm thịt băm', note: 'Giảm tích mỡ nội tạng' },
          { foodId: 'F259', grams: 150, foodName: 'Sữa đậu nành tự nấu ít đường', note: 'Lecithin chuyển hóa mỡ' }
        ],
        'Bữa trưa': [
          { foodId: 'F001', grams: 160, foodName: 'Cơm gạo dẻo', note: 'Carb sạch' },
          { foodId: 'F260', grams: 120, foodName: 'Cá hồi sốt cà chua ít muối', note: 'Omega-3 ức chế viêm gan nhiễm mỡ' },
          { foodId: 'F261', grams: 200, foodName: 'Canh bắp cải trắng nấu thịt nạc', note: 'Sulforaphane bảo vệ gan' }
        ],
        'Bữa tối': [
          { foodId: 'F262', grams: 150, foodName: 'Khoai tây luộc nghiền dầu mè', note: 'Dễ hấp thu' },
          { foodId: 'F263', grams: 110, foodName: 'Đậu hũ sốt nấm rơm', note: 'Thanh lọc' },
          { foodId: 'F264', grams: 180, foodName: 'Canh mướp hương nấu nấm', note: 'Giải nhiệt' }
        ],
        'Bữa phụ': [
          { foodId: 'F265', grams: 120, foodName: 'Bưởi da xanh tép mọng', note: 'Naringin hỗ trợ oxy hóa lipid gan' }
        ]
      },
      {
        'Bữa sáng': [
          { foodId: 'F266', grams: 200, foodName: 'Bánh canh gạo nạc heo băm rau mùi', note: 'Mùi thơm dịu kích thích tỳ vị' },
          { foodId: 'F267', grams: 200, foodName: 'Nước dừa xiêm tươi', note: 'Điện giải tự nhiên' }
        ],
        'Bữa trưa': [
          { foodId: 'F001', grams: 160, foodName: 'Cơm gạo lứt', note: 'Kiểm soát đường máu' },
          { foodId: 'F268', grams: 120, foodName: 'Tôm nõn rim nghệ tươi', note: 'Curcumin chống xơ hóa mô gan' },
          { foodId: 'F269', grams: 200, foodName: 'Canh bí đỏ nấu nạc băm', note: 'Vitamin E tự nhiên' }
        ],
        'Bữa tối': [
          { foodId: 'F270', grams: 150, foodName: 'Cơm mềm', note: 'Dễ tiêu' },
          { foodId: 'F271', grams: 100, foodName: 'Trứng gà hấp vân mây', note: 'Đạm sinh học cao' },
          { foodId: 'F272', grams: 180, foodName: 'Canh rau dền nấu tôm', note: 'Bổ huyết mát gan' }
        ],
        'Bữa phụ': [
          { foodId: 'F273', grams: 120, foodName: 'Quả thanh long ruột đỏ', note: 'Chất chống oxy hóa betalain' }
        ]
      },
      {
        'Bữa sáng': [
          { foodId: 'F274', grams: 200, foodName: 'Súp ngô non đậu hũ hạt sen', note: 'Bổ dưỡng kiện tỳ' },
          { foodId: 'F275', grams: 180, foodName: 'Nước trà xanh pha loãng ấm', note: 'EGCG kháng viêm tế bào gan' }
        ],
        'Bữa trưa': [
          { foodId: 'F001', grams: 160, foodName: 'Cơm gạo mầm GABA giàu chất xơ hòa tan', note: 'Chất xơ tự nhiên giảm hấp thu triglyceride' },
          { foodId: 'F276', grams: 120, foodName: 'Cá basa áp chảo dầu mè', note: 'Đạm béo tốt' },
          { foodId: 'F277', grams: 200, foodName: 'Canh su su hầm sườn non lọc mỡ', note: 'Thanh đạm' }
        ],
        'Bữa tối': [
          { foodId: 'F278', grams: 150, foodName: 'Cháo cá quả gừng hành', note: 'Dễ ngủ ấm bụng' },
          { foodId: 'F279', grams: 120, foodName: 'Mướp đắng hấp thịt nạc', note: 'Thanh can tả hỏa' }
        ],
        'Bữa phụ': [
          { foodId: 'F280', grams: 130, foodName: 'Dưa lê thơm ngọt', note: 'Thanh nhiệt cơ thể' }
        ]
      },
      {
        'Bữa sáng': [
          { foodId: 'F281', grams: 200, foodName: 'Cháo sườn heo nấm hương loãng', note: 'Phục hồi thể trạng' },
          { foodId: 'F282', grams: 150, foodName: 'Sữa yến mạch hạnh nhân', note: 'Bảo vệ nội mô' }
        ],
        'Bữa trưa': [
          { foodId: 'F001', grams: 160, foodName: 'Cơm trắng gạo dẻo', note: 'Carb sạch' },
          { foodId: 'F283', grams: 120, foodName: 'Ức gà xào ớt chuông dầu oliu', note: 'Vitamin C chống oxy hóa tế bào' },
          { foodId: 'F284', grams: 200, foodName: 'Canh bí xanh nấu tôm khô', note: 'Lợi niệu nhẹ' }
        ],
        'Bữa tối': [
          { foodId: 'F285', grams: 180, foodName: 'Bún gạo lứt trộn cá hồi xé rau mầm', note: 'Nhẹ nhàng thanh sạch' },
          { foodId: 'F286', grams: 150, foodName: 'Bắp cải hấp', note: 'Giải độc gan' }
        ],
        'Bữa phụ': [
          { foodId: 'F287', grams: 120, foodName: 'Quả xoài chín ngọt vừa', note: 'Bổ sung vitamin A' },
          { foodId: 'F288', grams: 250, foodName: 'Nước atiso ấm trước giờ ngủ', note: 'Hỗ trợ gan lọc máu ban đêm' }
        ]
      }
    ]
  } else {
    // Suy thận CKD / Tim mạch / Đa bệnh lý: 7 ngày siết đạm chuẩn, kiểm soát natri & kali, không lặp món
    days = [
      {
        'Bữa sáng': [
          { foodId: 'F019', grams: 200, foodName: 'Cháo yến mạch đậu đỏ', note: 'Nhiều chất xơ hòa tan' },
          { foodId: 'F023', grams: 150, foodName: 'Sữa hạt sen ít đường', note: 'Canxi thực vật' }
        ],
        'Bữa trưa': [
          { foodId: 'F001', grams: 160, foodName: 'Cơm gạo lứt huyết rồng', note: 'GI thấp, giải phóng chậm' },
          { foodId: 'F004', grams: 100, foodName: 'Ức gà hấp sả gừng', note: 'Đạm trắng giá trị sinh học cao' },
          { foodId: 'F021', grams: 150, foodName: 'Canh bí xanh nấu tép tươi', note: 'Ít Natri, thanh nhiệt' }
        ],
        'Bữa tối': [
          { foodId: 'F002', grams: 150, foodName: 'Khoai lang luộc', note: 'Chất bột đường hấp thu chậm' },
          { foodId: 'F007', grams: 120, foodName: 'Cá hồi áp chảo dầu oliu', note: 'Omega-3 bảo vệ tim mạch' },
          { foodId: 'F010', grams: 180, foodName: 'Bí xanh luộc chấm vừng', note: 'Lợi tiểu nhẹ, an toàn thận' }
        ],
        'Bữa phụ': [
          { foodId: 'F013', grams: 120, foodName: 'Táo ta gọt vỏ', note: 'Ít Kali, an toàn thận' }
        ]
      },
      {
        'Bữa sáng': [
          { foodId: 'F182', grams: 180, foodName: 'Miến dong nấu nạc băm rau cải luộc kỹ', note: 'Đạm thấp, ít kali' },
          { foodId: 'F183', grams: 150, foodName: 'Nước gạo rang ấm', note: 'Giải khát không tăng gánh nặng lọc' }
        ],
        'Bữa trưa': [
          { foodId: 'F184', grams: 160, foodName: 'Cơm trắng gạo tẻ', note: 'Hàm lượng phospho thấp hơn gạo lứt' },
          { foodId: 'F185', grams: 120, foodName: 'Đậu phụ sốt cà chua ít dầu', note: 'Đạm thực vật tinh khiết' },
          { foodId: 'F186', grams: 180, foodName: 'Canh bầu nấu tôm nõn nhạt', note: 'Lợi niệu nhẹ' }
        ],
        'Bữa tối': [
          { foodId: 'F187', grams: 150, foodName: 'Khoai tây luộc bỏ vỏ', note: 'Luộc kỹ 2 nước giảm bớt kali' },
          { foodId: 'F188', grams: 100, foodName: 'Cá bống kho nghệ ít muối', note: 'Đạm nạc sinh học cao' },
          { foodId: 'F189', grams: 150, foodName: 'Su hào luộc', note: 'Chất xơ an toàn' }
        ],
        'Bữa phụ': [
          { foodId: 'F190', grams: 120, foodName: 'Quả lê ngọt gọt vỏ', note: 'Ít kali, giải khát' }
        ]
      },
      {
        'Bữa sáng': [
          { foodId: 'F191', grams: 200, foodName: 'Cháo hoa hạt sen giò nạc', note: 'Bổ dưỡng nhẹ nhàng' },
          { foodId: 'F192', grams: 150, foodName: 'Sữa đậu nành tự nấu ít đường', note: 'Đạm thực vật' }
        ],
        'Bữa trưa': [
          { foodId: 'F001', grams: 150, foodName: 'Cơm gạo tẻ thơm hạ đạm (Protein thấp)', note: 'Carb chuẩn, hạn chế urê huyết' },
          { foodId: 'F193', grams: 100, foodName: 'Thịt thăn heo luộc thái lát', note: 'Kiểm soát lượng đạm 40g/ngày' },
          { foodId: 'F194', grams: 180, foodName: 'Canh mướp hương nấu nấm rơm', note: 'Thanh lọc' }
        ],
        'Bữa tối': [
          { foodId: 'F195', grams: 180, foodName: 'Bún gạo lứt xào rau củ', note: 'Ít muối natri' },
          { foodId: 'F196', grams: 100, foodName: 'Trứng gà luộc 1 quả', note: 'Lòng trắng giàu albumin' }
        ],
        'Bữa phụ': [
          { foodId: 'F197', grams: 120, foodName: 'Đu đủ chín gọt vỏ', note: 'Vitamin A và chất xơ' }
        ]
      },
      {
        'Bữa sáng': [
          { foodId: 'F198', grams: 200, foodName: 'Bánh canh bột gạo nạc heo băm', note: 'Nước dùng trong' },
          { foodId: 'F199', grams: 200, foodName: 'Nước dừa tươi', note: 'Điện giải tự nhiên' }
        ],
        'Bữa trưa': [
          { foodId: 'F200', grams: 160, foodName: 'Cơm trắng dẻo', note: 'Năng lượng chuẩn' },
          { foodId: 'F201', grams: 110, foodName: 'Tôm rim nước dừa nhạt', note: 'Đạm sạch' },
          { foodId: 'F202', grams: 180, foodName: 'Canh bí đỏ hầm đậu phộng ít', note: 'Chất béo tốt' }
        ],
        'Bữa tối': [
          { foodId: 'F203', grams: 150, foodName: 'Cơm mềm', note: 'Nhẹ bụng' },
          { foodId: 'F204', grams: 100, foodName: 'Chả cá thác lác hấp', note: 'Không dầu mỡ' },
          { foodId: 'F205', grams: 150, foodName: 'Bắp cải trắng luộc', note: 'Kiềm hóa nhẹ' }
        ],
        'Bữa phụ': [
          { foodId: 'F206', grams: 120, foodName: 'Dưa lê thơm gọt vỏ', note: 'Thanh nhiệt' }
        ]
      },
      {
        'Bữa sáng': [
          { foodId: 'F207', grams: 200, foodName: 'Cháo sườn heo ngô non loãng', note: 'Êm dịu' },
          { foodId: 'F208', grams: 150, foodName: 'Sữa yến mạch không đường', note: 'Bảo vệ thành mạch' }
        ],
        'Bữa trưa': [
          { foodId: 'F001', grams: 150, foodName: 'Cơm gạo tím than Điện Biên', note: 'Chống viêm, ổn định đường huyết' },
          { foodId: 'F209', grams: 110, foodName: 'Cá quả hấp thì là gừng', note: 'Đạm trắng giá trị cao' },
          { foodId: 'F210', grams: 180, foodName: 'Canh rau ngót nấu thịt nạc ít', note: 'Mát gan' }
        ],
        'Bữa tối': [
          { foodId: 'F211', grams: 180, foodName: 'Miến dong xào ức gà xé nấm rơm', note: 'Giảm tải lọc cầu thận' },
          { foodId: 'F212', grams: 140, foodName: 'Su su luộc chấm mè', note: 'Nhuận tràng' }
        ],
        'Bữa phụ': [
          { foodId: 'F213', grams: 120, foodName: 'Quả táo ta gọt vỏ', note: 'Chống oxy hóa' }
        ]
      },
      {
        'Bữa sáng': [
          { foodId: 'F214', grams: 200, foodName: 'Phở gạo lứt ức gà thanh vị', note: 'Nấu nhạt' },
          { foodId: 'F215', grams: 200, foodName: 'Nước cam tươi pha loãng', note: 'Vitamin C' }
        ],
        'Bữa trưa': [
          { foodId: 'F216', grams: 160, foodName: 'Cơm trắng', note: 'Năng lượng tinh sạch' },
          { foodId: 'F217', grams: 100, foodName: 'Thịt nạc rim củ nghệ tươi', note: 'Curcumin chống xơ hóa' },
          { foodId: 'F218', grams: 180, foodName: 'Canh mồng tơi nấu tép', note: 'Thanh nhiệt' }
        ],
        'Bữa tối': [
          { foodId: 'F219', grams: 150, foodName: 'Khoai lang mật luộc', note: 'Carb phức' },
          { foodId: 'F220', grams: 110, foodName: 'Đậu phụ hấp nấm đông cô', note: 'Đạm thực vật' },
          { foodId: 'F221', grams: 150, foodName: 'Cải ngọt luộc', note: 'An toàn điện giải' }
        ],
        'Bữa phụ': [
          { foodId: 'F222', grams: 120, foodName: 'Bưởi ngọt tép mọng', note: 'Ít calo' }
        ]
      },
      {
        'Bữa sáng': [
          { foodId: 'F223', grams: 200, foodName: 'Súp ngô gà nấm tuyết loãng', note: 'Bổ sung sức khỏe' },
          { foodId: 'F224', grams: 150, foodName: 'Sữa đậu nành ấm', note: 'Đạm sạch' }
        ],
        'Bữa trưa': [
          { foodId: 'F001', grams: 160, foodName: 'Cơm gạo lứt mầm GABA Điện Biên', note: 'No lâu, an toàn lọc máu' },
          { foodId: 'F225', grams: 110, foodName: 'Cá hồi áp chảo dầu mè', note: 'Chống viêm mạch' },
          { foodId: 'F226', grams: 180, foodName: 'Canh bí đao nấu tép', note: 'Lợi niệu thanh dịu' }
        ],
        'Bữa tối': [
          { foodId: 'F227', grams: 150, foodName: 'Cơm dẻo mềm', note: 'Dễ ngủ' },
          { foodId: 'F228', grams: 100, foodName: 'Ức gà hấp sả hành', note: 'Đạm nạc' },
          { foodId: 'F229', grams: 150, foodName: 'Rau lang luộc', note: 'Nhuận tràng' }
        ],
        'Bữa phụ': [
          { foodId: 'F230', grams: 120, foodName: 'Quả xoài cát chín ngọt', note: 'Bổ sung vitamin A' }
        ]
      }
    ]
  }

  const hardLimits: Record<string, any> = {
    max_sodium_mg: maxSodium,
    max_protein_g: maxProtein,
    max_gi: maxGi
  }
  if (minWater) hardLimits.min_water_ml = minWater
  if (maxPotassium) hardLimits.max_potassium_mg = maxPotassium
  if (avoidOxalate) hardLimits.avoid_oxalate = true
  if (purineLevel) hardLimits.purine_level = purineLevel

  // Dynamically match guideline evidence from loaded clinical docs
  const primaryDiseases = (extraction.diseases && extraction.diseases.length > 0)
    ? extraction.diseases
    : (profile.conditions || [])

  const relevantDocs = (docs || []).filter(d => {
    if (d.status !== 'Đã duyệt') return false
    const text = `${d.title} ${d.condition} ${d.content}`.toLowerCase()
    return primaryDiseases.some(c => text.includes(c.toLowerCase().slice(0, 4)))
  })

  const evidenceBasis: EvidenceBasis[] = relevantDocs.length > 0
    ? relevantDocs.map(d => ({
        guideline_name: d.title,
        citation_url: 'https://kdigo.org/guidelines/',
        rationale: d.content
      }))
    : [
        {
          guideline_name: extraction.diseases?.[0]
            ? `Phác đồ Hướng dẫn Điều trị & Dinh dưỡng (${extraction.diseases[0]})`
            : 'Hướng dẫn Dinh dưỡng Lâm sàng CDSS',
          citation_url: 'https://kdigo.org/guidelines/',
          rationale: conflictDetails || 'Kiểm soát mức trần dinh dưỡng nhằm tối ưu hóa chức năng cơ quan đích và hỗ trợ phục hồi theo bệnh án.'
        }
      ]

  // Normalize every fallback dish ID against existing foods and clamp daily totals within ceilings (QA-02 + QA-03)
  const catalogFoods = s.foods && s.foods.length > 0 ? s.foods : seed().foods
  const alList = (profile.allergies || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean)
  const isSafeFood = (cand?: Food): boolean => {
    if (!cand) return false
    const pool = `${cand.allergens} ${cand.name}`.toLowerCase()
    if (alList.some(a => pool.includes(a))) return false
    const ddi = evaluateDrugDietInteractions(profile, [{ foodId: cand.id, foodName: cand.name, grams: 100 }], catalogFoods)
    return ddi.length === 0
  }
  const byId = (id: string) => catalogFoods.find(f => f.id === id)
  const safeFallbackVeg = catalogFoods.find(f => (f.id === 'F021' || f.id === 'F033' || f.id === 'F011') && isSafeFood(f)) || catalogFoods.find(isSafeFood) || catalogFoods[0]
  const safeFallbackFruit = catalogFoods.find(f => (f.id === 'F012' || f.id === 'F030' || f.id === 'F034') && isSafeFood(f)) || safeFallbackVeg
  const safeFallbackProtein = catalogFoods.find(f => (f.id === 'F004' || f.id === 'F005' || f.id === 'F015' || f.id === 'F006') && isSafeFood(f)) || safeFallbackVeg

  const usedNamesInPlan = new Set<string>()
  const pickUnusedInCategory = (preferred: Food): Food => {
    const pLower = preferred.name.toLowerCase()
    if (!usedNamesInPlan.has(pLower) && isSafeFood(preferred)) {
      usedNamesInPlan.add(pLower)
      return preferred
    }
    const sameCat = catalogFoods.find(
      cand => cand.category === preferred.category && !usedNamesInPlan.has(cand.name.toLowerCase()) && isSafeFood(cand)
    )
    if (sameCat) {
      usedNamesInPlan.add(sameCat.name.toLowerCase())
      return sameCat
    }
    const nonMeatUnused = preferred.category !== 'Đạm'
      ? catalogFoods.find(
          cand => cand.category !== 'Dầu mỡ' && cand.category !== 'Đạm' && !usedNamesInPlan.has(cand.name.toLowerCase()) && isSafeFood(cand)
        )
      : undefined
    if (nonMeatUnused) {
      usedNamesInPlan.add(nonMeatUnused.name.toLowerCase())
      return nonMeatUnused
    }
    const anyUnused = catalogFoods.find(
      cand => cand.category !== 'Dầu mỡ' && !usedNamesInPlan.has(cand.name.toLowerCase()) && isSafeFood(cand)
    )
    if (anyUnused) {
      usedNamesInPlan.add(anyUnused.name.toLowerCase())
      return anyUnused
    }
    return preferred
  }

  const resolveValidFood = (item: Item, slotName: string): Food | undefined => {
    const lowerName = (item.foodName || '').toLowerCase()
    const exactId = byId(item.foodId)
    if (exactId && exactId.name.toLowerCase() === lowerName && isSafeFood(exactId)) {
      return pickUnusedInCategory(exactId)
    }
    const byName = catalogFoods.find(f => f.name.toLowerCase() === lowerName)
    if (byName && isSafeFood(byName)) {
      return pickUnusedInCategory(byName)
    }

    let pickId = ''
    if (/dầu oliu|oliu/.test(lowerName) && !/cá|gà|trứng|chảo|xào/.test(lowerName)) pickId = 'F014'
    else if (/dầu mè/.test(lowerName) && !/cá|gà|chảo|xào|hấp|nấm/.test(lowerName)) pickId = 'F088'
    else if (/sữa hạt sen/.test(lowerName)) pickId = 'F023'
    else if (/sữa đậu nành/.test(lowerName)) pickId = 'F024'
    else if (/sữa yến mạch/.test(lowerName)) pickId = 'F084'
    else if (/sữa hạt điều/.test(lowerName)) pickId = 'F085'
    else if (/trà atiso|atiso tươi|trà xanh/.test(lowerName)) pickId = 'F086'
    else if (/nước gạo/.test(lowerName)) pickId = 'F087'
    else if (/sữa/.test(lowerName)) pickId = 'F013'
    else if (/phở/.test(lowerName)) pickId = 'F025'
    else if (/bún gạo lứt/.test(lowerName)) pickId = 'F026'
    else if (/bún/.test(lowerName)) pickId = 'F054'
    else if (/miến dong xào/.test(lowerName)) pickId = 'F055'
    else if (/miến/.test(lowerName)) pickId = 'F027'
    else if (/cháo hạt sen/.test(lowerName)) pickId = 'F031'
    else if (/cháo cá/.test(lowerName)) pickId = 'F050'
    else if (/cháo đậu xanh/.test(lowerName)) pickId = 'F051'
    else if (/cháo sườn/.test(lowerName)) pickId = 'F049'
    else if (/cháo|yến mạch/.test(lowerName)) pickId = 'F019'
    else if (/bánh cuốn/.test(lowerName)) pickId = 'F035'
    else if (/bánh canh/.test(lowerName)) pickId = 'F052'
    else if (/hủ tiếu/.test(lowerName)) pickId = 'F053'
    else if (/bánh mì/.test(lowerName)) pickId = 'F056'
    else if (/bánh/.test(lowerName)) pickId = 'F019'
    else if (/súp/.test(lowerName)) pickId = 'F036'
    else if (/cơm gạo lứt đỏ/.test(lowerName)) pickId = 'F037'
    else if (/cơm gạo tẻ|cơm trắng/.test(lowerName)) pickId = 'F038'
    else if (/tím than/.test(lowerName)) pickId = 'F039'
    else if (/tám thơm/.test(lowerName)) pickId = 'F040'
    else if (/gaba/.test(lowerName)) pickId = 'F041'
    else if (/quinoa|ngũ cốc/.test(lowerName)) pickId = 'F042'
    else if (/séng cù|dẻo/.test(lowerName)) pickId = 'F043'
    else if (/hạt kê/.test(lowerName)) pickId = 'F044'
    else if (/cơm|gạo/.test(lowerName)) pickId = 'F001'
    else if (/khoai lang mật/.test(lowerName)) pickId = 'F045'
    else if (/khoai tây/.test(lowerName)) pickId = 'F046'
    else if (/khoai môn/.test(lowerName)) pickId = 'F047'
    else if (/khoai sọ/.test(lowerName)) pickId = 'F048'
    else if (/khoai/.test(lowerName)) pickId = 'F002'
    else if (/canh atiso/.test(lowerName)) pickId = 'F069'
    else if (/canh cải cúc|cải cúc/.test(lowerName)) pickId = 'F070'
    else if (/canh mướp/.test(lowerName)) pickId = 'F071'
    else if (/canh su hào/.test(lowerName)) pickId = 'F072'
    else if (/canh bí đỏ/.test(lowerName)) pickId = 'F073'
    else if (/canh cải ngọt|canh cải xanh|cải ngọt nấu/.test(lowerName)) pickId = 'F074'
    else if (/canh bầu/.test(lowerName)) pickId = 'F029'
    else if (/canh rau ngót/.test(lowerName)) pickId = 'F032'
    else if (/canh bắp cải/.test(lowerName)) pickId = 'F033'
    else if (/canh\b/.test(lowerName)) pickId = 'F021'
    else if (/đậu que/.test(lowerName)) pickId = 'F077'
    else if (/cá quả|cá lóc/.test(lowerName)) pickId = 'F057'
    else if (/cá diêu hồng/.test(lowerName)) pickId = 'F058'
    else if (/cá thác lác/.test(lowerName)) pickId = 'F059'
    else if (/cá trắm/.test(lowerName)) pickId = 'F060'
    else if (/cá thu/.test(lowerName)) pickId = 'F061'
    else if (/cá hồi/.test(lowerName)) pickId = 'F007'
    else if (/cá/.test(lowerName)) pickId = 'F020'
    else if (/gà xé phay|lá chanh/.test(lowerName)) pickId = 'F062'
    else if (/gà hầm/.test(lowerName)) pickId = 'F063'
    else if (/gà/.test(lowerName)) pickId = 'F004'
    else if (/đậu hũ non/.test(lowerName)) pickId = 'F067'
    else if (/đậu phụ hấp/.test(lowerName)) pickId = 'F068'
    else if (/đậu phụ nhồi/.test(lowerName)) pickId = 'F028'
    else if (/đậu/.test(lowerName)) pickId = 'F006'
    else if (/trứng gà hấp/.test(lowerName)) pickId = 'F066'
    else if (/trứng/.test(lowerName)) pickId = 'F015'
    else if (/tôm/.test(lowerName)) pickId = 'F008'
    else if (/rim nghệ/.test(lowerName)) pickId = 'F064'
    else if (/nạc vai/.test(lowerName)) pickId = 'F065'
    else if (/thịt/.test(lowerName)) pickId = 'F005'
    else if (/mướp/.test(lowerName)) pickId = 'F071'
    else if (/cải ngọt/.test(lowerName)) pickId = 'F078'
    else if (/su su/.test(lowerName)) pickId = 'F075'
    else if (/su hào/.test(lowerName)) pickId = 'F076'
    else if (/rau lang/.test(lowerName)) pickId = 'F079'
    else if (/bí đỏ hấp/.test(lowerName)) pickId = 'F080'
    else if (/bắp cải/.test(lowerName)) pickId = 'F033'
    else if (/bí/.test(lowerName)) pickId = 'F021'
    else if (/bông cải/.test(lowerName)) pickId = 'F009'
    else if (/mồng tơi|cải/.test(lowerName)) pickId = 'F010'
    else if (/dưa leo|dưa chuột/.test(lowerName)) pickId = 'F011'
    else if (/lê tươi|quả lê/.test(lowerName)) pickId = 'F030'
    else if (/đu đủ/.test(lowerName)) pickId = 'F034'
    else if (/thanh long/.test(lowerName)) pickId = 'F081'
    else if (/ổi/.test(lowerName)) pickId = 'F082'
    else if (/dưa lê/.test(lowerName)) pickId = 'F083'
    else if (/chuối/.test(lowerName)) pickId = 'F018'
    else if (/táo|bưởi|cam|xoài|nước/.test(lowerName)) pickId = 'F012'
    else if (slotName === 'Bữa phụ') pickId = 'F012'
    else pickId = 'F021'

    const picked = byId(pickId)
    if (isSafeFood(picked) && picked) return pickUnusedInCategory(picked)
    const fallbackPool = (picked as Food | undefined)?.category === 'Đạm' || (picked as Food | undefined)?.category === 'Sữa'
      ? safeFallbackProtein
      : (picked as Food | undefined)?.category === 'Trái cây'
      ? safeFallbackFruit
      : safeFallbackVeg
    return pickUnusedInCategory(fallbackPool)
  }

  const activeSlots = mealsCount >= 4 ? ['Bữa sáng', 'Bữa trưa', 'Bữa tối', 'Bữa phụ'] : ['Bữa sáng', 'Bữa trưa', 'Bữa tối']
  const targetDailyKcal = !nutritionProfileIssue(profile) ? tdee(profile) : 1800
  const minSafeKcal = Math.max(1260, Math.round(targetDailyKcal * 0.65))

  const mappedDays = days.slice(0, daysCount).map(dayObj => {
    const mapped: Record<string, Item[]> = {}
    for (const slotName of activeSlots) {
      const slotItems = dayObj[slotName] || []
      mapped[slotName] = slotItems.map(it => {
        const ref = resolveValidFood(it, slotName)
        return {
          ...it,
          foodId: ref?.id || it.foodId,
          foodName: ref?.name || it.foodName,
          note: ref?.name.toLowerCase() === it.foodName?.toLowerCase() ? it.note : undefined,
          snapshot: ref ? {
            kcal: ref.kcal, protein: ref.protein, fat: ref.fat, carb: ref.carb,
            fiber: ref.fiber, sodium: ref.sodium, potassium: ref.potassium,
            gi: ref.gi, purine: ref.purine, allergens: ref.allergens
          } : it.snapshot
        }
      })
    }
    return mapped
  })

  const normalizedDays = mappedDays.map(mappedDay => {
    rebalanceDayPortions({
      day: mappedDay,
      foods: catalogFoods,
      maxProtein,
      maxSodium,
      minSafeKcal,
      activeSlots,
      isSafeFood,
      usedNamesInPlan
    })
    return mappedDay
  })

  return {
    id: 'plan-cdss-' + Date.now(),
    name: `Thực đơn Điều trị AI - ${extraction.diseases?.[0] || extraction.name} (${daysCount} Ngày)`,
    created: new Date().toISOString(),
    personalized: true,
    profileBasis: mealPlanProfileBasis(profile),
    requiredMeals: mealsCount,
    status: planStatus,
    version: 1,
    has_conflict: hasConflict,
    conflict_details: conflictDetails,
    evidence_basis: evidenceBasis,
    hard_limits: hardLimits,
    generation_source: 'LOCAL_FALLBACK',
    generation_note: 'Thực đơn được tổng hợp từ bộ quy tắc lâm sàng CDSS trong hệ thống.',
    history: [
      `[${new Date().toLocaleTimeString('vi-VN')}] Tự động lập thực đơn điều trị AI đồng bộ từ hồ sơ "${extraction.name}".`,
      `[${new Date().toLocaleTimeString('vi-VN')}] Căn cứ tài liệu phác đồ đã nạp: ${evidenceBasis.map(e => e.guideline_name).join(', ')}.`,
      `[${new Date().toLocaleTimeString('vi-VN')}] Thiết lập mức trần CDSS: Natri ≤ ${maxSodium}mg, Đạm ≤ ${maxProtein}g, GI ≤ ${maxGi}${minWater ? `, Nước ≥ ${minWater}ml` : ''}.`
    ],
    days: normalizedDays
  }
}

// ==================== DEFAULT HEALTHY 3D ORGAN ALERTS ====================

export const defaultHealthyOrganAlerts: Record<OrganId, OrganMapping> = {
  heart: {
    organ_id: 'heart',
    severity: 'normal',
    reason: 'Huyết áp 120/80 mmHg · Nhịp xoang đều, tim mạch ổn định',
    nutrient_limits: {}
  },
  kidneys: {
    organ_id: 'kidneys',
    severity: 'normal',
    reason: 'eGFR > 90 ml/phút · Thận lọc máu bình thường',
    nutrient_limits: {}
  },
  liver: {
    organ_id: 'liver',
    severity: 'normal',
    reason: 'Men gan ALT/AST đạt chuẩn · Chức năng gan tốt',
    nutrient_limits: {}
  },
  stomach: {
    organ_id: 'stomach',
    severity: 'normal',
    reason: 'Hệ tiêu hóa và niêm mạc dạ dày khỏe mạnh',
    nutrient_limits: {}
  },
  pancreas: {
    organ_id: 'pancreas',
    severity: 'normal',
    reason: 'Glucose 5.2 mmol/L · Đường huyết trong ngưỡng an toàn',
    nutrient_limits: {}
  },
  joints: {
    organ_id: 'joints',
    severity: 'normal',
    reason: 'Acid Uric 320 µmol/L · Khớp bình thường',
    nutrient_limits: {}
  }
}

// ==================== FLOW 1.1: DELETE / CLEAR MEDICAL RECORD ====================

export function clearMedicalRecord(recordId?: string) {
  set(d => {
    if (recordId) {
      if (d.profile.files) {
        d.profile.files = d.profile.files.filter(f => f.id !== recordId)
      }
      if (d.ocrHistory) {
        d.ocrHistory = d.ocrHistory.filter(f => f.id !== recordId)
      }

      // If records still remain, re-derive ALL state cleanly from remaining records (BOS-13)
      if (d.profile.files && d.profile.files.length > 0) {
        const remainingDiseasesList: string[] = []
        const remainingMedsList: string[] = []
        const remainingAllergies = new Set<string>()
        const remainingAlerts: Record<OrganId, OrganMapping> = structuredClone(defaultHealthyOrganAlerts)

        d.profile.files.forEach(f => {
          f.diseases?.forEach(dis => remainingDiseasesList.push(dis))
          f.medications?.forEach(m => remainingMedsList.push(formatMedicationDisplay(m.name, m.activeIngredient)))
          f.allergies?.forEach(al => remainingAllergies.add(al))
          f.organ_mappings?.forEach(m => {
            if (m.severity === 'warning' || m.severity === 'critical') {
              remainingAlerts[m.organ_id] = m
            }
          })
        })

        d.profile.conditions = cleanAndDeduplicateDiseases(remainingDiseasesList)
        d.profile.medications = cleanAndDeduplicateMedications(remainingMedsList)
        if (remainingAllergies.size > 0) {
          d.profile.allergies = Array.from(remainingAllergies).join(', ')
        }
        d.activeOrganAlerts = remainingAlerts
        const latestRemaining = d.profile.files[0]
        d.trendPrediction = generateInstantTrendProjection(d.profile, d.activeOrganAlerts, latestRemaining)
        log(d, 'Xóa Bệnh án', `Đã xóa bệnh án ${recordId} và đồng bộ lại hồ sơ`)
        return
      }
    }

    // Complete reset of all patient-related medical states back to initial / healthy values:
    d.profile.files = []
    d.profile.conditions = []
    d.profile.medications = []
    d.profile.allergies = ''
    if (d.ocrHistory) d.ocrHistory = []
    d.trendPrediction = undefined

    // 1. Revert Anatomy Map to empty state (no disease markers)
    d.activeOrganAlerts = {} as Record<OrganId, OrganMapping>

    // 2. Clear CDSS Assistant Chat context & warning banners
    d.chat = [
      {
        from: 'b',
        text: 'Hồ sơ bệnh án đã được làm sạch. Sơ đồ Giải phẫu và Hệ thống CDSS đã trở về trạng thái khỏe mạnh ban đầu.'
      }
    ]

    // 3. Clear warning banners & multi-morbidity conflicts on plans
    if (d.plans && d.plans.length > 0) {
      d.plans.forEach(plan => {
        plan.has_conflict = false
        plan.conflict_details = undefined
      })
    }

    log(d, 'Hủy/Xóa Toàn bộ Bệnh án', 'Đã đặt lại toàn bộ hồ sơ, đơn thuốc, cảnh báo và sơ đồ cơ quan về trạng thái khỏe mạnh')
  })
}

// ==================== CLINICAL TEST PRESETS (1-CLICK DEMO) ====================

export interface MedicalPreset {
  id: string
  name: string
  shortName: string
  tag: string
  diseaseName: string
  description: string
  targetOrgan: OrganId
  badgeColor: string
  extraction: MedicalRecordExtraction
}

export const SAMPLE_MEDICAL_PRESETS: MedicalPreset[] = [
  {
    id: 'preset-kidney-stones',
    name: 'Bệnh án Sỏi Thận & Đài Bể Thận (Điển hình)',
    shortName: 'Sỏi Thận 6.8mm',
    tag: 'Thận',
    targetOrgan: 'kidneys',
    badgeColor: 'border-rose-400 bg-rose-50 text-rose-800',
    diseaseName: 'Sỏi đài thận 6.8mm, Đái máu vi thể, Tinh thể Oxalate',
    description: 'Sỏi 6.8mm đài thận, Creatinine 135 µmol/L, eGFR 55 ml/phút, Hồng cầu niệu (++)',
    extraction: {
      id: 'rec-kidney-stones',
      name: 'Ket-qua-Sieu-am-Xet-nghiem-Soi-Than.pdf',
      date: new Date().toISOString().slice(0, 10),
      type: 'Siêu âm & Xét nghiệm Chức năng Thận',
      metrics: [
        { name: 'Kích thước sỏi thận', value: '6.8 mm', unit: '', status: 'high', referenceRange: 'Không có sỏi', affectedOrgan: 'kidneys' },
        { name: 'Creatinine', value: 135, unit: 'µmol/L', status: 'high', referenceRange: '62 - 106', affectedOrgan: 'kidneys' },
        { name: 'eGFR', value: 55, unit: 'ml/phút/1.73m²', status: 'low', referenceRange: '> 90', affectedOrgan: 'kidneys' },
        { name: 'Hồng cầu niệu (RBC)', value: 'Dương tính (++)', unit: '', status: 'high', referenceRange: 'Âm tính (-)', affectedOrgan: 'kidneys' }
      ],
      diseases: ['Sỏi thận', 'Lắng đọng tinh thể Calci Oxalate'],
      allergies: [],
      medications: [
        { name: 'Rowatinex', activeIngredient: 'Pinene, Camphene, Cineol', dosage: '1 viên x 3 lần/ngày', purpose: 'Lợi tiểu, giãn cơ niệu quản, bài xuất sỏi', affectedOrgan: 'kidneys', ddiAlert: 'Uống nhiều nước (> 2.5 lít/ngày)' }
      ],
      has_conflict: false,
      conflict_reason: 'Nguy cơ kích ứng niêm mạc đài thận và ứ nước nếu thiếu nước.',
      raw_summary: 'Bệnh nhân có sỏi thận đài bể thận kích thước 6.8mm, mức lọc cầu thận giảm nhẹ (eGFR 55), hồng cầu niệu dương tính.',
      confirmed: true,
      organ_mappings: [
        {
          organ_id: 'kidneys',
          severity: 'warning',
          reason: 'Sỏi đài thận 6.8mm · Creatinine 135 µmol/L, eGFR 55 ml/phút · Cần uống nhiều nước (> 2.5L/ngày), giảm Natri < 1500mg và kiêng thực phẩm giàu Oxalate.',
          nutrient_limits: { water_min_ml: 2500, sodium_max_mg: 1500, avoid_oxalate: true }
        }
      ]
    }
  },
  {
    id: 'preset-ckd-heart',
    name: 'Suy Thận mạn (CKD 4) & Tăng huyết áp',
    shortName: 'Suy thận CKD 4 + Tim',
    tag: 'Thận + Tim',
    targetOrgan: 'kidneys',
    badgeColor: 'border-rose-400 bg-rose-50 text-rose-800',
    diseaseName: 'Suy thận mạn CKD Giai đoạn 4, Tăng huyết áp',
    description: 'eGFR 28 ml/phút, Creatinine 142 µmol/L, Huyết áp 148/95, dùng Warfarin',
    extraction: {
      id: 'rec-ckd-heart',
      name: 'Benh-an-Suy-than-CKD-Tim-mach.pdf',
      date: new Date().toISOString().slice(0, 10),
      type: 'Xét nghiệm sinh hóa máu & Tim mạch',
      metrics: [
        { name: 'Creatinine', value: 142, unit: 'µmol/L', status: 'high', referenceRange: '62 - 106', affectedOrgan: 'kidneys' },
        { name: 'eGFR', value: 28, unit: 'ml/phút/1.73m²', status: 'low', referenceRange: '> 90', affectedOrgan: 'kidneys' },
        { name: 'Huyết áp', value: '148/95', unit: 'mmHg', status: 'high', referenceRange: '< 120/80', affectedOrgan: 'heart' },
        { name: 'INR', value: 2.8, unit: '', status: 'high', referenceRange: '2.0 - 3.0', affectedOrgan: 'heart' }
      ],
      diseases: ['Suy thận mạn CKD Giai đoạn 4', 'Tăng huyết áp'],
      allergies: ['Đậu phộng'],
      medications: [
        { name: 'Coumadin', activeIngredient: 'Warfarin', dosage: '5mg', purpose: 'Chống đông máu', affectedOrgan: 'heart', ddiAlert: 'Tương tác mạnh Vitamin K' },
        { name: 'Zestril', activeIngredient: 'Lisinopril', dosage: '10mg', purpose: 'Hạ huyết áp', affectedOrgan: 'kidneys', ddiAlert: 'Tăng giữ Kali' }
      ],
      has_conflict: true,
      conflict_reason: 'Nguy cơ tăng Kali máu và biến thiên INR do tương tác thuốc - thức ăn.',
      raw_summary: 'Bệnh nhân suy thận giai đoạn 4 kết hợp tăng huyết áp đang dùng thuốc chống đông máu.',
      confirmed: true,
      organ_mappings: [
        { organ_id: 'kidneys', severity: 'critical', reason: 'eGFR 28 ml/phút (CKD 4) · Giảm lọc, tăng Kali máu nguy cơ loạn nhịp', nutrient_limits: { protein_max_g: 45, potassium_max_mg: 1800 } },
        { organ_id: 'heart', severity: 'critical', reason: 'Huyết áp 148/95 mmHg · Đang dùng thuốc chống đông Warfarin nhạy cảm', nutrient_limits: { sodium_max_mg: 1500, avoid_vitamin_k: 'Rau chân vịt, cải xoăn' } },
        { organ_id: 'liver', severity: 'safe', reason: 'Chức năng gan và men gan trong giới hạn bình thường', nutrient_limits: {} },
        { organ_id: 'stomach', severity: 'safe', reason: 'Niêm mạc tiêu hóa ổn định', nutrient_limits: {} },
        { organ_id: 'pancreas', severity: 'warning', reason: 'Đường huyết nhẹ 7.2 mmol/L · Cần theo dõi đường huyết', nutrient_limits: { gi_max: 55 } },
        { organ_id: 'joints', severity: 'safe', reason: 'Acid Uric 380 µmol/L · Khớp bình thường', nutrient_limits: {} }
      ]
    }
  },
  {
    id: 'preset-liver-cirrhosis',
    name: 'Viêm gan B cấp & Men gan tăng vọt',
    shortName: 'Viêm gan B cấp (Men gan cao)',
    tag: 'Gan',
    targetOrgan: 'liver',
    badgeColor: 'border-amber-400 bg-amber-50 text-amber-800',
    diseaseName: 'Viêm gan B cấp tính, Tổn thương tế bào gan',
    description: 'ALT 215 U/L, AST 190 U/L, Bilirubin tăng, suy giảm chuyển hóa thuốc',
    extraction: {
      id: 'rec-liver',
      name: 'Xet-nghiem-Men-gan-Hepatitis.pdf',
      date: new Date().toISOString().slice(0, 10),
      type: 'Xét nghiệm chức năng Gan & Vi sinh',
      metrics: [
        { name: 'ALT (GPT)', value: 215, unit: 'U/L', status: 'high', referenceRange: '< 40', affectedOrgan: 'liver' },
        { name: 'AST (GOT)', value: 190, unit: 'U/L', status: 'high', referenceRange: '< 40', affectedOrgan: 'liver' },
        { name: 'Bilirubin TP', value: 34, unit: 'µmol/L', status: 'high', referenceRange: '< 17', affectedOrgan: 'liver' }
      ],
      diseases: ['Viêm gan B cấp tính', 'Tổn thương tế bào gan'],
      allergies: [],
      medications: [
        { name: 'Lipitor', activeIngredient: 'Atorvastatin', dosage: '20mg', purpose: 'Hạ lipid', affectedOrgan: 'liver', ddiAlert: 'Cấm bưởi chùm gây tiêu cơ vân' }
      ],
      has_conflict: false,
      raw_summary: 'Men gan tăng gấp 5 lần bình thường, tổn thương nhu mô gan cấp tính.',
      confirmed: true,
      organ_mappings: [
        { organ_id: 'liver', severity: 'critical', reason: 'ALT: 215 U/L, AST: 190 U/L · Hoại tử tế bào gan cấp, kiêng tuyệt đối rượu bia & bưởi', nutrient_limits: { avoid_grapefruit: true, fat_max_g: 35 } },
        { organ_id: 'stomach', severity: 'warning', reason: 'Đầy bụng chậm tiêu do suy giảm bài tiết mật của gan', nutrient_limits: { avoid_fatty: true } },
        { organ_id: 'heart', severity: 'safe', reason: 'Huyết áp 120/80 mmHg · Tim mạch bình thường', nutrient_limits: {} },
        { organ_id: 'kidneys', severity: 'safe', reason: 'eGFR 98 ml/phút · Thận lọc máu tốt', nutrient_limits: {} },
        { organ_id: 'pancreas', severity: 'safe', reason: 'Tuyến tụy và glucose ổn định (5.1 mmol/L)', nutrient_limits: {} },
        { organ_id: 'joints', severity: 'safe', reason: 'Acid Uric 320 µmol/L · Khớp bình thường', nutrient_limits: {} }
      ]
    }
  },
  {
    id: 'preset-gout-joints',
    name: 'Cơn Gout cấp & Khớp sưng đau nhức',
    shortName: 'Cơn Gout cấp (Acid Uric)',
    tag: 'Khớp gối',
    targetOrgan: 'joints',
    badgeColor: 'border-rose-400 bg-rose-50 text-rose-800',
    diseaseName: 'Gout mạn có cơn cấp, Lắng đọng tinh thể Urat',
    description: 'Acid Uric 580 µmol/L, viêm sưng đau nhức khớp gối và ngón chân',
    extraction: {
      id: 'rec-gout',
      name: 'Kham-Khop-Gout-Acid-Uric.pdf',
      date: new Date().toISOString().slice(0, 10),
      type: 'Xét nghiệm Cơ Xương Khớp',
      metrics: [
        { name: 'Acid Uric', value: 580, unit: 'µmol/L', status: 'high', referenceRange: '200 - 420', affectedOrgan: 'joints' }
      ],
      diseases: ['Gout mạn tính có đợt cấp', 'Tăng Acid Uric máu'],
      allergies: ['Tôm', 'Cua'],
      medications: [
        { name: 'Colchicine', activeIngredient: 'Colchicine', dosage: '1mg', purpose: 'Cắt cơn Gout cấp', affectedOrgan: 'joints', ddiAlert: 'Kích ứng tiêu hóa' }
      ],
      has_conflict: false,
      raw_summary: 'Cơn Gout bùng phát, acid uric tăng rất cao, tinh thể urat kết tủa ở khớp.',
      confirmed: true,
      organ_mappings: [
        { organ_id: 'joints', severity: 'critical', reason: 'Acid Uric 580 µmol/L · Lắng đọng tinh thể Urat, sưng viêm khớp gối cấp tính', nutrient_limits: { purine_level: 'Thấp', avoid_red_meat: true, avoid_seafood: true } },
        { organ_id: 'kidneys', severity: 'warning', reason: 'Thận tăng tải bài tiết tinh thể acid uric, nguy cơ sỏi urat', nutrient_limits: { water_min_ml: 2500 } },
        { organ_id: 'stomach', severity: 'warning', reason: 'Nguy cơ kích ứng niêm mạc do thuốc chống viêm Colchicine', nutrient_limits: {} },
        { organ_id: 'heart', severity: 'safe', reason: 'Huyết áp 122/80 mmHg · Tim mạch bình thường', nutrient_limits: {} },
        { organ_id: 'liver', severity: 'safe', reason: 'Men gan bình thường', nutrient_limits: {} },
        { organ_id: 'pancreas', severity: 'safe', reason: 'Đường huyết bình thường (5.4 mmol/L)', nutrient_limits: {} }
      ]
    }
  },
  {
    id: 'preset-gerd-stomach',
    name: 'Viêm loét Dạ dày - Tá tràng & GERD',
    shortName: 'Viêm loét Dạ dày (GERD)',
    tag: 'Dạ dày',
    targetOrgan: 'stomach',
    badgeColor: 'border-orange-400 bg-orange-50 text-orange-800',
    diseaseName: 'Viêm loét dạ dày - tá tràng, Trào ngược GERD',
    description: 'Nội soi dạ dày niêm mạc xung huyết loét, acid trào ngược',
    extraction: {
      id: 'rec-stomach',
      name: 'Ket-qua-Noi-soi-Da-day-HP.pdf',
      date: new Date().toISOString().slice(0, 10),
      type: 'Nội soi Tiêu hóa & Test HP',
      metrics: [
        { name: 'Nội soi Dạ dày', value: 'Loét bờ cong nhỏ', unit: '', status: 'high', referenceRange: 'Bình thường', affectedOrgan: 'stomach' },
        { name: 'Test HP', value: 'Dương tính (+)', unit: '', status: 'high', referenceRange: 'Âm tính', affectedOrgan: 'stomach' }
      ],
      diseases: ['Viêm loét dạ dày - tá tràng', 'Trào ngược dạ dày thực quản (GERD)'],
      allergies: [],
      medications: [
        { name: 'Nexium 40mg', activeIngredient: 'Esomeprazole', dosage: '40mg', purpose: 'Ức chế tiết acid', affectedOrgan: 'stomach' }
      ],
      has_conflict: false,
      raw_summary: 'Ổ loét niêm mạc dạ dày đang tiến triển, trào ngược acid gây ợ chua nóng rát.',
      confirmed: true,
      organ_mappings: [
        { organ_id: 'stomach', severity: 'critical', reason: 'Viêm loét niêm mạc dạ dày & GERD · Kích ứng acid mạnh, kiêng chua cay, đồ chiên rán', nutrient_limits: { avoid_spicy: true, avoid_citrus: true, avoid_fried: true } },
        { organ_id: 'liver', severity: 'safe', reason: 'Men gan ALT 22 U/L · Bình thường', nutrient_limits: {} },
        { organ_id: 'heart', severity: 'safe', reason: 'Huyết áp 118/76 mmHg · Bình thường', nutrient_limits: {} },
        { organ_id: 'kidneys', severity: 'safe', reason: 'eGFR 95 ml/phút · Thận bình thường', nutrient_limits: {} },
        { organ_id: 'pancreas', severity: 'safe', reason: 'Tụy bình thường', nutrient_limits: {} },
        { organ_id: 'joints', severity: 'safe', reason: 'Acid Uric 340 µmol/L · Khớp bình thường', nutrient_limits: {} }
      ]
    }
  },
  {
    id: 'preset-diabetes-t2d',
    name: 'Đái tháo đường Type 2 & Tụy suy kiệt',
    shortName: 'Đái tháo đường T2D (Tụy)',
    tag: 'Tuyến tụy',
    targetOrgan: 'pancreas',
    badgeColor: 'border-purple-400 bg-purple-50 text-purple-800',
    diseaseName: 'Đái tháo đường Type 2, Tăng đường huyết',
    description: 'HbA1c 9.2%, Glucose đói 12.4 mmol/L, rối loạn chuyển hóa carbohydrate',
    extraction: {
      id: 'rec-diabetes',
      name: 'Xet-nghiem-Duong-huyet-HbA1c.pdf',
      date: new Date().toISOString().slice(0, 10),
      type: 'Xét nghiệm Nội tiết & Chuyển hóa',
      metrics: [
        { name: 'HbA1c', value: 9.2, unit: '%', status: 'high', referenceRange: '< 5.7', affectedOrgan: 'pancreas' },
        { name: 'Glucose đói', value: 12.4, unit: 'mmol/L', status: 'high', referenceRange: '3.9 - 6.4', affectedOrgan: 'pancreas' }
      ],
      diseases: ['Đái tháo đường Type 2'],
      allergies: [],
      medications: [
        { name: 'Glucophage', activeIngredient: 'Metformin', dosage: '850mg', purpose: 'Hạ đường huyết', affectedOrgan: 'pancreas' }
      ],
      has_conflict: false,
      raw_summary: 'Đường huyết tăng cao vượt ngưỡng an toàn, chức năng tiết insulin của tụy suy giảm nghiêm trọng.',
      confirmed: true,
      organ_mappings: [
        { organ_id: 'pancreas', severity: 'critical', reason: 'HbA1c: 9.2% · Glucose: 12.4 mmol/L · Tụy suy kiệt chức năng tiết insulin, kiểm soát GI nghiêm ngặt', nutrient_limits: { gi_max: 45, carb_ratio_max: 40, free_sugar_g: 0 } },
        { organ_id: 'heart', severity: 'warning', reason: 'Tăng nguy cơ xơ vữa mạch máu và biến chứng tim mạch do đường huyết cao kéo dài', nutrient_limits: { sodium_max_mg: 1800 } },
        { organ_id: 'kidneys', severity: 'warning', reason: 'Đề phòng biến chứng thận đái tháo đường (Diabetic Nephropathy)', nutrient_limits: {} },
        { organ_id: 'liver', severity: 'safe', reason: 'Men gan bình thường', nutrient_limits: {} },
        { organ_id: 'stomach', severity: 'safe', reason: 'Dạ dày bình thường', nutrient_limits: {} },
        { organ_id: 'joints', severity: 'safe', reason: 'Khớp bình thường', nutrient_limits: {} }
      ]
    }
  },
  {
    id: 'preset-healthy',
    name: 'Cơ thể Khỏe mạnh & Hồi phục hoàn toàn',
    shortName: 'Hồi phục / Toàn thân Khỏe',
    tag: 'An toàn 100%',
    targetOrgan: 'heart',
    badgeColor: 'border-emerald-400 bg-emerald-50 text-emerald-800',
    diseaseName: 'Thể trạng bình thường, Khỏe mạnh',
    description: 'Tất cả các chỉ số sinh hóa máu, huyết áp và nội tạng đạt chuẩn y khoa',
    extraction: {
      id: 'rec-healthy',
      name: 'Kham-suc-khoe-Tong-quat-Tot.pdf',
      date: new Date().toISOString().slice(0, 10),
      type: 'Khám sức khỏe tổng quát',
      metrics: [
        { name: 'eGFR', value: 105, unit: 'ml/phút/1.73m²', status: 'normal', referenceRange: '> 90', affectedOrgan: 'kidneys' },
        { name: 'Huyết áp', value: '115/75', unit: 'mmHg', status: 'normal', referenceRange: '< 120/80', affectedOrgan: 'heart' },
        { name: 'ALT', value: 24, unit: 'U/L', status: 'normal', referenceRange: '< 40', affectedOrgan: 'liver' },
        { name: 'Glucose đói', value: 5.0, unit: 'mmol/L', status: 'normal', referenceRange: '3.9 - 6.4', affectedOrgan: 'pancreas' },
        { name: 'Acid Uric', value: 310, unit: 'µmol/L', status: 'normal', referenceRange: '200 - 420', affectedOrgan: 'joints' }
      ],
      diseases: [],
      allergies: [],
      medications: [],
      has_conflict: false,
      raw_summary: 'Toàn bộ hệ thống cơ quan nội tạng hoạt động tối ưu, không có bệnh nền.',
      confirmed: true,
      organ_mappings: [
        { organ_id: 'heart', severity: 'safe', reason: 'Huyết áp 115/75 mmHg · Tim mạch ổn định tuyệt vời', nutrient_limits: {} },
        { organ_id: 'kidneys', severity: 'safe', reason: 'eGFR 105 ml/phút · Thận lọc máu tối ưu', nutrient_limits: {} },
        { organ_id: 'liver', severity: 'safe', reason: 'ALT: 24 U/L · Men gan rất tốt', nutrient_limits: {} },
        { organ_id: 'stomach', severity: 'safe', reason: 'Tiêu hóa và niêm mạc dạ dày khỏe mạnh', nutrient_limits: {} },
        { organ_id: 'pancreas', severity: 'safe', reason: 'Glucose: 5.0 mmol/L · Chuyển hóa đường hoàn hảo', nutrient_limits: {} },
        { organ_id: 'joints', severity: 'safe', reason: 'Acid Uric: 310 µmol/L · Khớp dẻo dai khỏe mạnh', nutrient_limits: {} }
      ]
    }
  }
]

export function applyPresetMedicalRecord(presetId: string): MedicalPreset | undefined {
  const preset = SAMPLE_MEDICAL_PRESETS.find(p => p.id === presetId)
  if (!preset) return undefined
  set(d => {
    // Reset file records so the newly selected medical case is completely isolated
    d.profile.files = [preset.extraction]
    d.ocrHistory = [preset.extraction]
    d.profile.conditions = cleanAndDeduplicateDiseases(preset.extraction.diseases)
    d.profile.medications = cleanAndDeduplicateMedications(
      preset.extraction.medications.map(m => formatMedicationDisplay(m.name, m.activeIngredient))
    )
    d.activeOrganAlerts = {}
    stripStaleClearedChatMessage(d)
  })
  addMedicalRecord(preset.extraction)
  return preset
}

// ==================== FLOW 3: LOG FOOD SCAN RESULT TO DIARY ====================

export function setSelectedDiaryDate(dateKey: string) {
  set(d => {
    d.selectedDiaryDate = dateKey
    syncDailyNutrientAlerts(d, dateKey)
  })
}

export function syncDailyNutrientAlerts(d: State, dateKey: string) {
  const activeDate = d.selectedDiaryDate || localDateIso()
  if (dateKey !== activeDate && dateKey !== localDateIso()) return
  const sodiumLimit =
    approvedNutritionLimits(d.profile, d.plans)?.max_sodium_mg ??
    deriveClinicalCeilings(d.profile, d.profile.files?.[0], d.rules).max_sodium_mg
  const dayItems = Object.values(d.diary[dateKey] || {}).flat()
  let totalSodium = 0
  dayItems.forEach(it => {
    const food = d.foods.find(f => f.id === it.foodId) || it.snapshot
    if (food) {
      const ratio = (it.grams || 100) / 100
      totalSodium += (food.sodium || 0) * ratio
    }
  })

  if (!d.activeOrganAlerts) d.activeOrganAlerts = structuredClone(defaultHealthyOrganAlerts)

  if (typeof sodiumLimit === 'number' && totalSodium > sodiumLimit) {
    const dayLabel = dateKey === localDateIso() ? 'hôm nay' : `ngày ${dateKey}`
    if (d.activeOrganAlerts.kidneys) {
      d.activeOrganAlerts.kidneys = {
        ...d.activeOrganAlerts.kidneys,
        severity: 'critical',
        reason: `Cảnh báo vi chất: Natri ${dayLabel} (${Math.round(totalSodium)} mg) vượt giới hạn đã duyệt ${sodiumLimit} mg/ngày`
      }
    }
    if (d.activeOrganAlerts.heart) {
      d.activeOrganAlerts.heart = {
        ...d.activeOrganAlerts.heart,
        severity: 'critical',
        reason: `Cảnh báo tim mạch: Natri ${dayLabel} (${Math.round(totalSodium)} mg) vượt giới hạn đã duyệt ${sodiumLimit} mg/ngày`
      }
    }
  } else {
    // Restore baseline from latest confirmed medical record or default healthy status (L15)
    const latest = d.profile.files?.[0]
    const restoreOrgan = (orgId: 'kidneys' | 'heart') => {
      const base = latest?.organ_mappings?.find(m => m.organ_id === orgId) || defaultHealthyOrganAlerts[orgId]
      if (/^Cảnh báo (vi chất|tim mạch): Natri/.test(d.activeOrganAlerts[orgId]?.reason || '')) {
        d.activeOrganAlerts[orgId] = structuredClone(base)
      }
    }
    restoreOrgan('kidneys')
    restoreOrgan('heart')
  }
}

export function logFoodScanToDiary(scan: FoodScanResult, slot: Slot = 'Bữa trưa', dayIso?: string) {
  const dateKey = dayIso || localDateIso()
  const weight = (scan.estimated_weight_g && scan.estimated_weight_g > 0) ? scan.estimated_weight_g : 100
  const factor = 100 / weight

  set(d => {
    const newFoodId = 'FS_' + uid()
    const per100 = {
      kcal: (scan.macros?.kcal || 0) * factor,
      protein: (scan.macros?.protein || 0) * factor,
      fat: (scan.macros?.fat || 0) * factor,
      carb: (scan.macros?.carb || 0) * factor,
      fiber: 2 * factor,
      sodium: (scan.micros?.sodium_mg || 0) * factor,
      gi: scan.gi ?? (scan.suitability === 'DANGER' ? 70 : 50),
      allergens: '',
      purine: scan.micros?.purine || 'Thấp',
      potassium: (scan.micros?.potassium_mg || 0) * factor
    }
    d.foods.push({
      id: newFoodId,
      name: scan.dish_name,
      category: 'Quét AI',
      serving: `${weight} g`,
      ...per100
    })

    d.diary[dateKey] ??= {}
    d.diary[dateKey][slot] ??= []
    d.diary[dateKey][slot].push({
      foodId: newFoodId,
      grams: weight,
      foodName: scan.dish_name,
      snapshot: per100,
      note: `Quét AI: ${scan.suitability} · ${Math.round(scan.macros?.kcal || 0)} kcal, Đạm ${scan.macros?.protein || 0}g, Natri ${Math.round(scan.micros?.sodium_mg || 0)}mg (${scan.suitability_reason || 'Đã đối chiếu an toàn lâm sàng'})`
    })

    if (scan.organ_impacts && scan.organ_impacts.length > 0) {
      scan.organ_impacts.forEach(imp => {
        if (d.activeOrganAlerts && d.activeOrganAlerts[imp.organ_id]) {
          if (imp.severity === 'critical') {
            d.activeOrganAlerts[imp.organ_id].severity = 'critical'
            d.activeOrganAlerts[imp.organ_id].reason = `Ảnh hưởng sau ăn: ${imp.message}`
          }
        }
      })
    }

    syncDailyNutrientAlerts(d, dateKey)
    log(d, 'Ghi nhận Món ăn qua AI Vision', `${scan.dish_name} [${scan.suitability}]`)
  })
}

// ==================== FLOW 4 & 5: HITL EXPERT APPROVAL & OVERRIDE ====================

function syncWorkflowRunHitlDecision(
  d: State,
  plan: Plan,
  decision: 'APPROVED' | 'REJECTED' | 'REOPENED',
  detail: string
) {
  const now = new Date().toISOString()
  for (const run of d.workflowRuns || []) {
    if (run.payload?.planId !== plan.id) continue
    run.updatedAt = now
    const routingStep = run.steps.find(st => st.name === 'hitl_routing')
    if (decision === 'REOPENED') {
      run.status = 'PAUSED_HITL'
      run.currentStep = 'hitl_routing'
      run.error = undefined
      if (routingStep) routingStep.status = 'paused'
    } else {
      run.status = 'COMPLETED'
      run.currentStep = decision === 'APPROVED' ? 'hitl_approved' : 'hitl_rejected'
      run.error = decision === 'REJECTED' ? detail : undefined
      if (routingStep) {
        routingStep.status = 'completed'
        routingStep.detail = detail
      }
      const existingDecision = run.steps.find(st => st.name === 'hitl_decision')
      if (existingDecision) {
        existingDecision.status = decision === 'APPROVED' ? 'completed' : 'failed'
        existingDecision.detail = `${decision} (v${plan.version || 1}): ${detail}`
      } else {
        run.steps.push({
          name: 'hitl_decision',
          status: decision === 'APPROVED' ? 'completed' : 'failed',
          detail: `${decision} (v${plan.version || 1}): ${detail}`,
          durationMs: 1
        })
      }
      if (!d.traceSpans) d.traceSpans = []
      d.traceSpans.unshift({
        spanId: 'sp-' + uid(),
        traceId: run.traceId,
        name: decision === 'APPROVED' ? 'hitl:expert_approved' : 'hitl:expert_rejected',
        kind: 'guardrail',
        status: decision === 'APPROVED' ? 'ok' : 'blocked',
        startTime: now,
        endTime: now,
        durationMs: 1,
        attributes: {
          detail: `${plan.expert_name || 'Chuyên gia'} · v${plan.version || 1} · ${detail}`
        }
      })
    }
  }
}

export function approvePlan(
  planId: string,
  expertNotes: string = '',
  hardLimits?: Record<string, number>,
  expectedPatientId?: string
) {
  let err = ''
  set(d => {
    const actor = me(d)
    if (!actor || (actor.role !== 'expert' && actor.role !== 'admin')) {
      err = !actor
        ? 'Cần đăng nhập tài khoản Chuyên gia hoặc Quản trị đang hoạt động để phê duyệt thực đơn.'
        : 'Bệnh nhân không có quyền tự phê duyệt thực đơn lâm sàng.'
      log(d, 'Từ chối phân quyền duyệt', planId)
      return
    }
    if (expectedPatientId && d.activePatientId !== expectedPatientId) {
      err = 'Hồ sơ bệnh nhân đang chọn đã thay đổi. Vui lòng mở lại kế hoạch đúng bệnh nhân trước khi phê duyệt.'
      return
    }
    const plan = d.plans.find(p => p.id === planId)
    if (!plan) {
      err = 'Không tìm thấy kế hoạch thực đơn trong hồ sơ bệnh nhân đang chọn.'
      return
    }
    const note = expertNotes || 'Chuyên gia đã thẩm định và xác nhận các chỉ số trong ngưỡng an toàn.'
    if (plan.status === 'EXPERT_APPROVED') {
      if (plan.expert_notes === note) {
        return
      }
      err = 'Thực đơn đã được phê duyệt trước đó. Không thể ghi đè trực tiếp ghi chú hoặc trạng thái; hãy điều chỉnh món để tạo yêu cầu thẩm định lại.'
      log(d, 'Chặn duyệt lại thực đơn khác ghi chú', plan.name)
      return
    }
    if (plan.status !== 'PENDING_EXPERT_REVIEW') {
      err = `Không thể phê duyệt thực đơn ở trạng thái ${plan.status}. Chỉ chấp nhận thực đơn đang chờ thẩm định (PENDING_EXPERT_REVIEW).`
      log(d, 'Chặn duyệt thực đơn sai trạng thái', `${plan.name} (${plan.status})`)
      return
    }
    if (!isCurrentMealPlan(plan, d.profile)) {
      err = nutritionProfileIssue(d.profile) || 'Hồ sơ đã thay đổi. Hãy tạo lại thực đơn trước khi phê duyệt.'
      return
    }
    if (hardLimits && Object.values(hardLimits).some(limit => !Number.isFinite(limit) || limit <= 0)) {
      err = 'Giới hạn dinh dưỡng phải là số hữu hạn lớn hơn 0.'
      return
    }
    const mergedPlan: Plan = hardLimits
      ? { ...plan, hard_limits: { ...(plan.hard_limits || {}), ...hardLimits } }
      : plan
    const invariants = validatePlanInvariants(mergedPlan, d.profile, d, plan.requiredMeals || 3)
    if (invariants.length > 0) {
      err = invariants[0]
      log(d, 'Chặn duyệt thực đơn không hợp lệ', invariants[0])
      return
    }
    plan.status = 'EXPERT_APPROVED'
    plan.expert_notes = note
    plan.expert_name = actor.name
    plan.reviewed_at = new Date().toISOString()
    plan.version = (plan.version || 1) + 1
    if (hardLimits) plan.hard_limits = { ...(plan.hard_limits || {}), ...hardLimits }
    plan.history.push(`Phê duyệt lâm sàng bởi ${plan.expert_name} lúc ${new Date().toLocaleTimeString('vi-VN')}`)
    syncWorkflowRunHitlDecision(d, plan, 'APPROVED', note)
    log(d, 'Phê duyệt Lâm sàng (EXPERT_APPROVED)', plan.name)
  })
  return err
}

export function rejectPlan(planId: string, reason: string, expectedPatientId?: string) {
  let err = ''
  set(d => {
    const actor = me(d)
    if (!actor || (actor.role !== 'expert' && actor.role !== 'admin')) {
      err = !actor
        ? 'Cần đăng nhập tài khoản Chuyên gia hoặc Quản trị đang hoạt động để từ chối thực đơn.'
        : 'Bệnh nhân không có quyền từ chối ở cổng thẩm định chuyên gia.'
      log(d, 'Từ chối phân quyền từ chối kế hoạch', planId)
      return
    }
    if (expectedPatientId && d.activePatientId !== expectedPatientId) {
      err = 'Hồ sơ bệnh nhân đang chọn đã thay đổi. Vui lòng mở lại kế hoạch đúng bệnh nhân.'
      return
    }
    const plan = d.plans.find(p => p.id === planId)
    if (!plan) {
      err = 'Không tìm thấy kế hoạch thực đơn trong hồ sơ bệnh nhân đang chọn.'
      return
    }
    if (plan.status !== 'PENDING_EXPERT_REVIEW') {
      err = `Không thể từ chối thực đơn ở trạng thái ${plan.status}. Chỉ chấp nhận thực đơn đang chờ thẩm định (PENDING_EXPERT_REVIEW).`
      log(d, 'Chặn từ chối thực đơn sai trạng thái', `${plan.name} (${plan.status})`)
      return
    }
    plan.status = 'REJECTED'
    plan.expert_notes = reason
    plan.expert_name = actor.name
    plan.reviewed_at = new Date().toISOString()
    plan.version = (plan.version || 1) + 1
    plan.history.push(`Từ chối kế hoạch: ${reason}`)
    syncWorkflowRunHitlDecision(d, plan, 'REJECTED', reason)
    log(d, 'Từ chối Kế hoạch (REJECTED)', plan.name)
  })
  return err
}

export function swapDishInPlan(
  planId: string,
  dayIdx: number,
  slot: string,
  itemIdx: number,
  newFood: { foodId: string; foodName: string; grams: number }
): string {
  let err = ''
  if (!Number.isFinite(newFood.grams) || newFood.grams <= 0 || newFood.grams > 1500) {
    return 'Khẩu phần (gram) phải nằm trong khoảng 1g - 1500g.'
  }
  set(d => {
    const plan = d.plans.find(p => p.id === planId)
    if (!plan || !plan.days[dayIdx] || !plan.days[dayIdx][slot]) return
    if (!isCurrentMealPlan(plan, d.profile)) {
      err = 'Hãy cập nhật hồ sơ và tạo lại thực đơn trước khi sửa món.'
      return
    }
    const f = d.foods.find(x => x.id === newFood.foodId)
    if (!f) {
      err = 'Mã thực phẩm không tồn tại trong danh mục.'
      return
    }
    const al = d.profile.allergies.toLowerCase().split(',').map(x => x.trim()).filter(Boolean)
    if (al.some(a => f.allergens.toLowerCase().includes(a) || f.name.toLowerCase().includes(a))) {
      err = `Không thể đổi sang món "${f.name}" vì trùng dị ứng đã khai báo (${f.allergens}).`
      return
    }
    const ddi = evaluateDrugDietInteractions(d.profile, [{ foodId: f.id, foodName: f.name, grams: newFood.grams }], d.foods)
    if (ddi.length > 0 && me(d)?.role !== 'expert') {
      err = `Cảnh báo tương tác thuốc/bệnh lý: ${ddi[0]}`
      return
    }
    const old = plan.days[dayIdx][slot][itemIdx]
    plan.days[dayIdx][slot][itemIdx] = {
      foodId: f.id,
      grams: Math.max(10, Math.round(newFood.grams)),
      foodName: f.name,
      note: 'Đã đổi món',
      snapshot: {
        kcal: f.kcal, protein: f.protein, fat: f.fat, carb: f.carb, fiber: f.fiber,
        sodium: f.sodium, potassium: f.potassium, gi: f.gi, purine: f.purine, allergens: f.allergens
      }
    }
    // Any content modification invalidates prior approval regardless of editor role (E2E-06)
    if (plan.status === 'EXPERT_APPROVED') {
      plan.status = 'PENDING_EXPERT_REVIEW'
      plan.expert_notes = 'Thực đơn đã thay đổi món sau khi duyệt, cần thẩm định & phê duyệt lại trước khi áp dụng.'
      plan.reviewed_at = undefined
      syncWorkflowRunHitlDecision(d, plan, 'REOPENED', 'Mở lại thẩm định do thay đổi món sau khi duyệt')
    }
    plan.version = (plan.version || 1) + 1
    plan.history.push(`Đổi món tại ${slot}: ${old?.foodName || old?.foodId} -> ${f.name}`)
    log(d, 'Đổi món trong thực đơn', `${slot}: ${f.name}`)
  })
  return err
}

export function updateDishGramsInPlan(
  planId: string,
  dayIdx: number,
  slot: string,
  itemIdx: number,
  grams: number
): string {
  let err = ''
  if (!Number.isFinite(grams) || grams < 1 || grams > 1500) {
    return 'Khẩu phần (gram) phải nằm trong khoảng 1g - 1500g.'
  }
  set(d => {
    const plan = d.plans.find(p => p.id === planId)
    const item = plan?.days[dayIdx]?.[slot]?.[itemIdx]
    if (!plan || !item) {
      err = 'Không tìm thấy món ăn trong thực đơn.'
      return
    }
    if (!isCurrentMealPlan(plan, d.profile)) {
      err = 'Hồ sơ đã thay đổi. Hãy tạo lại thực đơn trước khi chỉnh khẩu phần.'
      return
    }
    const prev = item.grams
    item.grams = Math.round(grams)
    // Any content modification invalidates prior approval regardless of editor role (E2E-06)
    if (plan.status === 'EXPERT_APPROVED') {
      plan.status = 'PENDING_EXPERT_REVIEW'
      plan.expert_notes = 'Định lượng khẩu phần đã thay đổi sau khi duyệt, cần thẩm định & phê duyệt lại trước khi áp dụng.'
      plan.reviewed_at = undefined
      syncWorkflowRunHitlDecision(d, plan, 'REOPENED', 'Mở lại thẩm định do chỉnh khẩu phần sau khi duyệt')
    }
    plan.version = (plan.version || 1) + 1
    plan.history.push(`Chỉnh định lượng ${item.foodName || item.foodId} (${slot}): ${prev}g -> ${item.grams}g`)
    log(d, 'Cập nhật khẩu phần thực đơn', `${item.foodName || item.foodId}: ${item.grams}g`)
  })
  return err
}

export function deleteFoodSafe(foodId: string) {
  set(d => {
    const f = d.foods.find(x => x.id === foodId)
    if (!f) return
    const snap = {
      kcal: f.kcal, protein: f.protein, fat: f.fat, carb: f.carb, fiber: f.fiber,
      sodium: f.sodium, potassium: f.potassium, gi: f.gi, purine: f.purine, allergens: f.allergens
    }
    // Preserve snapshot nutrition on all historical diary & plan items before removing from catalog (BOS-11)
    Object.values(d.diary || {}).forEach(dayObj => {
      Object.values(dayObj || {}).forEach(items => {
        items.forEach(it => {
          if (it.foodId === foodId && !it.snapshot) {
            it.foodName = it.foodName || f.name
            it.snapshot = { ...snap }
          }
        })
      })
    })
    d.plans?.forEach(plan => {
      plan.days?.forEach(dayObj => {
        Object.values(dayObj || {}).forEach(items => {
          items.forEach(it => {
            if (it.foodId === foodId && !it.snapshot) {
              it.foodName = it.foodName || f.name
              it.snapshot = { ...snap }
            }
          })
        })
      })
    })
    d.foods = d.foods.filter(x => x.id !== foodId)
    log(d, 'Xóa thực phẩm', f.name)
  })
}

// ==================== NEW AI FUNCTIONS STATE ACTIONS ====================

export function rebalanceRemainingMeals(
  dayIso: string,
  newSlots: Record<string, Array<Item & { kcal?: number; protein?: number; carb?: number; fat?: number; sodium?: number }>>,
  explanation: string
) {
  set(d => {
    if (nutritionProfileIssue(d.profile)) return
    d.diary[dayIso] ??= {}
    Object.entries(newSlots).forEach(([slot, items]) => {
      const normalizedItems: Item[] = (Array.isArray(items) ? items : []).map(it => {
        const grams = Number(it.grams) > 0 ? Number(it.grams) : 120
        const name = (it.foodName || '').trim() || 'Món ăn cân bằng'
        let existing = (it.foodId && d.foods.find(f => f.id === it.foodId))
          || d.foods.find(f => f.name.toLowerCase() === name.toLowerCase())

        if (!existing) {
          const factor = 100 / grams
          const estKcal = it.snapshot ? it.snapshot.kcal : Math.round((Number(it.kcal) > 0 ? Number(it.kcal) : 140) * factor * 10) / 10
          const estProtein = it.snapshot ? it.snapshot.protein : Math.round((Number(it.protein) >= 0 && it.protein !== undefined ? Number(it.protein) : 8) * factor * 10) / 10
          const estCarb = it.snapshot ? it.snapshot.carb : Math.round((Number(it.carb) >= 0 && it.carb !== undefined ? Number(it.carb) : 18) * factor * 10) / 10
          const estFat = it.snapshot ? it.snapshot.fat : Math.round((Number(it.fat) >= 0 && it.fat !== undefined ? Number(it.fat) : 3) * factor * 10) / 10
          const estSodium = it.snapshot ? it.snapshot.sodium : Math.round((Number(it.sodium) >= 0 && it.sodium !== undefined ? Number(it.sodium) : 60) * factor * 10) / 10
          const newId = 'RB_' + uid()
          existing = {
            id: newId,
            name,
            category: slot === 'Bữa phụ' ? 'Trái cây' : 'Món cân bằng AI',
            kcal: estKcal,
            protein: estProtein,
            fat: estFat,
            carb: estCarb,
            fiber: it.snapshot?.fiber ?? 2,
            sodium: estSodium,
            gi: it.snapshot?.gi ?? 45,
            allergens: '',
            serving: `${grams} g`,
            purine: 'Thấp',
            potassium: 150
          }
          d.foods.push(existing)
        }

        return {
          foodId: existing.id,
          foodName: existing.name,
          grams,
          note: it.note,
          snapshot: {
            kcal: existing.kcal, protein: existing.protein, fat: existing.fat, carb: existing.carb,
            fiber: existing.fiber, sodium: existing.sodium, potassium: existing.potassium, gi: existing.gi, purine: existing.purine
          }
        }
      })
      d.diary[dayIso][slot] = normalizedItems
    })
    syncDailyNutrientAlerts(d, dayIso)
    log(d, 'AI Tự động Cân bằng Bữa ăn', explanation.slice(0, 60))
  })
}

export function addExtractedRule(rule: {
  title: string
  condition: string
  maxSodium: number
  maxGI: number
  avoidCategories: string
  reference: string
  evidence_quote?: string
}): string {
  if (!Number.isFinite(rule.maxSodium) || rule.maxSodium < 100 || rule.maxSodium > 5000) {
    return 'Ngưỡng Natri không hợp lệ (phải nằm trong khoảng 100 - 5,000 mg/ngày).'
  }
  if (!Number.isFinite(rule.maxGI) || rule.maxGI < 10 || rule.maxGI > 100) {
    return 'Chỉ số GI không hợp lệ (phải nằm trong khoảng 10 - 100).'
  }
  set(d => {
    d.rules.unshift({
      id: 'rule-' + uid(),
      title: rule.title,
      condition: rule.condition,
      maxSodium: rule.maxSodium,
      maxGI: rule.maxGI,
      avoidCategories: rule.avoidCategories,
      reference: rule.reference,
      evidence_quote: rule.evidence_quote,
      status: 'Chờ duyệt'
    })
    log(d, 'AI Trích xuất Quy tắc Dinh dưỡng', rule.title)
  })
  return ''
}

export function setTrendPrediction(prediction: any) {
  set(d => {
    d.trendPrediction = prediction
    log(d, 'AI Dự báo Xu hướng & Thiếu chất', 'Cập nhật phân tích 7 ngày')
  })
}

// ==================== TIER 2 & TIER 3 ACTIONS (OPEN KNOWLEDGE & HITL FORWARD) ====================

export function saveOpenKnowledgeFoodToSystem(foodData: {
  name: string
  kcal: number
  protein: number
  carb: number
  fat: number
  sodium: number
  potassium?: number
  purine?: 'Thấp' | 'Vừa' | 'Cao' | string
  category?: string
  note?: string
}) {
  const newFoodId = 'OPEN_' + uid()
  const purineVal: 'Thấp' | 'Vừa' | 'Cao' =
    foodData.purine === 'Thấp' || foodData.purine === 'Cao' ? foodData.purine : 'Vừa'

  set(d => {
    d.foods.unshift({
      id: newFoodId,
      name: foodData.name,
      category: foodData.category || 'Món mới (AI Mở rộng)',
      kcal: Math.round(foodData.kcal),
      protein: Math.round(foodData.protein * 10) / 10,
      fat: Math.round(foodData.fat * 10) / 10,
      carb: Math.round(foodData.carb * 10) / 10,
      fiber: 2,
      sodium: Math.round(foodData.sodium),
      gi: 50,
      allergens: '',
      serving: '1 suất chuẩn',
      purine: purineVal,
      potassium: foodData.potassium || 200
    })
    log(d, 'Lưu Món Mới vào Hệ thống (AI Open Knowledge)', foodData.name)
  })
  return newFoodId
}

export function forwardQuestionToExpertReview(
  question: string,
  aiAnswer: string,
  sourceType: string
) {
  set(d => {
    const docId = 'doc-exp-' + uid()
    d.docs.unshift({
      id: docId,
      title: `Yêu cầu Thẩm định: ${question.slice(0, 45)}...`,
      condition: d.profile.conditions[0] || 'Tư vấn Dinh dưỡng Đa bệnh lý',
      content: `CÂU HỎI BỆNH NHÂN:\n${question}\n\nTRỢ LÝ AI ĐÃ PHẢN HỒI (${sourceType}):\n${aiAnswer}`,
      status: 'Chờ duyệt',
      comment: 'Trợ lý AI CDSS gửi chuyên gia thẩm định do câu hỏi mở rộng ngoài hệ thống'
    })
    log(d, 'Gửi Câu hỏi & Tư vấn tới Bác sĩ (HITL)', question.slice(0, 50))
  })
}
