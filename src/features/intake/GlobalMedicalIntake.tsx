import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Paperclip, Loader2, X, ClipboardPaste, UploadCloud } from 'lucide-react'
import { useS, get, me, setPendingRecordDraft, confirmMedicalRecord, appendChatMessage } from '../../services/store'
import { ingestMedicalRecordFile, ingestMedicalRecordText, ACCEPTED_RECORD_TYPES, isSupportedRecordFile } from '../../services/recordIntake'
import { triggerLiveAiMenuUpgrade } from '../../services/workflowAgent'
import { nutritionProfileIssue } from '../../utils/nutrition'
import { cleanAndDeduplicateDiseases, formatMedicationDisplay } from '../../utils/pdfExtractor'
import { Btn, toast } from '../../components/ui'
import { ProfilePendingCard } from '../patient/ProfilePendingCard'

/**
 * Nạp bệnh án từ BẤT KỲ màn hình nào của bệnh nhân:
 *  - nút nổi "Nạp bệnh án" (chọn tệp / ảnh / dán văn bản)
 *  - kéo-thả tệp vào bất cứ đâu trong ứng dụng
 *  - dán (Ctrl+V) ảnh chụp bệnh án từ clipboard
 * Kết quả bóc tách luôn qua bước xác nhận của người dùng trước khi đồng bộ toàn hệ thống.
 */
