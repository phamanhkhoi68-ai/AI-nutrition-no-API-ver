export type Role = 'patient' | 'expert' | 'admin'

export interface User {
  id: string
  name: string
  email: string
  password: string
  role: Role
  active: boolean
}

export interface Food {
  id: string
  name: string
  category: string
  kcal: number
  protein: number
  fat: number
  carb: number
  fiber: number
  sodium: number
  gi: number
  allergens: string
  serving: string
  purine?: 'Thấp' | 'Vừa' | 'Cao'
  potassium?: number
}

export interface Condition {
  id: string
  name: string
  status: 'Hỗ trợ' | 'Chưa cấu hình' | 'Tạm ngưng'
}

export type DocStatus = 'Nháp' | 'Chờ duyệt' | 'Đã duyệt' | 'Từ chối'

export interface Rule {
  id: string
  title: string
  condition: string
  maxSodium: number
  maxGI: number
  avoidCategories: string
  reference: string
  status: DocStatus
  evidence_quote?: string
}

export interface Doc {
  id: string
  title: string
  condition: string
  content: string
  status: DocStatus
  comment: string
}

export type OrganId =
  | 'heart'
  | 'liver'
  | 'stomach'
  | 'kidneys'
  | 'pancreas'
  | 'joints'
  | 'lungs'
  | 'brain'
  | 'thyroid'
  | 'throat'
  | 'eyes'
  | 'bladder'
  | 'intestines'
  | 'spine'
  | 'skin'
  | 'gallbladder'
  | 'spleen'
  | string
export type Severity = 'normal' | 'safe' | 'warning' | 'critical'

export interface OrganMapping {
  organ_id: OrganId
  severity: Severity
  reason: string
  nutrient_limits: Record<string, string | number | boolean>
}

export interface LabMetric {
  name: string
  value: number | string
  unit: string
  status: 'normal' | 'high' | 'low'
  referenceRange: string
  affectedOrgan?: OrganId
}

export interface MedicationInfo {
  name: string
  activeIngredient: string
  dosage: string
  purpose: string
  ddiAlert?: string
  affectedOrgan?: OrganId
}

export interface MedicalRecordExtraction {
  id: string
  name: string
  date: string
  type: string
  metrics: LabMetric[]
  diseases: string[]
  allergies: string[]
  medications: MedicationInfo[]
  has_conflict: boolean
  conflict_reason?: string
  organ_mappings: OrganMapping[]
  raw_summary: string
  confirmed: boolean
}

export type OCRExtraction = MedicalRecordExtraction

export interface FoodScanResult {
  dish_name: string
  estimated_weight_g: number
  scan_type?: 'meal' | 'label' | 'menu'
  isFallback?: boolean
  unverified?: boolean
  /** false khi ảnh không chứa món ăn / bao bì thực phẩm */
  is_food?: boolean
  /** Chỉ số đường huyết ước tính của món */
  gi?: number
  /** Độ tin cậy nhận diện 0..1 */
  confidence?: number
  /** Model AI đã phân tích ảnh */
  model?: string
  ingredients: {
    name: string
    weight_g: number
    note?: string
  }[]
  macros: {
    kcal: number
    protein: number
    carb: number
    fat: number
  }
  micros: {
    sodium_mg: number
    potassium_mg: number
    purine: 'Thấp' | 'Vừa' | 'Cao'
    sugar_g: number
  }
  suitability: 'SAFE' | 'CAUTION' | 'DANGER'
  suitability_reason: string
  cooking_tips?: string[]
  menu_recommendations?: {
    name: string
    suitability: 'SAFE' | 'CAUTION' | 'DANGER'
    reason: string
  }[]
  organ_impacts?: {
    organ_id: OrganId
    severity: Severity
    message: string
  }[]
}

export interface EvidenceBasis {
  guideline_name: string
  citation_url: string
  pharmacology_source?: string
  rationale: string
}

export type PlanStatus = 'DRAFT' | 'PENDING_EXPERT_REVIEW' | 'EXPERT_APPROVED' | 'REJECTED'

export interface Item {
  foodId: string
  grams: number
  foodName?: string
  note?: string
  snapshot?: {
    kcal: number
    protein: number
    fat: number
    carb: number
    fiber: number
    sodium: number
    potassium?: number
    gi?: number
    purine?: 'Thấp' | 'Vừa' | 'Cao'
    allergens?: string
  }
}

export type Slot = 'Bữa sáng' | 'Bữa trưa' | 'Bữa tối' | 'Bữa phụ'

export interface Plan {
  id: string
  name: string
  created: string
  personalized: boolean
  status: PlanStatus
  version?: number
  requiredMeals?: number
  profileBasis?: string
  days: Record<string, Item[]>[]
  has_conflict: boolean
  conflict_details?: string
  evidence_basis?: EvidenceBasis[]
  expert_notes?: string
  expert_name?: string
  reviewed_at?: string
  hard_limits?: Record<string, number | boolean | string>
  generation_source?: 'AI_LIVE' | 'LOCAL_FALLBACK'
  generation_note?: string
  ai_reasoning?: string
  day_focuses?: string[]
  referenced_doc_titles?: string[]
  ai_model_used?: string
  fallback_reason?: string
  history: string[]
}

