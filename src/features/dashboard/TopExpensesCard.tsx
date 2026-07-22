/**
 * 이번 달 지출 Top 5 카드 — DashboardPage에서 분리.
 * 카테고리별 지출 집계(topCategoriesThisMonth)를 카드가 소유한다.
 * React.memo로 감싸므로 부모가 넘기는 props는 안정적(store 참조·원시값)이어야 한다.
 */
import React, { useMemo } from "react";
import type { CategoryPresets, LedgerEntry } from "../../types";
import { formatKRW } from "../../utils/formatter";
import { classifyLedgerFlow } from "./summaryMath";
import { expenseMainName } from "../../utils/categoryMerge";
import { toKrwByRate } from "../../utils/currency";

interface Props {
  currentMonth: string;
  ledger: LedgerEntry[];
  categoryPresets: CategoryPresets;
  fxRate: number | null;
}

export const TopExpensesCard: React.FC<Props> = React.memo(function TopExpensesCard({
  currentMonth,
  ledger,
  categoryPresets,
  fxRate,
}) {
  const topCategoriesThisMonth = useMemo(() => {
    const toKrw = (entry: LedgerEntry) => toKrwByRate(entry.amount, entry.currency, fxRate);
    const catMap = new Map<string, number>();
    ledger.forEach((entry) => {
      if (!entry.date?.startsWith(currentMonth)) return;
      // 생활비 Top 5 = classifyLedgerFlow "expense" 단일 기준 — 신용결제(양 세대)·환전·
      // 저축성지출·투자손실 제외가 대시보드 요약과 동일. (예전엔 category만 비교해
      // sub="신용결제" 레거시가 Top5에 섞였고 환전 제외가 아예 없었다.)
      if (classifyLedgerFlow(entry, categoryPresets) !== "expense") return;
      const cat = expenseMainName(entry) || "기타";
      catMap.set(cat, (catMap.get(cat) ?? 0) + toKrw(entry));
    });
    return Array.from(catMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [ledger, currentMonth, fxRate, categoryPresets]);

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
