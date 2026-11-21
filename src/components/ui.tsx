import { ReactNode, useState } from 'react'
import type { Food, EvidenceBasis } from '../types'
import { X, Sparkles, ChevronDown, ChevronUp, BookOpen, AlertCircle, ShieldCheck, ExternalLink } from 'lucide-react'

export const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <div className={`ui-card bg-white rounded-3xl border border-line p-5 md:p-6 shadow-[0_1px_2px_rgba(20,35,31,.04)] transition-all ${className}`}>{children}</div>
)

export const Btn = ({
  v = 'p',
  ...p
}: { v?: 'p' | 's' | 'd' } & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    {...p}
    className={`inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-all cursor-pointer disabled:opacity-50 ${v === 'p'
      ? 'bg-brand text-white hover:bg-brand-900 shadow-[0_6px_18px_-6px_rgba(11,79,74,0.45)]'
      : v === 'd'
        ? 'bg-rose-ink text-white hover:opacity-95 shadow-[0_6px_18px_-6px_rgba(184,51,74,0.4)]'
        : 'porcelain-core text-ink hover:bg-white shadow-[0_2px_10px_-2px_rgba(11,79,74,0.08)]'
      } ${p.className || ''}`}
  />
)

export const inp =
  'w-full rounded-2xl px-3.5 py-2.5 text-sm bg-white/85 border border-white/80 shadow-[inset_0_1px_2px_rgba(11,79,74,0.05),0_1px_3px_rgba(15,35,37,0.04)] text-ink focus:border-brand focus:bg-white focus:outline-none transition-all'

export const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="block text-sm mb-3">
    <span className="block mb-1 text-muted font-medium">{label}</span>
    {children}
  </label>
)

