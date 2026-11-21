import React, { useMemo, useRef, useState } from 'react'
import {
  Camera,
  Upload,
  Sparkles,
  ScanLine,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Pencil,
  Loader2,
  Utensils,
  RefreshCw
} from 'lucide-react'
import {
  useS,
  set,
  log,
  uid,
  logFoodScanToDiary,
  rebalanceRemainingMeals,
  syncDailyNutrientAlerts,
  setSelectedDiaryDate
} from '../services/store'
import { CalendarDateStrip, formatVietnameseDate } from '../components/CalendarDateStrip'
import { analyzeFoodLabelOrMenu, rebalanceDailyMealsAI, getApiKey } from '../services/aiService'
import { getRouterHealthSnapshot, setGatewayAuthStatus } from '../services/modelRouter'
import {
  calc,
  localDateIso,
  SLOTS,
  safety,
  evaluateDrugDietInteractions,
  approvedNutritionLimits,
  deriveClinicalCeilings,
  tdee,
  nutritionProfileIssue
} from '../utils/nutrition'
import { compressImageFile } from '../utils/imageUtils'
import { Btn, Modal, Field, inp, toast } from '../components/ui'
import type { Food, FoodScanResult, Item, Slot } from '../types'

interface QuickSamplePreset {
  id: string
  label: string
  tag: string
  tagStyle: string
  gi: number
  scan: FoodScanResult
}

const CLINICAL_FOOD_SAMPLES: QuickSamplePreset[] = [
  {
    id: 'sample-salmon-brown-rice',
    label: 'Cơm gạo lứt cá hồi',
    tag: 'An toàn',
    tagStyle: 'bg-[#E1F2EF] text-[#0B4F4A] border-[#0B4F4A]/20',
    gi: 50,
    scan: {
      dish_name: 'Cơm gạo lứt cá hồi áp chảo & bông cải xanh',
      estimated_weight_g: 340,
      scan_type: 'meal',
      ingredients: [
        { name: 'Cơm gạo lứt nấu chín', weight_g: 130 },
        { name: 'Cá hồi phi lê áp chảo ít muối', weight_g: 110 },
        { name: 'Bông cải xanh & cà rốt hấp', weight_g: 100 }
      ],
      macros: { kcal: 460, protein: 34, carb: 42, fat: 16 },
      micros: { sodium_mg: 240, potassium_mg: 420, purine: 'Vừa', sugar_g: 2 },
      suitability: 'SAFE',
      suitability_reason:
        'Chỉ số đường huyết thấp (GI ~50), lượng Natri thấp (240mg) và giàu Omega-3 phù hợp cho bảo vệ tim mạch, đường huyết và chức năng thận.',
      cooking_tips: ['Ưu tiên hấp hoặc áp chảo không thêm nước mắm mặn', 'Giữ phần cá vừa phải nếu đang hạn chế đạm nghiêm ngặt (CKD).']
    }
  },
  {
    id: 'sample-pho-bo',
    label: 'Phở bò tái chín',
    tag: 'Lưu ý',
    tagStyle: 'bg-[#FDF5E6] text-[#B88746] border-[#B88746]/25',
    gi: 62,
    scan: {
      dish_name: 'Phở bò tái chín truyền thống (1 tô)',
      estimated_weight_g: 480,
      scan_type: 'meal',
      ingredients: [
        { name: 'Bánh phở tươi', weight_g: 180 },
        { name: 'Thịt bò tái chín', weight_g: 90 },
        { name: 'Nước dùng hầm xương', weight_g: 210 }
      ],
      macros: { kcal: 495, protein: 26, carb: 64, fat: 14 },
      micros: { sodium_mg: 1380, potassium_mg: 380, purine: 'Cao', sugar_g: 4 },
      suitability: 'CAUTION',
      suitability_reason:
        'Nước dùng phở chứa hàm lượng Natri khá cao (1.380mg) và Purine từ nước hầm xương; người tăng huyết áp, CKD hoặc Gout không nên uống hết nước dùng.',
      cooking_tips: ['Chỉ ăn phần bánh phở và thịt, bỏ lại ít nhất 70% nước dùng', 'Không thêm tương ớt mặn hoặc nước mắm.']
    }
  },
  {
    id: 'sample-bun-cha',
    label: 'Bún chả Hà Nội',
    tag: 'Vượt Natri',
    tagStyle: 'bg-[#FFF1F3] text-[#B8334A] border-[#B8334A]/20',
    gi: 64,
    scan: {
      dish_name: 'Bún chả nướng & nước mắm pha',
      estimated_weight_g: 450,
      scan_type: 'meal',
      ingredients: [
        { name: 'Bún tươi', weight_g: 180 },
        { name: 'Chả viên & ba chỉ nướng ướp gia vị', weight_g: 140 },
        { name: 'Nước mắm đường pha tỏi ớt', weight_g: 130 }
      ],
      macros: { kcal: 640, protein: 28, carb: 68, fat: 26 },
      micros: { sodium_mg: 1690, potassium_mg: 340, purine: 'Cao', sugar_g: 14 },
      suitability: 'DANGER',
      suitability_reason:
        'Vượt ngưỡng Natri một bữa ăn (1.690mg, tương đương >85% trần ngày) kết hợp đường pha nước chấm và mỡ bão hòa; dễ gây tăng huyết áp và quá tải dịch.',
      cooking_tips: ['Nếu ăn, chỉ chấm nhẹ đầu đũa và thay thịt ba chỉ bằng nạc vai ít mỡ', 'Tăng cường rau xà lách (nếu không dùng Warfarin liều cao).']
    }
  }
]