export interface Profile {
  dob: string
  height: number
  weight: number
  activity: number
  goal: string
  allergies: string
  conditions: string[]
  medications: string[]
  files: MedicalRecordExtraction[]
}

export interface Log {
  id: string
  user: string
  action: string
  target: string
  time: string
}

// ==================== NEW AI CDSS ADVANCED TYPES ====================

export interface RebalanceResult {
  rebalanced_slots: Record<string, Item[]>
  explanation: string
  adjustments: {
    slot: string
    changeDescription: string
    savedSodium_mg: number
    savedKcal: number
  }[]
}

export interface DeficiencyPrediction {
  trend_summary: string
  deficiencies: {
    nutrient: string
    risk: 'low' | 'medium' | 'high'
    explanation: string
    safe_food_remedies: string[]
  }[]
  organ_projections: {
    organ_id: OrganId
    status: string
    projection: string
  }[]
}

export interface RuleExtractionResult {
  title: string
  condition: string
  maxSodium: number
  maxGI: number
  avoidCategories: string
  reference: string
  evidence_quote: string
  rationale: string
}

export interface AITrace {
  id: string
  traceId: string
  operation: string
  model: string
  status: 'success' | 'fallback' | 'blocked' | 'error'
  durationMs: number
  promptTokensEst: number
  completionTokensEst: number
  ragDocIds: string[]
  cacheHit: boolean
  errorReason?: string
  time: string
}

export type SpanKind = 'workflow' | 'guardrail' | 'rag' | 'mcp' | 'llm' | 'eval'

export interface TraceSpan {
  spanId: string
  traceId: string
  parentSpanId?: string
  name: string
  kind: SpanKind
  status: 'ok' | 'fallback' | 'blocked' | 'error'
  startTime: string
  endTime: string
  durationMs: number
  attributes: {
    model?: string
    tier?: 'fast' | 'clinical_reasoning' | 'vision' | 'embedding'
    promptTokens?: number
    completionTokens?: number
    costUsd?: number
    cacheHit?: boolean
    ragDocIds?: string[]
    ragTopScore?: number
    groundingScore?: number
    piiRedactedTypes?: string[]
    toolName?: string
    repairedLoops?: number
    errorReason?: string
    detail?: string
    patientId?: string
  }
}

export interface AgentTrajectoryStep {
  step: number
  thought: string
  tool?: string
  toolInput?: Record<string, any>
  observation?: string
  durationMs: number
}

export interface WorkflowStepRecord {
  name: string
  status: 'completed' | 'failed' | 'skipped' | 'paused'
  tool?: string
  detail?: string
  durationMs?: number
}

export interface WorkflowRun {
  id: string
  traceId: string
  workflowName: string
  status: 'RUNNING' | 'COMPLETED' | 'PAUSED_HITL' | 'FAILED'
  currentStep: string
  steps: WorkflowStepRecord[]
  payload?: Record<string, any>
  error?: string
  createdAt: string
  updatedAt: string
}

export interface ChatEntry {
  id?: string
  from: 'u' | 'b'
  text: string
  source_type?: 'INTERNAL_RAG' | 'AI_OPEN_MEDICAL_KNOWLEDGE' | 'HIGH_RISK_GUARDRAIL'
  badge_label?: string
  badge_color?: 'green' | 'blue' | 'amber'
  evidence_basis?: EvidenceBasis[]
  estimated_dish?: {
    name: string
    kcal: number
    protein: number
    carb: number
    fat: number
    sodium: number
    potassium?: number
    purine?: string
    suitability?: 'SAFE' | 'CAUTION' | 'DANGER'
  }
  verified_math?: any
  isFallback?: boolean
  streaming?: boolean
  groundingScore?: number
  agentTrajectory?: AgentTrajectoryStep[]
}

export interface State {
  users: User[]
  foods: Food[]
  conditions: Condition[]
  rules: Rule[]
  docs: Doc[]
  plans: Plan[]
  profile: Profile
  diary: Record<string, Record<string, Item[]>>
  chat: ChatEntry[]
  logs: Log[]
  aiTraces?: AITrace[]
  traceSpans?: TraceSpan[]
  workflowRuns?: WorkflowRun[]
  version?: number
  pendingRecordDraft?: MedicalRecordExtraction | null
  session: string | null
  apiKey?: string
  activeOrganAlerts: Record<OrganId, OrganMapping>
  ocrHistory?: MedicalRecordExtraction[]
  trendPrediction?: DeficiencyPrediction
  activePatientId?: string
  patientRecords?: Record<string, PatientRecord>
  selectedDiaryDate?: string
}

export type PatientRecord = Pick<State, 'profile' | 'plans' | 'diary' | 'chat' | 'activeOrganAlerts' | 'ocrHistory' | 'trendPrediction' | 'pendingRecordDraft' | 'workflowRuns' | 'aiTraces' | 'traceSpans' | 'selectedDiaryDate'>
