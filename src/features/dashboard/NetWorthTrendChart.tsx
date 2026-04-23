import React from "react";

export interface NetWorthTrendPoint {
  month: string;
  value: number;
}

interface Props {
  data: NetWorthTrendPoint[];
}

export const NetWorthTrendChart: React.FC<Props> = ({ data }) => {
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
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          style={{ display: "block", minWidth: 320, maxHeight: 300 }}
          aria-label="순자산 추이 차트"
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
        </svg>
      </div>
      <div className="hint" style={{ fontSize: 13, marginTop: 6, textAlign: "right" }}>
        단위: 만원 · {data[0]?.month} ~ {data[data.length - 1]?.month}
      </div>
    </div>
  );
};
