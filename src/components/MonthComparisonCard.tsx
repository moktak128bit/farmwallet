import React from "react";
import type { MonthComparison } from "../utils/monthComparison";

interface Props {
  title: string;
  comparison: MonthComparison;
  formatNumber: (n: number) => string;
}

const arrow = (delta: number) => delta > 0 ? "▲" : delta < 0 ? "▼" : "—";
const tone = (delta: number, kind: "expense" | "income"): string => {
  if (delta === 0) return "var(--text-muted)";
  // 지출: 증가 = 나쁨(danger) / 수입: 증가 = 좋음(success)
  const isUp = delta > 0;
  if (kind === "expense") return isUp ? "var(--danger)" : "var(--success)";
  return isUp ? "var(--success)" : "var(--danger)";
};

/** 비교 기준이 0이라 비율을 못 구하면(pct=null) "신규", 아니면 "▲ 12.3%" 형태 */
const pctLabel = (delta: number, pct: number | null): string =>
  pct == null ? "신규" : `${arrow(delta)} ${Math.abs(pct).toFixed(1)}%`;

export const MonthComparisonCard: React.FC<Props & { kind?: "expense" | "income" }> = ({
  title,
  comparison,
  formatNumber,
  kind = "expense"
}) => {
  const { current, previousMonth, previousYearSameMonth, diffPrevMonthPct, diffPrevYearPct } = comparison;
  return (
    <div style={{
      border: "1px solid var(--border)",
      borderRadius: 8,
      padding: 12,
      background: "var(--surface)"
    }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>{formatNumber(current)}</div>
      <div style={{ display: "flex", gap: 16, fontSize: 12 }}>
        <div>
          <span style={{ color: "var(--text-muted)" }}>전월:</span>{" "}
          <span style={{ color: tone(current - previousMonth, kind) }}>
            {pctLabel(current - previousMonth, diffPrevMonthPct)}
          </span>
          <div style={{ color: "var(--text-muted)", fontSize: 11 }}>{formatNumber(previousMonth)}</div>
        </div>
        <div>
          <span style={{ color: "var(--text-muted)" }}>전년 동월:</span>{" "}
          <span style={{ color: tone(current - previousYearSameMonth, kind) }}>
            {pctLabel(current - previousYearSameMonth, diffPrevYearPct)}
          </span>
          <div style={{ color: "var(--text-muted)", fontSize: 11 }}>{formatNumber(previousYearSameMonth)}</div>
        </div>
      </div>
    </div>
  );
};
