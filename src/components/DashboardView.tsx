import React, { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Label
} from "recharts";
import type { Account, LedgerEntry, StockPrice, StockTrade } from "../types";
import { computeAccountBalances, computeMonthlyNetWorth, computePositions } from "../calculations";
import { fetchYahooQuotes } from "../yahooFinanceApi";
import { formatKRW } from "../utils/format";

interface Props {
  accounts: Account[];
  ledger: LedgerEntry[];
  trades: StockTrade[];
  prices: StockPrice[];
}

const COLORS = ["#0ea5e9", "#6366f1", "#f43f5e", "#10b981", "#f59e0b", "#8b5cf6"];

export const DashboardView: React.FC<Props> = ({
  accounts,
  ledger,
  trades,
  prices
}) => {
  const [fxRate, setFxRate] = useState<number | null>(null);
  const [equityPeriod, setEquityPeriod] = useState<"ytd" | "1y" | "all">("ytd");

  useEffect(() => {
    const loadFx = async () => {
      try {
        const res = await fetchYahooQuotes(["USDKRW=X"]);
        const r = res[0];
        if (r?.price) {
          setFxRate(r.price);
        }
      } catch (err) {
        console.warn("fx load failed", err);
      }
    };
    loadFx();
  }, []);

  // USD를 KRW로 변환한 가격 목록
  const adjustedPrices = useMemo(() => {
    if (!fxRate) return prices;
    return prices.map((p) => {
      if (p.currency && p.currency !== "KRW" && p.currency === "USD") {
        return { ...p, price: p.price * fxRate, currency: "KRW" };
      }
      return p;
    });
  }, [prices, fxRate]);

  const balances = useMemo(
    () => computeAccountBalances(accounts, ledger, trades),
    [accounts, ledger, trades]
  );
  const positions = useMemo(
    () => computePositions(trades, adjustedPrices, accounts),
    [trades, adjustedPrices, accounts]
  );
  const monthlyNetWorth = useMemo(
    () => computeMonthlyNetWorth(accounts, ledger, trades),
    [accounts, ledger, trades]
  );

  // 계좌별 주식 평가액 맵 생성
  const stockMap = useMemo(() => {
    const map = new Map<string, number>();
    positions.forEach((p) => {
      const current = map.get(p.accountId) ?? 0;
      map.set(p.accountId, current + p.marketValue);
    });
    return map;
  }, [positions]);

  // 전체 순자산 계산: 현금 + 주식 + 저축 - 부채
  const totalNetWorth = useMemo(() => {
    return balances.reduce((sum, row) => {
      const cashAsset = row.currentBalance;
      const stockAsset = stockMap.get(row.account.id) ?? 0;
      const debt = row.account.debt ?? 0;
      const savings = row.account.savings ?? 0;
      return sum + cashAsset + stockAsset + savings - debt;
    }, 0);
  }, [balances, stockMap]);

  const totalStockPnl = positions.reduce((s, p) => s + p.pnl, 0);
  const totalStockValue = positions.reduce((s, p) => s + p.marketValue, 0);
  
  // 현금 잔액: 모든 계좌의 currentBalance 합계
  const totalCashValue = balances.reduce((s, b) => s + b.currentBalance, 0);
  
  // 저축과 부채 합계
  const totalSavings = accounts.reduce((s, a) => s + (a.savings ?? 0), 0);
  const totalDebt = accounts.reduce((s, a) => s + (a.debt ?? 0), 0);

  // 월별 순자산 시리즈를 맵으로 변환
  const netWorthSeries = useMemo(
    () => [...monthlyNetWorth].sort((a, b) => a.month.localeCompare(b.month)),
    [monthlyNetWorth]
  );
  const netWorthMap = useMemo(
    () => new Map(netWorthSeries.map((r) => [r.month, r.netWorth])),
    [netWorthSeries]
  );
  const latestNetWorth = netWorthSeries.at(-1)?.netWorth ?? totalNetWorth;

  // 월별 순입금(수입-지출) 누적
  const monthlyNetContrib = useMemo(() => {
    const map = new Map<string, number>();
    ledger.forEach((l) => {
      const month = l.date.slice(0, 7);
      if (!map.has(month)) map.set(month, 0);
      if (l.kind === "income") map.set(month, (map.get(month) ?? 0) + l.amount);
      if (l.kind === "expense") map.set(month, (map.get(month) ?? 0) - l.amount);
    });
    return Array.from(map.entries())
      .map(([month, v]) => ({ month, value: v }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [ledger]);

  const equitySeries = useMemo(() => {
    const months = new Set<string>();
    netWorthSeries.forEach((r) => months.add(r.month));
    monthlyNetContrib.forEach((r) => months.add(r.month));
    const sorted = Array.from(months).sort();

    let cumContrib = 0;
    let prevNetWorth = latestNetWorth;
    return sorted.map((m) => {
      const contrib = monthlyNetContrib.find((r) => r.month === m)?.value ?? 0;
      cumContrib += contrib;
      const nw = netWorthMap.get(m);
      const netWorth = nw ?? prevNetWorth;
      prevNetWorth = netWorth;
      const pnl = netWorth - cumContrib;
      return { month: m, netWorth, contrib: cumContrib, pnl };
    });
  }, [monthlyNetContrib, netWorthSeries, netWorthMap, latestNetWorth]);

  const filteredEquitySeries = useMemo(() => {
    if (equityPeriod === "all") return equitySeries;
    const now = new Date();
    if (equityPeriod === "ytd") {
      const key = `${now.getFullYear()}-01`;
      return equitySeries.filter((r) => r.month >= key);
    }
    if (equityPeriod === "1y") {
      const past = new Date();
      past.setFullYear(past.getFullYear() - 1);
      const key = past.toISOString().slice(0, 7);
      return equitySeries.filter((r) => r.month >= key);
    }
    return equitySeries;
  }, [equitySeries, equityPeriod]);

  const getMonthKey = (date: Date) => date.toISOString().slice(0, 7);
  const getPastNetWorth = (monthsBack: number) => {
    const d = new Date();
    d.setMonth(d.getMonth() - monthsBack);
    const key = getMonthKey(d);
    return netWorthMap.get(key) ?? netWorthSeries[0]?.netWorth ?? latestNetWorth;
  };
  const getYtdNetWorth = () => {
    const now = new Date();
    const key = `${now.getFullYear()}-01`;
    return netWorthMap.get(key) ?? netWorthSeries[0]?.netWorth ?? latestNetWorth;
  };
  const formatReturn = (base: number) => {
    if (!base || base <= 0) return "0.00%";
    const r = (latestNetWorth - base) / base;
    return `${(r * 100).toFixed(2)}%`;
  };
  const return1M = formatReturn(getPastNetWorth(1));
  const return3M = formatReturn(getPastNetWorth(3));
  const returnYtd = formatReturn(getYtdNetWorth());

  const assetSegments = useMemo(() => {
    const cashAndSavings = totalCashValue + totalSavings;
    const stock = totalStockValue;
    const debtAbs = Math.max(0, totalDebt);
    
    return [
      { name: "현금+저축", value: cashAndSavings },
      { name: "주식", value: stock },
      { name: "부채", value: debtAbs }
    ].filter(i => i.value > 0);
  }, [totalCashValue, totalSavings, totalStockValue, totalDebt]);

  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthlyIncome = ledger
    .filter((l) => l.kind === "income" && l.date.startsWith(thisMonth))
    .reduce((s, l) => s + l.amount, 0);
  const monthlyExpense = ledger
    .filter((l) => l.kind === "expense" && l.date.startsWith(thisMonth))
    .reduce((s, l) => s + l.amount, 0);
  const monthlyExpenseByCategory = useMemo(() => {
    const map = new Map<string, number>();
    ledger
      .filter((l) => l.kind === "expense" && l.date.startsWith(thisMonth))
      .forEach((l) => {
        const key = l.category || "기타";
        map.set(key, (map.get(key) ?? 0) + l.amount);
      });
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [ledger, thisMonth]);

  const monthlyDividendSeries = useMemo(() => {
    const map = new Map<string, number>();
    ledger
      .filter((l) => l.kind === "income")
      .filter(
        (l) =>
          (l.category && l.category.includes("배당")) ||
          (l.description && l.description.includes("배당"))
      )
      .forEach((l) => {
        const month = l.date.slice(0, 7);
        map.set(month, (map.get(month) ?? 0) + l.amount);
      });
    return Array.from(map.entries())
      .map(([month, value]) => ({ month, value }))
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-6);
  }, [ledger]);

  // 주식 비율 트리맵 데이터
  const positionsWithPrice = useMemo(() => {
    return positions
      .filter((p) => p.quantity > 0)
      .map((p) => {
        const priceInfo = adjustedPrices.find((x) => x.ticker === p.ticker);
        const marketPrice = priceInfo?.price ?? p.marketPrice ?? 0;
        const marketValue = (marketPrice || 0) * (p.quantity || 0);
        const pnl = marketValue - (p.totalBuyAmount || 0);
        const pnlRate = (p.totalBuyAmount || 0) > 0 ? pnl / p.totalBuyAmount : 0;
        return {
          ...p,
          marketPrice,
          marketValue,
          pnl,
          pnlRate
        };
      })
      .filter((p) => p.marketValue > 0);
  }, [positions, adjustedPrices]);

  // 하루 단위 전체 자산 변동 데이터
  const dailyAssetData = useMemo(() => {
    const dateSet = new Set<string>();
    trades.forEach((t) => {
      if (t.date) dateSet.add(t.date);
    });
    ledger.forEach((l) => {
      if (l.date) dateSet.add(l.date);
    });
    const dates = Array.from(dateSet).sort();
    if (dates.length === 0) return [];

    // 모든 날짜를 포함 (하루 단위)
    const startDate = new Date(dates[0]);
    const endDate = new Date(dates[dates.length - 1]);
    const allDates: string[] = [];
    
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      // 거래나 가계부 내역이 있는 날짜만 포함
      if (dateSet.has(dateStr)) {
        allDates.push(dateStr);
      }
    }

    return allDates.map((date) => {
      // 해당 날짜까지의 거래만 필터링
      const filteredTrades = trades.filter((t) => t.date && t.date <= date);
      const filteredLedger = ledger.filter((l) => l.date && l.date <= date);
      const filteredPositions = computePositions(filteredTrades, adjustedPrices, accounts);
      const filteredBalances = computeAccountBalances(accounts, filteredLedger, filteredTrades);
      
      // 주식 자산 계산
      const stockAsset = filteredPositions.reduce((sum, p) => sum + (p.marketValue || 0), 0);
      
      // 현금 자산 계산 (증권계좌만)
      const cashAsset = filteredBalances
        .filter((b) => b.account.type === "securities")
        .reduce((sum, b) => sum + b.currentBalance, 0);
      
      // 총 자산
      const totalAsset = stockAsset + cashAsset;
      
      return {
        date,
        stockAsset,
        cashAsset,
        totalAsset
      };
    });
  }, [trades, adjustedPrices, accounts, ledger]);


  // 에러 방지: 데이터가 없거나 잘못된 경우 빈 배열 반환
  const safePositionsWithPrice = positionsWithPrice || [];
  const safeDailyAssetData = dailyAssetData || [];

  return (
    <div>
      <h2>대시보드</h2>
      <div className="cards-row">
        <div className="card highlight">
          <div className="card-title">전체 순자산</div>
          <div className={`card-value ${totalNetWorth >= 0 ? "" : "negative"}`}>
            {Math.round(totalNetWorth).toLocaleString()} 원
          </div>
        </div>
        <div className="card">
          <div className="card-title">이번달 총수입</div>
          <div className="card-value positive">{Math.round(monthlyIncome).toLocaleString()} 원</div>
        </div>
        <div className="card">
          <div className="card-title">이번달 총지출</div>
          <div className="card-value negative">{Math.round(monthlyExpense).toLocaleString()} 원</div>
        </div>
        <div className="card">
          <div className="card-title">이번달 순수입</div>
          <div className={`card-value ${monthlyIncome - monthlyExpense >= 0 ? "positive" : "negative"}`}>
            {Math.round(monthlyIncome - monthlyExpense).toLocaleString()} 원
          </div>
        </div>
      </div>

      <div className="cards-row">
        <div className="card" style={{ gridColumn: "span 1" }}>
          <h3 style={{ margin: "0 0 10px 0", fontSize: 16 }}>자산 구성</h3>
          <div style={{ width: "100%", height: 240, position: "relative" }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={assetSegments}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={85}
                  paddingAngle={2}
                  dataKey="value"
                  stroke="none"
                >
                  {assetSegments.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                  <Label
                    value={Math.round(totalNetWorth / 10000) + "만원"}
                    position="center"
                    fill="var(--text)"
                    style={{ fontSize: "14px", fontWeight: "bold" }}
                  />
                </Pie>
                <Tooltip 
                  formatter={(value: any) => Math.round(Number(value || 0)).toLocaleString() + " 원"}
                  contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}
                />
                <Legend verticalAlign="bottom" height={36} iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        
        <div className="card" style={{ gridColumn: "span 2" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>누적 수익곡선</h3>
            <div style={{ display: "flex", gap: 6 }}>
              <span className="pill muted">1M {return1M}</span>
              <span className="pill muted">YTD {returnYtd}</span>
              <button
                type="button"
                className={`pill ${equityPeriod === "all" ? "active" : "muted"}`}
                onClick={() => setEquityPeriod(equityPeriod === "all" ? "ytd" : "all")}
                style={{ cursor: "pointer", border: "1px solid var(--border)" }}
              >
                {equityPeriod === "all" ? "축소" : "전체"}
              </button>
            </div>
          </div>
          <div style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer>
              <AreaChart data={filteredEquitySeries} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorNetWorth" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis 
                  dataKey="month" 
                  fontSize={11} 
                  tickFormatter={(v) => v.slice(2)}
                  tickMargin={10}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis 
                  fontSize={11} 
                  tickFormatter={(v) => `${(v / 100000000).toFixed(1)}억`} 
                  width={40}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip 
                  formatter={(value: any) => Math.round(Number(value || 0)).toLocaleString() + " 원"}
                  labelFormatter={(label) => `${label}`}
                  contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}
                />
                <Area 
                  type="monotone" 
                  dataKey="netWorth" 
                  name="순자산"
                  stroke="#6366f1" 
                  strokeWidth={2}
                  fillOpacity={1} 
                  fill="url(#colorNetWorth)" 
                />
                <Area 
                  type="monotone" 
                  dataKey="contrib" 
                  name="누적입금"
                  stroke="#0ea5e9" 
                  strokeWidth={2}
                  fill="none" 
                  strokeDasharray="4 4"
                />
                <Legend verticalAlign="top" height={36} iconType="rect" wrapperStyle={{ top: -10 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="cards-row">
        <div className="card">
          <div className="card-title">이번달 소비 TOP 5</div>
          <div style={{ width: "100%", height: 180, marginTop: 10 }}>
            {monthlyExpenseByCategory.length > 0 ? (
              <ResponsiveContainer>
                <BarChart layout="vertical" data={monthlyExpenseByCategory} margin={{ left: 20 }}>
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" width={60} fontSize={11} />
                  <Tooltip formatter={(val: any) => Math.round(Number(val || 0)).toLocaleString() + " 원"} />
                  <Bar dataKey="value" fill="#f43f5e" radius={[0, 4, 4, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="hint">데이터 없음</p>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-title">최근 6개월 배당금</div>
          <div style={{ width: "100%", height: 180, marginTop: 10 }}>
            {monthlyDividendSeries.length > 0 ? (
              <ResponsiveContainer>
                <BarChart data={monthlyDividendSeries}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" fontSize={11} tickFormatter={(v) => v.slice(5)} />
                  <YAxis hide />
                  <Tooltip formatter={(val: any) => Math.round(Number(val || 0)).toLocaleString() + " 원"} />
                  <Bar dataKey="value" fill="#10b981" radius={[4, 4, 0, 0]} barSize={30} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="hint">데이터 없음</p>
            )}
          </div>
        </div>
      </div>

      <div className="cards-row">
        <div className="card" style={{ gridColumn: "span 2" }}>
          <div className="card-title">전체 자산 변동 (일별)</div>
          <div style={{ width: "100%", height: 350, marginTop: 10 }}>
            {safeDailyAssetData.length > 0 ? (
              <ResponsiveContainer>
                <AreaChart data={safeDailyAssetData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorTotalAsset" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorStockAsset" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorCashAsset" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis 
                    dataKey="date" 
                    fontSize={11} 
                    tickFormatter={(v) => {
                      const date = new Date(v);
                      return `${date.getMonth() + 1}/${date.getDate()}`;
                    }}
                    tickMargin={10}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis 
                    fontSize={11} 
                    tickFormatter={(v) => `${(v / 100000000).toFixed(1)}억`} 
                    width={50}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip 
                    formatter={(value: any) => formatKRW(value)}
                    labelFormatter={(label) => {
                      const date = new Date(label);
                      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                    }}
                    contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="totalAsset" 
                    name="총 자산"
                    stroke="#6366f1" 
                    strokeWidth={2}
                    fillOpacity={1} 
                    fill="url(#colorTotalAsset)" 
                  />
                  <Area 
                    type="monotone" 
                    dataKey="stockAsset" 
                    name="주식 자산"
                    stroke="#0ea5e9" 
                    strokeWidth={2}
                    fillOpacity={1} 
                    fill="url(#colorStockAsset)" 
                  />
                  <Area 
                    type="monotone" 
                    dataKey="cashAsset" 
                    name="현금 자산"
                    stroke="#10b981" 
                    strokeWidth={2}
                    fillOpacity={1} 
                    fill="url(#colorCashAsset)" 
                  />
                  <Legend verticalAlign="top" height={36} iconType="rect" wrapperStyle={{ top: -10 }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="hint">거래 내역이 없습니다.</p>
            )}
          </div>
        </div>
      </div>

      <h3>계좌별 현재 잔액</h3>
      <table className="data-table compact">
        <thead>
          <tr>
            <th>계좌</th>
            <th>기관</th>
            <th>현재잔액</th>
          </tr>
        </thead>
        <tbody>
          {balances.map((b) => (
            <tr key={b.account.id}>
              <td>{b.account.name}</td>
              <td>{b.account.institution}</td>
              <td className="number">{Math.round(b.currentBalance).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>상위 수익/손실 종목</h3>
      <table className="data-table compact">
        <thead>
          <tr>
            <th>티커</th>
            <th>종목명</th>
            <th>보유수량</th>
            <th>평가손익</th>
            <th>수익률</th>
          </tr>
        </thead>
        <tbody>
          {[...positions]
            .sort((a, b) => b.pnl - a.pnl)
            .slice(0, 5)
            .map((p) => (
              <tr key={p.ticker}>
                <td>{p.ticker}</td>
                <td>{p.name}</td>
                <td className="number">{Math.round(p.quantity).toLocaleString()}</td>
                <td className={`number ${p.pnl >= 0 ? "positive" : "negative"}`}>
                  {Math.round(p.pnl).toLocaleString()}
                </td>
                <td className={`number ${p.pnl >= 0 ? "positive" : "negative"}`}>
                  {(p.pnlRate * 100).toFixed(2)}%
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
};