export default function Diary() {
  const s = useS()
  const p = s.profile
  const todayIso = localDateIso()
  const activeDate = s.selectedDiaryDate || todayIso
  const isToday = activeDate === todayIso
  const todayDiary = s.diary[activeDate] || {}

  const [scanPhase, setScanPhase] = useState<'idle' | 'scanning' | 'done'>('idle')
  const [previewUrl, setPreviewUrl] = useState<string>('')
  const [previewLoadError, setPreviewLoadError] = useState(false)
  const [lastScannedFile, setLastScannedFile] = useState<File | null>(null)
  const [scanResult, setScanResult] = useState<FoodScanResult | null>(null)
  const [estimatedGi, setEstimatedGi] = useState<number | undefined>(55)
  const [targetSlot, setTargetSlot] = useState<Slot>('Bữa trưa')
  const [dragActive, setDragActive] = useState(false)

  // Manual modal & edit modal states
  const [manualOpen, setManualOpen] = useState(false)
  const [manualSearch, setManualSearch] = useState('')
  const [manualFoodId, setManualFoodId] = useState(s.foods[0]?.id || '')
  const [manualGrams, setManualGrams] = useState('150')
  const [manualSlot, setManualSlot] = useState<Slot>('Bữa trưa')

  const [editingEntry, setEditingEntry] = useState<{
    slot: string
    idx: number
    item: Item
    gramsInput: string
    error?: string
  } | null>(null)
  const [rebalancing, setRebalancing] = useState(false)

  const cameraInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const flatTodayItems = useMemo(() => {
    const list: { slot: string; idx: number; item: Item }[] = []
    SLOTS.forEach(slot => {
      const slotItems = todayDiary[slot] || []
      slotItems.forEach((item, idx) => list.push({ slot, idx, item }))
    })
    // Also handle any non-standard slot keys
    Object.entries(todayDiary).forEach(([slot, slotItems]) => {
      if (!SLOTS.includes(slot as Slot)) {
        ;(slotItems || []).forEach((item, idx) => list.push({ slot, idx, item }))
      }
    })
    return list
  }, [todayDiary])

  const allItems = useMemo(() => flatTodayItems.map(x => x.item), [flatTodayItems])
  const totals = useMemo(() => calc(allItems, s.foods), [allItems, s.foods])
  const safetyWarnings = useMemo(() => safety(p, allItems, s), [p, allItems, s])
  const activeSafetyAlerts = useMemo(
    () => safetyWarnings.filter(w => w.level === 'warn'),
    [safetyWarnings]
  )
  const ddiWarnings = useMemo(() => evaluateDrugDietInteractions(p, allItems, s.foods), [p, allItems, s.foods])
  const limits = useMemo(() => approvedNutritionLimits(p, s.plans), [p, s.plans])
  const clinicalCeilings = useMemo(
    () => deriveClinicalCeilings(p, p.files?.[0] || s.ocrHistory?.[0], s.rules),
    [p, s.ocrHistory, s.rules]
  )
  const targetKcal = nutritionProfileIssue(p) ? 1800 : tdee(p)
  const maxSodium = Number(limits?.max_sodium_mg) || clinicalCeilings.max_sodium_mg || 2000
  const maxProtein = Number(limits?.max_protein_g) || clinicalCeilings.max_protein_g || undefined
  const hasRealDailyDanger =
    allItems.length > 0 &&
    (totals.sodium > maxSodium ||
      totals.kcal > targetKcal * 1.05 ||
      (maxProtein !== undefined && totals.protein > maxProtein) ||
      activeSafetyAlerts.length > 0 ||
      ddiWarnings.length > 0)

  const handleImageFile = async (file: File) => {
    if (!file || !file.type.startsWith('image/')) {
      toast('Vui lòng chọn tệp hình ảnh hợp lệ (JPG, PNG, WEBP).')
      return
    }
    setLastScannedFile(file)
    setScanPhase('scanning')
    try {
      const compressed = await compressImageFile(file, 1024, 1024, 0.8)
      const cleanDataUrl = compressed.base64.startsWith('data:')
        ? compressed.base64
        : `data:${compressed.mimeType || 'image/jpeg'};base64,${compressed.base64}`
      setPreviewUrl(cleanDataUrl)
      setPreviewLoadError(false)
      const result = await analyzeFoodLabelOrMenu(cleanDataUrl, compressed.mimeType, p, 'meal')
      setScanResult(result)
      if (result.unverified || result.isFallback) {
        setEstimatedGi(undefined)
      } else {
        setEstimatedGi(result.gi ?? (result.micros?.sugar_g > 8 ? 64 : 52))
      }
      setScanPhase('done')
      if (result.unverified || result.isFallback) {
        toast(result.is_food === false ? 'Ảnh không phải món ăn — không thể lưu vào nhật ký.' : 'Chưa thể xác minh ảnh từ AI. Xem chi tiết thông báo bên dưới.')
      } else {
        toast(`AI Vision đã nhận diện "${result.dish_name}" (${Math.round(result.macros.kcal)} kcal)`)
      }
    } catch (err: any) {
      setScanPhase('idle')
      toast('Không thể phân tích ảnh: ' + (err.message || 'Lỗi không xác định'))
    }
  }

  const handleQuickSample = (sample: QuickSamplePreset) => {
    setPreviewUrl('')
    setPreviewLoadError(false)
    setLastScannedFile(null)
    setScanPhase('scanning')
    window.setTimeout(() => {
      setScanResult(sample.scan)
      setEstimatedGi(sample.gi)
      setScanPhase('done')
    }, 550)
  }

  const handleSaveScanToDiary = () => {
    if (!scanResult || scanResult.unverified || scanResult.isFallback || scanResult.is_food === false) return
    logFoodScanToDiary(scanResult, targetSlot, activeDate)
    toast(`Đã lưu "${scanResult.dish_name}" vào ${targetSlot} (${isToday ? 'hôm nay' : activeDate})!`)
  }

  const handleRemoveItem = (slot: string, idx: number, name: string) => {
    set(d => {
      const list = d.diary[activeDate]?.[slot] || []
      list.splice(idx, 1)
      log(d, 'Gỡ món nhật ký', `${name} (${slot})`)
      syncDailyNutrientAlerts(d, activeDate)
    })
    toast(`Đã gỡ "${name}" khỏi nhật ký ${isToday ? 'hôm nay' : activeDate}.`)
  }

  const handleClearAll = () => {
    set(d => {
      d.diary[activeDate] = {}
      log(d, 'Xóa toàn bộ nhật ký ngày', activeDate)
      syncDailyNutrientAlerts(d, activeDate)
    })
    toast(`Đã xóa toàn bộ món đã ghi nhận ngày ${activeDate}.`)
  }

  const handleManualAdd = () => {
    const food = s.foods.find(f => f.id === manualFoodId)
    const g = Number(manualGrams)
    if (!food) {
      toast('Vui lòng chọn một món từ kho thực phẩm.')
      return
    }
    if (!Number.isFinite(g) || g < 1 || g > 1500) {
      toast('Khẩu phần (gram) không hợp lệ: vui lòng nhập từ 1g đến 1500g.')
      return
    }
    set(d => {
      d.diary[activeDate] ||= {}
      d.diary[activeDate][manualSlot] ||= []
      d.diary[activeDate][manualSlot].push({
        foodId: food.id,
        foodName: food.name,
        grams: Math.round(g),
        note: '[Nhật ký thủ công]'
      })
      log(d, 'Ghi nhận nhật ký', `${food.name} (${Math.round(g)}g)`)
      syncDailyNutrientAlerts(d, activeDate)
    })
    setManualOpen(false)
    toast(`Đã thêm ${food.name} (${Math.round(g)}g) vào ${manualSlot}.`)
  }

  const handleUpdateEntryGrams = () => {
    if (!editingEntry) return
    const parsed = Number(editingEntry.gramsInput.trim())
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 1500) {
      setEditingEntry({
        ...editingEntry,
        error: 'Khẩu phần (gram) không hợp lệ: vui lòng nhập từ 1g đến 1500g.'
      })
      return
    }
    const rounded = Math.round(parsed)
    set(d => {
      const target = d.diary[activeDate]?.[editingEntry.slot]?.[editingEntry.idx]
      if (target) {
        target.grams = rounded
        syncDailyNutrientAlerts(d, activeDate)
      }
    })
    setEditingEntry(null)
    toast(`Đã cập nhật khẩu phần thành ${rounded}g!`)
  }

  const handleAiRebalance = async () => {
    setRebalancing(true)
    try {
      const remaining = SLOTS.filter(sl => !(todayDiary[sl]?.length > 0))
      const res = await rebalanceDailyMealsAI(
        p,
        s.foods,
        {
          kcal: totals.kcal,
          protein: totals.protein,
          carb: totals.carb,
          sodium: totals.sodium
        },
        remaining.length > 0 ? remaining : ['Bữa tối']
      )
      rebalanceRemainingMeals(activeDate, res.rebalanced_slots, res.explanation)
      toast('Đã tái cân bằng khẩu phần các bữa còn lại để giữ an toàn!')
    } catch (e: any) {
      toast('Không thể tái cân bằng: ' + (e.message || 'Lỗi kết nối'))
    } finally {
      setRebalancing(false)
    }
  }

  const filteredManualFoods = s.foods.filter(
    f =>
      !manualSearch.trim() ||
      f.name.toLowerCase().includes(manualSearch.toLowerCase()) ||
      f.category.toLowerCase().includes(manualSearch.toLowerCase())
  )

  const suitabilityStyle = (suit: FoodScanResult['suitability']) => {
    if (suit === 'SAFE') return { label: 'AN TOÀN CDSS', cls: 'bg-[#E1F2EF] text-[#0B4F4A]' }
    if (suit === 'CAUTION') return { label: 'CẦN LƯU Ý', cls: 'bg-[#FDF5E6] text-[#B88746]' }
    return { label: 'VƯỢT NGƯỠNG', cls: 'bg-[#FFF1F3] text-[#B8334A]' }
  }

  return (
    <div className="space-y-5">
      {/* Calendar Date Navigation Strip */}
      <CalendarDateStrip
        selectedDate={activeDate}
        onSelectDate={d => setSelectedDiaryDate(d)}
        title="Lịch Nhật Ký Ăn Uống"
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* LEFT 7 COLUMNS: AI FOOD LENS */}
        <div className="lg:col-span-7 apple-liquid-glass p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <ScanLine size={18} className="text-[#0B4F4A]" />
                <h2 className="font-serifDisplay text-lg sm:text-xl font-semibold text-[#0F2422]">
                  AI Food Lens & Định lượng Khẩu phần
                </h2>
              </div>
              <p className="text-xs text-[#475D5B] mt-0.5">
                Tải ảnh bữa ăn hoặc chọn mẫu lâm sàng để AI phân tích Kcal, Đạm, Natri và chỉ số GI.
              </p>
            </div>

            <Btn v="s" onClick={() => setManualOpen(true)} className="!py-1.5 !px-3 text-xs">
              <Plus size={14} /> Nhập tay từ kho
            </Btn>
          </div>

          {/* Interactive Dropzone / Scanner Viewport */}
          {scanPhase === 'idle' && (
            <div
              onDragOver={e => {
                e.preventDefault()
                setDragActive(true)
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={e => {
                e.preventDefault()
                setDragActive(false)
                const dropped = e.dataTransfer.files?.[0]
                if (dropped) handleImageFile(dropped)
              }}
              className={`rounded-[24px] border-2 border-dashed p-8 text-center transition-all ${
                dragActive
                  ? 'border-[#0B4F4A] bg-[#E1F2EF]/60'
                  : 'border-[#0B4F4A]/25 bg-white/55 hover:border-[#0B4F4A]/45'
              }`}
            >
              <div className="w-12 h-12 rounded-2xl bg-[#E1F2EF] text-[#0B4F4A] mx-auto flex items-center justify-center mb-3">
                <Camera size={22} />
              </div>
              <p className="font-semibold text-sm text-[#0F2422]">
                Kéo & thả ảnh món ăn vào đây, hoặc chụp trực tiếp từ camera
              </p>
              <p className="text-xs text-[#738A87] mt-1">
                Hỗ trợ ảnh bữa ăn, nhãn dinh dưỡng thực phẩm (JPG, PNG, WEBP)
              </p>

              <div className="flex flex-wrap items-center justify-center gap-3.5 mt-5">
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="whitespace-nowrap inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-2xl bg-gradient-to-r from-[#0B4F4A] to-[#14665F] hover:from-[#073935] hover:to-[#0F524D] text-white text-xs sm:text-sm font-semibold shadow-[0_4px_14px_rgba(11,79,74,0.25)] hover:shadow-[0_6px_20px_rgba(11,79,74,0.35)] transition-all cursor-pointer active:scale-95"
                >
                  <Camera size={16} className="shrink-0" />
                  <span>Chụp ảnh món ăn</span>
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="whitespace-nowrap inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-2xl bg-white hover:bg-[#F2F6F7] text-[#0B4F4A] border border-[#0B4F4A]/25 hover:border-[#0B4F4A]/45 text-xs sm:text-sm font-semibold shadow-[0_2px_10px_rgba(11,79,74,0.06)] hover:shadow-[0_4px_14px_rgba(11,79,74,0.12)] transition-all cursor-pointer active:scale-95"
                >
                  <Upload size={16} className="shrink-0" />
                  <span>Chọn ảnh từ máy</span>
                </button>
              </div>
            </div>
          )}

          {scanPhase === 'scanning' && (
            <div className="relative rounded-[24px] bg-[#092220] text-white p-8 min-h-[250px] flex flex-col items-center justify-center overflow-hidden">
              {previewUrl && (
                <img
                  src={previewUrl}
                  alt="Đang quét khẩu phần"
                  className="absolute inset-0 w-full h-full object-cover opacity-35"
                />
              )}
              <div className="vision-scan-beam" />
              <div className="relative z-10 text-center space-y-2">
                <Loader2 className="w-8 h-8 animate-spin text-[#34D399] mx-auto" />
                <p className="font-semibold text-sm text-white">
                  AI Food Lens đang quét thành phần dinh dưỡng...
                </p>
                <p className="text-[11px] font-mono-code text-[#A7F3D0]">
                  Ước lượng gram · Đối chiếu Natri, Kali, Purine & DDI
                </p>
              </div>
            </div>
          )}

          {scanPhase === 'done' && scanResult && (
            <div className="porcelain-core rounded-[24px] p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {previewUrl && !previewLoadError ? (
                    <img
                      src={previewUrl}
                      alt={scanResult.dish_name}
                      onError={() => setPreviewLoadError(true)}
                      className="w-16 h-16 rounded-2xl object-cover shrink-0 border border-white shadow-xs"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-2xl bg-[#E1F2EF] text-[#0B4F4A] flex items-center justify-center shrink-0">
                      <Utensils size={22} />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-serifDisplay text-lg font-semibold text-[#0F2422]">
                        {scanResult.dish_name}
                      </h3>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono-code font-semibold ${
                          suitabilityStyle(scanResult.suitability).cls
                        }`}
                      >
                        {suitabilityStyle(scanResult.suitability).label}
                      </span>
                    </div>
                    <p className="text-xs text-[#738A87] font-mono-code mt-0.5">
                      Khối lượng ước tính:{' '}
                      {scanResult.unverified || scanResult.isFallback
                        ? '— (Chưa xác minh)'
                        : `${scanResult.estimated_weight_g} g`}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setScanPhase('idle')
                    setScanResult(null)
                    setPreviewUrl('')
                    setLastScannedFile(null)
                  }}
                  className="text-xs text-[#475D5B] hover:text-[#0B4F4A] font-medium inline-flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw size={12} /> Quét món khác
                </button>
              </div>

              {/* 4 KPI Porcelain Metrics: Năng lượng, Đạm, Natri, GI */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="p-3 rounded-2xl bg-[#F2F6F7]/85 text-center">
                  <span className="text-[10px] uppercase tracking-wider text-[#738A87] block">
                    Năng lượng
                  </span>
                  <span className="font-mono-code text-base font-bold text-[#0F2422]">
                    {scanResult.unverified || scanResult.isFallback ? '—' : Math.round(scanResult.macros.kcal)}
                  </span>
                  <span className="text-[10px] text-[#738A87] ml-1">kcal</span>
                </div>
                <div className="p-3 rounded-2xl bg-[#F2F6F7]/85 text-center">
                  <span className="text-[10px] uppercase tracking-wider text-[#738A87] block">
                    Đạm
                  </span>
                  <span className="font-mono-code text-base font-bold text-[#0284C7]">
                    {scanResult.unverified || scanResult.isFallback ? '—' : Math.round(scanResult.macros.protein)}
                  </span>
                  <span className="text-[10px] text-[#738A87] ml-1">g</span>
                </div>
                <div className="p-3 rounded-2xl bg-[#F2F6F7]/85 text-center">
                  <span className="text-[10px] uppercase tracking-wider text-[#738A87] block">
                    Natri
                  </span>
                  <span
                    className={`font-mono-code text-base font-bold ${
                      (scanResult.micros?.sodium_mg || 0) >= 1000 ? 'text-[#B8334A]' : 'text-[#0B4F4A]'
                    }`}
                  >
                    {scanResult.unverified || scanResult.isFallback ? '—' : Math.round(scanResult.micros.sodium_mg)}
                  </span>
                  <span className="text-[10px] text-[#738A87] ml-1">mg</span>
                </div>
                <div className="p-3 rounded-2xl bg-[#F2F6F7]/85 text-center">
                  <span className="text-[10px] uppercase tracking-wider text-[#738A87] block">
                    GI ước tính
                  </span>
                  <span className="font-mono-code text-base font-bold text-[#B88746]">
                    {scanResult.unverified || scanResult.isFallback ? '—' : (scanResult.gi ?? estimatedGi ?? '—')}
                  </span>
                  <span className="text-[10px] text-[#738A87] ml-1">GI</span>
                </div>
              </div>

              <div
                className={`p-3 rounded-2xl text-xs leading-relaxed ${
                  scanResult.suitability === 'DANGER'
                    ? 'bg-[#FFF1F3] text-[#B8334A]'
                    : scanResult.suitability === 'CAUTION'
                      ? 'bg-[#FDF5E6] text-[#8A622B]'
                      : 'bg-[#E1F2EF] text-[#0B4F4A]'
                }`}
              >
                <b>Nhận định lâm sàng:</b> {scanResult.suitability_reason}
              </div>

              {(scanResult.unverified || scanResult.isFallback) && (
                <div className="flex flex-wrap items-center gap-2.5">
                  {/Phiên xác thực|UNAUTHENTICATED|401/i.test(scanResult.suitability_reason || '') && (
                    <Btn
                      type="button"
                      v="s"
                      onClick={async () => {
                        if (typeof fetch === 'function') {
                          await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {})
                        }
                        setGatewayAuthStatus('unauthenticated')
                        set(d => {
                          log(d, 'Đăng xuất để xác thực lại Gateway', 'AI Food Lens')
                          d.session = null
                        })
                      }}
                      className="!py-1.5 !px-3 text-xs"
                    >
                      Đăng nhập lại
                    </Btn>
                  )}
                  {lastScannedFile && (
                    <Btn
                      type="button"
                      v="s"
                      onClick={() => handleImageFile(lastScannedFile)}
                      className="!py-1.5 !px-3 text-xs"
                    >
                      <RefreshCw size={12} /> Quét lại ảnh
                    </Btn>
                  )}
                </div>
              )}

              {/* Chi tiết vi chất & nguyên liệu nhận diện được */}
              {!scanResult.unverified && (
                <div className="space-y-2.5 text-xs">
                  <div className="flex flex-wrap gap-2 text-[11px] font-mono-code text-[#475D5B]">
                    <span className="px-2.5 py-1 rounded-full bg-[#F2F6F7]">Carb: <b>{Math.round(scanResult.macros.carb)}g</b></span>
                    <span className="px-2.5 py-1 rounded-full bg-[#F2F6F7]">Chất béo: <b>{Math.round(scanResult.macros.fat)}g</b></span>
                    <span className="px-2.5 py-1 rounded-full bg-[#F2F6F7]">Kali: <b>{Math.round(scanResult.micros.potassium_mg)}mg</b></span>
                    <span className="px-2.5 py-1 rounded-full bg-[#F2F6F7]">Đường: <b>{Math.round(scanResult.micros.sugar_g)}g</b></span>
                    <span className="px-2.5 py-1 rounded-full bg-[#F2F6F7]">Purine: <b>{scanResult.micros.purine}</b></span>
                  </div>
                  {scanResult.ingredients.length > 0 && (
                    <div className="p-3 rounded-2xl bg-white/75 border border-line/60">
                      <span className="text-[11px] font-semibold text-[#0F2422] block mb-1">Nguyên liệu AI nhận diện:</span>
                      <div className="flex flex-wrap gap-1.5">
                        {scanResult.ingredients.map((ing, i) => (
                          <span key={i} className="px-2 py-0.5 rounded-lg bg-[#E1F2EF]/60 text-[#0B4F4A] text-[11px]">
                            {ing.name}{ing.weight_g > 0 ? ` (~${Math.round(ing.weight_g)}g)` : ''}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-[#475D5B] font-medium">Bữa ăn:</span>
                  <select
                    aria-label="Chọn bữa lưu vào nhật ký"
                    className="px-3 py-1.5 rounded-xl bg-white border border-line text-xs font-medium text-[#0F2422]"
                    value={targetSlot}
                    onChange={e => setTargetSlot(e.target.value as Slot)}
                  >
                    {SLOTS.map(sl => (
                      <option key={sl} value={sl}>
                        {sl}
                      </option>
                    ))}
                  </select>
                </div>

                <Btn
                  disabled={Boolean(scanResult.unverified || scanResult.is_food === false || scanResult.isFallback)}
                  onClick={handleSaveScanToDiary}
                  className="!bg-[#0B4F4A] hover:!bg-[#073935] disabled:opacity-50"
                >
                  <Plus size={14} /> Lưu vào {targetSlot} ({isToday ? 'hôm nay' : activeDate})
                </Btn>
              </div>
            </div>
          )}

          {/* Hidden File & Camera Inputs */}
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) handleImageFile(file)
              e.target.value = ''
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) handleImageFile(file)
              e.target.value = ''
            }}
          />

          {/* 3 Clinical Quick Scan Samples */}
          <div className="pt-2 border-t border-white/75 space-y-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#738A87] flex items-center gap-1.5">
              <Sparkles size={13} className="text-[#0B4F4A]" /> Ảnh mẫu lâm sàng bấm quét nhanh
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {CLINICAL_FOOD_SAMPLES.map(sample => (
                <button
                  key={sample.id}
                  type="button"
                  onClick={() => handleQuickSample(sample)}
                  className="porcelain-core p-3 rounded-2xl text-left hover:bg-white transition-all cursor-pointer group"
                >
                  <div className="flex items-center justify-between gap-1.5 mb-1">
                    <span className="font-semibold text-xs text-[#0F2422] group-hover:text-[#0B4F4A]">
                      {sample.label}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 ${sample.tagStyle}`}>
                      {sample.tag}
                    </span>
                  </div>
                  <p className="font-mono-code text-[10px] text-[#738A87]">
                    {sample.scan.macros.kcal} kcal · Na {sample.scan.micros.sodium_mg}mg
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT 5 COLUMNS: TODAY'S LOGGED ITEMS */}
        <div className="lg:col-span-5 apple-liquid-glass p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-serifDisplay text-lg font-semibold text-[#0F2422]">
                {isToday ? 'Món đã ghi nhận hôm nay' : `Món đã ghi nhận (${formatVietnameseDate(activeDate)})`}
              </h2>
              <p className="font-mono-code text-[11px] text-[#475D5B] mt-0.5">
                {Math.round(totals.kcal)} / {Math.round(targetKcal)} kcal · Đạm {Math.round(totals.protein)}g · Na {Math.round(totals.sodium)}mg
              </p>
            </div>
            {flatTodayItems.length > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-[#FFF1F3] hover:bg-rose-100 text-[#B8334A] text-xs font-semibold transition-colors cursor-pointer"
              >
                <Trash2 size={12} /> Xóa tất cả
              </button>
            )}
          </div>

          {/* Dynamic Safety / DDI Warnings ONLY when daily intake actually exceeds thresholds */}
          {hasRealDailyDanger ? (
            <div className="p-3.5 rounded-2xl bg-[#FFF1F3] border border-[#B8334A]/20 text-xs text-[#B8334A] space-y-2">
              <div className="font-semibold flex items-center gap-1.5">
                <ShieldAlert size={14} /> Cảnh báo An toàn Dinh dưỡng trong ngày
              </div>
              <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                {totals.sodium > maxSodium && (
                  <li>
                    Tổng Natri hôm nay ({Math.round(totals.sodium)}mg) đang vượt trần {maxSodium}mg.
                  </li>
                )}
                {maxProtein !== undefined && totals.protein > maxProtein && (
                  <li>
                    Tổng Đạm hôm nay ({Math.round(totals.protein)}g) đang vượt trần {maxProtein}g.
                  </li>
                )}
                {totals.kcal > targetKcal * 1.05 && (
                  <li>
                    Tổng năng lượng ({Math.round(totals.kcal)} kcal) vượt mục tiêu {Math.round(targetKcal)} kcal.
                  </li>
                )}
                {activeSafetyAlerts.slice(0, 2).map((w, idx) => (
                  <li key={`s-${idx}`}>{`${w.label}: ${w.note}`}</li>
                ))}
                {ddiWarnings.slice(0, 2).map((w, idx) => (
                  <li key={`d-${idx}`}>{w}</li>
                ))}
              </ul>
              <button
                type="button"
                disabled={rebalancing}
                onClick={handleAiRebalance}
                className="w-full py-1.5 px-3 rounded-xl bg-[#B8334A] hover:bg-rose-800 text-white text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-60"
              >
                {rebalancing ? 'Đang tái cân bằng...' : 'AI Cân bằng lại các bữa còn lại'}
              </button>
            </div>
          ) : (
            <div className="p-3 rounded-2xl bg-[#E1F2EF]/75 text-xs text-[#0B4F4A] flex items-center gap-2">
              <CheckCircle2 size={15} className="shrink-0" />
              <span>
                {allItems.length === 0
                  ? 'Trạng thái an toàn · Chưa ghi nhận món ăn nào (0 kcal / 0mg Natri).'
                  : 'Các chỉ số dinh dưỡng ghi nhận hôm nay đang nằm trong ngưỡng an toàn CDSS.'}
              </span>
            </div>
          )}

          {flatTodayItems.length === 0 ? (
            <div className="porcelain-core rounded-2xl p-6 text-center space-y-2">
              <CheckCircle2 size={24} className="text-[#136F68] mx-auto opacity-80" />
              <p className="text-xs font-medium text-[#0F2422]">
                Chưa có món ăn nào được ghi nhận riêng trong nhật ký hôm nay.
              </p>
              <p className="text-[11px] text-[#738A87]">
                Hãy quét ảnh từ AI Food Lens, thêm thủ công từ kho thực phẩm hoặc điều chỉnh Thực đơn 7 ngày để tự động đồng bộ.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
              {flatTodayItems.map(({ slot, idx, item }) => {
                const foodRef = s.foods.find(f => f.id === item.foodId)
                const itemName = item.foodName || foodRef?.name || 'Món ăn tùy chỉnh'
                const itemNu = calc([item], s.foods)
                const isHighSodium = itemNu.sodium > 700
                return (
                  <div
                    key={`${slot}-${idx}-${item.foodId}`}
                    className="porcelain-core rounded-2xl p-3 flex items-start justify-between gap-2.5"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-mono-code px-2 py-0.5 rounded-full bg-[#E1F2EF] text-[#0B4F4A] font-semibold">
                          {slot}
                        </span>
                        {item.note && (
                          <span className="text-[10px] font-mono-code text-[#738A87] truncate max-w-[140px]">
                            {item.note}
                          </span>
                        )}
                      </div>
                      <p className="font-semibold text-xs text-[#0F2422] truncate">{itemName}</p>
                      <div className="flex flex-wrap items-center gap-2 font-mono-code text-[11px] text-[#475D5B]">
                        <span>{item.grams}g</span>
                        <span>·</span>
                        <span>{Math.round(itemNu.kcal)} kcal</span>
                        <span>·</span>
                        <span>Đạm {Math.round(itemNu.protein)}g</span>
                        <span>·</span>
                        <span className={isHighSodium ? 'text-[#B8334A] font-semibold' : ''}>
                          Na {Math.round(itemNu.sodium)}mg
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setEditingEntry({
                            slot,
                            idx,
                            item,
                            gramsInput: String(item.grams)
                          })
                        }
                        title="Sửa khối lượng"
                        className="p-1.5 rounded-full hover:bg-slate-100 text-[#475D5B] hover:text-[#0B4F4A] cursor-pointer"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(slot, idx, itemName)}
                        className="px-2.5 py-1 rounded-full bg-[#FFF1F3] hover:bg-rose-100 text-[#B8334A] text-[11px] font-semibold cursor-pointer"
                      >
                        Gỡ
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* MANUAL FOOD ENTRY MODAL */}
      {manualOpen && (
        <Modal title="Thêm món thủ công từ Kho Thực phẩm" onClose={() => setManualOpen(false)}>
          <div className="space-y-4 text-xs">
            <Field label="Tìm kiếm món ăn:">
              <input
                type="text"
                className={inp}
                placeholder="Nhập tên món (vd: Cơm, Cá hồi, Phở)..."
                value={manualSearch}
                onChange={e => setManualSearch(e.target.value)}
              />
            </Field>
            <Field label="Chọn món ăn:">
              <select
                className={inp}
                value={manualFoodId}
                onChange={e => setManualFoodId(e.target.value)}
              >
                {filteredManualFoods.map(f => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.kcal} kcal/100g · Na {f.sodium}mg)
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Bữa ăn:">
                <select
                  className={inp}
                  value={manualSlot}
                  onChange={e => setManualSlot(e.target.value as Slot)}
                >
                  {SLOTS.map(sl => (
                    <option key={sl} value={sl}>
                      {sl}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Khẩu phần (gram):">
                <input
                  type="number"
                  min={1}
                  max={1500}
                  className={inp + ' font-mono-code'}
                  value={manualGrams}
                  onChange={e => setManualGrams(e.target.value)}
                />
              </Field>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Btn v="s" onClick={() => setManualOpen(false)}>
                Hủy
              </Btn>
              <Btn onClick={handleManualAdd}>Lưu vào Nhật ký</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* EDIT GRAMS MODAL */}
      {editingEntry && (
        <Modal
          title={`Điều chỉnh định lượng: ${editingEntry.item.foodName || s.foods.find(f => f.id === editingEntry.item.foodId)?.name || 'Món ăn'}`}
          onClose={() => setEditingEntry(null)}
        >
          <div className="space-y-4 text-xs">
            <Field label="Khẩu phần (gram, 1g - 1500g):">
              <input
                type="number"
                min={1}
                max={1500}
                className={inp + ' font-mono-code font-semibold'}
                value={editingEntry.gramsInput}
                onChange={e =>
                  setEditingEntry({
                    ...editingEntry,
                    gramsInput: e.target.value,
                    error: undefined
                  })
                }
              />
            </Field>
            {editingEntry.error && (
              <p className="text-xs text-[#B8334A] bg-[#FFF1F3] rounded-xl px-3 py-2 font-medium">
                {editingEntry.error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Btn v="s" onClick={() => setEditingEntry(null)}>
                Hủy
              </Btn>
              <Btn onClick={handleUpdateEntryGrams}>Lưu khẩu phần</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