export const Badge = ({ t }: { t: string }) => (
  <span
    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${/Đã duyệt|Hỗ trợ|Hoạt động|APPROVED|READY|Ổn định/.test(t)
      ? 'bg-teal-50 text-teal-900'
      : /Từ chối|Khóa|Tạm|REJECTED|Nguy cấp|Cao/.test(t)
        ? 'bg-rose-50 text-rose-700'
        : /Thông tin|Đang|Chờ|INFO|PENDING/.test(t)
          ? 'bg-sky-50 text-sky-700'
          : 'bg-amber-50 text-amber-800'
      }`}
  >
    {t}
  </span>
)

export const Modal = ({
  title,
  onClose,
  children,
  maxWidthClass = ''
}: {
  title: string
  onClose: () => void
  children: ReactNode
  maxWidthClass?: string
}) => (
  <div
    className="fixed inset-0 bg-ink/35 backdrop-blur-md z-50 flex items-center justify-center p-4"
    role="dialog"
  >
    <div className={`apple-liquid-glass p-6 w-full ${maxWidthClass || 'max-w-lg'} max-h-[90vh] overflow-auto`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-base text-ink">{title}</h3>
        <button
          aria-label="Đóng"
          onClick={onClose}
          className="p-1.5 rounded-full porcelain-core text-muted hover:text-ink transition-colors cursor-pointer"
        >
          <X size={16} />
        </button>
      </div>
      {children}
    </div>
  </div>
)

let toastFn: (m: string) => void = () => { }
export const toast = (m: string) => toastFn(m)

export function Toaster() {
  const [m, setM] = useState('')
  toastFn = t => {
    setM(t)
    setTimeout(() => setM(''), 2500)
  }
  return m ? (
    <div
      role="status"
      className="fixed bottom-12 right-4 bg-brand/95 backdrop-blur-md text-white px-4 py-2.5 rounded-full shadow-lg z-50 text-xs font-medium"
    >
      {m}
    </div>
  ) : null
}

export const Disclaimer = ({ demo = true }: { demo?: boolean }) => (
  <p
    data-clinical-disclaimer=""
    className="text-xs bg-amber-50/90 text-amber-800 rounded-2xl p-3 mb-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]"
  >
    ⚠ Nền tảng chỉ hỗ trợ tham khảo dinh dưỡng, không chẩn đoán, không thay thế bác sĩ và không khuyến nghị đổi thuốc.{' '}
    {demo && 'Dữ liệu dinh dưỡng là DỮ LIỆU MẪU, chưa được kiểm chứng y khoa. '}
    Nếu có dấu hiệu khẩn cấp (khó thở, đau ngực, lú lẫn, đường huyết bất thường nặng), hãy gọi 115 hoặc đến cơ sở y tế
    ngay.
  </p>
)

type F = { k: string; l: string; t?: 'number' | 'select' | 'area'; o?: string[] }

export function Crud<T extends { id: string }>({
  title,
  rows,
  fields,
  cols,
  onSave,
  onDelete,
  extra,
  validate
}: {
  title: string
  rows: T[]
  fields: F[]
  cols: (r: T) => ReactNode[]
  onSave: (r: T, isNew: boolean) => void
  onDelete?: (r: T) => void
  extra?: (r: T) => ReactNode
  validate?: (r: any) => string
}) {
  const [q, setQ] = useState('')
  const [ed, setEd] = useState<any>(null)
  const [del, setDel] = useState<T | null>(null)
  const [err, setErr] = useState('')
  const shown = rows.filter(r => JSON.stringify(r).toLowerCase().includes(q.toLowerCase()))
  const blank = () => Object.fromEntries(fields.map(f => [f.k, f.t === 'number' ? 0 : f.o ? f.o[0] : '']))
  return (
    <Card>
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <h2 className="font-semibold text-lg mr-auto">{title}</h2>
        <input
          aria-label="Tìm kiếm"
          className={inp + ' !w-48'}
          placeholder="Tìm kiếm…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <Btn
          onClick={() => {
            setErr('')
            setEd({ ...blank(), id: '', _new: true })
          }}
        >
          Thêm mới
        </Btn>
      </div>
      <div className="porcelain-core overflow-x-auto p-2">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-left text-muted">
              {fields.slice(0, cols({} as T).length).map(f => (
                <th key={f.k} className="p-2.5 font-medium">
                  {f.l}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.id} className="border-t border-line/60">
                {cols(r).map((c, i) => (
                  <td key={i} className="p-2.5">
                    {c}
                  </td>
                ))}
                <td className="p-2.5 text-right whitespace-nowrap">
                  {extra?.(r)}
                  <Btn
                    v="s"
                    onClick={() => {
                      setErr('')
                      setEd(r)
                    }}
                  >
                    Sửa
                  </Btn>
                  {onDelete && (
                    <Btn v="s" className="ml-1" onClick={() => setDel(r)}>
                      Xóa
                    </Btn>
                  )}
                </td>
              </tr>
            ))}
            {!shown.length && (
              <tr>
                <td colSpan={9} className="p-6 text-center text-muted">
                  Chưa có dữ liệu phù hợp.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {ed && (
        <Modal title={ed._new ? 'Thêm mới' : 'Chỉnh sửa'} onClose={() => setEd(null)}>
          {fields.map(f => (
            <Field key={f.k} label={f.l}>
              {f.o ? (
                <select className={inp} value={ed[f.k]} onChange={e => setEd({ ...ed, [f.k]: e.target.value })}>
                  {f.o.map(o => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : f.t === 'area' ? (
                <textarea
                  className={inp}
                  rows={3}
                  value={ed[f.k]}
                  onChange={e => setEd({ ...ed, [f.k]: e.target.value })}
                />
              ) : (
                <input
                  className={inp}
                  type={f.t === 'number' ? 'number' : 'text'}
                  value={ed[f.k]}
                  onChange={e => setEd({ ...ed, [f.k]: f.t === 'number' ? +e.target.value : e.target.value })}
                />
              )}
            </Field>
          ))}
          {err && <p className="text-rose-700 text-sm mb-2">{err}</p>}
          <div className="flex justify-end gap-2">
            <Btn v="s" onClick={() => setEd(null)}>
              Hủy
            </Btn>
            <Btn
              onClick={() => {
                const e = validate?.(ed) || ''
                if (e) {
                  setErr(e)
                  return
                }
                const { _new, ...r } = ed
                onSave(r as T, !!_new)
                setEd(null)
                toast('Đã lưu')
              }}
            >
              Lưu
            </Btn>
          </div>
        </Modal>
      )}
      {del && (
        <Modal title="Xác nhận xóa" onClose={() => setDel(null)}>
          <p className="mb-4 text-sm">Bạn chắc chắn muốn xóa bản ghi này? Thao tác không thể hoàn tác.</p>
          <div className="flex justify-end gap-2">
            <Btn v="s" onClick={() => setDel(null)}>
              Hủy
            </Btn>
            <Btn
              v="d"
              onClick={() => {
                onDelete?.(del)
                setDel(null)
                toast('Đã xóa')
              }}
            >
              Xóa
            </Btn>
          </div>
        </Modal>
      )}
    </Card>
  )
}

export const Bar = ({
  label,
  value,
  max,
  unit = '',
  tone = 'bg-brand'
}: {
  label: string
  value: number
  max: number
  unit?: string
  tone?: string
}) => (
  <div className="mb-2 tabular-nums">
    <div className="flex justify-between text-xs mb-1">
      <span className="text-ink font-medium">{label}</span>
      <span className="font-mono text-muted">
        {Math.round(value * 10) / 10}
        {unit}
      </span>
    </div>
    <div className="h-2 rounded-full bg-cream2/90 overflow-hidden">
      <div
        className={`h-2 rounded-full transition-all ${tone}`}
        style={{ width: `${Math.min(100, max ? (value / max) * 100 : 0)}%` }}
      />
    </div>
  </div>
)

export const AiBadge = ({ t = 'Gợi ý AI' }: { t?: string }) => (
  <span
    className="inline-flex items-center gap-1 text-[11px] font-medium text-white px-2.5 py-0.5 rounded-full shadow-xs"
    style={{ background: 'linear-gradient(135deg, #0B4F4A, #0284C7)' }}
  >
    <Sparkles size={11} />
    {t}
  </span>
)

export const Gauge = ({
  value,
  max,
  unit,
  w = 'w-56'
}: {
  value: number
  max: number
  unit: string
  w?: string
}) => {
  const f = Math.min(1, max ? value / max : 0)
  const L = Math.PI * 80
  const d = 'M20 100 A80 80 0 0 1 180 100'
  return (
    <div className={`${w} tabular-nums`}>
      <svg viewBox="0 0 200 110" role="img" aria-label="Đồng hồ năng lượng">
        <path d={d} fill="none" stroke="var(--color-cream2)" strokeWidth="16" strokeLinecap="round" />
        <path
          d={d}
          fill="none"
          stroke="var(--color-brand)"
          strokeWidth="16"
          strokeLinecap="round"
          strokeDasharray={`${L * f} ${L}`}
        />
      </svg>
      <div className="-mt-9 text-center leading-tight">
        <b className="text-2xl font-display text-ink">{Math.round(value)}</b>
      </div>
      <p className="text-[11px] text-muted text-center mt-3">
        {unit} · mục tiêu {Math.round(max)}
      </p>
    </div>
  )
}

export const StackBar = ({ parts }: { parts: { label: string; value: number; tone: string }[] }) => {
  const chipTone = (tone: string) => {
    if (tone.includes('rose') || tone.includes('red')) return 'bg-rose-50 text-rose-700'
    if (tone.includes('amber') || tone.includes('terra') || tone.includes('yellow')) return 'bg-amber-50 text-amber-800'
    if (tone.includes('sky') || tone.includes('blue') || tone.includes('cyan') || tone.includes('vital'))
      return 'bg-sky-50 text-sky-700'
    return 'bg-teal-50 text-teal-900'
  }
  return (
    <div className="tabular-nums">
      <div className="flex h-3.5 rounded-full overflow-hidden bg-cream2 gap-0.5">
        {parts.map(p => (
          <div key={p.label} className={p.tone} style={{ width: `${p.value}%` }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-2 mt-2.5">
        {parts.map(p => (
          <span
            key={p.label}
            className={`inline-flex items-center text-xs font-medium rounded-full px-2.5 py-1 ${chipTone(p.tone)}`}
          >
            {p.label} {Math.round(p.value)}%
          </span>
        ))}
      </div>
    </div>
  )
}

const LV = {
  ok: ['An toàn', 'bg-teal-50 text-teal-900'],
  warn: ['Cảnh báo', 'bg-amber-50 text-amber-800'],
  out: ['Ngoài phạm vi hỗ trợ', 'bg-sky-50 text-sky-700']
} as const

export const SafetyCheck = ({ checks }: { checks: { label: string; level: 'ok' | 'warn' | 'out'; note: string }[] }) => (
  <div className="porcelain-core p-4">
    <h4 className="font-semibold mb-2 flex items-center gap-2 text-ink">
      Kiểm tra an toàn <AiBadge t="Tự động" />
    </h4>
    <ul className="divide-y divide-line/60">
      {checks.map(c => (
        <li key={c.label} className="py-2.5 flex flex-wrap items-start justify-between gap-2 text-sm">
          <div>
            <b className="font-medium text-ink">{c.label}</b>
            <p className="text-xs text-muted">{c.note}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${LV[c.level][1]}`}>{LV[c.level][0]}</span>
        </li>
      ))}
    </ul>
  </div>
)

