/**
 * 월별 추이 (최근 6개월) 카드 — DashboardPage에서 분리.
 * 월별 수입/지출/재테크 집계(monthlyTrendData)를 카드가 소유한다.
 * React.memo로 감싸므로 부모가 넘기는 props는 안정적(store 참조·원시값)이어야 한다.
 */
import React, { useMemo } from "react";
import type { Account, CategoryPresets, LedgerEntry } from "../../types";
import { formatKRW } from "../../utils/formatter";
import { isSavingsExpenseEntry } from "../../utils/category";

interface Props {
  ledger: LedgerEntry[];
  accounts: Account[];
  categoryPresets: CategoryPresets;
  fxRate: number | null;
}

export const MonthlyTrendCard: React.FC<Props> = React.memo(function MonthlyTrendCard({
  ledger,
  accounts,
  categoryPresets,
  fxRate,
}) {
  const monthlyTrendData = useMemo(() => {
    const toKrw = (entry: LedgerEntry) =>
      entry.currency === "USD" && fxRate ? entry.amount * fxRate : entry.amount;
    const map = new Map<string, { income: number; expense: number; investing: number }>();
    ledger.forEach((entry) => {
      if (!entry.date) return;
      const m = entry.date.slice(0, 7);
      if (!map.has(m)) map.set(m, { income: 0, expense: 0, investing: 0 });
      const row = map.get(m)!;
      if (entry.kind === "income") row.income += toKrw(entry);
      else if (entry.kind === "expense") {
        // 신용결제는 카드 결제 이체로 실제 지출의 중복 — expense 집계에서 제외 (topCategoriesThisMonth와 일관)
        if (entry.category === "신용결제") return;
        if (isSavingsExpenseEntry(entry, accounts, categoryPresets)) row.investing += toKrw(entry);
        else row.expense += toKrw(entry);
      }
    });
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-6)
      .map(([month, data]) => ({
        month: month.slice(5),
        ...data
      }));
  }, [ledger, fxRate, accounts, categoryPresets]);

  const maxVal = Math.max(
    ...monthlyTrendData.map((r) => Math.max(r.income, r.expense + r.investing))
  );

  return (
    <div className="card">
      <div className="card-title">월별 추이 (최근 6개월)</div>
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
        {monthlyTrendData.map((row) => {
          const incPct = maxVal > 0 ? (row.income / maxVal) * 100 : 0;
          const expPct = maxVal > 0 ? (row.expense / maxVal) * 100 : 0;
          const invPct = maxVal > 0 ? (row.investing / maxVal) * 100 : 0;
          return (
            <div key={row.month}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 4 }}>
                <span style={{ fontWeight: 600 }}>{row.month}</span>
                <span className="hint" style={{ fontSize: 13 }}>{formatKRW(Math.round(row.income))} / {formatKRW(Math.round(row.expense))}</span>
              </div>
              <div style={{ display: "flex", gap: 2, height: 10 }}>
                <div style={{ width: `${incPct}%`, background: "var(--chart-income)", borderRadius: 4, minWidth: row.income > 0 ? 2 : 0 }} />
                <div style={{ width: `${expPct}%`, background: "var(--chart-expense)", borderRadius: 4, minWidth: row.expense > 0 ? 2 : 0 }} />
                <div style={{ width: `${invPct}%`, background: "var(--chart-primary)", borderRadius: 4, minWidth: row.investing > 0 ? 2 : 0 }} />
              </div>
            </div>
          );
        })}
        <div className="hint" style={{ fontSize: 13, marginTop: 6 }}>
          <span style={{ color: "var(--chart-income)" }}>■</span> 수입 <span style={{ color: "var(--chart-expense)" }}>■</span> 지출 <span style={{ color: "var(--chart-primary)" }}>■</span> 재테크
        </div>
      </div>
    </div>
  );
});
