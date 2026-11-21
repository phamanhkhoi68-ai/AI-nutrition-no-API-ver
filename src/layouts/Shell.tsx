import React, { useEffect, useState } from 'react'
import GlobalMedicalIntake from '../features/intake/GlobalMedicalIntake'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import '../styles/staff-atelier.css'
import {
  Leaf,
  LogOut,
  Menu,
  Home,
  UserRound,
  Apple,
  MessageCircle,
  UtensilsCrossed,
  Settings,
  FileText,
  ScrollText,
  Users,
  Stethoscope,
  ClipboardList,
  ShieldAlert,
  ShieldCheck,
  BookOpen,
  KeyRound,
  X,
  ExternalLink,
  TrendingUp,
  Cpu,
  RotateCcw,
  Sparkles
} from 'lucide-react'
import { me, set, log, useS, reset, selectPatient } from '../services/store'
import { Toaster, Modal, Btn, inp, toast, Field } from '../components/ui'
import { getApiKey, getBaseUrl, getModelName, setApiKey, subscribeAiConfigChange, testAiConnection, type AiConnectionTestResult } from '../services/aiService'
import { getRouterHealthSnapshot, probeGatewayHealth, subscribeRouterHealth } from '../services/modelRouter'

interface NavSection {
  title: string
  items: [string, string, any][]
}

const NAV_SECTIONS: Record<string, NavSection[]> = {
  patient: [
    {
      title: 'Lâm sàng',
      items: [
        ['/', 'Tổng quan', Home],
        ['/nhat-ky-an', 'Nhật ký & Food Lens', BookOpen],
        ['/ho-so', 'Hồ sơ & Bệnh án OCR', UserRound],
        ['/thuc-don', 'Thực đơn Điều trị AI', UtensilsCrossed],
        ['/thuc-pham', 'Tra cứu Thực phẩm', Apple]
      ]
    },
    {
      title: 'Công cụ AI',
      items: [
        ['/tu-van', 'Trợ lý AI CDSS', MessageCircle],
        ['/phan-tich', 'Dự báo Xu hướng', TrendingUp]
      ]
    },
    {
      title: 'Hệ thống',
      items: [['/tai-khoan', 'Tài khoản', Settings]]
    }
  ],
  expert: [
    {
      title: 'Lâm sàng',
      items: [
        ['/', 'Tổng quan', Home],
        ['/cdss-hitl', 'Thẩm định CDSS (HITL)', ShieldAlert],
        ['/lich-su-duyet', 'Lịch sử Thẩm định', ClipboardList]
      ]
    },
    {
      title: 'Quản trị tri thức',
      items: [
        ['/tai-lieu', 'Phác đồ Y khoa (RAG)', FileText],
        ['/quy-tac', 'Quy tắc Giới hạn', ShieldCheck]
      ]
    },
    {
      title: 'Hệ thống',
      items: [
        ['/ai-ops', 'AI Control Center (MCP / Evals)', Cpu],
        ['/tai-khoan', 'Tài khoản', Settings]
      ]
    }
  ],
  admin: [
    {
      title: 'Dữ liệu & phác đồ',
      items: [
        ['/', 'Tổng quan', Home],
        ['/thuc-pham', 'Kho Thực phẩm', Apple],
        ['/benh-ly', 'Danh mục Bệnh lý', Stethoscope],
        ['/tai-lieu', 'Tài liệu Phác đồ (AI Extractor)', FileText]
      ]
    },
    {
      title: 'Quản trị hệ thống',
      items: [
        ['/nguoi-dung', 'Người dùng', Users],
        ['/nhat-ky', 'Nhật ký Kiểm toán (Audit)', ScrollText],
        ['/ai-ops', 'AI Control Center (MCP / Evals)', Cpu]
      ]
    },
    {
      title: 'Hệ thống',
      items: [['/tai-khoan', 'Tài khoản', Settings]]
    }
  ]
}

