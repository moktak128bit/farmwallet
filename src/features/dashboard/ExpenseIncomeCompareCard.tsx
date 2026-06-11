import React, { useMemo } from "react";
import type { LedgerEntry } from "../../types";
import { formatKRW } from "../../utils/formatter";
import { compareMonths } from "../../utils/monthComparison";
import { MonthComparisonCard } from "../../components/MonthComparisonCard";

interface Props {
  ledger: LedgerEntry[];
  month: string;
}

// React.memo — 부모(DashboardPage)가 넘기는 props는 안정적(store 참조·원시값)이어야 한다.
export const ExpenseIncomeCompareCard: React.FC<Props> = React.memo(function ExpenseIncomeCompareCard({ ledger, month }) {
  const expenseComparison = useMemo(() => compareMonths(ledger, month, "expense"), [ledger, month]);
  const incomeComparison = useMemo(() => compareMonths(ledger, month, "income"), [ledger, month]);

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
    </div>
  );
});
