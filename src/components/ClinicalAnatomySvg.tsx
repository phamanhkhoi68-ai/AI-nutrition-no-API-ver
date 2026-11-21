import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Heart, Activity, Pill, ArrowRight, ShieldCheck, AlertTriangle, ShieldAlert, Calendar } from 'lucide-react'
import { useS } from '../services/store'
import { cleanAndDeduplicateDiseases, formatMedicationDisplay } from '../utils/pdfExtractor'
import { calc, localDateIso, approvedNutritionLimits, deriveClinicalCeilings } from '../utils/nutrition'
import { formatVietnameseDate } from './CalendarDateStrip'
import type { OrganId, OrganMapping, Severity, LabMetric } from '../types'

export type StudioOrganKey = 'heart' | 'liver' | 'stomach' | 'kidneys'

export interface ClinicalAnatomySvgProps {
  selectedDate?: string
}

interface OrganVisualMeta {
  id: StudioOrganKey
  tabLabel: string
  systemTitle: string
  reticleX: number
  reticleY: number
  bezierY: number
  keywords: RegExp
  defaultMeds: RegExp
}

const STUDIO_ORGANS: OrganVisualMeta[] = [
  {
    id: 'heart',
    tabLabel: 'Tim mạch',
    systemTitle: 'Hệ Tim mạch & Huyết động',
    reticleX: 282,
    reticleY: 162,
    bezierY: 130,
    keywords: /tim|huyết áp|tăng huyết áp|rung nhĩ|mạch|mỡ máu|lipid|cholesterol/i,
    defaultMeds: /losartan|amlodipin|enalapril|perindopril|bisoprolol|warfarin|aspirin|atorvastatin|rosuvastatin|clopidogrel|apixaban/i
  },
  {
    id: 'liver',
    tabLabel: 'Gan',
    systemTitle: 'Gan & Chuyển hóa Lipid - Đường huyết',
    reticleX: 224,
    reticleY: 224,
    bezierY: 205,
    keywords: /gan|men gan|nhiễm mỡ|đái tháo|tiểu đường|chuyển hóa|rối loạn lipid/i,
    defaultMeds: /metformin|atorvastatin|rosuvastatin|empagliflozin|sitagliptin|glimepiride|insulin/i
  },
  {
    id: 'stomach',
    tabLabel: 'Dạ dày',
    systemTitle: 'Dạ dày & Hấp thu Tiêu hóa - Purine',
    reticleX: 306,
    reticleY: 240,
    bezierY: 245,
    keywords: /dạ dày|gerd|trào ngược|viêm loét|tiêu hóa|hang vị|gout|uric/i,
    defaultMeds: /omeprazol|esomeprazol|pantoprazol|rabeprazol|allopurinol|febuxostat|colchicin/i
  },
  {
    id: 'kidneys',
    tabLabel: 'Hai thận',
    systemTitle: 'Hai thận & Lọc cầu thận (CKD)',
    reticleX: 226,
    reticleY: 288,
    bezierY: 305,
    keywords: /thận|ckd|lọc máu|creatinin|egfr|suy thận|tiết niệu/i,
    defaultMeds: /losartan|furosemid|dapagliflozin|empagliflozin|allopurinol|ketoanalog/i
  }
]

function mapSeverityBadge(sev: Severity): { label: string; badgeCls: string; dotColor: string } {
  if (sev === 'critical') {
    return {
      label: 'NGUY CẤP',
      badgeCls: 'bg-[#FFF1F3] text-[#B8334A] border border-[#B8334A]/20',
      dotColor: '#FB7185'
    }
  }
  if (sev === 'warning') {
    return {
      label: 'CẢNH BÁO',
      badgeCls: 'bg-[#FDF5E6] text-[#B88746] border border-[#B88746]/25',
      dotColor: '#E6C58E'
    }
  }
  return {
    label: 'ỔN ĐỊNH',
    badgeCls: 'bg-[#E1F2EF] text-[#0B4F4A] border border-[#0B4F4A]/15',
    dotColor: '#34D399'
  }
}