export default function Shell() {
  const s = useS()
  const user = me(s)
  const nav = useNavigate()

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)
  const [tempApiKey, setTempApiKey] = useState(getApiKey())
  const [tempBaseUrl, setTempBaseUrl] = useState(getBaseUrl())
  const [tempModel, setTempModel] = useState(getModelName())
  const [gwHealth, setGwHealth] = useState(() => getRouterHealthSnapshot())
  const [, setConfigVersion] = useState(0)
  const [testingAi, setTestingAi] = useState(false)
  const [testResult, setTestResult] = useState<AiConnectionTestResult | null>(null)

  useEffect(() => {
    const unsubHealth = subscribeRouterHealth(() => setGwHealth(getRouterHealthSnapshot()))
    const unsubCfg = subscribeAiConfigChange(() => {
      setConfigVersion(v => v + 1)
      setGwHealth(getRouterHealthSnapshot())
    })
    probeGatewayHealth().catch(() => {})
    return () => {
      unsubHealth()
      unsubCfg()
    }
  }, [])

  const activeKey = getApiKey()
  const isGatewayActive = !activeKey && gwHealth.gateway.hasServerKey
  const isAiReady = Boolean(activeKey || isGatewayActive)

  const handleSaveApiKey = () => {
    setApiKey(tempApiKey, tempBaseUrl, tempModel)
    setTestResult(null)
    probeGatewayHealth(true).catch(() => {})
    setShowApiKeyModal(false)
    toast(tempApiKey.trim() ? 'Đã lưu cấu hình AI (OpenAI/Gemini)!' : 'Đã xóa API Key trình duyệt — Tự đồng bộ Server Gateway (.env) nếu có.')
  }

  const handleTestAi = async () => {
    setApiKey(tempApiKey, tempBaseUrl, tempModel)
    setTestingAi(true)
    setTestResult(null)
    try {
      const res = await testAiConnection()
      setTestResult(res)
      toast(res.ok ? res.detail : 'Kiểm tra kết nối AI thất bại — xem chi tiết bên dưới.')
    } finally {
      setTestingAi(false)
    }
  }

  const handleLogout = async () => {
    if (typeof fetch === 'function' && typeof window !== 'undefined' && window.location?.origin?.startsWith('http')) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'same-origin'
        })
      } catch {}
    }
    set(d => {
      log(d, 'Đăng xuất', 'Phiên làm việc')
      d.session = null
    })
    nav('/')
  }

  const handleResetDemo = () => {
    if (confirm('Đặt lại toàn bộ dữ liệu demo về trạng thái ban đầu?')) {
      reset()
      toast('Đã đặt lại dữ liệu demo!')
    }
  }

  if (!user) return null

  const isStaff = user.role === 'expert' || user.role === 'admin'
  const sections = NAV_SECTIONS[user.role] || []
  const roleLabel = {
    patient: 'Bệnh nhân CDSS',
    expert: 'Bác sĩ / Chuyên gia Lâm sàng',
    admin: 'Quản trị viên Hệ thống'
  }[user.role]

  const patientAccounts = s.users.filter(account => account.role === 'patient' && account.active)
  const activePatient = s.users.find(account => account.id === s.activePatientId)

  const renderSidebarNav = () => (
    <div className="space-y-5">
      {sections.map(sec => (
        <div key={sec.title}>
          <div className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">
            {sec.title}
          </div>
          <nav className="space-y-1">
            {sec.items.map(([to, label, Icon]) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                onClick={() => setMobileMenuOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 text-xs transition-colors ${
                    isStaff ? 'staff-nav-item ' : 'rounded-xl '
                  }${
                    isActive
                      ? isStaff
                        ? 'staff-nav-item-active'
                        : 'bg-brand text-white font-semibold shadow-sm'
                      : 'text-ink hover:bg-slate-100/80 font-medium'
                  }`
                }
              >
                {Icon && <Icon size={15} className="shrink-0" />}
                <span className="truncate">{label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      ))}
    </div>
  )

  return (
    <div className={`min-h-screen flex antialiased ${isStaff ? 'staff-atelier-root' : 'bg-[#F4F7F2] text-ink'}`}>
      <Toaster />

      {/* Desktop Left Vertical Sidebar */}
      <aside
        className={`hidden lg:flex lg:flex-col w-64 shrink-0 border-r border-line sticky top-0 h-screen z-20 ${
          isStaff ? 'staff-chrome-glass' : 'bg-white'
        }`}
      >
        <div className="px-4 py-4 border-b border-line flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-brand text-white shadow-xs">
            <Leaf className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <span className="block text-sm font-display font-semibold text-brand-900 truncate">
              AI Nutrition Atelier
            </span>
            <span className="block text-[10px] font-medium text-muted truncate">{roleLabel}</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">{renderSidebarNav()}</div>

        <div className="p-3 border-t border-line space-y-2.5 bg-white/60">
          {isStaff && activePatient && (
            <div className="px-2.5 py-2 rounded-xl bg-[#E1F2EF]/70 border border-[#0B4F4A]/15 text-[11px]">
              <span className="block text-[9px] font-bold uppercase tracking-wider text-brand">
                Hồ sơ đang chọn
              </span>
              <p className="font-semibold text-ink truncate">{activePatient.name}</p>
              <span className="text-[10px] font-mono text-muted">ID: {activePatient.id}</span>
            </div>
          )}
          <div className="px-1.5 py-0.5">
            <p className="text-xs font-semibold text-ink truncate">{user.name}</p>
            <p className="text-[11px] text-muted truncate">{user.email}</p>
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={handleResetDemo}
              title="Đặt lại dữ liệu demo gốc"
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-line bg-white text-xs text-muted hover:text-brand hover:border-brand transition-colors cursor-pointer"
            >
              <RotateCcw size={13} />
              <span>Demo gốc</span>
            </button>
            <button
              type="button"
              onClick={handleLogout}
              title="Đăng xuất"
              className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-line bg-white text-xs text-rose-700 hover:bg-rose-50 hover:border-rose-200 transition-colors cursor-pointer"
            >
              <LogOut size={13} />
              <span>Thoát</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header
          className={`sticky top-0 z-30 border-b border-line px-3 sm:px-6 py-2.5 flex items-center justify-between gap-2 ${
            isStaff ? 'staff-chrome-glass' : 'bg-white/95'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              aria-label="Menu"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 rounded-xl border border-line bg-white/80 text-ink hover:bg-slate-50 cursor-pointer shrink-0"
            >
              {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
            <span className="lg:hidden text-xs sm:text-sm font-semibold text-brand-900 truncate">
              AI Nutrition Atelier
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isStaff && (
              <label className="flex items-center gap-1.5 text-xs text-muted bg-white border border-line rounded-xl px-2.5 py-1.5 shadow-2xs">
                <UserRound size={13} className="text-brand shrink-0 hidden sm:inline" />
                <span className="sr-only">Hồ sơ bệnh nhân đang xem</span>
                <select
                  aria-label="Hồ sơ bệnh nhân đang xem"
                  className="bg-transparent text-xs text-ink font-medium focus:outline-none max-w-[140px] sm:max-w-[220px] cursor-pointer"
                  value={s.activePatientId || ''}
                  onChange={event => selectPatient(event.target.value)}
                >
                  <option value="" disabled>
                    Chọn bệnh nhân
                  </option>
                  {patientAccounts.map(account => (
                    <option key={account.id} value={account.id}>
                      {account.name} ({account.email})
                    </option>
                  ))}
                </select>
              </label>
            )}

            <button
              type="button"
              onClick={() => setShowApiKeyModal(true)}
              title={isAiReady ? 'AI Engine: Đã đồng bộ hệ thống (Online)' : 'AI Engine: Chế độ cục bộ'}
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors cursor-pointer ${
                isAiReady
                  ? 'bg-teal-50 border-teal-200 text-teal-900 hover:bg-teal-100/70'
                  : 'bg-white border-line text-ink hover:bg-slate-50'
              }`}
            >
              <Sparkles size={13} className="text-brand shrink-0" />
              <span className="hidden md:inline">
                {isAiReady ? 'AI Hệ thống: Sẵn sàng' : 'AI: Cục bộ'}
              </span>
            </button>
          </div>
        </header>

        {mobileMenuOpen && (
          <div className={`lg:hidden border-b border-line px-4 py-4 space-y-4 ${isStaff ? 'staff-chrome-glass' : 'bg-white'}`}>
            {isStaff && (
              <div className="p-3 rounded-xl bg-white border border-line space-y-1.5">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-brand">
                  Chuyển Hồ sơ Bệnh nhân (Patient Context)
                </span>
                <select
                  aria-label="Chọn bệnh nhân trên di động"
                  className={inp + ' !py-1.5 text-xs'}
                  value={s.activePatientId || ''}
                  onChange={event => {
                    selectPatient(event.target.value)
                    setMobileMenuOpen(false)
                  }}
                >
                  {patientAccounts.map(account => (
                    <option key={account.id} value={account.id}>
                      {account.name} — {account.id}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {renderSidebarNav()}
            <div className="pt-3 border-t border-line flex items-center justify-between gap-2">
              <div className="text-xs min-w-0">
                <p className="font-semibold text-ink truncate">{user.name}</p>
                <p className="text-[11px] text-muted truncate">{roleLabel}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Btn v="s" onClick={handleResetDemo} className="!py-1.5 !px-2.5 text-xs">
                  Demo gốc
                </Btn>
                <Btn v="d" onClick={handleLogout} className="!py-1.5 !px-2.5 text-xs">
                  Đăng xuất
                </Btn>
              </div>
            </div>
          </div>
        )}

        <main className="shell-main flex-1 min-w-0 p-4 sm:p-6 pb-16 max-w-[1380px] w-full mx-auto">
          <Outlet />
          <GlobalMedicalIntake />
        </main>
      </div>

      <footer
        className={`fixed bottom-0 inset-x-0 z-30 border-t border-line text-muted text-[11px] text-center py-1.5 px-3 ${
          isStaff ? 'staff-chrome-glass' : 'bg-white/90'
        }`}
      >
        <b className="text-brand-900">Tuân thủ FDA Non-Device CDS (21 U.S.C. 360aaa):</b> Nền tảng chỉ hỗ trợ ra quyết định lâm sàng và dinh dưỡng, không thay thế chẩn đoán bác sĩ và tuyệt đối không tự ý điều chỉnh thuốc kê đơn.
      </footer>

      {showApiKeyModal && (
        <Modal title="Trạng thái Tích hợp AI Dinh dưỡng" onClose={() => setShowApiKeyModal(false)}>
          <div className="space-y-4 text-xs">
            <div
              className={`p-3 rounded-2xl flex items-center justify-between gap-2 ${
                isAiReady ? 'bg-teal-50 text-teal-900' : 'bg-amber-50 text-amber-800'
              }`}
            >
              <span className="font-semibold text-xs flex items-center gap-1.5">
                <Sparkles size={14} />
                {isAiReady
                  ? 'AI Nutrition Engine: ĐÃ TÍCH HỢP HỆ THỐNG (ONLINE SẴN SÀNG)'
                  : 'AI Nutrition Engine: CHẾ ĐỘ GROUNDED CLINICAL DEMO (CỤC BỘ)'}
              </span>
              <span
                className={`text-[10px] font-mono px-2.5 py-0.5 rounded-full font-semibold shrink-0 ${
                  isAiReady ? 'bg-white/90 text-teal-900' : 'bg-white/90 text-amber-800'
                }`}
              >
                {isAiReady ? 'SYSTEM AI ACTIVE' : 'LOCAL FALLBACK'}
              </span>
            </div>

            <div className="p-3.5 rounded-2xl bg-teal-50/50 text-teal-900 text-[11px] leading-relaxed flex items-start gap-2.5 border border-teal-200/50">
              <Sparkles size={15} className="shrink-0 mt-0.5 text-teal-700" />
              <div>
                <p className="font-semibold text-xs mb-1 text-teal-950">Hệ thống AI Dinh dưỡng tự động đồng bộ từ file cấu hình</p>
                <p className="text-slate-600">
                  Toàn bộ các tác vụ AI (Quét ảnh Food Lens, Lập thực đơn cá nhân hóa, Trợ lý CDSS và Dự báo xu hướng) được vận hành tự động qua API Key tích hợp sẵn của hệ thống. Bạn và bệnh nhân không cần phải nhập API Key cá nhân.
                </p>
              </div>
            </div>

            {testResult && (
              <div
                className={`p-3 rounded-2xl text-[11px] leading-relaxed ${
                  testResult.ok ? 'bg-teal-50 text-teal-900' : 'bg-rose-50 text-rose-800 border border-rose-200'
                }`}
              >
                {testResult.detail}
              </div>
            )}

            <div className="flex justify-end items-center gap-2 pt-2">
              <Btn v="s" onClick={handleTestAi} disabled={testingAi}>
                {testingAi ? 'Đang kiểm tra...' : 'Kiểm tra kết nối AI'}
              </Btn>
              <Btn onClick={() => setShowApiKeyModal(false)}>
                Đóng
              </Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
