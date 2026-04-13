import React, { useMemo } from "react";
import type { LedgerEntry, RecurringExpense } from "../../types";
import { forecastNextMonth } from "../../utils/forecast";

interface Props {
  ledger: LedgerEntry[];
  recurring: RecurringExpense[];
  formatNumber: (n: number) => string;
}

const monthLabel = (yyyymm: string) => {
  const [y, m] = yyyymm.split("-").map(Number);
  return `${y}년 ${m}월`;
};

export const ForecastView: React.FC<Props> = ({ ledger, recurring, formatNumber }) => {
  const today = new Date();
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

  const result = useMemo(() => forecastNextMonth(ledger, recurring, currentMonth, 6), [ledger, recurring, currentMonth]);

  const maxAmount = result.byCategory.reduce((m, c) => Math.max(m, c.upper), 0) || 1;

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontSize: 18, marginBottom: 4 }}>다음 달 지출 예측</h2>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
        {monthLabel(result.baseMonth)} 기준 → <strong>{monthLabel(result.forecastMonth)}</strong> 예상.
        반복지출 합계 + 비반복 6개월 이동평균. 회색 막대는 ±1σ 신뢰구간.
      </p>

      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        gap: 12, marginBottom: 24
      }}>
        <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>예상 총 지출</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{formatNumber(result.totalForecast)}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            범위: {formatNumber(result.totalLower)} ~ {formatNumber(result.totalUpper)}
          </div>
        </div>
      </div>

      <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            <th style={{ textAlign: "left", padding: 6 }}>카테고리</th>
            <th style={{ textAlign: "right", padding: 6 }}>반복</th>
            <th style={{ textAlign: "right", padding: 6 }}>변동평균</th>
            <th style={{ textAlign: "right", padding: 6 }}>예측</th>
            <th style={{ width: "30%", padding: 6 }}>분포</th>
          </tr>
        </thead>
        <tbody>
          {result.byCategory.map((c) => (
            <tr key={c.category} style={{ borderBottom: "1px solid var(--border-soft, var(--border))" }}>
              <td style={{ padding: 6 }}>{c.category}</td>
              <td style={{ padding: 6, textAlign: "right" }}>{formatNumber(c.recurringAmount)}</td>
              <td style={{ padding: 6, textAlign: "right" }}>{formatNumber(c.variableAverage)}</td>
              <td style={{ padding: 6, textAlign: "right", fontWeight: 600 }}>{formatNumber(c.forecast)}</td>
              <td style={{ padding: 6 }}>
                <div style={{ position: "relative", height: 8, background: "var(--border-soft, #eee)", borderRadius: 4 }}>
                  <div style={{
                    position: "absolute",
                    left: `${(c.lower / maxAmount) * 100}%`,
                    width: `${((c.upper - c.lower) / maxAmount) * 100}%`,
                    height: "100%", background: "var(--text-muted)", opacity: 0.4, borderRadius: 4
                  }} />
                  <div style={{
                    position: "absolute",
                    left: `${(c.forecast / maxAmount) * 100}%`,
                    width: 3, height: "100%", background: "var(--primary, #3b82f6)"
                  }} />
                </div>
              </td>
            </tr>
          ))}
          {result.byCategory.length === 0 && (
            <tr><td colSpan={5} style={{ padding: 12, textAlign: "center", color: "var(--text-muted)" }}>
              예측에 사용할 데이터가 부족합니다.
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
