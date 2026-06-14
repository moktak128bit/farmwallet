import React, { useMemo } from "react";
import type { CategoryPresets, LedgerEntry } from "../../types";
import { formatKRW } from "../../utils/formatter";
import { compareMonths } from "../../utils/monthComparison";
import { MonthComparisonCard } from "../../components/MonthComparisonCard";
import { getThisMonthKST, getTodayKST } from "../../utils/date";

interface Props {
  ledger: LedgerEntry[];
  month: string;
  /** USD 항목 원화 환산용 — summaryMath와 동일 기준 (부모가 FxRateContext 값 전달) */
  fxRate: number | null;
  /** 레거시 저축성지출(재테크) 분류용 */
  categoryPresets?: CategoryPresets;
  /** 근로소득 키 — 지정 시 수입 비교는 근로소득(월급·수당·상여)만 (정산·용돈·배당 제외) */
  salaryKeys?: Set<string>;
}

// React.memo — 부모(DashboardPage)가 넘기는 props는 안정적(store 참조·원시값)이어야 한다.
export const ExpenseIncomeCompareCard: React.FC<Props> = React.memo(function ExpenseIncomeCompareCard({
  ledger,
  month,
  fxRate,
  categoryPresets,
  salaryKeys,
}) {
  // 진행 중인 이번 달이면 전월·전년도 같은 기간(1~오늘 일)만 비교 —
  // 부분 월 vs 완전한 월 비교 왜곡 방지 (월급 25일이면 월중 내내 수입 -90%대로 보이는 문제)
  const dayCap = month === getThisMonthKST() ? Number(getTodayKST().slice(8, 10)) : null;
  const expenseComparison = useMemo(
    () => compareMonths(ledger, month, "expense", fxRate, categoryPresets, dayCap),
    [ledger, month, fxRate, categoryPresets, dayCap]
  );
  const incomeComparison = useMemo(
    () => compareMonths(ledger, month, "income", fxRate, categoryPresets, dayCap, salaryKeys),
    [ledger, month, fxRate, categoryPresets, dayCap, salaryKeys]
  );

  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="card-title" style={{ margin: 0, fontSize: 17 }}>
        {month} 전월·전년 대비{dayCap != null ? ` (1~${dayCap}일 동기 비교)` : ""}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <MonthComparisonCard
          title={`${month} 지출`}
          comparison={expenseComparison}
          formatNumber={(n) => formatKRW(Math.round(n))}
          kind="expense"
        />
        <MonthComparisonCard
          title={`${month} 근로소득`}
          comparison={incomeComparison}
          formatNumber={(n) => formatKRW(Math.round(n))}
          kind="income"
        />
      </div>
    </div>
  );
});
