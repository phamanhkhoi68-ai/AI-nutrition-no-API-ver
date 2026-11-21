/**
 * Cổng nạp bệnh án DUY NHẤT cho toàn hệ thống.
 * Mọi màn hình (Tổng quan, Hồ sơ, Nhật ký, Thực đơn, Tư vấn AI...) đều đi qua các hàm này:
 *   tệp / ảnh / văn bản -> AI bóc tách -> bản nháp (pendingRecordDraft) -> người dùng xác nhận
 *   -> confirmMedicalRecord() đồng bộ vào hồ sơ, sơ đồ cơ quan, cảnh báo, thực đơn và tư vấn.
 */
import { analyzeMedicalRecordPDF } from './aiService'
import { setPendingRecordDraft } from './store'
import { compressImageFile } from '../utils/imageUtils'
import type { MedicalRecordExtraction } from '../types'

const DOC_EXT = ['.pdf', '.docx', '.doc', '.txt']

export const ACCEPTED_RECORD_TYPES = '.pdf,.doc,.docx,.txt,image/*'

export function isSupportedRecordFile(file: File): boolean {
  const n = file.name.toLowerCase()
  return file.type.startsWith('image/') || file.type === 'application/pdf' || file.type.startsWith('text/') || DOC_EXT.some(e => n.endsWith(e))
}

export async function ingestMedicalRecordFile(file: File): Promise<MedicalRecordExtraction> {
  if (!isSupportedRecordFile(file)) throw new Error('Định dạng chưa được hỗ trợ. Hãy dùng PDF, Word, TXT hoặc ảnh chụp.')
  const lower = file.name.toLowerCase()
  const isDocument = file.type === 'application/pdf' || file.type.startsWith('text/') || DOC_EXT.some(e => lower.endsWith(e))
  const onFast = (fast: MedicalRecordExtraction) => setPendingRecordDraft(fast)

  let extraction: MedicalRecordExtraction
  if (isDocument) {
    extraction = await analyzeMedicalRecordPDF(file, file.type, file.name, onFast)
  } else {
    const compressed = await compressImageFile(file, 1600, 1600, 0.85)
    extraction = await analyzeMedicalRecordPDF(compressed.base64, compressed.mimeType, file.name, onFast)
  }
  setPendingRecordDraft(extraction)
  return extraction
}

/** Dán trực tiếp nội dung bệnh án (kết quả xét nghiệm, đơn thuốc, chẩn đoán...) dưới dạng văn bản. */
export async function ingestMedicalRecordText(text: string, name = 'Benh-an-dan-vao.txt'): Promise<MedicalRecordExtraction> {
  const clean = text.trim()
  if (clean.length < 8) throw new Error('Nội dung bệnh án quá ngắn.')
  const blob = new Blob([clean], { type: 'text/plain' })
  const extraction = await analyzeMedicalRecordPDF(blob, 'text/plain', name, fast => setPendingRecordDraft(fast))
  setPendingRecordDraft(extraction)
  return extraction
}
