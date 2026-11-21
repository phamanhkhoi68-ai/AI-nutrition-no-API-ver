import React from 'react'
import { FileCheck, AlertTriangle } from 'lucide-react'
import { Btn, Card, RecordDiff } from '../../components/ui'
import { cleanAndDeduplicateDiseases, formatMedicationDisplay } from '../../utils/pdfExtractor'
import type { MedicalRecordExtraction, Profile } from '../../types'

export function ProfilePendingCard({
  profile,
  pendingDraft,
  onCancel,
  onConfirm
}: {
  profile: Profile
  pendingDraft: MedicalRecordExtraction
  onCancel: () => void
  onConfirm: (draft: MedicalRecordExtraction) => void
}) {
  return (
    <Card className="border-2 border-brand !bg-white !backdrop-blur-none space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-brand/20">
        <div className="flex items-center gap-2">
          <FileCheck className="w-5 h-5 text-brand" />
          <h3 className="font-bold text-ink text-base">Kết quả Bóc tách: {pendingDraft.name}</h3>
        </div>
        <span className="text-xs font-mono bg-amber-50 text-amber-ink border border-turmeric/40 px-2.5 py-0.5 rounded-[6px]">
          CẦN XÁC NHẬN
        </span>
      </div>

      <div className="grid md:grid-cols-2 gap-4 text-xs">
        <div>
          <h4 className="font-semibold text-ink mb-1.5">Chỉ số Sinh hóa Máu bóc tách:</h4>
          <div className="space-y-1.5">
            {pendingDraft.metrics.map((m, i) => (
              <div key={i} className="flex justify-between p-2 rounded-[8px] bg-surface border border-rule tabular-nums">
                <span className="font-medium text-ink">{m.name}:</span>
                <span
                  className={`font-semibold ${
                    m.status === 'high' ? 'text-rose-ink' : m.status === 'low' ? 'text-amber-ink' : 'text-brand'
                  }`}
                >
                  {m.value} {m.unit} ({m.status === 'high' ? 'Cao' : m.status === 'low' ? 'Thấp' : 'Bình thường'})
                </span>
              </div>
            ))}
            {pendingDraft.metrics.length === 0 && (
              <p className="text-muted">Chưa ghi nhận chỉ số xét nghiệm cụ thể.</p>
            )}
          </div>
        </div>

        <div>
          <h4 className="font-semibold text-ink mb-1.5">Bệnh lý & Thuốc kê đơn phát hiện:</h4>
          <div className="space-y-2">
            <div className="p-2.5 rounded-[8px] bg-surface border border-rule">
              <span className="text-muted block mb-1">Chẩn đoán bệnh lý:</span>
              <div className="flex flex-wrap gap-1">
                {cleanAndDeduplicateDiseases(pendingDraft.diseases).map((d, i) => (
                  <span key={i} className="px-2 py-0.5 rounded-[6px] bg-brand-50 text-brand font-medium">
                    {d}
                  </span>
                ))}
                {cleanAndDeduplicateDiseases(pendingDraft.diseases).length === 0 && <span className="text-muted">Không có</span>}
              </div>
            </div>
            <div className="p-2.5 rounded-[8px] bg-surface border border-rule">
              <span className="text-muted block mb-1">Đơn thuốc:</span>
              <div className="space-y-1">
                {pendingDraft.medications.map((m, i) => (
                  <div key={i} className="text-ink">
                    <b>{formatMedicationDisplay(m.name, m.activeIngredient)}</b>
                    {m.dosage ? ` - ${m.dosage}` : ''}
                    {m.ddiAlert && <span className="text-rose-ink block text-[11px]">{m.ddiAlert}</span>}
                  </div>
                ))}
                {pendingDraft.medications.length === 0 && <span className="text-muted">Không có</span>}
              </div>
            </div>
          </div>
        </div>
      </div>

      <RecordDiff profile={profile} draft={pendingDraft} />

      {pendingDraft.has_conflict && (
        <div className="p-3 rounded-[8px] bg-amber-50 border border-turmeric/50 text-amber-ink text-xs">
          <b className="flex items-center gap-1">
            <AlertTriangle className="w-4 h-4" /> Phát hiện xung đột đa bệnh lý:
          </b>
          <p className="mt-1">{pendingDraft.conflict_reason}</p>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Btn v="s" onClick={onCancel}>
          Hủy bỏ
        </Btn>
        <Btn onClick={() => onConfirm(pendingDraft)}>✓ Xác nhận & Đồng bộ vào Hồ sơ</Btn>
      </div>
    </Card>
  )
}
