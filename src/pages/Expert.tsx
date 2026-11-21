import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useS, set, log, uid, me, approvePlan, rejectPlan, swapDishInPlan } from '../services/store'
import { callMcpTool } from '../services/mcpTools'
import {
  Btn,
  Card,
  Crud,
  Badge,
  Modal,
  Field,
  inp,
  toast,
  ClinicalBasisAccordion
} from '../components/ui'
import { Anatomy3DVisualizer } from '../components/Anatomy3DVisualizer'
import { generateBriefing } from '../services/aiService'
import type { Doc, Rule, EvidenceBasis, MedicalRecordExtraction } from '../types'
import { age, isCurrentMealPlan, nutritionProfileIssue } from '../utils/nutrition'
import { cleanAndDeduplicateDiseases, cleanAndDeduplicateMedications } from '../utils/pdfExtractor'
import {
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  FileText,
  AlertTriangle,
  Loader2,
  ArrowRightLeft,
  Quote,
  Stethoscope,
  Clock,
  ClipboardCheck,
  FileCheck2,
  FileClock
} from 'lucide-react'

function PatientContextBar({
  patientName,
  patientId,
  profile,
  latestFile
}: {
  patientName: string
  patientId: string
  profile: ReturnType<typeof useS>['profile']
  latestFile?: MedicalRecordExtraction
}) {
  const diseases = cleanAndDeduplicateDiseases(profile.conditions)
  const meds = cleanAndDeduplicateMedications(profile.medications)
  const issue = nutritionProfileIssue(profile)
  const calcAge = profile.dob ? age(profile.dob) : null

  return (
    <div className="staff-context-banner px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-[#E1F2EF] text-brand flex items-center justify-center shrink-0 border border-[#0B4F4A]/15">
          <Stethoscope className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="staff-kicker">Hồ sơ đang chọn (Patient Context)</span>
            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-ink text-[10px] staff-num font-semibold border border-line">
              Mã HS: {patientId || 'N/A'}
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                issue
                  ? 'bg-amber-50 text-amber-800 border border-amber-200'
                  : 'bg-[#E1F2EF] text-brand border border-[#0B4F4A]/20'
              }`}
            >
              {issue ? 'Thiếu chỉ số nhân trắc' : 'Chỉ số hợp lệ'}
            </span>
          </div>
          <p className="text-sm font-semibold text-ink mt-0.5 truncate">
            {patientName}
            {calcAge !== null ? ` · ${calcAge} tuổi` : ''}
            {profile.weight ? ` · ${profile.weight} kg` : ''}
            {profile.height ? ` · ${profile.height} cm` : ''}
          </p>
          <p className="text-xs text-muted truncate">
            {diseases.length > 0 ? `Bệnh lý: ${diseases.join(', ')}` : 'Chưa ghi nhận bệnh lý nền'}
            {meds.length > 0 ? ` · Thuốc: ${meds.join(', ')}` : ''}
          </p>
        </div>
      </div>

      <div className="flex flex-col items-start sm:items-end gap-1 text-[11px] text-muted shrink-0">
        <span className="inline-flex items-center gap-1 font-medium text-ink">
          <Clock className="w-3.5 h-3.5 text-brand" />
          Bệnh án gần nhất: {latestFile ? latestFile.date : 'Chưa có tệp'}
        </span>
        {latestFile && (
          <span className="text-[11px] text-muted max-w-[260px] truncate" title={latestFile.name}>
            Nguồn: {latestFile.name} ({latestFile.confirmed ? 'Đã xác nhận' : 'Chưa xác nhận'})
          </span>
        )}
      </div>
    </div>
  )
}

// ==================== 1. CDSS HITL CLINICAL REVIEW PAGE ====================

export function CDSSReviewPage() {
  const s = useS()
  const p = s.profile

  // Pending plans (strict HITL queue: ONLY PENDING_EXPERT_REVIEW)
  const currentPlans = s.plans.filter(plan => isCurrentMealPlan(plan, p))
  const pendingPlans = currentPlans.filter(plan => plan.status === 'PENDING_EXPERT_REVIEW')
  const [selectedPlanId, setSelectedPlanId] = useState<string>('')
  const pendingPlan = pendingPlans.find(plan => plan.id === selectedPlanId) || pendingPlans[0]

  // Expert form state
  const [expertNote, setExpertNote] = useState('')
  const [maxSodium, setMaxSodium] = useState(0)
  const [maxProtein, setMaxProtein] = useState(0)
  const [maxGI, setMaxGI] = useState(0)
  useEffect(() => {
    setExpertNote(pendingPlan?.expert_notes || '')
    setMaxSodium(Number(pendingPlan?.hard_limits?.max_sodium_mg) || 0)
    setMaxProtein(Number(pendingPlan?.hard_limits?.max_protein_g) || 0)
    setMaxGI(Number(pendingPlan?.hard_limits?.max_gi) || 0)
  }, [pendingPlan?.id, pendingPlan?.version])

  const [briefing, setBriefing] = useState<{ summary: string; riskFactors: string[]; recommendedOverrides: string[] } | null>(null)
  const [loadingBriefing, setLoadingBriefing] = useState(false)
  const [selectedSlotForSwap, setSelectedSlotForSwap] = useState<{
    dayIdx: number
    slot: string
    itemIdx: number
    foodName: string
  } | null>(null)
  const [swapSearch, setSwapSearch] = useState('')
  const [expertFhirPreview, setExpertFhirPreview] = useState('')

  const handleFetchBriefing = async () => {
    if (!pendingPlan) return
    setLoadingBriefing(true)
    try {
      const res = await generateBriefing(p, pendingPlan)
      setBriefing(res)
      toast('Đã tạo bản tóm tắt lâm sàng từ AI CDSS!')
    } catch (e: any) {
      toast('Lỗi tạo tóm tắt: ' + e.message)
    } finally {
      setLoadingBriefing(false)
    }
  }

  const handleApprove = () => {
    if (!pendingPlan) return
    const err = approvePlan(
      pendingPlan.id,
      expertNote,
      {
        max_sodium_mg: Math.max(0, maxSodium),
        max_protein_g: Math.max(0, maxProtein),
        max_gi: Math.max(0, maxGI)
      },
      s.activePatientId
    )
    if (err) {
      toast(err)
      return
    }
    toast('ĐÃ PHÊ DUYỆT THỰC ĐƠN (EXPERT_APPROVED)! Trạng thái đã đồng bộ trực tiếp tới bệnh nhân.')
  }

  const handleReject = () => {
    if (!pendingPlan) return
    if (!expertNote.trim()) {
      return toast('Vui lòng nhập lý do từ chối để bệnh nhân và hệ thống AI biết nguyên nhân.')
    }
    const err = rejectPlan(pendingPlan.id, expertNote, s.activePatientId)
    if (err) {
      toast(err)
      return
    }
    toast('ĐÃ TỪ CHỐI THỰC ĐƠN (REJECTED)! Yêu cầu AI và bệnh nhân điều chỉnh lại.')
  }

  const activePatient = s.users.find(u => u.id === s.activePatientId)
  const patientFiles = p.files || []
  const currentConfirmedFile = patientFiles.find(f => f.confirmed !== false) || patientFiles[0] || s.ocrHistory?.[0]
  const historicalFiles = patientFiles.filter(f => f.id !== currentConfirmedFile?.id)
  const unverifiedDraft = s.pendingRecordDraft && !s.pendingRecordDraft.confirmed ? s.pendingRecordDraft : null

  const actualEgfrMetric = currentConfirmedFile?.metrics?.find(m => /egfr/i.test(m.name))
  const patientConditionsText = (p.conditions || []).join(' ').toLowerCase()
  const patientMedsText = (p.medications || []).join(' ').toLowerCase()

  const dynamicEvidence: EvidenceBasis[] = (() => {
    const list: EvidenceBasis[] = [...(pendingPlan?.evidence_basis || [])]
    if (/thận|ckd|suy thận/.test(patientConditionsText) || actualEgfrMetric) {
      const egfrDesc = actualEgfrMetric
        ? `eGFR hiện tại ${actualEgfrMetric.value} ${actualEgfrMetric.unit || 'ml/phút'}`
        : 'bệnh lý thận mạn ghi nhận trong hồ sơ'
      if (!list.some(e => /kdigo/i.test(e.guideline_name))) {
        list.push({
          guideline_name: 'KDIGO 2024 Clinical Practice Guideline for CKD',
          citation_url: 'https://kdigo.org/guidelines/ckd-evaluation-and-management/',
          rationale: `Đối chiếu hồ sơ (${egfrDesc}): khuyến nghị kiểm soát đạm và natri phù hợp mức lọc cầu thận hiện hành.`
        })
      }
    }
    if (/warfarin/.test(patientMedsText) && !list.some(e => /warfarin/i.test(e.guideline_name))) {
      list.push({
        guideline_name: 'FDA & RxNorm Drug-Diet Interaction Protocol (Warfarin)',
        citation_url: 'https://www.accessdata.fda.gov/scripts/cder/daf/',
        pharmacology_source: 'RxNorm CUI: 11289 (Warfarin Sodium)',
        rationale: 'Vitamin K ngoại sinh từ rau lá xanh đậm cạnh tranh trực tiếp tại enzym VKORC1, cần giữ ổn định khi bệnh nhân đang dùng Warfarin.'
      })
    }
    if (/đái tháo đường|tiểu đường|diabetes/.test(patientConditionsText) && !list.some(e => /ada/i.test(e.guideline_name))) {
      list.push({
        guideline_name: 'ADA Standards of Care in Diabetes 2024',
        citation_url: 'https://diabetesjournals.org/care/issue/47/Supplement_1',
        rationale: 'Ưu tiên tinh bột có chỉ số đường huyết GI < 55 để tránh tăng glucose huyết đột ngột sau ăn.'
      })
    }
    if (list.length === 0) {
      list.push({
        guideline_name: 'Hướng dẫn Dinh dưỡng Lâm sàng CDSS (Hồ sơ hiện hành)',
        citation_url: 'https://www.who.int/news-room/fact-sheets/detail/healthy-diet',
        rationale: `Áp dụng theo chỉ số thực tế của ${activePatient?.name || 'bệnh nhân đang chọn'} (Cân nặng ${p.weight || '—'} kg, Chiều cao ${p.height || '—'} cm).`
      })
    }
    return list
  })()

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="staff-kicker">Cổng Thẩm định Chuyên khoa (HITL)</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] staff-num font-semibold bg-amber-50 text-amber-900 border border-amber-200">
              FDA NON-DEVICE CDS
            </span>
          </div>
          <h1 className="staff-section-title text-xl sm:text-2xl font-semibold mt-0.5">
            Thẩm định Lâm sàng CDSS (Human-in-the-Loop)
          </h1>
          <p className="text-xs text-muted mt-0.5">
            Hàng đợi chỉ hiển thị kế hoạch đang chờ duyệt (PENDING_EXPERT_REVIEW). Đối chiếu bệnh án, ghi đè món ăn và phê duyệt thực đơn.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Btn v="s" disabled={loadingBriefing || !pendingPlan} onClick={handleFetchBriefing} className="inline-flex items-center gap-1.5">
            {loadingBriefing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardCheck className="w-4 h-4 text-brand" />}
            AI Tóm tắt Lâm sàng
          </Btn>
        </div>
      </div>

      {/* Patient Context Strip */}
      <PatientContextBar
        patientName={activePatient?.name || 'Bệnh nhân'}
        patientId={s.activePatientId || 'N/A'}
        profile={p}
        latestFile={currentConfirmedFile}
      />

      {/* HITL Pending Queue Bar */}
      {pendingPlans.length > 0 && (
        <div className="staff-surface px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
            <span className="font-semibold text-ink">
              Hàng đợi chờ thẩm định ({pendingPlans.length}):
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {pendingPlans.map(plan => (
              <button
                key={plan.id}
                type="button"
                onClick={() => setSelectedPlanId(plan.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors cursor-pointer ${
                  pendingPlan?.id === plan.id
                    ? 'bg-brand text-white border-brand shadow-2xs'
                    : 'bg-white text-ink border-line hover:border-brand'
                }`}
              >
                {plan.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* AI Pre-Screening Briefing Card */}
      {briefing && pendingPlan && (
        <Card className="border border-[#0B4F4A]/30 bg-[#E1F2EF]/40">
          <div className="flex items-center justify-between pb-2 border-b border-[#0B4F4A]/15">
            <h3 className="font-semibold text-brand text-sm flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-brand" /> Báo cáo Tiền thẩm định AI CDSS (Briefing)
            </h3>
            <span className="text-[10px] staff-num text-muted uppercase">Hỗ trợ quyết định lâm sàng</span>
          </div>
          <p className="text-xs text-ink mt-2 leading-relaxed">{briefing.summary}</p>
          <div className="grid md:grid-cols-2 gap-3 mt-3 text-xs">
            <div className="p-3 rounded-xl bg-white border border-line">
              <span className="font-semibold text-rose-700 block mb-1">Yếu tố nguy cơ phát hiện:</span>
              <ul className="list-disc ml-4 space-y-0.5 text-muted text-[11px]">
                {(briefing.riskFactors ?? []).map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
            <div className="p-3 rounded-xl bg-white border border-line">
              <span className="font-semibold text-emerald-800 block mb-1">Khuyến nghị điều chỉnh:</span>
              <ul className="list-disc ml-4 space-y-0.5 text-muted text-[11px]">
                {(briefing.recommendedOverrides ?? []).map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      )}

      {/* 2-Column Clinical Review Layout: Left = Records/Evidence/Anatomy | Right = Plan/Limits/HITL */}
      <div className="grid lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN (5/12): Medical Records Status + Lab Metrics + Evidence + 3D Anatomy */}
        <div className="lg:col-span-5 space-y-4">
          <div className="staff-surface p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm text-ink flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-brand" /> Hồ sơ Bệnh án & Chỉ số Sinh hóa
              </h2>
              <span className="text-[10px] staff-num text-muted">
                {patientFiles.length} bản ghi
              </span>
            </div>

            {unverifiedDraft && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-amber-900 inline-flex items-center gap-1">
                    <FileClock className="w-3.5 h-3.5" /> Bản nháp chưa xác nhận
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-white text-[10px] text-amber-800 border border-amber-200 font-semibold">
                    CHƯA XÁC MINH
                  </span>
                </div>
                <p className="text-[11px] text-amber-900/90">
                  Nguồn: {unverifiedDraft.name} · Ngày: {unverifiedDraft.date}
                </p>
              </div>
            )}

            {currentConfirmedFile ? (
              <div className="p-3 rounded-xl bg-[#F7FAFB] border border-line space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-ink inline-flex items-center gap-1.5 min-w-0 truncate">
                    <FileCheck2 className="w-4 h-4 text-brand shrink-0" />
                    <span className="truncate">{currentConfirmedFile.name}</span>
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-[#E1F2EF] text-brand text-[10px] font-semibold shrink-0">
                    HIỆN HÀNH · {currentConfirmedFile.date}
                  </span>
                </div>
                {currentConfirmedFile.metrics && currentConfirmedFile.metrics.length > 0 && (
                  <div className="staff-table-wrap mt-2">
                    <table className="text-[11px]">
                      <thead>
                        <tr>
                          <th>Chỉ số</th>
                          <th>Kết quả</th>
                          <th>Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {currentConfirmedFile.metrics.slice(0, 6).map((m, i) => (
                          <tr key={i}>
                            <td className="p-2 font-medium text-ink">{m.name}</td>
                            <td className="p-2 staff-num text-ink">
                              {m.value} {m.unit}
                            </td>
                            <td className="p-2">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                  m.status === 'high' || m.status === 'low'
                                    ? 'bg-rose-50 text-rose-700'
                                    : 'bg-emerald-50 text-emerald-700'
                                }`}
                              >
                                {m.status === 'high' ? 'Cao' : m.status === 'low' ? 'Thấp' : 'Bình thường'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : (
              <div className="staff-empty-state p-4 text-center text-xs text-muted">
                Bệnh nhân chưa có tệp bệnh án nào được xác nhận.
              </div>
            )}

            {historicalFiles.length > 0 && (
              <div className="pt-2 border-t border-line space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted block">
                  Lịch sử bệnh án trước đó ({historicalFiles.length})
                </span>
                {historicalFiles.slice(0, 3).map(hf => (
                  <div key={hf.id} className="flex items-center justify-between text-[11px] px-2.5 py-1.5 rounded-xl bg-white border border-line">
                    <span className="truncate text-ink font-medium">{hf.name}</span>
                    <span className="staff-num text-muted shrink-0 ml-2">{hf.date}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Evidence Basis Accordion */}
          <ClinicalBasisAccordion evidence={dynamicEvidence} />

          {/* Live Anatomical Telemetry Card (wraps frozen Anatomy3DVisualizer) */}
          <div className="staff-surface p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm text-ink">Bản đồ Giải phẫu Bệnh nhân</h3>
              <span className="text-[10px] staff-num text-muted">
                ID: {s.activePatientId || 'N/A'}{activePatient ? ` · ${activePatient.name}` : ''}
              </span>
            </div>
            <Anatomy3DVisualizer alerts={s.activeOrganAlerts} />
          </div>
        </div>

        {/* RIGHT COLUMN (7/12): Pending Meal Plan Review, Hard Constraints & HITL Controls */}
        <div className="lg:col-span-7 space-y-4">
          {pendingPlan ? (
            <Card className="border border-[#0B4F4A]/20">
              <div className="flex flex-wrap items-start justify-between gap-2 pb-3 border-b border-line">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase bg-amber-100 text-amber-900 border border-amber-300">
                      CHỜ BÁC SĨ PHÊ DUYỆT
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        pendingPlan.generation_source === 'AI_LIVE'
                          ? 'bg-sky-50 text-sky-800 border border-sky-200'
                          : 'bg-slate-100 text-slate-700 border border-slate-200'
                      }`}
                    >
                      {pendingPlan.generation_source === 'AI_LIVE'
                        ? `AI Trực tuyến${pendingPlan.ai_model_used ? ` (${pendingPlan.ai_model_used})` : ''}`
                        : 'Quy tắc CDSS'}
                    </span>
                  </div>
                  <h3 className="font-bold text-base text-ink mt-1.5">{pendingPlan.name}</h3>
                  <p className="text-xs text-muted mt-0.5">
                    Bệnh nhân:{' '}
                    <b>{activePatient?.name || 'Bệnh nhân'}</b>
                    {p.dob ? ` (${age(p.dob)} tuổi)` : ''}
                    {cleanAndDeduplicateDiseases(p.conditions).length
                      ? ` · ${cleanAndDeduplicateDiseases(p.conditions).join(', ')}`
                      : ' · Chưa ghi nhận bệnh lý nền'}
                  </p>
                </div>
              </div>

              {pendingPlan.ai_reasoning && (
                <div className="my-3 p-3.5 rounded-2xl bg-[#E0F2FE]/55 border border-[#0284C7]/20 text-sky-950 text-xs space-y-1.5">
                  <b className="block text-sky-900">Lập luận Y khoa của AI CDSS (từ bệnh án & tài liệu hệ thống):</b>
                  <p className="whitespace-pre-line leading-relaxed text-[11px]">{pendingPlan.ai_reasoning}</p>
                  {pendingPlan.evidence_basis && pendingPlan.evidence_basis.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {pendingPlan.evidence_basis.map((ev, i) => (
                        <span key={i} className="px-2 py-0.5 rounded-full bg-white border border-sky-200 text-[10px] font-medium text-sky-900">
                          {ev.guideline_name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {pendingPlan.has_conflict && (
                <div className="my-3 p-3.5 rounded-2xl bg-[#FDF5E6] border border-[#B88746]/35 text-amber-950 text-xs">
                  <b className="flex items-center gap-1.5 text-amber-900 mb-1">
                    <AlertTriangle className="w-4 h-4 text-amber-700" /> Xung đột Lâm sàng Cần Quyết định:
                  </b>
                  {pendingPlan.conflict_details}
                </div>
              )}

              {/* Day 1 Dishes Breakdown with Expert Override */}
              <div className="space-y-3 mt-4">
                <h4 className="font-semibold text-xs text-muted uppercase tracking-wider">
                  Các bữa ăn trong kế hoạch (Bác sĩ có thể đổi món trực tiếp):
                </h4>
                {Object.entries(pendingPlan.days[0] || {}).map(([slot, items]: [string, any]) => (
                  <div key={slot} className="p-3 rounded-2xl bg-[#F7FAFB] border border-line space-y-2">
                    <span className="font-semibold text-xs text-brand block">{slot}</span>
                    <div className="space-y-1.5">
                      {items.map((it: any, idx: number) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-white border border-line text-xs"
                        >
                          <div className="min-w-0">
                            <span className="font-medium text-ink">{it.foodName || it.foodId}</span>
                            <span className="text-muted staff-num ml-2">({it.grams}g)</span>
                            {it.note && <span className="text-[11px] text-brand block mt-0.5">{it.note}</span>}
                          </div>
                          <Btn
                            v="s"
                            className="!py-1 !px-2.5 text-xs inline-flex items-center gap-1 shrink-0"
                            onClick={() =>
                              setSelectedSlotForSwap({
                                dayIdx: 0,
                                slot,
                                itemIdx: idx,
                                foodName: it.foodName || it.foodId
                              })
                            }
                          >
                            <ArrowRightLeft className="w-3.5 h-3.5" /> Thay thế món
                          </Btn>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Expert Hard Nutrient Constraints Form */}
              <div className="mt-5 pt-4 border-t border-line space-y-3">
                <h4 className="font-semibold text-sm text-ink">
                  Thiết lập Ngưỡng Dinh dưỡng Cứng (Hard Constraints):
                </h4>
                <div className="grid sm:grid-cols-3 gap-3">
                  <Field label="Natri tối đa (mg/ngày)">
                    <input
                      className={inp + ' staff-num'}
                      type="number"
                      min={100}
                      max={5000}
                      value={maxSodium}
                      onChange={e => setMaxSodium(Math.max(0, +e.target.value || 0))}
                    />
                  </Field>
                  <Field label="Đạm tối đa (g/ngày)">
                    <input
                      className={inp + ' staff-num'}
                      type="number"
                      min={10}
                      max={300}
                      value={maxProtein}
                      onChange={e => setMaxProtein(Math.max(0, +e.target.value || 0))}
                    />
                  </Field>
                  <Field label="Chỉ số GI tối đa">
                    <input
                      className={inp + ' staff-num'}
                      type="number"
                      min={10}
                      max={100}
                      value={maxGI}
                      onChange={e => setMaxGI(Math.max(0, +e.target.value || 0))}
                    />
                  </Field>
                </div>

                <Field label="Chỉ dẫn lâm sàng & Lý do can thiệp (Bắt buộc theo FDA CDS):">
                  <textarea
                    className={inp}
                    rows={3}
                    value={expertNote}
                    onChange={e => setExpertNote(e.target.value)}
                  />
                </Field>

                {/* HITL Action Buttons */}
                <div className="flex flex-wrap justify-end gap-2.5 pt-2">
                  <Btn
                    v="s"
                    onClick={() => {
                      const out = callMcpTool('export_fhir_nutrition_order', { planId: pendingPlan.id })
                      if (!out.ok) {
                        toast(out.error || 'Không thể xuất thực đơn hiện tại.')
                        return
                      }
                      setExpertFhirPreview(JSON.stringify(out.data, null, 2))
                    }}
                  >
                    Xuất HL7 FHIR R4
                  </Btn>
                  <Btn v="d" className="inline-flex items-center gap-1.5" onClick={handleReject}>
                    <XCircle className="w-4 h-4" /> Từ chối Thực đơn
                  </Btn>
                  <Btn className="inline-flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800" onClick={handleApprove}>
                    <CheckCircle2 className="w-4 h-4" /> Phê duyệt Lâm sàng (EXPERT_APPROVED)
                  </Btn>
                </div>
              </div>
            </Card>
          ) : (
            <div className="staff-surface p-8 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-[#E1F2EF] text-brand flex items-center justify-center mx-auto">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <p className="font-semibold text-ink text-base">Không có thực đơn chờ thẩm định</p>
              <p className="text-muted text-xs max-w-md mx-auto leading-relaxed">
                Hồ sơ bệnh nhân hiện tại không có kế hoạch nào ở trạng thái chờ phê duyệt (PENDING_EXPERT_REVIEW). Hãy yêu cầu tạo hoặc gửi thực đơn mới để đưa vào hàng đợi thẩm định lâm sàng, hoặc kiểm tra Lịch sử Thẩm định.
              </p>
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                <Link
                  to="/lich-su-duyet"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-line bg-white text-xs font-medium text-ink hover:border-brand transition-colors"
                >
                  Xem Lịch sử Thẩm định
                </Link>
                <Link
                  to="/"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand text-white text-xs font-semibold hover:bg-brand-900 transition-colors"
                >
                  Quay lại Tổng quan Bác sĩ
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {expertFhirPreview && (
        <Modal title="HL7 FHIR R4 NutritionOrder (Expert HITL)" onClose={() => setExpertFhirPreview('')}>
          <pre className="p-3 rounded-xl bg-slate-900 text-emerald-300 font-mono text-[11px] max-h-80 overflow-auto">
            {expertFhirPreview}
          </pre>
        </Modal>
      )}

      {/* Override Swap Modal */}
      {selectedSlotForSwap && pendingPlan && (
        <Modal
          title={`Bác sĩ đổi món: ${selectedSlotForSwap.foodName}`}
          onClose={() => { setSelectedSlotForSwap(null); setSwapSearch('') }}
        >
          <div className="space-y-3 text-xs">
            <p className="text-muted">
              Chọn món ăn an toàn hơn để thay thế món hiện tại trong kế hoạch:
            </p>
            <input
              type="text"
              placeholder="Tìm tên món trong kho thực phẩm..."
              value={swapSearch}
              onChange={e => setSwapSearch(e.target.value)}
              className={inp}
            />
            <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
              {s.foods
                .filter(f => !swapSearch.trim() || f.name.toLowerCase().includes(swapSearch.toLowerCase()) || f.category.toLowerCase().includes(swapSearch.toLowerCase()))
                .map(f => (
                  <div
                    key={f.id}
                    onClick={() => {
                      if (!pendingPlan) return
                      const wasApproved = pendingPlan.status === 'EXPERT_APPROVED'
                      const err = swapDishInPlan(pendingPlan.id, selectedSlotForSwap.dayIdx, selectedSlotForSwap.slot, selectedSlotForSwap.itemIdx, {
                        foodId: f.id,
                        foodName: f.name,
                        grams: 100
                      })
                      if (err) {
                        toast(err)
                        return
                      }
                      setSelectedSlotForSwap(null)
                      setSwapSearch('')
                      toast(
                        wasApproved
                          ? `Đã thay thế bằng ${f.name}! Thực đơn đã chuyển về chờ phê duyệt lại trước khi áp dụng cho bệnh nhân.`
                          : `Đã thay thế bằng ${f.name}!`
                      )
                    }}
                    className="p-2.5 rounded-xl border border-line hover:border-brand cursor-pointer bg-white transition-all flex items-center justify-between"
                  >
                    <div>
                      <span className="font-semibold text-ink block">{f.name}</span>
                      <span className="text-muted text-[11px] staff-num">
                        {f.kcal} kcal · Natri: {f.sodium}mg · Đạm: {f.protein}g · GI: {f.gi}
                      </span>
                    </div>
                    <Btn v="s" className="!py-1 !px-2 text-xs">Ghi đè</Btn>
                  </div>
                ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ==================== 2. EXPERT DASHBOARD ====================

export function Dashboard() {
  const s = useS()
  const activePatient = s.users.find(u => u.id === s.activePatientId)
  const latestFile = s.profile.files?.[0] || s.ocrHistory?.[0]
  const pendingCount = s.plans.filter(p => p.status === 'PENDING_EXPERT_REVIEW' && isCurrentMealPlan(p, s.profile)).length
  const approvedPatientPlans = s.plans.filter(p => p.status === 'EXPERT_APPROVED').length
  const pendingRulesCount = s.rules.filter(r => r.status === 'Chờ duyệt').length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="staff-kicker">Bàn làm việc Bác sĩ & Chuyên gia</span>
          <h1 className="staff-section-title text-2xl font-semibold mt-0.5">
            Tổng quan Bác sĩ & Chuyên gia CDSS
          </h1>
          <p className="text-xs text-muted mt-0.5">
            Giám sát cảnh báo an toàn sinh học, hướng dẫn điều trị và thẩm định thực đơn theo bệnh nhân đang chọn.
          </p>
        </div>
        <Link
          to="/cdss-hitl"
          className="px-4 py-2 bg-brand text-white rounded-xl text-xs font-semibold hover:bg-brand-900 transition-colors shadow-sm inline-flex items-center gap-1.5"
        >
          <ShieldAlert className="w-4 h-4" /> Mở Cổng Thẩm định CDSS (HITL) →
        </Link>
      </div>

      <PatientContextBar
        patientName={activePatient?.name || 'Bệnh nhân'}
        patientId={s.activePatientId || 'N/A'}
        profile={s.profile}
        latestFile={latestFile}
      />

      {/* Bento KPI Grid with honest data scopes */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="staff-bento-card">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[11px] font-medium text-muted">Thực đơn Chờ duyệt (HITL)</span>
            <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 text-[10px] font-semibold">
              Hồ sơ đang chọn
            </span>
          </div>
          <p className="text-3xl font-bold staff-num text-amber-700">{pendingCount}</p>
        </div>
        <div className="staff-bento-card">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[11px] font-medium text-muted">Thực đơn Đã Phê duyệt</span>
            <span className="px-2 py-0.5 rounded-full bg-[#E1F2EF] text-brand text-[10px] font-semibold">
              Hồ sơ đang chọn
            </span>
          </div>
          <p className="text-3xl font-bold staff-num text-emerald-700">{approvedPatientPlans}</p>
        </div>
        <div className="staff-bento-card">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[11px] font-medium text-muted">Quy tắc AI Chờ duyệt</span>
            <span className="px-2 py-0.5 rounded-full bg-[#E0F2FE] text-[#0284C7] text-[10px] font-semibold">
              Danh mục quy tắc
            </span>
          </div>
          <p className="text-3xl font-bold staff-num text-[#0284C7]">{pendingRulesCount}</p>
        </div>
        <div className="staff-bento-card">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[11px] font-medium text-muted">Tổng Quy tắc An toàn</span>
            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-muted text-[10px] font-semibold">
              Danh mục quy tắc
            </span>
          </div>
          <p className="text-3xl font-bold staff-num text-ink">{s.rules.length}</p>
        </div>
      </div>

      {pendingRulesCount > 0 && (
        <div className="staff-surface border-[#0B4F4A]/25 bg-[#E1F2EF]/40 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white border border-line flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-brand" />
            </div>
            <div>
              <h3 className="font-semibold text-teal-950 text-sm">
                Có {pendingRulesCount} quy tắc dinh dưỡng do AI trích xuất đang chờ thẩm định
              </h3>
              <p className="text-xs text-teal-900/80">
                Đối chiếu cơ sở bằng chứng (Evidence Quote) từ KDIGO, ADA, AHA trước khi phê duyệt áp dụng.
              </p>
            </div>
          </div>
          <Link
            to="/quy-tac"
            className="px-3.5 py-2 bg-brand text-white rounded-xl text-xs font-semibold hover:bg-brand-900 transition-colors shrink-0"
          >
            Thẩm định quy tắc
          </Link>
        </div>
      )}

      {pendingCount > 0 && (
        <div className="staff-surface border-amber-300 bg-amber-50/60 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white border border-amber-200 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-700" />
            </div>
            <div>
              <h3 className="font-semibold text-amber-950 text-sm">
                Có {pendingCount} ca lâm sàng phát hiện xung đột đang đợi xử lý
              </h3>
              <p className="text-xs text-amber-900/80">
                Xung đột giữa hạn chế dinh dưỡng và đơn thuốc điều trị ngoại trú.
              </p>
            </div>
          </div>
          <Link
            to="/cdss-hitl"
            className="px-3.5 py-2 bg-amber-600 text-white rounded-xl text-xs font-semibold hover:bg-amber-700 transition-colors shrink-0"
          >
            Thẩm định ngay
          </Link>
        </div>
      )}
    </div>
  )
}

// ==================== 3. KNOWLEDGE DOCS & CLINICAL RULES ====================

export function Docs() {
  const s = useS()
  return (
    <div className="space-y-4">
      <div>
        <span className="staff-kicker">Kho Tri thức Phác đồ</span>
        <h1 className="staff-section-title text-2xl font-semibold mt-0.5">
          Tài liệu & Phác đồ Dinh dưỡng Lâm sàng
        </h1>
      </div>
      <div className="staff-surface p-1">
        <Crud<Doc>
          title="Tài liệu Hướng dẫn CDSS"
          rows={s.docs}
          fields={[
            { k: 'title', l: 'Tiêu đề' },
            { k: 'condition', l: 'Bệnh lý áp dụng' },
            { k: 'content', l: 'Nội dung phác đồ', t: 'area' },
            { k: 'status', l: 'Trạng thái', o: ['Nháp', 'Chờ duyệt', 'Đã duyệt', 'Từ chối'] },
            { k: 'comment', l: 'Ghi chú chuyên môn' }
          ]}
          cols={r => [r.title, r.condition, <Badge t={r.status} />]}
          validate={r => (!r.title ? 'Vui lòng nhập tiêu đề' : '')}
          onSave={(r, isNew) =>
            set(d => {
              if (isNew) d.docs.push({ ...r, id: uid() })
              else d.docs[d.docs.findIndex(x => x.id === r.id)] = r
              log(d, isNew ? 'Tạo tài liệu' : 'Sửa tài liệu', r.title)
            })
          }
        />
      </div>
    </div>
  )
}

export function Rules() {
  const s = useS()
  const pendingRules = s.rules.filter(r => r.status === 'Chờ duyệt')

  const handleApproveRule = (ruleId: string) => {
    set(d => {
      const r = d.rules.find(x => x.id === ruleId)
      if (!r) return
      r.status = 'Đã duyệt'
      log(d, 'Phê duyệt Quy tắc Lâm sàng', r.title)
    })
    toast('Đã phê duyệt quy tắc dinh dưỡng (Đã duyệt)!')
  }

  const handleRejectRule = (ruleId: string) => {
    set(d => {
      const r = d.rules.find(x => x.id === ruleId)
      if (!r) return
      r.status = 'Từ chối'
      log(d, 'Từ chối Quy tắc Lâm sàng', r.title)
    })
    toast('Đã từ chối quy tắc dinh dưỡng.')
  }

  return (
    <div className="space-y-6">
      <div>
        <span className="staff-kicker">Kiểm soát Phê duyệt & Danh mục Quy tắc</span>
        <h1 className="staff-section-title text-2xl font-semibold mt-0.5">
          Quy tắc Giới hạn Dinh dưỡng & An toàn Dược lý
        </h1>
        <p className="text-xs text-muted mt-0.5">
          Tách biệt luồng thẩm định phê duyệt quy tắc mới (trên) và quản trị chỉnh sửa danh mục (dưới).
        </p>
      </div>

      {/* Block A: Approval Queue */}
      {pendingRules.length > 0 && (
        <div className="staff-surface p-5 space-y-4">
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-line">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              <h3 className="font-semibold text-sm text-ink">
                Hàng đợi Phê duyệt Quy tắc ({pendingRules.length}):
              </h3>
            </div>
            <span className="text-[11px] text-muted">Cần bác sĩ xác nhận trước khi áp dụng cho RAG</span>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {pendingRules.map(r => (
              <div key={r.id} className="p-4 rounded-2xl border border-amber-200 bg-amber-50/40 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono bg-amber-100 text-amber-900 border border-amber-300">
                    CẦN BÁC SĨ DUYỆT
                  </span>
                  <span className="text-[11px] font-semibold text-brand">{r.condition}</span>
                </div>

                <h4 className="font-bold text-sm text-ink">{r.title}</h4>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-white border border-line">
                    <span className="text-muted block text-[10px]">Natri tối đa</span>
                    <b className="text-ink staff-num">{r.maxSodium} mg/ngày</b>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white border border-line">
                    <span className="text-muted block text-[10px]">Chỉ số GI tối đa</span>
                    <b className="text-ink staff-num">{r.maxGI}</b>
                  </div>
                </div>

                {r.avoidCategories && (
                  <div className="p-2.5 rounded-xl bg-white border border-line text-xs">
                    <span className="text-muted block text-[10px]">Nhóm thực phẩm cấm kỵ / cảnh báo:</span>
                    <span className="text-rose-700 font-medium">{r.avoidCategories}</span>
                  </div>
                )}

                {r.evidence_quote && (
                  <div className="p-2.5 rounded-xl bg-white border border-amber-200 text-xs text-muted italic">
                    <Quote className="w-3.5 h-3.5 text-amber-700 inline mr-1" />
                    "{r.evidence_quote}"
                    <span className="block not-italic font-semibold text-[10px] text-teal-800 mt-1">
                      Nguồn: {r.reference}
                    </span>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2 border-t border-line/60">
                  <Btn v="s" className="!py-1.5 !px-3 text-xs text-rose-700 border-rose-200 hover:bg-rose-50" onClick={() => handleRejectRule(r.id)}>
                    Từ chối
                  </Btn>
                  <Btn className="!py-1.5 !px-3 text-xs bg-emerald-700 hover:bg-emerald-800" onClick={() => handleApproveRule(r.id)}>
                    Phê duyệt (Đã duyệt)
                  </Btn>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Block B: Catalog Edit & Maintenance */}
      <div className="staff-surface p-1">
        <Crud<Rule>
          title="Chỉnh sửa & Quản lý Toàn bộ Danh mục Quy tắc"
          rows={s.rules}
          fields={[
            { k: 'title', l: 'Tên quy tắc' },
            { k: 'condition', l: 'Bệnh lý' },
            { k: 'maxSodium', l: 'Natri tối đa (mg)', t: 'number' },
            { k: 'maxGI', l: 'GI tối đa', t: 'number' },
            { k: 'avoidCategories', l: 'Nhóm cấm kỵ / Cảnh báo' },
            { k: 'reference', l: 'Tài liệu dẫn chứng (Evidence basis)' },
            { k: 'evidence_quote', l: 'Trích dẫn nguyên văn bằng chứng', t: 'area' },
            { k: 'status', l: 'Trạng thái', o: ['Nháp', 'Chờ duyệt', 'Đã duyệt', 'Từ chối'] }
          ]}
          cols={r => [r.title, r.condition, `${r.maxSodium} mg`, <Badge t={r.status} />]}
          validate={r => (!r.title ? 'Vui lòng nhập tên quy tắc' : '')}
          onSave={(r, isNew) =>
            set(d => {
              if (isNew) d.rules.push({ ...r, id: uid() })
              else d.rules[d.rules.findIndex(x => x.id === r.id)] = r
              log(d, isNew ? 'Tạo quy tắc' : 'Sửa quy tắc', r.title)
            })
          }
          extra={r =>
            r.status === 'Chờ duyệt' ? (
              <Btn
                v="s"
                className="mr-1 text-xs !bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100"
                onClick={() => handleApproveRule(r.id)}
              >
                Duyệt
              </Btn>
            ) : null
          }
        />
      </div>
    </div>
  )
}

export function Reviews() {
  const s = useS()
  const activePatient = s.users.find(u => u.id === s.activePatientId)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="staff-kicker">Lịch sử Thẩm định (Hồ sơ đang chọn)</span>
          <h1 className="staff-section-title text-2xl font-semibold mt-0.5">
            Lịch sử Phê duyệt & Kiểm toán Lâm sàng
          </h1>
        </div>
        <span className="staff-scope-chip">
          Bệnh nhân: {activePatient?.name || 'N/A'} ({s.activePatientId || 'N/A'})
        </span>
      </div>

      <div className="staff-table-wrap">
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead>
              <tr>
                <th>Kế hoạch thực đơn</th>
                <th>Người thẩm định</th>
                <th>Thời gian</th>
                <th>Ý kiến chuyên môn</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {s.plans.map(p => (
                <tr key={p.id}>
                  <td className="p-3 font-semibold text-ink">{p.name}</td>
                  <td className="p-3 text-muted">{p.expert_name || 'Hệ thống'}</td>
                  <td className="p-3 staff-num text-muted">
                    {p.reviewed_at ? new Date(p.reviewed_at).toLocaleString('vi-VN') : 'Chưa duyệt'}
                  </td>
                  <td className="p-3 text-ink max-w-xs">{p.expert_notes || '—'}</td>
                  <td className="p-3"><Badge t={p.status} /></td>
                </tr>
              ))}
              {s.plans.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-muted">
                    Chưa có kế hoạch nào trong hồ sơ bệnh nhân đang chọn.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
