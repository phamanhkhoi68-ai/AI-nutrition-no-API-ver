import React, { useEffect, useMemo, useRef, useState } from 'react'
import GlobalMedicalIntake from '../features/intake/GlobalMedicalIntake'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Leaf,
  Home,
  BookOpen,
  UserRound,
  UtensilsCrossed,
  Apple,
  MessageCircle,
  TrendingUp,
  Menu,
  X,
  LogOut,
  RotateCcw,
  KeyRound,
  Sparkles,
  ExternalLink,
  FileText,
  Settings
} from 'lucide-react'
import { me, set, log, useS, reset } from '../services/store'
import { Toaster, Modal, Btn, inp, toast, Field } from '../components/ui'
import { getApiKey, getBaseUrl, getModelName, setApiKey, subscribeAiConfigChange, testAiConnection, type AiConnectionTestResult } from '../services/aiService'
import { getRouterHealthSnapshot, probeGatewayHealth, subscribeRouterHealth } from '../services/modelRouter'
import { cleanAndDeduplicateDiseases } from '../utils/pdfExtractor'

const PATIENT_TABS = [
  { to: '/', label: 'Tổng quan', fullLabel: 'Tổng quan', icon: Home },
  { to: '/nhat-ky-an', label: 'Nhật ký', fullLabel: 'Nhật ký & Food Lens', icon: BookOpen },
  { to: '/ho-so', label: 'Hồ sơ', fullLabel: 'Hồ sơ & Bệnh án OCR', icon: UserRound },
  { to: '/thuc-don', label: 'Thực đơn', fullLabel: 'Thực đơn Điều trị AI', icon: UtensilsCrossed },
  { to: '/thuc-pham', label: 'Thực phẩm', fullLabel: 'Tra cứu Thực phẩm', icon: Apple },
  { to: '/tu-van', label: 'Trợ lý AI', fullLabel: 'Trợ lý AI CDSS', icon: MessageCircle },
  { to: '/phan-tich', label: 'Xu hướng', fullLabel: 'Dự báo Xu hướng', icon: TrendingUp }
]

interface MastheadMeta {
  kicker: string
  title: string
  subtitle: string
}

const MASTHEAD_BY_PATH: Record<string, MastheadMeta> = {
  '/': {
    kicker: 'TỔNG QUAN LÂM SÀNG HÔM NAY',
    title: 'Bảng kiểm soát Dinh dưỡng & Sinh hóa',
    subtitle: 'Theo dõi cân bằng năng lượng, giới hạn an toàn đa bệnh lý và tương tác thuốc theo thời gian thực.'
  },
  '/nhat-ky-an': {
    kicker: 'THỊ GIÁC LÂM SÀNG & NHẬT KÝ',
    title: 'Nhật ký Ăn uống & AI Food Lens',
    subtitle: 'Nhận diện khẩu phần từ ảnh chụp bữa ăn và tự động cộng dồn vào bảng kiểm soát trong ngày.'
  },
  '/ho-so': {
    kicker: 'BỆNH ÁN ĐIỆN TỬ & GIẢI PHẪU',
    title: 'Hồ sơ Bệnh án OCR & Sơ đồ Giải phẫu',
    subtitle: 'Liên kết chẩn đoán ICD-10, chỉ số xét nghiệm và phác đồ thuốc trực quan theo từng cơ quan.'
  },
  '/thuc-don': {
    kicker: 'CAN THIỆP DINH DƯỠNG CÁ THỂ HÓA',
    title: 'Thực đơn Điều trị AI 7 Ngày',
    subtitle: 'Tối ưu hóa khẩu phần đa bệnh lý với công cụ tăng giảm gram trực tiếp và đổi món an toàn.'
  },
  '/thuc-don-tuan': {
    kicker: 'CAN THIỆP DINH DƯỠNG CÁ THỂ HÓA',
    title: 'Thực đơn Điều trị AI 7 Ngày',
    subtitle: 'Tối ưu hóa khẩu phần đa bệnh lý với công cụ tăng giảm gram trực tiếp và đổi món an toàn.'
  },
  '/thuc-pham': {
    kicker: 'CƠ SỞ DỮ LIỆU DINH DƯỠNG',
    title: 'Tra cứu Thực phẩm & Đánh giá AI',
    subtitle: 'Phân loại theo nhóm lâm sàng, chỉ số GI, Natri và phân tích phù hợp cho từng cá nhân.'
  },
  '/tu-van': {
    kicker: 'TRỢ LÝ QUYẾT ĐỊNH LÂM SÀNG',
    title: 'Trợ lý AI CDSS & Rào chắn An toàn',
    subtitle: 'Hội thoại bám sát bệnh án điện tử, tích hợp công cụ MCP và kiểm soát an toàn dược - dinh dưỡng.'
  },
  '/phan-tich': {
    kicker: 'TIÊN LƯỢNG & MA TRẬN KIỂM SOÁT',
    title: 'Dự báo Xu hướng & Quy tắc Lâm sàng',
    subtitle: 'Tổng hợp quy tắc bảo vệ chủ động theo hồ sơ bệnh án và lộ trình phục hồi dài hạn.'
  },
  '/tai-khoan': {
    kicker: 'TÀI KHOẢN & CẤU HÌNH',
    title: 'Thông tin Cá nhân & Kết nối AI Gateway',
    subtitle: 'Quản lý thông tin bệnh nhân và cấu hình mô hình AI cho hệ thống CDSS.'
  }
}

