import React, { useId, useState } from 'react';

/* ---------- Thẻ kính mờ dùng chung cho tooltip ---------- */
const Glass = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={style} className="backdrop-blur-md bg-white/95 shadow-xl border border-slate-100 rounded-xl p-3 text-xs text-slate-700 pointer-events-none">{children}</div>
);

/* ---------- Vòng tròn đồng tâm: Năng lượng + Macro ---------- */
export interface RingSpec { label: string; value: number; target: number; unit: string; from: string; to: string; note?: string }
export const RING_COLORS = {
  kcal: { from: '#10b981', to: '#34d399' },
  protein: { from: '#6366f1', to: '#818cf8' },
  carb: { from: '#f59e0b', to: '#fbbf24' },
  fat: { from: '#f43f5e', to: '#fb7185' },
};

export function MultiRing({ rings, centerValue, centerCaption }: { rings: RingSpec[]; centerValue: string; centerCaption: string }) {
  const uid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const base = 74, gap = 15, sw = 10;
  const h = hover !== null ? rings[hover] : null;
  return (
    <div>
      <div className="relative mx-auto w-48 h-48">
        <svg viewBox="0 0 180 180" className="w-full h-full -rotate-90" role="img" aria-label="Biểu đồ vòng đồng tâm năng lượng và macro">
          <defs>
            {rings.map((r, i) => (
              <linearGradient key={i} id={`${uid}-g${i}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={r.from} /><stop offset="1" stopColor={r.to} /></linearGradient>
            ))}
          </defs>
          {rings.map((r, i) => {
            const rad = base - i * gap, c = 2 * Math.PI * rad, f = Math.min(1, r.target ? r.value / r.target : 0);
            return (
              <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }} opacity={hover === null || hover === i ? 1 : 0.45}>
                <circle cx="90" cy="90" r={rad} fill="none" stroke="#e2e8f0" strokeWidth={sw} />
                <circle cx="90" cy="90" r={rad} fill="none" stroke={`url(#${uid}-g${i})`} strokeWidth={sw} strokeLinecap="round" strokeDasharray={`${c * f} ${c}`} style={{ transition: 'stroke-dasharray .8s ease' }} />
              </g>
            );
          })}
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center pointer-events-none">
          <div><p className="text-3xl font-bold tracking-tight text-slate-900 leading-none">{centerValue}</p><p className="text-[11px] text-slate-500 mt-1 px-8 leading-tight">{centerCaption}</p></div>
        </div>
      </div>
      <div className="relative min-h-[64px] mt-2">
        {h ? (
          <Glass><b className="text-slate-900">{h.label}</b>: {Math.round(h.value)} / {Math.round(h.target)} {h.unit} ({Math.round((h.value / (h.target || 1)) * 100)}%)<p className="text-slate-500 mt-0.5">{h.note || (h.value > h.target ? 'Đã vượt mục tiêu tham khảo hôm nay.' : 'Còn trong mục tiêu tham khảo.')}</p></Glass>
        ) : (
          <div className="flex flex-wrap justify-center gap-2">
            {rings.map((r, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 text-xs rounded-full bg-slate-100 px-2.5 py-1 text-slate-700"><i className="w-2 h-2 rounded-full" style={{ background: r.from }} />{r.label} {Math.round((r.value / (r.target || 1)) * 100)}%</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Biểu đồ vùng spline + ngưỡng an toàn ---------- */
export function AreaThreshold({ data, limit, unit, color = '#0ea5e9', limitLabel }: { data: { label: string; value: number }[]; limit: number; unit: string; color?: string; limitLabel: string }) {
  const uid = useId().replace(/:/g, '');
  const [hi, setHi] = useState<number | null>(null);
  const W = 560, H = 200, L = 40, R = 26, T = 14, B = 26;
  const top = Math.max(limit * 1.25, ...data.map((d) => d.value), 1);
  const X = (i: number) => L + (data.length > 1 ? (i / (data.length - 1)) * (W - L - R) : 0);
  const Y = (v: number) => T + (1 - v / top) * (H - T - B);
  const pts = data.map((d, i) => [X(i), Y(d.value)] as [number, number]);
  const line = pts.map((p, i) => (i ? `C${(pts[i - 1][0] + p[0]) / 2} ${pts[i - 1][1]} ${(pts[i - 1][0] + p[0]) / 2} ${p[1]} ${p[0]} ${p[1]}` : `M${p[0]} ${p[1]}`)).join(' ');
  const area = `${line} L${X(data.length - 1)} ${H - B} L${X(0)} ${H - B} Z`;
  const yl = Y(limit);
  const comment = (v: number) => (v <= 0 ? 'Chưa ghi nhật ký ngày này.' : v > limit ? `Vượt ngưỡng ${Math.round(v - limit)} ${unit}. Nên xem lại các món nhiều natri/năng lượng trong ngày.` : `Trong ngưỡng, còn dư ${Math.round(limit - v)} ${unit}.`);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Biểu đồ xu hướng so với ngưỡng an toàn">
        <defs>
          <linearGradient id={`${uid}-a`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".35" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient>
          <clipPath id={`${uid}-over`}><rect x="0" y="0" width={W} height={yl} /></clipPath>
        </defs>
        {[0, 0.5, 1].map((f) => (<g key={f}><line x1={L} x2={W - R} y1={T + f * (H - T - B)} y2={T + f * (H - T - B)} stroke="#e2e8f0" strokeWidth="1" /><text x={L - 6} y={T + f * (H - T - B) + 3} textAnchor="end" fontSize="9" fill="#94a3b8">{Math.round(top * (1 - f))}</text></g>))}
        <path d={area} fill={`url(#${uid}-a)`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
        <path d={line} fill="none" stroke="#f43f5e" strokeWidth="2.8" strokeLinecap="round" clipPath={`url(#${uid}-over)`} />
        <line x1={L} x2={W - R} y1={yl} y2={yl} stroke="#f43f5e" strokeWidth="1.4" strokeDasharray="6 4" />
        <text x={W - R} y={yl - 5} textAnchor="end" fontSize="10" fontWeight="600" fill="#e11d48">{limitLabel}</text>
        {data.map((d, i) => (<g key={i}><circle cx={X(i)} cy={Y(d.value)} r={hi === i ? 5.5 : 3.5} fill="#fff" stroke={d.value > limit ? '#f43f5e' : color} strokeWidth="2" /><text x={X(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="#64748b">{d.label}</text></g>))}
        {hi !== null && <line x1={X(hi)} x2={X(hi)} y1={T} y2={H - B} stroke="#94a3b8" strokeDasharray="3 3" />}
        {data.map((_, i) => (<rect key={i} x={X(i) - (W - L - R) / (data.length * 2)} y={0} width={(W - L - R) / data.length} height={H} fill="transparent" onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} />))}
      </svg>
      {hi !== null && (
        <div className="absolute z-10" style={{ left: `${(X(hi) / W) * 100}%`, top: 0, transform: `translateX(${hi > data.length / 2 ? '-105%' : '5%'})`, width: 210 }}>
          <Glass><b className="text-slate-900">{data[hi].label}: {Math.round(data[hi].value)} {unit}</b><p className="text-slate-500 mt-0.5">{comment(data[hi].value)}</p><p className="text-[10px] text-slate-400 mt-1">Nhận xét tự động theo ngưỡng tham chiếu mẫu.</p></Glass>
        </div>
      )}
    </div>
  );
}
