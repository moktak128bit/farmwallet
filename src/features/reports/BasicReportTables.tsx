/**
 * 기본 표 보고서 모음 — 월별 수입/지출 · 연간 요약 · 카테고리별 지출 · 주식 성과 ·
 * 계좌 요약 · 일별 자산 스냅샷 (단순 표/차트 6종).
 * ReportPage에서 분리 — React.memo로 감싸 다른 보고서 상태 변경 시 재렌더를 건너뛴다.
 * 모든 데이터는 부모의 reportWorker 결과 — 여기서 재계산하지 않는다.
 * startDate/endDate는 워커 입력이라 부모 소유 — setter(setState)는 참조가 안정적이어야 memo가 효과를 가진다.
 */
import React from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { DeferredResponsiveContainer as ResponsiveContainer } from "../../components/charts/DeferredResponsiveContainer";
import type {
  AccountReport,
  CategoryReport,
  DailyReport,
  MonthlyReport,
  StockPerformanceReport
} from "../../utils/reportGenerator";
import { formatKRW } from "../../utils/formatter";
import {
  DateRangePicker,
  MonthRangePicker,
  toPercent,
  type ReportType
} from "./reportShared";

interface Props {
  reportType: Extract<ReportType, "monthly" | "yearly" | "category" | "stock" | "account" | "daily">;
  monthlyReport: MonthlyReport[];
  yearlyReport: MonthlyReport[];
  categoryReport: CategoryReport[];
  stockReport: StockPerformanceReport[];
  accountReport: AccountReport[];
  dailyReport: DailyReport[];
  startDate: string;
  endDate: string;
  setStartDate: React.Dispatch<React.SetStateAction<string>>;
  setEndDate: React.Dispatch<React.SetStateAction<string>>;
}

export const BasicReportTables: React.FC<Props> = React.memo(function BasicReportTables({
  reportType,
  monthlyReport,
  yearlyReport,
  categoryReport,
  stockReport,
  accountReport,
  dailyReport,
  startDate,
  endDate,
  setStartDate,
  setEndDate
}) {
  // ─── 월별 수입/지출 ───
  if (reportType === "monthly") {
    return (
      <div>
        <h3>월별 수입 / 지출</h3>
        <MonthRangePicker startDate={startDate} endDate={endDate} setStartDate={setStartDate} setEndDate={setEndDate} />
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={monthlyReport}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip formatter={(value: number | undefined) => formatKRW(value ?? 0)} />
            <Legend />
            <Bar isAnimationActive={false} dataKey="income" fill="#10b981" name="수입" />
            <Bar isAnimationActive={false} dataKey="expense" fill="#f43f5e" name="지출" />
            <Bar isAnimationActive={false} dataKey="net" fill="#6366f1" name="순수입" />
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
        <DateRangePicker startDate={startDate} endDate={endDate} setStartDate={setStartDate} setEndDate={setEndDate} />
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
  return (
    <div>
      <h3>일별 자산 스냅샷</h3>
      <DateRangePicker startDate={startDate} endDate={endDate} setStartDate={setStartDate} setEndDate={setEndDate} />
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={dailyReport}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis />
          <Tooltip formatter={(value: number | undefined) => formatKRW(value ?? 0)} />
          <Legend />
          <Line isAnimationActive={false} type="monotone" dataKey="totalAsset" name="총 자산" stroke="#6366f1" />
          <Line isAnimationActive={false} type="monotone" dataKey="netWorth" name="순자산" stroke="#10b981" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
});
