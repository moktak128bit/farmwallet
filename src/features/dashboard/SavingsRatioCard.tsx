import React from "react";
import { formatKRW } from "../../utils/formatter";

export interface InvestingRatio {
  stockPct: number;
  savingsPct: number;
}

export interface RecheckBreakdown {
  저축: number;
  투자: number;
  투자수익: number;
  투자손실: number;
}

interface Props {
  lastMonthLabel: string;
  lastMonthSavingsRate: number | null;
  lastMonthInvestingRatio: InvestingRatio;
  lastMonthRecheckBreakdown: RecheckBreakdown;
}

export const SavingsRatioCard: React.FC<Props> = ({
  lastMonthLabel,
  lastMonthSavingsRate,
  lastMonthInvestingRatio,
  lastMonthRecheckBreakdown,
}) => {
  return (
    <div className="card" style={{ minHeight: 200 }}>
      <div className="card-title">저축 대비 비교 (저번달)</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 8 }}>
        <div>
          <div className="hint" style={{ fontSize: 14, marginBottom: 6 }}>저번달 저축 ({lastMonthLabel})</div>
          <div
            className="card-value"
            style={{ fontSize: 26, color: lastMonthSavingsRate != null ? "var(--chart-primary)" : "var(--text-muted)" }}
          >
            {lastMonthSavingsRate != null ? `${lastMonthSavingsRate.toFixed(1)}%` : "-"}
          </div>
          <div className="hint" style={{ fontSize: 14, marginTop: 6 }}>수입 대비 저축비율</div>
        </div>
        <div>
          <div className="hint" style={{ fontSize: 14, marginBottom: 6 }}>지출 구성 (주식 대비 저축)</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text)" }}>
            주식 {lastMonthInvestingRatio.stockPct.toFixed(0)}% / 저축 {lastMonthInvestingRatio.savingsPct.toFixed(0)}%
          </div>
          <div className="hint" style={{ fontSize: 14, marginTop: 6 }}>
            {formatKRW(Math.round(lastMonthRecheckBreakdown.투자))} / {formatKRW(Math.round(lastMonthRecheckBreakdown.저축))}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 12, height: 8, display: "flex", borderRadius: 4, overflow: "hidden" }}>
        <div
          style={{
            width: `${lastMonthInvestingRatio.stockPct}%`,
            background: "var(--chart-primary)",
            minWidth: lastMonthInvestingRatio.stockPct > 0 ? 4 : 0,
          }}
        />
        <div
          style={{
            width: `${lastMonthInvestingRatio.savingsPct}%`,
            background: "var(--chart-positive)",
            minWidth: lastMonthInvestingRatio.savingsPct > 0 ? 4 : 0,
          }}
        />
      </div>
    </div>
  );
};
