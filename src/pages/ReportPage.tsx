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
  reportToCSV,
  type ComprehensiveMonthlyRow
} from "../utils/reportGenerator";
import { formatKRW } from "../utils/formatter";
import { toast } from "react-hot-toast";
import { ERROR_MESSAGES } from "../constants/errorMessages";
import { useFxRateValue } from "../context/FxRateContext";
import { useReportWorker } from "../hooks/useReportWorker";
import { isSavingsExpenseEntry } from "../utils/category";
import { summarizeTaxYear, COMPREHENSIVE_TAX_THRESHOLD } from "../utils/taxCalculator";
import { downloadAsExcel, type SheetData } from "../utils/excelExport";
import { openPrintWindow } from "../utils/pdfExport";

/** 카테고리별 집계 행 */
interface CategoryBreakdownRow {
  category: string;
  subCategory: string;
  amount: number;
  count: number;
}

/** 월 내 카테고리별 상세 (수입/지출/이체별) */
interface MonthCategoryDetail {
  incomeRows: CategoryBreakdownRow[];
  livingRows: CategoryBreakdownRow[];
  savingsRows: CategoryBreakdownRow[];
  creditRows: CategoryBreakdownRow[];
  transferRows: CategoryBreakdownRow[];
}

function buildMonthCategoryDetail(
  ledger: LedgerEntry[],
  accounts: Account[],
  month: string,
  fxRate: number | null
): MonthCategoryDetail {
  const toKrw = (e: LedgerEntry) =>
    e.currency === "USD" && fxRate ? e.amount * fxRate : e.amount;

  const incomeMap = new Map<string, { amount: number; count: number }>();
  const livingMap = new Map<string, { amount: number; count: number }>();
  const savingsMap = new Map<string, { amount: number; count: number }>();
  const creditMap = new Map<string, { amount: number; count: number }>();
  const transferMap = new Map<string, { amount: number; count: number }>();

  const add = (map: Map<string, { amount: number; count: number }>, key: string, amount: number) => {
    const row = map.get(key);
    if (row) { row.amount += amount; row.count += 1; }
    else map.set(key, { amount, count: 1 });
  };

  for (const entry of ledger) {
    if (!entry.date.startsWith(month)) continue;
    const amount = toKrw(entry);
    const cat = entry.category ?? "";
    const sub = entry.subCategory ?? "";
    const key = sub ? `${cat}::${sub}` : cat;

    if (entry.kind === "income") {
      add(incomeMap, key, amount);
    } else if (entry.kind === "expense") {
      // 저축성지출(재테크/저축성지출 카테고리)은 savings. 단 투자손실은 실질 지출이므로 제외(isSavingsExpenseEntry 내부에서 이미 처리).
      if (isSavingsExpenseEntry(entry, accounts)) {
        add(savingsMap, key, amount);
      } else if (cat === "신용결제" || cat === "신용카드") {
        add(creditMap, key, amount);
      } else {
        add(livingMap, key, amount);
      }
    } else if (entry.kind === "transfer") {
      // 저축/투자 이체 → savings로 집계
      if (sub === "저축이체" || sub === "투자이체" || sub === "저축" || sub === "투자") {
        add(savingsMap, key, amount);
        continue;
      }
      // 카드 계좌로의 이체 = 신용결제
      const toAcc = entry.toAccountId ? accounts.find(a => a.id === entry.toAccountId) : undefined;
      if (toAcc && toAcc.type === "card") {
        add(creditMap, key, amount);
      } else {
        add(transferMap, key, amount);
      }
    }
  }

  const toRows = (map: Map<string, { amount: number; count: number }>): CategoryBreakdownRow[] =>
    Array.from(map.entries())
      .map(([key, val]) => {
        const [category, subCategory = ""] = key.split("::");
        return { category, subCategory, amount: val.amount, count: val.count };
      })
      .sort((a, b) => b.amount - a.amount);

  return {
    incomeRows: toRows(incomeMap),
    livingRows: toRows(livingMap),
    savingsRows: toRows(savingsMap),
    creditRows: toRows(creditMap),
    transferRows: toRows(transferMap)
  };
}

interface Props {
  accounts: Account[];
  ledger: LedgerEntry[];
  trades: StockTrade[];
  prices: StockPrice[];
}

