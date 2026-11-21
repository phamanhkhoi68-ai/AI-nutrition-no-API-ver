import React, { useState, useRef, useEffect, useMemo } from 'react'
import {
  Activity,
  Heart,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Zap,
  Info,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Compass,
  Target,
  FileText,
  Eye,
  EyeOff,
  AlertCircle,
  Pill,
  ChevronRight,
  Sparkles
} from 'lucide-react'
import { useS } from '../services/store'
import { cleanAndDeduplicateDiseases, formatMedicationDisplay } from '../utils/pdfExtractor'
import type { OrganId, OrganMapping, Severity, LabMetric } from '../types'

interface AnatomyProps {
  alerts?: Record<OrganId, OrganMapping>
  onSelectOrgan?: (organId: OrganId) => void
  selectedOrganId?: OrganId | null
  className?: string
}

/**
 * Full 2D Anatomical Hotspot Coordinates on the 460x460 canvas overlay.
 * Centered on human anatomical diagram (x = 230).
 */
export const COMPREHENSIVE_ORGAN_COORDS: Record<
  string,
  {
    x: number
    y: number
    name: string
    vnName: string
    side: 'left' | 'right'
    calloutY: number
  }
> = {
  brain: { x: 230, y: 42, name: 'Brain', vnName: 'Não Bộ & Thần Kinh', side: 'right', calloutY: 42 },
  eyes: { x: 230, y: 56, name: 'Eyes', vnName: 'Mắt & Thị Giác', side: 'left', calloutY: 56 },
  throat: { x: 230, y: 76, name: 'Throat', vnName: 'Tai Mũi Họng & Hầu Họng', side: 'right', calloutY: 76 },
  thyroid: { x: 230, y: 96, name: 'Thyroid', vnName: 'Tuyến Giáp & Vùng Cổ', side: 'left', calloutY: 96 },
  lungs: { x: 206, y: 126, name: 'Lungs', vnName: 'Phổi & Hệ Hô Hấp', side: 'left', calloutY: 120 },
  heart: { x: 236, y: 136, name: 'Heart', vnName: 'Hệ Tim Mạch & Đông Máu', side: 'right', calloutY: 140 },
  liver: { x: 196, y: 168, name: 'Liver', vnName: 'Gan & Chuyển Hóa', side: 'left', calloutY: 165 },
  gallbladder: { x: 198, y: 182, name: 'Gallbladder', vnName: 'Túi Mật & Đường Mật', side: 'left', calloutY: 180 },
  stomach: { x: 254, y: 168, name: 'Stomach', vnName: 'Dạ Dày & Tiêu Hóa', side: 'right', calloutY: 195 },
  pancreas: { x: 228, y: 196, name: 'Pancreas', vnName: 'Tuyến Tụy & Nội Tiết', side: 'left', calloutY: 215 },
  spleen: { x: 260, y: 186, name: 'Spleen', vnName: 'Lách & Miễn Dịch', side: 'right', calloutY: 200 },
  kidneys: { x: 206, y: 222, name: 'Kidneys', vnName: 'Thận & Lọc Máu (CKD)', side: 'left', calloutY: 235 },
  intestines: { x: 228, y: 252, name: 'Intestines', vnName: 'Đại Tràng & Hệ Tiêu Hóa', side: 'right', calloutY: 265 },
  bladder: { x: 228, y: 285, name: 'Bladder', vnName: 'Bàng Quang & Tiết Niệu', side: 'left', calloutY: 290 },
  spine: { x: 230, y: 160, name: 'Spine', vnName: 'Cột Sống & Thắt Lưng', side: 'right', calloutY: 160 },
  joints: { x: 214, y: 345, name: 'Joints', vnName: 'Hệ Xương Khớp & Chi (Gout)', side: 'right', calloutY: 345 },
  skin: { x: 172, y: 230, name: 'Skin', vnName: 'Hệ Da Liễu & Bì', side: 'left', calloutY: 230 }
}

export interface DiseasedOrganEntry {
  id: string
  name: string
  vnName: string
  x: number
  y: number
  side: 'left' | 'right'
  calloutY: number
  severity: Severity
  diseaseTitle: string
  reason: string
  metrics: LabMetric[]
  nutrientLimits: Record<string, any>
  medications: string[]
}

