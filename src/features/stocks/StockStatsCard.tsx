import React from "react";
import { formatKRW } from "../../utils/formatter";

interface StockStatsCardProps {
  totalMarketValue: number;
  dayPnl: number;
  totalPnl: number;
  totalCost: number;
  totalReturnRate: number;
  totalDividend?: number;
}

export const StockStatsCard: React.FC<StockStatsCardProps> = ({
  totalMarketValue,
  dayPnl,
  totalPnl,
  totalCost,
  totalReturnRate,
  totalDividend = 0
}) => {
  const valueColor = (value: number) => (value >= 0 ? "#dc2626" : "#2563eb");

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <div
          style={{
            background: "#f8fafc",
            color: "#0f172a",
            padding: 12,
            borderRadius: 12,
            border: "1px solid #e2e8f0"
          }}
        >
          <div style={{ color: "#475569", fontSize: 14, fontWeight: 600, marginBottom: 4 }}>원금</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#0f172a" }}>{formatKRW(totalCost)}</div>
        </div>

        <div
          style={{
            background: "#f8fafc",
            color: "#0f172a",
            padding: 12,
            borderRadius: 12,
            border: "1px solid #e2e8f0"
          }}
        >
          <div style={{ color: "#475569", fontSize: 14, fontWeight: 600, marginBottom: 4 }}>평가금</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: valueColor(totalMarketValue) }}>{formatKRW(totalMarketValue)}</div>
        </div>

        <div
          style={{
            background: "#f8fafc",
            color: "#0f172a",
            padding: 12,
            borderRadius: 12,
            border: "1px solid #e2e8f0"
          }}
        >
          <div style={{ color: "#475569", fontSize: 14, fontWeight: 600, marginBottom: 4 }}>배당금</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#10b981" }}>{formatKRW(totalDividend)}</div>
        </div>

        <div style={{ background: "#f8fafc", color: "#0f172a", padding: 12, borderRadius: 12, border: "1px solid #e2e8f0" }}>
          <div style={{ color: "#64748b", fontSize: 14, fontWeight: 600, marginBottom: 4 }}>수익</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: valueColor(totalPnl) }}>
            {formatKRW(totalPnl)} ({(totalReturnRate * 100).toFixed(2)}%)
          </div>
          <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>
            일일손익 {formatKRW(dayPnl)} ({totalMarketValue ? ((dayPnl / totalMarketValue) * 100).toFixed(2) : "0.00"}%)
          </div>
        </div>
      </div>
    </div>
  );
};
