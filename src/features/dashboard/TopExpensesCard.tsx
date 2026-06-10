/**
 * 이번 달 지출 Top 5 카드 — DashboardPage에서 분리.
 * 카테고리별 지출 집계(topCategoriesThisMonth)를 카드가 소유한다.
 * React.memo로 감싸므로 부모가 넘기는 props는 안정적(store 참조·원시값)이어야 한다.
 */
import React, { useMemo } from "react";
import type { Account, CategoryPresets, LedgerEntry } from "../../types";
import { formatKRW } from "../../utils/formatter";
import { isSavingsExpenseEntry } from "../../utils/category";

interface Props {
  currentMonth: string;
  ledger: LedgerEntry[];
  accounts: Account[];
  categoryPresets: CategoryPresets;
  fxRate: number | null;
}

export const TopExpensesCard: React.FC<Props> = React.memo(function TopExpensesCard({
  currentMonth,
  ledger,
  accounts,
  categoryPresets,
  fxRate,
}) {
  const topCategoriesThisMonth = useMemo(() => {
    const toKrw = (entry: LedgerEntry) =>
      entry.currency === "USD" && fxRate ? entry.amount * fxRate : entry.amount;
    const catMap = new Map<string, number>();
    ledger.forEach((entry) => {
      if (!entry.date?.startsWith(currentMonth)) return;
      if (entry.kind !== "expense") return;
      // 재테크(투자손실)·신용결제·저축성지출은 생활비 Top 5에서 제외
      if (entry.category === "재테크" || entry.category === "신용결제") return;
      if (isSavingsExpenseEntry(entry, accounts, categoryPresets)) return;
      const cat = entry.subCategory || entry.category || "기타";
      catMap.set(cat, (catMap.get(cat) ?? 0) + toKrw(entry));
    });
    return Array.from(catMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [ledger, currentMonth, fxRate, accounts, categoryPresets]);

  return (
    <div className="card">
      <div className="card-title">이번 달 지출 Top 5 ({currentMonth})</div>
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {topCategoriesThisMonth.length === 0 && (
          <div className="hint">이번 달 지출 데이터가 없습니다.</div>
        )}
        {topCategoriesThisMonth.map(([cat, amount], i) => {
          const maxAmt = topCategoriesThisMonth[0]?.[1] ?? 1;
          const pct = (amount / maxAmt) * 100;
          return (
            <div key={cat}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, marginBottom: 4 }}>
                <span style={{ fontWeight: 600 }}>{i + 1}. {cat}</span>
                <span style={{ fontWeight: 700, color: "var(--chart-expense)" }}>{formatKRW(Math.round(amount))}</span>
              </div>
              <div style={{ height: 8, background: "var(--border)", borderRadius: 4 }}>
                <div style={{ height: "100%", width: `${pct}%`, background: "var(--chart-expense)", borderRadius: 4, opacity: 1 - i * 0.15 }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
