/**
 * 자산 구성 (종류별) 카드 — DashboardPage에서 분리.
 * 종류별 합계(portfolioByType)·트리맵 데이터(portfolioTreemapData)를 카드가 소유한다.
 * 무거운 공유 파생값(balances/positions)은 부모에서 계산해 props로 받는다 — 재계산 금지.
 * React.memo로 감싸므로 부모가 넘기는 props는 안정적(부모 useMemo 결과)이어야 한다.
 */
import React, { Suspense, lazy, useMemo } from "react";
import type { AccountBalanceRow, PositionRow } from "../../types";
import { positionMarketValueKRW } from "../../calculations";
import { formatKRW } from "../../utils/formatter";
import type { TreemapItem } from "./DashboardInlineCharts";

const LazyAssetTreemap = lazy(() =>
  import("./DashboardInlineCharts").then((m) => ({ default: m.AssetTreemap }))
);

interface Props {
  balances: AccountBalanceRow[];
  positions: PositionRow[];
  fxRate: number | null;
  totalNetWorth: number;
  totalDebt: number;
}

export const AssetCompositionCard: React.FC<Props> = React.memo(function AssetCompositionCard({
  balances,
  positions,
  fxRate,
  totalNetWorth,
  totalDebt,
}) {
  const portfolioByType = useMemo(() => {
    let cashTotal = 0;
    let savingsTotal = 0;
    let stockTotal = 0;

    balances.forEach((row) => {
      const { account } = row;
      if (account.type === "checking" || account.type === "other") {
        if (row.currentBalance > 0) cashTotal += row.currentBalance;
      } else if (account.type === "securities" || account.type === "crypto") {
        const krw = row.currentBalance;
        const usd = (account.usdBalance ?? 0) + (row.usdTransferNet ?? 0);
        const usdKrw = fxRate && usd ? usd * fxRate : 0;
        if (krw + usdKrw > 0) cashTotal += krw + usdKrw;
      } else if (account.type === "savings") {
        if (row.currentBalance > 0) savingsTotal += row.currentBalance;
      }
    });
    positions.forEach((p) => {
      const mvKrw = positionMarketValueKRW(p, fxRate);
      if (mvKrw > 0) stockTotal += mvKrw;
    });

    return { cashTotal, savingsTotal, stockTotal };
  }, [balances, positions, fxRate]);

  const portfolioTreemapData = useMemo<TreemapItem[]>(() => {
    const { cashTotal, savingsTotal, stockTotal } = portfolioByType;
    const total = cashTotal + savingsTotal + stockTotal;
    if (total <= 0) return [];
    const children: { name: string; value: number; fill: string; percent: number }[] = [];
    if (cashTotal > 0) {
      children.push({ name: "현금", value: cashTotal, fill: "#2563eb", percent: (cashTotal / total) * 100 });
    }
    if (stockTotal > 0) {
      children.push({ name: "주식", value: stockTotal, fill: "#7c3aed", percent: (stockTotal / total) * 100 });
    }
    if (savingsTotal > 0) {
      children.push({ name: "저축", value: savingsTotal, fill: "#059669", percent: (savingsTotal / total) * 100 });
    }
    if (children.length === 0) return [];
    return [{ name: "자산", children }];
  }, [portfolioByType]);

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
});
