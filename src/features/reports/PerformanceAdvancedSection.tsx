/**
 * 성과 분석 (고급) — 계좌별 성과 기여(IRR/TTWR/실현/미실현/배당) 표·차트 +
 * 월별 소비가 투자여력에 미치는 영향.
 * ReportPage에서 분리 — React.memo로 감싸 다른 보고서 상태 변경 시 재렌더를 건너뛴다.
 * accountPerformance/consumptionImpact는 부모의 reportWorker 결과 — 여기서 재계산하지 않는다.
 * startDate/endDate는 워커 입력이라 부모 소유 — setter(setState)는 참조가 안정적이어야 memo가 효과를 가진다.
 */
import React from "react";
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from "recharts";
import { DeferredResponsiveContainer as ResponsiveContainer } from "../../components/charts/DeferredResponsiveContainer";
import type { AccountPerformanceBreakdownRow, ConsumptionImpactMonthlyRow } from "../../utils/reportGenerator";
import { formatKRW } from "../../utils/formatter";
import { DateRangePicker, toPercent } from "./reportShared";

interface Props {
  accountPerformance: AccountPerformanceBreakdownRow[];
  consumptionImpact: ConsumptionImpactMonthlyRow[];
  startDate: string;
  endDate: string;
  setStartDate: React.Dispatch<React.SetStateAction<string>>;
  setEndDate: React.Dispatch<React.SetStateAction<string>>;
}

export const PerformanceAdvancedSection: React.FC<Props> = React.memo(function PerformanceAdvancedSection({
  accountPerformance,
  consumptionImpact,
  startDate,
  endDate,
  setStartDate,
  setEndDate
}) {
  return (
    <div>
      <h3>성과 분석 (고급)</h3>
      <DateRangePicker startDate={startDate} endDate={endDate} setStartDate={setStartDate} setEndDate={setEndDate} />

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
                {/* IRR/TTWR 계산 불가(null)는 손실이 아님 — 중립색 "-" */}
                <td className={`number ${row.irr == null ? "" : row.irr >= 0 ? "positive" : "negative"}`}>{toPercent(row.irr)}</td>
                <td className={`number ${row.ttwr == null ? "" : row.ttwr >= 0 ? "positive" : "negative"}`}>{toPercent(row.ttwr)}</td>
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
          <Bar isAnimationActive={false} dataKey="realizedPnl" stackId="p" fill="#0ea5e9" name="실현손익" />
          <Bar isAnimationActive={false} dataKey="unrealizedPnl" stackId="p" fill="#8b5cf6" name="미실현손익" />
          <Bar isAnimationActive={false} dataKey="dividendContribution" stackId="p" fill="#10b981" name="배당" />
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
          <Bar isAnimationActive={false} dataKey="consumptionExpense" fill="#f43f5e" name="소비 지출" />
          <Bar isAnimationActive={false} dataKey="investmentCapacity" fill="#6366f1" name="투자 여력" />
          <Bar isAnimationActive={false} dataKey="actualInvested" fill="#10b981" name="실제 투자" />
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
});
