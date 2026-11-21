import React from 'react'
import { Ban } from 'lucide-react'
import { Btn, Field, inp, Modal, toast } from '../../components/ui'
import { evaluateDrugDietInteractions } from '../../utils/nutrition'
import type { Food, Profile } from '../../types'
import type { SwapSuggestion } from '../../services/api'

export interface EditingGramsTarget {
  dayIdx: number
  slot: string
  itemIdx: number
  foodName: string
  gramsInput: string
  error?: string
}

export interface SwappingTarget {
  dayIdx: number
  slot: string
  itemIdx: number
  currentFoodName: string
  currentGrams: number
}

export function EditGramsModal({
  target,
  onChange,
  onClose,
  onSave
}: {
  target: EditingGramsTarget
  onChange: (next: EditingGramsTarget) => void
  onClose: () => void
  onSave: (parsedGrams: number) => void
}) {
  return (
    <Modal title={`Sửa khẩu phần: ${target.foodName}`} onClose={onClose}>
      <div className="space-y-4 text-xs">
        <Field label="Khẩu phần (gram, 1g - 1500g):">
          <input
            type="number"
            min={1}
            max={1500}
            step="any"
            className={inp + ' text-sm font-semibold tabular-nums'}
            value={target.gramsInput}
            onChange={e => onChange({ ...target, gramsInput: e.target.value, error: undefined })}
          />
        </Field>
        {target.error && (
          <p className="text-xs text-rose-ink bg-rose-50 border border-rose-ink/30 rounded-[8px] px-3 py-2 font-medium">
            {target.error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Btn v="s" onClick={onClose}>
            Hủy
          </Btn>
          <Btn
            onClick={() => {
              const raw = target.gramsInput.trim()
              const parsed = Number(raw)
              if (!raw || !Number.isFinite(parsed) || parsed < 1 || parsed > 1500) {
                const msg = 'Khẩu phần (gram) không hợp lệ: vui lòng nhập số từ 1g đến 1500g.'
                onChange({ ...target, error: msg })
                toast(msg)
                return
              }
              onSave(parsed)
            }}
          >
            Lưu khẩu phần
          </Btn>
        </div>
      </div>
    </Modal>
  )
}

export function FhirPreviewModal({ json, onClose }: { json: string; onClose: () => void }) {
  return (
    <Modal title="HL7 FHIR R4 NutritionOrder" onClose={onClose}>
      <div className="space-y-3 text-xs">
        <p className="text-muted">Tài nguyên chuẩn HL7 FHIR R4:</p>
        <pre className="p-3 rounded-[8px] bg-ink text-sage-50 font-mono text-[11px] max-h-80 overflow-auto">
          {json}
        </pre>
      </div>
    </Modal>
  )
}

export function SwapDishModal({
  target,
  profile,
  foods,
  suggestions,
  blockedIds,
  swapSearch,
  onSwapSearchChange,
  onConfirm,
  onBlockFood,
  onUnblockAll,
  onClose
}: {
  target: SwappingTarget
  profile: Profile
  foods: Food[]
  suggestions: SwapSuggestion[]
  blockedIds: string[]
  swapSearch: string
  onSwapSearchChange: (q: string) => void
  onConfirm: (food: Food, grams: number) => void
  onBlockFood: (foodId: string, foodName: string) => void
  onUnblockAll: () => void
  onClose: () => void
}) {
  return (
    <Modal title={`Đổi món thay thế: ${target.currentFoodName}`} onClose={onClose} maxWidthClass="max-w-2xl">
      <div className="space-y-4 text-xs">
        {suggestions.length > 0 && (
          <div className="p-3 rounded-[8px] bg-brand-50/60 border border-brand/25 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-brand-900">
                Gợi ý thay thế tối ưu (Top 3 tương đương dinh dưỡng)
              </span>
              {blockedIds.length > 0 && (
                <button type="button" onClick={onUnblockAll} className="text-[11px] text-brand underline cursor-pointer">
                  Khôi phục {blockedIds.length} món đã ẩn
                </button>
              )}
            </div>
            <div className="space-y-1.5">
              {suggestions.map(sug => (
                <div
                  key={sug.food.id}
                  className="p-2.5 rounded-[8px] bg-surface border border-rule flex flex-wrap items-center justify-between gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-ink text-sm">
                      {sug.food.name} ({sug.suggestedGrams}g)
                    </div>
                    <div className="text-[11px] text-muted tabular-nums">
                      {sug.reason} · ΔCalo {sug.deltaKcal >= 0 ? `+${sug.deltaKcal}` : sug.deltaKcal} kcal · ΔĐạm{' '}
                      {sug.deltaProtein >= 0 ? `+${sug.deltaProtein}` : sug.deltaProtein}g · ΔNatri{' '}
                      {sug.deltaSodium >= 0 ? `+${sug.deltaSodium}` : sug.deltaSodium}mg
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Btn
                      v="s"
                      className="!py-1 !px-2 !min-h-[32px] text-[11px]"
                      onClick={() => onBlockFood(sug.food.id, sug.food.name)}
                    >
                      <Ban className="w-3 h-3 mr-1" /> Không chọn lại
                    </Btn>
                    <Btn
                      className="!py-1 !px-2.5 !min-h-[32px] text-xs"
                      onClick={() => onConfirm(sug.food, sug.suggestedGrams)}
                    >
                      Chọn gợi ý
                    </Btn>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-muted">Hoặc tìm thủ công món thay thế trong kho thực phẩm:</p>
        <input
          type="text"
          placeholder="Tìm tên món hoặc nhóm thực phẩm..."
          value={swapSearch}
          onChange={e => onSwapSearchChange(e.target.value)}
          className={inp}
        />
        <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
          {foods
            .filter(f => f.name !== target.currentFoodName && !blockedIds.includes(f.id))
            .filter(
              f =>
                !swapSearch.trim() ||
                f.name.toLowerCase().includes(swapSearch.toLowerCase()) ||
                f.category.toLowerCase().includes(swapSearch.toLowerCase())
            )
            .map(altFood => {
              const ddi = evaluateDrugDietInteractions(
                profile,
                [{ foodId: altFood.id, foodName: altFood.name, grams: target.currentGrams }],
                foods
              )
              const al = profile.allergies
                .toLowerCase()
                .split(',')
                .map(x => x.trim())
                .filter(Boolean)
              const hasAllergy = al.some(
                a => altFood.allergens.toLowerCase().includes(a) || altFood.name.toLowerCase().includes(a)
              )
              return (
                <div
                  key={altFood.id}
                  onClick={() => onConfirm(altFood, target.currentGrams)}
                  className={`p-3 rounded-[8px] border cursor-pointer bg-surface transition-colors flex items-center justify-between ${
                    ddi.length > 0 || hasAllergy ? 'border-rose-ink/40 bg-rose-50/40' : 'border-rule hover:border-brand'
                  }`}
                >
                  <div>
                    <span className="font-semibold text-ink text-sm block">{altFood.name}</span>
                    <span className="text-muted text-[11px] tabular-nums">
                      {altFood.kcal} kcal/100g · Natri: {altFood.sodium}mg · GI: {altFood.gi}
                    </span>
                    {(hasAllergy || ddi.length > 0) && (
                      <span className="block text-[10px] text-rose-ink font-semibold mt-0.5">
                        {hasAllergy ? `Chứa dị ứng (${altFood.allergens})` : ddi[0]}
                      </span>
                    )}
                  </div>
                  <Btn v="s" className="!py-1 !px-2.5 !min-h-[32px] text-xs">
                    Chọn
                  </Btn>
                </div>
              )
            })}
        </div>
      </div>
    </Modal>
  )
}
