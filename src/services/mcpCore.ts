import { calc, deriveClinicalCeilings, evaluateDrugDietInteractions, localDateIso, tdee, isCurrentMealPlan, approvedNutritionLimits, nutritionProfileIssue } from '../utils/nutrition'
import { hybridRetrieveChunks } from './ragEngine'
import { redactPII } from './guardrails'
import type { FHIRNutritionOrder } from '../models/fhir/nutritionOrder'
import type { Doc, Food, Item, Plan, Profile, Rule, State } from '../types'

export type McpToolName =
  | 'search_clinical_guidelines'
  | 'lookup_food_nutrients'
  | 'check_clinical_safety_guardrails'
  | 'compute_patient_ceilings'
  | 'get_patient_daily_intake'
  | 'export_fhir_nutrition_order'

export interface McpToolDefinition {
  name: McpToolName
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, any>
    required?: string[]
  }
}

export interface McpResourceDefinition {
  uri: string
  name: string
  description: string
  mimeType: string
}

export interface McpPromptDefinition {
  name: string
  description: string
  arguments: Array<{ name: string; description: string; required?: boolean }>
}

export type McpContextSnapshot = Pick<State, 'foods' | 'docs' | 'rules' | 'profile' | 'diary' | 'plans' | 'activePatientId'>

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'search_clinical_guidelines',
    description: 'Hybrid BM25 + Vector + RRF retrieval across EXPERT-APPROVED clinical guidelines (RAG docs).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Clinical query (condition, drug, food, or nutrient)' },
        topK: { type: 'number', description: 'Number of chunks to return (default 3)' }
      },
      required: ['query']
    }
  },
  {
    name: 'lookup_food_nutrients',
    description: 'Look up standardized per-100g macros, sodium, GI, potassium, purine, and allergens in the clinical catalog.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Food ID (e.g. F001) or Vietnamese food name keyword' }
      },
      required: ['query']
    }
  },
  {
    name: 'check_clinical_safety_guardrails',
    description: 'Run deterministic allergy, Drug-Diet Interaction (Warfarin/ACEi/Statin/Gout), and nutrient ceiling checks on meal items.',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'List of food items { foodId, foodName?, grams }',
          items: {
            type: 'object',
            properties: {
              foodId: { type: 'string' },
              foodName: { type: 'string' },
              grams: { type: 'number' }
            }
          }
        }
      },
      required: ['items']
    }
  },
  {
    name: 'compute_patient_ceilings',
    description: 'Compute patient BMI, TDEE, and multi-morbidity intersected nutrient ceilings (CKD, T2D, HTN, Gout, Stones, Liver).',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'get_patient_daily_intake',
    description: 'Summarize today consumed calories, protein, sodium, and remaining safe clinical budget.',
    inputSchema: {
      type: 'object',
      properties: {
        dateIso: { type: 'string', description: 'Optional YYYY-MM-DD local date key' }
      }
    }
  },
  {
    name: 'export_fhir_nutrition_order',
    description: 'Convert the active clinical meal plan and safety ceilings into an HL7 FHIR R4 NutritionOrder JSON resource.',
    inputSchema: {
      type: 'object',
      properties: {
        planId: { type: 'string', description: 'Optional Plan ID; defaults to active plan' }
      }
    }
  }
]

export const MCP_RESOURCES: McpResourceDefinition[] = [
  {
    uri: 'cdss://guidelines/approved',
    name: 'Approved Clinical Guidelines',
    description: 'Only expert-verified guidelines indexed for RAG retrieval',
    mimeType: 'application/json'
  },
  {
    uri: 'cdss://foods/catalog',
    name: 'Standardized Food Composition Catalog',
    description: 'Macro and micronutrient database (per 100g)',
    mimeType: 'application/json'
  },
  {
    uri: 'cdss://patient/active-profile',
    name: 'PII-Redacted Clinical Profile Summary',
    description: 'Anonymized active conditions, medications, allergies, and ceilings',
    mimeType: 'application/json'
  }
]