export const NutritionLabel = ({ f, grams = 100 }: { f: Food; grams?: number }) => {
  const k = grams / 100
  const rows: [string, number, string, boolean?][] = [
    ['Chất béo', f.fat * k, 'g'],
    ['Carbohydrate', f.carb * k, 'g'],
    ['Chất xơ', f.fiber * k, 'g', true],
    ['Đạm', f.protein * k, 'g'],
    ['Natri', f.sodium * k, 'mg']
  ]
  return (
    <div className="porcelain-core p-5 text-sm max-w-xs w-full tabular-nums">
      <h4 className="font-display text-xl font-semibold border-b-4 border-brand pb-1 text-brand-900">
        Thông tin dinh dưỡng
      </h4>
      <p className="text-xs text-muted border-b border-line py-1.5">Khẩu phần {grams} g (dữ liệu mẫu)</p>
      <div className="flex justify-between items-end border-b-2 border-brand/30 py-2">
        <b className="text-ink">Năng lượng</b>
        <b className="text-2xl font-display text-brand">{Math.round(f.kcal * k)} kcal</b>
      </div>
      {rows.map(([l, v, u, sub]) => (
        <div key={l} className={`flex justify-between border-b border-line/60 py-1.5 ${sub ? 'pl-4 text-muted' : ''}`}>
          <span className={sub ? '' : 'font-medium text-ink'}>{l}</span>
          <span className="font-mono">
            {Math.round(v * 10) / 10} {u}
          </span>
        </div>
      ))}
    </div>
  )
}

