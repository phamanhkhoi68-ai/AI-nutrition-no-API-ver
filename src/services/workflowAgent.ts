import { get, set, log, uid, recordWorkflowRun } from './store'
import { callMcpTool, toOpenAIToolsSchema, type McpToolName } from './mcpTools'
import {
  generateMenuPlanAI,
  askNutritionAI,
  getApiKey,
  getBaseUrl,
  getModelName,
  getCompactPatientContext,
  type HybridConsultationResult
} from './aiService'
import { runInputGuardrails, runOutputGuardrails } from './guardrails'
import { routeChatCompletion, probeGatewayHealth } from './modelRouter'
import { hybridRetrieveChunks } from './ragEngine'
import { startSpan, newTraceId } from './observability'
import { calc, tdee, deriveClinicalCeilings, evaluateDrugDietInteractions, localDateIso, validatePlanInvariants, isCurrentMealPlan, nutritionProfileIssue, rebalanceDayPortions } from '../utils/nutrition'
import type { AgentTrajectoryStep, Item, Plan, Profile, Food, State, WorkflowRun, WorkflowStepRecord } from '../types'

export interface WorkflowStoreAdapter {
  get: () => State
  set: (fn: (d: State) => State | void) => void
}

export interface ClinicalWorkflowInput {
  daysCount: 1 | 7
  mealsCount: number
  simulateStepFailure?: 'model_reasoning' | 'guardrail_verification'
  injectRepairableViolation?: boolean
  avoidDishNames?: string[]
  userPreferenceNote?: string
  storeAdapter?: WorkflowStoreAdapter
}

export interface AiPlanGenerationStatus {
  active: boolean
  patientId: string | null
  stage: string
}

let aiPlanGenStatus: AiPlanGenerationStatus = { active: false, patientId: null, stage: '' }
let aiPlanGenToken = 0
const aiPlanGenListeners = new Set<() => void>()

export function getAiPlanGenerationStatus(): AiPlanGenerationStatus {
  return aiPlanGenStatus
}

export function subscribeAiPlanGeneration(listener: () => void): () => void {
  aiPlanGenListeners.add(listener)
  return () => { aiPlanGenListeners.delete(listener) }
}

function setAiPlanProgress(next: AiPlanGenerationStatus) {
  aiPlanGenStatus = next
  aiPlanGenListeners.forEach(fn => {
    try { fn() } catch {}
  })
}

function nowIso() {
  return new Date().toISOString()
}

