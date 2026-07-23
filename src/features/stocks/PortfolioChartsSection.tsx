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
import type { Payload, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import type { LegendPayload } from "recharts/types/component/DefaultLegendContent";
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
  /** USD 종목의 매입 당시 환율 기준 KRW 원가 (computePositions) — 평가손익 KRW 산출용 */
  totalBuyAmountKRW?: number;
  /** 시세 수신 여부 — false면 marketValue가 매입가 중립값 */
  hasQuote?: boolean;
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
        {/* 1. 종목별 비중 (평가금액 기준) */}
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
                      isAnimationActive={false}
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
                      formatter={(value: ValueType | undefined, name: NameType | undefined, item: Payload<ValueType, NameType>) => [
                        formatWithUSD(Number(value ?? 0), rate || null),
                        pieTooltipLabel(item) || name
                      ]}
                    />
                    <Legend
                      formatter={(value: string, entry: LegendPayload) => {
                        const inner = entry.payload as { fullName?: string } | undefined;
                        return inner?.fullName || value;
                      }}
                      wrapperStyle={{ fontSize: "11px" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              );
            })() : (
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%", color: "var(--text-muted)" }}>
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
              // 증권·코인 계좌의 USD 현금 포함 + 포지션 없는(전량 매도·현금만) 투자계좌도 포함 —
              // 누락 시 총자산 추이 카드와 계좌 수치가 어긋난다. (현재 시점 비중이므로 usdBalance 그대로)
              const cashOf = (balance: (typeof balances)[number] | undefined): number => {
                if (!balance) return 0;
                const usdCash =
                  balance.account.type === "securities" || balance.account.type === "crypto"
                    ? (balance.account.usdBalance ?? 0) + (balance.usdTransferNet ?? 0)
                    : 0;
                return (balance.currentBalance ?? 0) + (usdCash && rate > 0 ? usdCash * rate : 0);
              };
              const withPositions = positionsByAccount.map(group => {
                const balance = balances.find(b => b.account.id === group.accountId);
                const cash = cashOf(balance);
                const stock = group.rows.reduce(
                  (sum, p) =>
                    sum +
                    // 시세 없음 USD 행은 취득환율 원가(totalBuyAmountKRW) — 중립값(달러 액면)을
                    // 현재환율로 환산하면 환차만큼 가짜 손익이 섞인다 (보유현황 헤더·총자산 추이와 동일)
                    (p.hasQuote === false && (p.currency === "USD" || isUSDStock(p.ticker)) && p.totalBuyAmountKRW != null
                      ? p.totalBuyAmountKRW
                      : toKRW(p, p.marketValue, rate)),
                  0
                );
                return {
                  name: group.accountName,
                  value: Math.max(0, cash + stock),
                  cash,
                  stock
                };
              });
              const positionAccountIds = new Set(positionsByAccount.map(g => g.accountId));
              const cashOnly = balances
                .filter(
                  b =>
                    !positionAccountIds.has(b.account.id) &&
                    (b.account.type === "securities" || b.account.type === "crypto")
                )
                .map(b => {
                  const cash = cashOf(b);
                  return { name: b.account.name, value: Math.max(0, cash), cash, stock: 0 };
                });
              const accountData = [...withPositions, ...cashOnly].filter(d => d.value > 0);
              
              const totalAsset = accountData.reduce((sum, d) => sum + d.value, 0);
              const colors = ["#f59e0b", "#10b981", "#0ea5e9", "#6366f1", "#f43f5e"];
              
              return (
                <ResponsiveContainer width="100%" height="100%" minHeight={300} minWidth={0}>
                  <PieChart>
                    <Pie
                      isAnimationActive={false}
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
                      formatter={(value: ValueType | undefined, name: NameType | undefined, item: Payload<ValueType, NameType>) => {
                        const p = item?.payload as { name?: string; stock?: number; cash?: number } | undefined;
                        return [
                          formatWithUSD(Number(value ?? 0), rate || null),
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
          <h4 style={{ margin: "0 0 12px 0", textAlign: "center" }}>
            종목별 평가 손익 {positionsWithPrice.length <= 20 ? "(전체)" : "(상위/하위 10개)"}
          </h4>
          <div style={{ width: "100%", height: Math.max(400, positionsWithPrice.length * 30), minHeight: 400, minWidth: 0 }}>
            {positionsWithPrice.length > 0 ? (() => {
              const withPnlKRW = positionsWithPrice.map(p => {
                const usd = p.currency === "USD" || isUSDStock(p.ticker);
                // 원가 = 매입 당시 환율(totalBuyAmountKRW), 평가 = 현재 환율. 달러 pnl×현재환율은
                // 원가를 현재 환율로 소급 재환산하는 것과 동치 — 환차손익이 통째로 빠진다.
                const costKRW = usd ? (p.totalBuyAmountKRW ?? (rate > 0 ? p.totalBuyAmount * rate : 0)) : p.totalBuyAmount;
                const marketKRW =
                  p.hasQuote === false ? costKRW : usd ? (rate > 0 ? p.marketValue * rate : costKRW) : p.marketValue;
                return { ...p, pnlKRW: marketKRW - costKRW };
              });
              const sorted = [...withPnlKRW].sort((a, b) => b.pnlKRW - a.pnlKRW);
              // 종목 20개 이하면 중복 없이 전체 표시, 초과 시에만 상위/하위 10개
              const selected =
                sorted.length <= 20 ? sorted : [...sorted.slice(0, 10), ...sorted.slice(-10)];
              // 색 컨벤션(국내 관례): 이익=빨강(var(--danger)), 손실=파랑(var(--accent))
              const chartData = selected.map(p => ({
                name: (p.name || p.ticker).length > 20 ? (p.name || p.ticker).slice(0, 20) + "..." : (p.name || p.ticker),
                pnl: p.pnlKRW,
                fullName: p.name || p.ticker,
                fill: p.pnlKRW >= 0 ? "var(--danger)" : "var(--accent)"
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
                      formatter={(value: ValueType | undefined, name: NameType | undefined, item: Payload<ValueType, NameType>) => [
                        formatWithUSD(Number(value ?? 0), rate || null),
                        pieTooltipLabel(item) || name
                      ]}
                      cursor={{ fill: "var(--surface-hover)" }}
                    />
                    <Bar isAnimationActive={false} dataKey="pnl" name="평가손익" radius={[0, 4, 4, 0]}>
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              );
            })() : (
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%", color: "var(--text-muted)" }}>
                데이터 없음
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
