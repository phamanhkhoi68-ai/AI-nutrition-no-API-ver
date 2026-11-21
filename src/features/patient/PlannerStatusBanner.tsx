import React, { useState } from 'react'
import { AlertTriangle, Zap } from 'lucide-react'
import { Card, PipelineStatus, ProvenanceChip } from '../../components/ui'
import { summarizeGateIssues } from '../../utils/nutrition'
import type { Plan } from '../../types'

export function PlannerStatusBanner({
  generating,
  daysCount,
  mealsCount,
  activeDayIdx,
  gateIssues,
  currentPlan,
  hasUnverifiedFoodNames
}: {
  generating: boolean
  daysCount: 1 | 7
  mealsCount: number
  activeDayIdx: number
  gateIssues: string[]
  currentPlan?: Plan
  hasUnverifiedFoodNames: boolean
}) {
  const [showGateDetails, setShowGateDetails] = useState(false)

  return (
    <>
      {generating && (
        <PipelineStatus
          title={`Đang lập thực đơn ${daysCount} ngày (${mealsCount} bữa/ngày)`}
          steps={[
            { key: 'ceilings', label: 'Tính trần dinh dưỡng', status: 'done' },
            { key: 'rag', label: 'Truy xuất tài liệu duyệt', status: 'done' },
            { key: 'gen', label: 'Khởi tạo thực đơn', status: 'active' },
            { key: 'verify', label: 'Kiểm tra an toàn', status: 'pending' }
          ]}
        />
      )}

      {gateIssues.length > 0 && (
        <div className="p-3 rounded-[10px] bg-amber-50 border border-turmeric/50 text-amber-ink text-xs space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 font-medium">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                <b>Cổng kiểm soát phạm vi CDSS:</b> {summarizeGateIssues(gateIssues)}
              </span>
            </span>
            <button
              type="button"
              aria-expanded={showGateDetails}
              onClick={() => setShowGateDetails(v => !v)}
              className="text-xs font-semibold text-amber-ink hover:underline shrink-0 cursor-pointer"
            >
              {showGateDetails ? 'Thu gọn' : 'Xem chi tiết'}
            </button>
          </div>
          {showGateDetails && (
            <ul className="list-disc ml-5 space-y-0.5 pt-2 border-t border-turmeric/30">
              {gateIssues.map((g, idx) => (
                <li key={idx}>{g}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {currentPlan && (
        <Card
          className={`border-2 ${
            currentPlan.status === 'EXPERT_APPROVED'
              ? 'border-brand bg-sage-50/40'
              : currentPlan.status === 'REJECTED'
              ? 'border-rose-ink bg-rose-50/40'
              : 'border-turmeric bg-amber-50/40'
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`px-2.5 py-0.5 rounded-[6px] text-xs font-bold uppercase ${
                    currentPlan.status === 'EXPERT_APPROVED'
                      ? 'bg-brand text-white'
                      : currentPlan.status === 'REJECTED'
                      ? 'bg-rose-ink text-white'
                      : 'bg-turmeric text-ink'
                  }`}
                >
                  {hasUnverifiedFoodNames
                    ? 'CẦN ĐỐI CHIẾU LẠI MÓN ĂN'
                    : currentPlan.status === 'EXPERT_APPROVED'
                    ? '✓ ĐÃ ĐƯỢC CHUYÊN GIA / BÁC SĨ PHÊ DUYỆT'
                    : currentPlan.status === 'REJECTED'
                    ? '✕ ĐÃ BỊ TỪ CHỐI BỞI CHUYÊN GIA'
                    : 'ĐANG ĐỢI BÁC SĨ THẨM ĐỊNH LÂM SÀNG (HITL)'}
                </span>
                <ProvenanceChip
                  source={currentPlan.generation_source}
                  profileVersion={currentPlan.version || 1}
                  isSample
                />
                <span className="text-xs text-muted font-mono">Mã: {currentPlan.id}</span>
              </div>
              <h3 className="font-bold text-base text-ink">{currentPlan.name}</h3>
              {currentPlan.generation_note && <p className="text-[11px] text-muted">{currentPlan.generation_note}</p>}
              {currentPlan.has_conflict && (
                <p className="text-xs text-amber-ink">
                  <b>Lý do chờ duyệt:</b> {currentPlan.conflict_details}
                </p>
              )}
              {currentPlan.expert_notes && (
                <p className="text-xs text-brand-900">
                  <b>Ý kiến Chuyên gia:</b> {currentPlan.expert_notes}
                </p>
              )}
            </div>

            {currentPlan.hard_limits && (
              <div className="p-3 rounded-[8px] bg-surface border border-rule text-xs font-mono space-y-1 max-w-sm tabular-nums">
                <div className="font-bold text-brand-900 text-[11px] uppercase flex items-center gap-1.5 pb-1 border-b border-rule">
                  <Zap size={13} className="text-brand" />
                  <span>
                    {currentPlan.status === 'EXPERT_APPROVED'
                      ? 'GIỚI HẠN ĐÃ ĐƯỢC CHUYÊN GIA DUYỆT'
                      : 'GIỚI HẠN THAM CHIẾU CỦA BẢN ĐỀ XUẤT'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] pt-1">
                  {currentPlan.hard_limits.max_sodium_mg && (
                    <div className="flex justify-between gap-2">
                      <span className="text-muted">Natri max:</span>
                      <span className="font-bold text-ink">{currentPlan.hard_limits.max_sodium_mg} mg</span>
                    </div>
                  )}
                  {currentPlan.hard_limits.max_protein_g && (
                    <div className="flex justify-between gap-2">
                      <span className="text-muted">Đạm max:</span>
                      <span className="font-bold text-ink">{currentPlan.hard_limits.max_protein_g} g</span>
                    </div>
                  )}
                  {currentPlan.hard_limits.max_gi && (
                    <div className="flex justify-between gap-2">
                      <span className="text-muted">GI tối đa:</span>
                      <span className="font-bold text-ink">≤ {currentPlan.hard_limits.max_gi}</span>
                    </div>
                  )}
                  {currentPlan.hard_limits.min_water_ml && (
                    <div className="flex justify-between gap-2 text-brand">
                      <span className="text-muted">Nước min:</span>
                      <span className="font-bold">≥ {currentPlan.hard_limits.min_water_ml} ml</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-surface rounded-[10px] border border-rule">
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-[6px] text-xs font-semibold uppercase bg-brand-50 text-brand border border-brand/20">
            {daysCount === 7 ? 'Chế độ 7 Ngày' : 'Chế độ 1 Ngày'}
          </span>
          <span className="text-xs text-muted">
            {daysCount === 7
              ? 'Thực đơn 7 ngày đa dạng món, đạt ngưỡng an toàn bệnh lý và không lặp lại giữa các ngày.'
              : 'Dinh dưỡng điều trị trong ngày, tối ưu theo chỉ số bệnh án mới nhất.'}
          </span>
        </div>
        <div className="text-xs font-semibold text-brand tabular-nums">
          {daysCount === 7 ? `Đang xem: Ngày ${activeDayIdx + 1} / 7` : 'Thực đơn 1 Ngày duy nhất'}
        </div>
      </div>
    </>
  )
}
