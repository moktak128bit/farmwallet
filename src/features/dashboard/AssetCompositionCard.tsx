import React, { Suspense, lazy } from "react";
import { formatKRW } from "../../utils/formatter";
import type { TreemapItem } from "./DashboardInlineCharts";

const LazyAssetTreemap = lazy(() =>
  import("./DashboardInlineCharts").then((m) => ({ default: m.AssetTreemap }))
);

interface Props {
  portfolioTreemapData: TreemapItem[];
  portfolioByType: { cashTotal: number; savingsTotal: number; stockTotal: number };
  totalNetWorth: number;
  totalDebt: number;
}

export const AssetCompositionCard: React.FC<Props> = ({
  portfolioTreemapData,
  portfolioByType,
  totalNetWorth,
  totalDebt,
}) => {
  return (
    <div className="card" style={{ marginTop: 16, padding: 20 }}>
      <div className="card-title" style={{ fontSize: 20 }}>자산 구성 (종류별)</div>
      <div style={{ width: "100%", height: 300, marginTop: 12 }}>
        <Suspense fallback={<div style={{ height: 300 }} />}>
          <LazyAssetTreemap portfolioTreemapData={portfolioTreemapData} portfolioByType={portfolioByType} />
        </Suspense>
      </div>
      <div className="hint" style={{ marginTop: 12, textAlign: "center", fontSize: 15 }}>
        순자산 {formatKRW(Math.round(totalNetWorth))}
        {totalDebt < 0 && (
          <span style={{ marginLeft: 8, color: "var(--chart-expense)" }}>
            (부채 {formatKRW(Math.round(Math.abs(totalDebt)))})
          </span>
        )}
      </div>
    </div>
  );
};
