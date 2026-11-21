import { describe, it, expect } from 'vitest'
import {
  extractClinicalDataFromText,
  toUint8Array,
  cleanAndDeduplicateDiseases,
  formatMedicationDisplay,
  normalizeMedicationString
} from '../src/utils/pdfExtractor'

describe('PDF Extractor & Clinical NLP Parsing', () => {
  it('should correctly parse stomach ulcer and HP infection without injecting CKD mock data', () => {
    const text = `
      BỆNH VIỆN BẠCH MAI - KHOA TIÊU HÓA
      Họ và tên: Nguyễn Văn An - Tuổi: 45
      Chẩn đoán: Viêm loét dạ dày tá tràng, HP (+)
      Chỉ số xét nghiệm:
      Glucose: 5.2 mmol/L (3.9 - 6.4)
      Creatinine: 85 µmol/L (62 - 106)
      ALT: 28 U/L
      AST: 24 U/L
      Đơn thuốc:
      Nexium 40mg x 1 viên/ngày uống trước ăn sáng 30 phút
      Phosphalugel x 2 gói/ngày
    `

    const result = extractClinicalDataFromText(text, 'benh-an-da-day.pdf')

    // Must NOT have CKD stage 4
    expect(result.diseases).not.toContain('Suy thận mạn CKD Giai đoạn 4')
    expect(result.diseases).not.toContain('Gout mạn tính')
    
    // Must contain stomach ulcer
    expect(result.diseases.some(d => /viêm loét dạ dày|dạ dày/i.test(d))).toBe(true)

    // Stomach organ mapping must be critical or warning
    const stomachMap = result.organ_mappings.find(m => m.organ_id === 'stomach')
    expect(stomachMap).toBeDefined()
    expect(stomachMap?.severity).toBe('critical')

    // Kidneys must be normal (Creatinine is 85 µmol/L)
    const kidneysMap = result.organ_mappings.find(m => m.organ_id === 'kidneys')
    expect(kidneysMap?.severity).toBe('normal')

    // Medications must contain Nexium & Phosphalugel
    expect(result.medications.some(m => /nexium/i.test(m.name))).toBe(true)
    expect(result.medications.some(m => /phosphalugel/i.test(m.name))).toBe(true)
  })

  it('should correctly parse liver hepatitis and elevated ALT/AST', () => {
    const text = `
      PHIẾU XÉT NGHIỆM SINH HÓA
      Bệnh nhân: Trần Thị Bình
      Chẩn đoán: Viêm gan B mạn tính, Tăng men gan
      ALT: 125 U/L
      AST: 98 U/L
      Glucose: 5.5 mmol/L
    `

    const result = extractClinicalDataFromText(text, 'xet-nghiem-gan.pdf')

    expect(result.diseases.some(d => /viêm gan b|men gan/i.test(d))).toBe(true)

    const liverMap = result.organ_mappings.find(m => m.organ_id === 'liver')
    expect(liverMap).toBeDefined()
    expect(liverMap?.severity).toBe('critical')

    // Other organs like joints or kidneys should be normal
    const jointsMap = result.organ_mappings.find(m => m.organ_id === 'joints')
    expect(jointsMap?.severity).toBe('normal')
  })

  it('should correctly parse diabetes and elevated Glucose / HbA1c', () => {
    const text = `
      KẾT QUẢ KHÁM NỘI TIẾT
      Chẩn đoán: Đái tháo đường Type 2
      Glucose đói: 9.8 mmol/L
      HbA1c: 8.5 %
      Huyết áp: 125/80 mmHg
      Đơn thuốc: Glucophage 500mg x 2 viên/ngày
    `

    const result = extractClinicalDataFromText(text, 'kham-noi-tiet.pdf')

    expect(result.diseases.some(d => /đái tháo đường/i.test(d))).toBe(true)

    const pancreasMap = result.organ_mappings.find(m => m.organ_id === 'pancreas')
    expect(pancreasMap).toBeDefined()
    expect(pancreasMap?.severity).toBe('critical')

    expect(result.medications.some(m => /glucophage|metformin/i.test(m.name))).toBe(true)
  })

  it('should correctly parse kidney stones with stone size and urine RBC', () => {
    const text = `
      BỆNH VIỆN BẠCH MAI - KHOA NGOẠI TIẾT NIỆU
      Bệnh nhân: Lê Văn Cường - Tuổi: 38
      Chẩn đoán: Sỏi thận phải, Lắng đọng tinh thể Calci Oxalate
      Kết quả siêu âm: Thận phải có hình ảnh sỏi đài thận kích thước 6.8 mm.
      Xét nghiệm nước tiểu & sinh hóa:
      Creatinine: 135 µmol/L (62 - 106)
      eGFR: 55 ml/phút/1.73m²
      Hồng cầu niệu: Dương tính (++)
      Đơn thuốc: Rowatinex 1 viên x 3 lần/ngày uống nhiều nước.
    `

    const result = extractClinicalDataFromText(text, 'soi-than.pdf')

    // Must detect Kidney stone
    expect(result.diseases.some(d => /sỏi thận/i.test(d))).toBe(true)

    // Kidneys must be warning or critical
    const kidneysMap = result.organ_mappings.find(m => m.organ_id === 'kidneys')
    expect(kidneysMap).toBeDefined()
    expect(kidneysMap?.severity).toBe('warning')

    // Must extract stone size
    const stoneMetric = result.metrics.find(m => /sỏi/i.test(m.name))
    expect(stoneMetric).toBeDefined()
    expect(stoneMetric?.value).toContain('6.8')

    // Must extract medication
    expect(result.medications.some(m => /rowatinex/i.test(m.name))).toBe(true)

    // Other organs must be normal
    const heartMap = result.organ_mappings.find(m => m.organ_id === 'heart')
    expect(heartMap?.severity).toBe('normal')
  })

  it('should correctly parse complex clinical docx record with 6 chronic pathologies', () => {
    const text = `
      BỆNH VIỆN BẠCH MAI - KHOA NỘI TỔNG HỢP
      HỒ SƠ BỆNH ÁN NỘI TRÚ: BA-2026-8892
      Họ và tên: NGUYỄN VĂN ĐỨC - Tuổi: 68
      
      DANH SÁCH CHẨN ĐOÁN LÂM SÀNG & MÃ ICD-10
      N18.32
      Bệnh thận mạn giai đoạn 3b (CKD stage 3b)
      Thận (kidneys)
      CRITICAL

      E11.9
      Đái tháo đường Type 2 phụ thuộc kiểm soát kém
      Tụy (pancreas)
      CRITICAL

      I10 / I48
      Tăng huyết áp vô căn độ 2, Rung nhĩ kịch phát
      Tim mạch (heart)
      CRITICAL

      M10.9
      Gút cấp trên nền mạn tính, lắng đọng tophi
      Khớp (joints)
      WARNING

      K76.0
      Gan nhiễm mỡ độ 2, men gan tăng
      Gan (liver)
      WARNING

      K29.6 / K21.0
      Viêm trợt xung huyết hang vị dạ dày, GERD
      Dạ dày (stomach)
      WARNING

      KẾT QUẢ XÉT NGHIỆM SINH HÓA
      Creatinine: 168 µmol/L (62 - 106)
      eGFR: 36 ml/min/1.73m² (> 90)
      Kali (K+): 5.3 mmol/L (3.5 - 5.0)
      Natri (Na+): 144 mmol/L (135 - 145)
      Glucose máu đói: 9.2 mmol/L (3.9 - 6.4)
      HbA1c: 8.1 % (< 5.7%)
      Acid Uric máu: 545 µmol/L (208 - 428)
      Triglyceride: 3.1 mmol/L (< 1.7)
      Cholesterol: 6.4 mmol/L (< 5.2)
      AST: 58 U/L (< 40)
      ALT: 64 U/L (< 40)
      Huyết áp: 152/95 mmHg (< 120/80)

      ĐƠN THUỐC ĐIỀU TRỊ
      Warfarin 5mg x 1 viên mỗi tối
      Atorvastatin 20mg x 1 viên sau ăn tối
      Losartan 50mg x 1 viên mỗi sáng
      Glucophage 500mg x 2 viên/ngày
      Allopurinol 300mg x 1 viên sau ăn
      Nexium 40mg x 1 viên trước ăn sáng
    `

    const result = extractClinicalDataFromText(text, 'Ho_So_Benh_An_Lam_Sang_BA_2026_8892.docx')

    // Must detect all 6 diseased organs cleanly without headers or duplicates
    expect(result.diseases.length).toBeGreaterThanOrEqual(6)
    expect(result.diseases.some(d => /\.(?:docx?|pdf|png|jpe?g)\b/i.test(d) || /ho[_\s]+so[_\s]+benh[_\s]+an/i.test(d))).toBe(false)
    expect(result.diseases.some(d => /XÁC ĐỊNH|CLINICAL DIAGNOSIS|Lâm sàng Xác định|DANH SÁCH CHẨN ĐOÁN|^CHẨN ĐOÁN$/i.test(d))).toBe(false)
    expect(result.diseases.filter(d => /\bgerd\b|trào ngược/i.test(d)).length).toBe(1)
    expect(result.diseases.filter(d => /tăng huyết áp/i.test(d)).length).toBe(1)
    expect(result.diseases.filter(d => /\bgout\b|\bgút\b/i.test(d)).length).toBe(1)
    
    // Check severity of critical organs
    const kidneysMap = result.organ_mappings.find(m => m.organ_id === 'kidneys')
    expect(kidneysMap?.severity).toBe('critical')

    const heartMap = result.organ_mappings.find(m => m.organ_id === 'heart')
    expect(heartMap?.severity).toBe('critical')

    const pancreasMap = result.organ_mappings.find(m => m.organ_id === 'pancreas')
    expect(pancreasMap?.severity).toBe('critical')

    const jointsMap = result.organ_mappings.find(m => m.organ_id === 'joints')
    expect(['warning', 'critical']).toContain(jointsMap?.severity)

    const liverMap = result.organ_mappings.find(m => m.organ_id === 'liver')
    expect(liverMap?.severity).toBe('warning')

    const stomachMap = result.organ_mappings.find(m => m.organ_id === 'stomach')
    expect(stomachMap?.severity).toBe('warning')

    // Check extracted metrics
    expect(result.metrics.some(m => m.name === 'Creatinine' && m.value === 168)).toBe(true)
    expect(result.metrics.some(m => m.name === 'eGFR' && m.value === 36)).toBe(true)
    expect(result.metrics.some(m => m.name.includes('Kali') && m.value === 5.3)).toBe(true)
    expect(result.metrics.some(m => m.name.includes('Glucose') && m.value === 9.2)).toBe(true)
    expect(result.metrics.some(m => m.name.includes('Acid Uric') && m.value === 545)).toBe(true)
    expect(result.metrics.some(m => m.name.includes('Huyết áp'))).toBe(true)

    // Check extracted medications
    expect(result.medications.some(m => /warfarin/i.test(m.name))).toBe(true)
    expect(result.medications.some(m => /atorvastatin/i.test(m.name))).toBe(true)
    expect(result.medications.some(m => /losartan/i.test(m.name))).toBe(true)
    expect(result.medications.some(m => /glucophage|metformin/i.test(m.name))).toBe(true)
    expect(result.medications.some(m => /allopurinol|zyloric/i.test(m.name) || /allopurinol/i.test(m.activeIngredient))).toBe(true)
    expect(result.medications.some(m => /nexium/i.test(m.name))).toBe(true)
  })

  it('should convert Base64 Data URL to Uint8Array', async () => {
    const sample = 'Hello PDF'
    const b64 = btoa(sample)
    const dataUrl = `data:application/pdf;base64,${b64}`

    const bytes = await toUint8Array(dataUrl)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBe(sample.length)
  })

  it('filters filenames and administrative headers and deduplicates diseases case-insensitively', () => {
    const text = `
      Ho So Benh An_Noi_Tru.docx
      CHẨN ĐOÁN XÁC ĐỊNH (ICD-10 CLINICAL DIAGNOSIS)
      Lâm sàng Xác định
      CHẨN ĐOÁN: Trào ngược dạ dày thực quản (GERD), Tăng huyết áp độ 2, Gout.
      Kết luận: gerd; tăng huyết áp độ 2; BỆNH GOUT (GÚT) MẠN TÍNH; Ho_So_Benh_An_2026.pdf; anh_chup.png; phieu.jpg.
      Đơn thuốc:
      Metformin 850mg x 1 viên
      Zyloric 300mg x 1 viên
    `
    const parsed = extractClinicalDataFromText(text, 'Ho_So_Benh_An_2026.docx')
    expect(parsed.diseases).not.toContain('Ho_So_Benh_An_2026.docx')
    expect(parsed.diseases.some(d => /\.(?:docx?|pdf|png|jpe?g)\b/i.test(d) || /ho[\s_]+so[\s_]+benh[\s_]+an/i.test(d))).toBe(false)
    expect(parsed.diseases.some(d => /XÁC ĐỊNH|CLINICAL DIAGNOSIS|Lâm sàng Xác định|CHẨN ĐOÁN/i.test(d))).toBe(false)
    expect(parsed.diseases.filter(d => /\bgerd\b|trào ngược/i.test(d)).length).toBe(1)
    expect(parsed.diseases.filter(d => /tăng huyết áp/i.test(d)).length).toBe(1)
    expect(parsed.diseases.filter(d => /\bgout\b|\bgút\b/i.test(d)).length).toBe(1)

    const cleanedList = cleanAndDeduplicateDiseases([
      'Ho So Benh An_123.docx',
      'benh_an.pdf',
      'hinh.png',
      'scan.jpg',
      'XÁC ĐỊNH (ICD-10 CLINICAL DIAGNOSIS)',
      'Lâm sàng Xác định',
      'CHẨN ĐOÁN',
      'GERD',
      'gerd',
      'Trào ngược dạ dày thực quản (GERD)',
      'Tăng huyết áp độ 2',
      'tăng huyết áp độ 2',
      'Gout',
      'Bệnh Gout (Gút) mạn tính'
    ])
    expect(cleanedList).toEqual([
      'Trào ngược dạ dày thực quản (GERD)',
      'Tăng huyết áp độ 2',
      'Bệnh Gout (Gút) mạn tính'
    ])
  })

  it('formats medication names cleanly without duplicate ingredient or repeated parentheses', () => {
    expect(formatMedicationDisplay('Metformin', 'Metformin')).toBe('Metformin')
    expect(formatMedicationDisplay('Zyloric (Allopurinol)', 'Allopurinol')).toBe('Zyloric (Allopurinol)')
    expect(normalizeMedicationString('Zyloric (Allopurinol) (Allopurinol)')).toBe('Zyloric (Allopurinol)')
    expect(normalizeMedicationString('Metformin (Metformin)')).toBe('Metformin')
    expect(formatMedicationDisplay('Coumadin 5mg', 'Warfarin')).toBe('Coumadin 5mg (Warfarin)')
    expect(formatMedicationDisplay('Glucophage', 'Metformin')).toBe('Glucophage (Metformin)')
  })
})