function getInitials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'BN'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function PatientLiquidShell() {
  const s = useS()
  const user = me(s)
  const nav = useNavigate()
  const loc = useLocation()
  const rootRef = useRef<HTMLDivElement>(null)

  const [mobileOpen, setMobileOpen] = useState(false)
  const [accountModalOpen, setAccountModalOpen] = useState(false)
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

  if (!user) return null

  const p = s.profile
  const unifiedConditions = useMemo(() => cleanAndDeduplicateDiseases([
    ...(p.conditions || []),
    ...(p.files?.[0]?.diseases || [])
  ]), [p.conditions, p.files])

  const activeFileName = useMemo(() => (
    p.files?.[0]?.name ||
    (unifiedConditions.length > 0 ? 'Ho_So_Benh_An_Lam_Sang.docx' : 'Hồ sơ khỏe mạnh (Baseline)')
  ), [p.files, unifiedConditions])

  const primaryConditionTag = useMemo(() => {
    const ckdEntry = unifiedConditions.find(c => /ckd|suy thận|bệnh thận/i.test(c))
    return ckdEntry
      ? /giai đoạn\s*4|stage\s*4|ckd\s*4/i.test(ckdEntry)
        ? 'CKD 4'
        : /giai đoạn\s*3b|stage\s*3b|ckd\s*3b/i.test(ckdEntry)
          ? 'CKD 3b'
          : /giai đoạn\s*3a|stage\s*3a|ckd\s*3a/i.test(ckdEntry)
            ? 'CKD 3a'
            : 'CKD'
      : unifiedConditions[0]
        ? unifiedConditions[0].slice(0, 18)
        : 'Khỏe mạnh'
  }, [unifiedConditions])

  const meta = MASTHEAD_BY_PATH[loc.pathname] || MASTHEAD_BY_PATH['/']
  const initials = useMemo(() => getInitials(user.name), [user.name])

  const handleSaveApiKey = () => {
    setApiKey(tempApiKey, tempBaseUrl, tempModel)
    setTestResult(null)
    probeGatewayHealth(true).catch(() => {})
    setAccountModalOpen(false)
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

  const handleResetDemo = () => {
    if (confirm('Đặt lại toàn bộ dữ liệu demo về trạng thái ban đầu?')) {
      reset()
      setAccountModalOpen(false)
      toast('Đã đặt lại dữ liệu demo!')
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
      log(d, 'Đăng xuất', 'Phiên làm việc Bệnh nhân')
      d.session = null
    })
    setAccountModalOpen(false)
    nav('/')
  }

  return (
    <div ref={rootRef} className="patient-atelier-root min-h-screen flex flex-col selection:bg-[#0B4F4A] selection:text-white">
      {/* Ambient Animated Aurora Background */}
      <div className="ambient-field" aria-hidden="true">
        <div className="aurora-orb aurora-orb-teal" />
        <div className="aurora-orb aurora-orb-cyan" />
        <div className="aurora-orb aurora-orb-champagne" />
      </div>

      <Toaster />

      {/* 1. Floating Top Liquid Glass Navigation Dock */}
      <header className="sticky top-3 z-40 px-2 sm:px-4 lg:px-6 pt-2 sm:pt-3 mb-6 sm:mb-10 no-print">
        <div className="max-w-[1400px] mx-auto liquid-dock px-3 sm:px-5 py-2.5 sm:py-3 shadow-[0_10px_30px_-12px_rgba(11,79,74,0.25)]">
          <div className="flex items-center justify-between gap-1.5 sm:gap-2.5 min-w-0">
            {/* Brand */}
            <NavLink to="/" className="flex items-center gap-2 shrink-0 pl-1 group">
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-2xl bg-gradient-to-br from-[#0B4F4A] to-[#136F68] text-white flex items-center justify-center shadow-[0_6px_16px_-6px_rgba(11,79,74,0.55)]">
                <Leaf className="w-4 h-4" />
              </div>
              <div className="leading-tight">
                <span className="block text-sm sm:text-[15px] font-serifDisplay font-semibold text-[#0B4F4A] tracking-tight whitespace-nowrap">
                  AI Nutrition
                </span>
                <span className="hidden 2xl:block text-[10px] text-[#738A87] whitespace-nowrap">
                  Hỗ trợ quyết định lâm sàng
                </span>
              </div>
            </NavLink>

            {/* Center 7 Tabs */}
            <nav
              aria-label="Điều hướng Cổng Bệnh nhân"
              className="hidden xl:flex items-center gap-1.5 2xl:gap-2 px-1.5 py-1 rounded-full bg-white/55 shadow-[inset_0_1px_2px_rgba(11,79,74,0.06)] shrink min-w-0"
            >
              {PATIENT_TABS.map(({ to, label, fullLabel, icon: Icon }) => {
                const forceMenuActive = to === '/thuc-don' && loc.pathname === '/thuc-don-tuan'
                return (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    className={({ isActive }) =>
                      `liquid-tab-btn ${isActive || forceMenuActive ? 'active' : ''}`
                    }
                  >
                    <Icon size={13} className="shrink-0" />
                    <span className="hidden 2xl:inline">{fullLabel}</span>
                    <span className="inline 2xl:hidden">{label}</span>
                  </NavLink>
                )
              })}
            </nav>

            {/* Right Patient Context Pill */}
            <div className="flex items-center gap-1.5 shrink-0 ml-auto xl:ml-0">
              <button
                type="button"
                onClick={() => setAccountModalOpen(true)}
                className="flex items-center gap-2 pl-1 pr-2.5 sm:pr-3 py-1 rounded-full porcelain-core hover:bg-white transition-all cursor-pointer text-left shrink-0 shadow-sm"
                title="Cấu hình AI Gateway, Đặt lại Demo & Đăng xuất"
              >
                <span className="w-7 h-7 rounded-full bg-gradient-to-br from-[#0B4F4A] to-[#136F68] text-white text-[11px] font-semibold flex items-center justify-center shrink-0">
                  {initials}
                </span>
                <span className="hidden xl:block leading-tight text-left">
                  <span className="block text-xs font-semibold text-[#0F2422] truncate max-w-[85px] 2xl:max-w-[120px]">
                    {user.name}
                  </span>
                  <span className="hidden 2xl:block text-[10px] text-[#475D5B] truncate max-w-[120px]">
                    Bệnh nhân CDSS • {primaryConditionTag}
                  </span>
                </span>
              </button>

              <button
                type="button"
                aria-label="Mở danh mục"
                onClick={() => setMobileOpen(!mobileOpen)}
                className="xl:hidden p-1.5 rounded-full porcelain-core text-[#0B4F4A] cursor-pointer"
              >
                {mobileOpen ? <X size={18} /> : <Menu size={18} />}
              </button>
            </div>
          </div>

          {/* Mobile / Tablet Compact Navigation Drawer */}
          {mobileOpen && (
            <nav
              aria-label="Điều hướng di động"
              className="xl:hidden mt-2.5 pt-2.5 border-t border-white/80 flex flex-wrap gap-2"
            >
              {PATIENT_TABS.map(({ to, fullLabel, icon: Icon }) => {
                const forceMenuActive = to === '/thuc-don' && loc.pathname === '/thuc-don-tuan'
                return (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      `liquid-tab-btn ${isActive || forceMenuActive ? 'active' : ''}`
                    }
                  >
                    <Icon size={14} className="shrink-0" />
                    <span>{fullLabel}</span>
                  </NavLink>
                )
              })}
            </nav>
          )}
        </div>
      </header>

      {/* 2. Dynamic Editorial Masthead */}
      <section className="relative z-10 max-w-[1360px] mx-auto w-full px-4 sm:px-6 pt-4 sm:pt-6 pb-3">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#136F68] mb-1">
              {meta.kicker}
            </p>
            <h1 className="font-serifDisplay text-[28px] sm:text-[34px] font-semibold text-[#0F2422] leading-tight tracking-tight">
              {meta.title}
            </h1>
            <p className="text-[13.5px] text-[#475D5B] mt-1 max-w-2xl">
              {meta.subtitle}
            </p>
          </div>

          <div className="shrink-0 flex items-center gap-2">
            <NavLink
              to="/ho-so"
              title={activeFileName}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-2xl porcelain-core hover:bg-white transition-all text-xs text-[#0F2422]"
            >
              <FileText size={14} className="text-[#0B4F4A] shrink-0" />
              <span className="font-mono-code text-[11px] max-w-[320px] sm:max-w-[380px] truncate">
                {activeFileName}
              </span>
            </NavLink>
          </div>
        </div>
      </section>

      {/* 3. Main Content */}
      <main className="shell-main relative z-10 flex-1 min-w-0 max-w-[1360px] mx-auto w-full px-4 sm:px-6 pt-5 pb-16">
        <Outlet />
        <GlobalMedicalIntake />
      </main>

      {/* 4. Single Slim Mandatory FDA Footer */}
      <footer className="fixed bottom-0 inset-x-0 z-40 bg-white/75 backdrop-blur-xl border-t border-white/85 text-[#475D5B] text-[11px] text-center py-1.5 px-3 shadow-[0_-4px_20px_-8px_rgba(11,79,74,0.08)]">
        <b className="text-[#0B4F4A]">Tuân thủ FDA Non-Device CDS (21 U.S.C. 360aaa):</b> Nền tảng chỉ hỗ trợ tham khảo dinh dưỡng lâm sàng, không thay thế chẩn đoán bác sĩ và không tự ý điều chỉnh thuốc kê đơn.
      </footer>

      {/* 5. Account + AI Gateway + Demo Reset + Logout Modal */}
      {accountModalOpen && (
        <Modal
          title="Tài khoản Bệnh nhân & Kết nối AI Gateway"
          onClose={() => setAccountModalOpen(false)}
        >
          <div className="space-y-4 text-xs">
            {/* Patient Session Bar */}
            <div className="p-3.5 rounded-2xl bg-[#E1F2EF]/60 border border-[#0B4F4A]/10 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-full bg-gradient-to-br from-[#0B4F4A] to-[#136F68] text-white font-semibold flex items-center justify-center">
                  {initials}
                </span>
                <div>
                  <p className="font-semibold text-[#0F2422] text-sm">{user.name}</p>
                  <p className="text-[11px] text-[#475D5B] font-mono-code">{user.email}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Btn
                  v="s"
                  onClick={() => {
                    setAccountModalOpen(false)
                    nav('/tai-khoan')
                  }}
                  className="!py-1.5 !px-3"
                >
                  <Settings size={13} /> Hồ sơ tài khoản
                </Btn>
                <Btn v="s" onClick={handleResetDemo} className="!py-1.5 !px-3">
                  <RotateCcw size={13} /> Đặt lại Demo
                </Btn>
                <Btn v="d" onClick={handleLogout} className="!py-1.5 !px-3">
                  <LogOut size={13} /> Đăng xuất
                </Btn>
              </div>
            </div>

            {/* AI System Status */}
            <div
              className={`p-3 rounded-2xl flex items-center justify-between gap-2 ${
                isAiReady ? 'bg-[#E1F2EF] text-[#0B4F4A]' : 'bg-[#FDF5E6] text-[#B88746]'
              }`}
            >
              <span className="font-semibold text-xs flex items-center gap-1.5">
                <Sparkles size={14} />
                {isAiReady
                  ? 'AI Nutrition Engine: ĐÃ TÍCH HỢP HỆ THỐNG (ONLINE SẴN SÀNG)'
                  : 'AI Nutrition Engine: CHẾ ĐỘ GROUNDED CLINICAL DEMO (CỤC BỘ)'}
              </span>
              <span className="text-[10px] font-mono-code px-2.5 py-0.5 rounded-full bg-white/90 font-semibold shrink-0">
                {isAiReady ? 'SYSTEM AI ACTIVE' : 'GROUNDED 0ms'}
              </span>
            </div>

            <div className="p-3.5 rounded-2xl bg-[#E1F2EF]/50 text-[#0B4F4A] text-[11px] leading-relaxed flex items-start gap-2.5 border border-[#0B4F4A]/10">
              <Sparkles size={15} className="shrink-0 mt-0.5 text-[#0B4F4A]" />
              <div>
                <p className="font-semibold text-xs mb-1 text-[#0F2422]">Hệ thống AI Dinh dưỡng tự động đồng bộ từ file cấu hình</p>
                <p className="text-[#475D5B]">
                  Toàn bộ các tính năng AI (Quét ảnh Food Lens, Lập thực đơn cá nhân hóa, Trợ lý CDSS và Dự báo xu hướng) được vận hành tự động qua API Key tích hợp sẵn của hệ thống. Người dùng không cần phải nhập API Key cá nhân.
                </p>
              </div>
            </div>

            {testResult && (
              <div
                className={`p-3 rounded-2xl text-[11px] leading-relaxed ${
                  testResult.ok ? 'bg-[#E1F2EF] text-[#0B4F4A]' : 'bg-rose-50 text-rose-800 border border-rose-200'
                }`}
              >
                {testResult.detail}
              </div>
            )}

            <div className="flex justify-end items-center gap-2 pt-1">
              <Btn v="s" onClick={handleTestAi} disabled={testingAi}>
                {testingAi ? 'Đang kiểm tra...' : 'Kiểm tra kết nối AI'}
              </Btn>
              <Btn onClick={() => setAccountModalOpen(false)}>
                Đóng
              </Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
