import React, { useMemo } from "react";
import { Info } from "lucide-react";
import type { LedgerEntry, RecurringExpense } from "../../types";
import { forecastNextMonth, expenseMainTotalsForMonth, isForecastRecurringExpense } from "../../utils/forecast";
import { getThisMonthKST, shiftMonth } from "../../utils/date";
import { useFxRateValue } from "../../context/FxRateContext";
import { useAppStore } from "../../store/appStore";
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
  const currentMonth = getThisMonthKST();
  const [lookback, setLookback] = React.useState(6);
  // USD 지출은 대시보드와 같은 환율로 원화 환산 (환산 없이 액면 합산하면 달러 지출이 1/1400로 과소 예측)
  const fxRate = useFxRateValue();
  // 사용자 저축성지출 프리셋 — 빠지면 청약저축 등이 '변동 지출'로 예측에 섞인다 (대시보드와 같은 분류)
  const categoryPresets = useAppStore((s) => s.data.categoryPresets);

  const result = useMemo(
    () => forecastNextMonth(ledger, recurring, currentMonth, lookback, { fxRate, categoryPresets }),
    [ledger, recurring, currentMonth, lookback, fxRate, categoryPresets]
  );

  const regularRows = result.byCategory.filter((c) => c.regular || (c.recurringAmount > 0 && c.reserve === 0));
  const reserveRows = result.byCategory.filter((c) => c.reserve > 0).sort((x, y) => y.reserve - x.reserve);
  const maxAmount = regularRows.reduce((m, c) => Math.max(m, c.upper), 0) || 1;

  // 현재월 실제 소진률 (카테고리별) — 예측(byCategory)과 동일한 대분류(expenseMainName) 키·제외 기준 사용.
  // (과거 버그: l.category로 그룹화 → 현행 스키마에선 거의 "지출" 한 값이라 카테고리별 실적이 전부 0%였음)
  const currentMonthSpend = useMemo(
    () => expenseMainTotalsForMonth(ledger, currentMonth, { fxRate, categoryPresets }),
    [ledger, currentMonth, fxRate, categoryPresets]
  );

  const totalRecurring = result.byCategory.reduce((s, c) => s + c.recurringAmount, 0);
  const rangeHalfPct = result.totalForecast > 0
    ? Math.round(((result.totalUpper - result.totalLower) / 2 / result.totalForecast) * 100)
    : 0;

  // 반복지출 명세 — 예측의 고정 부분에 포함되는 매월·매주 항목 (매주는 월 환산으로 합산됨)
  const fixedRecurring = recurring.filter((r) => (r.frequency === "monthly" || r.frequency === "weekly") && isForecastRecurringExpense(r));
  const thStyle: React.CSSProperties = { padding: "10px 12px", fontSize: 12, color: "var(--text-muted)" };

  return (
    <div>
      <div style={{ padding: "10px 14px", background: "var(--bg)", borderRadius: 8, marginBottom: 16, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
        <Info size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} aria-hidden />
        {monthLabel(result.forecastMonth)} 예측 · 근거: 직전 {lookback}개 완료월({monthLabel(shiftMonth(result.baseMonth, -lookback))}~{monthLabel(shiftMonth(result.baseMonth, -1))}) ·
        정기 항목({lookback}개월 중 {result.regularMinMonths}개월 이상 지출) = <strong>MAX(반복지출, 월합계 중앙값)</strong>, 범위는 25~75% 구간 ·
        비정기 항목은 예측에서 빼고 월 준비금으로 따로 봅니다.
        <span style={{ marginLeft: 10 }}>
          기간:
          {[3, 6, 12].map((n) => (
            <button key={n} type="button" onClick={() => setLookback(n)}
              style={{
                marginLeft: 4, padding: "2px 8px", fontSize: 11, borderRadius: 4,
                border: lookback === n ? "1px solid var(--text)" : "1px solid var(--border)",
                background: lookback === n ? "var(--text)" : "var(--surface)",
                color: lookback === n ? "var(--bg)" : "var(--text-muted)",
                cursor: "pointer", fontWeight: 600,
              }}
            >{n}개월</button>
          ))}
        </span>
      </div>

      <Section storageKey="forecast-section-kpis" title="예측 요약">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <div className="card highlight" style={{ padding: "14px 16px", margin: 0 }}>
            <div className="card-title">정기 지출 예측</div>
            <div className="card-value" style={{ fontSize: 26 }}>{formatNumber(Math.round(result.totalForecast))}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              보통 범위 {formatNumber(Math.round(result.totalLower))} ~ {formatNumber(Math.round(result.totalUpper))}
            </div>
          </div>
          <div style={{ padding: "14px 16px", background: "var(--surface)", borderRadius: 10, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>비정기 월 준비금</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{formatNumber(Math.round(result.totalReserve))}</div>
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>
              {reserveRows.length}개 항목 · 예측 합계에 미포함
            </div>
          </div>
          <div style={{ padding: "14px 16px", background: "var(--surface)", borderRadius: 10, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>반복 고정 지출</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{formatNumber(Math.round(totalRecurring))}</div>
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>
              반복 등록 {fixedRecurring.length}개 · 확정
            </div>
          </div>
          <div style={{ padding: "14px 16px", background: "var(--surface)", borderRadius: 10, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>월별 흔들림</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>±{rangeHalfPct}%</div>
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>
              정기 항목 25~75% 구간 기준
            </div>
          </div>
        </div>
      </Section>

      <Section storageKey="forecast-section-breakdown" title="정기 항목별 예측">
        <div style={{ gridColumn: "span 4", overflowX: "auto" }}>
          <table className="data-table" style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", background: "var(--surface)", borderRadius: 10, overflow: "hidden" }}>
            <thead>
              <tr style={{ background: "var(--surface-hover)", borderBottom: "2px solid var(--border)" }}>
                <th style={{ ...thStyle, textAlign: "left" }}>카테고리</th>
                <th style={{ ...thStyle, textAlign: "left" }}>근거</th>
                <th className="number" style={{ ...thStyle, textAlign: "right" }}>예측</th>
                <th className="number" style={{ ...thStyle, textAlign: "right" }}>이번 달 지금까지</th>
                <th style={{ ...thStyle, width: "25%" }}>범위</th>
              </tr>
            </thead>
            <tbody>
              {regularRows.map((c) => {
                const cur = currentMonthSpend.get(c.category) ?? 0;
                const pct = c.forecast > 0 ? (cur / c.forecast) * 100 : 0;
                const basis = c.recurringAmount > 0 && c.recurringAmount >= c.median
                  ? `반복 등록 ${formatNumber(Math.round(c.recurringAmount))}`
                  : `${c.basedOnMonths}개월 중 ${c.activeMonths}개월 · 중앙값`;
                return (
                  <tr key={c.category} style={{ borderBottom: "1px solid var(--border-light)" }}>
                    <td style={{ padding: "10px 12px", fontWeight: 600 }}>{c.category}</td>
                    <td style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-muted)" }}>{basis}</td>
                    <td className="number" style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700 }}>{formatNumber(Math.round(c.forecast))}</td>
                    <td className="number" style={{ padding: "10px 12px", textAlign: "right", fontSize: 12 }}>
                      {formatNumber(Math.round(cur))}
                      <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{pct.toFixed(0)}%</div>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <div style={{ position: "relative", height: 8, background: "var(--surface-hover)", borderRadius: 4 }}>
                        <div style={{
                          position: "absolute",
                          left: `${(c.lower / maxAmount) * 100}%`,
                          width: `${Math.max(0, (c.upper - c.lower) / maxAmount) * 100}%`,
                          height: "100%", background: "var(--text-faint)", opacity: 0.4, borderRadius: 4
                        }} title={`보통 범위 ${formatNumber(Math.round(c.lower))} ~ ${formatNumber(Math.round(c.upper))}`} />
                        <div style={{
                          position: "absolute",
                          left: `${Math.min(100, (c.forecast / maxAmount) * 100)}%`,
                          width: 3, height: "100%", background: "var(--text)"
                        }} />
                        {cur > 0 && (
                          <div style={{
                            position: "absolute",
                            left: `${Math.min(100, (cur / maxAmount) * 100)}%`,
                            width: 3, height: "100%", background: "var(--chart-expense)"
                          }} title={`이번 달 지금까지: ${formatNumber(cur)}`} />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {regularRows.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 20, textAlign: "center", color: "var(--text-faint)" }}>
                  예측에 사용할 데이터가 부족합니다.
                </td></tr>
              )}
            </tbody>
          </table>
          <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6, textAlign: "center" }}>
            검은 선 = 예측(중앙값) · 파란 선 = 이번 달 지금까지 · 회색 바 = 지난 달들의 25~75% 구간
          </div>
        </div>
      </Section>

      {reserveRows.length > 0 && (
        <Section storageKey="forecast-section-reserve" title="비정기 지출 — 월 준비금">
          <div style={{ gridColumn: "span 4", overflowX: "auto" }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
              {lookback}개월 중 {result.regularMinMonths}개월 미만에만 나온 지출입니다. 다음 달에 나온다는 보장이 없어 예측에서 빼고,
              {" "}{lookback}개월 합 ÷ {lookback}을 매달 따로 모아 둘 금액으로 보여줍니다.
            </div>
            <table className="data-table" style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--border)" }}>
                  <th style={{ ...thStyle, textAlign: "left" }}>카테고리</th>
                  <th style={{ ...thStyle, textAlign: "left" }}>나온 달</th>
                  <th style={{ ...thStyle, textAlign: "left" }}>가장 큰 건</th>
                  <th className="number" style={{ ...thStyle, textAlign: "right" }}>월 준비금</th>
                </tr>
              </thead>
              <tbody>
                {reserveRows.map((c) => (
                  <tr key={c.category} style={{ borderBottom: "1px solid var(--border-light)" }}>
                    <td style={{ padding: "8px 12px", fontWeight: 600 }}>{c.category}</td>
                    <td style={{ padding: "8px 12px", fontSize: 12, color: "var(--text-muted)" }}>{c.basedOnMonths}개월 중 {c.activeMonths}개월</td>
                    <td style={{ padding: "8px 12px", fontSize: 12, color: "var(--text-muted)" }}>
                      {c.largest ? `${c.largest.description} ${formatNumber(Math.round(c.largest.amount))} (${c.largest.date})` : "—"}
                    </td>
                    <td className="number" style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700 }}>{formatNumber(Math.round(c.reserve))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {fixedRecurring.length > 0 && (
        <Section storageKey="forecast-section-recurring" title="반복지출 명세" defaultOpen={false}>
          <div style={{ gridColumn: "span 4" }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
              예측의 고정 부분에 포함되는 반복지출 {fixedRecurring.length}개 (합계 {formatNumber(Math.round(totalRecurring))}) — 매주 항목은 예측 월 발생 횟수로 환산
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
              {fixedRecurring.map((r) => (
                <div key={r.id} style={{ padding: "10px 12px", background: "var(--accent-light)", borderRadius: 8, border: "1px solid var(--border-light)", fontSize: 12 }}>
                  <div style={{ fontWeight: 700 }}>{r.title}{r.frequency === "weekly" ? " (매주)" : ""}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, color: "var(--text-muted)" }}>
                    <span>{r.category}</span>
                    <span style={{ fontWeight: 700, color: "var(--accent)" }}>{formatNumber(Math.round(r.amount))}</span>
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
