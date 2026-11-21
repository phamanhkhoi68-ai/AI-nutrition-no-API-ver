import type { State, Food, OrganId, OrganMapping, MedicalRecordExtraction, Plan } from '../types'
import { localDateIso } from '../utils/nutrition'

const f = (
  id: string,
  name: string,
  category: string,
  kcal: number,
  protein: number,
  fat: number,
  carb: number,
  fiber: number,
  sodium: number,
  gi: number,
  allergens = '',
  purine: 'Thấp' | 'Vừa' | 'Cao' = 'Thấp',
  potassium = 150
): Food => ({
  id,
  name,
  category,
  kcal,
  protein,
  fat,
  carb,
  fiber,
  sodium,
  gi,
  allergens,
  serving: '100 g',
  purine,
  potassium
})

export const initialOrganAlerts: Record<OrganId, OrganMapping> = {
  heart: {
    organ_id: 'heart',
    severity: 'critical',
    reason: 'Tăng huyết áp 145/92 mmHg & Điều trị chống đông Warfarin (nhạy cảm Vitamin K)',
    nutrient_limits: { sodium_max_mg: 1500, avoid_vitamin_k: 'Rau chân vịt, cải xoăn' }
  },
  kidneys: {
    organ_id: 'kidneys',
    severity: 'critical',
    reason: 'Suy thận mạn CKD Giai đoạn 4 (eGFR 28 ml/phút, Creatinine 142 µmol/L)',
    nutrient_limits: { protein_max_g: 45, potassium_max_mg: 1800, sodium_max_mg: 1500 }
  },
  pancreas: {
    organ_id: 'pancreas',
    severity: 'warning',
    reason: 'Đái tháo đường Type 2 (Glucose đói 8.4 mmol/L, HbA1c 7.8%)',
    nutrient_limits: { gi_max: 55, carb_ratio_max: 45, free_sugar_g: 0 }
  },
  joints: {
    organ_id: 'joints',
    severity: 'warning',
    reason: 'Tăng Acid Uric máu (490 µmol/L) - Nguy cơ khởi phát cơn Gout cấp',
    nutrient_limits: { purine_level: 'Thấp', avoid_red_meat: true }
  },
  liver: {
    organ_id: 'liver',
    severity: 'warning',
    reason: 'Dùng Atorvastatin 20mg (Ức chế men CYP3A4 nếu dùng cùng bưởi chùm)',
    nutrient_limits: { avoid_grapefruit: true }
  },
  stomach: {
    organ_id: 'stomach',
    severity: 'normal',
    reason: 'Dạ dày và đường tiêu hóa chưa ghi nhận viêm loét cấp tính',
    nutrient_limits: { avoid_irritants: 'Ớt cay, rượu bia đậm độ cao' }
  }
}

export const initialOCRHistory: MedicalRecordExtraction[] = [
  {
    id: 'ocr-demo-01',
    name: 'Phieu-xet-nghiem-sinh-hoa-BV-Cho-Ray.pdf',
    date: '2026-11-12',
    type: 'Xét nghiệm sinh hóa máu',
    metrics: [
      { name: 'Creatinine', value: 142, unit: 'µmol/L', status: 'high', referenceRange: '62 - 106', affectedOrgan: 'kidneys' },
      { name: 'eGFR', value: 28, unit: 'ml/phút/1.73m²', status: 'low', referenceRange: '> 90', affectedOrgan: 'kidneys' },
      { name: 'Glucose đói', value: 8.4, unit: 'mmol/L', status: 'high', referenceRange: '3.9 - 6.4', affectedOrgan: 'pancreas' },
      { name: 'HbA1c', value: 7.8, unit: '%', status: 'high', referenceRange: '< 5.7', affectedOrgan: 'pancreas' },
      { name: 'Acid Uric', value: 490, unit: 'µmol/L', status: 'high', referenceRange: '200 - 420', affectedOrgan: 'joints' },
      { name: 'Huyết áp', value: '145/92', unit: 'mmHg', status: 'high', referenceRange: '< 120/80', affectedOrgan: 'heart' }
    ],
    diseases: ['Suy thận mạn CKD Giai đoạn 4', 'Đái tháo đường Type 2', 'Tăng huyết áp', 'Gout mạn tính'],
    allergies: ['Đậu phộng', 'Tôm sú'],
    medications: [
      {
        name: 'Coumadin 5mg',
        activeIngredient: 'Warfarin',
        dosage: '5mg x 1 viên lúc 17h',
        purpose: 'Chống đông máu',
        ddiAlert: 'Chống chỉ định tuyệt đối thực phẩm giàu Vitamin K (rau chân vịt, cải xoăn)',
        affectedOrgan: 'heart'
      },
      {
        name: 'Zestril 10mg',
        activeIngredient: 'Lisinopril',
        dosage: '10mg x 1 viên sáng',
        purpose: 'Hạ huyết áp / Bảo tồn thận',
        ddiAlert: 'Ức chế men chuyển gây giữ Kali máu. Tránh muối ăn kiêng KCl',
        affectedOrgan: 'kidneys'
      },
      {
        name: 'Lipitor 20mg',
        activeIngredient: 'Atorvastatin',
        dosage: '20mg x 1 viên tối',
        purpose: 'Hạ lipid máu',
        ddiAlert: 'Cấm bưởi chùm (Grapefruit) do ức chế enzyme CYP3A4 tăng nguy cơ tiêu cơ vân',
        affectedOrgan: 'liver'
      }
    ],
    has_conflict: true,
    conflict_reason: 'Phát hiện xung đột đối kháng: Suy thận CKD Stage 4 cần siết đạm 0.8g/kg/ngày nhưng bệnh nhân có nguy cơ suy mòn cần duy trì năng lượng. Thuốc Warfarin tương tác nguy hiểm với Vitamin K.',
    organ_mappings: Object.values(initialOrganAlerts),
    raw_summary: 'Bệnh án ghi nhận hội chứng chuyển hóa và suy giảm chức năng thận mức độ nặng, kèm theo dùng 3 nhóm thuốc kê đơn có nguy cơ tương tác dinh dưỡng phức tạp.',
    confirmed: true
  }
]