export const MCP_PROMPTS: McpPromptDefinition[] = [
  {
    name: 'clinical_consultation_prompt',
    description: 'FDA Non-Device CDS grounded nutrition consultation prompt with citation rules',
    arguments: [
      { name: 'question', description: 'Patient clinical nutrition question', required: true }
    ]
  },
  {
    name: 'cdss_hitl_briefing_prompt',
    description: 'Expert HITL clinical verification briefing prompt summarizing risks and daily limits',
    arguments: [
      { name: 'planName', description: 'Target clinical plan name', required: true }
    ]
  }
]

export function toOpenAIToolsSchema() {
  return MCP_TOOLS.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema
    }
  }))
}

export function buildFHIRNutritionOrder(
  profile: Profile,
  plan: Plan | undefined,
  rules: Rule[],
  patientId = 'patient-demo-an'
): FHIRNutritionOrder {
  if (!plan || !isCurrentMealPlan(plan, profile)) {
    throw new Error('Cần có thực đơn phù hợp với hồ sơ hiện tại để xuất FHIR.')
  }
  const ceilings = deriveClinicalCeilings(profile, profile.files?.[0], rules)
  const statusMap: Record<Plan['status'], FHIRNutritionOrder['status']> = {
    DRAFT: 'draft',
    PENDING_EXPERT_REVIEW: 'on-hold',
    EXPERT_APPROVED: 'active',
    REJECTED: 'revoked'
  }

  const excludeMods = (profile.allergies || '')
    .split(',')
    .map(a => a.trim())
    .filter(Boolean)
    .map(allergy => ({
      coding: [{ system: 'http://snomed.info/sct', code: '414285001', display: `Allergy: ${allergy}` }],
      text: allergy
    }))

  if (ceilings.avoid_oxalate) {
    excludeMods.push({
      coding: [{ system: 'http://snomed.info/sct', code: '226491003', display: 'High oxalate foods' }],
      text: 'Thực phẩm giàu Oxalate (rau bina, socola, trà đặc)'
    })
  }
  if ((profile.medications || []).some(m => /warfarin|coumadin/i.test(m))) {
    excludeMods.push({
      coding: [{ system: 'http://snomed.info/sct', code: '227493005', display: 'Vitamin K fluctuations' }],
      text: 'Biến thiên Vitamin K đột ngột (tương tác Warfarin)'
    })
  }

  return {
    resourceType: 'NutritionOrder',
    id: plan?.id || `fhir-no-${Date.now()}`,
    status: plan ? statusMap[plan.status] : 'draft',
    intent: plan?.status === 'EXPERT_APPROVED' ? 'order' : 'proposal',
    patient_id: patientId,
    dateTime: plan?.created || new Date().toISOString(),
    orderer: plan?.expert_name || 'AI CDSS Workflow Agent (Pending HITL)',
    oralDiet: {
      type: (profile.conditions || []).map(c => ({
        coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code: 'CDSS', display: c }],
        text: c
      })),
      nutrient: [
        ...(typeof plan.hard_limits?.max_sodium_mg === 'number' && plan.hard_limits.max_sodium_mg > 0 ? [{
          modifier: { coding: [{ system: 'http://snomed.info/sct', code: '39972003', display: 'Sodium' }], text: 'Sodium max daily' },
          amount: { value: plan.hard_limits.max_sodium_mg, unit: 'mg/d', system: 'http://unitsofmeasure.org', code: 'mg/d' }
        }] : []),
        ...(typeof plan.hard_limits?.max_protein_g === 'number' && plan.hard_limits.max_protein_g > 0 ? [{
          modifier: { coding: [{ system: 'http://snomed.info/sct', code: '88878007', display: 'Protein' }], text: 'Protein max daily' },
          amount: { value: plan.hard_limits.max_protein_g, unit: 'g/d', system: 'http://unitsofmeasure.org', code: 'g/d' }
        }] : [])
      ],
      texture: [],
      instruction: plan?.expert_notes || plan?.conflict_details || 'Tuân thủ giới hạn đa bệnh lý CDSS.'
    },
    excludeFoodModifier: excludeMods,
    evidence_basis: plan?.evidence_basis || []
  }
}

