import React, { useRef, useState } from "react";

interface NetWorthTrendPoint {
  month: string;
  value: number;
  asset: number;
  debt: number;
  /** 연금계좌(isPension) 순기여분 (만원). '연금 제외' 토글 시 value에서 차감. */
  pension: number;
}

interface Props {
  data: NetWorthTrendPoint[];
}

// React.memo — 부모(DashboardPage)가 넘기는 data는 안정적(useMemo 결과)이어야 한다.
export const NetWorthTrendChart: React.FC<Props> = React.memo(function NetWorthTrendChart({ data }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [excludePension, setExcludePension] = useState(false);

  // 빈 상태 — 카드가 통째로 사라지면 위젯이 있는 줄도 모르므로 안내를 보여준다
  if (data.length < 2) {
    return (
      <div className="card" style={{ padding: 20 }}>
        <div className="card-title" style={{ margin: 0, fontSize: 17 }}>
          순자산 추이 <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 400 }}>(전체 계좌 − 부채)</span>
        </div>
        <p style={{ marginTop: 12, marginBottom: 4, fontSize: 14, color: "var(--text-muted)" }}>
          월별 데이터가 2개 이상 쌓이면 추이 차트가 표시됩니다. 가계부·거래 기록을 입력해 보세요.
        </p>
      </div>
    );
  }

  const hasPension = data.some((d) => (d.pension ?? 0) !== 0);
  const showLiquid = excludePension && hasPension;
  const eff = (d: NetWorthTrendPoint) => d.value - (showLiquid ? (d.pension ?? 0) : 0);
  const values = data.map(eff);
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

  const pts = data.map((d, i) => ({ x: toX(i), y: toY(eff(d)), v: eff(d), ...d }));
  const polyline = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const areaPath =
    `M${pts[0].x},${PAD_T + chartH} ` +
    pts.map((p) => `L${p.x},${p.y}`).join(" ") +
    ` L${pts[pts.length - 1].x},${PAD_T + chartH} Z`;

  const currentPt = pts[pts.length - 1];
  const currentWorth = eff(data[data.length - 1]);
  const prevWorth = data[data.length - 2] ? eff(data[data.length - 2]) : currentWorth;
  const nwDelta = currentWorth - prevWorth;
  const nwDeltaPct = Number.isFinite(prevWorth) && prevWorth !== 0 ? (nwDelta / prevWorth) * 100 : 0;
  const nwDeltaColor = nwDelta > 0 ? "var(--success)" : nwDelta < 0 ? "var(--danger)" : "var(--text-muted)";
  const nwArrow = nwDelta > 0 ? "▲" : nwDelta < 0 ? "▼" : "–";

  // 값 범위가 좁으면 min/중간/max가 겹침 — 중복 제거 (React key 중복 방지)
  const yTicks = Array.from(new Set([minVal, Math.round((minVal + maxVal) / 2), maxVal]));
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
  const TT_W = 178;
  const TT_H = showLiquid ? 104 : 84;
  const ttX = hover ? (hover.x < W / 2 ? hover.x + 12 : hover.x - 12 - TT_W) : 0;
  const ttY = hover ? Math.max(PAD_T, Math.min(hover.y - TT_H / 2, PAD_T + chartH - TT_H)) : 0;
  const fmt = (v: number) => (v >= 0 ? "" : "-") + Math.abs(v).toLocaleString() + "만원";

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div className="card-title" style={{ margin: 0, fontSize: 17 }}>
            순자산 추이 <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 400 }}>
              {showLiquid ? "(연금 제외 · 유동 순자산)" : "(전체 계좌 − 부채)"}
            </span>
          </div>
          {hasPension && (
            <button
              type="button"
              onClick={() => setExcludePension((v) => !v)}
              aria-pressed={showLiquid}
              style={{
                fontSize: 12,
                padding: "3px 10px",
                borderRadius: 6,
                border: `1px solid ${showLiquid ? "var(--primary)" : "var(--border)"}`,
                background: showLiquid ? "var(--primary-light)" : "var(--surface)",
                color: showLiquid ? "var(--primary)" : "var(--text)",
                fontWeight: showLiquid ? 700 : 400,
                cursor: "pointer",
              }}
              title="연금계좌(퇴직연금·연금저축) 자산을 순자산에서 제외하고 봅니다"
            >
              연금 제외
            </button>
          )}
        </div>
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
                  {/* 부채 0이면 "−0만원" 대신 중립 "0만원" */}
                  <tspan
                    x={TT_W - 10}
                    textAnchor="end"
                    fontWeight={600}
                    fill={hover.debt === 0 ? "var(--text, #111)" : "var(--danger, #dc2626)"}
                  >
                    {hover.debt === 0 ? "0만원" : `−${Math.abs(hover.debt).toLocaleString()}만원`}
                  </tspan>
                </text>
                {showLiquid && (
                  <text x={10} y={74} fontSize={12} fill="var(--text, #111)">
                    연금(제외)
                    <tspan x={TT_W - 10} textAnchor="end" fontWeight={600} fill="var(--text-muted, #9ca3af)">
                      {`−${Math.abs(hover.pension).toLocaleString()}만원`}
                    </tspan>
                  </text>
                )}
                <line x1={8} y1={showLiquid ? 82 : 62} x2={TT_W - 8} y2={showLiquid ? 82 : 62} stroke="var(--border, #e5e7eb)" strokeWidth={1} />
                <text x={10} y={showLiquid ? 96 : 76} fontSize={12} fontWeight={700} fill="var(--primary, #2563eb)">
                  {showLiquid ? "유동순자산" : "순자산"}
                  <tspan x={TT_W - 10} textAnchor="end">{fmt(hover.v)}</tspan>
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
});
