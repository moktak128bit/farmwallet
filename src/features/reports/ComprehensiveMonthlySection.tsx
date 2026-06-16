/**
 * 종합 월간 보고서 — 단일 월 선택(수입/지출/투자/이체/핵심 지표 + 최근 6개월 추이 차트).
 * ReportPage에서 분리 — React.memo로 감싸 다른 보고서 상태 변경 시 재렌더를 건너뛴다.
 * 부모가 넘기는 콜백(setSelectedMonth)은 setState 그대로라 참조가 안정적이어야 memo가 효과를 가진다.
 * comprehensiveMonthly는 부모의 reportWorker 결과 — 여기서 재계산하지 않는다.
 * 선택 월 행(selectedRow)/전월 행(prevRow)은 이 섹션 전용 파생값이라 여기서 find로 뽑는다.
 * selectedMonth 자체는 세금 보고서(taxYear)와 공유되므로 부모 소유.
 */
import React, { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from "recharts";
import { DeferredResponsiveContainer as ResponsiveContainer } from "../../components/charts/DeferredResponsiveContainer";
import type { ComprehensiveMonthlyRow } from "../../utils/reportGenerator";
import { formatKRW } from "../../utils/formatter";
import { shiftMonthKey, signedKRW } from "./reportShared";

interface Props {
  comprehensiveMonthly: ComprehensiveMonthlyRow[];
  selectedMonth: string;
  setSelectedMonth: React.Dispatch<React.SetStateAction<string>>;
}

export const ComprehensiveMonthlySection: React.FC<Props> = React.memo(function ComprehensiveMonthlySection({
  comprehensiveMonthly,
  selectedMonth,
  setSelectedMonth
}) {
  /** 선택 월 데이터 */
  const selectedRow: ComprehensiveMonthlyRow | undefined = useMemo(
    () => comprehensiveMonthly.find((r) => r.month === selectedMonth),
    [comprehensiveMonthly, selectedMonth]
  );

  /** 전월 데이터 (MoM 비교용) */
  const prevMonth = shiftMonthKey(selectedMonth, -1);
  const prevRow: ComprehensiveMonthlyRow | undefined = useMemo(
    () => comprehensiveMonthly.find((r) => r.month === prevMonth),
    [comprehensiveMonthly, prevMonth]
  );

  /** delta 표시 헬퍼 */
  const delta = (cur: number, prev: number | undefined) => {
    if (prev == null) return null;
    const d = cur - prev;
    if (d === 0) return null;
    return (
      <span style={{ fontSize: 12, marginLeft: 6, color: d > 0 ? "var(--danger)" : "var(--accent)" }}>
        {d > 0 ? "+" : ""}{formatKRW(d)}
      </span>
    );
  };

  const r = selectedRow;

  return (
    <div>
      <h3>{selectedMonth} 종합 월간 보고서</h3>

      {/* 월 네비게이션 */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <button type="button" onClick={() => setSelectedMonth(shiftMonthKey(selectedMonth, -1))}>◀ 이전 월</button>
        <input
          type="month"
          value={selectedMonth}
          onChange={(e) => {
            // 빈값(지우기/잘못된 입력)이면 직전 값 유지 — "NaN-NaN" 표시 방지
            if (e.target.value) setSelectedMonth(e.target.value);
          }}
          style={{ fontSize: 15, fontWeight: 600 }}
        />
        <button type="button" onClick={() => setSelectedMonth(shiftMonthKey(selectedMonth, 1))}>다음 월 ▶</button>
      </div>

      {!r ? (
        <p style={{ color: "var(--text-muted)", padding: 24 }}>{selectedMonth}에 해당하는 데이터가 없습니다.</p>
      ) : (
        <>
          {/* ── 1. 수입 ── */}
          <div className="card" style={{ padding: 16, marginBottom: 12 }}>
            <h4 style={{ margin: "0 0 12px" }}>수입</h4>
            <table className="data-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>구분</th>
                  <th className="number">금액</th>
                  <th className="number">전월 비교</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>근로소득</strong> <span style={{ fontSize: 12, color: "var(--text-muted)" }}>(급여/수당/상여/부수익)</span></td>
                  <td className="number positive">{formatKRW(r.earnedIncome)}</td>
                  <td className="number">{delta(r.earnedIncome, prevRow?.earnedIncome)}</td>
                </tr>
                <tr>
                  <td><strong>자본소득</strong> <span style={{ fontSize: 12, color: "var(--text-muted)" }}>(배당/이자/투자수익)</span></td>
                  <td className="number">{formatKRW(r.capitalIncome)}</td>
                  <td className="number">{delta(r.capitalIncome, prevRow?.capitalIncome)}</td>
                </tr>
                <tr style={{ color: "var(--text-muted)" }}>
                  <td>일시·비실질 수입 <span style={{ fontSize: 12 }}>(정산/용돈/지원/대출/처분소득)</span></td>
                  <td className="number">{formatKRW(r.nonRealIncome)}</td>
                  <td className="number">{delta(r.nonRealIncome, prevRow?.nonRealIncome)}</td>
                </tr>
                <tr style={{ fontWeight: 700, borderTop: "2px solid var(--border)" }}>
                  <td>전체 수입 (장부)</td>
                  <td className="number">{formatKRW(r.totalIncome)}</td>
                  <td className="number">{delta(r.totalIncome, prevRow?.totalIncome)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ── 2. 지출 ── */}
          <div className="card" style={{ padding: 16, marginBottom: 12 }}>
            <h4 style={{ margin: "0 0 12px" }}>지출</h4>
            <table className="data-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>구분</th>
                  <th className="number">금액</th>
                  <th className="number">전월 비교</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>생활소비</strong> <span style={{ fontSize: 12, color: "var(--text-muted)" }}>(식비/교통/주거/의료 등)</span></td>
                  <td className="number negative">{formatKRW(r.livingExpense)}</td>
                  <td className="number">{delta(r.livingExpense, prevRow?.livingExpense)}</td>
                </tr>
                <tr>
                  <td><strong>저축성 지출</strong> <span style={{ fontSize: 12, color: "var(--text-muted)" }}>(재테크/투자)</span></td>
                  <td className="number">{formatKRW(r.savingsExpense)}</td>
                  <td className="number">{delta(r.savingsExpense, prevRow?.savingsExpense)}</td>
                </tr>
                <tr>
                  <td>대출상환 {r.loanInterest > 0 && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>(이자 {formatKRW(r.loanInterest)})</span>}</td>
                  <td className="number">{formatKRW(r.loanRepayment)}</td>
                  <td className="number">{delta(r.loanRepayment, prevRow?.loanRepayment)}</td>
                </tr>
                <tr style={{ color: "var(--text-muted)" }}>
                  <td>신용결제 <span style={{ fontSize: 12 }}>(이중계산 제외)</span></td>
                  <td className="number">{formatKRW(r.creditPayment)}</td>
                  <td className="number">{delta(r.creditPayment, prevRow?.creditPayment)}</td>
                </tr>
                <tr style={{ fontWeight: 700, borderTop: "2px solid var(--border)" }}>
                  <td>전체 지출 (장부)</td>
                  <td className="number">{formatKRW(r.totalExpense)}</td>
                  <td className="number">{delta(r.totalExpense, prevRow?.totalExpense)}</td>
                </tr>
                {r.nonRealIncome > 0 && (() => {
                  const realExp = r.livingExpense - Math.min(r.nonRealIncome, r.livingExpense);
                  return (
                    <tr style={{ fontWeight: 700, color: "var(--chart-expense)" }}>
                      <td>실질 생활 지출 <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>(비실질 수입분 차감)</span></td>
                      <td className="number">{formatKRW(realExp)}</td>
                      <td className="number"></td>
                    </tr>
                  );
                })()}
              </tbody>
            </table>
          </div>

          {/* ── 3. 투자 활동 ── */}
          <div className="card" style={{ padding: 16, marginBottom: 12 }}>
            <h4 style={{ margin: "0 0 12px" }}>투자 활동</h4>
            <table className="data-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>구분</th>
                  <th className="number">금액</th>
                  <th className="number">전월 비교</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>매수 총액</td>
                  <td className="number">{formatKRW(r.buyAmount)}</td>
                  <td className="number">{delta(r.buyAmount, prevRow?.buyAmount)}</td>
                </tr>
                <tr>
                  <td>매도 총액</td>
                  <td className="number">{formatKRW(r.sellAmount)}</td>
                  <td className="number">{delta(r.sellAmount, prevRow?.sellAmount)}</td>
                </tr>
                <tr>
                  <td><strong>실현 손익</strong></td>
                  <td className={`number ${r.realizedPnl >= 0 ? "positive" : "negative"}`}>{signedKRW(r.realizedPnl)}</td>
                  <td className="number">{delta(r.realizedPnl, prevRow?.realizedPnl)}</td>
                </tr>
                <tr>
                  <td>배당 수입</td>
                  <td className="number positive">{formatKRW(r.dividendIncome)}</td>
                  <td className="number">{delta(r.dividendIncome, prevRow?.dividendIncome)}</td>
                </tr>
                <tr>
                  <td>매매 건수</td>
                  <td className="number">{r.tradeCount}건</td>
                  <td className="number">{prevRow != null && r.tradeCount !== prevRow.tradeCount ? (
                    <span style={{ fontSize: 12, color: r.tradeCount > prevRow.tradeCount ? "var(--danger)" : "var(--accent)" }}>
                      {r.tradeCount > prevRow.tradeCount ? "+" : ""}{r.tradeCount - prevRow.tradeCount}건
                    </span>
                  ) : null}</td>
                </tr>
                <tr style={{ borderTop: "1px solid var(--border)" }}>
                  <td>투자 이체 (입금)</td>
                  <td className="number">{formatKRW(r.investingIn)}</td>
                  <td className="number">{delta(r.investingIn, prevRow?.investingIn)}</td>
                </tr>
                <tr>
                  <td>투자 출금</td>
                  <td className="number">{formatKRW(r.investingOut)}</td>
                  <td className="number">{delta(r.investingOut, prevRow?.investingOut)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ── 4. 이체 ── */}
          {r.transferTotal > 0 && (
            <div className="card" style={{ padding: 16, marginBottom: 12 }}>
              <h4 style={{ margin: "0 0 12px" }}>이체</h4>
              <table className="data-table" style={{ width: "100%" }}>
                <tbody>
                  <tr>
                    <td>이체 총액</td>
                    <td className="number">{formatKRW(r.transferTotal)}</td>
                    <td className="number">{delta(r.transferTotal, prevRow?.transferTotal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* ── 5. 핵심 지표 요약 ── */}
          <div className="card" style={{ padding: 16, marginBottom: 12, background: "var(--bg-secondary, var(--bg))" }}>
            <h4 style={{ margin: "0 0 12px" }}>핵심 지표</h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
              <div>
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>실질 순수입</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: r.realNet >= 0 ? "var(--danger)" : "var(--accent)" }}>
                  {signedKRW(r.realNet)}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>실질수입 − 실질지출 (정산·일시소득·환전·신용결제 제외, 데이트 50% 반영)</div>
              </div>
              <div>
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>실질 저축률</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>
                  {r.realSavingsRate != null ? `${r.realSavingsRate.toFixed(1)}%` : "-"}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>실질 순수입 / 실질수입</div>
              </div>
              <div>
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>장부 순수입</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: r.totalNet >= 0 ? "var(--danger)" : "var(--accent)" }}>
                  {signedKRW(r.totalNet)}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>전체 수입 - 전체 지출</div>
              </div>
            </div>
          </div>

          {/* ── 6. 추이 차트 (최근 6개월) ── */}
          <div className="card" style={{ padding: 16 }}>
            <h4 style={{ margin: "0 0 12px" }}>최근 추이</h4>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={comprehensiveMonthly.slice(-6)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(value: number | undefined) => formatKRW(value ?? 0)} />
                <Legend />
                {/* 국내 색 관례: 수입=빨강, 지출=파랑 (서구식 초록/빨강 역전 수정) + 다크모드 CSS 변수 */}
                <Bar isAnimationActive={false} dataKey="earnedIncome" fill="var(--chart-income)" name="근로소득" />
                <Bar isAnimationActive={false} dataKey="livingExpense" fill="var(--chart-expense)" name="생활소비" />
                <Bar isAnimationActive={false} dataKey="realNet" fill="var(--chart-primary)" name="실질 순수입" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
});
