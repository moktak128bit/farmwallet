import React, { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from "recharts";
import type { Account, LedgerEntry, StockTrade, StockPrice } from "../types";
import {
  generateMonthlyReport,
  generateYearlyReport,
  generateCategoryReport,
  generateStockPerformanceReport,
  generateAccountReport,
  generateMonthlyIncomeDetail,
  generateDailyReport,
  reportToCSV,
  type MonthlyReport,
  type CategoryReport,
  type StockPerformanceReport,
  type AccountReport,
  type MonthlyIncomeDetail,
  type DailyReport
} from "../utils/reportGenerator";
import { formatKRW } from "../utils/format";
import { toast } from "react-hot-toast";
import { useFxRate } from "../hooks/useFxRate";
import { isSavingsExpenseEntry } from "../utils/categoryUtils";

interface Props {
  accounts: Account[];
  ledger: LedgerEntry[];
  trades: StockTrade[];
  prices: StockPrice[];
}

type ReportType = "monthly" | "yearly" | "category" | "stock" | "account" | "daily" | "periodCompare";

export const ReportView: React.FC<Props> = ({ accounts, ledger, trades, prices }) => {
  const fxRate = useFxRate();
  const [reportType, setReportType] = useState<ReportType>("monthly");
  const [startDate, setStartDate] = useState<string>(() => {
    const date = new Date();
    date.setMonth(date.getMonth() - 11);
    return date.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  const monthlyReport = useMemo(() => {
    return generateMonthlyReport(ledger, startDate.slice(0, 7), endDate.slice(0, 7));
  }, [ledger, startDate, endDate]);

  const monthlyIncomeDetail = useMemo(() => {
    return generateMonthlyIncomeDetail(ledger, accounts, startDate.slice(0, 7), endDate.slice(0, 7));
  }, [ledger, accounts, startDate, endDate]);

  const yearlyReport = useMemo(() => {
    return generateYearlyReport(ledger);
  }, [ledger]);

  const categoryReport = useMemo(() => {
    return generateCategoryReport(ledger, startDate, endDate);
  }, [ledger, startDate, endDate]);

  const stockReport = useMemo(() => {
    return generateStockPerformanceReport(trades, prices, accounts);
  }, [trades, prices, accounts]);

  const accountReport = useMemo(() => {
    return generateAccountReport(accounts, ledger, trades);
  }, [accounts, ledger, trades]);

  const dailyReport = useMemo(() => {
    return generateDailyReport(accounts, ledger, trades, prices, startDate, endDate, fxRate || undefined);
  }, [accounts, ledger, trades, prices, startDate, endDate, fxRate]);

  const periodCompareData = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const thisMonthKey = `${year}-${String(month).padStart(2, "0")}`;
    const lastMonthKey =
      month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
    const sum = (entries: LedgerEntry[]) => {
      let income = 0;
      let expense = 0;
      let savings = 0;
      let transfer = 0;
      entries.forEach((l) => {
        if (l.kind === "income") income += l.amount;
        else if (isSavingsExpenseEntry(l, accounts)) savings += l.amount;
        else if (l.kind === "transfer") transfer += l.amount;
        else expense += l.amount;
      });
      return { income, expense, savings, transfer, net: income - expense - savings };
    };
    const thisMonthLedger = ledger.filter((l) => l.date.startsWith(thisMonthKey));
    const lastMonthLedger = ledger.filter((l) => l.date.startsWith(lastMonthKey));
    return {
      thisMonthKey,
      lastMonthKey,
      thisMonth: sum(thisMonthLedger),
      lastMonth: sum(lastMonthLedger)
    };
  }, [ledger, accounts]);

  const handleExportCSV = () => {
    let csvContent = "";
    let filename = "";

    switch (reportType) {
      case "monthly":
        // 월별 리포트와 배당/이자 상세를 함께 내보내기
        const monthlyReportCSV = reportToCSV(monthlyReport);
        const monthlyIncomeDetailCSV = reportToCSV(monthlyIncomeDetail);
        csvContent = monthlyReportCSV + (monthlyIncomeDetailCSV ? "\n\n" + monthlyIncomeDetailCSV : "");
        filename = `월별_리포트_${new Date().toISOString().slice(0, 10)}.csv`;
        break;
      case "yearly":
        csvContent = reportToCSV(yearlyReport);
        filename = `연도별_리포트_${new Date().toISOString().slice(0, 10)}.csv`;
        break;
      case "category":
        csvContent = reportToCSV(categoryReport);
        filename = `카테고리별_리포트_${new Date().toISOString().slice(0, 10)}.csv`;
        break;
      case "stock":
        csvContent = reportToCSV(stockReport);
        filename = `주식_성과_리포트_${new Date().toISOString().slice(0, 10)}.csv`;
        break;
      case "account":
        csvContent = reportToCSV(accountReport);
        filename = `계좌_리포트_${new Date().toISOString().slice(0, 10)}.csv`;
        break;
      case "daily":
        csvContent = reportToCSV(dailyReport);
        filename = `일별_리포트_${new Date().toISOString().slice(0, 10)}.csv`;
        break;
      case "periodCompare": {
        const { thisMonthKey, lastMonthKey, thisMonth, lastMonth } = periodCompareData;
        const fmt = (n: number) => String(n);
        csvContent = [
          ["항목", thisMonthKey, lastMonthKey, "차이"].join(","),
          ["수입", fmt(thisMonth.income), fmt(lastMonth.income), fmt(thisMonth.income - lastMonth.income)].join(","),
          ["지출", fmt(thisMonth.expense), fmt(lastMonth.expense), fmt(thisMonth.expense - lastMonth.expense)].join(","),
          ["저축성지출", fmt(thisMonth.savings), fmt(lastMonth.savings), fmt(thisMonth.savings - lastMonth.savings)].join(","),
          ["이체", fmt(thisMonth.transfer), fmt(lastMonth.transfer), fmt(thisMonth.transfer - lastMonth.transfer)].join(","),
          ["순수입", fmt(thisMonth.net), fmt(lastMonth.net), fmt(thisMonth.net - lastMonth.net)].join(",")
        ].join("\n");
        filename = `기간비교_${thisMonthKey}_${lastMonthKey}.csv`;
        break;
      }
    }

    if (!csvContent) {
      toast.error("내보낼 데이터가 없습니다");
      return;
    }

    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("CSV 파일로 내보냈습니다");
  };

  const renderReport = () => {
    switch (reportType) {
      case "monthly":
        return (
          <div>
            <h3>월별 수입/지출 리포트</h3>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span>시작 월:</span>
                <input
                  type="month"
                  value={startDate.slice(0, 7)}
                  onChange={(e) => setStartDate(e.target.value + "-01")}
                />
                <span>종료 월:</span>
                <input
                  type="month"
                  value={endDate.slice(0, 7)}
                  onChange={(e) => {
                    const lastDay = new Date(e.target.value + "-01");
                    lastDay.setMonth(lastDay.getMonth() + 1);
                    lastDay.setDate(0);
                    setEndDate(lastDay.toISOString().slice(0, 10));
                  }}
                />
              </label>
            </div>
            <ResponsiveContainer width="100%" height={400}>
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
            <div style={{ overflowX: "auto", width: "100%" }}>
              <table className="data-table" style={{ marginTop: 24, width: "100%", minWidth: "600px" }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: "100px" }}>월</th>
                    <th className="number" style={{ minWidth: "120px" }}>수입</th>
                    <th className="number" style={{ minWidth: "120px" }}>지출</th>
                    <th className="number" style={{ minWidth: "120px" }}>이체</th>
                    <th className="number" style={{ minWidth: "120px" }}>순수입</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyReport.map((r) => (
                    <tr key={r.month}>
                      <td>{r.month}</td>
                      <td className="number positive">{formatKRW(r.income)}</td>
                      <td className="number negative">{formatKRW(r.expense)}</td>
                      <td className="number">{formatKRW(r.transfer)}</td>
                      <td className={`number ${r.net >= 0 ? "positive" : "negative"}`}>
                        {formatKRW(r.net)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            {/* 배당/이자 수입 상세 테이블 */}
            {monthlyIncomeDetail.length > 0 && (
              <div style={{ marginTop: 32 }}>
                <h4 style={{ marginBottom: 16 }}>배당/이자 수입 상세 (월별)</h4>
                <div style={{ overflowX: "auto", width: "100%" }}>
                  <table className="data-table" style={{ width: "100%", minWidth: "800px" }}>
                    <thead>
                      <tr>
                        <th style={{ minWidth: "80px" }}>월</th>
                        <th style={{ minWidth: "100px" }}>날짜</th>
                        <th style={{ minWidth: "100px" }}>카테고리</th>
                        <th style={{ minWidth: "100px" }}>세부 항목</th>
                        <th style={{ minWidth: "150px" }}>설명</th>
                        <th style={{ minWidth: "120px" }}>계좌</th>
                        <th className="number" style={{ minWidth: "120px" }}>금액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyIncomeDetail.map((detail, idx) => (
                        <tr key={idx}>
                          <td>{detail.month}</td>
                          <td>{detail.date}</td>
                          <td>{detail.category || "-"}</td>
                          <td>{detail.subCategory || "-"}</td>
                          <td style={{ whiteSpace: "normal", wordBreak: "break-word" }}>{detail.description || "-"}</td>
                          <td>{detail.accountName || detail.accountId || "-"}</td>
                          <td className="number positive">{formatKRW(detail.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );

      case "yearly":
        return (
          <div>
            <h3>연도별 수입/지출 리포트</h3>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={yearlyReport}>
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
            <div style={{ overflowX: "auto", width: "100%" }}>
              <table className="data-table" style={{ marginTop: 24, width: "100%", minWidth: "600px" }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: "100px" }}>연도</th>
                    <th className="number" style={{ minWidth: "120px" }}>수입</th>
                    <th className="number" style={{ minWidth: "120px" }}>지출</th>
                    <th className="number" style={{ minWidth: "120px" }}>이체</th>
                    <th className="number" style={{ minWidth: "120px" }}>순수입</th>
                  </tr>
                </thead>
                <tbody>
                  {yearlyReport.map((r) => (
                    <tr key={r.month}>
                      <td>{r.month}</td>
                      <td className="number positive">{formatKRW(r.income)}</td>
                      <td className="number negative">{formatKRW(r.expense)}</td>
                      <td className="number">{formatKRW(r.transfer)}</td>
                      <td className={`number ${r.net >= 0 ? "positive" : "negative"}`}>
                        {formatKRW(r.net)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );

      case "category":
        const topCategories = categoryReport.slice(0, 10);
        return (
          <div>
            <h3>카테고리별 지출 리포트</h3>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span>시작일:</span>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                <span>종료일:</span>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </label>
            </div>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={topCategories} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="category" type="category" width={150} />
                <Tooltip formatter={(value: number | undefined) => formatKRW(value ?? 0)} />
                <Bar dataKey="total" fill="#6366f1" />
              </BarChart>
            </ResponsiveContainer>
            <div style={{ overflowX: "auto", width: "100%" }}>
              <table className="data-table" style={{ marginTop: 24, width: "100%", minWidth: "600px" }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: "120px" }}>카테고리</th>
                    <th style={{ minWidth: "120px" }}>세부 항목</th>
                    <th className="number" style={{ minWidth: "120px" }}>총액</th>
                    <th className="number" style={{ minWidth: "80px" }}>건수</th>
                    <th className="number" style={{ minWidth: "120px" }}>평균</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryReport.map((r, idx) => (
                    <tr key={idx}>
                      <td>{r.category}</td>
                      <td>{r.subCategory || "-"}</td>
                      <td className="number">{formatKRW(r.total)}</td>
                      <td className="number">{r.count}</td>
                      <td className="number">{formatKRW(r.average)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );

      case "stock":
        return (
          <div>
            <h3>주식 포트폴리오 성과 리포트</h3>
            <div style={{ overflowX: "auto", width: "100%" }}>
              <table className="data-table" style={{ width: "100%", minWidth: "900px" }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: "80px" }}>티커</th>
                    <th style={{ minWidth: "150px" }}>종목명</th>
                    <th className="number" style={{ minWidth: "130px" }}>총매입금액</th>
                    <th className="number" style={{ minWidth: "130px" }}>현재가치</th>
                    <th className="number" style={{ minWidth: "130px" }}>손익</th>
                    <th className="number" style={{ minWidth: "100px" }}>수익률</th>
                    <th className="number" style={{ minWidth: "100px" }}>보유수량</th>
                  </tr>
                </thead>
                <tbody>
                  {stockReport.map((r) => (
                    <tr key={r.ticker}>
                      <td>{r.ticker}</td>
                      <td>{r.name}</td>
                      <td className="number">{formatKRW(r.totalBuyAmount)}</td>
                      <td className="number">{formatKRW(r.currentValue)}</td>
                      <td className={`number ${r.pnl >= 0 ? "positive" : "negative"}`}>
                        {formatKRW(r.pnl)}
                      </td>
                      <td className={`number ${r.pnlRate >= 0 ? "positive" : "negative"}`}>
                        {r.pnlRate.toFixed(2)}%
                      </td>
                      <td className="number">{r.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );

      case "account":
        return (
          <div>
            <h3>계좌별 자산 리포트</h3>
            <div style={{ overflowX: "auto", width: "100%" }}>
              <table className="data-table" style={{ width: "100%", minWidth: "800px" }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: "120px" }}>계좌 ID</th>
                    <th style={{ minWidth: "150px" }}>계좌명</th>
                    <th className="number" style={{ minWidth: "130px" }}>초기 잔액</th>
                    <th className="number" style={{ minWidth: "130px" }}>현재 잔액</th>
                    <th className="number" style={{ minWidth: "130px" }}>변화액</th>
                    <th className="number" style={{ minWidth: "100px" }}>변화율</th>
                  </tr>
                </thead>
                <tbody>
                  {accountReport.map((r) => (
                    <tr key={r.accountId}>
                      <td>{r.accountId}</td>
                      <td>{r.accountName}</td>
                      <td className="number">{formatKRW(r.initialBalance)}</td>
                      <td className="number">{formatKRW(r.currentBalance)}</td>
                      <td className={`number ${r.change >= 0 ? "positive" : "negative"}`}>
                        {formatKRW(r.change)}
                      </td>
                      <td className={`number ${r.changeRate >= 0 ? "positive" : "negative"}`}>
                        {r.changeRate.toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );

      case "daily":
        return (
          <div>
            <h3>일별 리포트</h3>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span>시작일:</span>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                <span>종료일:</span>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </label>
            </div>
            
            {/* 일별 자산 변화 그래프 */}
            {dailyReport.length > 0 && (
              <div style={{ marginBottom: 32 }}>
                <h4 style={{ marginBottom: 16 }}>일별 자산 변화</h4>
                <div style={{ width: "100%", height: 400, minHeight: 400, minWidth: 0, display: "block" }}>
                  <ResponsiveContainer width="100%" height={400} minHeight={400} minWidth={0}>
                    <LineChart data={dailyReport} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                      <XAxis 
                        dataKey="date" 
                        fontSize={11} 
                        tickFormatter={(v) => {
                          const date = new Date(v);
                          return `${date.getMonth() + 1}/${date.getDate()}`;
                        }}
                        tickMargin={10}
                        axisLine={false}
                        tickLine={false}
                        angle={-45}
                        textAnchor="end"
                        height={80}
                      />
                      <YAxis 
                        fontSize={11} 
                        tickFormatter={(v) => {
                          if (Math.abs(v) >= 100000000) return `${(v / 100000000).toFixed(1)}억`;
                          if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(0)}만`;
                          return `${Math.round(v).toLocaleString()}`;
                        }} 
                        width={60}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip 
                        formatter={(value: any) => formatKRW(value)}
                        labelFormatter={(label) => {
                          const date = new Date(label);
                          return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                        }}
                        contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}
                      />
                      <Legend 
                        verticalAlign="top" 
                        height={36} 
                        iconType="line"
                        wrapperStyle={{ fontSize: "11px" }}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="totalAsset" 
                        name="전체 자산"
                        stroke="#6366f1" 
                        strokeWidth={2.5}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="netWorth" 
                        name="순자산"
                        stroke="#10b981" 
                        strokeWidth={2.5}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="stockValue" 
                        name="주식 평가액"
                        stroke="#0ea5e9" 
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        activeDot={{ r: 4 }}
                        strokeDasharray="5 5"
                        opacity={0.7}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="cashValue" 
                        name="현금"
                        stroke="#f59e0b" 
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        activeDot={{ r: 4 }}
                        strokeDasharray="5 5"
                        opacity={0.7}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
            
            <div style={{ 
              overflowX: "auto", 
              overflowY: "auto",
              maxHeight: "600px",
              width: "100%",
              border: "1px solid var(--border)",
              borderRadius: "8px"
            }}>
              <table className="data-table compact" style={{ 
                fontSize: 12,
                minWidth: "1200px",
                width: "100%",
                tableLayout: "auto"
              }}>
                <thead style={{ position: "sticky", top: 0, backgroundColor: "var(--surface)", zIndex: 10 }}>
                  <tr>
                    <th style={{ minWidth: "100px", width: "10%" }}>날짜</th>
                    <th className="number" style={{ minWidth: "110px", width: "10%" }}>수입</th>
                    <th className="number" style={{ minWidth: "110px", width: "10%" }}>지출</th>
                    <th className="number" style={{ minWidth: "110px", width: "10%" }}>저축</th>
                    <th className="number" style={{ minWidth: "110px", width: "10%" }}>이체</th>
                    <th className="number" style={{ minWidth: "130px", width: "12%" }}>주식 평가액</th>
                    <th className="number" style={{ minWidth: "130px", width: "12%" }}>현금</th>
                    <th className="number" style={{ minWidth: "130px", width: "12%" }}>저축</th>
                    <th className="number" style={{ minWidth: "140px", width: "12%" }}>전체 자산</th>
                    <th className="number" style={{ minWidth: "140px", width: "12%" }}>순자산</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyReport.map((r) => (
                    <tr key={r.date}>
                      <td style={{ whiteSpace: "nowrap" }}>{r.date}</td>
                      <td className="number positive" style={{ whiteSpace: "nowrap" }}>{formatKRW(r.income)}</td>
                      <td className="number negative" style={{ whiteSpace: "nowrap" }}>{formatKRW(r.expense)}</td>
                      <td className="number" style={{ whiteSpace: "nowrap" }}>{formatKRW(r.savingsExpense)}</td>
                      <td className="number" style={{ whiteSpace: "nowrap" }}>{formatKRW(r.transfer)}</td>
                      <td className="number" style={{ whiteSpace: "nowrap" }}>{formatKRW(r.stockValue)}</td>
                      <td className="number" style={{ whiteSpace: "nowrap" }}>{formatKRW(r.cashValue)}</td>
                      <td className="number" style={{ whiteSpace: "nowrap" }}>{formatKRW(r.savingsValue)}</td>
                      <td className="number" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{formatKRW(r.totalAsset)}</td>
                      <td className={`number ${r.netWorth >= 0 ? "positive" : "negative"}`} style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                        {formatKRW(r.netWorth)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );

      case "periodCompare": {
        const { thisMonthKey, lastMonthKey, thisMonth, lastMonth } = periodCompareData;
        const diff = (key: keyof typeof thisMonth) => thisMonth[key] - lastMonth[key];
        const rows: { label: string; thisVal: number; lastVal: number; diffVal: number }[] = [
          { label: "수입", thisVal: thisMonth.income, lastVal: lastMonth.income, diffVal: diff("income") },
          { label: "지출", thisVal: thisMonth.expense, lastVal: lastMonth.expense, diffVal: diff("expense") },
          { label: "저축성지출", thisVal: thisMonth.savings, lastVal: lastMonth.savings, diffVal: diff("savings") },
          { label: "이체", thisVal: thisMonth.transfer, lastVal: lastMonth.transfer, diffVal: diff("transfer") },
          { label: "순수입", thisVal: thisMonth.net, lastVal: lastMonth.net, diffVal: diff("net") }
        ];
        return (
          <div>
            <h3>이번 달 vs 지난달</h3>
            <p style={{ marginBottom: 16, color: "var(--text-secondary)" }}>
              {thisMonthKey} (이번 달) · {lastMonthKey} (지난달)
            </p>
            <div style={{ overflowX: "auto", width: "100%" }}>
              <table className="data-table" style={{ width: "100%", minWidth: "480px" }}>
                <thead>
                  <tr>
                    <th style={{ width: "120px" }}>항목</th>
                    <th className="number" style={{ minWidth: "120px" }}>{thisMonthKey}</th>
                    <th className="number" style={{ minWidth: "120px" }}>{lastMonthKey}</th>
                    <th className="number" style={{ minWidth: "120px" }}>차이</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.label}>
                      <td>{r.label}</td>
                      <td className={`number ${r.label === "순수입" ? (r.thisVal >= 0 ? "positive" : "negative") : r.label === "수입" ? "positive" : r.label === "지출" || r.label === "저축성지출" ? "negative" : ""}`}>
                        {formatKRW(r.thisVal)}
                      </td>
                      <td className={`number ${r.label === "순수입" ? (r.lastVal >= 0 ? "positive" : "negative") : r.label === "수입" ? "positive" : r.label === "지출" || r.label === "저축성지출" ? "negative" : ""}`}>
                        {formatKRW(r.lastVal)}
                      </td>
                      <td className={`number ${r.diffVal >= 0 ? "positive" : "negative"}`}>
                        {r.diffVal >= 0 ? "+" : ""}{formatKRW(r.diffVal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      }
    }
  };

  return (
    <div>
      <div className="section-header">
        <h2>리포트</h2>
        <button type="button" className="primary" onClick={handleExportCSV}>
          CSV 내보내기
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button
          type="button"
          className={reportType === "monthly" ? "primary" : ""}
          onClick={() => setReportType("monthly")}
        >
          월별 리포트
        </button>
        <button
          type="button"
          className={reportType === "yearly" ? "primary" : ""}
          onClick={() => setReportType("yearly")}
        >
          연도별 리포트
        </button>
        <button
          type="button"
          className={reportType === "category" ? "primary" : ""}
          onClick={() => setReportType("category")}
        >
          카테고리별 리포트
        </button>
        <button
          type="button"
          className={reportType === "stock" ? "primary" : ""}
          onClick={() => setReportType("stock")}
        >
          주식 성과 리포트
        </button>
        <button
          type="button"
          className={reportType === "account" ? "primary" : ""}
          onClick={() => setReportType("account")}
        >
          계좌 리포트
        </button>
        <button
          type="button"
          className={reportType === "daily" ? "primary" : ""}
          onClick={() => setReportType("daily")}
        >
          일별 리포트
        </button>
        <button
          type="button"
          className={reportType === "periodCompare" ? "primary" : ""}
          onClick={() => setReportType("periodCompare")}
        >
          기간 비교 (이번 달 vs 지난달)
        </button>
      </div>

      <div className="card">{renderReport()}</div>
    </div>
  );
};

