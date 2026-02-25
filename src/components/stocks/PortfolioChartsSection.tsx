import React from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Label
} from "recharts";
import type { AccountBalanceRow } from "../../types";
import { formatKRW } from "../../utils/formatter";

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
}

interface PortfolioChartsSectionProps {
  positionsWithPrice: PositionWithPrice[];
  positionsByAccount: Array<{
    accountId: string;
    accountName: string;
    rows: PositionWithPrice[];
  }>;
  balances: AccountBalanceRow[];
}

export const PortfolioChartsSection: React.FC<PortfolioChartsSectionProps> = ({
  positionsWithPrice,
  positionsByAccount,
  balances
}) => {
  return (
    <div className="card" style={{ padding: 16 }}>
      <h2 style={{ margin: "0 0 16px 0" }}>주식 포트폴리오 분석</h2>
      
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24 }}>
        {/* 1. 포트폴리오 비중 (평가금액 기준) */}
        <div className="card" style={{ border: "1px solid var(--border)", boxShadow: "none", padding: 16 }}>
          <h4 style={{ margin: "0 0 12px 0", textAlign: "center" }}>종목별 비중 (평가액)</h4>
          <div style={{ width: "100%", height: 300, minHeight: 300, minWidth: 0 }}>
            {positionsWithPrice.length > 0 ? (() => {
              const sorted = [...positionsWithPrice].sort((a, b) => b.marketValue - a.marketValue);
              const topN = 8; // 상위 8개만 표시
              const topPositions = sorted.slice(0, topN);
              const others = sorted.slice(topN);
              const othersValue = others.reduce((sum, p) => sum + p.marketValue, 0);
              
              const chartData = [
                ...topPositions.map(p => ({
                  name: (p.name || p.ticker).length > 15 ? (p.name || p.ticker).slice(0, 15) + "..." : (p.name || p.ticker),
                  value: p.marketValue,
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
                      formatter={(value: any, payload: any) => [
                        formatKRW(value),
                        payload?.payload?.fullName || payload?.name
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
                const stock = group.rows.reduce((sum, p) => sum + p.marketValue, 0);
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
                      value={`총 자산\n${formatKRW(totalAsset)}`}
                      position="center"
                      fill="var(--text)"
                      style={{ fontSize: "13px", fontWeight: "bold", textAlign: "center" }}
                    />
                    <Tooltip 
                      formatter={(value: any, payload: any) => [
                        formatKRW(value),
                        `${payload?.name}\n주식: ${formatKRW(payload?.stock || 0)}\n현금: ${formatKRW(payload?.cash || 0)}`
                      ]}
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
              const sorted = [...positionsWithPrice].sort((a, b) => b.pnl - a.pnl);
              const top10 = sorted.slice(0, 10);
              const bottom10 = sorted.slice(-10).reverse();
              const chartData = [...top10, ...bottom10].map(p => ({
                name: (p.name || p.ticker).length > 20 ? (p.name || p.ticker).slice(0, 20) + "..." : (p.name || p.ticker),
                pnl: p.pnl,
                fullName: p.name || p.ticker,
                fill: p.pnl >= 0 ? "#10b981" : "#f43f5e" // 녹색=수익, 빨강=손실
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
                      formatter={(value: any, payload: any) => [
                        formatKRW(value),
                        payload?.payload?.fullName || payload?.name
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
