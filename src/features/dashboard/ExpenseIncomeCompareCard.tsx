import React, { useMemo } from "react";
import type { LedgerEntry } from "../../types";
import { formatKRW } from "../../utils/formatter";
import { compareMonths } from "../../utils/monthComparison";
import { detectSpendAnomalies } from "../../utils/anomaly";
import { MonthComparisonCard } from "../../components/MonthComparisonCard";

interface Props {
  ledger: LedgerEntry[];
  month: string;
}

export const ExpenseIncomeCompareCard: React.FC<Props> = ({ ledger, month }) => {
  const expenseComparison = useMemo(() => compareMonths(ledger, month, "expense"), [ledger, month]);
  const incomeComparison = useMemo(() => compareMonths(ledger, month, "income"), [ledger, month]);
  const anomalies = useMemo(() => detectSpendAnomalies(ledger, month, 6), [ledger, month]);
  const triggered = anomalies.filter((a) => a.isAnomaly);

  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="card-title" style={{ margin: 0, fontSize: 17 }}>
        {month} 전월·전년 대비
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <MonthComparisonCard
          title={`${month} 지출`}
          comparison={expenseComparison}
          formatNumber={(n) => formatKRW(Math.round(n))}
          kind="expense"
        />
        <MonthComparisonCard
          title={`${month} 수입`}
          comparison={incomeComparison}
          formatNumber={(n) => formatKRW(Math.round(n))}
          kind="income"
        />
      </div>

      {triggered.length > 0 && (
        <div style={{ padding: 12, borderLeft: "4px solid var(--danger)", background: "var(--surface)", borderRadius: 6 }}>
          <h3 style={{ margin: "0 0 8px 0", fontSize: 14 }}>이상치 감지 (z-score ≥ 2)</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {triggered.map((a) => (
              <span
                key={a.category}
                style={{
                  padding: "4px 10px",
                  background: a.severity === "extreme" ? "var(--danger)" : "var(--warning, #f59e0b)",
                  color: "white",
                  borderRadius: 12,
                  fontSize: 12,
                  fontWeight: 600
                }}
              >
                {a.category}: {a.percentChange > 0 ? "+" : ""}
                {a.percentChange.toFixed(0)}% (평균 {formatKRW(Math.round(a.averageAmount))})
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