function selfRepairPlanIfNeeded(
  plan: Plan,
  profile: Profile,
  foods: Food[],
  requiredMeals: number,
  steps: WorkflowStepRecord[],
  traceId: string,
  parentSpanId?: string,
  skipLiveTelemetry = false
): { plan: Plan; repairedCount: number } {
  const repaired = structuredClone(plan)
  const ceilings = deriveClinicalCeilings(profile, profile.files?.[0])
  let repairedCount = 0

  for (let loop = 1; loop <= 2; loop++) {
    const t0 = Date.now()
    const errs = validatePlanInvariants(repaired, profile, { foods }, requiredMeals)
    if (errs.length === 0) break

    // Query MCP tool for safe low-sodium / low-GI replacements
    const safePoolRes = callMcpTool('lookup_food_nutrients', { query: 'gạo' }, { traceId, parentSpanId, stepCount: loop, skipLiveTelemetry })
    const backupPool = foods.filter(f => {
      const al = (profile.allergies || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean)
      const isAllergic = al.some(a => f.allergens.toLowerCase().includes(a) || f.name.toLowerCase().includes(a))
      const ddi = evaluateDrugDietInteractions(profile, [{ foodId: f.id, foodName: f.name, grams: 100 }], foods)
      return !isAllergic && ddi.length === 0 && f.sodium <= 150
    })
    const safeSub = backupPool[0] || safePoolRes.data?.foods?.[0] || foods[0]
    const actions: string[] = []

    const al = (profile.allergies || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean)
    const maxSodium = Number(repaired.hard_limits?.max_sodium_mg ?? ceilings.max_sodium_mg)
    const maxProtein = Number(repaired.hard_limits?.max_protein_g ?? ceilings.max_protein_g)
    const usedNamesInPlan = new Set<string>()
    repaired.days.forEach(d => {
      Object.values(d || {}).forEach(slotItems => {
        (slotItems || []).forEach(it => {
          const name = (foods.find(x => x.id === it.foodId)?.name || it.foodName || '').trim().toLowerCase()
          if (name) usedNamesInPlan.add(name)
        })
      })
    })

    repaired.days.forEach((dayObj, dIdx) => {
      // Fix missing required meals
      const slotsNeeded = requiredMeals >= 4
        ? ['Bữa sáng', 'Bữa trưa', 'Bữa tối', 'Bữa phụ']
        : ['Bữa sáng', 'Bữa trưa', 'Bữa tối']
      slotsNeeded.forEach(sl => {
        if ((!dayObj[sl] || dayObj[sl].length === 0) && safeSub) {
          dayObj[sl] = [{ foodId: safeSub.id, foodName: safeSub.name, grams: 100, note: 'Tự sửa bù bữa thiếu' }]
          actions.push(`Ngày ${dIdx + 1}: bổ sung ${sl}`)
        }
      })

      // Replace allergic, DDI-conflicting, or name-mismatched dishes, and clamp invalid grams
      Object.entries(dayObj).forEach(([slot, items]) => {
        items.forEach((it, idx) => {
          if (!Number.isFinite(it.grams) || it.grams <= 0) {
            it.grams = 100
            actions.push(`Sửa khẩu phần hợp lệ cho ${it.foodName || it.foodId}`)
          }
          const f = foods.find(x => x.id === it.foodId)
          const hasAllergy = f && al.some(a => f.allergens.toLowerCase().includes(a) || f.name.toLowerCase().includes(a))
          const ddi = evaluateDrugDietInteractions(profile, [it], foods)
          if ((hasAllergy || ddi.length > 0) && safeSub) {
            dayObj[slot][idx] = {
              foodId: safeSub.id,
              foodName: safeSub.name,
              grams: Math.min(120, it.grams || 100),
              note: `AI Self-Repair thay "${it.foodName || it.foodId}" (vi phạm dị ứng/DDI)`
            }
            actions.push(`Thay ${it.foodName || it.foodId} → ${safeSub.name}`)
          } else if (f && it.foodName && f.name.toLowerCase() !== it.foodName.toLowerCase()) {
            it.foodName = f.name
            actions.push(`Đồng bộ tên chuẩn ${f.name}`)
          }
        })
      })

      const allItems = Object.values(dayObj).flat()
      const minEnergyFloor = !nutritionProfileIssue(profile) ? Math.max(1100, Math.round(tdee(profile) * 0.6)) : 1100
      const beforeGrams = allItems.map(i => `${i.foodId}:${i.grams}`).join('|')
      const totals = calc(allItems, foods)
      if (totals.protein > maxProtein || totals.sodium > maxSodium || totals.kcal < minEnergyFloor) {
        rebalanceDayPortions({
          day: dayObj,
          foods,
          maxProtein,
          maxSodium,
          minSafeKcal: minEnergyFloor,
          activeSlots: slotsNeeded,
          usedNamesInPlan,
          isSafeFood: cand => {
            if (!cand) return false
            const pool = `${cand.allergens} ${cand.name}`.toLowerCase()
            if (al.some(a => pool.includes(a))) return false
            return evaluateDrugDietInteractions(profile, [{ foodId: cand.id, foodName: cand.name, grams: 100 }], foods).length === 0
          }
        })
        const afterGrams = Object.values(dayObj).flat().map(i => `${i.foodId}:${i.grams}`).join('|')
        if (afterGrams !== beforeGrams) {
          actions.push(`Ngày ${dIdx + 1}: cân đối lại khẩu phần theo ngưỡng CDSS`)
        }
      }
    })

    if (actions.length > 0) {
      repairedCount++
      repaired.history.push(`[Workflow Self-Repair #${loop}] ${actions.join('; ')}`)
      steps.push({
        name: `self_repair_plan_pass_${loop}`,
        status: 'completed',
        tool: 'lookup_food_nutrients',
        detail: actions.slice(0, 3).join(' | '),
        durationMs: Math.max(1, Date.now() - t0)
      })
    } else {
      break
    }
  }

  return { plan: repaired, repairedCount }
}

