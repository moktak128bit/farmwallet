import React from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Label
} from "recharts";
import { DeferredResponsiveContainer as ResponsiveContainer } from "../../components/charts/DeferredResponsiveContainer";
import type { AccountBalanceRow } from "../../types";
import { formatKRW, formatUSD } from "../../utils/formatter";
import { isUSDStock } from "../../utils/finance";

interface PositionWithPrice {
  accountId: string;
  accountName: string;
  ticker: string;
  name: string;
  quantity: number;
  avgPrice: number;
  totalBuyAmount: number;
  displayMarketPrice: number;
  marketValue: number;
  pnl: number;
  pnlRate: number;
  currency?: string;
  sector?: string;
  industry?: string;
}

interface PortfolioChartsSectionProps {
  positionsWithPrice: PositionWithPrice[];
  positionsByAccount: Array<{
    accountId: string;
    accountName: string;
    rows: PositionWithPrice[];
  }>;
  balances: AccountBalanceRow[];
  fxRate?: number | null;
}

const toKRW = (p: PositionWithPrice, val: number, rate: number) =>
  (p.currency === "USD" || isUSDStock(p.ticker)) && rate ? val * rate : val;

const formatWithUSD = (krw: number, rate: number | null) => {
  if (!rate || rate <= 0) return formatKRW(krw);
  return `${formatKRW(krw)} (≈ ${formatUSD(krw / rate)})`;
};

/** Recharts Tooltip formatter: (value, name, item) — 라벨은 item.payload에서 읽음 */
const pieTooltipLabel = (item: { payload?: { fullName?: string; name?: string } } | undefined) =>
  item?.payload?.fullName ?? item?.payload?.name ?? "";