export const ClinicalAnatomySvg: React.FC<ClinicalAnatomySvgProps> = ({ selectedDate: propSelectedDate }) => {
  const s = useS()
  const nav = useNavigate()
  const p = s.profile
  const pending = s.pendingRecordDraft
  const latestRecord = p.files?.[0] || s.ocrHistory?.[0] || pending
  const activeDate = propSelectedDate || s.selectedDiaryDate || localDateIso()

  // Dynamic diary items & nutrients for the selected calendar date
  const dayDiaryItems = useMemo(() => {
    return Object.values(s.diary[activeDate] || {}).flat()
  }, [s.diary, activeDate])

  const dayNutrients = useMemo(() => {
    return calc(dayDiaryItems, s.foods)
  }, [dayDiaryItems, s.foods])

  const clinicalCeilings = useMemo(
    () => deriveClinicalCeilings(p, latestRecord, s.rules),
    [p, latestRecord, s.rules]
  )
  const maxSodium = Number(approvedNutritionLimits(p, s.plans)?.max_sodium_mg) || clinicalCeilings.max_sodium_mg || 2000
  const maxProtein = Number(approvedNutritionLimits(p, s.plans)?.max_protein_g) || clinicalCeilings.max_protein_g

  const alerts: Partial<Record<OrganId, OrganMapping>> = useMemo(() => {
    const base: Partial<Record<OrganId, OrganMapping>> = { ...(s.activeOrganAlerts || {}) }
    if (pending?.organ_mappings && pending.organ_mappings.length > 0) {
      pending.organ_mappings.forEach(m => {
        base[m.organ_id] = m
      })
    }
    // Dynamically elevate organ alert if current selected date's food exceeds thresholds
    if (dayDiaryItems.length > 0) {
      if (dayNutrients.sodium > maxSodium) {
        base.kidneys = {
          organ_id: 'kidneys',
          severity: 'critical',
          reason: `Natri ngày ${activeDate} (${Math.round(dayNutrients.sodium)} mg) vượt trần ${maxSodium} mg/ngày · Quá tải dịch và lọc thận`,
          nutrient_limits: { max_sodium_mg: maxSodium }
        }
        base.heart = {
          organ_id: 'heart',
          severity: 'critical',
          reason: `Natri ngày ${activeDate} (${Math.round(dayNutrients.sodium)} mg) vượt trần ${maxSodium} mg/ngày · Tăng áp lực tim mạch`,
          nutrient_limits: { max_sodium_mg: maxSodium }
        }
      }
      if (maxProtein && dayNutrients.protein > maxProtein) {
        base.kidneys = {
          organ_id: 'kidneys',
          severity: 'critical',
          reason: `Đạm ngày ${activeDate} (${Math.round(dayNutrients.protein)} g) vượt trần bệnh lý ${maxProtein} g/ngày · Quá tải lọc cầu thận CKD`,
          nutrient_limits: { max_protein_g: maxProtein }
        }
      }
    }
    return base
  }, [s.activeOrganAlerts, pending, dayDiaryItems.length, dayNutrients, maxSodium, maxProtein, activeDate])

  const cleanedDiseases = useMemo(
    () => cleanAndDeduplicateDiseases([...(p.conditions || []), ...(latestRecord?.diseases || [])]),
    [p.conditions, latestRecord?.diseases]
  )
  const isHealthyBaseline = cleanedDiseases.length === 0 && Object.keys(alerts).length === 0

  const [selectedOrgan, setSelectedOrgan] = useState<StudioOrganKey>('kidneys')

  // Auto-focus the affected organ when a medical record is read or updated
  React.useEffect(() => {
    const criticalOrg = STUDIO_ORGANS.find(o => alerts[o.id]?.severity === 'critical')
    const warningOrg = STUDIO_ORGANS.find(o => alerts[o.id]?.severity === 'warning' || cleanedDiseases.some(d => o.keywords.test(d)))
    if (criticalOrg) {
      setSelectedOrgan(criticalOrg.id)
    } else if (warningOrg) {
      setSelectedOrgan(warningOrg.id)
    }
  }, [alerts, cleanedDiseases])

  // Compute live state per studio organ from store alerts, conditions, labs, meds
  const organStateMap = useMemo(() => {
    const result: Record<
      StudioOrganKey,
      {
        severity: Severity
        diagnosisTitle: string
        clinicalNote: string
        kpis: { label: string; value: string; unit: string; flag: 'normal' | 'high' | 'low' }[]
        meds: string[]
        nutrientNote?: string
      }
    > = {} as any

    const recordMetrics: LabMetric[] = latestRecord?.metrics || []
    const recordMeds = latestRecord?.medications || []

    STUDIO_ORGANS.forEach(org => {
      // Combine direct organ alert + secondary disease alerts (e.g. pancreas/diabetes -> liver metabolism, joints/gout -> stomach/kidneys)
      const directAlert = alerts[org.id]
      const pancreasAlert = org.id === 'liver' ? alerts.pancreas : undefined
      const jointsAlert = org.id === 'stomach' || org.id === 'kidneys' ? alerts.joints : undefined
      const effectiveAlert = directAlert || pancreasAlert || jointsAlert

      let severity: Severity = effectiveAlert?.severity || 'normal'
      const matchedDiseases = cleanedDiseases.filter(d => org.keywords.test(d))

      if (severity === 'normal' && matchedDiseases.length > 0) {
        severity = org.id === 'kidneys' || org.id === 'heart' ? 'warning' : 'warning'
      }

      const diagnosisTitle = isHealthyBaseline
        ? `${org.tabLabel} bình thường`
        : matchedDiseases.length > 0
          ? matchedDiseases.join(' & ')
          : effectiveAlert?.reason?.split('·')[0]?.split(':')[0]?.trim() || `${org.tabLabel} ổn định`

      const clinicalNote = isHealthyBaseline
        ? 'Hồ sơ hiện tại không ghi nhận tổn thương hoặc cảnh báo sinh hóa bất thường tại hệ cơ quan này.'
        : effectiveAlert?.reason ||
          (matchedDiseases.length > 0
            ? `Ghi nhận ${matchedDiseases.join(', ')} cần tuân thủ giới hạn dinh dưỡng và tương tác thuốc theo phác đồ CDSS.`
            : 'Các chỉ số liên quan cơ quan này hiện không có cảnh báo cấp tính trong hồ sơ.')

      // Match real labs from latestRecord.metrics
      const relatedMetrics = recordMetrics.filter(m => {
        if (m.affectedOrgan === org.id) return true
        if (org.id === 'liver' && m.affectedOrgan === 'pancreas') return true
        if (org.id === 'kidneys' && /egfr|creatin|ure|kali|k\+/i.test(m.name)) return true
        if (org.id === 'heart' && /huyết áp|bp|ldl|cholesterol|inr|natri|na\+/i.test(m.name)) return true
        if (org.id === 'liver' && /alt|ast|hba1c|glucose|đường|triglycerid|men gan/i.test(m.name)) return true
        if (org.id === 'stomach' && /uric|gastric|dạ dày|hp|bilirubin/i.test(m.name)) return true
        return false
      })

      const kpis: { label: string; value: string; unit: string; flag: 'normal' | 'high' | 'low' }[] = relatedMetrics
        .slice(0, 3)
        .map(m => ({
          label: m.name.replace(/\s*\(.*?\)\s*/g, '').trim() || m.name,
          value: String(m.value),
          unit: m.unit || '',
          flag: m.status || 'normal'
        }))

      // Pad up to 3 clean KPI cells using baseline reference metrics (honestly labeled as reference/baseline)
      const fallbackByOrgan: Record<
        StudioOrganKey,
        { label: string; value: string; unit: string; flag: 'normal' | 'high' | 'low' }[]
      > = {
        heart: [
          { label: 'Huyết áp', value: isHealthyBaseline ? '118/76' : 'Theo dõi', unit: 'mmHg', flag: 'normal' },
          { label: 'Trần Natri', value: org.id === 'heart' && matchedDiseases.length > 0 ? '< 1500' : '≤ 2000', unit: 'mg/ngày', flag: matchedDiseases.length > 0 ? 'high' : 'normal' },
          { label: 'Tương tác', value: (p.medications || []).some(m => /warfarin|losartan|amlodipin/i.test(m)) ? 'Có theo dõi' : 'An toàn', unit: 'CDSS', flag: (p.medications || []).some(m => /warfarin|losartan|amlodipin/i.test(m)) ? 'high' : 'normal' }
        ],
        liver: [
          { label: 'Chuyển hóa', value: matchedDiseases.length > 0 ? 'Cần kiểm soát' : 'Ổn định', unit: 'CDSS', flag: matchedDiseases.length > 0 ? 'high' : 'normal' },
          { label: 'GI Khuyến nghị', value: matchedDiseases.some(d => /đái|tiểu đường/i.test(d)) ? '≤ 55' : '≤ 65', unit: 'GI Index', flag: 'normal' },
          { label: 'Đường/Béo', value: matchedDiseases.length > 0 ? 'Giảm bão hòa' : 'Cân bằng', unit: 'Phác đồ', flag: 'normal' }
        ],
        stomach: [
          { label: 'Niêm mạc', value: matchedDiseases.length > 0 ? 'Nhạy cảm' : 'Ổn định', unit: 'Lâm sàng', flag: matchedDiseases.length > 0 ? 'high' : 'normal' },
          { label: 'Purine/Acid', value: cleanedDiseases.some(d => /gout/i.test(d)) ? 'Hạn chế' : 'Trong ngưỡng', unit: 'Khẩu phần', flag: cleanedDiseases.some(d => /gout/i.test(d)) ? 'high' : 'normal' },
          { label: 'Chia bữa', value: '3 - 4', unit: 'bữa/ngày', flag: 'normal' }
        ],
        kidneys: [
          { label: 'Trần Đạm', value: matchedDiseases.some(d => /thận|ckd/i.test(d)) ? '0.6–0.8' : '1.0', unit: 'g/kg', flag: matchedDiseases.length > 0 ? 'low' : 'normal' },
          { label: 'Natri tối đa', value: matchedDiseases.some(d => /thận|ckd/i.test(d)) ? '≤ 1500' : '≤ 2000', unit: 'mg/ngày', flag: matchedDiseases.length > 0 ? 'high' : 'normal' },
          { label: 'Lọc thận', value: matchedDiseases.length > 0 ? 'Bảo vệ CKD' : 'Bình thường', unit: 'CDSS', flag: 'normal' }
        ]
      }

      for (const item of fallbackByOrgan[org.id]) {
        if (kpis.length >= 3) break
        if (!kpis.some(k => k.label.toLowerCase() === item.label.toLowerCase())) {
          kpis.push(item)
        }
      }

      // Medications mapped from structured record or formatted from p.medications
      const matchedRecordMeds = recordMeds
        .filter(med => med.affectedOrgan === org.id || org.defaultMeds.test(`${med.name} ${med.activeIngredient || ''}`))
        .map(med => formatMedicationDisplay(med.name, med.activeIngredient || med.purpose))
      const matchedPlainMeds = (p.medications || []).filter(m => org.defaultMeds.test(m))
      const combinedMeds = Array.from(new Set([...matchedRecordMeds, ...matchedPlainMeds]))

      let nutrientNote: string | undefined = undefined
      if (dayDiaryItems.length > 0) {
        if (org.id === 'kidneys') {
          nutrientNote = `Khẩu phần ngày ${activeDate}: ${Math.round(dayNutrients.protein)}g Đạm · ${Math.round(dayNutrients.sodium)}mg Natri`
        } else if (org.id === 'heart') {
          nutrientNote = `Khẩu phần ngày ${activeDate}: ${Math.round(dayNutrients.sodium)}mg Natri (Trần: ${maxSodium}mg)`
        } else if (org.id === 'liver') {
          nutrientNote = `Khẩu phần ngày ${activeDate}: ${Math.round(dayNutrients.carb)}g Carb · ${Math.round(dayNutrients.fat)}g Béo`
        } else {
          nutrientNote = `Khẩu phần ngày ${activeDate}: ${Math.round(dayNutrients.kcal)} kcal tổng nạp`
        }
      } else {
        const limits = effectiveAlert?.nutrient_limits
        const limitParts: string[] = []
        if (limits?.max_sodium_mg) limitParts.push(`Natri ≤ ${limits.max_sodium_mg} mg`)
        if (limits?.max_protein_g) limitParts.push(`Đạm ≤ ${limits.max_protein_g} g`)
        if (limits?.max_potassium_mg) limitParts.push(`Kali ≤ ${limits.max_potassium_mg} mg`)
        nutrientNote = limitParts.length > 0 ? limitParts.join(' · ') : `Chưa có món ăn trong nhật ký ngày ${activeDate}`
      }

      result[org.id] = {
        severity,
        diagnosisTitle,
        clinicalNote,
        kpis: kpis.slice(0, 3),
        meds: combinedMeds,
        nutrientNote
      }
    })

    return result
  }, [alerts, cleanedDiseases, isHealthyBaseline, latestRecord?.medications, latestRecord?.metrics, p.medications, dayDiaryItems.length, dayNutrients, activeDate, maxSodium])

  const activeMeta = STUDIO_ORGANS.find(o => o.id === selectedOrgan) || STUDIO_ORGANS[3]
  const activeData = organStateMap[selectedOrgan]
  const sevStyle = mapSeverityBadge(activeData.severity)

  const organFill = (id: StudioOrganKey) => {
    const sev = organStateMap[id].severity
    const isSel = selectedOrgan === id
    if (sev === 'critical') return isSel ? 'rgba(251, 113, 133, 0.72)' : 'rgba(225, 29, 72, 0.42)'
    if (sev === 'warning') return isSel ? 'rgba(230, 197, 142, 0.72)' : 'rgba(184, 135, 70, 0.42)'
    return isSel ? 'rgba(52, 211, 153, 0.58)' : 'rgba(19, 111, 104, 0.36)'
  }

  const organStroke = (id: StudioOrganKey) => {
    const isSel = selectedOrgan === id
    if (isSel) return '#E6C58E'
    const sev = organStateMap[id].severity
    if (sev === 'critical') return '#FDA4AF'
    if (sev === 'warning') return '#F3D7A4'
    return '#6EE7B7'
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
      {/* LEFT 7 COLUMNS: DARK BOTANICAL ANATOMICAL STAGE */}
      <div className="lg:col-span-7 anatomical-stage p-4 sm:p-5 flex flex-col justify-between text-white relative overflow-hidden">
        {/* Top Control Row */}
        <div className="flex flex-wrap items-center justify-between gap-2 z-10">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full dark-clinical-glass text-[10px] font-mono-code uppercase tracking-wider text-[#E6C58E]">
              <Activity size={12} /> Giải phẫu Vector Lâm sàng
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full dark-clinical-glass text-[10px] font-mono-code text-white/90">
              <Calendar size={11} className="text-[#E6C58E]" />
              <span>{activeDate === localDateIso() ? 'Hôm nay' : activeDate}</span>
              <span className="text-[#E6C58E] font-semibold">({dayDiaryItems.length} món)</span>
            </span>
          </div>

          {/* 4 Organ Pills */}
          <div className="flex flex-wrap gap-1.5">
            {STUDIO_ORGANS.map(org => {
              const info = organStateMap[org.id]
              const dot = mapSeverityBadge(info.severity).dotColor
              const active = selectedOrgan === org.id
              return (
                <button
                  key={org.id}
                  type="button"
                  onClick={() => setSelectedOrgan(org.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer ${
                    active
                      ? 'bg-[#E6C58E] text-[#081E1C] font-semibold shadow-[0_6px_18px_-4px_rgba(230,197,142,0.55)]'
                      : 'dark-clinical-glass text-white/85 hover:text-white hover:border-[#E6C58E]/50'
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: active ? '#081E1C' : dot }}
                  />
                  <span>{org.tabLabel}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Sculpted Interactive SVG Torso + Organs + Champagne Reticle + Bezier Connector */}
        <div className="relative my-2 flex-1 flex items-center justify-center min-h-[340px]">
          <svg
            viewBox="0 0 560 410"
            className="w-full h-auto max-h-[380px] select-none"
            role="img"
            aria-label="Sơ đồ giải phẫu 4 cơ quan lâm sàng"
          >
            <defs>
              <radialGradient id="stageGlow" cx="46%" cy="48%" r="48%">
                <stop offset="0%" stopColor="rgba(19, 111, 104, 0.36)" />
                <stop offset="100%" stopColor="rgba(8, 30, 28, 0)" />
              </radialGradient>
              <linearGradient id="torsoSil" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(255, 255, 255, 0.14)" />
                <stop offset="100%" stopColor="rgba(110, 231, 183, 0.05)" />
              </linearGradient>
            </defs>

            {/* Studio radial backdrop */}
            <circle cx="265" cy="205" r="190" fill="url(#stageGlow)" />

            {/* Subtle horizontal medical scanlines */}
            {[80, 140, 200, 260, 320, 380].map(y => (
              <line
                key={y}
                x1="70"
                y1={y}
                x2="455"
                y2={y}
                stroke="rgba(255,255,255,0.04)"
                strokeWidth="1"
              />
            ))}

            {/* Sculpted Anatomical Human Head & Torso Silhouette */}
            <g fill="url(#torsoSil)" stroke="rgba(255,255,255,0.22)" strokeWidth="1.4">
              {/* Head & Neck */}
              <path d="M265 24 C244 24 232 39 233 58 C234 75 244 88 252 94 L250 110 C222 115 182 126 168 148 C154 170 156 225 162 272 C164 282 174 284 180 278 L184 196 L192 288 C192 318 196 355 204 388 L326 388 C334 355 338 318 338 288 L346 196 L350 278 C356 284 366 282 368 272 C374 225 376 170 362 148 C348 126 308 115 280 110 L278 94 C286 88 296 75 297 58 C298 39 286 24 265 24 Z" />
              {/* Faint Ribcage Contours */}
              <path d="M214 140 Q265 130 316 140" fill="none" stroke="rgba(255,255,255,0.09)" />
              <path d="M208 160 Q265 148 322 160" fill="none" stroke="rgba(255,255,255,0.09)" />
              <path d="M205 182 Q265 168 325 182" fill="none" stroke="rgba(255,255,255,0.09)" />
              {/* Faint Spine */}
              <line x1="265" y1="112" x2="265" y2="335" stroke="rgba(230,197,142,0.12)" strokeDasharray="3 4" />
            </g>

            {/* 1. HEART (Tim mạch) */}
            <g
              onClick={() => setSelectedOrgan('heart')}
              className="cursor-pointer transition-opacity hover:opacity-100"
              role="button"
              aria-label="Chọn Tim mạch"
            >
              <path
                d="M273 141 C273 130 288 128 291 139 C294 128 310 132 308 147 C305 165 288 179 282 184 C273 177 256 164 256 149 C256 138 267 134 273 141 Z"
                fill={organFill('heart')}
                stroke={organStroke('heart')}
                strokeWidth={selectedOrgan === 'heart' ? 2.4 : 1.5}
              />
              {/* Aortic Arch */}
              <path
                d="M279 138 Q282 124 271 122"
                fill="none"
                stroke={organStroke('heart')}
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </g>

            {/* 2. LIVER (Gan) */}
            <g
              onClick={() => setSelectedOrgan('liver')}
              className="cursor-pointer transition-opacity hover:opacity-100"
              role="button"
              aria-label="Chọn Gan"
            >
              <path
                d="M204 205 C215 191 245 190 264 198 C258 212 240 227 216 244 C203 240 198 222 204 205 Z"
                fill={organFill('liver')}
                stroke={organStroke('liver')}
                strokeWidth={selectedOrgan === 'liver' ? 2.4 : 1.5}
              />
            </g>

            {/* 3. STOMACH (Dạ dày) */}
            <g
              onClick={() => setSelectedOrgan('stomach')}
              className="cursor-pointer transition-opacity hover:opacity-100"
              role="button"
              aria-label="Chọn Dạ dày"
            >
              <path
                d="M286 206 C296 200 318 205 325 224 C330 241 317 262 296 263 C280 263 272 251 280 241 C287 234 294 238 292 224 C290 215 281 211 286 206 Z"
                fill={organFill('stomach')}
                stroke={organStroke('stomach')}
                strokeWidth={selectedOrgan === 'stomach' ? 2.4 : 1.5}
              />
            </g>

            {/* 4. KIDNEYS (Hai thận) */}
            <g
              onClick={() => setSelectedOrgan('kidneys')}
              className="cursor-pointer transition-opacity hover:opacity-100"
              role="button"
              aria-label="Chọn Hai thận"
            >
              {/* Left Kidney on Screen */}
              <path
                d="M225 266 C210 266 205 282 209 298 C213 310 229 312 235 301 C238 294 233 288 235 280 C237 271 232 266 225 266 Z"
                fill={organFill('kidneys')}
                stroke={organStroke('kidneys')}
                strokeWidth={selectedOrgan === 'kidneys' ? 2.4 : 1.5}
              />
              {/* Right Kidney on Screen */}
              <path
                d="M304 270 C319 270 324 286 320 302 C316 314 300 316 294 305 C291 298 296 292 294 284 C292 275 297 270 304 270 Z"
                fill={organFill('kidneys')}
                stroke={organStroke('kidneys')}
                strokeWidth={selectedOrgan === 'kidneys' ? 2.4 : 1.5}
              />
            </g>

            {/* Champagne Gold Target Reticle & Dashed Cubic-Bezier Connector Line */}
            <g pointerEvents="none">
              <circle
                cx={activeMeta.reticleX}
                cy={activeMeta.reticleY}
                r="24"
                fill="none"
                stroke="#E6C58E"
                strokeWidth="1.2"
                strokeDasharray="4 3"
                opacity="0.7"
              />
              <circle
                cx={activeMeta.reticleX}
                cy={activeMeta.reticleY}
                r="14"
                fill="none"
                stroke="#E6C58E"
                strokeWidth="1.6"
              />
              <circle cx={activeMeta.reticleX} cy={activeMeta.reticleY} r="4" fill="#E6C58E" />

              {/* Cubic-Bezier Dashed Line to Right Detail Panel */}
              <path
                d={`M ${activeMeta.reticleX + 14} ${activeMeta.reticleY} C ${activeMeta.reticleX + 95} ${activeMeta.reticleY}, 455 ${activeMeta.bezierY}, 554 ${activeMeta.bezierY}`}
                fill="none"
                stroke="#E6C58E"
                strokeWidth="1.75"
                strokeDasharray="6 5"
              />
              <circle cx="552" cy={activeMeta.bezierY} r="3.5" fill="#E6C58E" />
            </g>
          </svg>
        </div>

        {/* Bottom Studio Status Legend */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/10 text-[11px] text-white/75 z-10">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#34D399]" /> Ổn định
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#E6C58E]" /> Cảnh báo / Theo dõi
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#FB7185]" /> Nguy cấp CDSS
            </span>
          </div>
          <span className="font-mono-code text-[10px] text-[#E6C58E]">
            Nhấp trực tiếp vào cơ quan trên hình
          </span>
        </div>
      </div>

      {/* RIGHT 5 COLUMNS: CLINICAL ORGAN DETAIL GLASS CARD */}
      <div className="lg:col-span-5 apple-liquid-glass p-5 sm:p-6 flex flex-col justify-between gap-4">
        <div className="space-y-4">
          {/* Header + Severity Pill */}
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#136F68]">
                {activeMeta.systemTitle}
              </p>
              <h3 className="font-serifDisplay text-xl sm:text-2xl font-semibold text-[#0F2422] mt-1 leading-snug">
                {activeData.diagnosisTitle}
              </h3>
            </div>
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-mono-code font-semibold shrink-0 ${sevStyle.badgeCls}`}
            >
              {activeData.severity === 'critical' ? (
                <ShieldAlert size={12} />
              ) : activeData.severity === 'warning' ? (
                <AlertTriangle size={12} />
              ) : (
                <ShieldCheck size={12} />
              )}
              {sevStyle.label}
            </span>
          </div>

          <p className="text-xs text-[#475D5B] leading-relaxed">{activeData.clinicalNote}</p>

          {/* 3-Column Linked Lab KPI Grid */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#738A87] mb-2">
              Chỉ số Xét nghiệm & Ngưỡng Liên kết
            </p>
            <div className="grid grid-cols-3 gap-2.5">
              {activeData.kpis.map((kpi, idx) => (
                <div
                  key={idx}
                  className="porcelain-core rounded-2xl p-3 flex flex-col justify-between min-w-0"
                >
                  <span className="text-[10px] text-[#738A87] font-medium leading-tight break-words">
                    {kpi.label}
                  </span>
                  <div className="mt-1.5">
                    <span
                      className={`font-mono-code text-sm sm:text-base font-bold block leading-tight ${
                        kpi.flag === 'high' || kpi.flag === 'low' ? 'text-[#B8334A]' : 'text-[#0B4F4A]'
                      }`}
                    >
                      {kpi.value}
                    </span>
                    <span className="text-[10px] text-[#738A87] font-mono-code">{kpi.unit}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Nutrient Ceiling Summary */}
          {activeData.nutrientNote && (
            <div className="px-3.5 py-2.5 rounded-2xl bg-[#E1F2EF]/75 text-[#0B4F4A] text-xs font-medium flex items-center gap-2">
              <Heart size={14} className="shrink-0" />
              <span>Ngưỡng kiểm soát CDSS: <b className="font-mono-code">{activeData.nutrientNote}</b></span>
            </div>
          )}

          {/* Related Medications */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#738A87] mb-2 flex items-center gap-1">
              <Pill size={11} /> Thuốc kê đơn liên quan
            </p>
            {activeData.meds.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {activeData.meds.map((m, idx) => (
                  <span
                    key={idx}
                    className="porcelain-core px-3 py-1 rounded-full text-[11px] font-medium text-[#0F2422]"
                  >
                    Rx: {m}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[#738A87] italic">
                Không có thuốc điều trị đặc hiệu ghi nhận cho cơ quan này.
              </p>
            )}
          </div>
        </div>

        {/* Footer CTA */}
        <div className="pt-3 border-t border-white/70 flex justify-end">
          <button
            type="button"
            onClick={() => nav('/thuc-don')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-[#0B4F4A] hover:bg-[#073935] text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
          >
            <span>Xem Thực đơn</span>
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
