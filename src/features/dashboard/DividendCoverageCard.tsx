import React from "react";
import { formatKRW } from "../../utils/formatter";

export interface DividendCoverage {
  coverageRate: number | null;
  monthlyDividendAvg: number;
  monthlyFixedExpenseAvg: number;
}

interface Props {
  dividendCoverage: DividendCoverage;
}

export const DividendCoverageCard: React.FC<Props> = ({ dividendCoverage }) => {
  const isCovered =
    dividendCoverage.coverageRate != null && dividendCoverage.coverageRate >= 100;
  const widthPct =
    dividendCoverage.monthlyFixedExpenseAvg > 0
      ? Math.min(
          100,
          (dividendCoverage.monthlyDividendAvg / dividendCoverage.monthlyFixedExpenseAvg) * 100
        )
      : 0;

  return (
    <div className="card" style={{ minHeight: 180 }}>
      <div className="card-title">해당 금액 상세 (최근 3개월 기준)</div>
      <div
        className="card-value"
        style={{
          fontSize: 26,
          color: isCovered ? "var(--primary)" : "var(--danger)",
        }}
      >
        {dividendCoverage.coverageRate == null ? "-" : `${dividendCoverage.coverageRate.toFixed(1)}%`}
      </div>
      <div className="hint" style={{ marginTop: 6, fontSize: 14 }}>
        배당 {formatKRW(Math.round(dividendCoverage.monthlyDividendAvg))}
        {" / 예정"}
        {formatKRW(Math.round(dividendCoverage.monthlyFixedExpenseAvg))}
      </div>
      <div
        style={{
          marginTop: 16,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div
          style={{
            flex: 1,
            position: "relative",
            height: 28,
            minWidth: 60,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "var(--chart-expense)",
              opacity: 0.3,
              borderRadius: 6,
            }}
            aria-hidden
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              top: "50%",
              transform: "translateY(-50%)",
              height: 10,
              width: `${widthPct}%`,
              minWidth: dividendCoverage.monthlyDividendAvg > 0 ? 4 : 0,
              background: "var(--chart-income)",
              borderRadius: 4,
            }}
          />
        </div>
        <span
          style={{
            flexShrink: 0,
            fontSize: 15,
            fontWeight: 700,
            color: isCovered ? "var(--primary)" : "var(--text)",
          }}
        >
          커버리지 {dividendCoverage.coverageRate == null ? "-" : `${dividendCoverage.coverageRate.toFixed(1)}%`}
        </span>
      </div>
    </div>
  );
};
