import React from "react";
import { formatKRW } from "../../utils/formatter";

interface Summary {
  income: number;
  expense: number;
  investing: number;
}

interface Props {
  monthlySummary: Summary;
  allTimeSummary: Summary;
}

export const MonthlySummaryCards: React.FC<Props> = ({ monthlySummary, allTimeSummary }) => {
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
        <div className="card-title">이번 달 수입</div>
        <div className="card-value" style={{ color: "var(--chart-income)", fontSize: 28 }}>
          {formatKRW(Math.round(monthlySummary.income))}
        </div>
        <div className="hint" style={{ marginTop: 8 }}>전체 기간: {formatKRW(allTimeSummary.income)}</div>
      </div>

      <div className="card" style={{ minHeight: 124, borderLeft: "4px solid var(--chart-expense)" }}>
        <div className="card-title">이번 달 지출</div>
        <div className="card-value" style={{ color: "var(--chart-expense)", fontSize: 28 }}>
          {formatKRW(Math.round(monthlySummary.expense))}
        </div>
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
        <div className="hint" style={{ marginTop: 8 }}>수입 − 지출 (장부 기준)</div>
      </div>
    </div>
  );
};
