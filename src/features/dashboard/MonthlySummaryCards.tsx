import React from "react";
import { formatKRW } from "../../utils/formatter";
import { EXPENSE_BOX_EXCLUDED_NAMES } from "./summaryMath";

interface Summary {
  income: number;
  expense: number;
  investing: number;
  /** 지출 중 제외 대상(데이터비 등) 합계 — '제외 후' 보조 표시용 (없으면 0/미정) */
  excludedExpense?: number;
}

const EXCLUDED_LABEL = EXPENSE_BOX_EXCLUDED_NAMES.join("·");

interface Props {
  monthlySummary: Summary;
  allTimeSummary: Summary;
}

// React.memo — 부모(DashboardPage)가 넘기는 props는 안정적(useMemo 결과)이어야 한다.
export const MonthlySummaryCards: React.FC<Props> = React.memo(function MonthlySummaryCards({ monthlySummary, allTimeSummary }) {
  const balance = monthlySummary.income - monthlySummary.expense;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 16
      }}
    >
      <div className="card" style={{ minHeight: 124, borderLeft: "4px solid var(--chart-income)" }}>
        <div className="card-title">이번 달 수입 (근로소득)</div>
        <div className="card-value" style={{ color: "var(--chart-income)", fontSize: 28 }}>
          {formatKRW(Math.round(monthlySummary.income))}
        </div>
        <div className="hint" style={{ marginTop: 8 }}>전체 기간: {formatKRW(allTimeSummary.income)} · 월급·수당·상여만</div>
      </div>

      <div className="card" style={{ minHeight: 124, borderLeft: "4px solid var(--chart-expense)" }}>
        <div className="card-title">이번 달 지출</div>
        <div className="card-value" style={{ color: "var(--chart-expense)", fontSize: 28 }}>
          {formatKRW(Math.round(monthlySummary.expense))}
        </div>
        {(monthlySummary.excludedExpense ?? 0) > 0 && (
          <div className="hint" style={{ marginTop: 6, fontWeight: 600 }}>
            {EXCLUDED_LABEL} 제외: {formatKRW(Math.round(monthlySummary.expense - (monthlySummary.excludedExpense ?? 0)))}
          </div>
        )}
        <div className="hint" style={{ marginTop: 8 }}>
          전체 기간: {formatKRW(allTimeSummary.expense)}
        </div>
      </div>

      <div className="card" style={{ minHeight: 124, borderLeft: "4px solid var(--chart-primary)" }}>
        <div className="card-title">이번 달 재테크</div>
        <div className="card-value" style={{ color: "var(--chart-primary)", fontSize: 28 }}>
          {formatKRW(Math.round(monthlySummary.investing))}
        </div>
        <div className="hint" style={{ marginTop: 8 }}>전체 기간: {formatKRW(allTimeSummary.investing)}</div>
      </div>

      <div className="card" style={{ minHeight: 124, borderLeft: "4px solid var(--success)" }}>
        <div className="card-title">이번 달 수지</div>
        <div className="card-value" style={{ color: balance >= 0 ? "var(--success)" : "var(--danger)", fontSize: 28 }}>
          {formatKRW(Math.round(balance))}
        </div>
        <div className="hint" style={{ marginTop: 8 }}>근로소득 − 지출</div>
      </div>
    </div>
  );
});
