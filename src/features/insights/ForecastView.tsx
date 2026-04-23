import React, { useMemo } from "react";
import type { LedgerEntry, RecurringExpense } from "../../types";
import { forecastNextMonth } from "../../utils/forecast";
import { Section } from "./insightsShared";

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
  const [lookback, setLookback] = React.useState(6);

  const result = useMemo(
    () => forecastNextMonth(ledger, recurring, currentMonth, lookback),
    [ledger, recurring, currentMonth, lookback]
  );

  const maxAmount = result.byCategory.reduce((m, c) => Math.max(m, c.upper), 0) || 1;

  // 현재월 실제 소진률 (카테고리별)
  const currentMonthSpend = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of ledger) {
      if (l.kind !== "expense" || l.amount <= 0 || !l.category || !l.date) continue;
      if (!l.date.startsWith(currentMonth)) continue;
      map.set(l.category, (map.get(l.category) ?? 0) + l.amount);
    }
    return map;
  }, [ledger, currentMonth]);

  const totalRecurring = result.byCategory.reduce((s, c) => s + c.recurringAmount, 0);
  const totalVariable = result.byCategory.reduce((s, c) => s + c.variableAverage, 0);
  const uncertaintyPct = result.totalForecast > 0
    ? Math.round(((result.totalUpper - result.totalLower) / 2 / result.totalForecast) * 100)
    : 0;
  const currentMonthActual = useMemo(() => {
    let sum = 0;
    for (const l of ledger) {
      if (l.kind !== "expense" || l.amount <= 0 || !l.date) continue;
      if (!l.date.startsWith(currentMonth)) continue;
      sum += l.amount;
    }
    return sum;
  }, [ledger, currentMonth]);

  const dayOfMonth = today.getDate();
  const daysInCurrentMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const projectedCurrent = dayOfMonth > 0 ? (currentMonthActual / dayOfMonth) * daysInCurrentMonth : 0;

  // 반복지출 월별 목록
  const monthlyRecurring = recurring.filter((r) => r.frequency === "monthly");

  return (
    <div>
      <div style={{ padding: "10px 14px", background: "#f8f9fa", borderRadius: 8, marginBottom: 16, fontSize: 12, color: "#666", lineHeight: 1.6 }}>
        ℹ️ 공식: <strong>MAX(반복지출 합, 최근 {lookback}개월 평균)</strong> · 신뢰구간 ±1σ · 기준: {monthLabel(result.baseMonth)} → 예측 <strong>{monthLabel(result.forecastMonth)}</strong>
        <span style={{ marginLeft: 10 }}>
          lookback:
          {[3, 6, 12].map((n) => (
            <button key={n} type="button" onClick={() => setLookback(n)}
              style={{
                marginLeft: 4, padding: "2px 8px", fontSize: 11, borderRadius: 4,
                border: lookback === n ? "1px solid #1a1a2e" : "1px solid #ccc",
                background: lookback === n ? "#1a1a2e" : "#fff",
                color: lookback === n ? "#fff" : "#666",
                cursor: "pointer", fontWeight: 600,
              }}
            >{n}M</button>
          ))}
        </span>
      </div>

      <Section storageKey="forecast-section-kpis" title="🔮 예측 요약">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <div style={{ padding: "14px 16px", background: "linear-gradient(135deg, #1a1a2e, #16213e)", borderRadius: 10, color: "#fff" }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", fontWeight: 600 }}>예상 총 지출</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: "#f0c040", marginTop: 4 }}>{formatNumber(result.totalForecast)}</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>
              {formatNumber(result.totalLower)} ~ {formatNumber(result.totalUpper)}
            </div>
          </div>
          <div style={{ padding: "14px 16px", background: "#f0f8ff", borderRadius: 10, border: "1px solid #bde" }}>
            <div style={{ fontSize: 11, color: "#666", fontWeight: 600 }}>반복 고정 지출</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#0f3460", marginTop: 4 }}>{formatNumber(totalRecurring)}</div>
            <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>
              {monthlyRecurring.length}개 항목 · 확정
            </div>
          </div>
          <div style={{ padding: "14px 16px", background: "#fdf5e6", borderRadius: 10, border: "1px solid #f0c040" }}>
            <div style={{ fontSize: 11, color: "#666", fontWeight: 600 }}>변동 지출 평균</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#d97706", marginTop: 4 }}>{formatNumber(totalVariable)}</div>
            <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>
              최근 {lookback}개월 평균
            </div>
          </div>
          <div style={{ padding: "14px 16px", background: uncertaintyPct > 30 ? "#fff5f5" : "#f0fdf4", borderRadius: 10, border: `1px solid ${uncertaintyPct > 30 ? "#fcc" : "#86efac"}` }}>
            <div style={{ fontSize: 11, color: "#666", fontWeight: 600 }}>불확실성</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: uncertaintyPct > 30 ? "#e94560" : "#059669", marginTop: 4 }}>±{uncertaintyPct}%</div>
            <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>
              {uncertaintyPct > 30 ? "변동 큼" : uncertaintyPct > 15 ? "보통" : "안정"}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12, padding: "12px 14px", background: "#f8f9fa", borderRadius: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: "#1a1a2e" }}>이번 달 진행 현황 ({currentMonth})</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, fontSize: 12 }}>
            <div>
              <div style={{ color: "#999", fontSize: 11 }}>현재 지출 ({dayOfMonth}일차)</div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{formatNumber(currentMonthActual)}</div>
            </div>
            <div>
              <div style={{ color: "#999", fontSize: 11 }}>이 속도면 월말</div>
              <div style={{ fontWeight: 700, fontSize: 16, color: projectedCurrent > result.totalForecast * 1.1 ? "#e94560" : "#059669" }}>
                {formatNumber(Math.round(projectedCurrent))}
              </div>
            </div>
            <div>
              <div style={{ color: "#999", fontSize: 11 }}>다음 달 예측 대비</div>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#0f3460" }}>
                {result.totalForecast > 0 ? Math.round((projectedCurrent / result.totalForecast) * 100) : 0}%
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section storageKey="forecast-section-breakdown" title="📋 카테고리별 예측">
        <div style={{ gridColumn: "span 4" }}>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", background: "#fff", borderRadius: 10, overflow: "hidden" }}>
            <thead>
              <tr style={{ background: "#f8f9fa", borderBottom: "2px solid #e0e0e0" }}>
                <th style={{ textAlign: "left", padding: "10px 12px", fontSize: 12, color: "#666" }}>카테고리</th>
                <th style={{ textAlign: "right", padding: "10px 12px", fontSize: 12, color: "#666" }}>반복</th>
                <th style={{ textAlign: "right", padding: "10px 12px", fontSize: 12, color: "#666" }}>변동평균</th>
                <th style={{ textAlign: "right", padding: "10px 12px", fontSize: 12, color: "#666" }}>예측</th>
                <th style={{ textAlign: "right", padding: "10px 12px", fontSize: 12, color: "#666" }}>현재월 실적</th>
                <th style={{ width: "25%", padding: "10px 12px", fontSize: 12, color: "#666" }}>분포</th>
              </tr>
            </thead>
            <tbody>
              {result.byCategory.map((c) => {
                const cur = currentMonthSpend.get(c.category) ?? 0;
                const pct = c.forecast > 0 ? (cur / c.forecast) * 100 : 0;
                return (
                  <tr key={c.category} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "10px 12px", fontWeight: 600 }}>{c.category}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: c.recurringAmount > 0 ? "#0f3460" : "#ccc" }}>{formatNumber(c.recurringAmount)}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: "#d97706" }}>{formatNumber(c.variableAverage)}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: "#1a1a2e" }}>{formatNumber(c.forecast)}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", fontSize: 12 }}>
                      <span style={{ color: pct > 100 ? "#e94560" : pct > 80 ? "#f0c040" : "#059669", fontWeight: 700 }}>
                        {formatNumber(cur)}
                      </span>
                      <div style={{ fontSize: 10, color: "#999" }}>{pct.toFixed(0)}%</div>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <div style={{ position: "relative", height: 8, background: "#f0f0f0", borderRadius: 4 }}>
                        <div style={{
                          position: "absolute",
                          left: `${(c.lower / maxAmount) * 100}%`,
                          width: `${((c.upper - c.lower) / maxAmount) * 100}%`,
                          height: "100%", background: "#999", opacity: 0.4, borderRadius: 4
                        }} />
                        <div style={{
                          position: "absolute",
                          left: `${(c.forecast / maxAmount) * 100}%`,
                          width: 3, height: "100%", background: "#e94560"
                        }} />
                        {cur > 0 && (
                          <div style={{
                            position: "absolute",
                            left: `${(cur / maxAmount) * 100}%`,
                            width: 3, height: "100%", background: "#059669"
                          }} title={`현재월 실적: ${formatNumber(cur)}`} />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {result.byCategory.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 20, textAlign: "center", color: "#999" }}>
                  예측에 사용할 데이터가 부족합니다.
                </td></tr>
              )}
            </tbody>
          </table>
          <div style={{ fontSize: 11, color: "#999", marginTop: 6, textAlign: "center" }}>
            빨간 선 = 예측값, 녹색 선 = 현재월 실적, 회색 바 = ±1σ 신뢰구간
          </div>
        </div>
      </Section>

      {monthlyRecurring.length > 0 && (
        <Section storageKey="forecast-section-recurring" title="🔁 반복지출 명세" defaultOpen={false}>
          <div style={{ gridColumn: "span 4" }}>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
              예측의 고정 부분에 포함되는 월별 반복지출 {monthlyRecurring.length}개 (합계 {formatNumber(totalRecurring)})
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
              {monthlyRecurring.map((r) => (
                <div key={r.id} style={{ padding: "10px 12px", background: "#f0f8ff", borderRadius: 8, border: "1px solid #bde", fontSize: 12 }}>
                  <div style={{ fontWeight: 700 }}>{r.title}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, color: "#666" }}>
                    <span>{r.category}</span>
                    <span style={{ fontWeight: 700, color: "#0f3460" }}>{formatNumber(r.amount)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Section>
      )}
    </div>
  );
};
