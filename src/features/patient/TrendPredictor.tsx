import React, { useState } from 'react'
import { TrendingUp, Loader2, Activity, AlertTriangle, Check, HeartPulse, RefreshCw } from 'lucide-react'
import { useS, setTrendPrediction } from '../../services/store'
import { predictLongitudinalTrendsAI } from '../../services/aiService'
import { localDateIso } from '../../utils/nutrition'
import { Btn, Card, toast } from '../../components/ui'

export function LongitudinalTrendPredictor() {
  const s = useS()
  const p = s.profile
  const [loading, setLoading] = useState(false)
  const prediction = s.trendPrediction

  const organNames: Record<string, string> = {
    kidneys: 'Thận (Renal)',
    heart: 'Tim mạch (Cardio)',
    pancreas: 'Tuyến tụy (Endocrine)',
    liver: 'Gan mật (Hepatic)',
    joints: 'Khớp & Xương (Articular)',
    stomach: 'Dạ dày (Gastro)'
  }

  const handlePredict = async () => {
    setLoading(true)
    try {
      const diaryItems: Record<string, any> = {}
      for (let i = 0; i < 7; i++) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        const dayKey = localDateIso(d)
        if (s.diary[dayKey]) {
          diaryItems[dayKey] = s.diary[dayKey]
        }
      }
      const res = await predictLongitudinalTrendsAI(p, diaryItems, s.foods)
      setTrendPrediction(res)
      toast('Đã hoàn tất phân tích động học dinh dưỡng 7 ngày!')
    } catch (e: any) {
      toast('Lỗi phân tích: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="border border-brand/25 bg-surface overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-rule">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[10px] bg-brand text-white flex items-center justify-center shrink-0">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-base text-ink">
                AI Dự báo Xu hướng Dinh dưỡng & Nguy cơ Thiếu hụt Vi chất (7 Ngày)
              </h3>
              <span className="px-2 py-0.5 rounded-[6px] text-[10px] font-medium bg-brand-50 text-brand border border-brand/20">
                Phân tích tích lũy
              </span>
            </div>
            <p className="text-xs text-muted mt-0.5">
              Phân tích tích lũy dài hạn, phát hiện sớm nguy cơ thiếu vi chất và mô phỏng phục hồi chức năng cơ quan 30 ngày.
            </p>
          </div>
        </div>

        <Btn
          v="s"
          disabled={loading}
          onClick={handlePredict}
          className="inline-flex items-center gap-1.5 text-xs font-semibold"
        >
          {loading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin text-brand" />
              <span>Đang tính toán động học vi chất...</span>
            </>
          ) : (
            <>
              <RefreshCw className="w-3.5 h-3.5 text-brand" />
              <span>{prediction ? 'Cập nhật lại Phân tích AI' : 'Bắt đầu Phân tích AI'}</span>
            </>
          )}
        </Btn>
      </div>

      {prediction ? (
        <div className="space-y-4 mt-4">
          <div className="p-4 rounded-[8px] bg-paper border border-rule">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-brand flex items-center gap-1.5 mb-1.5">
              <Activity className="w-3.5 h-3.5" /> Đánh giá Tổng quan Động học Lâm sàng:
            </span>
            <p className="text-xs text-ink leading-relaxed">{prediction.trend_summary}</p>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <h4 className="font-semibold text-xs text-ink uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-ink" /> Nguy cơ Thiếu hụt Vi chất Tích lũy:
              </h4>
              <div className="space-y-2.5">
                {(prediction.deficiencies ?? []).map((d, i) => (
                  <div key={i} className="p-3.5 rounded-[8px] bg-paper border border-rule space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm text-ink">{d.nutrient}</span>
                      <span
                        className={`px-2 py-0.5 rounded-[6px] text-[10px] font-semibold uppercase ${
                          d.risk === 'high'
                            ? 'bg-rose-50 text-rose-ink border border-rose-ink/30'
                            : d.risk === 'medium'
                            ? 'bg-amber-50 text-amber-ink border border-turmeric/40'
                            : 'bg-sage-50 text-brand border border-brand/25'
                        }`}
                      >
                        {d.risk === 'high' ? 'Nguy cơ Cao' : d.risk === 'medium' ? 'Nguy cơ Trung bình' : 'Nguy cơ Thấp'}
                      </span>
                    </div>
                    <p className="text-xs text-muted leading-relaxed">{d.explanation}</p>
                    <div className="pt-2 border-t border-rule">
                      <span className="text-[11px] font-semibold text-brand-900 block mb-1">
                        Gợi ý bù đắp an toàn (không xung đột bệnh lý):
                      </span>
                      <ul className="space-y-1">
                        {(d.safe_food_remedies ?? []).map((rem, rIdx) => (
                          <li key={rIdx} className="text-[11px] text-ink flex items-start gap-1.5">
                            <Check className="w-3.5 h-3.5 text-brand shrink-0 mt-0.5" />
                            <span>{rem}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="font-semibold text-xs text-ink uppercase tracking-wider flex items-center gap-1.5">
                <HeartPulse className="w-4 h-4 text-brand" /> Tiên lượng Phục hồi Cơ quan sau 30 Ngày:
              </h4>
              <div className="space-y-2.5">
                {(prediction.organ_projections ?? []).map((org, i) => (
                  <div key={i} className="p-3.5 rounded-[8px] bg-paper border border-rule space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm text-ink">
                        {organNames[org.organ_id] || org.organ_id}
                      </span>
                      <span className="px-2 py-0.5 rounded-[6px] text-[10px] font-semibold bg-sage-50 text-brand border border-brand/25">
                        {org.status}
                      </span>
                    </div>
                    <p className="text-xs text-ink leading-relaxed">{org.projection}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-6 px-4 space-y-2">
          <p className="text-xs text-muted">
            Chưa có dữ liệu dự báo 7 ngày. Hãy nhấn nút phía trên để phân tích thói quen ăn uống, phát hiện nguy cơ thiếu vi chất và dự báo tình trạng nội tạng.
          </p>
        </div>
      )}
    </Card>
  )
}