export async function runClinicalPlanWorkflow(
  input: ClinicalWorkflowInput,
  existingRun?: WorkflowRun
): Promise<{ run: WorkflowRun; plan?: Plan }> {
  const adapter = input.storeAdapter
  const activeGet = adapter ? adapter.get : get
  const activeSet = adapter ? adapter.set : set
  const persistTelemetry = !adapter

  const s = activeGet()
  const p = s.profile
  const traceId = existingRun?.traceId || newTraceId('wf')
  const rootSpan = startSpan(traceId, `workflow:clinical_menu_plan_${input.daysCount}d`, 'workflow')
  const runId = existingRun?.id || 'wfrun-' + uid()
  const steps: WorkflowStepRecord[] = existingRun ? [...existingRun.steps] : []
  const isCompleted = (stepName: string) => steps.some(st => st.name === stepName && st.status === 'completed')

  const persist = (status: WorkflowRun['status'], currentStep: string, error?: string, payload?: Record<string, any>) => {
    const run: WorkflowRun = {
      id: runId,
      traceId,
      workflowName: `clinical_menu_plan_${input.daysCount}d`,
      status,
      currentStep,
      steps: [...steps],
      payload: payload || { daysCount: input.daysCount, mealsCount: input.mealsCount },
      error,
      createdAt: existingRun?.createdAt || nowIso(),
      updatedAt: nowIso()
    }
    if (adapter) {
      adapter.set(d => {
        if (!d.workflowRuns) d.workflowRuns = []
        const idx = d.workflowRuns.findIndex(w => w.id === run.id)
        if (idx >= 0) d.workflowRuns[idx] = run
        else d.workflowRuns.unshift(run)
      })
    } else {
      recordWorkflowRun(run)
    }
    return run
  }

  const myRunToken = !adapter ? ++aiPlanGenToken : 0
  const emitStage = (stage: string) => {
    if (!adapter && aiPlanGenToken === myRunToken) {
      setAiPlanProgress({ active: true, patientId: s.activePatientId || null, stage })
    }
  }

  try {
    emitStage('Đang đọc bệnh án & tính ngưỡng lâm sàng...')
    const profileIssue = nutritionProfileIssue(p)
    if (profileIssue) {
      steps.push({ name: 'ingest_and_validate', status: 'failed', detail: profileIssue, durationMs: 0 })
      rootSpan.end('error', { errorReason: 'INCOMPLETE_PROFILE' }, persistTelemetry)
      return { run: persist('FAILED', 'ingest_and_validate', profileIssue) }
    }
    // Step 1: Ingest & compute patient ceilings via MCP Tool
    if (!isCompleted('ingest_and_validate')) {
      const t0 = Date.now()
      const ceilingTool = callMcpTool('compute_patient_ceilings', { profile: p }, { traceId, parentSpanId: rootSpan.spanId, stepCount: 1, stateOverride: s, skipLiveTelemetry: !persistTelemetry })
      steps.push({
        name: 'ingest_and_validate',
        status: 'completed',
        tool: 'compute_patient_ceilings',
        detail: `TDEE=${ceilingTool.data?.tdee} kcal, Na<=${ceilingTool.data?.ceilings?.max_sodium_mg}mg`,
        durationMs: Math.max(1, Date.now() - t0)
      })
    }

    // Step 2: Retrieve approved clinical guidelines via MCP Hybrid RAG Tool
    emitStage('Đang tra cứu tài liệu y khoa đã duyệt trong hệ thống...')
    if (!isCompleted('retrieve_knowledge')) {
      const t0 = Date.now()
      const q = (p.conditions || []).join(' ') || 'dinh dưỡng lâm sàng'
      const ragTool = callMcpTool('search_clinical_guidelines', { query: q, docs: s.docs }, { traceId, parentSpanId: rootSpan.spanId, stepCount: 2, stateOverride: s, skipLiveTelemetry: !persistTelemetry })
      steps.push({
        name: 'retrieve_knowledge',
        status: 'completed',
        tool: 'search_clinical_guidelines',
        detail: `Hybrid RRF matched ${ragTool.data?.matchedDocs?.length ?? 0} approved doc(s)`,
        durationMs: Math.max(1, Date.now() - t0)
      })
    }

    // Step 3: Model Reasoning (AI Menu Generation)
    emitStage(`AI đang suy luận thiết kế thực đơn ${input.daysCount} ngày từ bệnh án & tài liệu y tế...`)
    let generatedPlan: Plan | undefined = existingRun?.payload?.plan
    let workingFoods: Food[] = [...activeGet().foods]
    let newlyAddedFoods: Food[] = []
    if (!isCompleted('model_reasoning') || !generatedPlan) {
      const t0 = Date.now()
      if (input.simulateStepFailure === 'model_reasoning') {
        steps.push({ name: 'model_reasoning', status: 'failed', detail: 'Simulated model reasoning outage', durationMs: Math.max(1, Date.now() - t0) })
        rootSpan.end('error', { errorReason: 'SIMULATED_MODEL_OUTAGE' }, persistTelemetry)
        return { run: persist('FAILED', 'model_reasoning', 'Simulated model failure (resumable)') }
      }
      const freshState = activeGet()
      workingFoods = [...freshState.foods]
      const beforeIds = new Set(workingFoods.map(f => f.id))
      const latestRecord = p.files?.[0] || freshState.ocrHistory?.[0]
      generatedPlan = await generateMenuPlanAI(
        p,
        workingFoods,
        freshState.rules,
        input.daysCount,
        input.mealsCount,
        latestRecord,
        freshState.activeOrganAlerts,
        freshState.docs,
        {
          avoidDishNames: input.avoidDishNames,
          userPreferenceNote: input.userPreferenceNote
        }
      )
      newlyAddedFoods = workingFoods.filter(f => !beforeIds.has(f.id))
      generatedPlan.requiredMeals = input.mealsCount

      if (input.injectRepairableViolation) {
        // Inject an intentional high-sodium/allergic dish for Red-Team Self-Repair verification
        const risky = workingFoods.find(f => /tôm/i.test(f.name) || /spinach|chân vịt/i.test(f.name)) || workingFoods[0]
        if (risky && generatedPlan.days[0]?.['Bữa tối']) {
          generatedPlan.days[0]['Bữa tối'].push({ foodId: risky.id, foodName: risky.name, grams: 220, note: 'Injected violation' })
        }
      }

      steps.push({
        name: 'model_reasoning',
        status: 'completed',
        detail: `Generated ${generatedPlan.days.length}d plan (${generatedPlan.id}, ${generatedPlan.generation_source || 'CDSS'})`,
        durationMs: Math.max(1, Date.now() - t0)
      })
    }

    // Step 4: Guardrail Verification + Self-Repair Loop
    emitStage('Đang kiểm định an toàn dị ứng, tương tác thuốc & ngưỡng trần...')
    let repairedLoops = 0
    if (!isCompleted('guardrail_verification')) {
      const t0 = Date.now()
      if (input.simulateStepFailure === 'guardrail_verification') {
        steps.push({ name: 'guardrail_verification', status: 'failed', tool: 'check_clinical_safety_guardrails', detail: 'Simulated guardrail fault', durationMs: Math.max(1, Date.now() - t0) })
        rootSpan.end('error', { errorReason: 'SIMULATED_GUARDRAIL_FAULT' }, persistTelemetry)
        return {
          run: persist('FAILED', 'guardrail_verification', 'Simulated guardrail fault', {
            daysCount: input.daysCount,
            mealsCount: input.mealsCount,
            plan: generatedPlan
          })
        }
      }

      const repairOut = selfRepairPlanIfNeeded(generatedPlan, p, workingFoods, input.mealsCount, steps, traceId, rootSpan.spanId, !persistTelemetry)
      generatedPlan = repairOut.plan
      repairedLoops = repairOut.repairedCount

      const currentFoodsForInvariants = [...activeGet().foods]
      newlyAddedFoods.forEach(nf => {
        if (!currentFoodsForInvariants.some(ef => ef.id === nf.id)) currentFoodsForInvariants.push(nf)
      })

      const day0Items = Object.values(generatedPlan.days?.[0] || {}).flat()
      const safetyTool = callMcpTool('check_clinical_safety_guardrails', { profile: p, items: day0Items }, { traceId, parentSpanId: rootSpan.spanId, stepCount: 4, stateOverride: { ...activeGet(), foods: currentFoodsForInvariants }, skipLiveTelemetry: !persistTelemetry })
      const invariants = validatePlanInvariants(generatedPlan, p, { foods: currentFoodsForInvariants }, input.mealsCount)
      if (invariants.length > 0) {
        steps.push({
          name: 'guardrail_verification',
          status: 'failed',
          tool: 'check_clinical_safety_guardrails',
          detail: invariants[0],
          durationMs: Math.max(1, Date.now() - t0)
        })
        rootSpan.end('error', { errorReason: invariants[0], repairedLoops }, persistTelemetry)
        return {
          run: persist('FAILED', 'guardrail_verification', invariants[0], {
            daysCount: input.daysCount,
            mealsCount: input.mealsCount
          })
        }
      }
      steps.push({
        name: 'guardrail_verification',
        status: 'completed',
        tool: 'check_clinical_safety_guardrails',
        detail: `Safe=${Boolean(safetyTool.data?.safe)}, repairs=${repairedLoops}, invariants passed`,
        durationMs: Math.max(1, Date.now() - t0)
      })
    }

    // Step 5: HITL Routing & Store Commit
    if (!adapter && (activeGet().activePatientId !== s.activePatientId || !isCurrentMealPlan(generatedPlan, activeGet().profile))) {
      throw new Error('Hồ sơ đã thay đổi trong khi xử lý. Hãy tạo lại thực đơn.')
    }
    const tHitl = Date.now()
    const needsHitl = generatedPlan.status === 'PENDING_EXPERT_REVIEW'
    activeSet(d => {
      newlyAddedFoods.forEach(nf => {
        if (!d.foods.some(ef => ef.id === nf.id)) d.foods.push(nf)
      })
      d.plans.unshift(generatedPlan!)
      log(d, `Workflow Agent lập Thực đơn (${input.daysCount} Ngày · ${input.mealsCount} bữa)`, generatedPlan!.name)
    })
    steps.push({
      name: 'hitl_routing',
      status: needsHitl ? 'paused' : 'completed',
      detail: needsHitl ? 'Routed to EXPERT HITL queue' : 'Auto-completed',
      durationMs: Math.max(1, Date.now() - tHitl)
    })
    const finalRun = persist(needsHitl ? 'PAUSED_HITL' : 'COMPLETED', 'hitl_routing', undefined, {
      daysCount: input.daysCount,
      mealsCount: input.mealsCount,
      planId: generatedPlan.id
    })
    rootSpan.end('ok', { repairedLoops, detail: finalRun.status }, persistTelemetry)
    return { run: finalRun, plan: generatedPlan }
  } catch (err: any) {
    rootSpan.end('error', { errorReason: err?.message || 'WORKFLOW_ERROR' }, persistTelemetry)
    return { run: persist('FAILED', 'unexpected_error', err?.message || 'WORKFLOW_ERROR') }
  } finally {
    if (!adapter && aiPlanGenToken === myRunToken) {
      setAiPlanProgress({ active: false, patientId: null, stage: '' })
    }
  }
}

