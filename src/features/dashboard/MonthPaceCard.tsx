import React from "react";
import { formatKRW } from "../../utils/formatter";

export interface MonthPaceData {
  currentExpense: number;
  projectedExpense: number;
  avgPrev3: number;
  elapsed: number;
  totalDays: number;
  pace: number | null;
}

interface Props {
  currentMonth: string;
  data: MonthPaceData;
}

export const MonthPaceCard: React.FC<Props> = ({ currentMonth, data }) => {
  const barMax = data.avgPrev3 * 1.5;
  const projPct = barMax > 0 ? Math.min(100, (data.projectedExpense / barMax) * 100) : 0;
  const avgPct = barMax > 0 ? (data.avgPrev3 / barMax) * 100 : 0;

  return (
    <div className="card">
      <div className="card-title" style={{ marginBottom: 12 }}>이번 달 페이스 예측 ({currentMonth})</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
          gap: 12,
          marginBottom: 16
        }}
      >
        <div style={{ padding: "10px 12px", background: "var(--surface)", borderRadius: 8 }}>
          <div className="hint" style={{ fontSize: 14 }}>현재 지출</div>
          <div style={{ fontWeight: 700, fontSize: 22 }}>{formatKRW(Math.round(data.currentExpense))}</div>
          <div className="hint" style={{ fontSize: 13 }}>{data.elapsed}일 / {data.totalDays}일</div>
        </div>
        <div style={{ padding: "10px 12px", background: "var(--surface)", borderRadius: 8 }}>
          <div className="hint" style={{ fontSize: 14 }}>이달 예상 (페이스)</div>
          <div
            style={{
              fontWeight: 700,
              fontSize: 22,
              color: data.pace != null && data.pace > 110 ? "var(--chart-expense)" : "var(--text)"
            }}
          >
            {formatKRW(Math.round(data.projectedExpense))}
          </div>
          {data.pace != null && (
            <div
              className="hint"
              style={{ fontSize: 13, color: data.pace > 100 ? "var(--chart-expense)" : "var(--chart-income)" }}
            >
              평균 대비 {data.pace > 100 ? "+" : ""}{(data.pace - 100).toFixed(1)}%
            </div>
          )}
        </div>
        <div style={{ padding: "10px 12px", background: "var(--surface)", borderRadius: 8 }}>
          <div className="hint" style={{ fontSize: 14 }}>최근 3달 평균</div>
          <div style={{ fontWeight: 700, fontSize: 22 }}>{formatKRW(Math.round(data.avgPrev3))}</div>
        </div>
      </div>
      {data.avgPrev3 > 0 && (
        <div>
          <div style={{ position: "relative", height: 12, background: "var(--border)", borderRadius: 6, overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${projPct}%`,
                background: projPct > avgPct ? "var(--chart-expense)" : "var(--chart-income)",
                borderRadius: 6,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: `${avgPct}%`,
                top: 0,
                bottom: 0,
                width: 2,
                background: "var(--text-muted)",
              }}
            />
          </div>
          <div className="hint" style={{ marginTop: 6, fontSize: 13 }}>
            세로선 = 3달 평균. 막대 최대 = 평균 × 1.5
          </div>
        </div>
      )}
    </div>
  );
};
