import React from "react";
import { Cell, Legend, Pie, PieChart, Tooltip } from "recharts";
import { DeferredResponsiveContainer as ResponsiveContainer } from "../../components/charts/DeferredResponsiveContainer";
import type { AccountBalanceRow } from "../../types";
import { formatKRW, formatUSD } from "../../utils/formatter";
import { isUSDStock } from "../../utils/finance";

type PositionWithPrice = {
  accountId: string;
  accountName: string;
  ticker: string;
  name: string;
  marketValue: number;
  currency?: string;
};

export function PortfolioDashboardCharts(props: {
  positionsWithPrice: PositionWithPrice[];
  positionsByAccount: Array<{ accountId: string; accountName: string; rows: PositionWithPrice[] }>;
  balances: AccountBalanceRow[];
  fxRate?: number | null;
}) {
  const { positionsWithPrice, positionsByAccount, balances, fxRate = null } = props;
  const rate = fxRate ?? 0;
  const toKRW = (p: PositionWithPrice, val: number) =>
    (p.currency === "USD" || isUSDStock(p.ticker)) && rate ? val * rate : val;
  const formatWithUSD = (krw: number) => {
    if (!rate || rate <= 0) return formatKRW(krw);
    return `${formatKRW(krw)} (≈ ${formatUSD(krw / rate)})`;
  };

  const pieTooltipLabel = (item: { payload?: { fullName?: string; name?: string } } | undefined) =>
    item?.payload?.fullName ?? item?.payload?.name ?? "";

  const colors = ["#0ea5e9", "#6366f1", "#f43f5e", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#64748b"];

  const positionWeightData = (() => {
    if (positionsWithPrice.length === 0) return [];
    const withKRW = positionsWithPrice.map((p) => ({
      ...p,
      marketValueKRW: toKRW(p, p.marketValue)
    }));
    const sorted = [...withKRW].sort((a, b) => b.marketValueKRW - a.marketValueKRW);
    const topN = 8;
    const top = sorted.slice(0, topN);
    const others = sorted.slice(topN);
    const othersValue = others.reduce((sum, p) => sum + p.marketValueKRW, 0);
    return [
      ...top.map((p) => ({
        name: (p.name || p.ticker).length > 15 ? (p.name || p.ticker).slice(0, 15) + "..." : (p.name || p.ticker),
        value: p.marketValueKRW,
        fullName: p.name || p.ticker
      })),
      ...(othersValue > 0
        ? [
            {
              name: `기타 (${others.length}개)`,
              value: othersValue,
              fullName: `기타 ${others.length}개 종목`
            }
          ]
        : [])
    ];
  })();

  const accountAssetData = (() => {
    const stockByAccountId = new Map<string, number>();
    for (const group of positionsByAccount) {
      const stock = group.rows.reduce((sum, p) => sum + toKRW(p, p.marketValue), 0);
      stockByAccountId.set(group.accountId, stock);
    }

    return balances
      .map((b) => {
        const savings = b.account.savings ?? 0;
        // currentBalance는 계좌의 현재 현금성 잔액(계좌 타입에 따라 초기현금/조정/이체/거래 등 반영)
        // 적금(savings)은 별도로 더해 총 자산(주식+현금+적금)으로 계산
        const cash = b.currentBalance;
        const stock = stockByAccountId.get(b.account.id) ?? 0;
        const total = Math.max(0, cash + savings + stock);
        return {
          name: b.account.name ?? b.account.id,
          value: total,
          cash,
          savings,
          stock
        };
      })
      .filter((d) => d.value > 0);
  })();

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
      <div className="card" style={{ minHeight: 360 }}>
        <div className="card-title" style={{ marginBottom: 12 }}>종목별 비중 (평가액)</div>
        <div style={{ width: "100%", height: 300, minHeight: 300, minWidth: 0 }}>
          {positionWeightData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%" minHeight={300} minWidth={0}>
              <PieChart>
                <Pie
                  data={positionWeightData}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                  label={({ percent }) => (percent ? `${(percent * 100).toFixed(1)}%` : "0%")}
                  labelLine={false}
                >
                  {positionWeightData.map((_, index) => (
                    <Cell key={`pos-${index}`} fill={colors[index % colors.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: any, name: any, item: any) => [
                    formatWithUSD(Number(value ?? 0)),
                    pieTooltipLabel(item) || name
                  ]}
                />
                <Legend
                  formatter={(value: any, entry: any) => entry.payload?.fullName || value}
                  wrapperStyle={{ fontSize: "11px" }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="hint" style={{ textAlign: "center", paddingTop: 60 }}>보유 종목이 없습니다.</p>
          )}
        </div>
      </div>

      <div className="card" style={{ minHeight: 360 }}>
        <div className="card-title" style={{ marginBottom: 12 }}>계좌별 자산 비중 (주식+현금+적금)</div>
        <div style={{ width: "100%", height: 300, minHeight: 300, minWidth: 0 }}>
          {accountAssetData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%" minHeight={300} minWidth={0}>
              <PieChart>
                <Pie
                  data={accountAssetData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                  label={({ percent }) => (percent ? `${(percent * 100).toFixed(1)}%` : "0%")}
                  labelLine={false}
                >
                  {accountAssetData.map((_, index) => (
                    <Cell key={`acc-${index}`} fill={colors[index % colors.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: any, name: any, item: any) => {
                    const p = item?.payload as any;
                    const label = p?.name ?? name;
                    const cash = Number(p?.cash ?? 0);
                    const savings = Number(p?.savings ?? 0);
                    const stock = Number(p?.stock ?? 0);
                    return [
                      `${formatWithUSD(Number(value ?? 0))} (현금 ${formatWithUSD(Math.round(cash))} / 적금 ${formatWithUSD(Math.round(savings))} / 주식 ${formatWithUSD(Math.round(stock))})`,
                      label
                    ];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="hint" style={{ textAlign: "center", paddingTop: 60 }}>자산 데이터가 없습니다.</p>
          )}
        </div>
      </div>
    </div>
  );
}