export async function resumeWorkflowRun(runId: string, storeAdapter?: WorkflowStoreAdapter): Promise<{ run: WorkflowRun; plan?: Plan } | null> {
  const activeGet = storeAdapter ? storeAdapter.get : get
  const existing = (activeGet().workflowRuns || []).find(r => r.id === runId)
  if (!existing) return null
  const cleanSteps = existing.steps.filter(s => s.status !== 'failed')
  const daysCount: 1 | 7 = existing.payload?.daysCount === 7 ? 7 : 1
  const mealsCount: number = Number(existing.payload?.mealsCount) || 3
  return runClinicalPlanWorkflow(
    { daysCount, mealsCount, storeAdapter },
    { ...existing, steps: cleanSteps, status: 'RUNNING', error: undefined }
  )
}

/**
 * Kích hoạt ngầm quy trình AI suy luận thực đơn cá nhân hóa sau khi người dùng xác nhận bệnh án hoặc đổi ca mẫu.
 * Chỉ chạy khi có API Key trình duyệt hoặc Backend AI Gateway khả dụng (tránh gọi mạng trong unit test offline).
 */
export async function triggerLiveAiMenuUpgrade(options?: {
  daysCount?: 1 | 7
  mealsCount?: number
  onComplete?: (plan: Plan) => void
}): Promise<Plan | null> {
  try {
    if (!getApiKey()) {
      const gw = await probeGatewayHealth()
      if (!(gw.reachable && gw.hasServerKey)) return null
    }
    const st = get()
    if (nutritionProfileIssue(st.profile)) return null
    const originPatientId = st.activePatientId
    const res = await runClinicalPlanWorkflow({
      daysCount: options?.daysCount ?? 7,
      mealsCount: options?.mealsCount ?? 3
    })
    if (get().activePatientId !== originPatientId) return null
    if (res.plan?.generation_source === 'AI_LIVE') {
      options?.onComplete?.(res.plan)
      return res.plan
    }
    return null
  } catch {
    return null
  }
}

