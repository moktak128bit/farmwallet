import React, { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from "recharts";
import type { Account, LedgerEntry, StockTrade, StockPrice } from "../types";
import {
  generateMonthlyReport,
  generateYearlyReport,
  generateCategoryReport,
  generateStockPerformanceReport,
  generateAccountReport,
  generateMonthlyIncomeDetail,
  reportToCSV,
  type MonthlyReport,
  type CategoryReport,
  type StockPerformanceReport,
  type AccountReport,
  type MonthlyIncomeDetail
} from "../utils/reportGenerator";
import { formatKRW, formatUSD } from "../utils/format";
import { toast } from "react-hot-toast";

interface Props {
  accounts: Account[];
  ledger: LedgerEntry[];
  trades: StockTrade[];
  prices: StockPrice[];
}

type ReportType = "monthly" | "yearly" | "category" | "stock" | "account";

const COLORS = ["#0ea5e9", "#6366f1", "#f43f5e", "#10b981", "#f59e0b", "#8b5cf6"];

export const ReportView: React.FC<Props> = ({ accounts, ledger, trades, prices }) => {
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

  const handleExportCSV = () => {
    let csvContent = "";
    let filename = "";

    switch (reportType) {
      case "monthly":
        // 월별 리포트와 배당/이자 상세를 함께 내보내기
        const monthlyData = [...monthlyReport, ...monthlyIncomeDetail];
        csvContent = reportToCSV(monthlyData);
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
            <table className="data-table" style={{ marginTop: 24 }}>
              <thead>
                <tr>
                  <th>월</th>
                  <th>수입</th>
                  <th>지출</th>
                  <th>이체</th>
                  <th>순수입</th>
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
            
            {/* 배당/이자 수입 상세 테이블 */}
            {monthlyIncomeDetail.length > 0 && (
              <div style={{ marginTop: 32 }}>
                <h4 style={{ marginBottom: 16 }}>배당/이자 수입 상세 (월별)</h4>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>월</th>
                      <th>날짜</th>
                      <th>카테고리</th>
                      <th>세부 항목</th>
                      <th>설명</th>
                      <th>계좌</th>
                      <th>금액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyIncomeDetail.map((detail, idx) => (
                      <tr key={idx}>
                        <td>{detail.month}</td>
                        <td>{detail.date}</td>
                        <td>{detail.category || "-"}</td>
                        <td>{detail.subCategory || "-"}</td>
                        <td>{detail.description || "-"}</td>
                        <td>{detail.accountName || detail.accountId || "-"}</td>
                        <td className="number positive">{formatKRW(detail.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
            <table className="data-table" style={{ marginTop: 24 }}>
              <thead>
                <tr>
                  <th>연도</th>
                  <th>수입</th>
                  <th>지출</th>
                  <th>이체</th>
                  <th>순수입</th>
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
            <table className="data-table" style={{ marginTop: 24 }}>
              <thead>
                <tr>
                  <th>카테고리</th>
                  <th>세부 항목</th>
                  <th>총액</th>
                  <th>건수</th>
                  <th>평균</th>
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
        );

      case "stock":
        return (
          <div>
            <h3>주식 포트폴리오 성과 리포트</h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th>티커</th>
                  <th>종목명</th>
                  <th>총매입금액</th>
                  <th>현재가치</th>
                  <th>손익</th>
                  <th>수익률</th>
                  <th>보유수량</th>
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
        );

      case "account":
        return (
          <div>
            <h3>계좌별 자산 리포트</h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th>계좌 ID</th>
                  <th>계좌명</th>
                  <th>초기 잔액</th>
                  <th>현재 잔액</th>
                  <th>변화액</th>
                  <th>변화율</th>
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
        );
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
      </div>

      <div className="card">{renderReport()}</div>
    </div>
  );
};