export const initialPlan: Plan = {
  id: 'plan-cdss-init',
  name: 'Kế hoạch Dinh dưỡng Lâm sàng CDSS - Đa bệnh lý',
  created: new Date().toISOString(),
  personalized: true,
  status: 'PENDING_EXPERT_REVIEW',
  has_conflict: true,
  conflict_details: 'Xung đột Đa bệnh lý: CKD 4 (Giới hạn Đạm ≤ 45g/ngày) + Đái tháo đường Type 2 (GI ≤ 55) + Phác đồ Warfarin (Tránh biến thiên Vitamin K). Chuyển luồng Expert Human-in-the-Loop thẩm định.',
  evidence_basis: [
    {
      guideline_name: 'KDIGO 2024 Clinical Practice Guideline for CKD',
      citation_url: 'https://kdigo.org/guidelines/',
      rationale: 'Hạn chế protein 0.6–0.8g/kg/ngày để giảm tải mức lọc cầu thận và giảm ứ đọng ure máu.'
    },
    {
      guideline_name: 'American Heart Association (AHA) Drug-Diet Safety',
      citation_url: 'https://openfda.gov',
      pharmacology_source: 'RxNorm Warfarin Monograph',
      rationale: 'Kiểm soát ổn định Vitamin K để không làm lệch chỉ số đông máu INR.'
    }
  ],
  hard_limits: {
    max_sodium_mg: 1500,
    max_protein_g: 45,
    max_gi: 55
  },
  history: ['AI CDSS khởi tạo thực đơn nháp và tự động gắn cờ PENDING_EXPERT_REVIEW.'],
  days: [
    {
      'Bữa sáng': [
        { foodId: 'F019', grams: 300, foodName: 'Cháo yến mạch đậu đỏ', note: 'Chất xơ hòa tan, ít đạm' },
        { foodId: 'F023', grams: 220, foodName: 'Sữa hạt sen ít đường', note: 'Canxi thực vật, năng lượng êm' },
        { foodId: 'F014', grams: 15, foodName: 'Dầu oliu nguyên chất', note: 'MUFA sạch năng lượng, 0g đạm' }
      ],
      'Bữa trưa': [
        { foodId: 'F001', grams: 220, foodName: 'Gạo lứt', note: 'GI thấp ~50, tinh bột phức hợp' },
        { foodId: 'F004', grams: 35, foodName: 'Ức gà phi lê', note: 'Đạm nạc siết bảo vệ thận' },
        { foodId: 'F021', grams: 180, foodName: 'Canh bí xanh nấu nhạt', note: 'Lợi tiểu, natri rất thấp' },
        { foodId: 'F088', grams: 20, foodName: 'Dầu mè nguyên chất (ép lạnh)', note: 'Bổ sung năng lượng sạch' }
      ],
      'Bữa tối': [
        { foodId: 'F002', grams: 260, foodName: 'Khoai lang luộc', note: 'Carb phức hợp, ít đạm' },
        { foodId: 'F020', grams: 30, foodName: 'Cá hấp gừng hành', note: 'Đạm sinh học cao' },
        { foodId: 'F090', grams: 25, foodName: 'Dầu quả bơ nguyên chất', note: 'Chất béo tốt cho tim mạch' },
        { foodId: 'F012', grams: 180, foodName: 'Táo tây gọt vỏ', note: 'Ít kali, giàu pectin' }
      ]
    },
    {
      'Bữa sáng': [
        { foodId: 'F051', grams: 280, foodName: 'Cháo đậu xanh bí ngô', note: 'GI thấp, thanh mát' },
        { foodId: 'F084', grams: 240, foodName: 'Sữa yến mạch nguyên chất không đường', note: 'Beta-glucan ổn định đường huyết' },
        { foodId: 'F088', grams: 15, foodName: 'Dầu mè nguyên chất (ép lạnh)', note: 'Năng lượng sạch' }
      ],
      'Bữa trưa': [
        { foodId: 'F037', grams: 220, foodName: 'Cơm gạo lứt đỏ', note: 'GI thấp 48, giàu chất xơ' },
        { foodId: 'F057', grams: 55, foodName: 'Cá quả (cá lóc) hấp gừng thì là', note: 'Đạm trắng dễ tiêu hóa' },
        { foodId: 'F071', grams: 180, foodName: 'Canh mướp hương nấu nấm rơm', note: 'Thanh nhiệt, ít natri' },
        { foodId: 'F014', grams: 25, foodName: 'Dầu oliu nguyên chất', note: 'Chất béo không bão hòa đơn' }
      ],
      'Bữa tối': [
        { foodId: 'F047', grams: 240, foodName: 'Khoai môn hấp chín mềm', note: 'Tinh bột ít đạm bảo vệ thận' },
        { foodId: 'F067', grams: 100, foodName: 'Đậu hũ non sốt nấm rơm', note: 'Đạm thực vật ít purine' },
        { foodId: 'F092', grams: 20, foodName: 'Dầu cải Canola ít bão hòa', note: 'Hỗ trợ kiểm soát lipid' },
        { foodId: 'F030', grams: 180, foodName: 'Lê tươi gọt vỏ', note: 'GI thấp, ít kali' }
      ]
    },
    {
      'Bữa sáng': [
        { foodId: 'F054', grams: 220, foodName: 'Bún gạo xào rau củ thanh đạm', note: 'Nhẹ bụng, GI ổn định' },
        { foodId: 'F085', grams: 220, foodName: 'Sữa hạt điều không đường', note: 'Bổ sung năng lượng tốt' },
        { foodId: 'F090', grams: 15, foodName: 'Dầu quả bơ nguyên chất', note: 'Chất béo tốt không cholesterol' }
      ],
      'Bữa trưa': [
        { foodId: 'F039', grams: 220, foodName: 'Cơm gạo tím than Điện Biên', note: 'Giàu anthocyanin kháng viêm' },
        { foodId: 'F058', grams: 55, foodName: 'Cá diêu hồng hấp hành gừng', note: 'Đạm sinh học cao, ít purine' },
        { foodId: 'F072', grams: 180, foodName: 'Canh su hào cà rốt nấu nhạt', note: 'Ít muối, giàu vitamin' },
        { foodId: 'F093', grams: 20, foodName: 'Dầu cám gạo nguyên chất', note: 'Gamma-oryzanol bảo vệ tim mạch' }
      ],
      'Bữa tối': [
        { foodId: 'F045', grams: 250, foodName: 'Khoai lang mật hấp chín', note: 'Tinh bột giải phóng chậm' },
        { foodId: 'F068', grams: 100, foodName: 'Đậu phụ hấp nấm đông cô', note: 'Đạm thực vật thanh đạm' },
        { foodId: 'F014', grams: 20, foodName: 'Dầu oliu nguyên chất', note: 'Năng lượng sạch 0g đạm' },
        { foodId: 'F081', grams: 180, foodName: 'Thanh long ruột trắng', note: 'Giàu chất xơ, mát thận' }
      ]
    },
    {
      'Bữa sáng': [
        { foodId: 'F031', grams: 250, foodName: 'Cháo hạt sen bí đỏ thịt băm', note: 'Dễ tiêu, cân bằng năng lượng' },
        { foodId: 'F084', grams: 220, foodName: 'Sữa yến mạch nguyên chất không đường', note: 'Ổn định đường huyết sáng' },
        { foodId: 'F093', grams: 15, foodName: 'Dầu cám gạo nguyên chất', note: 'Bổ sung năng lượng sạch' }
      ],
      'Bữa trưa': [
        { foodId: 'F041', grams: 220, foodName: 'Cơm gạo mầm GABA hấp', note: 'Hỗ trợ hạ huyết áp nhẹ' },
        { foodId: 'F060', grams: 55, foodName: 'Cá trắm hấp xả gừng', note: 'Đạm nạc ít béo bão hòa' },
        { foodId: 'F033', grams: 180, foodName: 'Bắp cải trắng hấp chín', note: 'Ít kali, bảo vệ niêm mạc' },
        { foodId: 'F014', grams: 25, foodName: 'Dầu oliu nguyên chất', note: 'MUFA bảo vệ nội mô mạch' }
      ],
      'Bữa tối': [
        { foodId: 'F048', grams: 250, foodName: 'Khoai sọ hấp rắc mè', note: 'Tinh bột ít đạm cho CKD' },
        { foodId: 'F006', grams: 65, foodName: 'Đậu phụ hấp', note: 'Đạm thực vật lành mạnh' },
        { foodId: 'F088', grams: 25, foodName: 'Dầu mè nguyên chất (ép lạnh)', note: 'Tăng mật độ năng lượng sạch' },
        { foodId: 'F034', grams: 180, foodName: 'Đu đủ chín gọt vỏ', note: 'Hỗ trợ tiêu hóa nhẹ' }
      ]
    },
    {
      'Bữa sáng': [
        { foodId: 'F027', grams: 180, foodName: 'Miến dong nấu thịt nạc rau cải', note: 'Tinh bột miến dong ít đạm chuẩn CKD' },
        { foodId: 'F023', grams: 200, foodName: 'Sữa hạt sen ít đường', note: 'Êm bụng, ít natri' },
        { foodId: 'F092', grams: 15, foodName: 'Dầu cải Canola ít bão hòa', note: 'Cân bằng chất béo' }
      ],
      'Bữa trưa': [
        { foodId: 'F001', grams: 220, foodName: 'Gạo lứt', note: 'Kiểm soát đường huyết sau ăn' },
        { foodId: 'F057', grams: 50, foodName: 'Cá quả (cá lóc) hấp gừng thì là', note: 'Đạm trắng an toàn cho Gout' },
        { foodId: 'F075', grams: 180, foodName: 'Su su luộc chấm mè nhạt', note: 'Rất ít natri & kali' },
        { foodId: 'F090', grams: 25, foodName: 'Dầu quả bơ nguyên chất', note: 'Giàu MUFA sạch' }
      ],
      'Bữa tối': [
        { foodId: 'F047', grams: 240, foodName: 'Khoai môn hấp chín mềm', note: 'Tinh bột phức hợp ít đạm' },
        { foodId: 'F067', grams: 80, foodName: 'Đậu hũ non sốt nấm rơm', note: 'Thanh đạm buổi tối' },
        { foodId: 'F014', grams: 25, foodName: 'Dầu oliu nguyên chất', note: 'Đảm bảo năng lượng an toàn' },
        { foodId: 'F083', grams: 200, foodName: 'Dưa lê thơm gọt vỏ', note: 'Giải nhiệt, ít đường' }
      ]
    },
    {
      'Bữa sáng': [
        { foodId: 'F019', grams: 280, foodName: 'Cháo yến mạch đậu đỏ', note: 'Giàu chất xơ hòa tan' },
        { foodId: 'F085', grams: 240, foodName: 'Sữa hạt điều không đường', note: 'Chất béo thực vật lành mạnh' },
        { foodId: 'F088', grams: 20, foodName: 'Dầu mè nguyên chất (ép lạnh)', note: 'Năng lượng sạch' }
      ],
      'Bữa trưa': [
        { foodId: 'F037', grams: 210, foodName: 'Cơm gạo lứt đỏ', note: 'Chỉ số đường huyết thấp' },
        { foodId: 'F020', grams: 55, foodName: 'Cá hấp gừng hành', note: 'Đạm sinh học cao' },
        { foodId: 'F077', grams: 160, foodName: 'Đậu que luộc giòn', note: 'Ít muối, giàu chất xơ' },
        { foodId: 'F014', grams: 25, foodName: 'Dầu oliu nguyên chất', note: 'Chống oxy hóa tim mạch' }
      ],
      'Bữa tối': [
        { foodId: 'F045', grams: 250, foodName: 'Khoai lang mật hấp chín', note: 'Carb phức hợp' },
        { foodId: 'F068', grams: 90, foodName: 'Đậu phụ hấp nấm đông cô', note: 'Nhẹ thận buổi tối' },
        { foodId: 'F092', grams: 25, foodName: 'Dầu cải Canola ít bão hòa', note: 'Giữ năng lượng ổn định' },
        { foodId: 'F012', grams: 180, foodName: 'Táo tây gọt vỏ', note: 'Pectin hỗ trợ hạ mỡ máu' }
      ]
    },
    {
      'Bữa sáng': [
        { foodId: 'F051', grams: 260, foodName: 'Cháo đậu xanh bí ngô', note: 'Thanh nhiệt, GI thấp' },
        { foodId: 'F023', grams: 220, foodName: 'Sữa hạt sen ít đường', note: 'Bổ sung canxi nhẹ' },
        { foodId: 'F090', grams: 20, foodName: 'Dầu quả bơ nguyên chất', note: 'Năng lượng sạch' }
      ],
      'Bữa trưa': [
        { foodId: 'F039', grams: 220, foodName: 'Cơm gạo tím than Điện Biên', note: 'Kháng viêm tự nhiên' },
        { foodId: 'F058', grams: 55, foodName: 'Cá diêu hồng hấp hành gừng', note: 'Đạm trắng an toàn' },
        { foodId: 'F021', grams: 180, foodName: 'Canh bí xanh nấu nhạt', note: 'Lợi tiểu, ít natri' },
        { foodId: 'F093', grams: 25, foodName: 'Dầu cám gạo nguyên chất', note: 'Bảo vệ thành mạch' }
      ],
      'Bữa tối': [
        { foodId: 'F002', grams: 260, foodName: 'Khoai lang luộc', note: 'Tinh bột ít đạm' },
        { foodId: 'F006', grams: 80, foodName: 'Đậu phụ hấp', note: 'Đạm thực vật sạch' },
        { foodId: 'F014', grams: 25, foodName: 'Dầu oliu nguyên chất', note: 'Chất béo tốt 0g đạm' },
        { foodId: 'F030', grams: 180, foodName: 'Lê tươi gọt vỏ', note: 'Tráng miệng an toàn' }
      ]
    }
  ]
}

