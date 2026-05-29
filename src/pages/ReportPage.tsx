import React, { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { DeferredResponsiveContainer as ResponsiveContainer } from "../components/charts/DeferredResponsiveContainer";
import type { Account, LedgerEntry, StockPrice, StockTrade } from "../types";
import {
  computeInvestmentReconciliation,
  type ComprehensiveMonthlyRow
} from "../utils/reportGenerator";
import { formatKRW } from "../utils/formatter";
import { toast } from "react-hot-toast";
import { ERROR_MESSAGES } from "../constants/errorMessages";
import { useFxRateValue } from "../context/FxRateContext";
import { useReportWorker } from "../hooks/useReportWorker";
import { summarizeTaxYear, COMPREHENSIVE_TAX_THRESHOLD } from "../utils/taxCalculator";
import { downloadAsExcel } from "../utils/excelExport";
import { openPrintWindow } from "../utils/pdfExport";
import { blocksToCsv, blocksToSheets, blocksToHtml, hasReportRows, type ReportBlock } from "../utils/reportExport";

interface Props {
  accounts: Account[];
  ledger: LedgerEntry[];
  trades: StockTrade[];
  prices: StockPrice[];
}

type ReportType =
  | "comprehensive"
  | "investment"
  | "monthly"
  | "yearly"
  | "category"
  | "stock"
  | "account"
  | "daily"
  | "periodCompare"
  | "closing"
  | "performanceAdvanced"
  | "tax";

function toPercent(rate?: number | null): string {
  if (rate == null || !Number.isFinite(rate)) return "-";
  return `${(rate * 100).toFixed(2)}%`;
}

function signedKRW(value: number): string {
  return `${value > 0 ? "+" : ""}${formatKRW(value)}`;
}

/** 월 이동 헬퍼 */
function shiftMonthKey(monthKey: string, offset: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export const ReportView: React.FC<Props> = ({ accounts, ledger, trades, prices }) => {
  const fxRate = useFxRateValue();
  const [reportType, setReportType] = useState<ReportType>("comprehensive");
  const [startDate, setStartDate] = useState<string>(() => {
    const date = new Date();
    date.setMonth(date.getMonth() - 11);
    return date.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  /** 종합 월간 보고서: 단일 월 선택 */
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  const {
    monthlyReport,
    monthlyIncomeDetail,
    yearlyReport,
    categoryReport,
    stockReport,
    accountReport,
    dailyReport,
    closingReport,
    accountPerformance,
    consumptionImpact,
    periodCompare,
    comprehensiveMonthly
  } = useReportWorker({
    accounts,
    ledger,
    trades,
    prices,
    startDate,
    endDate,
    fxRate
  });

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

  /** 투자 정산 — 전체 기간 누적, 주식·코인 계좌 기준 */
  const reconciliation = useMemo(
    () => computeInvestmentReconciliation(accounts, ledger, trades, prices, accountPerformance, fxRate ?? undefined),
    [accounts, ledger, trades, prices, accountPerformance, fxRate]
  );


  const exportCurrentCsv = () => {
    const { filename, blocks } = buildReportBlocks();
    if (!hasReportRows(blocks)) {
      toast.error(ERROR_MESSAGES.NO_DATA_TO_EXPORT);
      return;
    }
    const blob = new Blob(["\uFEFF" + blocksToCsv(blocks)], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `${filename}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("CSV 내보내기 완료");
  };

  const renderMonthRange = () => (
    <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
      <span>시작</span>
      <input type="month" value={startDate.slice(0, 7)} onChange={(e) => setStartDate(`${e.target.value}-01`)} />
      <span>종료</span>
      <input
        type="month"
        value={endDate.slice(0, 7)}
        onChange={(e) => {
          const [year, month] = e.target.value.split("-").map(Number);
          const lastDay = new Date(year, month, 0).getDate();
          setEndDate(`${e.target.value}-${String(lastDay).padStart(2, "0")}`);
        }}
      />
    </label>
  );

  const renderDateRange = () => (
    <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
      <span>시작</span>
      <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      <span>종료</span>
      <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
    </label>
  );

  /** delta 표시 헬퍼 */
  const delta = (cur: number, prev: number | undefined) => {
    if (prev == null) return null;
    const d = cur - prev;
    if (d === 0) return null;
    return (
      <span style={{ fontSize: 12, marginLeft: 6, color: d > 0 ? "var(--positive)" : "var(--negative)" }}>
        {d > 0 ? "+" : ""}{formatKRW(d)}
      </span>
    );
  };

  const renderReport = () => {
    // ─── 종합 월간 보고서 ───
    if (reportType === "comprehensive") {
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
              onChange={(e) => setSelectedMonth(e.target.value)}
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
                        <span style={{ fontSize: 12, color: r.tradeCount > prevRow.tradeCount ? "var(--positive)" : "var(--negative)" }}>
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
                    <div style={{ fontSize: 22, fontWeight: 700, color: r.realNet >= 0 ? "var(--positive)" : "var(--negative)" }}>
                      {signedKRW(r.realNet)}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>근로소득 − 생활소비 (정산 차감)</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, color: "var(--text-muted)" }}>실질 저축률</div>
                    <div style={{ fontSize: 22, fontWeight: 700 }}>
                      {r.realSavingsRate != null ? `${r.realSavingsRate.toFixed(1)}%` : "-"}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>실질 순수입 / 근로소득</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, color: "var(--text-muted)" }}>장부 순수입</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: r.totalNet >= 0 ? "var(--positive)" : "var(--negative)" }}>
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
                    <Bar dataKey="earnedIncome" fill="#10b981" name="근로소득" />
                    <Bar dataKey="livingExpense" fill="#f43f5e" name="생활소비" />
                    <Bar dataKey="realNet" fill="#6366f1" name="진짜 순수입" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      );
    }

    // ─── 투자 정산 ───
    if (reportType === "investment") {
      const rec = reconciliation;
      if (!rec.hasData) {
        return (
          <div>
            <h3>투자 정산</h3>
            <p style={{ color: "var(--text-muted)", padding: 24 }}>
              주식·코인 계좌가 없습니다. 계좌 탭에서 증권/코인 계좌를 추가하면 투자 정산이 표시됩니다.
            </p>
          </div>
        );
      }
      const positive = rec.totalReturn >= 0;
      const returnColor = positive ? "var(--positive)" : "var(--negative)";
      return (
        <div>
          <h3>투자 정산</h3>
          <div className="hint" style={{ fontSize: 13, marginBottom: 16 }}>
            주식·코인 계좌 전체 기간 누적. 입금·출금은 투자계좌 경계를 넘는 이체 기준입니다.
          </div>

          {/* 헤드라인 — 투자 총성과 */}
          <div className="card" style={{ padding: 20, marginBottom: 12, textAlign: "center" }}>
            <div style={{ fontSize: 14, color: "var(--text-muted)" }}>투자 총성과</div>
            <div style={{ fontSize: 36, fontWeight: 800, color: returnColor, margin: "4px 0" }}>
              {signedKRW(rec.totalReturn)}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              현재 평가액 {formatKRW(rec.currentValue)} − 순투입원금 {formatKRW(rec.netContributed)}
            </div>
            <div style={{ display: "flex", gap: 20, justifyContent: "center", marginTop: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13 }}>
                총수익률{" "}
                <strong style={{ color: returnColor }}>
                  {rec.returnRate != null ? `${(rec.returnRate * 100).toFixed(2)}%` : "-"}
                </strong>
              </span>
              <span style={{ fontSize: 13 }}>
                연환산 IRR <strong>{toPercent(rec.irr)}</strong>
              </span>
            </div>
          </div>

          {/* 1. 자본 흐름 */}
          <div className="card" style={{ padding: 16, marginBottom: 12 }}>
            <h4 style={{ margin: "0 0 2px" }}>자본 흐름 — 내 돈이 얼마 들어갔나</h4>
            <p className="hint" style={{ fontSize: 12, margin: "0 0 12px" }}>
              매수·매도는 계좌 안에서 현금↔주식 형태만 바꾼 거래라 여기 들어가지 않습니다.
            </p>
            <table className="data-table" style={{ width: "100%" }}>
              <tbody>
                <tr>
                  <td>투자계좌 초기자본</td>
                  <td className="number">{formatKRW(rec.initialCapital)}</td>
                </tr>
                <tr>
                  <td>(+) 누적 입금 (이체)</td>
                  <td className="number positive">{formatKRW(rec.deposits)}</td>
                </tr>
                <tr>
                  <td>(−) 누적 출금 (생활비 회수 등)</td>
                  <td className="number negative">{formatKRW(rec.withdrawals)}</td>
                </tr>
                <tr style={{ fontWeight: 700, borderTop: "2px solid var(--border)" }}>
                  <td>순투입원금</td>
                  <td className="number">{formatKRW(rec.netContributed)}</td>
                </tr>
                <tr style={{ fontWeight: 700 }}>
                  <td>현재 평가액 (주식 + 계좌 현금)</td>
                  <td className="number">{formatKRW(rec.currentValue)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* 2. 손익 분해 — 이익/손실 갈라서 */}
          <div className="card" style={{ padding: 16, marginBottom: 12 }}>
            <h4 style={{ margin: "0 0 2px" }}>이 수익의 정체 — 이익과 손실</h4>
            <p className="hint" style={{ fontSize: 12, margin: "0 0 12px" }}>
              이익과 손실을 따로 보여줍니다. 순액만 보면 손실이 이익에 가려 안 보이기 때문입니다.
            </p>
            <table className="data-table" style={{ width: "100%" }}>
              <tbody>
                <tr>
                  <td>실현 이익 <span style={{ fontSize: 12, color: "var(--text-muted)" }}>(이익 본 매도)</span></td>
                  <td className="number positive">{signedKRW(rec.realizedGain)}</td>
                </tr>
                <tr>
                  <td>실현 손실 <span style={{ fontSize: 12, color: "var(--text-muted)" }}>(손실 본 매도)</span></td>
                  <td className="number negative">{signedKRW(rec.realizedLoss)}</td>
                </tr>
                <tr style={{ borderTop: "1px solid var(--border)" }}>
                  <td>실현 손익 (순)</td>
                  <td className={`number ${rec.realizedPnl >= 0 ? "positive" : "negative"}`}>{signedKRW(rec.realizedPnl)}</td>
                </tr>
                <tr>
                  <td>미실현 이익 <span style={{ fontSize: 12, color: "var(--text-muted)" }}>(평가이익)</span></td>
                  <td className="number positive">{signedKRW(rec.unrealizedGain)}</td>
                </tr>
                <tr>
                  <td>미실현 손실 <span style={{ fontSize: 12, color: "var(--text-muted)" }}>(평가손실 — 물려 있음)</span></td>
                  <td className="number negative">{signedKRW(rec.unrealizedLoss)}</td>
                </tr>
                <tr style={{ borderTop: "1px solid var(--border)" }}>
                  <td>미실현 손익 (순)</td>
                  <td className={`number ${rec.unrealizedPnl >= 0 ? "positive" : "negative"}`}>{signedKRW(rec.unrealizedPnl)}</td>
                </tr>
                <tr>
                  <td>배당 수입</td>
                  <td className="number positive">{formatKRW(rec.dividendIncome)}</td>
                </tr>
                <tr style={{ fontWeight: 700, borderTop: "2px solid var(--border)" }}>
                  <td>손익 합계</td>
                  <td className="number">{signedKRW(rec.pnlSum)}</td>
                </tr>
                <tr style={{ color: "var(--text-muted)" }}>
                  <td>분류 외 차이 <span style={{ fontSize: 12 }}>(초기 보유분·계좌 입금 수입 등)</span></td>
                  <td className="number">{signedKRW(rec.residual)}</td>
                </tr>
              </tbody>
            </table>
            <p className="hint" style={{ fontSize: 12, margin: "10px 0 0" }}>
              손익 합계 + 분류 외 차이 = 투자 총성과 {signedKRW(rec.totalReturn)}.
            </p>
          </div>

          {/* 확정수익 거래 목록 */}
          {rec.winningTrades.length > 0 && (
            <div className="card" style={{ padding: 16, marginBottom: 12 }}>
              <h4 style={{ margin: "0 0 2px" }}>
                확정수익 거래{" "}
                <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>이익 보고 매도한 건</span>
              </h4>
              <p className="hint" style={{ fontSize: 12, margin: "0 0 12px" }}>
                매도로 이익이 확정된 거래입니다. 수익 큰 거래 순.
              </p>
              <div style={{ overflowX: "auto", width: "100%" }}>
                <table className="data-table" style={{ width: "100%", minWidth: 560 }}>
                  <thead>
                    <tr>
                      <th>매도일</th>
                      <th>종목</th>
                      <th>계좌</th>
                      <th className="number">실현손익</th>
                      <th className="number">수익률</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rec.winningTrades.map((t, i) => (
                      <tr key={`${t.date}-${t.ticker}-${i}`}>
                        <td>{t.date}</td>
                        <td>{t.name}</td>
                        <td>{t.accountName}</td>
                        <td className="number positive">{signedKRW(t.pnl)}</td>
                        <td className="number positive">{(t.returnRate * 100).toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 확정손실 거래 목록 */}
          {rec.losingTrades.length > 0 && (
            <div className="card" style={{ padding: 16, marginBottom: 12 }}>
              <h4 style={{ margin: "0 0 2px" }}>
                확정손실 거래{" "}
                <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>손실 보고 매도한 건</span>
              </h4>
              <p className="hint" style={{ fontSize: 12, margin: "0 0 12px" }}>
                매도로 손실이 확정된 거래입니다. 손실 큰 거래 순.
              </p>
              <div style={{ overflowX: "auto", width: "100%" }}>
                <table className="data-table" style={{ width: "100%", minWidth: 560 }}>
                  <thead>
                    <tr>
                      <th>매도일</th>
                      <th>종목</th>
                      <th>계좌</th>
                      <th className="number">실현손익</th>
                      <th className="number">수익률</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rec.losingTrades.map((t, i) => (
                      <tr key={`${t.date}-${t.ticker}-${i}`}>
                        <td>{t.date}</td>
                        <td>{t.name}</td>
                        <td>{t.accountName}</td>
                        <td className="number negative">{signedKRW(t.pnl)}</td>
                        <td className="number negative">{(t.returnRate * 100).toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 평가수익 종목 목록 */}
          {rec.winningPositions.length > 0 && (
            <div className="card" style={{ padding: 16, marginBottom: 12 }}>
              <h4 style={{ margin: "0 0 2px" }}>
                평가수익 종목{" "}
                <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>지금 수익 중인 종목</span>
              </h4>
              <p className="hint" style={{ fontSize: 12, margin: "0 0 12px" }}>
                아직 팔지 않아 확정되지 않은 수익입니다. 수익이 큰 종목 순.
              </p>
              <div style={{ overflowX: "auto", width: "100%" }}>
                <table className="data-table" style={{ width: "100%", minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th>종목</th>
                      <th>계좌</th>
                      <th className="number">평가손익</th>
                      <th className="number">손익률</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rec.winningPositions.map((p) => (
                      <tr key={`${p.accountName}-${p.ticker}`}>
                        <td>{p.name}</td>
                        <td>{p.accountName}</td>
                        <td className="number positive">{signedKRW(p.pnl)}</td>
                        <td className="number positive">{(p.pnlRate * 100).toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 평가손실 종목 목록 */}
          {rec.losingPositions.length > 0 && (
            <div className="card" style={{ padding: 16, marginBottom: 12 }}>
              <h4 style={{ margin: "0 0 2px" }}>
                평가손실 종목{" "}
                <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>지금 물려 있는 종목</span>
              </h4>
              <p className="hint" style={{ fontSize: 12, margin: "0 0 12px" }}>
                아직 팔지 않아 확정되지 않은 손실입니다. 손실이 큰 종목 순.
              </p>
              <div style={{ overflowX: "auto", width: "100%" }}>
                <table className="data-table" style={{ width: "100%", minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th>종목</th>
                      <th>계좌</th>
                      <th className="number">평가손익</th>
                      <th className="number">손익률</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rec.losingPositions.map((p) => (
                      <tr key={`${p.accountName}-${p.ticker}`}>
                        <td>{p.name}</td>
                        <td>{p.accountName}</td>
                        <td className="number negative">{signedKRW(p.pnl)}</td>
                        <td className="number negative">{(p.pnlRate * 100).toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 월별 실현손익 추이 */}
          {rec.monthlyPnl.length > 0 && (
            <div className="card" style={{ padding: 16, marginBottom: 12 }}>
              <h4 style={{ margin: "0 0 2px" }}>월별 실현손익 추이</h4>
              <p className="hint" style={{ fontSize: 12, margin: "0 0 12px" }}>
                매도로 확정된 이익(초록)·손실(빨강). 손실이 언제 터졌는지 한눈에 보입니다.
              </p>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={rec.monthlyPnl}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip formatter={(value: number | undefined) => formatKRW(value ?? 0)} />
                  <Legend />
                  <Bar dataKey="realizedGain" fill="#10b981" name="실현 이익" />
                  <Bar dataKey="realizedLoss" fill="#f43f5e" name="실현 손실" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* 3. 거래 활동량 (참고) */}
          <div className="card" style={{ padding: 16, marginBottom: 12 }}>
            <h4 style={{ margin: "0 0 12px" }}>
              거래 활동량{" "}
              <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>참고 — 손익이 아닙니다</span>
            </h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
              <div style={{ padding: "10px 12px", background: "var(--surface)", borderRadius: 8 }}>
                <div className="hint" style={{ fontSize: 13 }}>매수 총액</div>
                <div style={{ fontWeight: 700, fontSize: 20 }}>{formatKRW(rec.buyVolume)}</div>
              </div>
              <div style={{ padding: "10px 12px", background: "var(--surface)", borderRadius: 8 }}>
                <div className="hint" style={{ fontSize: 13 }}>매도 총액</div>
                <div style={{ fontWeight: 700, fontSize: 20 }}>{formatKRW(rec.sellVolume)}</div>
              </div>
              <div style={{ padding: "10px 12px", background: "var(--surface)", borderRadius: 8 }}>
                <div className="hint" style={{ fontSize: 13 }}>매매 건수</div>
                <div style={{ fontWeight: 700, fontSize: 20 }}>{rec.tradeCount}건</div>
              </div>
            </div>
            <p className="hint" style={{ fontSize: 12, margin: "10px 0 0" }}>
              매수·매도 총액은 거래량일 뿐, 수입·지출·성과 어디에도 들어가지 않습니다.
            </p>
          </div>

          {/* 4. 계좌별 정산 */}
          <div className="card" style={{ padding: 16 }}>
            <h4 style={{ margin: "0 0 12px" }}>계좌별 정산</h4>
            <div style={{ overflowX: "auto", width: "100%" }}>
              <table className="data-table" style={{ width: "100%", minWidth: 820 }}>
                <thead>
                  <tr>
                    <th>계좌</th>
                    <th className="number">순투입원금</th>
                    <th className="number">현재 평가액</th>
                    <th className="number">총성과</th>
                    <th className="number">실현</th>
                    <th className="number">미실현</th>
                    <th className="number">배당</th>
                    <th className="number">IRR</th>
                  </tr>
                </thead>
                <tbody>
                  {rec.accounts.map((row) => (
                    <tr key={row.accountId}>
                      <td>{row.accountName}</td>
                      <td className="number">{formatKRW(row.netContributed)}</td>
                      <td className="number">{formatKRW(row.currentValue)}</td>
                      <td className={`number ${row.totalReturn >= 0 ? "positive" : "negative"}`}>{signedKRW(row.totalReturn)}</td>
                      <td className={`number ${row.realizedPnl >= 0 ? "positive" : "negative"}`}>{formatKRW(row.realizedPnl)}</td>
                      <td className={`number ${row.unrealizedPnl >= 0 ? "positive" : "negative"}`}>{formatKRW(row.unrealizedPnl)}</td>
                      <td className="number">{formatKRW(row.dividendIncome)}</td>
                      <td className={`number ${row.irr != null && row.irr >= 0 ? "positive" : "negative"}`}>{toPercent(row.irr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      );
    }

    // ─── 월별 수입/지출 ───
    if (reportType === "monthly") {
      return (
        <div>
          <h3>월별 수입 / 지출</h3>
          {renderMonthRange()}
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthlyReport}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(value: number | undefined) => formatKRW(value ?? 0)} />
              <Legend />
              <Bar dataKey="income" fill="#10b981" name="수입" />
              <Bar dataKey="expense" fill="#f43f5e" name="지출" />
              <Bar dataKey="net" fill="#6366f1" name="순수입" />
            </BarChart>
          </ResponsiveContainer>
          <div style={{ overflowX: "auto", width: "100%", marginTop: 14 }}>
            <table className="data-table" style={{ width: "100%", minWidth: 700 }}>
              <thead>
                <tr>
                  <th>월</th>
                  <th className="number">수입</th>
                  <th className="number">지출</th>
                  <th className="number">순수입</th>
                </tr>
              </thead>
              <tbody>
                {monthlyReport.map((row) => (
                  <tr key={row.month}>
                    <td>{row.month}</td>
                    <td className="number positive">{formatKRW(row.income)}</td>
                    <td className="number negative">{formatKRW(row.expense)}</td>
                    <td className={`number ${row.net >= 0 ? "positive" : "negative"}`}>{formatKRW(row.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    // ─── 연간 요약 ───
    if (reportType === "yearly") {
      return (
        <div>
          <h3>연간 요약</h3>
          <div style={{ overflowX: "auto", width: "100%" }}>
            <table className="data-table" style={{ width: "100%", minWidth: 620 }}>
              <thead>
                <tr>
                  <th>연도</th>
                  <th className="number">수입</th>
                  <th className="number">지출</th>
                  <th className="number">순수입</th>
                </tr>
              </thead>
              <tbody>
                {yearlyReport.map((row) => (
                  <tr key={row.month}>
                    <td>{row.month}</td>
                    <td className="number positive">{formatKRW(row.income)}</td>
                    <td className="number negative">{formatKRW(row.expense)}</td>
                    <td className={`number ${row.net >= 0 ? "positive" : "negative"}`}>{formatKRW(row.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    // ─── 카테고리별 지출 ───
    if (reportType === "category") {
      return (
        <div>
          <h3>카테고리별 지출</h3>
          {renderDateRange()}
          <div style={{ overflowX: "auto", width: "100%" }}>
            <table className="data-table" style={{ width: "100%", minWidth: 700 }}>
              <thead>
                <tr>
                  <th>대분류</th>
                  <th>중분류</th>
                  <th className="number">합계</th>
                  <th className="number">건수</th>
                </tr>
              </thead>
              <tbody>
                {categoryReport.map((row, idx) => (
                  <tr key={`${row.category}-${idx}`}>
                    <td>{row.category}</td>
                    <td>{row.subCategory || "-"}</td>
                    <td className="number">{formatKRW(row.total)}</td>
                    <td className="number">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    // ─── 주식 성과 ───
    if (reportType === "stock") {
      return (
        <div>
          <h3>주식 성과</h3>
          <div style={{ overflowX: "auto", width: "100%" }}>
            <table className="data-table" style={{ width: "100%", minWidth: 960 }}>
              <thead>
                <tr>
                  <th>종목코드</th>
                  <th>종목명</th>
                  <th className="number">현재가치</th>
                  <th className="number">손익</th>
                  <th className="number">IRR</th>
                </tr>
              </thead>
              <tbody>
                {stockReport.map((row) => (
                  <tr key={`${row.accountId}-${row.ticker}`}>
                    <td>{row.ticker}</td>
                    <td>{row.name}</td>
                    <td className="number">{formatKRW(row.currentValue)}</td>
                    <td className={`number ${row.pnl >= 0 ? "positive" : "negative"}`}>{formatKRW(row.pnl)}</td>
                    <td className={`number ${row.irr != null && row.irr >= 0 ? "positive" : "negative"}`}>{toPercent(row.irr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    // ─── 계좌 요약 ───
    if (reportType === "account") {
      return (
        <div>
          <h3>계좌 요약</h3>
          <div style={{ overflowX: "auto", width: "100%" }}>
            <table className="data-table" style={{ width: "100%", minWidth: 860 }}>
              <thead>
                <tr>
                  <th>계좌명</th>
                  <th className="number">초기잔액</th>
                  <th className="number">현재잔액</th>
                  <th className="number">변동</th>
                  <th className="number">변동률</th>
                </tr>
              </thead>
              <tbody>
                {accountReport.map((row) => (
                  <tr key={row.accountId}>
                    <td>{row.accountName}</td>
                    <td className="number">{formatKRW(row.initialBalance)}</td>
                    <td className="number">{formatKRW(row.currentBalance)}</td>
                    <td className={`number ${row.change >= 0 ? "positive" : "negative"}`}>{formatKRW(row.change)}</td>
                    <td className={`number ${row.changeRate >= 0 ? "positive" : "negative"}`}>{row.changeRate.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    // ─── 일별 스냅샷 ───
    if (reportType === "daily") {
      return (
        <div>
          <h3>일별 자산 스냅샷</h3>
          {renderDateRange()}
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={dailyReport}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip formatter={(value: number | undefined) => formatKRW(value ?? 0)} />
              <Legend />
              <Line type="monotone" dataKey="totalAsset" name="총 자산" stroke="#6366f1" />
              <Line type="monotone" dataKey="netWorth" name="순자산" stroke="#10b981" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      );
    }

    // ─── 기간 비교 ───
    if (reportType === "periodCompare") {
      const rows = [
        { label: "수입", a: periodCompare.thisMonth.income, b: periodCompare.lastMonth.income },
        { label: "지출", a: periodCompare.thisMonth.expense, b: periodCompare.lastMonth.expense },
        { label: "저축성 지출", a: periodCompare.thisMonth.savings, b: periodCompare.lastMonth.savings },
        { label: "투자 순액", a: periodCompare.thisMonth.investingNet, b: periodCompare.lastMonth.investingNet },
        { label: "순수입", a: periodCompare.thisMonth.net, b: periodCompare.lastMonth.net }
      ];
      return (
        <div>
          <h3>기간 비교 ({periodCompare.thisMonthKey} vs {periodCompare.lastMonthKey})</h3>
          <div style={{ overflowX: "auto", width: "100%" }}>
            <table className="data-table" style={{ width: "100%", minWidth: 700 }}>
              <thead>
                <tr>
                  <th>항목</th>
                  <th className="number">{periodCompare.thisMonthKey}</th>
                  <th className="number">{periodCompare.lastMonthKey}</th>
                  <th className="number">차이</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const d = row.a - row.b;
                  return (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td className="number">{formatKRW(row.a)}</td>
                      <td className="number">{formatKRW(row.b)}</td>
                      <td className={`number ${d >= 0 ? "positive" : "negative"}`}>{signedKRW(d)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    // ─── 주간/월간 정산 ───
    if (reportType === "closing") {
      const monthly = closingReport.monthlySnapshots;
      const weekly = closingReport.weeklySnapshots;
      const status = closingReport.monthlyStatus;
      return (
        <div>
          <h3>주간 / 월간 정산</h3>
          <div className="card" style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div>
                <strong>이번 달 정산 완료율</strong>
                <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-muted)" }}>
                  {status.month}: {status.completedClosings}/{status.expectedClosings}
                  {status.coveredUntil ? `, ${status.coveredUntil}까지 기록됨` : ""}
                </p>
              </div>
              <div style={{ fontWeight: 700, fontSize: 24 }}>{status.completionRate.toFixed(1)}%</div>
            </div>
            <div style={{ marginTop: 12, width: "100%", height: 10, borderRadius: 999, background: "var(--border)" }}>
              <div
                style={{
                  width: `${Math.max(0, Math.min(100, status.completionRate))}%`,
                  height: "100%",
                  borderRadius: 999,
                  background: "linear-gradient(90deg, #22c55e, #3b82f6)"
                }}
              />
            </div>
          </div>

          {closingReport.latestComment && (
            <div className="card" style={{ padding: 16, marginBottom: 16 }}>
              <h4 style={{ marginBottom: 8 }}>전월 대비 자동 코멘트</h4>
              <p style={{ margin: 0, color: "var(--text-secondary)" }}>{closingReport.latestComment.summary}</p>
              <div style={{ marginTop: 8, display: "flex", gap: 14, flexWrap: "wrap" }}>
                <span>자산: {signedKRW(closingReport.latestComment.assetDelta)}</span>
                <span>순자산: {signedKRW(closingReport.latestComment.netWorthDelta)}</span>
                <span>현금흐름: {signedKRW(closingReport.latestComment.cashflowDelta)}</span>
              </div>
            </div>
          )}

          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={monthly}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="periodKey" />
              <YAxis />
              <Tooltip formatter={(value: number | undefined) => formatKRW(value ?? 0)} />
              <Legend />
              <Line type="monotone" dataKey="asset" name="자산" stroke="#3b82f6" />
              <Line type="monotone" dataKey="debt" name="부채" stroke="#f97316" />
              <Line type="monotone" dataKey="netWorth" name="순자산" stroke="#10b981" />
            </LineChart>
          </ResponsiveContainer>

          <div style={{ overflowX: "auto", width: "100%", marginTop: 14 }}>
            <table className="data-table" style={{ width: "100%", minWidth: 980 }}>
              <thead>
                <tr>
                  <th>월</th>
                  <th>기간</th>
                  <th className="number">자산</th>
                  <th className="number">부채</th>
                  <th className="number">순자산</th>
                  <th className="number">현금흐름</th>
                </tr>
              </thead>
              <tbody>
                {monthly.map((row) => (
                  <tr key={`${row.periodKey}-${row.endDate}`}>
                    <td>{row.periodKey}</td>
                    <td>{row.startDate} ~ {row.endDate}</td>
                    <td className="number">{formatKRW(row.asset)}</td>
                    <td className="number">{formatKRW(row.debt)}</td>
                    <td className="number">{formatKRW(row.netWorth)}</td>
                    <td className={`number ${row.cashflow >= 0 ? "positive" : "negative"}`}>{formatKRW(row.cashflow)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ overflowX: "auto", width: "100%", marginTop: 14 }}>
            <table className="data-table" style={{ width: "100%", minWidth: 940 }}>
              <thead>
                <tr>
                  <th>주</th>
                  <th>기간</th>
                  <th className="number">자산</th>
                  <th className="number">부채</th>
                  <th className="number">순자산</th>
                  <th className="number">현금흐름</th>
                </tr>
              </thead>
              <tbody>
                {weekly.map((row) => (
                  <tr key={`${row.periodKey}-${row.endDate}`}>
                    <td>{row.periodKey}</td>
                    <td>{row.startDate} ~ {row.endDate}</td>
                    <td className="number">{formatKRW(row.asset)}</td>
                    <td className="number">{formatKRW(row.debt)}</td>
                    <td className="number">{formatKRW(row.netWorth)}</td>
                    <td className={`number ${row.cashflow >= 0 ? "positive" : "negative"}`}>{formatKRW(row.cashflow)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    // ─── 성과 분석 (고급) ───
    return (
      <div>
        <h3>성과 분석 (고급)</h3>
        {renderDateRange()}

        <div style={{ overflowX: "auto", width: "100%", marginBottom: 16 }}>
          <table className="data-table" style={{ width: "100%", minWidth: 1080 }}>
            <thead>
              <tr>
                <th>계좌</th>
                <th className="number">현재가치</th>
                <th className="number">IRR</th>
                <th className="number">TTWR</th>
                <th className="number">실현손익</th>
                <th className="number">미실현손익</th>
                <th className="number">배당</th>
                <th className="number">합계</th>
              </tr>
            </thead>
            <tbody>
              {accountPerformance.map((row) => (
                <tr key={row.accountId}>
                  <td>{row.accountName}</td>
                  <td className="number">{formatKRW(row.currentValue)}</td>
                  <td className={`number ${row.irr != null && row.irr >= 0 ? "positive" : "negative"}`}>{toPercent(row.irr)}</td>
                  <td className={`number ${row.ttwr != null && row.ttwr >= 0 ? "positive" : "negative"}`}>{toPercent(row.ttwr)}</td>
                  <td className={`number ${row.realizedPnl >= 0 ? "positive" : "negative"}`}>{formatKRW(row.realizedPnl)}</td>
                  <td className={`number ${row.unrealizedPnl >= 0 ? "positive" : "negative"}`}>{formatKRW(row.unrealizedPnl)}</td>
                  <td className={`number ${row.dividendContribution >= 0 ? "positive" : "negative"}`}>{formatKRW(row.dividendContribution)}</td>
                  <td className={`number ${row.totalContribution >= 0 ? "positive" : "negative"}`}>{formatKRW(row.totalContribution)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={accountPerformance.slice(0, 10)}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="accountName" interval={0} angle={-20} textAnchor="end" height={70} />
            <YAxis />
            <Tooltip formatter={(value: number | undefined) => formatKRW(value ?? 0)} />
            <Legend />
            <Bar dataKey="realizedPnl" stackId="p" fill="#0ea5e9" name="실현손익" />
            <Bar dataKey="unrealizedPnl" stackId="p" fill="#8b5cf6" name="미실현손익" />
            <Bar dataKey="dividendContribution" stackId="p" fill="#10b981" name="배당" />
          </BarChart>
        </ResponsiveContainer>

        <h4 style={{ marginTop: 20, marginBottom: 10 }}>월별 소비가 투자여력에 미치는 영향</h4>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={consumptionImpact}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip formatter={(value: number | undefined) => formatKRW(value ?? 0)} />
            <Legend />
            <Bar dataKey="consumptionExpense" fill="#f43f5e" name="소비 지출" />
            <Bar dataKey="investmentCapacity" fill="#6366f1" name="투자 여력" />
            <Bar dataKey="actualInvested" fill="#10b981" name="실제 투자" />
          </BarChart>
        </ResponsiveContainer>

        <div style={{ overflowX: "auto", width: "100%", marginTop: 14 }}>
          <table className="data-table" style={{ width: "100%", minWidth: 940 }}>
            <thead>
              <tr>
                <th>월</th>
                <th className="number">수입</th>
                <th className="number">소비 지출</th>
                <th className="number">투자 여력</th>
                <th className="number">실제 투자</th>
                <th className="number">갭</th>
                <th className="number">활용률</th>
              </tr>
            </thead>
            <tbody>
              {consumptionImpact.map((row) => (
                <tr key={row.month}>
                  <td>{row.month}</td>
                  <td className="number positive">{formatKRW(row.income)}</td>
                  <td className="number negative">{formatKRW(row.consumptionExpense)}</td>
                  <td className={`number ${row.investmentCapacity >= 0 ? "positive" : "negative"}`}>{formatKRW(row.investmentCapacity)}</td>
                  <td className={`number ${row.actualInvested >= 0 ? "positive" : "negative"}`}>{formatKRW(row.actualInvested)}</td>
                  <td className={`number ${row.capacityGap >= 0 ? "positive" : "negative"}`}>{formatKRW(row.capacityGap)}</td>
                  <td className="number">{row.capacityUtilizationRate != null ? `${row.capacityUtilizationRate.toFixed(1)}%` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const taxYear = useMemo(() => Number(selectedMonth.slice(0, 4)), [selectedMonth]);
  const taxSummary = useMemo(() => summarizeTaxYear(ledger, taxYear), [ledger, taxYear]);

  /** 현재 보고서 타입을 표 블록 목록으로 변환 — CSV·Excel·PDF가 공유. */
  const buildReportBlocks = (): { filename: string; title: string; subtitle?: string; blocks: ReportBlock[] } => {
    const today = new Date().toISOString().slice(0, 10);
    const blocks: ReportBlock[] = [];
    let title = "";
    let filenameBase: string = reportType;
    let subtitle: string | undefined;

    switch (reportType) {
      case "comprehensive": {
        title = "종합 월간";
        filenameBase = "종합_월간";
        subtitle = `${startDate.slice(0, 7)} ~ ${endDate.slice(0, 7)}`;
        blocks.push({
          title: "종합 월간",
          head: ["월", "근로소득", "자본소득", "비실질수입", "전체수입", "생활소비", "저축성지출", "대출상환", "신용결제", "전체지출", "매수", "매도", "실현손익", "배당", "투자이체", "투자출금", "이체총액", "실질순수입", "장부순수입", "실질저축률"],
          rows: comprehensiveMonthly.map((r) => [
            r.month, r.earnedIncome, r.capitalIncome, r.nonRealIncome, r.totalIncome,
            r.livingExpense, r.savingsExpense, r.loanRepayment, r.creditPayment, r.totalExpense,
            r.buyAmount, r.sellAmount, r.realizedPnl, r.dividendIncome, r.investingIn, r.investingOut,
            r.transferTotal, r.realNet, r.totalNet,
            r.realSavingsRate != null ? `${r.realSavingsRate.toFixed(1)}%` : "-"
          ])
        });
        break;
      }
      case "investment": {
        title = "투자 정산";
        filenameBase = "투자_정산";
        subtitle = "전체 기간 누적";
        const rec = reconciliation;
        if (rec.hasData) {
          blocks.push({
            title: "투자 요약",
            head: ["항목", "금액"],
            rows: [
              ["투자계좌 초기자본", Math.round(rec.initialCapital)],
              ["누적 입금", Math.round(rec.deposits)],
              ["누적 출금", Math.round(rec.withdrawals)],
              ["순투입원금", Math.round(rec.netContributed)],
              ["현재 평가액", Math.round(rec.currentValue)],
              ["투자 총성과", Math.round(rec.totalReturn)],
              ["총수익률", toPercent(rec.returnRate)],
              ["연환산 IRR", toPercent(rec.irr)],
              ["실현 이익", Math.round(rec.realizedGain)],
              ["실현 손실", Math.round(rec.realizedLoss)],
              ["실현 손익(순)", Math.round(rec.realizedPnl)],
              ["미실현 이익", Math.round(rec.unrealizedGain)],
              ["미실현 손실", Math.round(rec.unrealizedLoss)],
              ["미실현 손익(순)", Math.round(rec.unrealizedPnl)],
              ["배당 수입", Math.round(rec.dividendIncome)],
              ["매수 총액", Math.round(rec.buyVolume)],
              ["매도 총액", Math.round(rec.sellVolume)]
            ]
          });
          if (rec.accounts.length > 0) {
            blocks.push({
              title: "계좌별 정산",
              head: ["계좌", "순투입원금", "현재평가액", "총성과", "실현", "미실현", "배당", "IRR"],
              rows: rec.accounts.map((a) => [
                a.accountName, Math.round(a.netContributed), Math.round(a.currentValue),
                Math.round(a.totalReturn), Math.round(a.realizedPnl), Math.round(a.unrealizedPnl),
                Math.round(a.dividendIncome), toPercent(a.irr)
              ])
            });
          }
          if (rec.winningTrades.length > 0) {
            blocks.push({
              title: "확정수익 거래",
              head: ["매도일", "종목", "계좌", "실현손익", "수익률"],
              rows: rec.winningTrades.map((t) => [t.date, t.name, t.accountName, Math.round(t.pnl), toPercent(t.returnRate)])
            });
          }
          if (rec.losingTrades.length > 0) {
            blocks.push({
              title: "확정손실 거래",
              head: ["매도일", "종목", "계좌", "실현손익", "수익률"],
              rows: rec.losingTrades.map((t) => [t.date, t.name, t.accountName, Math.round(t.pnl), toPercent(t.returnRate)])
            });
          }
          if (rec.winningPositions.length > 0) {
            blocks.push({
              title: "평가수익 종목",
              head: ["종목", "계좌", "평가손익", "손익률"],
              rows: rec.winningPositions.map((p) => [p.name, p.accountName, Math.round(p.pnl), toPercent(p.pnlRate)])
            });
          }
          if (rec.losingPositions.length > 0) {
            blocks.push({
              title: "평가손실 종목",
              head: ["종목", "계좌", "평가손익", "손익률"],
              rows: rec.losingPositions.map((p) => [p.name, p.accountName, Math.round(p.pnl), toPercent(p.pnlRate)])
            });
          }
          if (rec.monthlyPnl.length > 0) {
            blocks.push({
              title: "월별 실현손익",
              head: ["월", "실현이익", "실현손실"],
              rows: rec.monthlyPnl.map((m) => [m.month, Math.round(m.realizedGain), Math.round(m.realizedLoss)])
            });
          }
        }
        break;
      }
      case "monthly": {
        title = "월별 수입/지출";
        filenameBase = "월별_수입지출";
        subtitle = `${startDate.slice(0, 7)} ~ ${endDate.slice(0, 7)}`;
        blocks.push({
          title: "월별 수입/지출",
          head: ["월", "수입", "지출", "이체", "순수입"],
          rows: monthlyReport.map((r) => [r.month, r.income, r.expense, r.transfer, r.net])
        });
        if (monthlyIncomeDetail.length > 0) {
          blocks.push({
            title: "수입 상세",
            head: ["월", "일자", "대분류", "중분류", "내용", "계좌", "금액"],
            rows: monthlyIncomeDetail.map((d) => [d.month, d.date, d.category, d.subCategory ?? "", d.description, d.accountName ?? "", d.amount])
          });
        }
        break;
      }
      case "yearly": {
        title = "연간 요약";
        filenameBase = "연간_요약";
        blocks.push({
          title: "연간 요약",
          head: ["연도", "수입", "지출", "순수입"],
          rows: yearlyReport.map((r) => [r.month, r.income, r.expense, r.net])
        });
        break;
      }
      case "category": {
        title = "카테고리별 지출";
        filenameBase = "카테고리별_지출";
        subtitle = `${startDate} ~ ${endDate}`;
        blocks.push({
          title: "카테고리별 지출",
          head: ["대분류", "중분류", "합계", "건수", "평균"],
          rows: categoryReport.map((r) => [r.category, r.subCategory ?? "-", r.total, r.count, Math.round(r.average)])
        });
        break;
      }
      case "stock": {
        title = "주식 성과";
        filenameBase = "주식_성과";
        blocks.push({
          title: "주식 성과",
          head: ["종목코드", "종목명", "수량", "매수총액", "현재가치", "손익", "손익률", "IRR"],
          rows: stockReport.map((r) => [r.ticker, r.name, r.quantity, Math.round(r.totalBuyAmount), Math.round(r.currentValue), Math.round(r.pnl), toPercent(r.pnlRate), toPercent(r.irr)])
        });
        break;
      }
      case "account": {
        title = "계좌 요약";
        filenameBase = "계좌_요약";
        blocks.push({
          title: "계좌 요약",
          head: ["계좌명", "초기잔액", "현재잔액", "변동", "변동률"],
          rows: accountReport.map((r) => [r.accountName, Math.round(r.initialBalance), Math.round(r.currentBalance), Math.round(r.change), `${r.changeRate.toFixed(2)}%`])
        });
        break;
      }
      case "daily": {
        title = "일별 자산 스냅샷";
        filenameBase = "일별_스냅샷";
        subtitle = `${startDate} ~ ${endDate}`;
        blocks.push({
          title: "일별 자산 스냅샷",
          head: ["날짜", "수입", "지출", "저축성지출", "이체", "주식평가", "현금", "저축자산", "총자산", "순자산"],
          rows: dailyReport.map((r) => [r.date, r.income, r.expense, r.savingsExpense, r.transfer, Math.round(r.stockValue), Math.round(r.cashValue), Math.round(r.savingsValue), Math.round(r.totalAsset), Math.round(r.netWorth)])
        });
        break;
      }
      case "periodCompare": {
        title = "기간 비교";
        filenameBase = "기간_비교";
        subtitle = `${periodCompare.thisMonthKey} vs ${periodCompare.lastMonthKey}`;
        const t = periodCompare.thisMonth;
        const l = periodCompare.lastMonth;
        const row = (label: string, a: number, b: number): (string | number)[] => [label, Math.round(a), Math.round(b), Math.round(a - b)];
        blocks.push({
          title: "기간 비교",
          head: ["항목", periodCompare.thisMonthKey, periodCompare.lastMonthKey, "차이"],
          rows: [
            row("수입", t.income, l.income),
            row("지출", t.expense, l.expense),
            row("저축성 지출", t.savings, l.savings),
            row("투자 순액", t.investingNet, l.investingNet),
            row("순수입", t.net, l.net)
          ]
        });
        break;
      }
      case "closing": {
        title = "주간/월간 정산";
        filenameBase = "정산_보고서";
        const head = ["기간", "시작", "종료", "자산", "부채", "순자산", "수입", "지출", "현금흐름"];
        const toRow = (s: (typeof closingReport.monthlySnapshots)[number]): (string | number)[] => [
          s.periodKey, s.startDate, s.endDate, Math.round(s.asset), Math.round(s.debt),
          Math.round(s.netWorth), Math.round(s.income), Math.round(s.expense), Math.round(s.cashflow)
        ];
        if (closingReport.monthlySnapshots.length > 0) {
          blocks.push({ title: "월간 스냅샷", head, rows: closingReport.monthlySnapshots.map(toRow) });
        }
        if (closingReport.weeklySnapshots.length > 0) {
          blocks.push({ title: "주간 스냅샷", head, rows: closingReport.weeklySnapshots.map(toRow) });
        }
        break;
      }
      case "performanceAdvanced": {
        title = "성과 분석";
        filenameBase = "성과_분석";
        subtitle = `${startDate} ~ ${endDate}`;
        blocks.push({
          title: "계좌별 성과 기여",
          head: ["계좌", "현재가치", "실현손익", "미실현손익", "배당기여", "총기여", "IRR", "TTWR"],
          rows: accountPerformance.map((r) => [r.accountName, Math.round(r.currentValue), Math.round(r.realizedPnl), Math.round(r.unrealizedPnl), Math.round(r.dividendContribution), Math.round(r.totalContribution), toPercent(r.irr), toPercent(r.ttwr)])
        });
        blocks.push({
          title: "소비가 투자여력에 미치는 영향",
          head: ["월", "수입", "소비지출", "투자여력", "실제투자", "갭", "활용률"],
          rows: consumptionImpact.map((r) => [r.month, r.income, r.consumptionExpense, r.investmentCapacity, r.actualInvested, r.capacityGap, r.capacityUtilizationRate != null ? `${r.capacityUtilizationRate.toFixed(1)}%` : "-"])
        });
        break;
      }
      case "tax": {
        title = `세금 ${taxYear}`;
        filenameBase = `세금_${taxYear}`;
        subtitle = `${taxYear}년 · 한국 세법 기준`;
        const rows: (string | number)[][] = [
          ["배당 (총)", Math.round(taxSummary.dividendGross)],
          ["이자 (총)", Math.round(taxSummary.interestGross)],
          ["합계", Math.round(taxSummary.totalGross)],
          ["분리과세 (15.4%)", Math.round(taxSummary.separateTax)],
          ["실수령액", Math.round(taxSummary.netIncome)]
        ];
        if (taxSummary.exceedsThreshold) {
          rows.push(["종합과세 기준 초과액", Math.round(taxSummary.amountOverThreshold)]);
          rows.push(["종합과세 추가세(추정)", Math.round(taxSummary.estimatedAdditionalTaxIfComprehensive)]);
        }
        blocks.push({ title: `세금 ${taxYear}`, head: ["항목", "금액"], rows });
        break;
      }
    }

    return { filename: `${filenameBase}_${today}`, title, subtitle, blocks };
  };

  const exportCurrentExcel = () => {
    const { filename, blocks } = buildReportBlocks();
    if (!hasReportRows(blocks)) {
      toast.error(ERROR_MESSAGES.NO_DATA_TO_EXPORT);
      return;
    }
    downloadAsExcel(`farmwallet-${filename}`, blocksToSheets(blocks));
    toast.success("Excel 내보내기 완료");
  };

  const exportCurrentPdf = () => {
    const { title, subtitle, blocks } = buildReportBlocks();
    if (!hasReportRows(blocks)) {
      toast.error(ERROR_MESSAGES.NO_DATA_TO_EXPORT);
      return;
    }
    openPrintWindow({ title, subtitle, bodyHtml: blocksToHtml(blocks) });
  };

  const renderTaxReport = () => (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <label>연도:</label>
        <select value={taxYear} onChange={(e) => {
          const y = e.target.value;
          setSelectedMonth(`${y}-${selectedMonth.slice(5)}`);
        }}>
          {Array.from({ length: 6 }).map((_, i) => {
            const y = new Date().getFullYear() - i;
            return <option key={y} value={y}>{y}년</option>;
          })}
        </select>
      </div>
      <h3>세금 시뮬레이션 — {taxYear}년 (한국 세법 기준)</h3>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          <tr><td style={{ padding: 6 }}>배당 (총)</td><td style={{ textAlign: "right", padding: 6 }}>{formatKRW(taxSummary.dividendGross)}</td></tr>
          <tr><td style={{ padding: 6 }}>이자 (총)</td><td style={{ textAlign: "right", padding: 6 }}>{formatKRW(taxSummary.interestGross)}</td></tr>
          <tr style={{ borderTop: "1px solid var(--border)" }}><td style={{ padding: 6, fontWeight: 700 }}>합계</td><td style={{ textAlign: "right", padding: 6, fontWeight: 700 }}>{formatKRW(taxSummary.totalGross)}</td></tr>
          <tr><td style={{ padding: 6 }}>분리과세 (15.4%)</td><td style={{ textAlign: "right", padding: 6 }}>−{formatKRW(Math.round(taxSummary.separateTax))}</td></tr>
          <tr style={{ borderTop: "1px solid var(--border)" }}><td style={{ padding: 6, fontWeight: 700 }}>실수령액 (분리과세 후)</td><td style={{ textAlign: "right", padding: 6, fontWeight: 700, color: "var(--success)" }}>{formatKRW(Math.round(taxSummary.netIncome))}</td></tr>
        </tbody>
      </table>
      {taxSummary.exceedsThreshold && (
        <div style={{ marginTop: 16, padding: 12, background: "var(--warning-bg, #fef3c7)", borderLeft: "4px solid var(--warning, #f59e0b)", borderRadius: 6 }}>
          <strong>⚠ 종합과세 대상 가능</strong>
          <p style={{ fontSize: 13, margin: "8px 0 4px" }}>
            배당+이자 합계가 {COMPREHENSIVE_TAX_THRESHOLD.toLocaleString()}원을 초과합니다.
            초과액 {formatKRW(taxSummary.amountOverThreshold)}에 대해 종합소득세 신고가 필요할 수 있으며,
            추정 추가세부담은 약 <strong>{formatKRW(Math.round(taxSummary.estimatedAdditionalTaxIfComprehensive))}</strong>입니다 (24% 누진구간 가정).
          </p>
          <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
            ※ 정확한 금액은 다른 종합소득(근로/사업) 합산에 따라 달라집니다. 본 수치는 참고용입니다.
          </p>
        </div>
      )}
    </div>
  );

  return (
    <div>
      <div className="section-header">
        <h2>보고서</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={exportCurrentExcel}>Excel</button>
          <button type="button" onClick={exportCurrentPdf}>PDF/인쇄</button>
          <button type="button" className="primary" onClick={exportCurrentCsv}>
            CSV 내보내기
          </button>
        </div>
      </div>

      <div className="hint" style={{ marginBottom: 8, fontSize: 12 }}>
        실현 손익·승률·보유기간 중심 요약은 <strong>대시보드 → 투자 기록 카드</strong>에서 확인할 수 있습니다.
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button type="button" className={reportType === "comprehensive" ? "primary" : ""} onClick={() => setReportType("comprehensive")}>종합 월간</button>
        <button type="button" className={reportType === "investment" ? "primary" : ""} onClick={() => setReportType("investment")}>투자 정산</button>
        <button type="button" className={reportType === "monthly" ? "primary" : ""} onClick={() => setReportType("monthly")}>월별</button>
        <button type="button" className={reportType === "yearly" ? "primary" : ""} onClick={() => setReportType("yearly")}>연간</button>
        <button type="button" className={reportType === "category" ? "primary" : ""} onClick={() => setReportType("category")}>카테고리별</button>
        <button type="button" className={reportType === "stock" ? "primary" : ""} onClick={() => setReportType("stock")}>주식 성과</button>
        <button type="button" className={reportType === "account" ? "primary" : ""} onClick={() => setReportType("account")}>계좌별</button>
        <button type="button" className={reportType === "daily" ? "primary" : ""} onClick={() => setReportType("daily")}>일별</button>
        <button type="button" className={reportType === "periodCompare" ? "primary" : ""} onClick={() => setReportType("periodCompare")}>기간 비교</button>
        <button type="button" className={reportType === "closing" ? "primary" : ""} onClick={() => setReportType("closing")}>주간/월간 정산</button>
        <button type="button" className={reportType === "performanceAdvanced" ? "primary" : ""} onClick={() => setReportType("performanceAdvanced")}>성과 분석</button>
        <button type="button" className={reportType === "tax" ? "primary" : ""} onClick={() => setReportType("tax")}>세금 (한국)</button>
      </div>

      <div className="card">{reportType === "tax" ? renderTaxReport() : renderReport()}</div>
    </div>
  );
};
