/**
 * 월별 추이 (최근 6개월) 카드 — DashboardPage에서 분리.
 * 월별 수입/지출/재테크 집계(monthlyTrendData)를 카드가 소유한다.
 * 분류는 summaryMath.classifyLedgerFlow 단일 기준 — "재테크" 정의(저축·투자 이체 +
 * 레거시 저축성지출)가 요약 카드·소비 캘린더와 동일하다.
 * React.memo로 감싸므로 부모가 넘기는 props는 안정적(store 참조·원시값)이어야 한다.
 */
import React, { useMemo } from "react";
import type { CategoryPresets, LedgerEntry } from "../../types";
import { formatKRW } from "../../utils/formatter";
import { classifyLedgerFlow, toKrwAmount } from "./summaryMath";

interface Props {
  ledger: LedgerEntry[];
  categoryPresets: CategoryPresets;
  fxRate: number | null;
}

export const MonthlyTrendCard: React.FC<Props> = React.memo(function MonthlyTrendCard({
  ledger,
  categoryPresets,
  fxRate,
}) {
  const monthlyTrendData = useMemo(() => {
    const map = new Map<string, { income: number; expense: number; investing: number }>();
    ledger.forEach((entry) => {
      if (!entry.date) return;
      // 단일 분류 기준: 신용결제·일반 이체 제외, 레거시 저축성지출·저축/투자이체 = 재테크
      const flow = classifyLedgerFlow(entry, categoryPresets);
      if (!flow) return;
      const m = entry.date.slice(0, 7);
      if (!map.has(m)) map.set(m, { income: 0, expense: 0, investing: 0 });
      const row = map.get(m)!;
      row[flow] += toKrwAmount(entry, fxRate);
    });
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-6)
      .map(([month, data]) => ({
        month: month.slice(5),
        ...data
      }));
  }, [ledger, fxRate, categoryPresets]);

  const maxVal = Math.max(
    ...monthlyTrendData.map((r) => Math.max(r.income, r.expense + r.investing))
  );

  // 빈 상태 — 집계할 기록이 없으면 범례 대신 안내 문구
  if (monthlyTrendData.length === 0) {
    return (
      <div className="card">
        <div className="card-title">월별 추이 (최근 6개월)</div>
        <p style={{ marginTop: 12, fontSize: 14, color: "var(--text-muted)" }}>
          아직 집계할 기록이 없습니다. 가계부에 수입·지출을 입력하면 월별 추이가 표시됩니다.
        </p>
      </div>
    );
  }

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