export const WeekChart = ({ days, target }: { days: { label: string; value: number }[]; target: number }) => {
  const top = Math.max(target * 1.25, ...days.map(d => d.value), 1)
  return (
    <div className="tabular-nums">
      <div className="relative h-32 flex items-end">
        <div
          className="absolute inset-x-0 border-t border-dashed border-terra z-10 pointer-events-none"
          style={{ bottom: `${(target / top) * 100}%` }}
        />
        {days.map((d, i) => (
          <div key={i} title={`${Math.round(d.value)} kcal`} className="flex-1 h-full flex justify-center">
            <div className="w-8 h-full bg-cream2/90 rounded-full flex items-end overflow-hidden">
              <div
                className={`w-full rounded-full ${d.value > target * 1.05 ? 'bg-terra' : 'bg-brand'}`}
                style={{ height: `${(d.value / top) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="flex mt-1.5">
        {days.map((d, i) => (
          <span key={i} className="flex-1 text-center text-xs text-muted">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * Component ClinicalBasisAccordion (FDA Non-Device CDS & Anti-Automation Bias)
 * Displays underlying clinical practice guidelines, citations, and deterministic DDI logic upfront.
 */
export function ClinicalBasisAccordion({
  evidence,
  contraindicated = [],
  title = 'Cơ sở Y khoa Lâm sàng (FDA Non-Device CDS)'
}: {
  evidence: EvidenceBasis[]
  contraindicated?: string[]
  title?: string
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  return (
    <div className="apple-liquid-glass p-5 mb-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <BookOpen className="text-brand w-5 h-5" />
          <h3 className="font-semibold text-brand-900 text-sm md:text-base">{title}</h3>
        </div>
        <span className="text-[11px] font-mono bg-teal-50 text-teal-900 px-2.5 py-0.5 rounded-full font-medium">
          FDA Non-Device CDS · Evidence First
        </span>
      </div>

      <p className="text-xs text-muted mb-3 leading-relaxed">
        Để ngăn chặn <strong>Thiên kiến tự động hóa (Automation Bias)</strong>, cơ sở bằng chứng lâm sàng và dược lý
        học được hiển thị trước để Bác sĩ/Chuyên gia dinh dưỡng độc lập thẩm định trước khi phê duyệt khuyến nghị.
      </p>

      {contraindicated.length > 0 && (
        <div className="mb-3 p-3.5 bg-rose-50 rounded-2xl text-xs text-rose-700">
          <div className="flex items-center gap-1.5 font-bold mb-1">
            <AlertCircle size={14} /> Chống chỉ định Dược lý Tuyệt đối (Deterministic RxNorm):
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {contraindicated.map(c => (
              <span key={c} className="bg-white/90 text-rose-700 px-2.5 py-0.5 rounded-full font-medium shadow-2xs">
                ⛔ {c}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2.5">
        {evidence.map((ev, idx) => {
          const isOpen = openIndex === idx
          return (
            <div key={idx} className="porcelain-core overflow-hidden">
              <button
                type="button"
                className="w-full px-4 py-3 text-left flex items-center justify-between hover:bg-white transition-colors cursor-pointer"
                onClick={() => setOpenIndex(isOpen ? null : idx)}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <ShieldCheck size={16} className="text-brand shrink-0" />
                  <span className="text-xs md:text-sm font-semibold text-ink">{ev.guideline_name}</span>
                  {ev.pharmacology_source && (
                    <span className="text-[10px] bg-amber-50 text-amber-800 px-2 py-0.5 rounded-full font-mono font-medium">
                      {ev.pharmacology_source}
                    </span>
                  )}
                </div>
                {isOpen ? <ChevronUp size={16} className="text-muted shrink-0" /> : <ChevronDown size={16} className="text-muted shrink-0" />}
              </button>

              {isOpen && (
                <div className="px-4 pb-3.5 pt-2 text-xs text-ink/85 border-t border-line/50 bg-white/50">
                  <p className="mb-2 leading-relaxed font-sans">{ev.rationale}</p>
                  <div className="flex items-center justify-between pt-1.5 border-t border-line/40 text-[11px]">
                    <span className="text-muted">Nguồn tham chiếu lâm sàng:</span>
                    <a
                      href={ev.citation_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand hover:underline inline-flex items-center gap-1 font-medium"
                    >
                      Mở tài liệu <ExternalLink size={11} />
                    </a>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export * from '../ui'
