import React, { useState } from 'react'
import { useS, set, log, uid, addExtractedRule, deleteFoodSafe } from '../services/store'
import { Btn, Crud, Badge, Bar, inp, Modal, Field, toast } from '../components/ui'
import { extractRulesFromDocumentAI } from '../services/aiService'
import { filterAndDeduplicateConditions } from '../utils/pdfExtractor'
import type { Food, User, Condition, RuleExtractionResult } from '../types'
import {
  Users as UsersIcon,
  Shield,
  Apple,
  Stethoscope,
  BookOpen,
  FileText,
  Loader2,
  Quote,
  ShieldCheck,
  Activity
} from 'lucide-react'

// ==================== 0. AI DOCUMENT-TO-RULE EXTRACTOR MODAL ====================

export function DocumentRuleExtractorModal({ onClose }: { onClose: () => void }) {
  const [condition, setCondition] = useState('Suy thận mạn CKD Giai đoạn 4')
  const [docText, setDocText] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<RuleExtractionResult | null>(null)

  const PRESETS = [
    {
      label: 'KDIGO 2024 (Thận mạn CKD 4)',
      condition: 'Suy thận mạn CKD Giai đoạn 4',
      text: `Khuyến nghị KDIGO 2024 về quản lý bệnh thận mạn (CKD stages 3-5 không lọc máu):
Khuyến nghị duy trì lượng muối Natri < 1,500 mg/ngày (tương đương < 3.75g muối ăn NaCl) để kiểm soát huyết áp và giảm tải áp lực lọc cầu thận. Lượng protein hàng ngày nên được kiểm soát nghiêm ngặt ở mức 0.6 - 0.8 g/kg trọng lượng cơ thể/ngày. Tránh các thực phẩm chế biến sẵn giàu phụ gia phốt phát vô cơ và muối kali. Nghiêm cấm sử dụng các loại rau quả giàu Vitamin K thất thường nếu bệnh nhân đang dùng thuốc chống đông Warfarin.`
    },
    {
      label: 'ADA 2024 (Đái tháo đường Type 2)',
      condition: 'Đái tháo đường type 2',
      text: `Tiêu chuẩn Chăm sóc Y tế ADA 2024:
Bệnh nhân đái tháo đường cần ưu tiên carbohydrate phức hợp có chỉ số đường huyết thấp GI < 55. Hạn chế tối đa đường đơn, siro ngô fructose cao và thực phẩm siêu chế biến. Lượng chất xơ tối thiểu đạt 25-30g/ngày. Kiểm soát Natri < 1,800 mg/ngày để phòng ngừa biến chứng tim mạch và bệnh thận đái tháo đường.`
    },
    {
      label: 'ACR 2020 (Gout & Axit Uric)',
      condition: 'Gout cấp & mạn tính',
      text: `Hướng dẫn Hội Thấp khớp học Hoa Kỳ ACR 2020:
Hạn chế tối đa thực phẩm chứa hàm lượng purine cao (> 150 mg/100g) bao gồm nội tạng động vật, thịt đỏ, hải sản có vỏ và nước hầm xương đậm đặc. Tuyệt đối kiêng rượu bia và đồ uống ngọt chứa hàm lượng fructose cao nhằm duy trì nồng độ acid uric huyết thanh an toàn < 420 µmol/L.`
    }
  ]

  const handleExtract = async () => {
    if (!docText.trim()) {
      return toast('Vui lòng nhập hoặc chọn văn bản hướng dẫn y khoa!')
    }
    setLoading(true)
    try {
      const res = await extractRulesFromDocumentAI(docText, condition)
      setResult(res)
      toast('Đã trích xuất quy tắc thành công từ tài liệu!')
    } catch (e: any) {
      toast('Lỗi trích xuất: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = () => {
    if (!result) return
    const err = addExtractedRule({
      title: result.title,
      condition: result.condition,
      maxSodium: result.maxSodium,
      maxGI: result.maxGI,
      avoidCategories: result.avoidCategories,
      reference: result.reference,
      evidence_quote: result.evidence_quote
    })
    if (err) {
      toast(err)
      return
    }
    toast('Đã lưu quy tắc mới (Trạng thái: Chờ duyệt)! Chuyển tiếp tới Chuyên gia thẩm định.')
    onClose()
  }

  return (
    <Modal title="AI Trích xuất Quy tắc Dinh dưỡng Lâm sàng từ Tài liệu" onClose={onClose}>
      <div className="space-y-4 text-xs">
        <div>
          <span className="font-semibold text-ink block mb-1">Mẫu phác đồ y khoa chuẩn:</span>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map(p => (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  setCondition(p.condition)
                  setDocText(p.text)
                }}
                className="px-2.5 py-1 rounded-xl bg-teal-50 border border-teal-200 text-brand text-[11px] font-medium hover:bg-teal-100 transition-colors cursor-pointer"
              >
                + {p.label}
              </button>
            ))}
          </div>
        </div>

        <Field label="Bệnh lý mục tiêu áp dụng:">
          <input
            className={inp}
            value={condition}
            onChange={e => setCondition(e.target.value)}
            placeholder="Ví dụ: Suy thận mạn CKD 4, Đái tháo đường..."
          />
        </Field>

        <Field label="Văn bản Phác đồ / Hướng dẫn Y khoa:">
          <textarea
            className={inp}
            rows={4}
            value={docText}
            onChange={e => setDocText(e.target.value)}
            placeholder="Dán nội dung hướng dẫn điều trị hoặc khuyến nghị lâm sàng tại đây..."
          />
        </Field>

        <div className="flex justify-end">
          <Btn disabled={loading} onClick={handleExtract} className="inline-flex items-center gap-1.5">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
            <span>{loading ? 'AI đang bóc tách quy tắc...' : 'Bắt đầu Trích xuất AI'}</span>
          </Btn>
        </div>

        {result && (
          <div className="p-4 rounded-2xl bg-teal-50/50 border-2 border-brand/40 space-y-3 mt-3">
            <div className="flex items-center justify-between pb-2 border-b border-brand/20">
              <span className="font-bold text-sm text-brand">{result.title}</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-amber-100 text-amber-900 border border-amber-300">
                CHỜ CHUYÊN GIA DUYỆT
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div><b>Bệnh lý:</b> {result.condition}</div>
              <div><b>Natri tối đa:</b> {result.maxSodium} mg/ngày</div>
              <div><b>GI tối đa:</b> {result.maxGI}</div>
              <div><b>Tài liệu:</b> {result.reference}</div>
            </div>

            <div className="p-2.5 rounded-xl bg-white border border-line text-[11px]">
              <b>Nhóm thực phẩm cấm kỵ / cảnh báo:</b>
              <p className="text-rose-700 mt-0.5">{result.avoidCategories}</p>
            </div>

            {result.evidence_quote && (
              <div className="p-2.5 rounded-xl bg-white border border-teal-200 text-[11px] text-muted italic">
                <Quote className="w-3.5 h-3.5 text-brand inline mr-1" />
                "{result.evidence_quote}"
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Btn v="s" onClick={() => setResult(null)}>Hủy bỏ</Btn>
              <Btn onClick={handleSave} className="bg-emerald-700 hover:bg-emerald-800">
                Lưu vào Danh mục Quy tắc (Chờ duyệt)
              </Btn>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ==================== 1. ADMIN DASHBOARD ====================

export function Dashboard() {
  const s = useS()
  const [showExtractor, setShowExtractor] = useState(false)
  const activePatient = s.users.find(u => u.id === s.activePatientId)

  const kpiCards: Array<{ label: string; count: number; scope: string; icon: any }> = [
    { label: 'Tổng người dùng', count: s.users.length, scope: 'Danh mục tài khoản', icon: UsersIcon },
    { label: 'Bệnh nhân', count: s.users.filter(u => u.role === 'patient').length, scope: 'Danh mục tài khoản', icon: UsersIcon },
    { label: 'Chuyên gia / BS', count: s.users.filter(u => u.role === 'expert').length, scope: 'Danh mục tài khoản', icon: Shield },
    { label: 'Món ăn / TP', count: s.foods.length, scope: 'Kho thực phẩm', icon: Apple },
    { label: 'Tài liệu phác đồ', count: s.docs.length, scope: 'Kho tri thức', icon: BookOpen },
    { label: 'Bệnh lý hỗ trợ', count: filterAndDeduplicateConditions(s.conditions).length, scope: 'Danh mục bệnh lý', icon: Stethoscope }
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="staff-kicker">Quản trị Dữ liệu & Danh mục</span>
          <h1 className="staff-section-title text-2xl font-semibold mt-0.5">
            Tổng quan Quản trị Hệ thống CDSS
          </h1>
          <p className="text-xs text-muted mt-0.5">
            Quản lý danh mục tài khoản, kho thực phẩm, bệnh lý, phác đồ và nhật ký phiên làm việc cục bộ.
          </p>
        </div>
        <Btn onClick={() => setShowExtractor(true)} className="inline-flex items-center gap-1.5 shadow-sm">
          <FileText className="w-4 h-4" /> AI Trích xuất Quy tắc CDSS
        </Btn>
      </div>

      {/* AI Document-to-Rule Extractor Callout */}
      <div className="staff-surface border-[#0B4F4A]/25 bg-[#E1F2EF]/45 p-5">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand text-white flex items-center justify-center shrink-0 shadow-xs">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-bold text-base text-ink">
                  AI Trích xuất Quy tắc Dinh dưỡng từ Hướng dẫn Lâm sàng (Document-to-Rule)
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] staff-num font-semibold bg-white text-brand border border-[#0B4F4A]/20">
                  SỐ HÓA PHÁC ĐỒ
                </span>
              </div>
              <p className="text-xs text-muted mt-1 leading-relaxed">
                Tự động số hóa phác đồ điều trị KDIGO, ADA, AHA thành các quy tắc tính toán: Ngưỡng Natri, Chỉ số GI, Danh mục cấm kỵ và trích dẫn bằng chứng gốc (Evidence Basis).
              </p>
            </div>
          </div>
          <Btn onClick={() => setShowExtractor(true)} className="shrink-0 inline-flex items-center gap-1.5 shadow-sm">
            <FileText className="w-4 h-4" /> Trích xuất Ngay
          </Btn>
        </div>
      </div>

      {showExtractor && <DocumentRuleExtractorModal onClose={() => setShowExtractor(false)} />}

      {/* Bento KPI Grid with explicit data scope */}
      <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
        {kpiCards.map(item => {
          const Icon = item.icon
          return (
            <div key={item.label} className="staff-bento-card flex flex-col justify-between gap-2">
              <div className="flex items-center justify-between gap-1">
                <span className="text-muted text-xs font-medium">{item.label}</span>
                <Icon className="w-4 h-4 text-brand shrink-0" />
              </div>
              <div>
                <p className="text-2xl font-bold staff-num text-ink">{item.count}</p>
                <span className="text-[10px] text-muted block mt-0.5">{item.scope}</span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <div className="staff-surface p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm text-ink">Phân bố Thực phẩm theo Nhóm</h3>
            <span className="text-[10px] text-muted">Kho thực phẩm hiện tại</span>
          </div>
          {[...new Set(s.foods.map(f => f.category))].map(cat => (
            <Bar
              key={cat}
              label={cat}
              value={s.foods.filter(f => f.category === cat).length}
              max={s.foods.length || 1}
            />
          ))}
        </div>

        <div className="staff-surface p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm text-ink">Trạng thái Bệnh lý Lâm sàng</h3>
            <span className="text-[10px] text-muted">Danh mục bệnh lý</span>
          </div>
          {['Hỗ trợ', 'Chưa cấu hình', 'Tạm ngưng'].map(st => (
            <Bar
              key={st}
              label={st}
              value={s.conditions.filter(x => x.status === st).length}
              max={s.conditions.length || 1}
              tone={st === 'Hỗ trợ' ? 'bg-emerald-600' : st === 'Tạm ngưng' ? 'bg-rose-600' : 'bg-amber-500'}
            />
          ))}
        </div>
      </div>

      <div className="staff-surface p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold text-sm text-ink">Nhật ký Kiểm toán Gần nhất (Audit Trail)</h3>
            <p className="text-[11px] text-muted">
              Nhật ký thao tác lưu cục bộ (không phải kho kiểm toán tập trung nhiều thiết bị).
            </p>
          </div>
          <span className="staff-scope-chip">
            Hồ sơ đang chọn (Patient context): {activePatient?.name || 'N/A'} ({s.activePatientId || 'N/A'})
          </span>
        </div>
        <div className="divide-y divide-line text-xs">
          {s.logs.slice(0, 8).map(l => (
            <div key={l.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-semibold text-ink">{l.user}</span>
                <span className="text-muted ml-2">
                  {l.action}: <b>{l.target}</b>
                </span>
              </div>
              <span className="text-muted text-[11px] staff-num">
                {new Date(l.time).toLocaleTimeString('vi-VN')} {new Date(l.time).toLocaleDateString('vi-VN')}
              </span>
            </div>
          ))}
          {s.logs.length === 0 && (
            <p className="py-4 text-center text-muted">Chưa có thao tác kiểm toán nào trong hồ sơ hiện tại.</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ==================== 2. USER MANAGEMENT ====================

export function Users() {
  const s = useS()
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="staff-kicker">Quản trị Tài khoản</span>
          <h1 className="staff-section-title text-2xl font-semibold mt-0.5">Quản trị Người dùng & Phân quyền</h1>
          <p className="text-xs text-muted mt-0.5">
            Quản lý tài khoản Bệnh nhân (Patient), Chuyên gia (Expert), và Quản trị viên (Admin).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Lọc theo vai trò"
            className={inp + ' !w-36 text-xs'}
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
          >
            <option value="">Mọi vai trò</option>
            <option value="patient">patient</option>
            <option value="expert">expert</option>
            <option value="admin">admin</option>
          </select>
          <select
            aria-label="Lọc theo trạng thái"
            className={inp + ' !w-36 text-xs'}
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            <option value="">Mọi trạng thái</option>
            <option value="1">Hoạt động</option>
            <option value="0">Khóa</option>
          </select>
        </div>
      </div>

      <div className="staff-surface p-1">
        <Crud<User>
          title="Danh sách Tài khoản"
          rows={s.users.filter(
            u => (!roleFilter || u.role === roleFilter) && (!statusFilter || String(+u.active) === statusFilter)
          )}
          fields={[
            { k: 'name', l: 'Họ và tên' },
            { k: 'email', l: 'Địa chỉ Email' },
            { k: 'role', l: 'Vai trò', o: ['patient', 'expert', 'admin'] },
            { k: 'password', l: 'Mật khẩu' }
          ]}
          cols={r => [r.name, r.email, r.role, <Badge t={r.active ? 'Hoạt động' : 'Khóa'} />]}
          validate={r =>
            !/^\S+@\S+\.\S+$/.test(r.email)
              ? 'Email không hợp lệ.'
              : r.password.length < 6
              ? 'Mật khẩu tối thiểu 6 ký tự.'
              : ''
          }
          onSave={(r, isNew) =>
            set(d => {
              if (isNew) d.users.push({ ...r, id: uid(), active: true })
              else d.users[d.users.findIndex(x => x.id === r.id)] = r
              log(d, isNew ? 'Tạo người dùng' : 'Sửa người dùng', r.email)
            })
          }
          extra={r => (
            <Btn
              v="s"
              className="mr-1 text-xs"
              onClick={() =>
                set(d => {
                  const u = d.users.find(x => x.id === r.id)!
                  u.active = !u.active
                  if (!u.active && d.session === u.id) d.session = null
                  log(d, u.active ? 'Kích hoạt tài khoản' : 'Khóa tài khoản', u.email)
                })
              }
            >
              {r.active ? 'Khóa' : 'Mở khóa'}
            </Btn>
          )}
        />
      </div>
    </div>
  )
}

// ==================== 3. FOODS MANAGEMENT ====================

export function FoodsAdmin() {
  const s = useS()
  const numField = (k: string, l: string) => ({ k, l, t: 'number' as const })

  return (
    <div className="space-y-4">
      <div>
        <span className="staff-kicker">Kho Dữ liệu Dinh dưỡng</span>
        <h1 className="staff-section-title text-2xl font-semibold mt-0.5">Quản lý Cơ sở Dữ liệu Thực phẩm</h1>
        <p className="text-xs text-muted mt-0.5">
          Cấu hình định lượng calo, đa lượng, vi chất, chỉ số GI và mức phân loại Purine.
        </p>
      </div>

      <div className="staff-surface p-1">
        <Crud<Food>
          title="Danh mục Thực phẩm"
          rows={s.foods}
          fields={[
            { k: 'name', l: 'Tên thực phẩm / Món ăn' },
            { k: 'category', l: 'Nhóm' },
            numField('kcal', 'Năng lượng (kcal/100g)'),
            numField('protein', 'Đạm (g)'),
            numField('fat', 'Chất béo (g)'),
            numField('carb', 'Carb (g)'),
            numField('fiber', 'Chất xơ (g)'),
            numField('sodium', 'Natri (mg)'),
            numField('gi', 'Chỉ số GI'),
            { k: 'allergens', l: 'Chất gây dị ứng' },
            { k: 'serving', l: 'Khẩu phần' },
            { k: 'purine', l: 'Mức Purine', o: ['Thấp', 'Vừa', 'Cao'] },
            numField('potassium', 'Kali (mg)')
          ]}
          cols={r => [r.name, r.category, `${r.kcal} kcal`, `${r.protein} g · Na ${r.sodium}mg`]}
          validate={r => {
            if (!r.name?.trim()) return 'Vui lòng nhập tên món ăn'
            if ([r.kcal, r.protein, r.fat, r.carb, r.fiber, r.sodium, r.gi, r.potassium].some(v => Number(v) < 0)) {
              return 'Các chỉ số dinh dưỡng không được là số âm.'
            }
            if (Number(r.gi) > 120) return 'Chỉ số GI không hợp lệ (> 120).'
            return ''
          }}
          onSave={(r, isNew) =>
            set(d => {
              if (isNew) d.foods.push({ ...r, id: 'F' + uid() })
              else d.foods[d.foods.findIndex(x => x.id === r.id)] = r
              log(d, isNew ? 'Thêm thực phẩm' : 'Sửa thực phẩm', r.name)
            })
          }
          onDelete={r => deleteFoodSafe(r.id)}
        />
      </div>
    </div>
  )
}

// ==================== 4. CONDITIONS & AUDIT LOGS ====================

export function Conditions() {
  const s = useS()

  return (
    <div className="space-y-4">
      <div>
        <span className="staff-kicker">Phân loại Lâm sàng</span>
        <h1 className="staff-section-title text-2xl font-semibold mt-0.5">Danh mục Bệnh lý Hỗ trợ</h1>
        <p className="text-xs text-muted mt-0.5">
          Khai báo các bệnh lý mạn tính và kích hoạt quy tắc bảo vệ an toàn sinh học.
        </p>
      </div>

      <div className="staff-surface p-1">
        <Crud<Condition>
          title="Bệnh lý Lâm sàng"
          rows={filterAndDeduplicateConditions(s.conditions)}
          fields={[
            { k: 'name', l: 'Tên bệnh lý' },
            { k: 'status', l: 'Trạng thái', o: ['Hỗ trợ', 'Chưa cấu hình', 'Tạm ngưng'] }
          ]}
          cols={r => [r.name, <Badge t={r.status} />]}
          validate={r => (!r.name ? 'Vui lòng nhập tên bệnh lý' : '')}
          onSave={(r, isNew) =>
            set(d => {
              if (isNew) d.conditions.push({ ...r, id: uid() })
              else d.conditions[d.conditions.findIndex(x => x.id === r.id)] = r
              log(d, isNew ? 'Tạo bệnh lý' : 'Sửa bệnh lý', r.name)
            })
          }
          onDelete={r =>
            set(d => {
              d.conditions = d.conditions.filter(x => x.id !== r.id)
              log(d, 'Xóa bệnh lý', r.name)
            })
          }
        />
      </div>
    </div>
  )
}

export function Logs() {
  const s = useS()
  const traces = s.aiTraces || []
  const workflowRuns = s.workflowRuns || []
  const activePatient = s.users.find(u => u.id === s.activePatientId)

  return (
    <div className="space-y-6">
      <div className="staff-context-banner px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Activity className="w-4 h-4 text-brand shrink-0" />
          <div className="text-xs">
            <span className="font-bold text-ink">Phạm vi dữ liệu nhật ký & telemetry: </span>
            <span className="font-semibold text-brand">Hồ sơ đang chọn (Patient context)</span>
            <span className="text-muted ml-1.5">
              — {activePatient?.name || 'Bệnh nhân'} (ID: {s.activePatientId || 'N/A'})
            </span>
          </div>
        </div>
        <span className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-ink staff-num border border-line">
          {traces.length} traces · {workflowRuns.length} workflow runs
        </span>
      </div>

      <div className="staff-surface p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="font-semibold text-lg text-ink">AI Observability & Telemetry (Traces)</h1>
            <p className="text-xs text-muted">
              Theo dõi độ trễ, token ước tính, truy vết RAG/MCP, trạng thái fallback/blocked và lỗi gọi model cho Hồ sơ đang chọn (Patient context).
            </p>
          </div>
          <span className="staff-scope-chip">
            Patient context: {s.activePatientId || 'N/A'}
          </span>
        </div>

        {workflowRuns.length > 0 && (
          <div className="p-3.5 rounded-2xl bg-[#F7FAFB] border border-line space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold text-ink">Workflow Agent Executions (Hồ sơ đang chọn)</h2>
              <span className="text-[10px] staff-num text-muted">{workflowRuns.length} lần chạy</span>
            </div>
            <div className="space-y-1.5">
              {workflowRuns.slice(0, 5).map(wf => (
                <div key={wf.id} className="text-[11px] bg-white p-2.5 rounded-xl border border-line flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="staff-num font-semibold text-ink">{wf.workflowName}</span>
                    <span className="text-muted ml-2">({wf.steps.map(st => `${st.name}:${st.status}`).join(' -> ')})</span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full font-semibold ${
                      wf.status === 'COMPLETED'
                        ? 'bg-emerald-50 text-emerald-700'
                        : wf.status === 'PAUSED_HITL'
                        ? 'bg-amber-50 text-amber-800'
                        : 'bg-rose-50 text-rose-700'
                    }`}
                  >
                    {wf.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="staff-table-wrap">
          <div className="overflow-x-auto">
            <table className="text-xs">
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>Tác vụ AI</th>
                  <th>Model</th>
                  <th>Trạng thái</th>
                  <th>Độ trễ</th>
                  <th>Tokens (In/Out)</th>
                  <th>RAG / Cache</th>
                  <th>Ghi chú lỗi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {traces.map(t => (
                  <tr key={t.id}>
                    <td className="p-2.5 staff-num text-muted">{new Date(t.time).toLocaleString('vi-VN')}</td>
                    <td className="p-2.5 font-semibold text-ink">{t.operation}</td>
                    <td className="p-2.5 staff-num text-[11px] text-muted">{t.model}</td>
                    <td className="p-2.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                          t.status === 'success'
                            ? 'bg-emerald-50 text-emerald-700'
                            : t.status === 'fallback'
                            ? 'bg-amber-50 text-amber-800'
                            : 'bg-rose-50 text-rose-700'
                        }`}
                      >
                        {t.status}
                      </span>
                    </td>
                    <td className="p-2.5 staff-num text-ink">{t.durationMs} ms</td>
                    <td className="p-2.5 staff-num text-muted">{t.promptTokensEst} / {t.completionTokensEst}</td>
                    <td className="p-2.5 text-[11px] text-muted">
                      {t.cacheHit ? 'CACHE' : t.ragDocIds.length ? `RAG:${t.ragDocIds.join(',')}` : '—'}
                    </td>
                    <td className="p-2.5 text-[11px] text-rose-700">{t.errorReason || '—'}</td>
                  </tr>
                ))}
                {traces.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-5 text-center text-muted">
                      Chưa có AI trace nào trong hồ sơ đang chọn.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="staff-surface p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-lg text-ink">Nhật ký Kiểm toán Phiên (Audit Trail · Hồ sơ đang chọn)</h2>
          <span className="text-[11px] staff-num text-muted">{s.logs.length} bản ghi</span>
        </div>
        <div className="staff-table-wrap">
          <div className="overflow-x-auto">
            <table className="text-xs">
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>Người dùng</th>
                  <th>Hành động</th>
                  <th>Đối tượng can thiệp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {s.logs.map(l => (
                  <tr key={l.id}>
                    <td className="p-2.5 staff-num text-muted">{new Date(l.time).toLocaleString('vi-VN')}</td>
                    <td className="p-2.5 font-semibold text-ink">{l.user}</td>
                    <td className="p-2.5 text-brand font-medium">{l.action}</td>
                    <td className="p-2.5 text-ink">{l.target}</td>
                  </tr>
                ))}
                {s.logs.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-5 text-center text-muted">
                      Chưa có nhật ký kiểm toán nào trong hồ sơ đang chọn.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