export const AnatomyVisualizer: React.FC<AnatomyProps> = ({
  alerts: propAlerts,
  onSelectOrgan,
  selectedOrganId: extSelected,
  className = ''
}) => {
  const s = useS()
  const alerts = propAlerts && Object.keys(propAlerts).length > 0 ? propAlerts : s.activeOrganAlerts
  const latestRecord = s.profile?.files?.[0] || s.ocrHistory?.[0]
  const hasEvaluatedData = Boolean(
    latestRecord ||
    (s.profile?.conditions?.length || 0) > 0 ||
    Object.keys(alerts || {}).length > 0
  )

  // Mode: by default ONLY display diseased organs from medical record
  const [showAllOrgans, setShowAllOrgans] = useState<boolean>(false)

  // Extract all diseased organs from active alerts and latest medical record
  const diseasedOrgans: DiseasedOrganEntry[] = useMemo(() => {
    const list: DiseasedOrganEntry[] = []
    const seen = new Set<string>()

    // Helper to get matching metrics for an organ
    const getMetricsForOrgan = (orgId: string) => {
      return (latestRecord?.metrics || []).filter(
        m => m.affectedOrgan === orgId || (!m.affectedOrgan && orgId === 'kidneys' && (m.name.includes('eGFR') || m.name.includes('Creatinine')))
      )
    }

    // Helper to get matching medications for an organ
    const getMedsForOrgan = (orgId: string) => {
      return (latestRecord?.medications || [])
        .filter(med => med.affectedOrgan === orgId)
        .map(med => formatMedicationDisplay(med.name, med.activeIngredient || med.purpose))
    }

    const cleanedRecordDiseases = cleanAndDeduplicateDiseases(latestRecord?.diseases)

    // 1. Check from active alerts in store
    if (alerts) {
      Object.entries(alerts).forEach(([orgId, mapping]) => {
        if ((mapping.severity === 'critical' || mapping.severity === 'warning') && !seen.has(orgId)) {
          seen.add(orgId)
          const coords = COMPREHENSIVE_ORGAN_COORDS[orgId] || {
            x: 230,
            y: 200,
            name: orgId,
            vnName: orgId.toUpperCase(),
            side: 'right',
            calloutY: 200
          }

          // Find exact disease name if available
          let diseaseTitle = mapping.reason.split('·')[0].split(':')[0].trim()
          if (cleanedRecordDiseases.length > 0) {
            const matchedDis = cleanedRecordDiseases.find(d => {
              const dLower = d.toLowerCase()
              if (orgId === 'kidneys' && (dLower.includes('thận') || dLower.includes('ckd') || dLower.includes('sỏi'))) return true
              if (orgId === 'pancreas' && (dLower.includes('đái tháo') || dLower.includes('tiểu đường') || dLower.includes('tụy'))) return true
              if (orgId === 'heart' && (dLower.includes('huyết áp') || dLower.includes('tim') || dLower.includes('rung nhĩ'))) return true
              if (orgId === 'joints' && (dLower.includes('gout') || dLower.includes('gút') || dLower.includes('khớp') || dLower.includes('uric'))) return true
              if (orgId === 'liver' && (dLower.includes('gan') || dLower.includes('men gan'))) return true
              if (orgId === 'stomach' && (dLower.includes('dạ dày') || dLower.includes('gerd') || dLower.includes('hang vị'))) return true
              if (orgId === 'lungs' && (dLower.includes('phổi') || dLower.includes('hô hấp') || dLower.includes('hen'))) return true
              if (orgId === 'brain' && (dLower.includes('não') || dLower.includes('đột quỵ') || dLower.includes('tiền đình'))) return true
              return false
            })
            if (matchedDis) diseaseTitle = matchedDis
          }

          list.push({
            id: orgId,
            name: coords.name,
            vnName: coords.vnName,
            x: coords.x,
            y: coords.y,
            side: coords.side,
            calloutY: coords.calloutY,
            severity: mapping.severity,
            diseaseTitle,
            reason: mapping.reason,
            metrics: getMetricsForOrgan(orgId),
            nutrientLimits: mapping.nutrient_limits || {},
            medications: getMedsForOrgan(orgId)
          })
        }
      })
    }

    // 2. Also check latestRecord.organ_mappings if not yet included
    if (latestRecord?.organ_mappings) {
      latestRecord.organ_mappings.forEach(m => {
        if ((m.severity === 'critical' || m.severity === 'warning') && !seen.has(m.organ_id)) {
          seen.add(m.organ_id)
          const coords = COMPREHENSIVE_ORGAN_COORDS[m.organ_id] || {
            x: 230,
            y: 200,
            name: m.organ_id,
            vnName: m.organ_id.toUpperCase(),
            side: 'right',
            calloutY: 200
          }

          let diseaseTitle = m.reason.split('·')[0].split(':')[0].trim()
          if (cleanedRecordDiseases.length > 0) {
            diseaseTitle = cleanedRecordDiseases[0]
          }

          list.push({
            id: m.organ_id,
            name: coords.name,
            vnName: coords.vnName,
            x: coords.x,
            y: coords.y,
            side: coords.side,
            calloutY: coords.calloutY,
            severity: m.severity,
            diseaseTitle,
            reason: m.reason,
            metrics: getMetricsForOrgan(m.organ_id),
            nutrientLimits: m.nutrient_limits || {},
            medications: getMedsForOrgan(m.organ_id)
          })
        }
      })
    }

    // Sort by severity (critical first) then by anatomical Y coordinate from top to bottom
    return list.sort((a, b) => {
      if (a.severity === 'critical' && b.severity !== 'critical') return -1
      if (b.severity === 'critical' && a.severity !== 'critical') return 1
      return a.y - b.y
    })
  }, [alerts, latestRecord])

  // Full organ list when user explicitly asks to explore the entire body
  const fullBodyOrgans: DiseasedOrganEntry[] = useMemo(() => {
    return Object.entries(COMPREHENSIVE_ORGAN_COORDS).map(([id, coords]) => {
      const activeSev = alerts?.[id]?.severity || 'normal'
      return {
        id,
        name: coords.name,
        vnName: coords.vnName,
        x: coords.x,
        y: coords.y,
        side: coords.side,
        calloutY: coords.calloutY,
        severity: activeSev,
        diseaseTitle: alerts?.[id]?.reason?.split('·')[0] || coords.vnName,
        reason: alerts?.[id]?.reason || 'Chỉ số và chức năng cơ quan trong giới hạn bình thường.',
        metrics: (latestRecord?.metrics || []).filter(m => m.affectedOrgan === id),
        nutrientLimits: alerts?.[id]?.nutrient_limits || {},
        medications: (latestRecord?.medications || []).filter(m => m.affectedOrgan === id).map(m => m.name)
      }
    })
  }, [alerts, latestRecord])

  // Active display list: ONLY diseased organs by default, empty when no diseases
  const activeDisplayList = showAllOrgans
    ? fullBodyOrgans
    : diseasedOrgans

  // Active organ selection
  const [internalSelected, setInternalSelected] = useState<string | null>(
    diseasedOrgans.length > 0 ? diseasedOrgans[0].id : 'kidneys'
  )

  const activeOrganId: string | null = (extSelected && activeDisplayList.some(o => o.id === extSelected))
    ? extSelected
    : (internalSelected && activeDisplayList.some(o => o.id === internalSelected))
    ? internalSelected
    : activeDisplayList[0]?.id || null

  const activeEntry = activeOrganId ? activeDisplayList.find(o => o.id === activeOrganId) || activeDisplayList[0] : null

  // ==================== INTERACTIVE VIEWPORT STATE (2D PAN & ZOOM) ====================
  const [zoom, setZoom] = useState<number>(1.25)
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState<boolean>(false)
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [initialPan, setInitialPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const viewportRef = useRef<HTMLDivElement>(null)

  // Select an organ instantly on hover or click without viewport shaking/jumping
  const focusOnOrgan = (id: string) => {
    setInternalSelected(id)
    if (onSelectOrgan) onSelectOrgan(id as OrganId)
  }

  // Attach non-passive wheel event listener so preventDefault() works without browser warning
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return

    const onWheelHandler = (e: WheelEvent) => {
      e.preventDefault()
      const zoomFactor = e.deltaY < 0 ? 0.15 : -0.15
      setZoom(prev => {
        const next = Math.min(Math.max(0.8, prev + zoomFactor), 3.0)
        return Number(next.toFixed(2))
      })
    }

    el.addEventListener('wheel', onWheelHandler, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheelHandler)
    }
  }, [])

  // Drag to pan
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    setIsDragging(true)
    setDragStart({ x: e.clientX, y: e.clientY })
    setInitialPan({ ...pan })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      const dx = e.clientX - dragStart.x
      const dy = e.clientY - dragStart.y
      setPan({
        x: initialPan.x + dx,
        y: initialPan.y + dy
      })
    }
  }

  const handleMouseUp = () => setIsDragging(false)
  const handleMouseLeave = () => setIsDragging(false)

  const resetView = () => {
    setZoom(1.0)
    setPan({ x: 0, y: 0 })
  }

  const getGlowColor = (sev: Severity, isSelected: boolean) => {
    if (sev === 'critical') return '#f43f5e' // Rose-500
    if (sev === 'warning') return '#f59e0b' // Amber-500
    return isSelected ? '#0d9488' : '#0284c7' // Teal / Sky
  }

  const criticalCount = diseasedOrgans.filter(o => o.severity === 'critical').length
  const warningCount = diseasedOrgans.filter(o => o.severity === 'warning').length

  return (
    <div className={`apple-liquid-glass p-4 md:p-6 ${className}`}>
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-white/70">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-xl bg-teal-50 text-teal-900">
              <Activity className="w-4 h-4" />
            </span>
            <h2 className="text-sm font-bold tracking-wide uppercase text-brand-900 flex items-center gap-2 flex-wrap">
              <span>SƠ ĐỒ ĐỊNH VỊ TỔN THƯƠNG GIẢI PHẪU & BỆNH LÝ</span>
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold ${
                diseasedOrgans.length > 0
                  ? 'bg-rose-50 text-rose-700'
                  : hasEvaluatedData
                  ? 'bg-teal-50 text-teal-900'
                  : 'bg-sky-50 text-sky-700'
              }`}>
                {diseasedOrgans.length > 0
                  ? `${diseasedOrgans.length} VỊ TRÍ TỔN THƯƠNG`
                  : hasEvaluatedData
                  ? 'ĐÃ ĐÁNH GIÁ · ỔN ĐỊNH'
                  : 'CHƯA CÓ DỮ LIỆU BỆNH ÁN'}
              </span>
            </h2>
          </div>
          <p className="text-xs text-muted mt-0.5">
            {diseasedOrgans.length > 0
              ? `AI tự động định vị ${diseasedOrgans.length} vị trí bệnh từ hồ sơ y tế tải lên, trỏ mũi tên trực tiếp và note chi tiết bệnh học bên phải màn hình`
              : hasEvaluatedData
              ? 'Không phát hiện bất thường lâm sàng · Các cơ quan trong hồ sơ đã đánh giá hiện ở giới hạn ổn định'
              : 'Chưa nạp hồ sơ xét nghiệm hoặc bệnh án · Chưa đủ dữ liệu lâm sàng để đánh giá trạng thái cơ quan'}
          </p>
        </div>

        {/* Status Counters & View Mode Toggle */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {diseasedOrgans.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full porcelain-core font-mono text-[11px]">
              {criticalCount > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 font-semibold">
                  {criticalCount} Nguy cấp
                </span>
              )}
              {warningCount > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 font-semibold">
                  {warningCount} Cảnh báo
                </span>
              )}
            </div>
          )}

          {/* Toggle between "Chỉ hiện cơ quan bị bệnh" and "Xem toàn bộ cơ thể" */}
          {diseasedOrgans.length > 0 && (
          <button
            onClick={() => setShowAllOrgans(!showAllOrgans)}
            className={`px-3.5 py-1.5 rounded-full font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
              !showAllOrgans && diseasedOrgans.length > 0
                ? 'bg-rose-50 text-rose-700 hover:bg-rose-100/80'
                : 'porcelain-core text-ink hover:bg-white'
            }`}
            title="Chuyển đổi giữa chế độ chỉ hiển thị cơ quan bị bệnh hoặc toàn bộ cơ thể"
          >
            {!showAllOrgans && diseasedOrgans.length > 0 ? (
              <>
                <Target size={13} className="text-rose-600" />
                <span>Chỉ hiện vị trí bệnh lý ({diseasedOrgans.length})</span>
              </>
            ) : (
              <>
                <Eye size={13} className="text-brand" />
                <span>Khám phá toàn bộ giải phẫu ({Object.keys(COMPREHENSIVE_ORGAN_COORDS).length})</span>
              </>
            )}
          </button>
          )}
        </div>
      </div>

      {/* Main Grid: 2D Anatomical Map (Dark Botanical Studio) + Right-Side Liquid Glass Disease Notes */}
      <div className="relative z-10 grid lg:grid-cols-[1fr_410px] gap-6 mt-5 items-start">
        {/* 2D Anatomical Interactive Viewport on Botanical Dark Studio (#081E1C) */}
        <div
          ref={viewportRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          className={`relative flex justify-center items-center py-3 min-h-[540px] select-none overflow-hidden rounded-[24px] border border-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_18px_40px_-16px_rgba(8,30,28,0.6)] ${
            isDragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          style={{
            backgroundColor: '#081E1C',
            backgroundImage:
              'radial-gradient(circle at 50% 46%, rgba(20, 184, 166, 0.24) 0%, rgba(11, 79, 74, 0.16) 40%, rgba(8, 30, 28, 0.98) 78%)'
          }}
        >
          {/* Dark Frosted Glass Zoom Controls */}
          <div className="absolute top-3 left-3 z-30 flex flex-col gap-1 bg-[#0C2926]/75 backdrop-blur-md p-1.5 rounded-full border border-white/15 shadow-lg text-white/90">
            <button
              onClick={() => setZoom(z => Math.min(3.0, Number((z + 0.25).toFixed(2))))}
              title="Phóng to (Zoom In)"
              className="p-1.5 hover:bg-white/15 text-white/80 hover:text-white rounded-full transition-colors cursor-pointer"
            >
              <ZoomIn size={15} />
            </button>
            <button
              onClick={() => setZoom(z => Math.max(0.8, Number((z - 0.25).toFixed(2))))}
              title="Thu nhỏ (Zoom Out)"
              className="p-1.5 hover:bg-white/15 text-white/80 hover:text-white rounded-full transition-colors cursor-pointer"
            >
              <ZoomOut size={15} />
            </button>
            <button
              onClick={resetView}
              title="Đặt lại góc nhìn 1:1"
              className="p-1.5 hover:bg-white/15 text-white/80 hover:text-white rounded-full transition-colors cursor-pointer"
            >
              <RotateCcw size={15} />
            </button>
            <div className="text-[10px] font-mono text-center text-[#E6C58E] font-semibold border-t border-white/15 pt-1 pb-0.5">
              {zoom}x
            </div>
          </div>

          {/* Stationary Active Organ Callout HUD (Dark Frosted Glass Capsule) */}
          {activeEntry && (
            <div className="absolute top-3 left-16 z-20 flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-[#0C2926]/75 text-white border border-white/15 shadow-lg backdrop-blur-md transition-all pointer-events-none max-w-[300px]">
              <div className="flex flex-col min-w-0">
                <span className="text-[11px] font-bold tracking-wide text-white truncate">
                  🎯 VỊ TRÍ: {activeEntry.name.toUpperCase()}
                </span>
                <span className="text-[10px] text-[#E6C58E] font-medium truncate">
                  {activeEntry.vnName.split('&')[0].trim()}
                </span>
              </div>
              <span
                className={`text-[8.5px] px-2.5 py-0.5 rounded-full font-mono font-bold uppercase shrink-0 ml-auto ${
                  activeEntry.severity === 'critical'
                    ? 'bg-rose-500/25 text-rose-200 border border-rose-400/40'
                    : activeEntry.severity === 'warning'
                    ? 'bg-amber-500/25 text-amber-200 border border-amber-400/40'
                    : 'bg-teal-500/25 text-teal-200 border border-teal-400/40'
                }`}
              >
                {activeEntry.severity === 'critical'
                  ? '🚨 NGUY CẤP'
                  : activeEntry.severity === 'warning'
                  ? '⚠️ CẢNH BÁO'
                  : '✓ ỔN ĐỊNH'}
              </span>
            </div>
          )}

          {/* Navigation Hint in Dark Frosted Glass Capsule */}
          <div className="absolute bottom-3 right-3 z-20 hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#0C2926]/75 backdrop-blur-md border border-white/15 text-[10px] font-mono text-white/75 pointer-events-none">
            <Compass size={12} className="text-[#E6C58E]" />
            <span>KÉO ĐỂ DI CHUYỂN · CUỘN ĐỂ PHÓNG TO</span>
          </div>

          {/* Unified Transform Container wrapping Body Image & SVG Hotspots */}
          <div
            className="relative w-[460px] h-[460px] max-w-full flex items-center justify-center transition-transform duration-300 ease-out"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center'
            }}
          >
            {/* Human Anatomy 2D Diagram on Subtle Luminous Studio Backdrop */}
            <img
              src="/body-3d.png"
              alt="Sơ đồ Giải phẫu Cơ thể"
              className="pointer-events-none select-none object-contain h-[448px] w-auto mx-auto rounded-[22px] bg-[#EEF5F4]/95 p-1.5"
              style={{
                filter: 'contrast(1.06) saturate(1.08) drop-shadow(0 0 28px rgba(20, 184, 166, 0.25))'
              }}
            />

            {/* SVG HUD Overlay Layer: Champagne Gold (#E6C58E) Leader Lines & Active Organ Hotspots */}
            <svg
              viewBox="0 0 460 460"
              className="absolute inset-0 w-full h-full pointer-events-none drop-shadow-[0_0_14px_rgba(230,197,142,0.35)]"
            >
              <defs>
                <radialGradient id="criticalPulse" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.85" />
                  <stop offset="60%" stopColor="#f43f5e" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#f43f5e" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="warningPulse" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#E6C58E" stopOpacity="0.85" />
                  <stop offset="60%" stopColor="#E6C58E" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="#E6C58E" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="normalPulse" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.75" />
                  <stop offset="60%" stopColor="#14b8a6" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="#14b8a6" stopOpacity="0" />
                </radialGradient>
                <filter id="glowEffect" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="2.5" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>

              {/* Render Hotspots & Champagne Gold Laser Leader Lines Pointing to the Right Side */}
              {activeDisplayList.map((organ) => {
                const isSel = activeOrganId === organ.id
                const sev = organ.severity
                const color = getGlowColor(sev, isSel)
                const champagneLine = '#E6C58E'

                // Laser leader line directing towards the right side (x: 455) where the note cards live
                const targetX = 455
                const targetY = organ.calloutY
                const elbowX = Math.max(organ.x + 35, 305)

                return (
                  <g key={'hud-' + organ.id} className="transition-all duration-300">
                    {/* Glowing pulse rings ONLY on the active organ to avoid visual noise */}
                    {isSel && (
                      <circle
                        cx={organ.x}
                        cy={organ.y}
                        r={22}
                        fill={
                          sev === 'critical'
                            ? 'url(#criticalPulse)'
                            : sev === 'warning'
                            ? 'url(#warningPulse)'
                            : 'url(#normalPulse)'
                        }
                        className="animate-pulse"
                        style={{ animationDuration: '2s' }}
                      />
                    )}

                    {/* Twin bilateral kidney representation */}
                    {organ.id === 'kidneys' && (
                      <g opacity={isSel ? 1 : 0.65}>
                        <line
                          x1={organ.x}
                          y1={organ.y}
                          x2={250}
                          y2={organ.y}
                          stroke={champagneLine}
                          strokeWidth="1.4"
                          strokeDasharray="2 2"
                        />
                        <circle
                          cx={250}
                          cy={organ.y}
                          r={isSel ? 6.5 : 4.5}
                          fill={color}
                          stroke="#E6C58E"
                          strokeWidth={isSel ? 2 : 1.2}
                          className="cursor-pointer pointer-events-auto transition-transform hover:scale-125"
                          onMouseEnter={() => focusOnOrgan('kidneys')}
                          onClick={e => {
                            e.stopPropagation()
                            focusOnOrgan('kidneys')
                          }}
                        />
                      </g>
                    )}

                    {/* Leader Line Routing in Champagne Gold (#E6C58E) */}
                    {isSel ? (
                      <g>
                        <polyline
                          points={`${organ.x},${organ.y} ${elbowX},${targetY} ${targetX},${targetY}`}
                          fill="none"
                          stroke={champagneLine}
                          strokeWidth="2.4"
                          filter="url(#glowEffect)"
                          opacity="1"
                        />
                        <polygon
                          points={`${targetX},${targetY} ${targetX - 8},${targetY - 4} ${targetX - 8},${targetY + 4}`}
                          fill={champagneLine}
                        />
                      </g>
                    ) : (
                      <g opacity="0.7">
                        <line
                          x1={organ.x}
                          y1={organ.y}
                          x2={organ.x + 18}
                          y2={organ.y}
                          stroke={champagneLine}
                          strokeWidth="1.5"
                          strokeDasharray="2 2"
                        />
                        <polygon
                          points={`${organ.x + 18},${organ.y} ${organ.x + 14},${organ.y - 2.5} ${organ.x + 14},${organ.y + 2.5}`}
                          fill={champagneLine}
                        />
                      </g>
                    )}

                    {/* Active Radar Reticle Ring in Champagne Gold */}
                    {isSel && (
                      <circle
                        cx={organ.x}
                        cy={organ.y}
                        r={15}
                        fill="none"
                        stroke={champagneLine}
                        strokeWidth="1.6"
                        strokeDasharray="3 2"
                        opacity="0.95"
                      />
                    )}

                    {/* Organ Anchor Circle */}
                    <circle
                      cx={organ.x}
                      cy={organ.y}
                      r={isSel ? 7.5 : 5}
                      fill={color}
                      stroke="#E6C58E"
                      strokeWidth={isSel ? 2.2 : 1.2}
                      className="cursor-pointer pointer-events-auto transition-transform hover:scale-125"
                      onMouseEnter={() => focusOnOrgan(organ.id)}
                      onClick={e => {
                        e.stopPropagation()
                        focusOnOrgan(organ.id)
                      }}
                    />

                    {/* Compact, Non-Overlapping Hit Area (r=13) */}
                    <circle
                      cx={organ.x}
                      cy={organ.y}
                      r={13}
                      fill="transparent"
                      className="cursor-pointer pointer-events-auto"
                      onMouseEnter={() => focusOnOrgan(organ.id)}
                      onClick={e => {
                        e.stopPropagation()
                        focusOnOrgan(organ.id)
                      }}
                    />
                  </g>
                )
              })}
            </svg>
          </div>

          {/* Bottom Left HUD Overlay Card (Dark Frosted Glass, Full Text Wrapping) */}
          {activeEntry && activeEntry.severity !== 'normal' && activeEntry.severity !== 'safe' && (
            <div className="absolute bottom-3 left-3 z-30 w-auto max-w-[320px] sm:max-w-[360px] bg-[#0C2926]/85 backdrop-blur-md p-3.5 rounded-2xl border border-white/15 shadow-xl transition-all pointer-events-none text-white">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <h4 className="text-xs font-bold text-white truncate">{activeEntry.vnName}</h4>
                <span
                  className={`text-[8.5px] px-2 py-0.5 rounded-full font-mono font-bold uppercase shrink-0 ${
                    activeEntry.severity === 'critical'
                      ? 'bg-rose-500/25 text-rose-200 border border-rose-400/40'
                      : activeEntry.severity === 'warning'
                      ? 'bg-amber-500/25 text-amber-200 border border-amber-400/40'
                      : 'bg-teal-500/25 text-teal-200 border border-teal-400/40'
                  }`}
                >
                  {activeEntry.severity === 'critical' ? '🚨 NGUY CẤP' : activeEntry.severity === 'warning' ? '⚠️ CẢNH BÁO' : '✓ ỔN ĐỊNH'}
                </span>
              </div>
              <div className="text-[10.5px] font-semibold text-[#FDE68A] bg-white/10 px-2.5 py-1 rounded-xl border border-[#E6C58E]/35 mb-1.5 flex items-start gap-1.5">
                <AlertTriangle size={12} className="shrink-0 text-[#E6C58E] mt-0.5" />
                <span className="leading-snug break-words">BỆNH LÝ: {activeEntry.diseaseTitle}</span>
              </div>
              <p className="text-[10px] text-white/80 leading-snug break-words">{activeEntry.reason}</p>
            </div>
          )}
        </div>

        {/* ==================== RIGHT SIDE: LIQUID GLASS CLINICAL DISEASE NOTES ==================== */}
        <div className="space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-white/70">
            <div className="flex items-center gap-1.5">
              <Target size={15} className="text-brand" />
              <span className="text-xs font-mono text-brand-900 font-bold uppercase tracking-wider">
                NOTE BỆNH LÝ THEO HƯỚNG MŨI TÊN ({diseasedOrgans.length})
              </span>
            </div>
            <span className="text-[10px] text-muted font-medium font-mono">TỰ ĐỘNG THEO BỆNH ÁN</span>
          </div>

          {/* List of Diseased Organs Note Cards in Apple Liquid Glass */}
          <div className="space-y-3 max-h-[570px] overflow-y-auto p-1 -m-1">
            {activeDisplayList.map((organ) => {
              const isSel = activeOrganId === organ.id
              const sev = organ.severity

              return (
                <div
                  key={organ.id}
                  onMouseEnter={() => focusOnOrgan(organ.id)}
                  onClick={() => focusOnOrgan(organ.id)}
                  className={`apple-liquid-glass !rounded-[22px] p-4 cursor-pointer transition-all ${
                    isSel
                      ? 'ring-2 ring-brand/40 shadow-lg'
                      : 'hover:ring-1 hover:ring-brand/25 text-ink'
                  }`}
                >
                  {/* Card Header: Disease Title & Pastel Severity Badge */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] font-mono font-semibold text-muted uppercase block mb-0.5">
                        {organ.vnName} ({organ.name})
                      </span>
                      <h4 className="text-sm font-semibold text-ink leading-snug break-words">
                        {organ.diseaseTitle}
                      </h4>
                    </div>

                    <span
                      className={`text-[9.5px] px-2.5 py-0.5 rounded-full font-mono font-semibold shrink-0 uppercase ${
                        sev === 'critical'
                          ? 'bg-rose-50 text-rose-700'
                          : sev === 'warning'
                          ? 'bg-amber-50 text-amber-800'
                          : 'bg-teal-50 text-teal-900'
                      }`}
                    >
                      {sev === 'critical' ? '🚨 NGUY CẤP' : sev === 'warning' ? '⚠️ CẢNH BÁO' : '✓ ỔN ĐỊNH'}
                    </span>
                  </div>

                  {/* Clinical Explanation */}
                  {organ.reason && (
                    <p className="text-xs text-muted mb-2.5 leading-relaxed break-words">
                      {organ.reason}
                    </p>
                  )}

                  {/* Specific Lab Metrics: 3-Column Mini KPI Grid (.porcelain-core + JetBrains Mono, no text cutoff) */}
                  {organ.metrics.length > 0 && (
                    <div className="mb-2.5">
                      <div className="text-[10px] font-semibold font-mono text-muted uppercase flex items-center gap-1 mb-1.5">
                        <FileText size={11} className="text-brand" />
                        <span>CHỈ SỐ XÉT NGHIỆM LIÊN KẾT:</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {organ.metrics.map((m, idx) => (
                          <div
                            key={idx}
                            className="porcelain-core p-2.5 flex flex-col justify-between gap-1 tabular-nums"
                          >
                            <span className="text-[10px] text-muted font-medium leading-tight break-words">
                              {m.name}:
                            </span>
                            <div className="font-mono text-xs font-bold leading-snug break-words">
                              <span
                                className={
                                  m.status === 'high'
                                    ? 'text-rose-700'
                                    : m.status === 'low'
                                    ? 'text-amber-800'
                                    : 'text-ink'
                                }
                              >
                                {m.value} {m.unit}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-1">
                              {m.referenceRange && (
                                <span className="text-[9px] font-mono text-muted break-words">
                                  ({m.referenceRange})
                                </span>
                              )}
                              {m.status !== 'normal' && (
                                <span
                                  className={`text-[8.5px] px-1.5 py-0.5 rounded-full font-mono font-semibold ${
                                    m.status === 'high' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'
                                  }`}
                                >
                                  {m.status === 'high' ? 'CAO' : 'GIẢM'}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Associated Medications & DDI Alerts */}
                  {organ.medications.length > 0 && (
                    <div className="bg-amber-50 rounded-2xl p-2.5 text-[10.5px] text-amber-800 mb-2 flex items-start gap-1.5">
                      <Pill size={12} className="text-amber-700 shrink-0 mt-0.5" />
                      <div className="break-words">
                        <span className="font-semibold">Thuốc điều trị: </span>
                        <span>{organ.medications.join(' · ')}</span>
                      </div>
                    </div>
                  )}

                  {/* Prescribed Nutrient Limits & Safety Constraints */}
                  {Object.keys(organ.nutrientLimits).length > 0 && (
                    <div className="porcelain-core p-2.5 text-[10.5px] text-teal-900 space-y-1">
                      <div className="font-semibold flex items-center gap-1 text-[10px] uppercase font-mono text-brand">
                        <Zap size={11} className="text-brand" /> TRẦN DINH DƯỠNG CDSS:
                      </div>
                      {Object.entries(organ.nutrientLimits).map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-2 font-mono">
                          <span className="text-muted">
                            {k === 'water_min_ml' ? 'Nước tối thiểu' :
                             k === 'sodium_max_mg' ? 'Natri tối đa' :
                             k === 'protein_g_per_kg' ? 'Đạm giới hạn' :
                             k === 'potassium_max_mg' ? 'Kali tối đa' :
                             k === 'purine_level' ? 'Mức Purine' :
                             k === 'gi_max' ? 'Chỉ số GI tối đa' :
                             k === 'avoid_oxalate' ? 'Kiêng Oxalate' : k}:
                          </span>
                          <span className="font-semibold text-brand-900 text-right">
                            {typeof v === 'boolean' ? (v ? 'Khuyến nghị kiêng' : 'Cho phép') : String(v)}
                            {k.includes('_mg') ? ' mg/ngày' : k.includes('_ml') ? ' ml/ngày' : k.includes('_kg') ? ' g/kg/ngày' : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Empty State when no diseased organs found */}
            {diseasedOrgans.length === 0 && (
              <div className={`p-5 rounded-2xl text-center space-y-2.5 ${
                hasEvaluatedData
                  ? 'bg-teal-50 text-teal-900'
                  : 'porcelain-core text-ink'
              }`}>
                {hasEvaluatedData ? (
                  <CheckCircle2 className="w-10 h-10 text-brand mx-auto" />
                ) : (
                  <Info className="w-10 h-10 text-muted mx-auto" />
                )}
                <div className={`text-sm font-semibold ${hasEvaluatedData ? 'text-brand-900' : 'text-ink'}`}>
                  {hasEvaluatedData ? 'Đã Đánh giá · Không Có Tổn thương Cơ quan' : 'Chưa Có Dữ liệu Bệnh án Được Lưu'}
                </div>
                <p className={`text-xs leading-relaxed ${hasEvaluatedData ? 'text-teal-900/80' : 'text-muted'}`}>
                  {hasEvaluatedData
                    ? 'Hồ sơ y tế đã nạp không ghi nhận cơ quan hay chỉ số nào bất thường. Không hiển thị cảnh báo bệnh lý.'
                    : 'Hồ sơ hiện tại chưa có xét nghiệm hay chẩn đoán lâm sàng nào. Hãy tải lên bệnh án (PDF/DOCX/Ảnh) hoặc áp hồ sơ mẫu để đánh giá.'}
                </p>
                <button
                  onClick={() => setShowAllOrgans(true)}
                  className="text-xs text-brand font-semibold hover:underline cursor-pointer inline-flex items-center gap-1"
                >
                  <span>Khám phá 17 cơ quan giải phẫu</span>
                  <ChevronRight size={12} />
                </button>
              </div>
            )}
          </div>

          {/* Bottom Telemetry Note */}
          <div className="porcelain-core p-3 text-[11px] text-muted flex items-start gap-2">
            <Info className="w-4 h-4 text-brand shrink-0 mt-0.5" />
            <span>
              Mỗi khi đưa bệnh án lên (Word/PDF/Ảnh), AI tự động nhận diện tất cả các cơ quan đích tổn thương, trỏ mũi tên trực tiếp và tạo ghi chú bệnh học độc lập ở cột bên phải theo đúng chiều mũi tên.
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Backward-compatible aliases
export const Anatomy3DVisualizer = AnatomyVisualizer
export default AnatomyVisualizer
