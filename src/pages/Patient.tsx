import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Sparkles,
  ArrowRight,
  ArrowUpRight,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Upload,
  Pill,
  Activity,
  TrendingUp,
  Loader2,
  FileText,
  Check,
  Send,
  Info,
  Utensils,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
  RefreshCw,
  Trash2,
  Paperclip,
  MessageCircle
} from 'lucide-react'
import {
  useS,
  get,
  set,
  me,
  log,
  confirmMedicalRecord,
  clearMedicalRecord,
  swapDishInPlan,
  updateDishGramsInPlan,
  setPendingRecordDraft,
  appendChatMessage,
  updateChatMessageById,
  setTrendPrediction,
  saveOpenKnowledgeFoodToSystem,
  forwardQuestionToExpertReview,
  SAMPLE_MEDICAL_PRESETS,
  applyPresetMedicalRecord,
  getVisibleChatMessages,
  syncDailyNutrientAlerts,
  setSelectedDiaryDate
} from '../services/store'
import { CalendarDateStrip, formatVietnameseDate } from '../components/CalendarDateStrip'
import { predictLongitudinalTrendsAI, getApiKey, subscribeAiConfigChange } from '../services/aiService'
import { ingestMedicalRecordFile, ACCEPTED_RECORD_TYPES } from '../services/recordIntake'
import { ProfilePendingCard } from '../features/patient/ProfilePendingCard'
import {
  runClinicalPlanWorkflow,
  runClinicalConsultAgent,
  triggerLiveAiMenuUpgrade,
  getAiPlanGenerationStatus,
  subscribeAiPlanGeneration
} from '../services/workflowAgent'
import { getRouterHealthSnapshot, probeGatewayHealth, subscribeRouterHealth } from '../services/modelRouter'
import {
  calc,
  tdee,
  SLOTS,
  localDateIso,
  gate,
  summarizeGateIssues,
  safety,
  evaluateDrugDietInteractions,
  deriveClinicalCeilings,
  approvedNutritionLimits,
  isCurrentMealPlan,
  nutritionProfileIssue,
  hasFoodNameMismatch
} from '../utils/nutrition'
import {
  cleanAndDeduplicateDiseases,
  cleanAndDeduplicateMedications,
  filterAndDeduplicateConditions,
  formatMedicationDisplay
} from '../utils/pdfExtractor'
import { compressImageFile } from '../utils/imageUtils'
import { Card, Btn, Badge, Modal, Field, inp, toast } from '../components/ui'
import { ClinicalAnatomySvg } from '../components/ClinicalAnatomySvg'
import { MultiRing } from '../components/NutritionCharts'
import { MarkdownMessage } from '../components/MarkdownMessage'
import type { OrganId, Food, MedicalRecordExtraction, Item } from '../types'

type PresetRecordItem = (typeof SAMPLE_MEDICAL_PRESETS)[number]

const WEEKDAY_LABELS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ Nhật']

const CLINICAL_DAY_FOCUS = [
  'Bảo vệ thận & Ít muối',
  'Kiểm soát đường huyết (GI thấp)',
  'Giảm Purine & Acid Uric',
  'Cân bằng Lipid & Tim mạch',
  'Kháng viêm & Chống oxy hóa',
  'Thanh lọc & Tiêu hóa nhẹ',
  'Phục hồi & Bù vi chất'
]

const FOOD_CATEGORIES = ['Tất cả', 'TINH BỘT', 'ĐẠM', 'RAU', 'TRÁI CÂY', 'SỮA', 'DẦU MỠ']

function mapConditionIcd10(condition: string): string {
  const c = condition.toLowerCase()
  if (/thận|ckd|suy thận/.test(c)) return 'N18.3'
  if (/đái tháo|tiểu đường|t2d/.test(c)) return 'E11'
  if (/tăng huyết áp|huyết áp/.test(c)) return 'I10'
  if (/rung nhĩ|loạn nhịp/.test(c)) return 'I48'
  if (/gout|gút|uric/.test(c)) return 'M10'
  if (/gerd|trào ngược|dạ dày/.test(c)) return 'K21'
  if (/gan/.test(c)) return 'K76.0'
  if (/mỡ máu|lipid|cholesterol/.test(c)) return 'E78'
  return 'ICD-10'
}

const AI_DIARY_TAG_PREFIX = '[Thực đơn AI'
const isAiPlanDiaryItem = (item: Item) => Boolean(item.note?.includes(AI_DIARY_TAG_PREFIX))

function buildDiarySnapshot(it: Item, foods: Food[]) {
  if (it.snapshot) return it.snapshot
  const f = foods.find(x => x.id === it.foodId)
  if (!f) return undefined
  return {
    kcal: f.kcal,
    protein: f.protein,
    fat: f.fat,
    carb: f.carb,
    fiber: f.fiber,
    sodium: f.sodium,
    potassium: f.potassium,
    gi: f.gi,
    purine: f.purine,
    allergens: f.allergens
  }
}

/** Ghi 1 bữa cụ thể từ Thực đơn AI vào Nhật ký (mặc định ngày đang chọn hoặc hôm nay). */
function logPlanSlotToTodayDiary(slot: string, items: Item[], dayLabel: string, targetDate?: string) {
  if (!items || items.length === 0) return
  const dateKey = targetDate || localDateIso()
  set(d => {
    d.diary[dateKey] ||= {}
    const existing = d.diary[dateKey]?.[slot] || []
    const userAdded = existing.filter(item => !isAiPlanDiaryItem(item))
    const planItems = items.map(it => {
      const f = d.foods.find(x => x.id === it.foodId)
      return {
        ...it,
        foodName: it.foodName || f?.name,
        snapshot: buildDiarySnapshot(it, d.foods),
        note: `[Thực đơn AI · ${dayLabel}]${it.note && !it.note.includes('[Thực đơn AI') ? ` ${it.note}` : ''}`
      }
    })
    d.diary[dateKey][slot] = [...planItems, ...userAdded]
    log(d, 'Ghi bữa Thực đơn AI vào Nhật ký', `${slot} (${dayLabel} -> ${dateKey})`)
    syncDailyNutrientAlerts(d, dateKey)
  })
}

/** Gỡ các món thuộc Thực đơn AI của 1 bữa khỏi Nhật ký (mặc định ngày đang chọn hoặc hôm nay). */
function removeAiSlotFromTodayDiary(slot: string, targetDate?: string) {
  const dateKey = targetDate || localDateIso()
  set(d => {
    const existing = d.diary[dateKey]?.[slot] || []
    const remaining = existing.filter(item => !isAiPlanDiaryItem(item))
    if (remaining.length > 0) d.diary[dateKey][slot] = remaining
    else if (d.diary[dateKey]) delete d.diary[dateKey][slot]
    log(d, 'Gỡ bữa Thực đơn AI khỏi Nhật ký', `${slot} (${dateKey})`)
    syncDailyNutrientAlerts(d, dateKey)
  })
}

/** Ghi toàn bộ các bữa trong ngày đang chọn của Thực đơn AI vào Nhật ký (mặc định ngày đang chọn hoặc hôm nay). */
function logWholePlanDayToTodayDiary(dayPlan: Record<string, Item[]> | undefined, activeSlots: string[], dayLabel: string, targetDate?: string) {
  if (!dayPlan) return
  const dateKey = targetDate || localDateIso()
  set(d => {
    d.diary[dateKey] ||= {}
    activeSlots.forEach(slot => {
      const existing = d.diary[dateKey]?.[slot] || []
      const userAdded = existing.filter(item => !isAiPlanDiaryItem(item))
      const planSlotItems = (dayPlan[slot] || []).map(it => {
        const f = d.foods.find(x => x.id === it.foodId)
        return {
          ...it,
          foodName: it.foodName || f?.name,
          snapshot: buildDiarySnapshot(it, d.foods),
          note: `[Thực đơn AI · ${dayLabel}]${it.note && !it.note.includes('[Thực đơn AI') ? ` ${it.note}` : ''}`
        }
      })
      d.diary[dateKey][slot] = [...planSlotItems, ...userAdded]
    })
    log(d, 'Ghi cả ngày Thực đơn AI vào Nhật ký', `${dayLabel} -> ${dateKey}`)
    syncDailyNutrientAlerts(d, dateKey)
  })
}

// ==================== 0. LONGITUDINAL TREND & DEFICIENCY PREDICTOR ====================