type ReportType =
  | "comprehensive"
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

  /** 선택 월 카테고리별 상세 */
  const catDetail = useMemo(
    () => buildMonthCategoryDetail(ledger, accounts, selectedMonth, fxRate),
    [ledger, accounts, selectedMonth, fxRate]
  );

  /** 카테고리 상세 테이블 렌더 */
  const renderCatTable = (rows: CategoryBreakdownRow[], totalLabel: string) => {
    if (rows.length === 0) return <p style={{ color: "var(--text-muted)", margin: "4px 0" }}>내역 없음</p>;
    const total = rows.reduce((s, r) => s + r.amount, 0);
    const totalCount = rows.reduce((s, r) => s + r.count, 0);
    return (
      <table className="data-table" style={{ width: "100%", marginTop: 4 }}>
        <thead>
          <tr>
            <th>대분류</th>
            <th>중분류</th>
            <th className="number">금액</th>
            <th className="number">건수</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={`${row.category}-${row.subCategory}-${i}`}>
              <td>{row.category}</td>
              <td>{row.subCategory || "-"}</td>
              <td className="number">{formatKRW(row.amount)}</td>
              <td className="number">{row.count}</td>
            </tr>
          ))}
          <tr style={{ fontWeight: 700, borderTop: "2px solid var(--border)" }}>
            <td colSpan={2}>{totalLabel}</td>
            <td className="number">{formatKRW(total)}</td>
            <td className="number">{totalCount}</td>
          </tr>
        </tbody>
      </table>
    );
  };

  const exportCurrentCsv = () => {
    let filename = "";
    let csv = "";
    switch (reportType) {
      case "monthly":
        csv = reportToCSV(monthlyReport) + (monthlyIncomeDetail.length ? `\n\n${reportToCSV(monthlyIncomeDetail)}` : "");
        filename = "월별_수입지출";
        break;
      case "yearly":
        csv = reportToCSV(yearlyReport);
        filename = "연간_요약";
        break;
      case "category":
        csv = reportToCSV(categoryReport);
        filename = "카테고리별_지출";
        break;
      case "stock":
        csv = reportToCSV(stockReport);
        filename = "주식_성과";
        break;
      case "account":
        csv = reportToCSV(accountReport);
        filename = "계좌_요약";
        break;
      case "daily":
        csv = reportToCSV(dailyReport);
        filename = "일별_스냅샷";
        break;
      case "periodCompare":
        csv = reportToCSV([
          { 항목: "수입", 이번달: periodCompare.thisMonth.income, 지난달: periodCompare.lastMonth.income },
          { 항목: "지출", 이번달: periodCompare.thisMonth.expense, 지난달: periodCompare.lastMonth.expense },
          { 항목: "저축성지출", 이번달: periodCompare.thisMonth.savings, 지난달: periodCompare.lastMonth.savings },
          { 항목: "투자순액", 이번달: periodCompare.thisMonth.investingNet, 지난달: periodCompare.lastMonth.investingNet },
          { 항목: "순수입", 이번달: periodCompare.thisMonth.net, 지난달: periodCompare.lastMonth.net }
        ]);
        filename = "기간_비교";
        break;
      case "closing":
        csv = `${reportToCSV(closingReport.monthlySnapshots)}\n\n${reportToCSV(closingReport.weeklySnapshots)}`;
        filename = "정산_보고서";
        break;
      case "performanceAdvanced":
        csv = `${reportToCSV(accountPerformance)}\n\n${reportToCSV(consumptionImpact)}`;
        filename = "성과_분석";
        break;
      case "comprehensive":
        csv = reportToCSV(comprehensiveMonthly);
        filename = "종합_월간";
        break;
    }

    if (!csv) {
      toast.error(ERROR_MESSAGES.NO_DATA_TO_EXPORT);
      return;
    }
    const fileDate = new Date().toISOString().slice(0, 10);
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `${filename}_${fileDate}.csv`);
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

  const exportCurrentExcel = () => {
    const sheets: SheetData[] = [];
    if (reportType === "tax") {
      sheets.push({
        name: `세금 ${taxYear}`,
        rows: [
          ["항목", "금액(원)"],
          ["배당 (총)", taxSummary.dividendGross],
          ["이자 (총)", taxSummary.interestGross],
          ["합계", taxSummary.totalGross],
          ["분리과세 (15.4%)", taxSummary.separateTax],
          ["실수령액", taxSummary.netIncome],
          ["종합과세 기준 초과액", taxSummary.amountOverThreshold],
          ["종합과세 시 추가 세부담(추정)", taxSummary.estimatedAdditionalTaxIfComprehensive]
        ]
      });
    } else if (reportType === "comprehensive" && comprehensiveMonthly.length > 0) {
      sheets.push({
        name: "종합 월간",
        rows: [
          ["월", "수입", "지출", "저축", "이체", "신용결제"],
          ...comprehensiveMonthly.map((r: any) => [
            r.month,
            r.income ?? 0,
            r.living ?? 0,
            r.savings ?? 0,
            r.transfer ?? 0,
            r.credit ?? 0
          ])
        ]
      });
    } else {
      sheets.push({ name: reportType, rows: [["보고서 데이터를 Excel로 내보냅니다."], ["현재 화면 데이터를 참고해주세요."]] });
    }
    downloadAsExcel(`farmwallet-${reportType}-${new Date().toISOString().slice(0, 10)}`, sheets);
  };

  const exportCurrentPdf = () => {
    let bodyHtml = "";
    if (reportType === "tax") {
      bodyHtml = `<table>
<tr><th>항목</th><th>금액</th></tr>
<tr><td>배당 (총)</td><td class="num">${taxSummary.dividendGross.toLocaleString()}원</td></tr>
<tr><td>이자 (총)</td><td class="num">${taxSummary.interestGross.toLocaleString()}원</td></tr>
<tr><td><b>합계</b></td><td class="num"><b>${taxSummary.totalGross.toLocaleString()}원</b></td></tr>
<tr><td>분리과세 (15.4%)</td><td class="num">${Math.round(taxSummary.separateTax).toLocaleString()}원</td></tr>
<tr><td>실수령액</td><td class="num">${Math.round(taxSummary.netIncome).toLocaleString()}원</td></tr>
${taxSummary.exceedsThreshold ? `<tr><td>종합과세 추가세 (추정)</td><td class="num">${Math.round(taxSummary.estimatedAdditionalTaxIfComprehensive).toLocaleString()}원</td></tr>` : ""}
</table>`;
    } else {
      bodyHtml = `<p>리포트: ${reportType}. 화면의 표를 인쇄하시려면 브라우저 인쇄 기능을 사용해주세요.</p>`;
    }
    openPrintWindow({ title: `리포트 — ${reportType}`, subtitle: `${startDate} ~ ${endDate}`, bodyHtml });
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

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button type="button" className={reportType === "comprehensive" ? "primary" : ""} onClick={() => setReportType("comprehensive")}>종합 월간</button>
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
