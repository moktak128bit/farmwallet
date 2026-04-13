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
  // For expense: increase = bad (danger); for income: increase = good (success)
  const isUp = delta > 0;
  if (kind === "expense") return isUp ? "var(--danger)" : "var(--success)";
  return isUp ? "var(--success)" : "var(--danger)";
};

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
            {arrow(current - previousMonth)} {Math.abs(diffPrevMonthPct).toFixed(1)}%
          </span>
          <div style={{ color: "var(--text-muted)", fontSize: 11 }}>{formatNumber(previousMonth)}</div>
        </div>
        <div>
          <span style={{ color: "var(--text-muted)" }}>전년 동월:</span>{" "}
          <span style={{ color: tone(current - previousYearSameMonth, kind) }}>
            {arrow(current - previousYearSameMonth)} {Math.abs(diffPrevYearPct).toFixed(1)}%
          </span>
          <div style={{ color: "var(--text-muted)", fontSize: 11 }}>{formatNumber(previousYearSameMonth)}</div>
        </div>
      </div>
    </div>
  );
};