export function LongitudinalTrendPredictor() {
  const s = useS()
  const p = s.profile
  const [loading, setLoading] = useState(false)
  const prediction = s.trendPrediction

  const organNames: Record<string, string> = {
    kidneys: 'Thận (Renal)',
    heart: 'Tim mạch (Cardio)',
    pancreas: 'Tuyến tụy (Endocrine)',
    liver: 'Gan mật (Hepatic)',
    joints: 'Khớp & Xương (Articular)',
    stomach: 'Dạ dày (Gastro)'
  }

  const handlePredict = async () => {
    setLoading(true)
    try {
      const diaryItems: Record<string, any> = {}
      for (let i = 0; i < 7; i++) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        const dayKey = localDateIso(d)
        if (s.diary[dayKey]) diaryItems[dayKey] = s.diary[dayKey]
      }
      const res = await predictLongitudinalTrendsAI(p, diaryItems, s.foods)
      setTrendPrediction(res)
      toast('Đã hoàn tất phân tích động học dinh dưỡng 7 ngày!')
    } catch (e: any) {
      toast('Lỗi phân tích: ' + (e.message || 'Không thể chạy dự báo'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="apple-liquid-glass p-5 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/75">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#0B4F4A] text-white flex items-center justify-center shadow-xs">
            <TrendingUp className="w-5 h-5 text-[#6EE7B7]" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-serifDisplay font-semibold text-base sm:text-lg text-[#0F2422]">
                AI Dự báo Xu hướng & Nguy cơ Thiếu hụt Vi chất (7 Ngày)
              </h3>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono-code font-semibold bg-[#E1F2EF] text-[#0B4F4A]">
                AI PROJECTION
              </span>
            </div>
            <p className="text-xs text-[#475D5B]">
              Mô phỏng tích lũy vi chất, phát hiện sớm nguy cơ thiếu máu/loãng xương và phục hồi cơ quan 30 ngày.
            </p>
          </div>
        </div>

        <Btn v="s" disabled={loading} onClick={handlePredict} className="!rounded-2xl text-xs">
          {loading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#0B4F4A]" />
              <span>Đang tính toán...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5 text-[#0B4F4A]" />
              <span>{prediction ? 'Cập nhật lại Dự báo AI' : 'Chạy Dự báo AI'}</span>
            </>
          )}
        </Btn>
      </div>

      {prediction ? (
        <div className="space-y-4">
          <div className="porcelain-core rounded-2xl p-4">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#0B4F4A] flex items-center gap-1.5 mb-1.5">
              <Activity className="w-3.5 h-3.5" /> Đánh giá Động học Lâm sàng
            </span>
            <p className="text-xs text-[#0F2422] leading-relaxed">{prediction.trend_summary}</p>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#738A87]">
                Nguy cơ Thiếu hụt Vi chất
              </p>
              {(prediction.deficiencies || []).map((def, idx) => (
                <div key={idx} className="porcelain-core rounded-2xl p-3.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-xs text-[#0F2422]">{def.nutrient}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-mono-code font-semibold ${def.risk === 'high'
                        ? 'bg-[#FFF1F3] text-[#B8334A]'
                        : def.risk === 'medium'
                          ? 'bg-[#FDF5E6] text-[#B88746]'
                          : 'bg-[#E1F2EF] text-[#0B4F4A]'
                        }`}
                    >
                      {def.risk === 'high' ? 'NGUY CƠ CAO' : def.risk === 'medium' ? 'THEO DÕI' : 'THẤP'}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#475D5B] leading-relaxed">{def.explanation}</p>
                  {def.safe_food_remedies?.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {def.safe_food_remedies.map((rem, rIdx) => (
                        <span
                          key={rIdx}
                          className="px-2 py-0.5 rounded-full bg-[#E1F2EF] text-[#0B4F4A] text-[10px] font-medium"
                        >
                          {rem}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#738A87]">
                Tiên lượng Phục hồi Cơ quan (30 Ngày)
              </p>
              {(prediction.organ_projections || []).map((proj, idx) => (
                <div key={idx} className="porcelain-core rounded-2xl p-3.5 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-xs text-[#0F2422]">
                      {organNames[proj.organ_id] || proj.organ_id}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono-code bg-[#E0F2FE] text-[#0284C7] font-semibold">
                      {proj.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#475D5B] leading-relaxed">{proj.projection}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="porcelain-core rounded-2xl p-5 text-center text-xs text-[#475D5B]">
          Nhấn <b>Chạy Dự báo AI</b> để phân tích xu hướng tích lũy 7 ngày và tiên lượng đáp ứng cơ quan dựa trên bệnh án của bạn.
        </div>
      )}
    </div>
  )
}

// ==================== 1. PATIENT DASHBOARD (PURE 12-COL BENTO GRID + ROW 2) ====================

export function Dashboard() {
  const s = useS()
  const p = s.profile
  const navigate = useNavigate()
  const profileIssue = nutritionProfileIssue(p)
  const lastPlan = s.plans.find(plan => isCurrentMealPlan(plan, p))
  const targetKcal = profileIssue ? 1800 : tdee(p)

  const todayIso = localDateIso()
  const activeDate = s.selectedDiaryDate || todayIso
  const isToday = activeDate === todayIso
  const todayDiary = s.diary[activeDate] || {}
  const loggedTodayItems = Object.values(todayDiary).flat()

  // Sơ đồ & chỉ số Trang chủ luôn cập nhật chính xác 100% theo dữ liệu thực tế trong Nhật ký theo ngày đang chọn
  const activeDashboardItems = loggedTodayItems

  const todayNutrients = calc(activeDashboardItems, s.foods)
  const latestRecord = p.files?.[0] || s.ocrHistory?.[0] || s.pendingRecordDraft
  const limits = approvedNutritionLimits(p, s.plans)
  const clinicalCeilings = useMemo(
    () => deriveClinicalCeilings(p, latestRecord, s.rules),
    [p, latestRecord, s.rules]
  )

  // 1. Mức trần chuẩn cho người bình thường khỏe mạnh (Normal Healthy Adult Baselines)
  const normalSodium = 2000 // mg/ngày (Khuyến cáo WHO cho người bình thường)
  const normalProtein = Math.max(60, Math.round((p.weight || 60) * 1.0)) // 1.0g/kg thể trọng (chuẩn người khỏe mạnh)
  const normalKcal = targetKcal > 0 ? targetKcal : 2000

  // 2. Mức tối đa người bệnh có thể tiếp nhận được (tính tự động ngay khi đọc bệnh án)
  const patientMaxSodium = Number(limits?.max_sodium_mg) || clinicalCeilings.max_sodium_mg || 2000
  const patientMaxProtein = Number(limits?.max_protein_g) || clinicalCeilings.max_protein_g || normalProtein
  const patientMaxKcal = normalKcal

  // 3. Vị trí vạch đỏ (%) trên thước đo chuẩn người bình thường
  const sodiumRedLinePct = Math.min(100, Math.max(10, Math.round((patientMaxSodium / normalSodium) * 100)))
  const proteinRedLinePct = Math.min(100, Math.max(10, Math.round((patientMaxProtein / normalProtein) * 100)))
  const kcalRedLinePct = 85 // Ngưỡng an toàn năng lượng 85%

  // 4. Mức tiêu thụ hôm nay tính theo % thước đo người bình thường
  const sodPct = Math.min(130, (todayNutrients.sodium / normalSodium) * 100)
  const protPct = Math.min(130, (todayNutrients.protein / normalProtein) * 100)
  const kcalPct = Math.min(130, (todayNutrients.kcal / normalKcal) * 100)

  // 5. Kiểm tra nếu mức nạp thực tế vượt qua vạch đỏ trần bệnh nhân
  const isSodiumOver = todayNutrients.sodium > patientMaxSodium
  const isProteinOver = todayNutrients.protein > patientMaxProtein
  const isKcalOver = todayNutrients.kcal > (patientMaxKcal * 0.85)

  const displayConditions = cleanAndDeduplicateDiseases([
    ...(p.conditions || []),
    ...(latestRecord?.diseases || [])
  ])
  const displayMedications = cleanAndDeduplicateMedications(p.medications)
  const gateIssues = gate(p, s)
  const safetyAlerts = safety(p, activeDashboardItems, s)
  const ddiAlerts = evaluateDrugDietInteractions(p, activeDashboardItems, s.foods)

  // Combine pharmacological reminders cleanly with active DDI scan results
  const ddiHighlights = useMemo(() => {
    const items: { title: string; detail: string; tone: 'champagne' | 'rose' }[] = []
    const medsJoined = displayMedications.join(' ').toLowerCase()
    if (/warfarin/.test(medsJoined)) {
      items.push({
        title: 'Warfarin · Vitamin K',
        detail: 'Giữ lượng rau lá xanh đậm (Vitamin K) ổn định mỗi ngày để tránh dao động chỉ số đông máu INR.',
        tone: 'rose'
      })
    }
    if (/losartan|enalapril|perindopril|spironolacton/.test(medsJoined)) {
      items.push({
        title: 'Ức chế men chuyển / ARB · Kali',
        detail: 'Nguy cơ tăng Kali máu khi kết hợp nước dừa, chuối chín lượng lớn hoặc muối ăn kiêng KCl.',
        tone: 'champagne'
      })
    }
    if (/atorvastatin|rosuvastatin|amlodipin/.test(medsJoined)) {
      items.push({
        title: 'CYP3A4 · Bưởi chùm',
        detail: 'Tránh nước ép bưởi chùm làm tăng nồng độ Statin và thuốc hạ áp trong huyết tương.',
        tone: 'champagne'
      })
    }
    ddiAlerts.slice(0, 2).forEach(msg => {
      items.push({
        title: 'Cảnh báo Khẩu phần Hiện tại',
        detail: msg,
        tone: 'rose'
      })
    })
    return items
  }, [ddiAlerts, displayMedications])

  const hasCkd = displayConditions.some(c => /thận|ckd/i.test(c))
  const hasDiabetes = displayConditions.some(c => /đái|tiểu đường/i.test(c))
  const hasPpi = displayMedications.some(m => /omeprazol|esomeprazol|pantoprazol/i.test(m))

  const progressBars: {
    key: string
    label: string
    value: number
    patientCeiling: number
    normalCeiling: number
    unit: string
    redLinePct: number
    pct: number
    isOverPatientCeiling: boolean
    normalColor: string
  }[] = [
      {
        key: 'kcal',
        label: 'Năng lượng',
        value: Math.round(todayNutrients.kcal),
        patientCeiling: Math.round(patientMaxKcal * 0.85),
        normalCeiling: Math.round(normalKcal),
        unit: 'kcal',
        redLinePct: kcalRedLinePct,
        pct: kcalPct,
        isOverPatientCeiling: isKcalOver,
        normalColor: '#0B4F4A'
      },
      {
        key: 'protein',
        label: 'Đạm (Protein)',
        value: Math.round(todayNutrients.protein),
        patientCeiling: patientMaxProtein,
        normalCeiling: normalProtein,
        unit: 'g',
        redLinePct: proteinRedLinePct,
        pct: protPct,
        isOverPatientCeiling: isProteinOver,
        normalColor: '#0284C7'
      },
      {
        key: 'sodium',
        label: 'Natri (Muối)',
        value: Math.round(todayNutrients.sodium),
        patientCeiling: Math.round(patientMaxSodium),
        normalCeiling: normalSodium,
        unit: 'mg',
        redLinePct: sodiumRedLinePct,
        pct: sodPct,
        isOverPatientCeiling: isSodiumOver,
        normalColor: '#B88746'
      }
    ]

  return (
    <div className="space-y-5">
      {/* LỊCH NHẬT KÝ & ĐỒNG BỘ SƠ ĐỒ TRANG CHỦ */}
      <CalendarDateStrip
        selectedDate={activeDate}
        onSelectDate={d => setSelectedDiaryDate(d)}
        title="Lịch Nhật Ký & Sơ Đồ Cơ Thể"
      />

      {/* ROW 1: 12-COLUMN BENTO GRID (4-4-4 EQUAL CARDS) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* CARD 1: NĂNG LƯỢNG & NGƯỠNG AN TOÀN */}
        <section className="lg:col-span-4 apple-liquid-glass p-5 sm:p-6 flex flex-col justify-between gap-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-serifDisplay text-lg font-semibold text-[#0F2422]">
              Năng lượng & Ngưỡng An toàn
            </h2>
            <span className="px-2.5 py-0.5 rounded-full bg-[#FFF1F3] text-[#DC2626] text-[10px] font-mono-code font-semibold shrink-0 border border-[#DC2626]/20">
              VẠCH ĐỎ: TRẦN BỆNH NHÂN
            </span>
          </div>

          <MultiRing
            rings={[
              {
                label: 'Năng lượng',
                value: todayNutrients.kcal,
                target: patientMaxKcal,
                unit: 'kcal',
                from: '#0B4F4A',
                to: '#136F68'
              },
              {
                label: 'Đạm',
                value: todayNutrients.protein,
                target: patientMaxProtein,
                unit: 'g',
                from: '#0284C7',
                to: '#38BDF8'
              },
              {
                label: 'Natri',
                value: todayNutrients.sodium,
                target: patientMaxSodium,
                unit: 'mg',
                from: '#B88746',
                to: '#E6C58E'
              }
            ]}
            centerValue={String(Math.round(todayNutrients.kcal))}
            centerCaption={isToday ? "kcal hôm nay" : `kcal ngày ${activeDate}`}
          />

          {/* 3 Horizontal Threshold Bars with Patient Ceiling Red Marker */}
          <div className="space-y-3">
            {progressBars.map(bar => {
              return (
                <div key={bar.key} className="porcelain-core rounded-2xl px-3.5 py-2.5 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[#0F2422] flex items-center gap-1.5">
                      <span>{bar.label}</span>
                      {bar.isOverPatientCeiling && (
                        <span className="text-[10px] font-mono-code font-bold text-[#DC2626] bg-[#FFF1F3] px-1.5 py-0.5 rounded border border-[#DC2626]/20">
                          VƯỢT VẠCH ĐỎ
                        </span>
                      )}
                    </span>
                    <span className="font-mono-code text-[11px] font-semibold text-[#0F2422]">
                      <span className={bar.isOverPatientCeiling ? 'text-[#DC2626] font-bold' : ''}>{bar.value}</span>{' '}
                      <span className="text-[#738A87] font-normal">/ {bar.patientCeiling} {bar.unit}</span>
                    </span>
                  </div>
                  <div className="relative h-2.5 rounded-full bg-slate-200/80 overflow-visible">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(100, bar.pct)}%`,
                        backgroundColor: bar.isOverPatientCeiling ? '#DC2626' : bar.normalColor
                      }}
                    />
                    {/* Vạch đỏ: Mức tối đa người bệnh có thể tiếp nhận được */}
                    <span
                      className="absolute -top-1 -bottom-1 w-1 bg-[#DC2626] rounded-full z-10 shadow-sm transition-all duration-500"
                      style={{ left: `${bar.redLinePct}%` }}
                      title={`Vạch đỏ: Mức trần tối đa người bệnh có thể tiếp nhận: ≤ ${bar.patientCeiling} ${bar.unit} (Chuẩn người khỏe mạnh: ${bar.normalCeiling} ${bar.unit})`}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-mono-code pt-0.5">
                    <span className="flex items-center gap-1 text-[#DC2626] font-medium">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#DC2626]" />
                      Vạch đỏ trần bệnh nhân: ≤ {bar.patientCeiling} {bar.unit}
                    </span>
                    <span className="text-[#738A87]">
                      Chuẩn người khỏe: {bar.normalCeiling} {bar.unit}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
          {loggedTodayItems.length === 0 && (
            <div className="porcelain-core rounded-2xl px-3.5 py-2.5 text-[11px] text-[#475D5B] flex flex-wrap items-center justify-between gap-2">
              <span>
                {isToday ? 'Hôm nay' : `Ngày ${activeDate}`} chưa ghi món nào vào <b>Nhật ký</b> — thêm món bên Nhật ký hoặc bấm <b>Ghi nhật ký</b> ở từng bữa trong Thực đơn AI.
              </span>
              <span className="flex items-center gap-2 shrink-0 font-semibold text-[#0B4F4A]">
                <Link to="/nhat-ky-an" className="hover:underline">Nhật ký ăn →</Link>
                <Link to="/thuc-don" className="hover:underline">Thực đơn AI →</Link>
              </span>
            </div>
          )}
        </section>

        {/* CARD 2: KIỂM SOÁT XUNG ĐỘT ĐA BỆNH LÝ */}
        <section className="lg:col-span-4 apple-liquid-glass p-5 sm:p-6 flex flex-col justify-between gap-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-serifDisplay text-lg font-semibold text-[#0F2422]">
                Kiểm soát Xung đột Đa bệnh lý
              </h2>
              <span className="px-2.5 py-0.5 rounded-full bg-[#E0F2FE] text-[#0284C7] text-[10px] font-mono-code font-semibold shrink-0">
                {displayConditions.length > 0 ? `${displayConditions.length} BỆNH LÝ` : 'ỔN ĐỊNH'}
              </span>
            </div>

            {displayConditions.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {displayConditions.map((cond, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full porcelain-core text-xs font-medium text-[#0F2422]"
                  >
                    <span className="font-mono-code text-[10px] px-1.5 py-0.5 rounded-md bg-[#E1F2EF] text-[#0B4F4A] font-semibold">
                      {mapConditionIcd10(cond)}
                    </span>
                    <span>{cond}</span>
                  </span>
                ))}
              </div>
            ) : (
              <div className="porcelain-core rounded-2xl p-4 text-xs text-[#0B4F4A] flex items-center gap-2.5">
                <ShieldCheck size={18} className="shrink-0" />
                <span>Hồ sơ hiện tại chưa ghi nhận bệnh lý nền cần giới hạn dinh dưỡng đặc biệt.</span>
              </div>
            )}

            <div className="porcelain-core rounded-2xl p-3.5 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#0F2422]">Ma trận Giới hạn Đa bệnh lý</span>
                <span
                  className={`font-mono-code text-[10px] px-2 py-0.5 rounded-full font-semibold ${gateIssues.length > 0 || safetyAlerts.length > 0
                    ? 'bg-[#FDF5E6] text-[#B88746]'
                    : 'bg-[#E1F2EF] text-[#0B4F4A]'
                    }`}
                >
                  {gateIssues.length > 0 ? `${gateIssues.length} LƯU Ý` : 'ĐÃ ĐỒNG BỘ'}
                </span>
              </div>
              <p className="text-[11px] text-[#475D5B] leading-relaxed">
                {safetyAlerts.length > 0
                  ? `${safetyAlerts[0].label}: ${safetyAlerts[0].note}`
                  : gateIssues.length > 0
                    ? summarizeGateIssues(gateIssues)
                    : 'Thực đơn tự động giao thoa ngưỡng Natri, Đạm, GI và Purine an toàn nhất giữa các bệnh.'}
              </p>
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="button"
              onClick={() => navigate('/thuc-don')}
              className="w-full py-2.5 px-4 rounded-2xl bg-[#0B4F4A] hover:bg-[#073935] text-white text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <span>Mở thực đơn</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </section>

        {/* CARD 3: ĐƠN THUỐC HIỆN HÀNH & DDI */}
        <section className="lg:col-span-4 apple-liquid-glass p-5 sm:p-6 flex flex-col justify-between gap-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-serifDisplay text-lg font-semibold text-[#0F2422]">
                Đơn thuốc Hiện hành
              </h2>
              <span className="px-2.5 py-0.5 rounded-full porcelain-core text-[#0F2422] text-[10px] font-mono-code font-semibold shrink-0">
                {displayMedications.length} THUỐC
              </span>
            </div>

            {displayMedications.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {displayMedications.map((med, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full porcelain-core text-xs font-medium text-[#0F2422]"
                  >
                    <Pill size={12} className="text-[#0B4F4A] shrink-0" />
                    <span>{med}</span>
                  </span>
                ))}
              </div>
            ) : (
              <div className="porcelain-core rounded-2xl p-3.5 text-xs text-[#475D5B]">
                Chưa có đơn thuốc kê đơn đang theo dõi tương tác thực phẩm.
              </div>
            )}

            {/* DDI Alert Boxes */}
            <div className="space-y-2">
              {ddiHighlights.length > 0 ? (
                ddiHighlights.slice(0, 2).map((ddi, idx) => (
                  <div
                    key={idx}
                    className={`rounded-2xl p-3 text-xs space-y-0.5 ${ddi.tone === 'rose'
                      ? 'bg-[#FFF1F3] text-[#B8334A]'
                      : 'bg-[#FDF5E6] text-[#8A622B]'
                      }`}
                  >
                    <div className="font-semibold flex items-center gap-1.5 text-[11px]">
                      <AlertTriangle size={13} className="shrink-0" />
                      <span>{ddi.title}</span>
                    </div>
                    <p className="text-[11px] leading-snug opacity-95">{ddi.detail}</p>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl p-3 bg-[#E1F2EF] text-[#0B4F4A] text-xs flex items-center gap-2">
                  <ShieldCheck size={14} className="shrink-0" />
                  <span>Không ghi nhận tương tác Dược - Dinh dưỡng bất thường.</span>
                </div>
              )}
            </div>
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => navigate('/ho-so')}
              className="w-full py-2.5 px-4 rounded-2xl porcelain-core hover:bg-white text-[#0B4F4A] text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <span>Xem Sơ đồ Giải phẫu & Xét nghiệm</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </section>
      </div>

      {/* ROW 2: FULL-WIDTH MICRONUTRIENT DEFICIENCY & 30-DAY ORGAN RECOVERY CARD */}
      <section className="apple-liquid-glass p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-serifDisplay text-lg sm:text-xl font-semibold text-[#0F2422]">
              Nguy cơ Thiếu hụt Vi chất & Tiên lượng Phục hồi Cơ quan
            </h2>
            <p className="text-xs text-[#475D5B] mt-0.5">
              Đánh giá cân bằng vi chất và đáp ứng sinh học 30 ngày dựa trên hồ sơ bệnh án & khẩu phần hiện tại.
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <span className="px-3 py-1 rounded-full bg-[#E1F2EF] text-[#0B4F4A] text-[11px] font-mono-code font-semibold">
              Trần Natri: ≤ {patientMaxSodium}mg (Khỏe mạnh: {normalSodium}mg)
            </span>
            <span className="px-3 py-1 rounded-full bg-[#E0F2FE] text-[#0284C7] text-[11px] font-mono-code font-semibold">
              Đạm mục tiêu: ≤ {patientMaxProtein}g (Khỏe mạnh: {normalProtein}g)
            </span>
            <span className="px-3 py-1 rounded-full bg-[#FDF5E6] text-[#B88746] text-[11px] font-mono-code font-semibold">
              GI an toàn: {hasDiabetes ? '≤ 50' : '≤ 55'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Left Column: Micronutrient Deficiencies */}
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#738A87]">
              Nguy cơ Thiếu hụt Vi chất
            </p>
            <div className="porcelain-core rounded-2xl p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-[#0F2422]">Vitamin D & Canxi</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-mono-code font-semibold ${hasCkd ? 'bg-[#FDF5E6] text-[#B88746]' : 'bg-[#E1F2EF] text-[#0B4F4A]'
                    }`}
                >
                  {hasCkd ? 'CẦN BỔ SUNG' : 'TRONG NGƯỠNG'}
                </span>
              </div>
              <p className="text-xs text-[#475D5B] leading-relaxed">
                {hasCkd
                  ? 'Suy giảm chức năng thận làm giảm hoạt hóa Vitamin D3; ưu tiên cá hồi lượng vừa, trứng và tiếp xúc nắng sáng nhẹ.'
                  : 'Duy trì nguồn Canxi ít natri từ sữa chua không đường hoặc đậu phụ trong khẩu phần hàng tuần.'}
              </p>
            </div>

            <div className="porcelain-core rounded-2xl p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-[#0F2422]">Sắt & Acid Folic (Vitamin B9)</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-mono-code font-semibold ${hasCkd || hasPpi ? 'bg-[#FFF1F3] text-[#B8334A]' : 'bg-[#E1F2EF] text-[#0B4F4A]'
                    }`}
                >
                  {hasCkd || hasPpi ? 'THEO DÕI' : 'ỔN ĐỊNH'}
                </span>
              </div>
              <p className="text-xs text-[#475D5B] leading-relaxed">
                {hasCkd || hasPpi
                  ? 'Thuốc ức chế bơm proton (PPI) hoặc CKD dễ giảm hấp thu Sắt & B12; cân nhắc thịt nạc gia cầm và rau lá xanh chần kỹ.'
                  : 'Hấp thu Sắt và Folate hiện ổn định khi phân bổ đều đạm và rau xanh trong 3 bữa chính.'}
              </p>
            </div>
          </div>

          {/* Right Column: 30-Day Organ Recovery Projections */}
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#738A87]">
              Tiên lượng Phục hồi Cơ quan (30 Ngày)
            </p>
            <div className="porcelain-core rounded-2xl p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-[#0F2422]">Phục hồi Chức năng Thận 30 ngày</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-mono-code font-semibold ${sodPct >= 85 || protPct >= 95
                    ? 'bg-[#FFF1F3] text-[#B8334A]'
                    : 'bg-[#E1F2EF] text-[#0B4F4A]'
                    }`}
                >
                  {sodPct >= 85 || protPct >= 95 ? 'ÁP LỰC TĂNG' : 'BẢO VỆ TÍCH CỰC'}
                </span>
              </div>
              <p className="text-xs text-[#475D5B] leading-relaxed">
                {sodPct >= 85
                  ? `Natri đang đạt ${Math.round(sodPct)}% ngưỡng an toàn; cần giảm món chấm mặn để tránh tăng áp lực lọc cầu thận.`
                  : 'Giữ vững trần Đạm và Natri giúp giảm protein niệu và ổn định eGFR theo mục tiêu 30 ngày.'}
              </p>
            </div>

            <div className="porcelain-core rounded-2xl p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-[#0F2422]">Kiểm soát Tim mạch & Đường huyết</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono-code font-semibold bg-[#E0F2FE] text-[#0284C7]">
                  TIÊN LƯỢNG TỐT
                </span>
              </div>
              <p className="text-xs text-[#475D5B] leading-relaxed">
                {hasDiabetes
                  ? 'Ưu tiên tinh bột GI thấp (gạo lứt, yến mạch) giúp hạn chế dao động đường huyết sau ăn và bảo vệ nội mạc mạch.'
                  : 'Tỷ lệ chất béo bão hòa thấp cùng kiểm soát Natri hỗ trợ duy trì huyết áp ổn định dài hạn.'}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ROW 3: SCULPTED 4-ORGAN VECTOR ANATOMY STUDIO DIRECTLY ON DASHBOARD */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-serifDisplay text-lg sm:text-xl font-semibold text-[#0F2422]">
            Sơ đồ Giải phẫu & Tác động Dinh dưỡng Khẩu phần
          </h2>
          <span className="text-[11px] font-mono-code text-[#738A87]">
            Đồng bộ theo Nhật ký: <b className="text-[#0B4F4A]">{activeDate}</b>
          </span>
        </div>
        <p className="text-xs text-[#475D5B]">
          Phản hồi sinh học của 4 cơ quan trọng yếu (Thận, Tim, Gan, Dạ dày) theo dữ liệu nhật ký ngày {activeDate}.
        </p>
        <ClinicalAnatomySvg selectedDate={activeDate} />
      </div>
    </div>
  )
}

// ==================== 2. PROFILE & MEDICAL RECORD OCR + SVG ANATOMY ====================

export function ProfilePage() {
  const s = useS()
  const p = s.profile
  const activeDate = s.selectedDiaryDate || localDateIso()
  const latestRecord = p.files?.[0] || s.ocrHistory?.[0]
  const displayConditions = cleanAndDeduplicateDiseases([
    ...(p.conditions || []),
    ...(latestRecord?.diseases || [])
  ])
  const displayMedications = cleanAndDeduplicateMedications(p.medications)

  const [uploading, setUploading] = useState(false)
  const [showBioForm, setShowBioForm] = useState(false)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await ingestMedicalRecordFile(file)
      toast(`Đã phân tích bệnh án "${file.name}". Vui lòng xác nhận lưu để đồng bộ toàn hệ thống!`)
    } catch (err: any) {
      setPendingRecordDraft(null)
      toast('Lỗi phân tích tệp: ' + (err.message || 'Không thể đọc bệnh án'))
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  return (
    <div className="space-y-5">
      {/* Pending Medical Record Confirmation Card (Direct Profile Link) */}
      {s.pendingRecordDraft && (
        <div className="space-y-2">
          <div className="px-4 py-2.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between gap-2 font-medium">
            <span className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle size={15} className="text-amber-600 shrink-0" />
              Đang có bản nháp bệnh án "{s.pendingRecordDraft.name}" chờ xác nhận để đồng bộ vào Hồ sơ & Trợ lý AI.
            </span>
          </div>
          <ProfilePendingCard
            profile={s.profile}
            pendingDraft={s.pendingRecordDraft}
            onCancel={() => setPendingRecordDraft(null)}
            onConfirm={d => {
              confirmMedicalRecord(d)
              const originPatientId = get().activePatientId
              const cleanDiseases = cleanAndDeduplicateDiseases(d.diseases || [])
              const cleanMeds = (d.medications || []).map(m => formatMedicationDisplay(m.name, m.activeIngredient))
              appendChatMessage({
                from: 'b',
                text: `✅ **Đã liên kết bệnh án "${d.name}" vào Hồ sơ thành công!**\n\n- **Bệnh lý ghi nhận:** ${cleanDiseases.join(', ') || 'Không phát hiện'}\n- **Thuốc đang dùng:** ${cleanMeds.join(', ') || 'Không dùng thuốc'}\n- **Dị ứng:** ${d.allergies?.join(', ') || 'Không có'}\n\nToàn bộ dữ liệu lâm sàng và ngưỡng CDSS đã được đồng bộ với Hồ sơ và Thực đơn. Bạn có thể hỏi tôi bất kỳ thắc mắc nào về chế độ dinh dưỡng an toàn cho hồ sơ này!`,
                badge_label: 'Hồ sơ đã đồng bộ',
                badge_color: 'green'
              }, originPatientId)
              toast('Đã đồng bộ bệnh án vào Hồ sơ! AI đang suy luận thực đơn riêng từ bệnh án & tài liệu y tế...')
              if (!nutritionProfileIssue(get().profile)) {
                void triggerLiveAiMenuUpgrade({
                  daysCount: 7,
                  mealsCount: 3,
                  onComplete: () => {
                    toast('AI đã hoàn tất thiết kế thực đơn 7 ngày riêng theo bệnh án & tài liệu y tế!')
                  }
                })
              }
            }}
          />
        </div>
      )}

      {/* Top OCR Summary + Quick Presets + Upload Controls */}
      <div className="apple-liquid-glass p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-[#E1F2EF] text-[#0B4F4A] flex items-center justify-center shrink-0">
              <FileText size={18} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-serifDisplay text-base sm:text-lg font-semibold text-[#0F2422] truncate">
                  {latestRecord?.name || 'Hồ sơ khỏe mạnh tiêu chuẩn (Baseline)'}
                </h2>
                <span className="px-2.5 py-0.5 rounded-full bg-[#E1F2EF] text-[#0B4F4A] text-[10px] font-mono-code font-semibold">
                  {displayConditions.length} CHẨN ĐOÁN · {displayMedications.length} THUỐC
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] text-[#0B4F4A] font-semibold bg-[#E1F2EF]/60 px-2 py-0.5 rounded-full">
                  <Check size={12} className="text-[#0B4F4A]" /> Đã liên kết Trợ lý AI
                </span>
              </div>
              <p className="text-xs text-[#475D5B] mt-0.5">
                {displayConditions.length > 0
                  ? displayConditions.join(' · ')
                  : 'Chưa phát hiện bệnh lý nền — có thể chọn nhanh hồ sơ lâm sàng mẫu hoặc tải lên PDF/DOCX.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-[#0B4F4A] hover:bg-[#073935] text-white text-xs font-semibold transition-colors cursor-pointer">
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              <span>{uploading ? 'Đang OCR...' : 'Tải lên PDF/DOCX/Ảnh'}</span>
              <input
                type="file"
                accept=".pdf,.docx,.doc,.txt,image/*"
                className="hidden"
                onChange={handleFileChange}
              />
            </label>

            <Link
              to="/tu-van"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-[#E1F2EF] hover:bg-[#cde9e4] text-[#0B4F4A] text-xs font-semibold transition-colors cursor-pointer"
              title="Mở Trợ lý AI với bệnh án hiện tại"
            >
              <MessageCircle size={13} />
              <span>Tư vấn Trợ lý AI</span>
            </Link>

            <Btn v="s" onClick={() => setShowBioForm(!showBioForm)} className="!rounded-2xl text-xs">
              <SlidersHorizontal size={13} /> {showBioForm ? 'Ẩn Thông số' : 'Thông số Cá nhân'}
            </Btn>

            {displayConditions.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  clearMedicalRecord()
                  const originPatientId = get().activePatientId
                  appendChatMessage({
                    from: 'b',
                    text: '🔄 **Đã đặt lại hồ sơ bệnh án về trạng thái ban đầu.** Toàn bộ giới hạn an toàn và phân tích đã được đưa về tiêu chuẩn.',
                    badge_label: 'Đặt lại hồ sơ',
                    badge_color: 'amber'
                  }, originPatientId)
                  toast('Đã đặt lại hồ sơ về trạng thái khỏe mạnh ban đầu!')
                }}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-2xl bg-[#FFF1F3] hover:bg-rose-100 text-[#B8334A] text-xs font-semibold transition-colors cursor-pointer"
              >
                <Trash2 size={13} /> Xóa bệnh án
              </button>
            )}
          </div>
        </div>

        {/* 3 Quick Sample Presets */}
        <div className="pt-3 border-t border-white/75 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#738A87] mr-1">
            Hồ sơ mẫu nhanh:
          </span>
          {SAMPLE_MEDICAL_PRESETS.slice(0, 3).map((preset: PresetRecordItem) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                applyPresetMedicalRecord(preset.id)
                const originPatientId = get().activePatientId
                appendChatMessage({
                  from: 'b',
                  text: `📋 **Đã kích hoạt hồ sơ mẫu: ${preset.name}**\n\n- **Bệnh lý:** ${preset.extraction.diseases.join(', ')}\n- **Thuốc:** ${preset.extraction.medications.map(m => m.name).join(', ')}\n\nHồ sơ đã được liên kết đồng bộ với Trợ lý AI, Thực đơn điều trị và Sơ đồ giải phẫu.`,
                  badge_label: 'Hồ sơ mẫu đồng bộ',
                  badge_color: 'blue'
                }, originPatientId)
                toast(`Đã kích hoạt ${preset.name}! AI đang tự động suy luận thực đơn riêng...`)
                if (!nutritionProfileIssue(get().profile)) {
                  void triggerLiveAiMenuUpgrade({
                    daysCount: 7,
                    mealsCount: 3,
                    onComplete: () => {
                      toast(`AI đã hoàn tất thực đơn 7 ngày riêng cho ca "${preset.name}"!`)
                    }
                  })
                }
              }}
              className="px-3.5 py-1.5 rounded-full porcelain-core hover:bg-white text-xs font-medium text-[#0F2422] transition-all cursor-pointer"
            >
              {preset.name}
            </button>
          ))}
        </div>
      </div>

      {/* Optional Basic Bio Form */}
      {showBioForm && (
        <div className="apple-liquid-glass p-5 sm:p-6">
          <h3 className="font-serifDisplay font-semibold text-base text-[#0F2422] mb-4">
            Thông số Sinh học Cơ bản
          </h3>
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Ngày sinh">
              <input
                className={inp}
                type="date"
                value={p.dob}
                onChange={e => set(d => { d.profile.dob = e.target.value })}
              />
            </Field>
            <Field label="Chiều cao (cm)">
              <input
                className={inp}
                type="number"
                min={50}
                max={250}
                value={p.height}
                onChange={e => set(d => { d.profile.height = Math.max(1, +e.target.value || 1) })}
              />
            </Field>
            <Field label="Cân nặng (kg)">
              <input
                className={inp}
                type="number"
                min={10}
                max={300}
                value={p.weight}
                onChange={e => set(d => { d.profile.weight = Math.max(1, +e.target.value || 1) })}
              />
            </Field>
            <Field label="Mục tiêu điều trị">
              <input
                className={inp}
                type="text"
                value={p.goal}
                onChange={e => set(d => { d.profile.goal = e.target.value })}
              />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Dị ứng đã khai báo">
              <input
                className={inp}
                type="text"
                value={p.allergies}
                onChange={e => set(d => { d.profile.allergies = e.target.value })}
              />
            </Field>
          </div>
          <div className="mt-4 pt-3 border-t border-white/70 flex justify-end">
            <Btn onClick={() => { toast('Đã lưu thông tin!'); setShowBioForm(false) }}>
              Lưu thay đổi
            </Btn>
          </div>
        </div>
      )}

      {/* SCULPTED 4-ORGAN VECTOR ANATOMY STUDIO (7-COL + 5-COL) */}
      <ClinicalAnatomySvg selectedDate={activeDate} />
    </div>
  )
}

// ==================== 3. THERAPEUTIC MEAL PLANNER (REAL-TIME SYNC TO DASHBOARD) ====================

export function Planner({ week = false }: { week?: boolean }) {
  const s = useS()
  const p = s.profile
  const [daysCount, setDaysCount] = useState<1 | 7>(week ? 7 : 7)
  const [mealsCount, setMealsCount] = useState<number>(3)
  const [activeDayIdx, setActiveDayIdx] = useState<number>(0)
  const [generating, setGenerating] = useState(false)
  const [aiProgress, setAiProgress] = useState(() => getAiPlanGenerationStatus())
  const [userPrefNote, setUserPrefNote] = useState('')
  const [swapSearch, setSwapSearch] = useState('')
  const [showGateDetails, setShowGateDetails] = useState(false)

  useEffect(() => {
    return subscribeAiPlanGeneration(() => setAiProgress(getAiPlanGenerationStatus()))
  }, [])
  const [editingGramsTarget, setEditingGramsTarget] = useState<{
    dayIdx: number
    slot: string
    itemIdx: number
    foodName: string
    gramsInput: string
    error?: string
  } | null>(null)
  const [swappingTarget, setSwappingTarget] = useState<{
    dayIdx: number
    slot: string
    itemIdx: number
    currentFoodName: string
    currentGrams: number
  } | null>(null)

  const profileIssue = nutritionProfileIssue(p)
  const currentPlan = s.plans.find(plan => isCurrentMealPlan(plan, p))
  const gateIssues = gate(p, s)
  const targetKcal = profileIssue ? 1800 : tdee(p)
  const limits = approvedNutritionLimits(p, s.plans)
  const plannerCeilings = useMemo(
    () => deriveClinicalCeilings(p, p.files?.[0] || s.ocrHistory?.[0], s.rules),
    [p, s.ocrHistory, s.rules]
  )
  const maxSodium = Number(limits?.max_sodium_mg) || Number(currentPlan?.hard_limits?.max_sodium_mg) || plannerCeilings.max_sodium_mg || 2000
  const aiBusyForPatient = Boolean(aiProgress.active && (!aiProgress.patientId || aiProgress.patientId === s.activePatientId))
  const isBusyGenerating = generating || aiBusyForPatient
  const unifiedConditions = cleanAndDeduplicateDiseases([
    ...(p.conditions || []),
    ...(p.files?.[0]?.diseases || [])
  ])
  const ckdStageText = unifiedConditions.some(c => /giai đoạn\s*4|stage\s*4|ckd\s*4/i.test(c))
    ? 'CKD Giai đoạn 4'
    : unifiedConditions.some(c => /giai đoạn\s*3b|stage\s*3b|ckd\s*3b/i.test(c))
      ? 'CKD Giai đoạn 3b'
      : 'Bệnh thận mạn (CKD)'

  const effectiveDayIdx = daysCount === 1 ? 0 : Math.min(activeDayIdx, Math.max(0, (currentPlan?.days?.length || 1) - 1))
  const activeDay = currentPlan?.days?.[effectiveDayIdx] || {}
  const effectiveMealsCount = Math.max(mealsCount, activeDay['Bữa phụ']?.length && mealsCount === 4 ? 4 : mealsCount)
  const visibleSlots = useMemo(
    () => (effectiveMealsCount >= 4 ? ['Bữa sáng', 'Bữa trưa', 'Bữa tối', 'Bữa phụ'] : ['Bữa sáng', 'Bữa trưa', 'Bữa tối']),
    [effectiveMealsCount]
  )

  const todayIso = localDateIso()
  const activeDiaryDate = s.selectedDiaryDate || todayIso
  const todayDiary = s.diary[activeDiaryDate] || {}
  const activeDayLabel = daysCount === 1 ? 'Hôm nay' : WEEKDAY_LABELS[effectiveDayIdx]

  const isSlotLogged = (slot: string, items: Item[]) => {
    if (items.length === 0) return false
    const aiLogged = (todayDiary[slot] || []).filter(isAiPlanDiaryItem)
    if (aiLogged.length !== items.length) return false
    return items.every(
      (it, idx) =>
        aiLogged[idx]?.foodId === it.foodId &&
        aiLogged[idx]?.grams === it.grams &&
        (aiLogged[idx]?.note || '').includes(`· ${activeDayLabel}]`)
    )
  }

  const allDayItems = visibleSlots.flatMap(slot => activeDay[slot] || [])
  const dayNutrients = calc(allDayItems, s.foods)

  const handleGeneratePlan = async (targetDays?: 1 | 7, targetMeals?: number) => {
    const daysToGen = targetDays ?? daysCount
    const mealsToGen = targetMeals ?? mealsCount
    if (profileIssue) {
      toast(profileIssue)
      return
    }
    const avoidDishNames = Array.from(
      new Set(
        (currentPlan?.days || [])
          .flatMap(d => Object.values(d || {}).flat())
          .map(it => it.foodName || s.foods.find(f => f.id === it.foodId)?.name || '')
          .filter(Boolean)
      )
    ).slice(0, 25)

    setGenerating(true)
    try {
      const { run, plan } = await runClinicalPlanWorkflow({
        daysCount: daysToGen,
        mealsCount: mealsToGen,
        avoidDishNames,
        userPreferenceNote: userPrefNote.trim() || undefined
      })
      if (!plan) {
        throw new Error(run.error || 'Workflow dừng ở bước kiểm soát an toàn.')
      }
      toast(
        plan.generation_source === 'LOCAL_FALLBACK'
          ? `Không gọi được AI trực tuyến (${plan.fallback_reason || 'Fallback'}). Đã tạo thực đơn CDSS ${daysToGen} ngày.`
          : `AI (${plan.ai_model_used || 'CDSS'}) đã suy luận từ bệnh án & ${plan.evidence_basis?.length || 0} tài liệu y tế, tạo thực đơn ${daysToGen} ngày!`
      )
    } catch (e: any) {
      toast('Lỗi tạo thực đơn: ' + e.message)
    } finally {
      setGenerating(false)
    }
  }

  const handleToggleDaysMode = async (targetCount: 1 | 7) => {
    if (profileIssue) return
    setDaysCount(targetCount)
    setActiveDayIdx(0)
    if (targetCount === 7 && (!currentPlan || currentPlan.days.length < 7)) {
      await handleGeneratePlan(7, mealsCount)
    }
  }

  const handleToggleMealsCount = (count: 3 | 4) => {
    setMealsCount(count)
    toast(`Đã chuyển sang chế độ ${count} bữa/ngày. Bấm "Ghi nhật ký" ở từng bữa để đồng bộ lên Tổng quan.`)
  }

  const handleSelectDay = (dayIdx: number) => {
    setActiveDayIdx(dayIdx)
  }

  const handleStepGrams = (dayIdx: number, slot: string, itemIdx: number, nextGrams: number) => {
    if (!currentPlan) return
    const clamped = Math.min(1500, Math.max(10, Math.round(nextGrams)))
    const err = updateDishGramsInPlan(currentPlan.id, dayIdx, slot, itemIdx, clamped)
    if (err) {
      toast(err)
      return
    }
    toast(`Đã điều chỉnh khẩu phần thành ${clamped}g. Bấm "Ghi nhật ký" nếu muốn cập nhật bữa này vào Nhật ký hôm nay.`)
  }

  const handleSwapConfirm = (newFood: Food, grams: number) => {
    if (!swappingTarget || !currentPlan) return
    const err = swapDishInPlan(currentPlan.id, swappingTarget.dayIdx, swappingTarget.slot, swappingTarget.itemIdx, {
      foodId: newFood.id,
      foodName: newFood.name,
      grams
    })
    if (err) {
      toast(err)
      return
    }
    setSwappingTarget(null)
    setSwapSearch('')
    toast(`Đã đổi sang món ${newFood.name}! Bấm "Ghi nhật ký" ở bữa này để ghi nhận vào Nhật ký hôm nay.`)
  }

  // 7-day consistency bars
  const weeklyBarData = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const dayObj = currentPlan?.days?.[i % Math.max(1, currentPlan?.days?.length || 1)] || {}
      const items = visibleSlots.flatMap(sl => dayObj[sl] || [])
      const nu = calc(items, s.foods)
      return {
        idx: i,
        label: WEEKDAY_LABELS[i],
        kcal: Math.round(nu.kcal),
        focus: currentPlan?.day_focuses?.[i] || CLINICAL_DAY_FOCUS[i]
      }
    })
  }, [currentPlan?.days, currentPlan?.day_focuses, s.foods, visibleSlots])

  const ceiling85Kcal = Math.round(targetKcal * 0.85)
  const chartMax = Math.max(targetKcal * 1.15, ...weeklyBarData.map(d => d.kcal), 1)

  return (
    <div className="space-y-5">
      {/* LỊCH THỰC ĐƠN AI & ĐỒNG BỘ NHẬT KÝ */}
      <CalendarDateStrip
        selectedDate={activeDiaryDate}
        onSelectDate={d => setSelectedDiaryDate(d)}
        title="Lịch Thực Đơn AI & Nhật Ký Ăn Uống"
      />

      {/* 1. COLLAPSIBLE 1-LINE CDSS SCOPE GATE ACCORDION + GENERATE BUTTON */}
      <div className="apple-liquid-glass px-4 py-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 text-xs">
            <ShieldAlert size={16} className="text-[#B88746] shrink-0" />
            <span className="font-semibold text-[#0F2422] shrink-0">Cổng kiểm soát phạm vi CDSS:</span>
            <span className="text-[#475D5B] truncate">
              {gateIssues.length > 0
                ? `${gateIssues.length} lưu ý đa bệnh lý — ${summarizeGateIssues(gateIssues)}`
                : `Đang bảo vệ giao thoa 4 quy tắc an toàn (${ckdStageText}, T2D, Warfarin, Uric)`}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              aria-expanded={showGateDetails}
              onClick={() => setShowGateDetails(!showGateDetails)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full porcelain-core text-xs font-medium text-[#0B4F4A] hover:bg-white cursor-pointer"
            >
              <span>{showGateDetails ? 'Thu gọn' : 'Xem chi tiết'}</span>
              {showGateDetails ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            <Btn
              disabled={isBusyGenerating || Boolean(profileIssue)}
              onClick={() => handleGeneratePlan()}
              className="!rounded-2xl text-xs"
            >
              {isBusyGenerating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              <span>{isBusyGenerating ? 'AI đang suy luận...' : 'Tạo Thực đơn Mới'}</span>
            </Btn>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <input
            type="text"
            value={userPrefNote}
            onChange={e => setUserPrefNote(e.target.value)}
            placeholder="Yêu cầu thêm cho AI khi tạo mới (VD: thích món canh chua, tránh đồ tanh, ăn nhạt miền Nam...)"
            className="flex-1 min-w-[220px] px-3 py-1.5 rounded-full bg-white/80 border border-[#0F2422]/10 text-xs text-[#0F2422] placeholder:text-[#738A87] focus:outline-none focus:border-[#0B4F4A]"
          />
          {aiBusyForPatient && aiProgress.stage && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#0B4F4A] bg-[#E1F2EF] px-3 py-1 rounded-full">
              <Loader2 size={12} className="animate-spin shrink-0" />
              {aiProgress.stage}
            </span>
          )}
        </div>

        {showGateDetails && (
          <div className="pt-3 border-t border-white/75 space-y-2.5 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              <div className="porcelain-core rounded-2xl p-3">
                <span className="font-semibold text-[#0B4F4A] block">1. {ckdStageText}</span>
                <span className="text-[11px] text-[#475D5B]">Giữ Đạm 0.6–0.8g/kg, Natri ≤ 1500mg, kiểm soát Kali & Phốt pho.</span>
              </div>
              <div className="porcelain-core rounded-2xl p-3">
                <span className="font-semibold text-[#0284C7] block">2. Đái tháo đường Type 2</span>
                <span className="text-[11px] text-[#475D5B]">Ưu tiên tinh bột GI ≤ 55, phân bổ đều carbohydrate qua các bữa.</span>
              </div>
              <div className="porcelain-core rounded-2xl p-3">
                <span className="font-semibold text-[#B8334A] block">3. Kháng đông Warfarin</span>
                <span className="text-[11px] text-[#475D5B]">Ổn định hàm lượng Vitamin K hàng ngày, tránh thay đổi đột ngột rau lá đậm.</span>
              </div>
              <div className="porcelain-core rounded-2xl p-3">
                <span className="font-semibold text-[#B88746] block">4. Gout & Acid Uric</span>
                <span className="text-[11px] text-[#475D5B]">Giới hạn thực phẩm giàu Purine (&lt; 150mg/ngày), tránh nước hầm xương đậm.</span>
              </div>
            </div>
            {gateIssues.length > 0 && (
              <div className="p-3 rounded-2xl bg-[#FDF5E6] text-[#8A622B] space-y-1">
                {gateIssues.map((iss, idx) => (
                  <div key={idx} className="text-[11px]">• {iss}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. AI CLINICAL REASONING + CITED MEDICAL DOCS & WEEK CONTROLS */}
      {currentPlan ? (
        <>
          <div className="apple-liquid-glass p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold inline-flex items-center gap-1 ${
                    currentPlan.generation_source === 'AI_LIVE'
                      ? 'bg-[#E1F2EF] text-[#0B4F4A] border border-[#0B4F4A]/20'
                      : 'bg-[#FDF5E6] text-[#8A622B] border border-[#B88746]/30'
                  }`}
                >
                  {currentPlan.generation_source === 'AI_LIVE'
                    ? `AI Trực tuyến (${currentPlan.ai_model_used || 'CDSS Model'})`
                    : 'Thực đơn Quy tắc Dự phòng (CDSS)'}
                </span>
                <span className="text-xs font-semibold text-[#0F2422]">{currentPlan.name}</span>
              </div>

              {currentPlan.generation_source !== 'AI_LIVE' && (
                <button
                  type="button"
                  disabled={isBusyGenerating || Boolean(profileIssue)}
                  onClick={() => handleGeneratePlan()}
                  className="px-3 py-1 rounded-full bg-[#0B4F4A] hover:bg-[#073935] text-white text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isBusyGenerating ? 'AI đang suy luận...' : 'Để AI suy luận thực đơn riêng ngay'}
                </button>
              )}
            </div>

            {(currentPlan.ai_reasoning || currentPlan.conflict_details) && (
              <div className="porcelain-core rounded-2xl p-3.5 text-xs space-y-1.5">
                <span className="font-semibold text-[#0B4F4A] block">
                  {currentPlan.ai_reasoning
                    ? 'Suy luận Lâm sàng của AI (từ bệnh án & tài liệu y tế hệ thống):'
                    : 'Căn cứ Giao thoa Lâm sàng CDSS:'}
                </span>
                <p className="text-[#475D5B] whitespace-pre-line leading-relaxed text-[11.5px]">
                  {currentPlan.ai_reasoning || currentPlan.conflict_details}
                </p>
                {currentPlan.generation_source === 'LOCAL_FALLBACK' && currentPlan.fallback_reason && (
                  <p className="text-[10.5px] text-[#8A622B]">
                    Ghi chú fallback: {currentPlan.fallback_reason}
                  </p>
                )}
              </div>
            )}

            {((currentPlan.evidence_basis && currentPlan.evidence_basis.length > 0) ||
              (currentPlan.referenced_doc_titles && currentPlan.referenced_doc_titles.length > 0)) && (
              <div className="flex flex-wrap items-center gap-1.5 text-[10.5px]">
                <span className="font-semibold text-[#738A87] mr-1">Tài liệu y tế hệ thống đã áp dụng:</span>
                {(currentPlan.evidence_basis && currentPlan.evidence_basis.length > 0
                  ? currentPlan.evidence_basis.map(e => e.guideline_name)
                  : currentPlan.referenced_doc_titles || []
                ).map((title, idx) => (
                  <span
                    key={idx}
                    className="px-2.5 py-0.5 rounded-full bg-[#E0F2FE]/80 text-[#0284C7] font-medium"
                  >
                    {title}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="apple-liquid-glass p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex p-1 rounded-full porcelain-core">
                  <button
                    type="button"
                    onClick={() => handleToggleDaysMode(7)}
                    className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer transition-all ${daysCount === 7 ? 'bg-[#0B4F4A] text-white font-semibold' : 'text-[#475D5B] hover:text-[#0F2422]'
                      }`}
                  >
                    Thực đơn 7 Ngày
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleDaysMode(1)}
                    className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer transition-all ${daysCount === 1 ? 'bg-[#0B4F4A] text-white font-semibold' : 'text-[#475D5B] hover:text-[#0F2422]'
                      }`}
                  >
                    Chế độ 1 Ngày
                  </button>
                </div>

                <div className="inline-flex p-1 rounded-full porcelain-core">
                  <button
                    type="button"
                    onClick={() => handleToggleMealsCount(3)}
                    className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer transition-all ${mealsCount === 3 ? 'bg-[#0284C7] text-white font-semibold' : 'text-[#475D5B] hover:text-[#0F2422]'
                      }`}
                  >
                    3 bữa chính
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleMealsCount(4)}
                    className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer transition-all ${mealsCount === 4 ? 'bg-[#0284C7] text-white font-semibold' : 'text-[#475D5B] hover:text-[#0F2422]'
                      }`}
                  >
                    4 bữa (+ Phụ)
                  </button>
                </div>
              </div>

              {/* Active Day Summary Pills */}
              <div className="flex flex-wrap items-center gap-2 font-mono-code text-xs">
                <span className="px-3 py-1 rounded-full porcelain-core text-[#0F2422]">
                  Calo: <b>{Math.round(dayNutrients.kcal)}</b> / {Math.round(targetKcal)}
                </span>
                <span className="px-3 py-1 rounded-full bg-[#E0F2FE] text-[#0284C7] font-semibold">
                  Đạm: {Math.round(dayNutrients.protein)}g
                </span>
                <span
                  className={`px-3 py-1 rounded-full font-semibold ${dayNutrients.sodium > maxSodium
                    ? 'bg-[#FFF1F3] text-[#B8334A]'
                    : 'bg-[#E1F2EF] text-[#0B4F4A]'
                    }`}
                >
                  Natri: {Math.round(dayNutrients.sodium)}mg
                </span>
                <span className="px-3 py-1 rounded-full bg-[#FDF5E6] text-[#B88746] font-semibold">
                  Carb: {Math.round(dayNutrients.carb)}g
                </span>
                <button
                  type="button"
                  onClick={() => {
                    logWholePlanDayToTodayDiary(activeDay, visibleSlots, activeDayLabel, activeDiaryDate)
                    toast(`Đã ghi toàn bộ các bữa (${activeDayLabel}) vào Nhật ký ngày ${activeDiaryDate} và cập nhật sơ đồ Tổng quan!`)
                  }}
                  className="px-3 py-1 rounded-full bg-[#0B4F4A] hover:bg-[#073935] text-white text-[11px] font-sans font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <Check size={12} />
                  <span>Ghi cả ngày vào Nhật ký</span>
                </button>
              </div>
            </div>

            {/* 7-Day Selector Strip + Mini Consistency Chart */}
            {daysCount === 7 && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center pt-2 border-t border-white/75">
                <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
                  {weeklyBarData.map(d => {
                    const isSel = effectiveDayIdx === d.idx
                    return (
                      <button
                        key={d.idx}
                        type="button"
                        onClick={() => handleSelectDay(d.idx)}
                        className={`p-2.5 rounded-2xl text-left transition-all cursor-pointer ${isSel
                          ? 'bg-[#0B4F4A] text-white shadow-md'
                          : 'porcelain-core text-[#0F2422] hover:bg-white'
                          }`}
                      >
                        <div className="text-[11px] font-semibold">{d.label}</div>
                        <div className={`font-mono-code text-xs font-bold mt-0.5 ${isSel ? 'text-[#A7F3D0]' : 'text-[#0B4F4A]'}`}>
                          {d.kcal} kcal
                        </div>
                        <div className={`text-[9.5px] leading-tight mt-0.5 line-clamp-2 ${isSel ? 'text-white/80' : 'text-[#738A87]'}`}>
                          {d.focus}
                        </div>
                      </button>
                    )
                  })}
                </div>

                {/* 7-Day Kcal Consistency Mini Bar Chart with 85% dashed ceiling */}
                <div className="lg:col-span-4 porcelain-core rounded-2xl p-3">
                  <div className="flex items-center justify-between text-[10px] mb-2">
                    <span className="font-semibold text-[#0F2422]">Nhất quán năng lượng 7 ngày</span>
                    <span className="font-mono-code text-[#B8334A]">Trần 85%: {ceiling85Kcal}</span>
                  </div>
                  <div className="relative h-16 flex items-end justify-between gap-1.5 px-1">
                    {/* 85% Dashed Ceiling Reference Line */}
                    <div
                      className="absolute inset-x-0 border-t border-dashed border-[#B8334A] pointer-events-none z-10"
                      style={{ bottom: `${Math.min(96, (ceiling85Kcal / chartMax) * 100)}%` }}
                    />
                    {weeklyBarData.map(d => {
                      const barHeight = Math.max(10, Math.min(100, (d.kcal / chartMax) * 100))
                      const over85 = d.kcal >= ceiling85Kcal
                      return (
                        <div key={d.idx} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                          <div
                            className="w-full rounded-t-lg transition-all"
                            style={{
                              height: `${barHeight}%`,
                              backgroundColor:
                                effectiveDayIdx === d.idx
                                  ? '#0B4F4A'
                                  : over85
                                    ? '#B8334A'
                                    : '#136F68',
                              opacity: effectiveDayIdx === d.idx ? 1 : 0.65
                            }}
                            title={`${d.label}: ${d.kcal} kcal`}
                          />
                          <span className="text-[9px] font-mono-code text-[#738A87]">
                            {d.label.replace('Thứ ', 'T').replace('Chủ Nhật', 'CN')}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 3. MEALS LIST */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {visibleSlots.map(slot => {
              const items = activeDay[slot] || []
              const slotNu = calc(items, s.foods)
              const slotLogged = isSlotLogged(slot, items)
              return (
                <section key={slot} className="apple-liquid-glass p-5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/75">
                    <h3 className="font-serifDisplay text-base font-semibold text-[#0F2422]">{slot}</h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono-code text-[11px] text-[#0B4F4A] bg-[#E1F2EF] px-2.5 py-0.5 rounded-full font-semibold">
                        {Math.round(slotNu.kcal)} kcal · Đạm {Math.round(slotNu.protein)}g
                      </span>
                      {items.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            if (slotLogged) {
                              removeAiSlotFromTodayDiary(slot, activeDiaryDate)
                              toast(`Đã gỡ ${slot} khỏi Nhật ký ngày ${activeDiaryDate}.`)
                            } else {
                              logPlanSlotToTodayDiary(slot, items, activeDayLabel, activeDiaryDate)
                              toast(`Đã ghi ${slot} (${activeDayLabel}) vào Nhật ký ngày ${activeDiaryDate} và cập nhật sơ đồ Tổng quan!`)
                            }
                          }}
                          className={`px-3 py-1 rounded-full text-[11px] font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer ${
                            slotLogged
                              ? 'bg-[#E1F2EF] text-[#0B4F4A] border border-[#0B4F4A]/25 hover:bg-rose-50 hover:text-[#B8334A]'
                              : 'bg-[#0B4F4A] hover:bg-[#073935] text-white'
                          }`}
                        >
                          <Check size={12} />
                          <span>{slotLogged ? 'Đã ghi nhật ký' : 'Ghi nhật ký'}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {items.length === 0 ? (
                    <p className="text-xs text-[#738A87] italic py-2">
                      Chưa có món ăn trong khung bữa này.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {items.map((item, itemIdx) => {
                        const foodObj = s.foods.find(f => f.id === item.foodId)
                        const dishName = item.foodName || foodObj?.name || 'Món ăn'
                        const itemNu = calc([item], s.foods)
                        const rawMismatch = hasFoodNameMismatch(item, s.foods)
                        const isSevereMismatch = Boolean(
                          rawMismatch &&
                          foodObj &&
                          !dishName.toLowerCase().includes(foodObj.name.toLowerCase()) &&
                          !foodObj.name.toLowerCase().includes(dishName.toLowerCase())
                        )
                        return (
                          <div
                            key={`${slot}-${itemIdx}-${item.foodId}`}
                            className="porcelain-core hover:bg-white rounded-2xl px-3.5 py-3 transition-colors space-y-2"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <span className="font-semibold text-xs text-[#0F2422] block">
                                  {dishName}
                                </span>
                                {item.note && (
                                  <p className="text-[11px] text-[#475D5B] mt-0.5 leading-snug">
                                    {item.note}
                                  </p>
                                )}
                                {isSevereMismatch && (
                                  <span className="text-[10px] text-[#B8334A] font-medium">
                                    Cảnh báo lệch định danh món ăn
                                  </span>
                                )}
                                <div className="flex flex-wrap items-center gap-1.5 mt-1 font-mono-code text-[10px]">
                                  <span className="px-2 py-0.5 rounded-full bg-[#F2F6F7] text-[#0F2422]">
                                    {Math.round(itemNu.kcal)} kcal
                                  </span>
                                  <span className="px-2 py-0.5 rounded-full bg-[#E0F2FE] text-[#0284C7]">
                                    Đạm {Math.round(itemNu.protein)}g
                                  </span>
                                  <span className="px-2 py-0.5 rounded-full bg-[#FDF5E6] text-[#B88746]">
                                    Na {Math.round(itemNu.sodium)}mg
                                  </span>
                                </div>
                              </div>

                              {/* Compact Inline -10g / clickable grams / +10g Stepper + Đổi món */}
                              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                <div className="inline-flex items-center rounded-full bg-[#F2F6F7] border border-[#0F2422]/10 p-0.5">
                                  <button
                                    type="button"
                                    onClick={() => handleStepGrams(effectiveDayIdx, slot, itemIdx, item.grams - 10)}
                                    className="px-2 py-0.5 rounded-full text-[11px] font-mono-code font-semibold text-[#0F2422] hover:bg-white cursor-pointer"
                                  >
                                    -10g
                                  </button>
                                  <button
                                    type="button"
                                    title="Nhấn để nhập trực tiếp khối lượng (gram)"
                                    onClick={() =>
                                      setEditingGramsTarget({
                                        dayIdx: effectiveDayIdx,
                                        slot,
                                        itemIdx,
                                        foodName: dishName,
                                        gramsInput: String(item.grams)
                                      })
                                    }
                                    className="px-2 py-0.5 rounded-full font-mono-code text-[11px] font-bold text-[#0B4F4A] hover:bg-white cursor-pointer"
                                  >
                                    {item.grams}g<span className="sr-only">Sửa gram</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleStepGrams(effectiveDayIdx, slot, itemIdx, item.grams + 10)}
                                    className="px-2 py-0.5 rounded-full text-[11px] font-mono-code font-semibold text-[#0F2422] hover:bg-white cursor-pointer"
                                  >
                                    +10g
                                  </button>
                                </div>

                                <button
                                  type="button"
                                  onClick={() =>
                                    setSwappingTarget({
                                      dayIdx: effectiveDayIdx,
                                      slot,
                                      itemIdx,
                                      currentFoodName: dishName,
                                      currentGrams: item.grams
                                    })
                                  }
                                  className="px-2.5 py-1 rounded-full bg-[#E1F2EF] hover:bg-[#0B4F4A] text-[#0B4F4A] hover:text-white text-[11px] font-semibold transition-colors cursor-pointer"
                                >
                                  ⇄ Đổi món
                                </button>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        </>
      ) : (
        <div className="apple-liquid-glass p-6 text-center space-y-2">
          <p className="text-sm font-medium text-[#0F2422]">
            {profileIssue || 'Chưa có thực đơn điều trị phù hợp — nhấn Tạo Thực đơn Mới ở thanh phía trên để khởi tạo.'}
          </p>
        </div>
      )}

      {/* EDIT GRAMS MODAL (Preserved verbatim assertions for E2E-04) */}
      {editingGramsTarget && (
        <Modal
          title={`Điều chỉnh định lượng: ${editingGramsTarget.foodName}`}
          onClose={() => setEditingGramsTarget(null)}
        >
          <div className="space-y-4 text-xs">
            <Field label="Khẩu phần (gram, 1g - 1500g):">
              <input
                type="number"
                min={1}
                max={1500}
                step="any"
                className={inp + ' text-sm font-semibold'}
                value={editingGramsTarget.gramsInput}
                onChange={e =>
                  setEditingGramsTarget({
                    ...editingGramsTarget,
                    gramsInput: e.target.value,
                    error: undefined
                  })
                }
              />
            </Field>
            {editingGramsTarget.error && (
              <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 font-medium">
                {editingGramsTarget.error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Btn v="s" onClick={() => setEditingGramsTarget(null)}>
                Hủy
              </Btn>
              <Btn
                onClick={() => {
                  const raw = editingGramsTarget.gramsInput.trim()
                  const parsed = Number(raw)
                  if (!raw || !Number.isFinite(parsed) || parsed < 1 || parsed > 1500) {
                    const msg = 'Khẩu phần (gram) không hợp lệ: vui lòng nhập số từ 1g đến 1500g.'
                    setEditingGramsTarget({ ...editingGramsTarget, error: msg })
                    toast(msg)
                    return
                  }
                  const err = updateDishGramsInPlan(
                    currentPlan!.id,
                    editingGramsTarget.dayIdx,
                    editingGramsTarget.slot,
                    editingGramsTarget.itemIdx,
                    parsed
                  )
                  if (err) {
                    setEditingGramsTarget({ ...editingGramsTarget, error: err })
                    toast(err)
                    return
                  }
                  const rounded = Math.round(parsed)
                  setEditingGramsTarget(null)
                  toast(
                    rounded !== parsed
                      ? `Đã làm tròn và cập nhật khẩu phần thành ${rounded}g!`
                      : 'Đã cập nhật định lượng khẩu phần!'
                  )
                }}
              >
                Lưu khẩu phần
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* DISH SWAPPER MODAL */}
      {swappingTarget && (
        <Modal
          title={`Đổi món thay thế: ${swappingTarget.currentFoodName}`}
          onClose={() => {
            setSwappingTarget(null)
            setSwapSearch('')
          }}
        >
          <div className="space-y-3 text-xs">
            <p className="text-[#475D5B]">
              Chọn món thay thế an toàn từ kho thực phẩm đã thẩm định theo hồ sơ bệnh lý của bạn:
            </p>
            <input
              type="text"
              placeholder="Tìm tên món hoặc nhóm thực phẩm..."
              value={swapSearch}
              onChange={e => setSwapSearch(e.target.value)}
              className={inp}
            />
            <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
              {s.foods
                .filter(f => f.name !== swappingTarget.currentFoodName)
                .filter(
                  f =>
                    !swapSearch.trim() ||
                    f.name.toLowerCase().includes(swapSearch.toLowerCase()) ||
                    f.category.toLowerCase().includes(swapSearch.toLowerCase())
                )
                .map(altFood => {
                  const ddi = evaluateDrugDietInteractions(
                    p,
                    [{ foodId: altFood.id, foodName: altFood.name, grams: swappingTarget.currentGrams }],
                    s.foods
                  )
                  const al = p.allergies
                    .toLowerCase()
                    .split(',')
                    .map(x => x.trim())
                    .filter(Boolean)
                  const hasAllergy = al.some(
                    a => altFood.allergens.toLowerCase().includes(a) || altFood.name.toLowerCase().includes(a)
                  )
                  return (
                    <div
                      key={altFood.id}
                      onClick={() => handleSwapConfirm(altFood, swappingTarget.currentGrams)}
                      className={`p-3 rounded-2xl border cursor-pointer bg-white transition-all flex items-center justify-between ${ddi.length > 0 || hasAllergy
                        ? 'border-rose-300 bg-rose-50/40'
                        : 'border-line hover:border-[#0B4F4A]'
                        }`}
                    >
                      <div>
                        <span className="font-semibold text-[#0F2422] text-sm block">{altFood.name}</span>
                        <span className="text-[#738A87] font-mono-code text-[11px]">
                          {altFood.kcal} kcal/100g · Na {altFood.sodium}mg · GI {altFood.gi}
                        </span>
                        {(hasAllergy || ddi.length > 0) && (
                          <span className="block text-[10px] text-[#B8334A] font-semibold mt-0.5">
                            {hasAllergy ? `Chứa dị ứng (${altFood.allergens})` : ddi[0]}
                          </span>
                        )}
                      </div>
                      <Btn v="s" className="!py-1 !px-2.5 text-xs">
                        Chọn
                      </Btn>
                    </div>
                  )
                })}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ==================== 4. FOOD DATABASE LOOKUP (4-COL + AI PERSONALIZED INSIGHT) ====================

export function Foods() {
  const s = useS()
  const p = s.profile
  const [query, setQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('Tất cả')
  const [insightFood, setInsightFood] = useState<Food | null>(null)

  const filtered = useMemo(() => {
    return s.foods.filter(f => {
      const cat = (f.category || '').toUpperCase()
      const matchesCat =
        selectedCategory === 'Tất cả' ||
        cat.includes(selectedCategory) ||
        (selectedCategory === 'TINH BỘT' && cat.includes('CARB'))
      const matchesQuery =
        !query.trim() ||
        f.name.toLowerCase().includes(query.toLowerCase()) ||
        f.category.toLowerCase().includes(query.toLowerCase())
      return matchesCat && matchesQuery
    })
  }, [query, s.foods, selectedCategory])

  const insightAnalysis = useMemo(() => {
    if (!insightFood) return null
    const sampleItem: Item[] = [{ foodId: insightFood.id, foodName: insightFood.name, grams: 100 }]
    const ddi = evaluateDrugDietInteractions(p, sampleItem, s.foods)
    const warnings = safety(p, sampleItem, s)
    const diseases = cleanAndDeduplicateDiseases(p.conditions)
    const isDanger = ddi.length > 0 || insightFood.sodium > 600 || insightFood.purine === 'Cao'
    const isCaution = !isDanger && (warnings.length > 0 || insightFood.gi > 60 || insightFood.sodium > 250)
    return {
      status: isDanger ? 'CẦN HẠN CHẾ' : isCaution ? 'DÙNG CÓ KIỂM SOÁT' : 'PHÙ HỢP',
      tone: isDanger ? 'bg-[#FFF1F3] text-[#B8334A]' : isCaution ? 'bg-[#FDF5E6] text-[#B88746]' : 'bg-[#E1F2EF] text-[#0B4F4A]',
      reasons: [
        ...ddi,
        ...warnings.map(w => `${w.label}: ${w.note}`),
        diseases.length === 0
          ? 'Hồ sơ hiện không có chống chỉ định đặc biệt với nhóm thực phẩm này.'
          : isDanger
            ? `Cần thận trọng với bệnh lý đang theo dõi (${diseases.slice(0, 2).join(', ')}).`
            : `Phù hợp đưa vào thực đơn tuần với định lượng tiêu chuẩn (${insightFood.serving || '100g/bữa'}).`
      ]
    }
  }, [insightFood, p, s])

  const categoryBadgeStyle = (catRaw: string) => {
    const cat = (catRaw || '').toLowerCase()
    if (cat.includes('tinh bột') || cat.includes('carb')) return 'bg-amber-50 text-amber-800'
    if (cat.includes('đạm') || cat.includes('thịt') || cat.includes('cá')) return 'bg-sky-50 text-sky-700'
    if (cat.includes('rau')) return 'bg-emerald-50 text-emerald-800'
    if (cat.includes('trái')) return 'bg-cyan-50 text-cyan-800'
    if (cat.includes('sữa')) return 'bg-indigo-50 text-indigo-800'
    return 'bg-[#FDF5E6] text-[#B88746]'
  }

  return (
    <div className="space-y-5">
      {/* Filter Pills + Search Input */}
      <div className="apple-liquid-glass p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {FOOD_CATEGORIES.map(cat => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer ${selectedCategory === cat
                ? 'bg-[#0B4F4A] text-white font-semibold'
                : 'porcelain-core text-[#475D5B] hover:text-[#0F2422]'
                }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <input
          aria-label="Tìm thực phẩm"
          className={inp + ' !w-80 max-w-full sm:!w-96'}
          placeholder="Tìm tên món hoặc nhóm thực phẩm..."
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {/* Collapsible Personalized AI Insight Card (Appears only on trigger) */}
      {insightFood && insightAnalysis && (
        <div className="apple-liquid-glass p-5 space-y-2.5 border-l-4 border-l-[#0B4F4A]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-[#0B4F4A]" />
              <h3 className="font-serifDisplay text-base font-semibold text-[#0F2422]">
                Nhận định AI Cá nhân hóa: {insightFood.name}
              </h3>
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono-code font-semibold ${insightAnalysis.tone}`}>
                {insightAnalysis.status}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setInsightFood(null)}
              className="text-xs text-[#738A87] hover:text-[#0F2422] cursor-pointer"
            >
              Đóng ✕
            </button>
          </div>
          <ul className="list-disc pl-5 text-xs text-[#475D5B] space-y-1">
            {insightAnalysis.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 4-Column Pastel Food Cards Grid */}
      {filtered.length === 0 ? (
        <div className="apple-liquid-glass p-8 text-center text-sm text-[#475D5B]">
          Không tìm thấy thực phẩm phù hợp với từ khóa "{query}".
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {filtered.map(food => (
            <div
              key={food.id}
              className="apple-liquid-glass p-4 sm:p-5 flex flex-col justify-between gap-3.5"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase ${categoryBadgeStyle(food.category)}`}>
                    {food.category}
                  </span>
                  <span className="font-mono-code text-xs font-bold text-[#0B4F4A]">
                    {food.kcal} kcal / 100g
                  </span>
                </div>

                <h3 className="font-serifDisplay font-semibold text-base text-[#0F2422] leading-snug">
                  {food.name}
                </h3>

                {/* 4 Porcelain Metrics */}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div className="porcelain-core rounded-xl px-2.5 py-1.5 flex items-center justify-between text-[11px]">
                    <span className="text-[#738A87]">Đạm</span>
                    <span className="font-mono-code font-semibold text-[#0284C7]">{food.protein}g</span>
                  </div>
                  <div className="porcelain-core rounded-xl px-2.5 py-1.5 flex items-center justify-between text-[11px]">
                    <span className="text-[#738A87]">Carb</span>
                    <span className="font-mono-code font-semibold text-[#0F2422]">{food.carb}g</span>
                  </div>
                  <div className="porcelain-core rounded-xl px-2.5 py-1.5 flex items-center justify-between text-[11px]">
                    <span className="text-[#738A87]">Natri</span>
                    <span className={`font-mono-code font-semibold ${food.sodium > 400 ? 'text-[#B8334A]' : 'text-[#0B4F4A]'}`}>
                      {food.sodium}mg
                    </span>
                  </div>
                  <div className="porcelain-core rounded-xl px-2.5 py-1.5 flex items-center justify-between text-[11px]">
                    <span className="text-[#738A87]">GI</span>
                    <span className="font-mono-code font-semibold text-[#B88746]">{food.gi}</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setInsightFood(food)}
                className="w-full py-2 px-3 rounded-2xl porcelain-core hover:bg-[#E1F2EF] text-[#0B4F4A] text-xs font-semibold transition-colors cursor-pointer"
              >
                ✦ Nhận định AI
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ==================== 5. AI CDSS ASSISTANT CHAT ====================

export function Chat({ compact = false }: { compact?: boolean }) {
  const s = useS()
  const p = s.profile
  const latestRecord = p.files?.[0] || s.ocrHistory?.[0]
  const displayConditions = cleanAndDeduplicateDiseases([
    ...(p.conditions || []),
    ...(latestRecord?.diseases || [])
  ])
  const displayMedications = cleanAndDeduplicateMedications(p.medications)

  const messages = getVisibleChatMessages(s)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [uploadingRecord, setUploadingRecord] = useState(false)
  const [gwHealth, setGwHealth] = useState(() => getRouterHealthSnapshot())
  const [, setAiCfgTick] = useState(0)

  useEffect(() => {
    const unsubH = subscribeRouterHealth(() => setGwHealth(getRouterHealthSnapshot()))
    const unsubC = subscribeAiConfigChange(() => {
      setAiCfgTick(v => v + 1)
      setGwHealth(getRouterHealthSnapshot())
    })
    probeGatewayHealth().catch(() => { })
    return () => {
      unsubH()
      unsubC()
    }
  }, [])

  const hasApiKey = Boolean(getApiKey() || gwHealth.gateway.hasServerKey)

  const handleChatFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingRecord(true)
    try {
      toast(`AI đang bóc tách bệnh án "${file.name}"...`)
      await ingestMedicalRecordFile(file)
      toast(`Đã bóc tách thành công "${file.name}". Vui lòng xác nhận để liên kết vào Hồ sơ!`)
    } catch (err: any) {
      setPendingRecordDraft(null)
      toast('Lỗi phân tích bệnh án: ' + (err.message || 'Không thể đọc tệp'))
    } finally {
      setUploadingRecord(false)
      e.target.value = ''
    }
  }

  const PROMPT_SUGGESTIONS = [
    'Bệnh án của tôi có lưu ý gì đặc biệt?',
    'Tôi có thể ăn chuối hay uống nước dừa không?',
    'Uống Warfarin cần chú ý rau xanh thế nào?',
    'Bún chả Hà Nội có an toàn cho người suy thận không?',
    'Hôm nay tôi đã nạp bao nhiêu Natri & Calo?'
  ]

  const handleSend = async (customText?: string) => {
    const textToSend = (customText || input).trim()
    if (!textToSend || loading) return
    setInput('')

    const originPatientId = get().activePatientId
    appendChatMessage({ from: 'u', text: textToSend }, originPatientId)
    const botMsgId = appendChatMessage({ from: 'b', text: '', streaming: true }, originPatientId)
    setLoading(true)

    try {
      let streamBuffer = ''
      const res = await runClinicalConsultAgent(textToSend, token => {
        streamBuffer += token
        updateChatMessageById(originPatientId, botMsgId, last => ({
          ...last,
          from: 'b',
          text: streamBuffer,
          streaming: true
        }))
      })

      updateChatMessageById(originPatientId, botMsgId, () => ({
        id: botMsgId,
        from: 'b',
        text: res.text || streamBuffer,
        source_type: res.source_type,
        badge_label: res.badge_label,
        badge_color: res.badge_color,
        evidence_basis: res.evidence_basis,
        estimated_dish: res.estimated_dish,
        verified_math: res.verified_math,
        groundingScore: res.groundingScore,
        agentTrajectory: res.agentTrajectory,
        streaming: false
      }))
    } catch (e: any) {
      updateChatMessageById(originPatientId, botMsgId, () => ({
        id: botMsgId,
        from: 'b',
        text: 'Lỗi phản hồi: ' + (e.message || 'Không thể kết nối trợ lý AI.'),
        streaming: false
      }))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`flex flex-col ${compact ? 'h-[480px]' : 'max-w-3xl mx-auto'} apple-liquid-glass overflow-hidden`}>
      {/* Compact Header Badges */}
      <div className="px-4 py-3 border-b border-white/80 bg-white/55 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles className="w-4 h-4 text-[#0B4F4A] shrink-0" />
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono-code font-semibold bg-[#E1F2EF] text-[#0B4F4A]">
            {hasApiKey ? 'CDSS Online Mode' : 'CDSS Grounded Mode'}
          </span>
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono-code font-semibold bg-[#E0F2FE] text-[#0284C7]">
            MCP Tools + Output Guardrails
          </span>
        </div>
        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono-code font-semibold bg-[#FDF5E6] text-[#B88746] shrink-0">
          FDA Non-Device CDS
        </span>
      </div>

      {/* Linked Medical Record Bar - Directly connected with Profile */}
      <div className="px-4 py-2 bg-[#E1F2EF]/70 border-b border-[#0B4F4A]/10 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileText size={14} className="text-[#0B4F4A] shrink-0" />
          <span className="text-[#475D5B] font-medium shrink-0">Bệnh án liên kết:</span>
          <span className="font-semibold text-[#0F2422] truncate max-w-[200px] sm:max-w-[280px]" title={latestRecord?.name || 'Hồ sơ tiêu chuẩn'}>
            {latestRecord?.name || 'Hồ sơ khỏe mạnh tiêu chuẩn (Baseline)'}
          </span>
          <span className="px-2 py-0.5 rounded-full bg-white/80 text-[#0B4F4A] text-[10px] font-mono-code font-semibold shrink-0">
            {displayConditions.length} CHẨN ĐOÁN · {displayMedications.length} THUỐC
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white hover:bg-[#E1F2EF] text-[#0B4F4A] text-[11px] font-semibold border border-[#0B4F4A]/20 transition-colors cursor-pointer shadow-sm">
            {uploadingRecord ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            <span>{uploadingRecord ? 'Đang đọc...' : 'Nạp bệnh án'}</span>
            <input
              type="file"
              accept={ACCEPTED_RECORD_TYPES}
              className="hidden"
              onChange={handleChatFileUpload}
              disabled={uploadingRecord}
            />
          </label>
          <Link
            to="/ho-so"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0B4F4A] hover:underline"
            title="Xem chi tiết hồ sơ bệnh án và giải phẫu"
          >
            <span>Xem Hồ sơ</span>
            <ArrowUpRight size={12} />
          </Link>
        </div>
      </div>

      {/* Pending Medical Record Confirmation Card in Chat */}
      {s.pendingRecordDraft && (
        <div className="p-3 bg-amber-50/95 border-b border-amber-200 shrink-0">
          <div className="text-[11px] font-semibold text-amber-900 mb-2 flex items-center gap-1">
            <AlertTriangle size={13} className="text-amber-600" />
            AI đã bóc tách bệnh án. Vui lòng bấm Xác nhận để liên kết vào Hồ sơ:
          </div>
          <ProfilePendingCard
            profile={s.profile}
            pendingDraft={s.pendingRecordDraft}
            onCancel={() => setPendingRecordDraft(null)}
            onConfirm={d => {
              confirmMedicalRecord(d)
              const originPatientId = get().activePatientId
              const cleanDiseases = cleanAndDeduplicateDiseases(d.diseases || [])
              const cleanMeds = (d.medications || []).map(m => formatMedicationDisplay(m.name, m.activeIngredient))
              appendChatMessage({
                from: 'b',
                text: `✅ **Đã liên kết bệnh án "${d.name}" vào Hồ sơ thành công!**\n\n- **Bệnh lý ghi nhận:** ${cleanDiseases.join(', ') || 'Không phát hiện'}\n- **Thuốc đang dùng:** ${cleanMeds.join(', ') || 'Không dùng thuốc'}\n- **Dị ứng:** ${d.allergies?.join(', ') || 'Không có'}\n\nToàn bộ dữ liệu lâm sàng và ngưỡng CDSS đã được đồng bộ với **Hồ sơ**, **Thực đơn**, và nạp trực tiếp vào ngữ cảnh của **Trợ lý AI**. Bạn có thể hỏi tôi bất kỳ thắc mắc nào về chế độ dinh dưỡng an toàn cho hồ sơ này!`,
                badge_label: 'Hồ sơ đã đồng bộ',
                badge_color: 'green'
              }, originPatientId)
              toast('Đã đồng bộ bệnh án vào Hồ sơ! AI đang suy luận thực đơn riêng từ bệnh án & tài liệu y tế...')
              if (!nutritionProfileIssue(get().profile)) {
                void triggerLiveAiMenuUpgrade({
                  daysCount: 7,
                  mealsCount: 3,
                  onComplete: () => {
                    toast('AI đã hoàn tất thiết kế thực đơn 7 ngày riêng theo bệnh án & tài liệu y tế!')
                  }
                })
              }
            }}
          />
        </div>
      )}

      {/* Chat Stream */}
      <div className={`${compact ? 'flex-1' : 'h-[calc(100vh-390px)] min-h-[210px] max-h-[300px]'} overflow-y-auto p-4 space-y-3`}>
        {messages.map((m, i) => {
          const isGuardrailAlert =
            m.from === 'b' &&
            (m.source_type === 'HIGH_RISK_GUARDRAIL' ||
              /guardrail/i.test(m.badge_label || '') ||
              /tuyệt đối không tự ý (giảm|ngừng|điều chỉnh) thuốc/i.test(m.text))

          return (
            <div key={i} className={`flex ${m.from === 'u' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[88%] rounded-2xl p-3.5 text-xs leading-relaxed ${m.from === 'u'
                  ? 'bg-[#0B4F4A] text-white rounded-br-md shadow-xs'
                  : isGuardrailAlert
                    ? 'bg-[#FFFBEB] border-l-4 border-amber-500 text-[#0F2422] rounded-bl-md shadow-xs'
                    : 'porcelain-core text-[#0F2422] rounded-bl-md'
                  }`}
              >
                {m.from === 'b' && (m.badge_label || isGuardrailAlert) && (
                  <div className="flex items-center gap-1.5 mb-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-mono-code font-semibold ${isGuardrailAlert
                        ? 'bg-amber-100 text-amber-900'
                        : 'bg-[#E1F2EF] text-[#0B4F4A]'
                        }`}
                    >
                      {m.badge_label || 'RÀO CHẮN AN TOÀN DƯỢC'}
                    </span>
                  </div>
                )}

                {m.from === 'u' ? (
                  <div className="whitespace-pre-wrap">{m.text}</div>
                ) : (
                  <MarkdownMessage text={m.text} streaming={m.streaming} />
                )}

                {(m.agentTrajectory?.length || m.groundingScore !== undefined) && !m.streaming && (
                  <details className="mt-2.5 p-2.5 rounded-xl bg-white/80 text-[10px] text-[#0F2422]">
                    <summary className="font-semibold cursor-pointer text-[#0B4F4A] font-mono-code select-none">
                      Lộ trình Agent · MCP ({m.agentTrajectory?.length || 0} bước)
                      {m.groundingScore !== undefined ? ` · Grounding ${Math.round(m.groundingScore * 100)}%` : ''}
                    </summary>
                    <div className="mt-1.5 space-y-1">
                      {(m.agentTrajectory || []).map(tr => (
                        <div key={tr.step} className="p-1.5 rounded-lg bg-[#F2F6F7] font-mono-code">
                          <b>#{tr.step} {tr.tool ? `[MCP: ${tr.tool}]` : '[Synthesis]'}</b> ({tr.durationMs}ms) — {tr.thought}
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {m.estimated_dish && (
                  <div className="mt-3 p-3 rounded-2xl bg-white/95 space-y-2 text-[#0F2422]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-xs text-[#0284C7] flex items-center gap-1.5">
                        <Utensils size={13} /> Ước tính dinh dưỡng: {m.estimated_dish.name}
                      </span>
                      <span className="text-[10px] font-mono-code font-semibold px-2 py-0.5 rounded-full bg-[#E1F2EF] text-[#0B4F4A]">
                        {m.estimated_dish.suitability}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-1 text-[10px] font-mono-code bg-[#F2F6F7] p-2 rounded-xl text-center">
                      <div><b>Calo:</b> {m.estimated_dish.kcal}</div>
                      <div><b>Đạm:</b> {m.estimated_dish.protein}g</div>
                      <div><b>Carb:</b> {m.estimated_dish.carb}g</div>
                      <div><b>Natri:</b> {m.estimated_dish.sodium}mg</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        saveOpenKnowledgeFoodToSystem(m.estimated_dish!)
                        toast(`Đã lưu "${m.estimated_dish!.name}" vào Kho thực phẩm của bạn!`)
                      }}
                      className="w-full py-1.5 px-3 rounded-full bg-[#0284C7] hover:bg-sky-700 text-white font-semibold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Check size={12} /> Lưu món này vào Hệ thống
                    </button>
                  </div>
                )}

                {m.from === 'b' && (m.source_type === 'AI_OPEN_MEDICAL_KNOWLEDGE' || m.source_type === 'HIGH_RISK_GUARDRAIL') && !m.streaming && (
                  <div className="mt-2.5 pt-2 border-t border-slate-200/70 flex items-center justify-between text-[10px]">
                    <span className="text-[#738A87] italic flex items-center gap-1">
                      <Info size={11} /> Cần bác sĩ thẩm định?
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const userQuery = messages[i - 1]?.text || 'Tư vấn mở rộng'
                        forwardQuestionToExpertReview(userQuery, m.text, m.source_type || 'AI_OPEN_MEDICAL_KNOWLEDGE')
                        toast('Đã gửi yêu cầu thẩm định đến Bác sĩ chuyên khoa CDSS!')
                      }}
                      className="text-[#0B4F4A] hover:underline font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <ShieldAlert size={12} /> Gửi Chuyên gia xác nhận
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {loading && !messages.some(m => m.streaming && m.text) && (
          <div className="flex justify-start">
            <div className="p-3 rounded-2xl porcelain-core text-xs text-[#475D5B] flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#0B4F4A]" />
              <span>Đang tra cứu bệnh án & kiểm tra rào chắn CDSS...</span>
            </div>
          </div>
        )}
      </div>

      {/* Suggestion Chips (flex-wrap preserved) */}
      <div className="px-3.5 pt-2.5 pb-2 border-t border-white/80 bg-white/45 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-[#738A87] font-semibold shrink-0 text-[10px] font-mono-code">Gợi ý:</span>
        {PROMPT_SUGGESTIONS.map((sug, sIdx) => (
          <button
            key={sIdx}
            type="button"
            onClick={() => handleSend(sug)}
            className="px-3 py-1 rounded-full porcelain-core hover:bg-[#E1F2EF] hover:text-[#0B4F4A] text-[#0F2422] text-[11px] shrink-0 transition-all font-medium cursor-pointer"
          >
            {sug}
          </button>
        ))}
      </div>

      {/* Chat Input with Medical Record Attachment */}
      <div className="p-3 border-t border-white/80 flex items-center gap-2 bg-white/65">
        <label
          className="p-2 rounded-full hover:bg-[#E1F2EF] text-[#475D5B] hover:text-[#0B4F4A] cursor-pointer transition-colors shrink-0 flex items-center justify-center border border-white/90 bg-white/70"
          title="Nạp tệp bệnh án (PDF, Word, TXT, Ảnh) để liên kết vào Hồ sơ & Trợ lý AI"
        >
          {uploadingRecord ? (
            <Loader2 className="w-4 h-4 animate-spin text-[#0B4F4A]" />
          ) : (
            <Paperclip className="w-4 h-4" />
          )}
          <input
            type="file"
            accept={ACCEPTED_RECORD_TYPES}
            className="hidden"
            onChange={handleChatFileUpload}
            disabled={uploadingRecord}
          />
        </label>
        <input
          className={inp + ' !text-xs !rounded-full placeholder:text-muted text-[#0F2422] font-medium flex-1'}
          placeholder="Hỏi về món ăn, bún chả, liều lượng, tương tác thuốc hoặc nạp bệnh án..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
        />
        <Btn disabled={loading || uploadingRecord} onClick={() => handleSend()} className="!py-2 !px-4">
          <Send className="w-4 h-4" />
          <span className="hidden sm:inline">Gửi</span>
        </Btn>
      </div>
    </div>
  )
}

// ==================== 6. ANALYSIS (2-COL CLINICAL RULE MATRIX) ====================

export function Analysis() {
  const s = useS()
  const activeConditions = filterAndDeduplicateConditions(s.conditions)
  const protectedRules = s.rules.filter(r => r.status === 'Đã duyệt')
  const hitlPendingRules = s.rules.filter(r => r.status !== 'Đã duyệt')

  return (
    <div className="space-y-5">
      <div className="apple-liquid-glass p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-serifDisplay text-lg sm:text-xl font-semibold text-[#0F2422]">
              Ma trận Quy tắc Lâm sàng & Bảo vệ Đa bệnh lý
            </h2>
            <p className="text-xs text-[#475D5B] mt-0.5">
              Phân tách quy tắc đang bảo vệ chủ động và các quy tắc chờ chuyên gia thẩm định HITL.
            </p>
          </div>
          <span className="px-3 py-1 rounded-full porcelain-core font-mono-code text-[11px] font-semibold text-[#0B4F4A]">
            {protectedRules.length} CHỦ ĐỘNG · {hitlPendingRules.length} CHỜ HITL
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Left Column: Active Protected Rules */}
          <div className="bg-[#E1F2EF] rounded-2xl p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#0B4F4A] flex items-center gap-1.5">
                <ShieldCheck size={15} /> Đang bảo vệ chủ động
              </span>
              <span className="font-mono-code text-[10px] px-2 py-0.5 rounded-full bg-white/80 text-[#0B4F4A] font-semibold">
                {protectedRules.length || activeConditions.length} QUY TẮC
              </span>
            </div>

            <div className="space-y-2">
              {protectedRules.length > 0 ? (
                protectedRules.map(rule => (
                  <div key={rule.id} className="porcelain-core rounded-2xl p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-xs text-[#0F2422]">{rule.title}</span>
                      <span className="font-mono-code text-[10px] text-[#0B4F4A] font-semibold">
                        Na ≤ {rule.maxSodium}mg · GI ≤ {rule.maxGI}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#475D5B]">
                      Bệnh lý: <b>{rule.condition}</b> · Nguồn: {rule.reference}
                    </p>
                  </div>
                ))
              ) : (
                activeConditions.map(c => (
                  <div key={c.id} className="porcelain-core rounded-2xl p-3 flex items-center justify-between">
                    <span className="font-semibold text-xs text-[#0F2422]">{c.name}</span>
                    <Badge t={c.status} />
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right Column: HITL Pending Rules */}
          <div className="bg-[#FDF5E6] rounded-2xl p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#B88746] flex items-center gap-1.5">
                <AlertTriangle size={15} /> Chờ thẩm định HITL
              </span>
              <span className="font-mono-code text-[10px] px-2 py-0.5 rounded-full bg-white/80 text-[#B88746] font-semibold">
                {hitlPendingRules.length} MỤC
              </span>
            </div>

            <div className="space-y-2">
              {hitlPendingRules.length > 0 ? (
                hitlPendingRules.map(rule => (
                  <div key={rule.id} className="porcelain-core rounded-2xl p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-xs text-[#0F2422]">{rule.title}</span>
                      <Badge t={rule.status} />
                    </div>
                    <p className="text-[11px] text-[#475D5B]">
                      Bệnh lý: <b>{rule.condition}</b> · Tránh: {rule.avoidCategories}
                    </p>
                  </div>
                ))
              ) : (
                <div className="porcelain-core rounded-2xl p-4 text-xs text-[#475D5B]">
                  Tất cả quy tắc lâm sàng trong hệ thống đều đã được chuyên gia CDSS phê duyệt và kích hoạt.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <LongitudinalTrendPredictor />
    </div>
  )
}

export function History() {
  const s = useS()
  return (
    <div className="space-y-4">
      <h2 className="font-serifDisplay text-xl font-semibold text-[#0F2422]">Lịch sử Thực đơn & Bệnh án</h2>
      <div className="space-y-3">
        {s.plans.map(p => (
          <Card key={p.id}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm text-[#0F2422]">{p.name}</h3>
              <Badge t={p.status} />
            </div>
            <p className="text-xs text-[#475D5B] mt-1 font-mono-code">
              Tạo ngày: {new Date(p.created).toLocaleString('vi-VN')}
            </p>
          </Card>
        ))}
      </div>
    </div>
  )
}

export function Account() {
  const s = useS()
  const user = me(s)
  const nav = useNavigate()

  return (
    <Card className="max-w-md mx-auto space-y-4">
      <h2 className="font-serifDisplay text-xl font-semibold text-[#0F2422]">Thông tin Tài khoản</h2>
      <div className="space-y-2 text-sm text-[#0F2422]">
        <div>Họ và tên: <b>{user?.name}</b></div>
        <div>Email: <b className="font-mono-code">{user?.email}</b></div>
        <div>Vai trò: <Badge t={user?.role || 'patient'} /></div>
      </div>
      <div className="pt-4 border-t border-white/75 flex justify-end gap-2">
        <Btn
          v="s"
          onClick={() => nav('/')}
        >
          Về Tổng quan
        </Btn>
        <Btn
          v="d"
          onClick={() => {
            set(d => { d.session = null })
            nav('/')
          }}
        >
          Đăng xuất
        </Btn>
      </div>
    </Card>
  )
}
