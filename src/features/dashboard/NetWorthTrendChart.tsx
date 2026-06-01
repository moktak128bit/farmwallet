import React, { useRef, useState } from "react";

export interface NetWorthTrendPoint {
  month: string;
  value: number;
  asset: number;
  debt: number;
}

interface Props {
  data: NetWorthTrendPoint[];
}

export const NetWorthTrendChart: React.FC<Props> = ({ data }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (data.length < 2) return null;

  const values = data.map((d) => d.value);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;
  const PAD_L = 64;
  const PAD_R = 20;
  const PAD_T = 20;
  const PAD_B = 36;
  const W = 720;
  const H = 260;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;
  const n = data.length;

  const toX = (i: number) => PAD_L + (i / (n - 1)) * chartW;
  const toY = (v: number) => PAD_T + chartH - ((v - minVal) / range) * chartH;

  const pts = data.map((d, i) => ({ x: toX(i), y: toY(d.value), ...d }));
  const polyline = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const areaPath =
    `M${pts[0].x},${PAD_T + chartH} ` +
    pts.map((p) => `L${p.x},${p.y}`).join(" ") +
    ` L${pts[pts.length - 1].x},${PAD_T + chartH} Z`;

  const currentPt = pts[pts.length - 1];
  const currentWorth = data[data.length - 1].value;
  const prevWorth = data[data.length - 2]?.value ?? currentWorth;
  const nwDelta = currentWorth - prevWorth;
  const nwDeltaPct = Number.isFinite(prevWorth) && prevWorth !== 0 ? (nwDelta / prevWorth) * 100 : 0;
  const nwDeltaColor = nwDelta > 0 ? "var(--success)" : nwDelta < 0 ? "var(--danger)" : "var(--muted)";
  const nwArrow = nwDelta > 0 ? "▲" : nwDelta < 0 ? "▼" : "–";

  const yTicks = [minVal, Math.round((minVal + maxVal) / 2), maxVal];
  const labelStep = n <= 12 ? 1 : n <= 24 ? 2 : n <= 36 ? 3 : 6;
  const xLabels = pts.filter((_, i) => i % labelStep === 0 || i === n - 1);

  const gradId = "nwt-grad";

  // 호버 인터랙션 — 마우스 x좌표로 가장 가까운 데이터 포인트 찾기
  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return;
    const xRatio = (e.clientX - rect.left) / rect.width;
    const svgX = xRatio * W;
    if (svgX < PAD_L - 8 || svgX > W - PAD_R + 8) {
      setHoverIdx(null);
      return;
    }
    let nearest = 0;
    let minDist = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const dist = Math.abs(pts[i].x - svgX);
      if (dist < minDist) {
        minDist = dist;
        nearest = i;
      }
    }
    setHoverIdx(nearest);
  };
  const handleLeave = () => setHoverIdx(null);

  const hover = hoverIdx != null ? pts[hoverIdx] : null;
  const TT_W = 168;
  const TT_H = 84;
  const ttX = hover ? (hover.x < W / 2 ? hover.x + 12 : hover.x - 12 - TT_W) : 0;
  const ttY = hover ? Math.max(PAD_T, Math.min(hover.y - TT_H / 2, PAD_T + chartH - TT_H)) : 0;
  const fmt = (v: number) => (v >= 0 ? "" : "-") + Math.abs(v).toLocaleString() + "만원";

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div className="card-title" style={{ margin: 0, fontSize: 17 }}>순자산 추이 <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 400 }}>(전체 계좌 − 부채)</span></div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 700, fontSize: 30, color: "var(--primary)" }}>
            {currentWorth >= 0 ? "" : "-"}{Math.abs(currentWorth).toLocaleString()}만원
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "flex-end", marginTop: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: nwDeltaColor }}>
              {nwArrow} {Math.abs(nwDelta).toLocaleString()}만원
            </span>
            <span style={{ fontSize: 13, color: nwDeltaColor }}>
              ({nwDelta >= 0 ? "+" : ""}{nwDeltaPct.toFixed(1)}%)
            </span>
          </div>
          <div className="hint" style={{ fontSize: 13 }}>현재 순자산 · 전월 대비</div>
        </div>
      </div>
      <div style={{ width: "100%", overflowX: "auto" }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          style={{ display: "block", minWidth: 320, maxHeight: 300 }}
          aria-label="순자산 추이 차트"
          onMouseMove={handleMove}
          onMouseLeave={handleLeave}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary, #2563eb)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--primary, #2563eb)" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {yTicks.map((tick) => {
            const y = toY(tick);
            const label = tick >= 0
              ? `${tick.toLocaleString()}`
              : `-${Math.abs(tick).toLocaleString()}`;
            return (
              <g key={tick}>
                <line
                  x1={PAD_L} y1={y} x2={W - PAD_R} y2={y}
                  stroke="var(--border, #e5e7eb)" strokeWidth={1} strokeDasharray="3 3"
                />
                <text
                  x={PAD_L - 6} y={y + 5}
                  textAnchor="end"
                  fontSize={13}
                  fill="var(--text-muted, #9ca3af)"
                >
                  {label}
                </text>
              </g>
            );
          })}

          <path d={areaPath} fill={`url(#${gradId})`} />

          <polyline
            points={polyline}
            fill="none"
            stroke="var(--primary, #2563eb)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {pts.map((p, i) => (
            <circle
              key={i}
              cx={p.x} cy={p.y} r={2.5}
              fill="var(--primary, #2563eb)"
              opacity={0.6}
            />
          ))}

          <circle
            cx={currentPt.x} cy={currentPt.y} r={5}
            fill="var(--primary, #2563eb)"
            stroke="var(--bg, #fff)" strokeWidth={2}
          />

          {xLabels.map((p) => (
            <text
              key={p.month}
              x={p.x} y={H - 10}
              textAnchor="middle"
              fontSize={12}
              fill="var(--text-muted, #9ca3af)"
            >
              {p.month.slice(2)}
            </text>
          ))}

          {/* 호버: 세로 가이드 + 강조 점 + 툴팁 */}
          {hover && (
            <g pointerEvents="none">
              <line
                x1={hover.x} y1={PAD_T} x2={hover.x} y2={PAD_T + chartH}
                stroke="var(--text-muted, #9ca3af)" strokeWidth={1} strokeDasharray="3 3"
              />
              <circle
                cx={hover.x} cy={hover.y} r={6}
                fill="var(--primary, #2563eb)"
                stroke="var(--bg, #fff)" strokeWidth={2.5}
              />
              <g transform={`translate(${ttX}, ${ttY})`}>
                <rect
                  width={TT_W} height={TT_H} rx={6} ry={6}
                  fill="var(--bg, #fff)"
                  stroke="var(--border, #d1d5db)" strokeWidth={1}
                  opacity={0.97}
                />
                <text x={10} y={18} fontSize={13} fontWeight={700} fill="var(--text, #111)">
                  {hover.month}
                </text>
                <text x={10} y={38} fontSize={12} fill="var(--text, #111)">
                  자산
                  <tspan x={TT_W - 10} textAnchor="end" fontWeight={600}>{fmt(hover.asset)}</tspan>
                </text>
                <text x={10} y={56} fontSize={12} fill="var(--text, #111)">
                  부채
                  <tspan x={TT_W - 10} textAnchor="end" fontWeight={600} fill="var(--danger, #dc2626)">−{Math.abs(hover.debt).toLocaleString()}만원</tspan>
                </text>
                <line x1={8} y1={62} x2={TT_W - 8} y2={62} stroke="var(--border, #e5e7eb)" strokeWidth={1} />
                <text x={10} y={76} fontSize={12} fontWeight={700} fill="var(--primary, #2563eb)">
                  순자산
                  <tspan x={TT_W - 10} textAnchor="end">{fmt(hover.value)}</tspan>
                </text>
              </g>
            </g>
          )}
        </svg>
      </div>
      <div className="hint" style={{ fontSize: 13, marginTop: 6, textAlign: "right" }}>
        단위: 만원 · {data[0]?.month} ~ {data[data.length - 1]?.month}
      </div>
    </div>
  );
};
