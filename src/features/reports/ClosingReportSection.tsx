/**
 * 주간/월간 정산 보고서 — 이번 달 정산 완료율 + 전월 대비 자동 코멘트 + 월간/주간 스냅샷 표·차트.
 * ReportPage에서 분리 — React.memo로 감싸 다른 보고서 상태 변경 시 재렌더를 건너뛴다.
 * closingReport는 부모의 reportWorker 결과 — 여기서 재계산하지 않는다.
 */
import React from "react";
import { CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { DeferredResponsiveContainer as ResponsiveContainer } from "../../components/charts/DeferredResponsiveContainer";
import type { ClosingReportData } from "../../utils/reportGenerator";
import { formatKRW } from "../../utils/formatter";
import { signedKRW } from "./reportShared";

interface Props {
  closingReport: ClosingReportData;
}

export const ClosingReportSection: React.FC<Props> = React.memo(function ClosingReportSection({ closingReport }) {
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
          <Line isAnimationActive={false} type="monotone" dataKey="asset" name="자산" stroke="#3b82f6" />
          <Line isAnimationActive={false} type="monotone" dataKey="debt" name="부채" stroke="#f97316" />
          <Line isAnimationActive={false} type="monotone" dataKey="netWorth" name="순자산" stroke="#10b981" />
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
});