export const PortfolioChartsSection: React.FC<PortfolioChartsSectionProps> = ({
  positionsWithPrice,
  positionsByAccount,
  balances,
  fxRate = null
}) => {
  const rate = fxRate ?? 0;
  return (
    <div className="card" style={{ padding: 16 }}>
      <h2 style={{ margin: "0 0 16px 0" }}>주식 포트폴리오 분석</h2>
      
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24 }}>
        {/* 1. 섹터별 비중 (평가금액 기준) */}
        <div className="card" style={{ border: "1px solid var(--border)", boxShadow: "none", padding: 16 }}>
          <h4 style={{ margin: "0 0 12px 0", textAlign: "center" }}>섹터별 비중 (평가액)</h4>
          <div style={{ width: "100%", height: 300, minHeight: 300, minWidth: 0 }}>
            {positionsWithPrice.length > 0 ? (() => {
              const withKRW = positionsWithPrice.map(p => ({
                ...p,
                marketValueKRW: toKRW(p, p.marketValue, rate)
              }));
              const sectorMap = new Map<string, number>();
              for (const p of withKRW) {
                const sector = p.sector?.trim() || "미분류";
                sectorMap.set(sector, (sectorMap.get(sector) ?? 0) + p.marketValueKRW);
              }
              const sectorData = [...sectorMap.entries()]
                .filter(([, v]) => v > 0)
                .sort((a, b) => b[1] - a[1])
                .map(([name, value]) => ({ name, value, fullName: name }));
              const colors = ["#0ea5e9", "#6366f1", "#f43f5e", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#64748b"];
              return (
                <ResponsiveContainer width="100%" height="100%" minHeight={300} minWidth={0}>
                  <PieChart>
                    <Pie
                      data={sectorData}
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                      label={({ percent }) => percent ? `${(percent * 100).toFixed(1)}%` : "0%"}
                      labelLine={false}
                    >
                      {sectorData.map((entry, index) => (
                        <Cell key={`sector-${index}`} fill={colors[index % colors.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: any, name: any, item: any) => [
                        formatWithUSD(value, rate || null),
                        pieTooltipLabel(item) || name || "평가액"
                      ]}
                    />
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                  </PieChart>
                </ResponsiveContainer>
              );
            })() : (
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%", color: "var(--muted)" }}>
                보유 종목이 없습니다.
              </div>
            )}
          </div>
        </div>

        {/* 2. 포트폴리오 비중 (평가금액 기준) */}
        <div className="card" style={{ border: "1px solid var(--border)", boxShadow: "none", padding: 16 }}>
          <h4 style={{ margin: "0 0 12px 0", textAlign: "center" }}>종목별 비중 (평가액)</h4>
          <div style={{ width: "100%", height: 300, minHeight: 300, minWidth: 0 }}>
            {positionsWithPrice.length > 0 ? (() => {
              const withKRW = positionsWithPrice.map(p => ({
                ...p,
                marketValueKRW: toKRW(p, p.marketValue, rate)
              }));
              const sorted = [...withKRW].sort((a, b) => b.marketValueKRW - a.marketValueKRW);
              const topN = 8;
              const topPositions = sorted.slice(0, topN);
              const others = sorted.slice(topN);
              const othersValue = others.reduce((sum, p) => sum + p.marketValueKRW, 0);
              
              const chartData = [
                ...topPositions.map(p => ({
                  name: (p.name || p.ticker).length > 15 ? (p.name || p.ticker).slice(0, 15) + "..." : (p.name || p.ticker),
                  value: p.marketValueKRW,
                  fullName: p.name || p.ticker
                })),
                ...(othersValue > 0 ? [{
                  name: `기타 (${others.length}개)`,
                  value: othersValue,
                  fullName: `기타 ${others.length}개 종목`
                }] : [])
              ];
              
              const colors = ["#0ea5e9", "#6366f1", "#f43f5e", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#64748b"];
              
              return (
                <ResponsiveContainer width="100%" height="100%" minHeight={300} minWidth={0}>
                  <PieChart>
                    <Pie
                      data={chartData}
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                      label={({ percent }) => percent ? `${(percent * 100).toFixed(1)}%` : "0%"}
                      labelLine={false}
                    >
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                      ))}
                    </Pie>
                    <Tooltip 
                      formatter={(value: any, name: any, item: any) => [
                        formatWithUSD(value, rate || null),
                        pieTooltipLabel(item) || name
                      ]}
                    />
                    <Legend 
                      formatter={(value: any, entry: any) => entry.payload?.fullName || value}
                      wrapperStyle={{ fontSize: "11px" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              );
            })() : (
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%", color: "var(--muted)" }}>
                보유 종목이 없습니다.
              </div>
            )}
          </div>
        </div>

        {/* 2. 계좌별 자산 비중 */}
        <div className="card" style={{ border: "1px solid var(--border)", boxShadow: "none", padding: 16 }}>
          <h4 style={{ margin: "0 0 12px 0", textAlign: "center" }}>계좌별 자산 비중 (주식+현금)</h4>
          <div style={{ width: "100%", height: 300, minHeight: 300, minWidth: 0 }}>
            {(() => {
              const accountData = positionsByAccount.map(group => {
                const balance = balances.find(b => b.account.id === group.accountId);
                const cash = balance?.currentBalance ?? 0;
                const stock = group.rows.reduce(
                  (sum, p) => sum + toKRW(p, p.marketValue, rate),
                  0
                );
                return {
                  name: group.accountName,
                  value: Math.max(0, cash + stock),
                  cash,
                  stock
                };
              }).filter(d => d.value > 0);
              
              const totalAsset = accountData.reduce((sum, d) => sum + d.value, 0);
              const colors = ["#f59e0b", "#10b981", "#0ea5e9", "#6366f1", "#f43f5e"];
              
              return (
                <ResponsiveContainer width="100%" height="100%" minHeight={300} minWidth={0}>
                  <PieChart>
                    <Pie
                      data={accountData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                      label={({ percent }) => percent ? `${(percent * 100).toFixed(1)}%` : "0%"}
                      labelLine={false}
                    >
                      {accountData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                      ))}
                    </Pie>
                    <Label
                      value={`총 자산\n${formatKRW(totalAsset)}${rate ? `\n≈ ${formatUSD(totalAsset / rate)}` : ""}`}
                      position="center"
                      fill="var(--text)"
                      style={{ fontSize: "13px", fontWeight: "bold", textAlign: "center" }}
                    />
                    <Tooltip 
                      formatter={(value: any, name: any, item: any) => {
                        const p = item?.payload;
                        return [
                          formatWithUSD(value, rate || null),
                          `${p?.name ?? name}\n주식: ${formatWithUSD(p?.stock || 0, rate || null)}\n현금: ${formatKRW(p?.cash || 0)}`
                        ];
                      }}
                    />
                    <Legend 
                      wrapperStyle={{ fontSize: "11px" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              );
            })()}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
         {/* 3. 종목별 평가손익 (수평 Bar Chart) */}
         <div className="card" style={{ border: "1px solid var(--border)", boxShadow: "none", padding: 16 }}>
          <h4 style={{ margin: "0 0 12px 0", textAlign: "center" }}>종목별 평가 손익 (상위/하위 10개)</h4>
          <div style={{ width: "100%", height: Math.max(400, positionsWithPrice.length * 30), minHeight: 400, minWidth: 0 }}>
            {positionsWithPrice.length > 0 ? (() => {
              const withPnlKRW = positionsWithPrice.map(p => ({
                ...p,
                pnlKRW: toKRW(p, p.pnl, rate)
              }));
              const sorted = [...withPnlKRW].sort((a, b) => b.pnlKRW - a.pnlKRW);
              const top10 = sorted.slice(0, 10);
              const bottom10 = sorted.slice(-10).reverse();
              const chartData = [...top10, ...bottom10].map(p => ({
                name: (p.name || p.ticker).length > 20 ? (p.name || p.ticker).slice(0, 20) + "..." : (p.name || p.ticker),
                pnl: p.pnlKRW,
                fullName: p.name || p.ticker,
                fill: p.pnlKRW >= 0 ? "#10b981" : "#f43f5e"
              }));
              
              return (
                <ResponsiveContainer width="100%" height="100%" minHeight={400} minWidth={0}>
                  <BarChart
                    data={chartData}
                    layout="vertical"
                    margin={{ top: 5, right: 30, left: 100, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis 
                      type="number"
                      tickFormatter={(val) => `${(val / 10000).toFixed(0)}만`} 
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis 
                      type="category"
                      dataKey="name" 
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      width={95}
                    />
                    <Tooltip 
                      formatter={(value: any, name: any, item: any) => [
                        formatWithUSD(value, rate || null),
                        pieTooltipLabel(item) || name
                      ]}
                      cursor={{fill: 'rgba(0,0,0,0.05)'}}
                    />
                    <Bar dataKey="pnl" name="평가손익" radius={[0, 4, 4, 0]}>
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              );
            })() : (
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%", color: "var(--muted)" }}>
                데이터 없음
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