// ==================== REACT AGENT FOR CLINICAL CONSULTATION ====================

export async function runClinicalConsultAgent(
  question: string,
  onToken?: (chunk: string) => void,
  options?: { storeAdapter?: WorkflowStoreAdapter; offlineOnly?: boolean }
): Promise<HybridConsultationResult & { groundingScore: number; agentTrajectory: AgentTrajectoryStep[] }> {
  const adapter = options?.storeAdapter
  const activeGet = adapter ? adapter.get : get
  const persistTelemetry = !adapter

  const s = activeGet()
  const p = s.profile
  const originPatientId = !adapter ? s.activePatientId : undefined
  const traceId = newTraceId('react')
  const rootSpan = startSpan(traceId, 'workflow:clinical_consult_react', 'workflow', undefined, { patientId: originPatientId })
  const steps: WorkflowStepRecord[] = []
  const trajectory: AgentTrajectoryStep[] = []
  const runId = 'wfrun-' + uid()

  const persistConsultRun = (status: WorkflowRun['status'], currentStep: string, error?: string) => {
    const runObj: WorkflowRun = {
      id: runId, traceId, workflowName: 'clinical_consult_react', status,
      currentStep, steps: [...steps], error, createdAt: nowIso(), updatedAt: nowIso()
    }
    if (adapter) {
      adapter.set(d => {
        if (!d.workflowRuns) d.workflowRuns = []
        d.workflowRuns.unshift(runObj)
      })
    } else {
      recordWorkflowRun(runObj, originPatientId)
    }
  }

  // Stage 1: Input Guardrails (PII + Injection + Emergency 115 + Med Dose)
  const tGuard = Date.now()
  const gSpan = startSpan(traceId, 'guardrail:input', 'guardrail', rootSpan.spanId, { patientId: originPatientId })
  const gRes = runInputGuardrails(question)
  if (!gRes.allowed) {
    const msg = gRes.blockMessage || 'Yêu cầu bị chặn bởi Guardrail.'
    onToken?.(msg)
    gSpan.end('blocked', { piiRedactedTypes: gRes.piiRedactedTypes, errorReason: gRes.blockedReason }, persistTelemetry)
    steps.push({ name: 'input_guardrail', status: 'completed', detail: `BLOCKED:${gRes.blockedReason}`, durationMs: Math.max(1, Date.now() - tGuard) })
    persistConsultRun('COMPLETED', 'input_guardrail', gRes.blockedReason)
    rootSpan.end('blocked', { piiRedactedTypes: gRes.piiRedactedTypes }, persistTelemetry)
    return {
      text: msg,
      source_type: 'HIGH_RISK_GUARDRAIL',
      badge_label: gRes.blockedReason === 'PROMPT_INJECTION'
        ? '🛡️ [Guardrail Bảo mật - Chặn Prompt Injection]'
        : '🟠 [Guardrail An toàn Lâm sàng - Cảnh báo Khẩn cấp & Dược lý]',
      badge_color: 'amber',
      evidence_basis: gRes.evidenceBasis,
      groundingScore: 1,
      agentTrajectory: [{
        step: 1,
        thought: `Stage 1 Input Guardrail triggered (${gRes.blockedReason})`,
        observation: 'Returned deterministic clinical safety escalation without calling external model.',
        durationMs: Math.max(1, Date.now() - tGuard)
      }]
    }
  }
  gSpan.end('ok', { piiRedactedTypes: gRes.piiRedactedTypes }, persistTelemetry)
  const cleanQ = gRes.sanitizedText

  const apiKey = options?.offlineOnly ? '' : getApiKey()
  const gw = (!apiKey && !options?.offlineOnly) ? await probeGatewayHealth() : { hasServerKey: false, reachable: false }
  const canCallModel = !options?.offlineOnly && Boolean(apiKey || gw.hasServerKey)

  const todayIso = localDateIso()
  const todayItems = Object.values(s.diary[todayIso] || {}).flat()
  const todayTotals = calc(todayItems, s.foods)
  const rag = hybridRetrieveChunks(cleanQ, s.docs, s.foods, 3)

  // Step 2: ReAct Multi-Turn Tool Calling (online) OR Intent-Based MCP Tool Plan (offline)
  let modelFailureReason: string | undefined
  if (canCallModel) {
    const messages: Array<{ role: string; content: any; tool_call_id?: string; tool_calls?: any[] }> = [
      {
        role: 'system',
        content: `Bạn là ReAct Clinical Nutrition Agent tuân thủ FDA Non-Device CDS.
HỒ SƠ: ${getCompactPatientContext(p, { todayNutrients: todayTotals })}
Khi cần thông tin dinh dưỡng, phác đồ đã duyệt, ngân sách hôm nay hoặc kiểm tra DDI/dị ứng, hãy gọi các MCP tools phù hợp trước khi trả lời. Chỉ trích dẫn chỉ số xét nghiệm có thật trong hồ sơ.
QUY TẮC ĐỊNH DẠNG: Tuyệt đối KHÔNG dùng cú pháp toán LaTeX (như $...$, \\le, \\ge, \\text{...}). Luôn viết văn bản tiếng Việt tự nhiên và dùng ký tự Unicode thông thường (≤, ≥, ±, mg/ngày, g/ngày) để bệnh nhân dễ đọc.`
      },
      { role: 'user', content: cleanQ }
    ]

    try {
      let finalAnswer = ''
      try {
      for (let turn = 1; turn <= 2; turn++) {
        const tStep = Date.now()
        const llmRes = await routeChatCompletion({
          messages,
          apiKey,
          baseUrl: getBaseUrl(),
          configuredModel: getModelName(),
          tier: 'clinical_reasoning',
          tools: turn === 1 ? toOpenAIToolsSchema() : undefined,
          toolChoice: turn === 1 ? 'auto' : undefined,
          expectJson: false,
          traceId,
          parentSpanId: rootSpan.spanId,
          patientId: originPatientId
        })

        if (llmRes.toolCalls.length > 0 && turn === 1) {
          messages.push({
            role: 'assistant',
            content: llmRes.content || '',
            tool_calls: llmRes.toolCalls.map(tc => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
              ...(tc.extra_content ? { extra_content: tc.extra_content } : {})
            }))
          })
          for (const tc of llmRes.toolCalls) {
            const mcpOut = callMcpTool(tc.name as McpToolName, tc.arguments, { traceId, parentSpanId: rootSpan.spanId, stepCount: turn, stateOverride: s, skipLiveTelemetry: !persistTelemetry, patientId: originPatientId })
            const obsText = JSON.stringify(mcpOut.data || { error: mcpOut.error }).slice(0, 1200)
            messages.push({ role: 'tool', tool_call_id: tc.id, content: obsText })
            trajectory.push({
              step: trajectory.length + 1,
              thought: `Model selected MCP tool "${tc.name}"`,
              tool: tc.name,
              toolInput: tc.arguments,
              observation: obsText.slice(0, 220),
              durationMs: mcpOut.durationMs
            })
            steps.push({ name: `react_tool_${tc.name}`, status: mcpOut.ok ? 'completed' : 'failed', tool: tc.name, durationMs: mcpOut.durationMs })
          }
          continue
        }

        finalAnswer = llmRes.content
        trajectory.push({
          step: trajectory.length + 1,
          thought: 'Synthesized grounded clinical answer from observations.',
          observation: finalAnswer.slice(0, 160),
          durationMs: Math.max(1, Date.now() - tStep)
        })
        break
      }

      } catch (loopErr: any) {
        // Vòng ReAct/tool-calling thất bại (timeout, schema tool bị provider từ chối...) -> thử 1 lần gọi thuần văn bản
        // với đầy đủ hồ sơ + ngữ cảnh RAG trước khi rơi xuống chế độ cục bộ.
        if (/CIRCUIT_BREAKER_OPEN|TIMEOUT/i.test(loopErr?.message || '')) throw loopErr  // timeout không được nhân thành nhiều request (QA-10)
        steps.push({ name: 'react_tool_loop', status: 'failed', detail: String(loopErr?.message || loopErr).slice(0, 160), durationMs: 0 })
        const plainRes = await routeChatCompletion({
          messages: [
            { role: 'system', content: `Bạn là Chuyên gia AI Dinh dưỡng Lâm sàng (CDSS).\nHỒ SƠ: ${getCompactPatientContext(p, { todayNutrients: todayTotals })}\nTÀI LIỆU Y KHOA ĐÃ DUYỆT (RAG):\n${rag.contextSnippet || 'Không có tài liệu nội bộ phù hợp, dùng tri thức y khoa chuẩn (KDIGO, ADA, USDA).'}\nChỉ trích dẫn chỉ số xét nghiệm có thật trong hồ sơ. Không kê đơn hay đổi liều thuốc. Trả lời Markdown ngắn gọn.\nQUY TẮC ĐỊNH DẠNG: Tuyệt đối KHÔNG dùng ký hiệu toán học LaTeX (như $...$, \\le, \\ge, \\text{...}). Luôn viết văn bản tiếng Việt tự nhiên và dùng ký tự Unicode thông thường (≤, ≥, ±, mg/ngày, g/ngày).` },
            { role: 'user', content: cleanQ }
          ],
          apiKey,
          baseUrl: getBaseUrl(),
          configuredModel: getModelName(),
          tier: 'fast',
          expectJson: false,
          traceId,
          parentSpanId: rootSpan.spanId,
          patientId: originPatientId
        })
        finalAnswer = plainRes.content
        trajectory.push({
          step: trajectory.length + 1,
          thought: 'Tool-calling không khả dụng -> trả lời trực tiếp từ hồ sơ + RAG đã duyệt.',
          observation: finalAnswer.slice(0, 160),
          durationMs: 1
        })
      }

      if (finalAnswer) {
        const outGuardSpan = startSpan(traceId, 'guardrail:output', 'guardrail', rootSpan.spanId, { patientId: originPatientId })
        const outGuard = runOutputGuardrails({
          responseText: finalAnswer,
          profile: p,
          foods: s.foods,
          retrievedChunks: rag.chunks,
          claimedCitations: rag.matchedDocs.map(d => ({
            guideline_name: d.title,
            citation_url: `internal://docs/${d.id}`,
            rationale: d.content.slice(0, 220)
          }))
        })
        outGuardSpan.end(outGuard.passed ? 'ok' : 'blocked', {
          groundingScore: outGuard.groundingScore,
          errorReason: outGuard.passed ? undefined : outGuard.violations.join('; ')
        }, persistTelemetry)

        // Never stream or display unverified content before Output Guardrail approval (QA-06)
        const checkedText = outGuard.safeResponseText
        onToken?.(checkedText)

        const sourceType = !outGuard.passed
          ? 'HIGH_RISK_GUARDRAIL'
          : rag.hasLocalMatch
          ? 'INTERNAL_RAG'
          : 'AI_OPEN_MEDICAL_KNOWLEDGE'
        persistConsultRun('COMPLETED', 'output_guardrail')
        rootSpan.end(outGuard.passed ? 'ok' : 'blocked', {
          groundingScore: outGuard.groundingScore,
          ragDocIds: rag.matchedDocs.map(d => d.id),
          piiRedactedTypes: gRes.piiRedactedTypes
        }, persistTelemetry)
        return {
          text: checkedText,
          source_type: sourceType,
          badge_label: !outGuard.passed
            ? '🛡️ [Guardrail Đầu ra - Đã chặn nội dung vi phạm]'
            : rag.hasLocalMatch
            ? '🟢 [ReAct Agent · RAG Đã Kiểm Duyệt + MCP Tools]'
            : '🔵 [ReAct Agent · Tri Thức Y Khoa Mở + MCP Tools]',
          badge_color: !outGuard.passed ? 'amber' : rag.hasLocalMatch ? 'green' : 'blue',
          evidence_basis: outGuard.verifiedCitations,
          groundingScore: outGuard.groundingScore,
          agentTrajectory: trajectory
        }
      }
    } catch (err: any) {
      modelFailureReason = err?.message || 'TIMEOUT_OR_PROVIDER_ERROR'
      steps.push({ name: 'react_model_call', status: 'failed', detail: modelFailureReason, durationMs: 0 })
      // Fall through to deterministic MCP-assisted agent trajectory WITHOUT re-calling network (QA-10)
    }
  }

  // Deterministic Offline MCP Agent Execution (ensures full MCP tool trajectory even without live key)
  const plannedTools: Array<{ tool: McpToolName; args: Record<string, any>; thought: string }> = [
    {
      tool: 'compute_patient_ceilings',
      args: {},
      thought: 'Kiểm tra trần dinh dưỡng giao cắt đa bệnh lý từ hồ sơ đang kích hoạt.'
    },
    {
      tool: 'search_clinical_guidelines',
      args: { query: cleanQ, topK: 3 },
      thought: 'Truy xuất Hybrid BM25 + Vector + RRF trên phác đồ đã kiểm duyệt.'
    }
  ]

  if (/hôm nay|đã nạp|natri|calo|tiêu thụ/i.test(cleanQ)) {
    plannedTools.push({
      tool: 'get_patient_daily_intake',
      args: { dateIso: todayIso },
      thought: 'Đọc tổng lượng dinh dưỡng đã tiêu thụ hôm nay và ngân sách còn lại.'
    })
  } else if (rag.matchedFoods.length > 0) {
    plannedTools.push({
      tool: 'check_clinical_safety_guardrails',
      args: { items: rag.matchedFoods.map(f => ({ foodId: f.id, foodName: f.name, grams: 120 })) },
      thought: `Chạy kiểm tra dị ứng & DDI cho món: ${rag.matchedFoods.map(f => f.name).join(', ')}.`
    })
  }

  for (const pt of plannedTools) {
    const out = callMcpTool(pt.tool, pt.args, { traceId, parentSpanId: rootSpan.spanId, stepCount: trajectory.length + 1, stateOverride: s, skipLiveTelemetry: !persistTelemetry, patientId: originPatientId })
    const summary = out.tool === 'compute_patient_ceilings'
      ? `TDEE=${out.data?.tdee} kcal, Na<=${out.data?.ceilings?.max_sodium_mg}mg, Đạm<=${out.data?.ceilings?.max_protein_g}g`
      : out.tool === 'search_clinical_guidelines'
      ? `Matched ${out.data?.matchedDocs?.length ?? 0} docs (topRRF=${out.data?.topScore ?? 0})`
      : JSON.stringify(out.data || {}).slice(0, 180)
    trajectory.push({
      step: trajectory.length + 1,
      thought: pt.thought,
      tool: pt.tool,
      toolInput: pt.args,
      observation: summary,
      durationMs: out.durationMs
    })
    steps.push({ name: `mcp_${pt.tool}`, status: out.ok ? 'completed' : 'failed', tool: pt.tool, durationMs: out.durationMs })
  }

  const consult = await askNutritionAI(
    cleanQ,
    p,
    s.docs,
    { todayNutrients: { kcal: Math.round(todayTotals.kcal), protein: Math.round(todayTotals.protein), sodium: Math.round(todayTotals.sodium) }, activeAlerts: s.activeOrganAlerts },
    s.foods,
    { skipRemoteModel: Boolean(canCallModel || options?.offlineOnly), fallbackReason: modelFailureReason }
  )

  const outGuard = runOutputGuardrails({
    responseText: consult.text,
    profile: p,
    foods: s.foods,
    retrievedChunks: rag.chunks,
    claimedCitations: consult.evidence_basis
  })
  const verifiedText = outGuard.safeResponseText
  onToken?.(verifiedText)

  persistConsultRun('COMPLETED', 'synthesize_and_verify')
  rootSpan.end(outGuard.passed ? 'ok' : 'blocked', { groundingScore: outGuard.groundingScore, ragDocIds: rag.matchedDocs.map(d => d.id), piiRedactedTypes: gRes.piiRedactedTypes }, persistTelemetry)

  return {
    ...consult,
    text: verifiedText,
    source_type: outGuard.passed ? consult.source_type : 'HIGH_RISK_GUARDRAIL',
    badge_label: outGuard.passed ? consult.badge_label : '🛡️ [Guardrail Đầu ra - Đã chặn nội dung vi phạm]',
    badge_color: outGuard.passed ? consult.badge_color : 'amber',
    evidence_basis: outGuard.verifiedCitations,
    groundingScore: outGuard.groundingScore,
    agentTrajectory: trajectory
  }
}