export function executeMcpToolCall(
  name: McpToolName,
  args: Record<string, any>,
  ctx: McpContextSnapshot
): any {
  switch (name) {
    case 'search_clinical_guidelines': {
      const query = String(args.query || '').trim()
      if (!query) throw new Error('MISSING_QUERY')
      const docs = Array.isArray(args.docs) ? (args.docs as Doc[]) : ctx.docs
      const topK = Number(args.topK) > 0 ? Number(args.topK) : 3
      const res = hybridRetrieveChunks(query, docs, ctx.foods, topK)
      return {
        matchedDocs: res.matchedDocs.map(d => ({
          id: d.id,
          title: d.title,
          condition: d.condition,
          excerpt: d.content.slice(0, 260)
        })),
        chunks: res.chunks,
        topScore: res.topScore,
        contextSnippet: res.contextSnippet
      }
    }

    case 'lookup_food_nutrients': {
      const q = String(args.query || '').toLowerCase().trim()
      if (!q) throw new Error('MISSING_QUERY')
      const matches = ctx.foods
        .filter(f => f.id.toLowerCase() === q || f.name.toLowerCase().includes(q) || f.category.toLowerCase().includes(q))
        .slice(0, 12)
      return { count: matches.length, foods: matches }
    }

    case 'check_clinical_safety_guardrails': {
      const items = Array.isArray(args.items) ? (args.items as Item[]) : []
      const profile: Profile = args.profile || ctx.profile
      const ddiAlerts = evaluateDrugDietInteractions(profile, items, ctx.foods)
      const allergyList = (profile.allergies || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean)
      const allergyHits = items
        .map(it => ctx.foods.find(f => f.id === it.foodId))
        .filter((f): f is Food => Boolean(f))
        .filter(f => allergyList.some(a => f.allergens.toLowerCase().includes(a) || f.name.toLowerCase().includes(a)))
        .map(f => f.name)
      const totals = calc(items, ctx.foods)
      const profileIssue = nutritionProfileIssue(profile)
      if (profileIssue) return { safe: false, ddiAlerts, allergyHits, breaches: [profileIssue], totals }
      const ceilings = deriveClinicalCeilings(profile, profile.files?.[0], ctx.rules)
      const breaches: string[] = []
      if (totals.sodium > ceilings.max_sodium_mg) breaches.push(`Natri ${Math.round(totals.sodium)}mg > ${ceilings.max_sodium_mg}mg`)
      if (totals.protein > ceilings.max_protein_g) breaches.push(`Đạm ${totals.protein.toFixed(1)}g > ${ceilings.max_protein_g}g`)
      return {
        safe: ddiAlerts.length === 0 && allergyHits.length === 0 && breaches.length === 0,
        ddiAlerts,
        allergyHits,
        breaches,
        totals
      }
    }

    case 'compute_patient_ceilings': {
      const profile: Profile = args.profile || ctx.profile
      const profileIssue = nutritionProfileIssue(profile)
      if (profileIssue) throw new Error(profileIssue)
      const ceilings = deriveClinicalCeilings(profile, profile.files?.[0], ctx.rules)
      const bmi = profile.height > 0 ? Number((profile.weight / ((profile.height / 100) ** 2)).toFixed(1)) : 0
      return { bmi, tdee: tdee(profile), ceilings, limitsPurpose: 'proposal' }
    }

    case 'get_patient_daily_intake': {
      const dateKey = String(args.dateIso || localDateIso())
      const items = Object.values(ctx.diary?.[dateKey] || {}).flat()
      const totals = calc(items, ctx.foods)
      const approvedLimits = approvedNutritionLimits(ctx.profile, ctx.plans)
      return {
        dateIso: dateKey,
        itemCount: items.length,
        totals: {
          kcal: Math.round(totals.kcal),
          protein: Number(totals.protein.toFixed(1)),
          carb: Number(totals.carb.toFixed(1)),
          fat: Number(totals.fat.toFixed(1)),
          sodium: Math.round(totals.sodium)
        },
        remainingBudget: approvedLimits ? {
          sodium_mg: typeof approvedLimits.max_sodium_mg === 'number' ? Math.max(0, Math.round(approvedLimits.max_sodium_mg - totals.sodium)) : null,
          protein_g: typeof approvedLimits.max_protein_g === 'number' ? Math.max(0, Number((approvedLimits.max_protein_g - totals.protein).toFixed(1))) : null
        } : null
      }
    }

    case 'export_fhir_nutrition_order': {
      const plan = args.planId
        ? ctx.plans.find(p => p.id === args.planId)
        : ctx.plans.find(candidate => isCurrentMealPlan(candidate, ctx.profile))
      return buildFHIRNutritionOrder(ctx.profile, plan, ctx.rules, ctx.activePatientId)
    }

    default:
      throw new Error(`UNKNOWN_MCP_TOOL:${String(name)}`)
  }
}

