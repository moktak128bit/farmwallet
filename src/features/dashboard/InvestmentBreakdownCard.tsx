import React from "react";
import { formatKRW } from "../../utils/formatter";

export interface MonthlyRecheckBreakdown {
  저축: number;
  투자: number;
  투자수익: number;
  투자손실: number;
}

interface Props {
  month: string;
  monthlyRecheckBreakdown: MonthlyRecheckBreakdown;
  totalRealizedPnl: number;
}

export const InvestmentBreakdownCard: React.FC<Props> = ({
  month,
  monthlyRecheckBreakdown,
  totalRealizedPnl,
}) => {
  return (
    <div className="card" style={{ marginTop: 0 }}>
      <div className="card-title">이번 달 재테크 세부 ({month})</div>
      <div
        className="dashboard-four-col"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
          marginTop: 12,
        }}
      >
        <div style={{ padding: "10px 12px", background: "var(--surface)", borderRadius: 8 }}>
          <div className="hint" style={{ fontSize: 14 }}>저축</div>
          <div className="card-value" style={{ fontSize: 22 }}>{formatKRW(Math.round(monthlyRecheckBreakdown.저축))}</div>
        </div>
        <div style={{ padding: "10px 12px", background: "var(--surface)", borderRadius: 8 }}>
          <div className="hint" style={{ fontSize: 14 }}>투자(매수 등)</div>
          <div className="card-value" style={{ fontSize: 22 }}>{formatKRW(Math.round(monthlyRecheckBreakdown.투자))}</div>
        </div>
        <div style={{ padding: "10px 12px", background: "var(--surface)", borderRadius: 8, borderLeft: "3px solid var(--chart-income)" }}>
          <div className="hint" style={{ fontSize: 14 }}>투자수익</div>
          <div className="card-value" style={{ fontSize: 22, color: "var(--chart-income)" }}>{formatKRW(Math.round(monthlyRecheckBreakdown.투자수익))}</div>
        </div>
        <div style={{ padding: "10px 12px", background: "var(--surface)", borderRadius: 8, borderLeft: "3px solid var(--chart-expense)" }}>
          <div className="hint" style={{ fontSize: 14 }}>투자손실</div>
          <div className="card-value" style={{ fontSize: 22, color: "var(--chart-expense)" }}>{formatKRW(Math.round(monthlyRecheckBreakdown.투자손실))}</div>
        </div>
      </div>
      <div className="hint" style={{ marginTop: 12, fontSize: 14 }}>
        누적 실현손익(매도 기준): {totalRealizedPnl >= 0 ? "+" : ""}{formatKRW(Math.round(totalRealizedPnl))}
      </div>
    </div>
  );
};
