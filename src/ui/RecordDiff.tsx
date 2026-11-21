import React from 'react'
import type { MedicalRecordExtraction, Profile } from '../types'
import { deriveClinicalCeilings } from '../utils/nutrition'
import {
  cleanAndDeduplicateDiseases,
  cleanAndDeduplicateMedications,
  formatMedicationDisplay,
  normalizeMedicationString
} from '../utils/pdfExtractor'

export interface RecordDiffSummary {
  addedConditions: string[]
  addedMedications: string[]
  addedAllergies: string[]
  newMetricsCount: number
  previousLimits: ReturnType<typeof deriveClinicalCeilings>
  nextLimits: ReturnType<typeof deriveClinicalCeilings>
}

export function computeRecordDiff(
  profile: Profile,
  draft: MedicalRecordExtraction
): RecordDiffSummary {
  const cleanedExistingConds = cleanAndDeduplicateDiseases(profile.conditions || [])
  const existingConds = new Set(cleanedExistingConds.map(c => c.toLowerCase()))
  const cleanedDraftConds = cleanAndDeduplicateDiseases(draft.diseases || [])
  const addedConditions = cleanedDraftConds.filter(
    d => !existingConds.has(d.toLowerCase())
  )

  const cleanedExistingMeds = cleanAndDeduplicateMedications(profile.medications || [])
  const existingMeds = new Set(cleanedExistingMeds.map(m => m.toLowerCase()))
  const addedMedications = cleanAndDeduplicateMedications(
    (draft.medications || []).map(m => formatMedicationDisplay(m.name, m.activeIngredient))
  ).filter(label => !existingMeds.has(normalizeMedicationString(label).toLowerCase()))

  const existingAllergies = new Set(
    (profile.allergies || '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
  )
  const addedAllergies = (draft.allergies || []).filter(
    a => a.trim() && !existingAllergies.has(a.trim().toLowerCase())
  )

  const safeWeightProfile = profile.weight > 0 ? profile : { ...profile, weight: 60 }
  const previousLimits = deriveClinicalCeilings(safeWeightProfile, profile.files?.[0])
  const mergedProfile: Profile = {
    ...safeWeightProfile,
    conditions: cleanAndDeduplicateDiseases([...cleanedExistingConds, ...cleanedDraftConds]),
    medications: cleanAndDeduplicateMedications([...cleanedExistingMeds, ...addedMedications])
  }
  const nextLimits = deriveClinicalCeilings(mergedProfile, draft)

  return {
    addedConditions,
    addedMedications,
    addedAllergies,
    newMetricsCount: (draft.metrics || []).length,
    previousLimits,
    nextLimits
  }
}

export function RecordDiff({
  profile,
  draft
}: {
  profile: Profile
  draft: MedicalRecordExtraction
}) {
  const diff = computeRecordDiff(profile, draft)

  return (
    <div className="rounded-[10px] border border-rule bg-surface p-3.5 text-xs space-y-2.5">
      <div className="flex items-center justify-between border-b border-rule pb-2">
        <span className="font-semibold text-ink">Đối chiếu thay đổi trước khi xác nhận</span>
        <span className="text-[11px] text-muted tabular-nums">
          +{diff.newMetricsCount} chỉ số xét nghiệm
        </span>
      </div>

      <div className="grid sm:grid-cols-2 gap-2.5">
        <div className="p-2.5 rounded-[8px] bg-paper border border-rule">
          <span className="text-muted block mb-1 font-medium">Bệnh lý bổ sung vào hồ sơ</span>
          {diff.addedConditions.length > 0 ? (
            <ul className="space-y-0.5 text-ink font-medium">
              {diff.addedConditions.map(c => (
                <li key={c}>+ {c}</li>
              ))}
            </ul>
          ) : (
            <span className="text-muted">Không phát sinh bệnh lý mới ngoài hồ sơ hiện tại</span>
          )}
        </div>

        <div className="p-2.5 rounded-[8px] bg-paper border border-rule">
          <span className="text-muted block mb-1 font-medium">Thuốc & dị ứng mới ghi nhận</span>
          {diff.addedMedications.length > 0 || diff.addedAllergies.length > 0 ? (
            <ul className="space-y-0.5 text-ink font-medium">
              {diff.addedMedications.map(m => (
                <li key={m}>+ Thuốc: {m}</li>
              ))}
              {diff.addedAllergies.map(a => (
                <li key={a} className="text-rose-ink">
                  + Dị ứng: {a}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-muted">Không có thuốc hoặc dị ứng mới</span>
          )}
        </div>
      </div>

      <div className="p-2.5 rounded-[8px] bg-brand-50/70 border border-brand/20 flex flex-wrap items-center justify-between gap-2 tabular-nums">
        <span className="font-medium text-ink">Ngưỡng dinh dưỡng dự kiến sau đồng bộ:</span>
        <span className="text-brand-900 font-semibold">
          Natri ≤ {diff.nextLimits.max_sodium_mg} mg · Đạm ≤ {diff.nextLimits.max_protein_g} g · GI ≤{' '}
          {diff.nextLimits.max_gi}
        </span>
      </div>
    </div>
  )
}