export function readMcpResourceData(uri: string, ctx: McpContextSnapshot): { mimeType: string; text: string } {
  if (uri === 'cdss://guidelines/approved') {
    const approved = ctx.docs.filter(d => d.status === 'Đã duyệt')
    return { mimeType: 'application/json', text: JSON.stringify(approved, null, 2) }
  }
  if (uri === 'cdss://foods/catalog') {
    return { mimeType: 'application/json', text: JSON.stringify(ctx.foods, null, 2) }
  }
  if (uri === 'cdss://patient/active-profile') {
    const ceilings = approvedNutritionLimits(ctx.profile, ctx.plans) || null
    const redactedGoal = redactPII(ctx.profile.goal).sanitizedText
    return {
      mimeType: 'application/json',
      text: JSON.stringify({
        conditions: ctx.profile.conditions,
        medications: ctx.profile.medications,
        allergies: ctx.profile.allergies,
        goal: redactedGoal,
        height: ctx.profile.height,
        weight: ctx.profile.weight,
        ceilings
      }, null, 2)
    }
  }
  throw new Error(`UNKNOWN_RESOURCE:${uri}`)
}

export function getMcpPromptMessages(name: string, args: Record<string, string> = {}) {
  if (name === 'clinical_consultation_prompt') {
    return [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Tuân thủ FDA Non-Device CDS. Trả lời dựa trên hồ sơ bệnh lý, tương tác thuốc và tài liệu đã duyệt cho câu hỏi: "${args.question || ''}".`
        }
      }
    ]
  }
  if (name === 'cdss_hitl_briefing_prompt') {
    return [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Tổng hợp yếu tố nguy cơ, mức trần vi chất và điểm cần bác sĩ kiểm duyệt cho kế hoạch: "${args.planName || ''}".`
        }
      }
    ]
  }
  throw new Error(`UNKNOWN_PROMPT:${name}`)
}

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: Record<string, any>
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number
  result?: any
  error?: { code: number; message: string }
}

export function handleMcpJsonRpc(req: JsonRpcRequest, ctx: McpContextSnapshot): JsonRpcResponse {
  const { id, method, params = {} } = req
  try {
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'ai-nutrition-cdss-mcp', version: '2.0.0' },
          capabilities: { tools: {}, resources: {}, prompts: {} }
        }
      }
    }
    if (method === 'tools/list') {
      return { jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } }
    }
    if (method === 'tools/call') {
      const toolName = params.name as McpToolName
      const args = (params.arguments || {}) as Record<string, any>
      const payload = executeMcpToolCall(toolName, args, ctx)
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(payload) }],
          structuredContent: payload
        }
      }
    }
    if (method === 'resources/list') {
      return { jsonrpc: '2.0', id, result: { resources: MCP_RESOURCES } }
    }
    if (method === 'resources/read') {
      const data = readMcpResourceData(String(params.uri || ''), ctx)
      return {
        jsonrpc: '2.0',
        id,
        result: { contents: [{ uri: params.uri, ...data }] }
      }
    }
    if (method === 'prompts/list') {
      return { jsonrpc: '2.0', id, result: { prompts: MCP_PROMPTS } }
    }
    if (method === 'prompts/get') {
      const messages = getMcpPromptMessages(String(params.name || ''), params.arguments || {})
      return { jsonrpc: '2.0', id, result: { messages } }
    }
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } }
  } catch (err: any) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: err?.message || 'MCP_EXECUTION_ERROR' }
    }
  }
}
