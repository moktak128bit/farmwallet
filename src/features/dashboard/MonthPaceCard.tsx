/**
 * 이번 달 페이스 예측 카드 — DashboardPage에서 분리.
 * 페이스 집계(monthPaceData)를 카드가 소유한다.
 * React.memo로 감싸므로 부모가 넘기는 props는 안정적(store 참조·원시값)이어야 한다.
 */
import React, { useMemo } from "react";
import type { Account, CategoryPresets, LedgerEntry } from "../../types";
import { formatKRW } from "../../utils/formatter";
import { shiftMonth } from "../../utils/date";
import { isSavingsExpenseEntry } from "../../utils/category";

interface Props {
  currentMonth: string;
  today: string;
  ledger: LedgerEntry[];
  accounts: Account[];
  categoryPresets: CategoryPresets;
  fxRate: number | null;
}

export const MonthPaceCard: React.FC<Props> = React.memo(function MonthPaceCard({
  currentMonth,
  today,
  ledger,
  accounts,
  categoryPresets,
  fxRate,
}) {
  // 페이스 = 현재까지 지출 추세로 월말 예상 지출 / 과거 3개월 평균 지출 × 100
  // 중요: 과거 3개월과 현재월은 같은 필터 정책을 써야 비교 의미가 있음
  //   → 저축성지출(재테크/저축 등)·신용결제(카드대금은 실제 지출의 이체) 제외
  const data = useMemo(() => {
    const [year, monthNum] = currentMonth.split("-").map(Number);
    const totalDays = new Date(year, monthNum, 0).getDate();
    const todayDay = parseInt(today.slice(8, 10), 10);
    const elapsed = Math.min(Math.max(todayDay, 1), totalDays);
    const toKrw = (entry: LedgerEntry) =>
      entry.currency === "USD" && fxRate ? entry.amount * fxRate : entry.amount;
    const sumMonth = (m: string) => {
      let total = 0;
      ledger.forEach((entry) => {
        if (!entry.date?.startsWith(m)) return;
        if (entry.kind !== "expense") return;
        if (entry.category === "신용결제") return;
        if (isSavingsExpenseEntry(entry, accounts, categoryPresets)) return;
        total += toKrw(entry);
      });
      return total;
    };
    const currentExpense = sumMonth(currentMonth);
    const projectedExpense = (currentExpense / elapsed) * totalDays;
    const prevTotals = [-1, -2, -3].map((offset) => sumMonth(shiftMonth(currentMonth, offset)));
    const avgPrev3 = prevTotals.reduce((s, v) => s + v, 0) / 3;
    return {
      currentExpense,
      projectedExpense,
      avgPrev3,
      elapsed,
      totalDays,
      pace: avgPrev3 > 0 ? (projectedExpense / avgPrev3) * 100 : null,
    };
  }, [currentMonth, today, ledger, fxRate, accounts, categoryPresets]);

  const barMax = data.avgPrev3 * 1.5;
  const projPct = barMax > 0 ? Math.min(100, (data.projectedExpense / barMax) * 100) : 0;
  const avgPct = barMax > 0 ? (data.avgPrev3 / barMax) * 100 : 0;

  return (
    <div className="card">
      <div className="card-title" style={{ marginBottom: 12 }}>이번 달 페이스 예측 ({currentMonth})</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
          gap: 12,
          marginBottom: 16
        }}
      >
        <div style={{ padding: "10px 12px", background: "var(--surface)", borderRadius: 8 }}>
          <div className="hint" style={{ fontSize: 14 }}>현재 지출</div>
          <div style={{ fontWeight: 700, fontSize: 22 }}>{formatKRW(Math.round(data.currentExpense))}</div>
          <div className="hint" style={{ fontSize: 13 }}>{data.elapsed}일 / {data.totalDays}일</div>
        </div>
        <div style={{ padding: "10px 12px", background: "var(--surface)", borderRadius: 8 }}>
          <div className="hint" style={{ fontSize: 14 }}>이달 예상 (페이스)</div>
          <div
            style={{
              fontWeight: 700,
              fontSize: 22,
              color: data.pace != null && data.pace > 110 ? "var(--chart-expense)" : "var(--text)"
            }}
          >
            {formatKRW(Math.round(data.projectedExpense))}
          </div>
          {data.pace != null && (
            <div
              className="hint"
              style={{ fontSize: 13, color: data.pace > 100 ? "var(--chart-expense)" : "var(--chart-income)" }}
            >
              평균 대비 {data.pace > 100 ? "+" : ""}{(data.pace - 100).toFixed(1)}%
            </div>
          )}
        </div>
        <div style={{ padding: "10px 12px", background: "var(--surface)", borderRadius: 8 }}>
          <div className="hint" style={{ fontSize: 14 }}>최근 3달 평균</div>
          <div style={{ fontWeight: 700, fontSize: 22 }}>{formatKRW(Math.round(data.avgPrev3))}</div>
        </div>
      </div>
      {data.avgPrev3 > 0 && (
        <div>
          <div style={{ position: "relative", height: 12, background: "var(--border)", borderRadius: 6, overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${projPct}%`,
                background: projPct > avgPct ? "var(--chart-expense)" : "var(--chart-income)",
                borderRadius: 6,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: `${avgPct}%`,
                top: 0,
                bottom: 0,
                width: 2,
                background: "var(--text-muted)",
              }}
            />
          </div>
          <div className="hint" style={{ marginTop: 6, fontSize: 13 }}>
            세로선 = 3달 평균. 막대 최대 = 평균 × 1.5
          </div>
        </div>
      )}
    </div>
  );
});
