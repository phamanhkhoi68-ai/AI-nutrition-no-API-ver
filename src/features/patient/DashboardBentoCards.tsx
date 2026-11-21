import React from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { Card, NutrientRule, ProvenanceChip } from '../../components/ui'
import { MultiRing, RING_COLORS } from '../../components/NutritionCharts'
import { cleanAndDeduplicateMedications } from '../../utils/pdfExtractor'
import type { Plan, Profile } from '../../types'

const fmt = (n: number) => Math.round(n * 10) / 10

export function DashboardBentoCards({
  profile,
  todayNutrients,
  targetKcal,
  maxProteinTarget,
  maxSodiumTarget,
  lastPlan
}: {
  profile: Profile
  todayNutrients: { kcal: number; protein: number; sodium: number }
  targetKcal?: number
  maxProteinTarget?: number
  maxSodiumTarget?: number
  lastPlan?: Plan
}) {
  const displayMedications = cleanAndDeduplicateMedications(profile.medications)

  return (
    <div className="grid md:grid-cols-3 gap-5">
      <Card className="flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-base text-ink">Dinh dưỡng hôm nay</h3>
            <Link to="/nhat-ky-an" className="text-xs text-brand hover:underline">
              Xem chi tiết →
            </Link>
          </div>
          {targetKcal !== undefined && (
            <div className="flex items-center justify-center py-2">
              <MultiRing
                rings={[
                  {
                    label: 'Năng lượng',
                    value: todayNutrients.kcal,
                    target: targetKcal,
                    unit: 'kcal',
                    from: RING_COLORS.kcal.from,
                    to: RING_COLORS.kcal.to
                  },
                  ...(maxProteinTarget
                    ? [
                        {
                          label: 'Đạm',
                          value: todayNutrients.protein,
                          target: maxProteinTarget,
                          unit: 'g',
                          from: RING_COLORS.protein.from,
                          to: RING_COLORS.protein.to
                        }
                      ]
                    : []),
                  ...(maxSodiumTarget
                    ? [
                        {
                          label: 'Natri',
                          value: todayNutrients.sodium,
                          target: maxSodiumTarget,
                          unit: 'mg',
                          from: '#2F6B4F',
                          to: '#8FB99E'
                        }
                      ]
                    : [])
                ]}
                centerValue={`${Math.round(todayNutrients.kcal)}`}
                centerCaption="kcal nạp vào"
              />
            </div>
          )}
          <div className="grid grid-cols-3 gap-2 text-center text-xs mt-3 pt-3 border-t border-rule tabular-nums">
            <div>
              <span className="text-muted block">Năng lượng</span>
              <b className="text-sm font-semibold">{Math.round(todayNutrients.kcal)}</b>
              <span className="text-[10px] text-muted">
                {targetKcal === undefined ? ' kcal' : ` / ${targetKcal} kcal`}
              </span>
            </div>
            <div>
              <span className="text-muted block">Đạm</span>
              <b className="text-sm font-semibold">{fmt(todayNutrients.protein)}</b>
              <span className="text-[10px] text-muted">
                {maxProteinTarget === undefined ? ' g' : ` / ${maxProteinTarget} g`}
              </span>
            </div>
            <div>
              <span className="text-muted block">Natri</span>
              <b
                className={`text-sm font-semibold ${
                  maxSodiumTarget !== undefined && todayNutrients.sodium > maxSodiumTarget ? 'text-rose-ink' : ''
                }`}
              >
                {Math.round(todayNutrients.sodium)}
              </b>
              <span className="text-[10px] text-muted">
                {maxSodiumTarget === undefined ? ' mg' : ` / ${maxSodiumTarget.toLocaleString('en-US')} mg`}
              </span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-rule space-y-2.5">
            {targetKcal !== undefined && (
              <NutrientRule label="Năng lượng" value={todayNutrients.kcal} limit={targetKcal} unit="kcal" kind="target" />
            )}
            {maxSodiumTarget !== undefined && (
              <NutrientRule label="Natri" value={todayNutrients.sodium} limit={maxSodiumTarget} unit="mg" kind="max" />
            )}
          </div>
        </div>
      </Card>

      <Card className="flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="font-semibold text-base text-ink">Thực đơn Điều trị hiện tại</h3>
            <span
              className={`px-2.5 py-0.5 rounded-[6px] text-xs font-semibold ${
                lastPlan?.status === 'EXPERT_APPROVED'
                  ? 'bg-sage-50 text-brand border border-brand/25'
                  : lastPlan?.status === 'REJECTED'
                  ? 'bg-rose-50 text-rose-ink border border-rose-ink/25'
                  : 'bg-amber-50 text-amber-ink border border-turmeric/40'
              }`}
            >
              {lastPlan?.status === 'EXPERT_APPROVED'
                ? 'BÁC SĨ ĐÃ DUYỆT'
                : lastPlan?.status === 'REJECTED'
                ? 'TỪ CHỐI'
                : 'CHỜ BÁC SĨ DUYỆT (HITL)'}
            </span>
          </div>

          {lastPlan ? (
            <div className="space-y-2.5 text-xs text-muted mt-3">
              <p className="font-medium text-ink text-sm">{lastPlan.name}</p>
              <ProvenanceChip
                source={lastPlan.generation_source}
                profileVersion={lastPlan.version || 1}
                isSample
              />
              {lastPlan.has_conflict && (
                <div className="p-2.5 rounded-[8px] bg-amber-50 border border-turmeric/40 text-amber-ink text-xs">
                  <span className="font-bold flex items-center gap-1 mb-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Cảnh báo xung đột đa bệnh lý:
                  </span>
                  {lastPlan.conflict_details || 'Phát hiện tương tác giữa thuốc và hạn chế dinh dưỡng.'}
                </div>
              )}
              {lastPlan.expert_notes && (
                <div className="p-2.5 rounded-[8px] bg-sage-50 border border-brand/25 text-brand-900 text-xs">
                  <span className="font-bold block mb-0.5">Ghi chú từ {lastPlan.expert_name || 'Bác sĩ'}:</span>
                  {lastPlan.expert_notes}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted py-4">Chưa có thực đơn nào được khởi tạo.</p>
          )}
        </div>

        <Link
          to="/thuc-don"
          className="mt-4 block text-center py-2.5 px-4 rounded-[8px] bg-brand text-white text-xs font-semibold hover:bg-brand-900 transition-colors"
        >
          Quản lý & Đổi món thực đơn →
        </Link>
      </Card>

      <Card className="flex flex-col justify-between">
        <div>
          <h3 className="font-semibold text-base text-ink mb-2">Đơn thuốc & Cảnh báo Dược lý</h3>
          <div className="space-y-2 mt-2">
            {displayMedications.map((m, i) => (
              <div key={i} className="p-2.5 rounded-[8px] bg-paper border border-rule text-xs">
                <div className="font-medium text-ink flex items-center justify-between">
                  <span>{m}</span>
                  <span className="text-[10px] text-muted">Hoạt tính</span>
                </div>
                {/warfarin|coumadin/i.test(m) && (
                  <span className="text-[11px] text-rose-ink font-medium block mt-1">
                    Tránh biến thiên Vitamin K (rau chân vịt, cải xoăn)
                  </span>
                )}
                {/lisinopril/i.test(m) && (
                  <span className="text-[11px] text-amber-ink font-medium block mt-1">
                    Giữ Kali máu - Hạn chế muối thay thế KCl
                  </span>
                )}
                {/atorvastatin/i.test(m) && (
                  <span className="text-[11px] text-amber-ink font-medium block mt-1">
                    Tránh bưởi chùm (Grapefruit) do ức chế CYP3A4
                  </span>
                )}
              </div>
            ))}
            {displayMedications.length === 0 && (
              <p className="text-xs text-muted">Chưa ghi nhận thuốc kê đơn.</p>
            )}
          </div>
        </div>

        <Link to="/ho-so" className="mt-4 text-xs text-brand font-medium hover:underline text-center">
          Cập nhật đơn thuốc trong Hồ sơ →
        </Link>
      </Card>
    </div>
  )
}