export default function GlobalMedicalIntake() {
  const s = useS()
  const user = me(s)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [dragging, setDragging] = useState(false)
  const enabled = user?.role === 'patient'

  const runFile = useCallback(async (file: File) => {
    setBusy(true); setError(''); setMenuOpen(false)
    try {
      await ingestMedicalRecordFile(file)
      toast(`Đã bóc tách "${file.name}". Hãy rà soát và bấm Xác nhận để đồng bộ toàn hệ thống.`)
    } catch (e: any) {
      setPendingRecordDraft(null)
      setError(e?.message || 'Không đọc được tệp bệnh án.')
    } finally { setBusy(false) }
  }, [])

  const runText = async () => {
    setBusy(true); setError('')
    try {
      await ingestMedicalRecordText(pasteText)
      setPasteOpen(false); setPasteText('')
      toast('Đã bóc tách nội dung bệnh án. Hãy rà soát và bấm Xác nhận.')
    } catch (e: any) {
      setError(e?.message || 'Không đọc được nội dung bệnh án.')
    } finally { setBusy(false) }
  }

  useEffect(() => {
    if (!enabled) return
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDragging(true) }
    }
    const onDragLeave = (e: DragEvent) => { if (!e.relatedTarget) setDragging(false) }
    const onDrop = (e: DragEvent) => {
      const f = e.dataTransfer?.files?.[0]
      setDragging(false)
      if (!f) return
      e.preventDefault()
      if (!isSupportedRecordFile(f)) { setError('Định dạng chưa được hỗ trợ (PDF, Word, TXT, ảnh).'); return }
      void runFile(f)
    }
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const f = Array.from(e.clipboardData?.files || []).find(isSupportedRecordFile)
      if (f) { e.preventDefault(); void runFile(f) }
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('paste', onPaste)
    }
  }, [enabled, runFile])

  if (!enabled) return null
  const draft = s.pendingRecordDraft

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED_RECORD_TYPES}
        className="hidden"
        data-testid="global-record-input"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void runFile(f) }}
      />

      {dragging && (
        <div className="fixed inset-0 z-[90] bg-brand/10 border-4 border-dashed border-brand flex items-center justify-center pointer-events-none">
          <div className="bg-surface rounded-[12px] px-6 py-4 shadow-lg flex items-center gap-3 text-brand font-semibold">
            <UploadCloud className="w-6 h-6" /> Thả tệp bệnh án vào đây để AI bóc tách
          </div>
        </div>
      )}

      <div className={`fixed right-4 bottom-16 z-[80] flex-col items-end gap-2 ${draft || pasteOpen ? 'hidden' : 'flex'}`}>
        {menuOpen && !busy && (
          <div className="bg-surface border border-rule rounded-[10px] shadow-lg p-1.5 w-56 text-xs">
            <button className="w-full text-left px-3 py-2 rounded-[8px] hover:bg-brand-50 flex items-center gap-2" onClick={() => fileRef.current?.click()}>
              <Paperclip className="w-4 h-4 text-brand" /> Chọn tệp / ảnh bệnh án
            </button>
            <button className="w-full text-left px-3 py-2 rounded-[8px] hover:bg-brand-50 flex items-center gap-2" onClick={() => { setMenuOpen(false); setPasteOpen(true) }}>
              <ClipboardPaste className="w-4 h-4 text-brand" /> Dán nội dung văn bản
            </button>
            <p className="px-3 py-1.5 text-[10px] text-muted">Hoặc kéo-thả / Ctrl+V ảnh vào bất kỳ trang nào.</p>
          </div>
        )}
        <button
          type="button"
          aria-label="Nạp bệnh án"
          onClick={() => setMenuOpen(v => !v)}
          disabled={busy}
          className="flex items-center gap-2 rounded-full bg-brand text-white px-4 py-2.5 text-xs font-semibold shadow-lg hover:opacity-90 disabled:opacity-70"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
          {busy ? 'AI đang đọc bệnh án…' : 'Nạp bệnh án'}
        </button>
      </div>

      {error && (
        <div className="fixed right-4 bottom-32 z-[85] max-w-sm bg-rose-50 border border-rose-200 text-rose-ink text-xs rounded-[10px] p-3 shadow-lg flex gap-2">
          <span className="flex-1">{error}</span>
          <button aria-label="Đóng" onClick={() => setError('')}><X className="w-4 h-4" /></button>
        </div>
      )}

      {pasteOpen && createPortal(
        <div className="fixed inset-0 z-[1900] bg-[#0F2422]/60 flex items-center justify-center p-4">
          <div className="bg-[#FAF7F2] rounded-[12px] border border-rule shadow-2xl w-full max-w-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm text-ink">Dán nội dung bệnh án</h3>
              <button aria-label="Đóng" onClick={() => setPasteOpen(false)}><X className="w-4 h-4" /></button>
            </div>
            <textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              rows={9}
              placeholder="Dán kết quả xét nghiệm, chẩn đoán, đơn thuốc, dị ứng…"
              className="w-full border border-rule rounded-[8px] p-2 text-xs"
            />
            <div className="flex justify-end gap-2">
              <Btn v="s" onClick={() => setPasteOpen(false)}>Hủy</Btn>
              <Btn onClick={runText} disabled={busy || pasteText.trim().length < 8}>
                {busy ? 'Đang đọc…' : 'Bóc tách bằng AI'}
              </Btn>
            </div>
          </div>
        </div>,
        document.body
      )}

      {draft && createPortal(
        <div
          className="fixed inset-0 z-[2000] flex items-center justify-center p-3 sm:p-6 bg-[#0F2422]/60"
          role="dialog"
          aria-modal="true"
          aria-label="Xác nhận bệnh án"
        >
          <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-[14px] bg-[#FAF7F2] border border-rule shadow-2xl p-3 sm:p-4 [&_*]:backdrop-blur-none">
            <ProfilePendingCard
              profile={s.profile}
              pendingDraft={draft}
              onCancel={() => setPendingRecordDraft(null)}
              onConfirm={d => {
                confirmMedicalRecord(d)
                const originPatientId = s.activePatientId
                const cleanDiseases = cleanAndDeduplicateDiseases(d.diseases || [])
                const cleanMeds = (d.medications || []).map(m => formatMedicationDisplay(m.name, m.activeIngredient))
                appendChatMessage({
                  from: 'b',
                  text: `✅ **Đã liên kết bệnh án "${d.name}" vào Hồ sơ thành công!**\n\n- **Bệnh lý ghi nhận:** ${cleanDiseases.join(', ') || 'Không phát hiện'}\n- **Thuốc đang dùng:** ${cleanMeds.join(', ') || 'Không dùng thuốc'}\n- **Dị ứng:** ${d.allergies?.join(', ') || 'Không có'}\n\nToàn bộ dữ liệu lâm sàng và ngưỡng CDSS đã được đồng bộ với **Hồ sơ**, **Thực đơn**, và nạp trực tiếp vào ngữ cảnh của **Trợ lý AI**. Bạn có thể hỏi tôi bất kỳ thắc mắc nào về chế độ dinh dưỡng an toàn cho hồ sơ này!`,
                  badge_label: 'Hồ sơ đã đồng bộ',
                  badge_color: 'green'
                }, originPatientId)
                toast(
                  nutritionProfileIssue(get().profile)
                    ? 'Đã lưu bệnh án. Bổ sung thông tin cá nhân trước khi lập thực đơn.'
                    : 'Đã đồng bộ bệnh án vào Hồ sơ, Sơ đồ cơ quan, Nhật ký và AI! AI đang suy luận thực đơn 7 ngày riêng cho bạn...'
                )
                if (!nutritionProfileIssue(get().profile)) {
                  void triggerLiveAiMenuUpgrade({
                    daysCount: 7,
                    mealsCount: 3,
                    onComplete: () => {
                      toast('AI đã hoàn tất suy luận từ bệnh án & tài liệu y tế và tạo thực đơn 7 ngày riêng cho bạn!')
                    }
                  })
                }
              }}
            />
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