export const seed = (): State => ({
  users: [
    { id: 'u1', name: 'Nguyễn Văn An', email: 'patient@demo.vn', password: 'Demo123!', role: 'patient', active: true },
    { id: 'u-test-patient', name: 'Bệnh nhân kiểm thử', email: 'patient.test@demo.vn', password: 'Demo123!', role: 'patient', active: true },
    { id: 'u2', name: 'TS. Trần Thu Hà (CDSS Dietitian)', email: 'expert@demo.vn', password: 'Demo123!', role: 'expert', active: true },
    { id: 'u3', name: 'Quản trị viên Hệ thống', email: 'admin@demo.vn', password: 'Demo123!', role: 'admin', active: true }
  ],
  foods: [
    f('F001', 'Gạo lứt', 'Tinh bột', 111, 2.6, 0.9, 23.5, 1.8, 5, 50, '', 'Thấp', 120),
    f('F002', 'Khoai lang luộc', 'Tinh bột', 86, 1.6, 0.1, 20.1, 3, 55, 44, '', 'Thấp', 330),
    f('F003', 'Yến mạch nguyên cám', 'Tinh bột', 389, 16.9, 6.9, 66.3, 10.6, 2, 55, '', 'Thấp', 420),
    f('F004', 'Ức gà phi lê', 'Đạm', 165, 31, 3.6, 0, 0, 74, 0, '', 'Thấp', 250),
    f('F005', 'Thịt thăn heo nạc', 'Đạm', 143, 26, 3.5, 0, 0, 65, 0, '', 'Vừa', 360),
    f('F006', 'Đậu phụ hấp', 'Đạm', 76, 8, 4.8, 1.9, 0.3, 7, 15, 'đậu nành', 'Thấp', 120),
    f('F007', 'Cá hồi phi lê áp chảo', 'Đạm', 208, 20, 13, 0, 0, 59, 0, 'cá', 'Vừa', 380),
    f('F008', 'Tôm sú hấp', 'Đạm', 99, 24, 0.3, 0.2, 0, 111, 0, 'hải sản', 'Cao', 220),
    f('F009', 'Bông cải xanh luộc', 'Rau', 34, 2.8, 0.4, 7, 2.6, 33, 15, '', 'Thấp', 316),
    f('F010', 'Rau mồng tơi luộc', 'Rau', 19, 1.8, 0.3, 2.7, 1.4, 40, 15, '', 'Thấp', 200),
    f('F011', 'Dưa leo thái lát', 'Rau', 15, 0.7, 0.1, 3.6, 0.5, 2, 15, '', 'Thấp', 140),
    f('F012', 'Táo tây gọt vỏ', 'Trái cây', 52, 0.3, 0.2, 13.8, 2.4, 1, 36, '', 'Thấp', 107),
    f('F013', 'Sữa chua không đường', 'Sữa', 63, 3.5, 3, 4.7, 0, 46, 35, 'sữa', 'Thấp', 141),
    f('F014', 'Dầu oliu nguyên chất', 'Dầu mỡ', 884, 0, 100, 0, 0, 2, 0, '', 'Thấp', 1),
    f('F015', 'Lòng trắng trứng luộc', 'Đạm', 52, 11, 0.2, 0.7, 0, 166, 0, 'trứng', 'Thấp', 163),
    f('F016', 'Cơm trắng', 'Tinh bột', 130, 2.7, 0.3, 28, 0.4, 1, 73, '', 'Thấp', 35),
    f('F017', 'Cá basa hấp nhạt', 'Đạm', 120, 17, 5, 2, 0, 150, 0, 'cá', 'Thấp', 280),
    f('F018', 'Chuối chín vừa', 'Trái cây', 89, 1.1, 0.3, 22.8, 2.6, 1, 51, '', 'Thấp', 358),
    f('F019', 'Cháo yến mạch đậu đỏ', 'Tinh bột', 72, 3.1, 1.5, 12, 1.2, 60, 45, '', 'Thấp', 150),
    f('F020', 'Cá hấp gừng hành', 'Đạm', 115, 19, 4, 1, 0.2, 90, 0, 'cá', 'Thấp', 310),
    f('F021', 'Canh bí xanh nấu nhạt', 'Rau', 18, 0.8, 0.4, 3.2, 0.9, 95, 15, '', 'Thấp', 180),
    f('F022', 'Rau chân vịt luộc (Spinach)', 'Rau', 23, 2.9, 0.4, 3.6, 2.2, 79, 15, '', 'Thấp', 558),
    f('F023', 'Sữa hạt sen ít đường', 'Sữa', 68, 2.4, 1.2, 12, 0.8, 35, 38, '', 'Thấp', 110),
    f('F024', 'Sữa đậu nành không đường', 'Sữa', 54, 3.3, 1.8, 6, 0.6, 28, 34, 'đậu nành', 'Thấp', 118),
    f('F025', 'Phở gạo lứt ức gà thanh đạm', 'Tinh bột', 135, 9.5, 2.2, 19.5, 1.4, 115, 48, '', 'Thấp', 190),
    f('F026', 'Bún gạo lứt ức gà rau củ', 'Tinh bột', 128, 8.8, 2.0, 18.8, 1.5, 95, 46, '', 'Thấp', 180),
    f('F027', 'Miến dong nấu thịt nạc rau cải', 'Tinh bột', 118, 6.2, 1.8, 19.5, 1.1, 85, 45, '', 'Thấp', 140),
    f('F028', 'Đậu phụ nhồi thịt nạc hấp', 'Đạm', 125, 11.5, 6.2, 5.5, 0.5, 80, 20, 'đậu nành', 'Thấp', 150),
    f('F029', 'Canh bầu nấu tôm nõn nhạt', 'Rau', 38, 3.2, 0.6, 4.8, 1.0, 75, 15, 'hải sản', 'Vừa', 130),
    f('F030', 'Lê tươi gọt vỏ', 'Trái cây', 57, 0.4, 0.1, 15.2, 3.1, 1, 38, '', 'Thấp', 116),
    f('F031', 'Cháo hạt sen bí đỏ thịt băm', 'Tinh bột', 96, 4.8, 2.1, 14.5, 1.4, 68, 48, '', 'Thấp', 160),
    f('F032', 'Canh rau ngót nấu thịt băm nhạt', 'Rau', 42, 3.8, 1.1, 4.2, 1.3, 70, 15, '', 'Thấp', 175),
    f('F033', 'Bắp cải trắng hấp chín', 'Rau', 25, 1.3, 0.1, 5.8, 2.5, 18, 15, '', 'Thấp', 170),
    f('F034', 'Đu đủ chín gọt vỏ', 'Trái cây', 43, 0.5, 0.3, 10.8, 1.7, 8, 50, '', 'Thấp', 182),
    f('F035', 'Bánh cuốn gạo lứt nhân nấm thịt nạc', 'Tinh bột', 142, 6.5, 2.8, 22.5, 1.8, 92, 50, '', 'Thấp', 165),
    f('F036', 'Súp gà ngô non nấm tuyết', 'Tinh bột', 88, 7.2, 2.4, 9.5, 1.1, 90, 42, '', 'Thấp', 145),
    // Grains & Low-GI Starches (for 7-day unique variety)
    f('F037', 'Cơm gạo lứt đỏ', 'Tinh bột', 115, 2.7, 0.9, 24.0, 1.9, 6, 48, '', 'Thấp', 125),
    f('F038', 'Cơm gạo tẻ thơm nấu mềm', 'Tinh bột', 128, 2.5, 0.3, 27.5, 0.5, 3, 55, '', 'Thấp', 45),
    f('F039', 'Cơm gạo tím than Điện Biên', 'Tinh bột', 118, 2.8, 1.0, 24.2, 2.0, 5, 46, '', 'Thấp', 130),
    f('F040', 'Cơm gạo tám thơm dẻo', 'Tinh bột', 126, 2.6, 0.4, 27.0, 0.6, 4, 54, '', 'Thấp', 50),
    f('F041', 'Cơm gạo mầm GABA hấp', 'Tinh bột', 120, 2.8, 0.9, 24.5, 1.8, 5, 47, '', 'Thấp', 115),
    f('F042', 'Cơm ngũ cốc diêm mạch Quinoa', 'Tinh bột', 122, 4.1, 1.9, 21.3, 2.8, 7, 50, '', 'Thấp', 172),
    f('F043', 'Cơm gạo Séng Cù nấu mềm', 'Tinh bột', 125, 2.5, 0.3, 26.8, 0.5, 3, 55, '', 'Thấp', 48),
    f('F044', 'Cơm hạt kê ngũ sắc', 'Tinh bột', 119, 3.5, 1.0, 23.7, 1.3, 4, 52, '', 'Thấp', 95),
    f('F045', 'Khoai lang mật hấp chín', 'Tinh bột', 92, 1.5, 0.2, 21.5, 2.8, 42, 46, '', 'Thấp', 240),
    f('F046', 'Khoai tây luộc bỏ vỏ (2 nước)', 'Tinh bột', 78, 1.8, 0.1, 17.5, 1.8, 12, 54, '', 'Thấp', 195),
    f('F047', 'Khoai môn hấp chín mềm', 'Tinh bột', 112, 1.5, 0.2, 26.0, 4.1, 15, 50, '', 'Thấp', 235),
    f('F048', 'Khoai sọ hấp rắc mè', 'Tinh bột', 105, 1.8, 0.5, 23.2, 3.2, 18, 49, '', 'Thấp', 210),
    f('F049', 'Cháo sườn ngô ngọt nấu nhạt', 'Tinh bột', 82, 3.6, 1.8, 13.0, 1.0, 62, 50, '', 'Thấp', 110),
    f('F050', 'Cháo cá quả thì là gừng tươi', 'Tinh bột', 85, 5.2, 1.4, 12.8, 0.6, 68, 49, 'cá', 'Thấp', 145),
    f('F051', 'Cháo đậu xanh bí ngô', 'Tinh bột', 88, 3.4, 0.8, 16.8, 2.1, 25, 44, '', 'Thấp', 165),
    f('F052', 'Bánh canh bột gạo thịt băm thanh nhạt', 'Tinh bột', 108, 4.2, 1.5, 19.2, 0.8, 85, 52, '', 'Thấp', 105),
    f('F053', 'Hủ tiếu gạo lứt giò nạc nước trong', 'Tinh bột', 124, 5.8, 2.0, 20.5, 1.2, 92, 49, '', 'Thấp', 120),
    f('F054', 'Bún gạo xào rau củ thanh đạm', 'Tinh bột', 116, 3.0, 1.4, 22.8, 1.6, 65, 48, '', 'Thấp', 115),
    f('F055', 'Miến dong xào ức gà nấm rơm', 'Tinh bột', 129, 7.2, 1.9, 20.8, 1.2, 82, 46, '', 'Thấp', 135),
    f('F056', 'Bánh mì nguyên cám nướng nhẹ', 'Tinh bột', 245, 9.0, 3.2, 43.0, 6.0, 145, 51, '', 'Thấp', 180),
    // Lean Proteins
    f('F057', 'Cá quả (cá lóc) hấp gừng thì là', 'Đạm', 112, 19.5, 3.2, 0.8, 0, 72, 0, 'cá', 'Thấp', 240),
    f('F058', 'Cá diêu hồng hấp hành gừng', 'Đạm', 118, 18.8, 4.0, 1.0, 0, 78, 0, 'cá', 'Thấp', 250),
    f('F059', 'Chả cá thác lác hấp thì là', 'Đạm', 126, 17.5, 4.8, 2.5, 0.2, 95, 0, 'cá', 'Thấp', 220),
    f('F060', 'Cá trắm hấp xả gừng', 'Đạm', 122, 18.2, 4.5, 0.5, 0, 76, 0, 'cá', 'Thấp', 235),
    f('F061', 'Cá thu sốt cà chua nhạt', 'Đạm', 148, 19.0, 7.2, 2.2, 0.4, 88, 0, 'cá', 'Vừa', 260),
    f('F062', 'Ức gà hấp lá chanh xé phay', 'Đạm', 158, 29.0, 3.4, 0.5, 0, 68, 0, '', 'Thấp', 230),
    f('F063', 'Ức gà hầm bí đỏ nhạt', 'Đạm', 118, 16.5, 2.8, 6.2, 0.8, 55, 25, '', 'Thấp', 210),
    f('F064', 'Thịt thăn heo rim nghệ nhạt', 'Đạm', 148, 24.5, 4.2, 2.0, 0.2, 72, 0, '', 'Vừa', 245),
    f('F065', 'Thịt nạc vai luộc thái mỏng', 'Đạm', 152, 23.0, 5.8, 0.5, 0, 64, 0, '', 'Vừa', 235),
    f('F066', 'Trứng gà hấp vân mây', 'Đạm', 115, 10.2, 7.5, 1.2, 0, 92, 0, 'trứng', 'Thấp', 125),
    f('F067', 'Đậu hũ non sốt nấm rơm', 'Đạm', 68, 6.8, 3.4, 2.6, 0.5, 32, 15, 'đậu nành', 'Thấp', 115),
    f('F068', 'Đậu phụ hấp nấm đông cô', 'Đạm', 74, 7.4, 3.8, 2.4, 0.6, 28, 15, 'đậu nành', 'Thấp', 120),
    // Vegetables & Low-Sodium Soups
    f('F069', 'Canh atiso hầm giò nạc lọc mỡ', 'Rau', 45, 3.5, 1.2, 4.8, 1.5, 68, 15, '', 'Thấp', 195),
    f('F070', 'Canh cải cúc nấu thịt băm nhạt', 'Rau', 32, 2.6, 0.8, 3.2, 1.2, 65, 15, '', 'Thấp', 175),
    f('F071', 'Canh mướp hương nấu nấm rơm', 'Rau', 24, 1.2, 0.3, 4.2, 1.1, 45, 15, '', 'Thấp', 140),
    f('F072', 'Canh su hào cà rốt nấu nhạt', 'Rau', 28, 1.1, 0.2, 5.4, 1.4, 48, 20, '', 'Thấp', 160),
    f('F073', 'Canh bí đỏ đậu xanh thanh mát', 'Rau', 44, 1.8, 0.4, 8.2, 1.5, 35, 35, '', 'Thấp', 185),
    f('F074', 'Canh cải ngọt nấu gừng nhạt', 'Rau', 22, 1.5, 0.2, 3.5, 1.3, 52, 15, '', 'Thấp', 165),
    f('F075', 'Su su luộc chấm mè nhạt', 'Rau', 26, 1.0, 0.5, 4.5, 1.7, 15, 20, '', 'Thấp', 125),
    f('F076', 'Su hào luộc thái lát', 'Rau', 27, 1.7, 0.1, 6.0, 2.2, 20, 20, '', 'Thấp', 180),
    f('F077', 'Đậu que luộc giòn', 'Rau', 31, 1.8, 0.2, 6.8, 2.7, 6, 15, '', 'Thấp', 175),
    f('F078', 'Cải ngọt luộc thanh nhiệt', 'Rau', 20, 1.6, 0.2, 3.2, 1.6, 22, 15, '', 'Thấp', 180),
    f('F079', 'Rau lang luộc nhạt', 'Rau', 28, 2.2, 0.3, 4.6, 2.1, 18, 15, '', 'Thấp', 190),
    f('F080', 'Bí đỏ hấp chín mềm', 'Rau', 36, 1.0, 0.2, 8.2, 1.4, 8, 40, '', 'Thấp', 210),
    // Fruits, Plant Milks & Healthy Oils
    f('F081', 'Thanh long ruột trắng', 'Trái cây', 51, 1.1, 0.4, 12.2, 2.9, 4, 45, '', 'Thấp', 185),
    f('F082', 'Ổi sẻ gọt vỏ bỏ hạt', 'Trái cây', 62, 2.2, 0.8, 13.5, 4.8, 2, 24, '', 'Thấp', 215),
    f('F083', 'Dưa lê thơm gọt vỏ', 'Trái cây', 36, 0.8, 0.2, 8.6, 0.9, 12, 48, '', 'Thấp', 195),
    f('F084', 'Sữa yến mạch nguyên chất không đường', 'Sữa', 48, 1.2, 1.5, 7.2, 0.8, 24, 45, '', 'Thấp', 120),
    f('F085', 'Sữa hạt điều không đường', 'Sữa', 58, 1.8, 3.8, 4.5, 0.5, 22, 30, '', 'Thấp', 110),
    f('F086', 'Trà atiso túi lọc ấm', 'Sữa', 8, 0.2, 0, 1.8, 0, 4, 10, '', 'Thấp', 45),
    f('F087', 'Nước gạo lứt rang ấm', 'Sữa', 18, 0.4, 0.1, 3.8, 0.2, 3, 35, '', 'Thấp', 38),
    f('F088', 'Dầu mè nguyên chất (ép lạnh)', 'Dầu mỡ', 884, 0, 100, 0, 0, 0, 0, '', 'Thấp', 0),
    f('F089', 'Dầu hạt lanh ép lạnh', 'Dầu mỡ', 884, 0, 100, 0, 0, 0, 0, '', 'Thấp', 0),
    f('F090', 'Dầu quả bơ nguyên chất', 'Dầu mỡ', 884, 0, 100, 0, 0, 0, 0, '', 'Thấp', 0),
    f('F091', 'Dầu hướng dương tinh luyện', 'Dầu mỡ', 884, 0, 100, 0, 0, 0, 0, '', 'Thấp', 0),
    f('F092', 'Dầu cải Canola ít bão hòa', 'Dầu mỡ', 884, 0, 100, 0, 0, 0, 0, '', 'Thấp', 0),
    f('F093', 'Dầu cám gạo nguyên chất', 'Dầu mỡ', 884, 0, 100, 0, 0, 0, 0, '', 'Thấp', 0),
    f('F094', 'Dầu gấc dinh dưỡng', 'Dầu mỡ', 884, 0, 100, 0, 0, 0, 0, '', 'Thấp', 0)
  ],
  conditions: [
    { id: 'C1', name: 'Đái tháo đường type 2', status: 'Hỗ trợ' },
    { id: 'C2', name: 'Tăng huyết áp', status: 'Hỗ trợ' },
    { id: 'C3', name: 'Bệnh thận mạn', status: 'Hỗ trợ' },
    { id: 'C4', name: 'Gout', status: 'Hỗ trợ' }
  ],
  rules: [
    {
      id: 'R1',
      title: 'Kiểm soát Carb GI thấp cho Đái tháo đường type 2',
      condition: 'Đái tháo đường type 2',
      maxSodium: 2000,
      maxGI: 55,
      avoidCategories: 'Nước ngọt có gas',
      reference: 'ADA Standards of Medical Care in Diabetes 2024',
      status: 'Đã duyệt'
    },
    {
      id: 'R2',
      title: 'Hạn chế Natri nghiêm ngặt cho Tăng huyết áp',
      condition: 'Tăng huyết áp',
      maxSodium: 1500,
      maxGI: 100,
      avoidCategories: 'Mắm tôm, đồ muối chua, dưa cà muối',
      reference: 'AHA/ACC Hypertension Clinical Practice Guideline',
      status: 'Đã duyệt'
    },
    {
      id: 'R3',
      title: 'Giới hạn Đạm & Natri & Kali cho CKD Giai đoạn 4',
      condition: 'Bệnh thận mạn',
      maxSodium: 1500,
      maxGI: 100,
      avoidCategories: 'Thực phẩm chế biến sẵn, muối kali',
      reference: 'KDIGO 2024 Clinical Practice Guideline for CKD',
      status: 'Chờ duyệt'
    },
    {
      id: 'R4',
      title: 'Hạn chế Purine cao cho Gout',
      condition: 'Gout',
      maxSodium: 2000,
      maxGI: 100,
      avoidCategories: 'Nội tạng động vật, hải sản đậm, thịt đỏ',
      reference: 'ACR Guideline for the Management of Gout',
      status: 'Đã duyệt'
    }
  ],
  docs: [
    {
      id: 'D1',
      title: 'Phác đồ Dinh dưỡng Lâm sàng Bệnh Thận mạn (KDIGO 2024)',
      condition: 'Bệnh thận mạn CKD Giai đoạn 3-5',
      content: 'Chỉ định mức đạm 0.6–0.8g/kg thể trọng chuẩn; ưu tiên > 50% đạm giá trị sinh học cao (trứng, cá, thịt nạc); Natri < 1,500mg/ngày; kiểm soát Kali < 2,000mg/ngày và Phốt pho < 800mg/ngày. Tinh bột ít đạm (khoai củ, miến dong, bột sắn) để đảm bảo năng lượng 30-35 kcal/kg mà không tăng ure máu.',
      status: 'Đã duyệt',
      comment: 'Đã thẩm định bởi Trưởng khoa Dinh dưỡng Lâm sàng CDSS'
    },
    {
      id: 'D2',
      title: 'Phác đồ Dinh dưỡng Sỏi Tiết niệu & Sỏi Thận (EAU / AUA Guidelines 2024)',
      condition: 'Sỏi thận & Tiết niệu',
      content: 'Mục tiêu bài niệu > 2.5 lít/ngày (uống tối thiểu 2.5 - 3.0L nước, nước râu ngô, bông mã đề). Đối với sỏi Calci Oxalate: Kiêng tuyệt đối thực phẩm giàu Oxalate (rau bina, rau dền, củ dền, socola, trà đặc, hạt khô); duy trì calci khẩu phần bình thường (1000mg/ngày); hạn chế Natri < 1500mg để giảm thải canxi qua nước tiểu. Bổ sung Citrate tự nhiên (nước cam ngọt, chanh pha loãng) để ức chế kết tinh tinh thể.',
      status: 'Đã duyệt',
      comment: 'Hướng dẫn chuẩn Hiệp hội Tiết niệu Châu Âu & Hoa Kỳ'
    },
    {
      id: 'D3',
      title: 'Phác đồ Dinh dưỡng Lâm sàng Gout & Tăng Acid Uric (ACR 2024)',
      condition: 'Gout & Tăng Acid Uric máu',
      content: 'Thực đơn Purine thấp (< 150mg/ngày). Kiêng tuyệt đối nội tạng động vật, hải sản giàu purine (tôm, cua, cá trích, cá mòi), thịt đỏ, rượu bia và nước ngọt có gas/siro bắp cao phân tử (HFCS). Khuyến khích sữa ít béo, sữa chua men sống, thực phẩm kiềm hóa nước tiểu (bí đao, dưa leo, bắp cải) và uống đủ 2.5L nước giúp đào thải Acid Uric qua thận.',
      status: 'Đã duyệt',
      comment: 'Căn cứ Hội Thấp khớp học Hoa Kỳ (ACR Guidelines)'
    },
    {
      id: 'D4',
      title: 'Phác đồ Dinh dưỡng Viêm Loét Dạ Dày - Tá Tràng & Trào Ngược GERD (ACG 2024)',
      condition: 'Viêm dạ dày & Trào ngược GERD',
      content: 'Chế độ ăn mềm, dễ tiêu hóa, giảm áp lực lên cơ vòng thực quản dưới và niêm mạc dạ dày. Chia nhỏ 4-5 bữa/ngày, không ăn quá no hoặc để quá đói, không nằm trong vòng 2-3 giờ sau ăn. Kiêng hoàn toàn đồ chua (cam chanh chua, dưa cà muối), cay nóng (tiêu, ớt, gừng nhiều), đồ chiên rán nhiều dầu mỡ, cà phê, socola, bạc hà và nước uống có gas.',
      status: 'Đã duyệt',
      comment: 'Khuyến cáo của Hội Tiêu hóa Hoa Kỳ (ACG)'
    },
    {
      id: 'D5',
      title: 'Phác đồ Dinh dưỡng Đái tháo đường Type 2 & Hội chứng Chuyển hóa (ADA 2024)',
      condition: 'Đái tháo đường Type 2',
      content: 'Kiểm soát chỉ số đường huyết GI ≤ 50 và tải lượng đường GL thấp. Ưu tiên ngũ cốc nguyên hạt (gạo lứt, yến mạch, đậu đỗ), chất xơ hòa tan (beta-glucan), protein nạc và chất béo không bão hòa đơn (MUFA/PUFA). Không dùng đường đơn/tự do; phân bổ đều lượng carbohydrate qua các bữa ăn để tránh tăng vọt đường huyết sau ăn.',
      status: 'Đã duyệt',
      comment: 'Hiệp hội Đái tháo đường Hoa Kỳ (ADA Standards of Care)'
    },
    {
      id: 'D6',
      title: 'Phác đồ Dinh dưỡng Bệnh Gan & Rối loạn Chuyển hóa Mỡ (EASL 2024)',
      condition: 'Gan nhiễm mỡ & Bệnh lý Gan',
      content: 'Chế độ ăn bảo vệ tế bào gan: Đạm dễ tiêu hóa từ cá, thịt gia cầm nạc, đậu phụ; tăng cường rau xanh giàu chất chống oxy hóa, choline và vitamin nhóm B. Kiêng tuyệt đối rượu bia và đồ uống có cồn; hạn chế chất béo bão hòa, phủ tạng và đường fructose công nghiệp để ngăn chặn tích lũy mỡ trong gan.',
      status: 'Đã duyệt',
      comment: 'Hiệp hội Nghiên cứu Bệnh Gan Châu Âu (EASL)'
    },
    {
      id: 'D7',
      title: 'Tương tác Dược lý Warfarin, Statin, ACEi và Thực phẩm (Dược thư Quốc gia & FDA)',
      condition: 'Tim mạch, Huyết áp & Tương tác Dược lý',
      content: 'Warfarin: Giữ lượng Vitamin K ổn định mỗi ngày, tránh ăn đột biến rau lá xanh đậm (rau chân vịt, cải xoăn). Statin (Atorvastatin): Chống chỉ định dùng bưởi chùm (Grapefruit) do ức chế enzyme CYP3A4 tăng độc tính. Thuốc hạ áp ACEi (Lisinopril): Nguy cơ tăng Kali máu, tránh dùng muối ăn kiêng KCl và hạn chế thực phẩm quá giàu Kali. Chế độ DASH: Natri < 1500mg/ngày.',
      status: 'Đã duyệt',
      comment: 'Căn cứ Dược thư Quốc gia Việt Nam & FDA Drug-Food Interaction Guide'
    }
  ],
  plans: [initialPlan],
  diary: {
    [localDateIso()]: {
      'Bữa sáng': [{ foodId: 'F019', grams: 200 }],
      'Bữa trưa': [{ foodId: 'F001', grams: 160 }, { foodId: 'F004', grams: 100 }, { foodId: 'F021', grams: 150 }],
      'Bữa tối': [{ foodId: 'F002', grams: 150 }, { foodId: 'F020', grams: 110 }, { foodId: 'F011', grams: 100 }]
    }
  },
  profile: {
    dob: '1985-04-12',
    height: 168,
    weight: 70,
    activity: 1.375,
    goal: 'Bảo tồn chức năng thận & Kiểm soát đường huyết',
    allergies: 'Đậu phộng, Tôm sú',
    conditions: ['Đái tháo đường type 2'],
    medications: ['Warfarin 5mg', 'Lisinopril 10mg', 'Atorvastatin 20mg'],
    files: structuredClone(initialOCRHistory)
  },
  chat: [
    {
      from: 'b',
      text: 'Chào bác An, trợ lý CDSS đã cập nhật bệnh án sinh hóa và đơn thuốc Warfarin của bác. Bác có thể hỏi về bất kỳ thực phẩm nào trước khi ăn!'
    }
  ],
  logs: [
    { id: 'L1', user: 'system', action: 'Khởi tạo', target: 'Hồ sơ CDSS', time: new Date().toISOString() }
  ],
  aiTraces: [],
  traceSpans: [],
  workflowRuns: [],
  version: 1,
  pendingRecordDraft: null,
  session: null,
  apiKey: '',
  activeOrganAlerts: structuredClone(initialOrganAlerts),
  ocrHistory: structuredClone(initialOCRHistory)
})
