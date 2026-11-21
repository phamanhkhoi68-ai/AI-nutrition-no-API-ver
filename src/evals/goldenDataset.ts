import type { Doc, Food, Profile, Rule } from '../types'

export const EVAL_PROFILE: Profile = {
  dob: '1965-05-15',
  height: 168,
  weight: 64,
  activity: 1.3,
  goal: 'Kiểm soát suy thận mạn & tim mạch',
  conditions: ['Suy thận mạn', 'Tăng huyết áp', 'Đái tháo đường'],
  allergies: 'Tôm, Đậu phộng',
  medications: ['Warfarin 5mg', 'Enalapril 10mg', 'Atorvastatin 20mg'],
  files: []
}

export const EVAL_FOODS: Food[] = [
  {
    id: 'EV1', name: 'Cơm gạo lứt', category: 'Tinh bột', kcal: 112, protein: 2.6, fat: 0.9, carb: 23.5,
    fiber: 1.8, sodium: 5, gi: 50, allergens: '', serving: '100g', purine: 'Thấp', potassium: 43
  },
  {
    id: 'EV2', name: 'Rau cải xoăn luộc', category: 'Rau lá đậm giàu Vitamin K', kcal: 35, protein: 2.9, fat: 0.4, carb: 4.4,
    fiber: 4.1, sodium: 23, gi: 15, allergens: '', serving: '100g', purine: 'Thấp', potassium: 299
  },
  {
    id: 'EV3', name: 'Bưởi da xanh', category: 'Trái cây', kcal: 38, protein: 0.7, fat: 0.1, carb: 9.5,
    fiber: 1.6, sodium: 1, gi: 25, allergens: '', serving: '100g', purine: 'Thấp', potassium: 135
  },
  {
    id: 'EV4', name: 'Chuối chín', category: 'Trái cây giàu Kali', kcal: 89, protein: 1.1, fat: 0.3, carb: 22.8,
    fiber: 2.6, sodium: 1, gi: 51, allergens: '', serving: '100g', purine: 'Thấp', potassium: 680
  },
  {
    id: 'EV5', name: 'Tôm sú hấp', category: 'Hải sản', kcal: 99, protein: 24, fat: 0.3, carb: 0.2,
    fiber: 0, sodium: 111, gi: 0, allergens: 'Tôm', serving: '100g', purine: 'Cao', potassium: 220
  },
  {
    id: 'EV6', name: 'Ức gà phi lê', category: 'Đạm', kcal: 165, protein: 31, fat: 3.6, carb: 0,
    fiber: 0, sodium: 74, gi: 0, allergens: '', serving: '100g', purine: 'Thấp', potassium: 250
  }
]

export const EVAL_DOCS: Doc[] = [
  {
    id: 'doc-eval-approved',
    title: 'Phác đồ Dinh dưỡng KDIGO 2024',
    condition: 'Suy thận mạn',
    content: 'Kiểm soát eGFR và hạ kali máu bằng cách luộc bỏ nước rau củ, giới hạn natri < 1500 mg/ngày và đạm 0.8 g/kg/ngày.',
    comment: 'KDIGO 2024',
    status: 'Đã duyệt'
  },
  {
    id: 'doc-eval-warfarin',
    title: 'Dược thư Warfarin & Vitamin K',
    condition: 'Tim mạch & Chống đông',
    content: 'Bệnh nhân dùng Warfarin cần duy trì ổn định Vitamin K, tránh ăn đột biến rau cải xoăn hay rau chân vịt.',
    comment: 'Dược thư QG',
    status: 'Đã duyệt'
  },
  {
    id: 'doc-eval-ada',
    title: 'Hướng dẫn Đái tháo đường ADA 2024',
    condition: 'Đái tháo đường Type 2',
    content: 'Kiểm soát HbA1c qua thực phẩm chỉ số GI thấp (≤ 50), ưu tiên gạo lứt và yến mạch giàu chất xơ hòa tan.',
    comment: 'ADA 2024',
    status: 'Đã duyệt'
  },
  {
    id: 'doc-eval-statin',
    title: 'Cảnh báo FDA Statin & Bưởi chùm',
    condition: 'Rối loạn mỡ máu',
    content: 'Atorvastatin tương tác nghiêm trọng với furanocoumarin trong bưởi chùm qua enzyme CYP3A4 gây tiêu cơ vân.',
    comment: 'FDA Drug Safety',
    status: 'Đã duyệt'
  },
  {
    id: 'doc-eval-pending',
    title: 'Tài liệu chưa thẩm định Kali cực cao',
    condition: 'Suy thận mạn',
    content: 'Khuyến nghị thử nghiệm chưa kiểm chứng cho người suy thận mạn uống nước dừa tươi 1 lít mỗi ngày.',
    comment: 'Draft Unverified',
    status: 'Chờ duyệt'
  }
]

export const EVAL_RULES: Rule[] = [
  {
    id: 'r-ckd', title: 'CKD Sodium Rule', condition: 'Suy thận mạn',
    maxSodium: 1500, maxGI: 65, avoidCategories: 'Nội tạng', reference: 'KDIGO', status: 'Đã duyệt'
  },
  {
    id: 'r-dm', title: 'DM GI Rule', condition: 'Đái tháo đường',
    maxSodium: 2000, maxGI: 50, avoidCategories: 'Đường tinh luyện', reference: 'ADA', status: 'Đã duyệt'
  },
  {
    id: 'r-htn', title: 'HTN Tight Sodium Rule', condition: 'Tăng huyết áp',
    maxSodium: 1400, maxGI: 65, avoidCategories: 'Đồ muối chua', reference: 'AHA', status: 'Đã duyệt'
  }
]
