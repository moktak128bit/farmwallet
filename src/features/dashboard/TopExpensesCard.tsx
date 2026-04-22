import React from "react";
import { formatKRW } from "../../utils/formatter";

interface Props {
  currentMonth: string;
  topCategoriesThisMonth: [string, number][];
}

export const TopExpensesCard: React.FC<Props> = ({ currentMonth, topCategoriesThisMonth }) => {
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
};
