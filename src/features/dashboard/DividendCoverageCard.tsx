/**
 * 배당 커버리지 카드 — DashboardPage에서 분리.
 * 최근 3개월 배당수입/고정비 집계(dividendCoverage)를 카드가 소유한다.
 * React.memo로 감싸므로 부모가 넘기는 props는 안정적(store 참조·원시값)이어야 한다.
 */
import React, { useMemo } from "react";
import type { Account, CategoryPresets, LedgerEntry } from "../../types";
import { formatKRW } from "../../utils/formatter";
import { shiftMonth } from "../../utils/date";
import { getCategoryType, isSavingsExpenseEntry, isCreditPayment } from "../../utils/category";

function isDividendIncome(entry: LedgerEntry): boolean {
  if (entry.kind !== "income") return false;
  return (
    (entry.category ?? "").includes("배당") ||
    (entry.subCategory ?? "").includes("배당") ||
    (entry.description ?? "").includes("배당")
  );
}

interface Props {
  ledger: LedgerEntry[];
  accounts: Account[];
  categoryPresets: CategoryPresets;
  fxRate: number | null;
  currentMonth: string;
}

export const DividendCoverageCard: React.FC<Props> = React.memo(function DividendCoverageCard({
  ledger,
  accounts,
  categoryPresets,
  fxRate,
  currentMonth,
}) {
  const dividendCoverage = useMemo(() => {
    // 진행 중인 이번달을 넣으면 평균이 체계적으로 과소 — 완결된 직전 3개월만 사용
    const months = [shiftMonth(currentMonth, -3), shiftMonth(currentMonth, -2), shiftMonth(currentMonth, -1)];
    const monthSetRecent = new Set(months);
    const toKrw = (entry: LedgerEntry) =>
      entry.currency === "USD" && fxRate ? entry.amount * fxRate : entry.amount;
    const dividendByMonth = new Map<string, number>();
    const fixedByMonth = new Map<string, number>();

    for (const entry of ledger) {
      const month = entry.date?.slice(0, 7);
      if (!month || !monthSetRecent.has(month)) continue;

      if (isDividendIncome(entry)) {
        dividendByMonth.set(month, (dividendByMonth.get(month) ?? 0) + toKrw(entry));
        continue;
      }
      if (entry.kind !== "expense") continue;
      // 신용결제(카드 청구액 결제 이체)는 실제 지출의 중복 — 고정비 집계에서 제외 (subCategory 레거시 포함)
      if (isCreditPayment(entry)) continue;
      if (isSavingsExpenseEntry(entry, accounts, categoryPresets)) continue;
      const categoryType = getCategoryType(
        entry.category,
        entry.subCategory,
        entry.kind,
        categoryPresets,
        entry,
        accounts
      );
      if (categoryType === "fixed" || entry.isFixedExpense) {
        fixedByMonth.set(month, (fixedByMonth.get(month) ?? 0) + toKrw(entry));
      }
    }

    const rows = months.map((month) => {
      const dividend = dividendByMonth.get(month) ?? 0;
      const fixedExpense = fixedByMonth.get(month) ?? 0;
      return {
        month,
        dividend,
        fixedExpense,
        coverageRate: fixedExpense > 0 ? (dividend / fixedExpense) * 100 : null
      };
    });

    const monthlyDividendAvg =
      rows.reduce((sum, row) => sum + row.dividend, 0) / months.length;
    const monthlyFixedExpenseAvg =
      rows.reduce((sum, row) => sum + row.fixedExpense, 0) / months.length;
    const coverageRate =
      monthlyFixedExpenseAvg > 0
        ? (monthlyDividendAvg / monthlyFixedExpenseAvg) * 100
        : null;

    return {
      months,
      rows,
      monthlyDividendAvg,
      monthlyFixedExpenseAvg,
      coverageRate
    };
  }, [ledger, fxRate, accounts, categoryPresets, currentMonth]);

  const isCovered =
    dividendCoverage.coverageRate != null && dividendCoverage.coverageRate >= 100;
  const widthPct =
    dividendCoverage.monthlyFixedExpenseAvg > 0
      ? Math.min(
          100,
          (dividendCoverage.monthlyDividendAvg / dividendCoverage.monthlyFixedExpenseAvg) * 100
        )
      : 0;

  return (
    <div className="card" style={{ minHeight: 180 }}>
      <div className="card-title">배당 금액 상세 (직전 3개월 평균)</div>
      <div
        className="card-value"
        style={{
          fontSize: 26,
          // 고정비가 없어 비율을 못 구하면(null) 나쁨(danger)이 아니라 중립색
          color:
            dividendCoverage.coverageRate == null
              ? "var(--text-muted)"
              : isCovered ? "var(--primary)" : "var(--danger)",
        }}
      >
        {dividendCoverage.coverageRate == null ? "-" : `${dividendCoverage.coverageRate.toFixed(1)}%`}
      </div>
      <div className="hint" style={{ marginTop: 6, fontSize: 14 }}>
        배당 {formatKRW(Math.round(dividendCoverage.monthlyDividendAvg))}
        {" / 고정비 "}
        {formatKRW(Math.round(dividendCoverage.monthlyFixedExpenseAvg))}
      </div>
      <div
        style={{
          marginTop: 16,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div
          style={{
            flex: 1,
            position: "relative",
            height: 28,
            minWidth: 60,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "var(--chart-expense)",
              opacity: 0.3,
              borderRadius: 6,
            }}
            aria-hidden
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              top: "50%",
              transform: "translateY(-50%)",
              height: 10,
              width: `${widthPct}%`,
              minWidth: dividendCoverage.monthlyDividendAvg > 0 ? 4 : 0,
              background: "var(--chart-income)",
              borderRadius: 4,
            }}
          />
        </div>
        <span
          style={{
            flexShrink: 0,
            fontSize: 15,
            fontWeight: 700,
            color: isCovered ? "var(--primary)" : "var(--text)",
          }}
        >
          커버리지 {dividendCoverage.coverageRate == null ? "-" : `${dividendCoverage.coverageRate.toFixed(1)}%`}
        </span>
      </div>
    </div>
  );
});
