import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  Label
} from "recharts";
import type { Account, LedgerEntry, StockPrice, StockTrade } from "../types";
import { computeAccountBalances, computeMonthlyNetWorth, computePositions } from "../calculations";
import { fetchYahooQuotes } from "../yahooFinanceApi";
import { formatKRW } from "../utils/format";
import { calculateAccountPerformance, logAccountPerformance } from "../utils/accountPerformanceValidation";

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
  const [equityPeriod, setEquityPeriod] = useState<"ytd" | "1y" | "all">("all");
  
  // 위젯 표시/숨김 설정
  const [visibleWidgets, setVisibleWidgets] = useState<Set<string>>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("fw-dashboard-widgets");
        if (saved) return new Set(JSON.parse(saved));
      } catch {}
    }
    return new Set(["summary", "assets", "income", "stocks", "portfolio"]);
  });
  
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("fw-dashboard-widgets", JSON.stringify(Array.from(visibleWidgets)));
    }
  }, [visibleWidgets]);
  
  const toggleWidget = (widgetId: string) => {
    const newSet = new Set(visibleWidgets);
    if (newSet.has(widgetId)) {
      newSet.delete(widgetId);
    } else {
      newSet.add(widgetId);
    }
    setVisibleWidgets(newSet);
  };

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

  const totalStockPnl = useMemo(() => positions.reduce((s, p) => s + p.pnl, 0), [positions]);
  const totalStockValue = useMemo(() => positions.reduce((s, p) => s + p.marketValue, 0), [positions]);
  
  // 현금 잔액: 입출금(checking), 증권(securities), 기타(other) 계좌의 currentBalance 합계 (저축 타입 제외)
  const totalCashValue = useMemo(() => {
    return balances
      .filter((b) => b.account.type === "checking" || b.account.type === "securities" || b.account.type === "other")
      .reduce((s, b) => s + b.currentBalance, 0);
  }, [balances]);
  
  // 저축: 저축(savings) 타입 계좌의 currentBalance + accounts의 savings 필드
  const totalSavings = useMemo(() => {
    const savingsAccountsBalance = balances
      .filter((b) => b.account.type === "savings")
      .reduce((s, b) => s + b.currentBalance, 0);
    const savingsField = accounts.reduce((s, a) => s + (a.savings ?? 0), 0);
    return savingsAccountsBalance + savingsField;
  }, [balances, accounts]);
  
  const totalDebt = useMemo(() => accounts.reduce((s, a) => s + (a.debt ?? 0), 0), [accounts]);

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

    if (sorted.length === 0) return [];

    // 첫 번째 월의 순자산 (초기 자산)
    const firstMonth = sorted[0];
    const initialNetWorth = netWorthMap.get(firstMonth) ?? 0;
    
    // 첫 번째 월의 순입금
    const firstMonthContrib = monthlyNetContrib.find((r) => r.month === firstMonth)?.value ?? 0;
    
    // 초기 자산 = 첫 번째 월 순자산 - 첫 번째 월 순입금
    const initialAsset = initialNetWorth - firstMonthContrib;
    
    let cumContrib = initialAsset; // 초기 자산부터 시작
    let prevNetWorth = initialNetWorth;
    
    return sorted.map((m) => {
      const contrib = monthlyNetContrib.find((r) => r.month === m)?.value ?? 0;
      cumContrib += contrib; // 누적 입금 = 초기 자산 + 모든 순입금
      const nw = netWorthMap.get(m);
      const netWorth = nw ?? prevNetWorth;
      prevNetWorth = netWorth;
      
      // 수익 = 순자산 - 누적 입금
      const pnl = netWorth - cumContrib;
      
      // 수익률 = 수익 / 누적 입금 * 100
      const pnlRate = cumContrib > 0 ? (pnl / cumContrib) * 100 : 0;
      
      return { month: m, netWorth, contrib: cumContrib, pnl, pnlRate };
    });
  }, [monthlyNetContrib, netWorthSeries, netWorthMap]);

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
  const getPastNetWorth = useCallback((monthsBack: number) => {
    const d = new Date();
    d.setMonth(d.getMonth() - monthsBack);
    const key = getMonthKey(d);
    return netWorthMap.get(key) ?? netWorthSeries[0]?.netWorth ?? latestNetWorth;
  }, [netWorthMap, netWorthSeries, latestNetWorth]);
  const getYtdNetWorth = useMemo(() => {
    const now = new Date();
    const key = `${now.getFullYear()}-01`;
    return netWorthMap.get(key) ?? netWorthSeries[0]?.netWorth ?? latestNetWorth;
  }, [netWorthMap, netWorthSeries, latestNetWorth]);
  
  const ytdNetWorthValue = getYtdNetWorth;
  const formatReturn = useCallback((base: number) => {
    if (!base || base <= 0) return "0.00%";
    const r = (latestNetWorth - base) / base;
    return `${(r * 100).toFixed(2)}%`;
  }, [latestNetWorth]);
  const return1M = useMemo(() => {
    const pastNetWorth = getPastNetWorth(1);
    return formatReturn(pastNetWorth);
  }, [formatReturn, getPastNetWorth]);
  const return3M = useMemo(() => {
    const pastNetWorth = getPastNetWorth(3);
    return formatReturn(pastNetWorth);
  }, [formatReturn, getPastNetWorth]);
  const returnYtd = useMemo(() => {
    return formatReturn(ytdNetWorthValue);
  }, [formatReturn, ytdNetWorthValue]);

  const assetSegments = useMemo(() => {
    const stock = totalStockValue;
    const debtAbs = Math.max(0, totalDebt);
    
    return [
      { name: "주식", value: stock },
      { name: "현금", value: totalCashValue },
      { name: "저축", value: totalSavings },
      { name: "부채", value: debtAbs }
    ].filter(i => i.value > 0);
  }, [totalCashValue, totalSavings, totalStockValue, totalDebt]);

  const thisMonth = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const monthlyIncome = useMemo(() => 
    ledger
      .filter((l) => l.kind === "income" && l.date.startsWith(thisMonth))
      .reduce((s, l) => s + l.amount, 0),
    [ledger, thisMonth]
  );
  const monthlyExpense = useMemo(() =>
    ledger
      .filter((l) => l.kind === "expense" && l.date.startsWith(thisMonth))
      .reduce((s, l) => s + l.amount, 0),
    [ledger, thisMonth]
  );
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
  // 중요: positions의 totalBuyAmount는 netBuyAmount이므로, 실제 총매입금액을 직접 계산해야 함
  // 성능 최적화: trades를 미리 그룹화하여 반복 필터링 방지
  const buyTradesByPosition = useMemo(() => {
    const map = new Map<string, number>();
    trades
      .filter(t => t.side === "buy")
      .forEach(t => {
        const key = `${t.accountId}::${t.ticker}`;
        map.set(key, (map.get(key) ?? 0) + t.totalAmount);
      });
    return map;
  }, [trades]);
  
  const positionsWithPrice = useMemo(() => {
    return positions
      .filter((p) => p.quantity > 0)
      .map((p) => {
        const priceInfo = adjustedPrices.find((x) => x.ticker === p.ticker);
        const marketPrice = priceInfo?.price ?? p.marketPrice ?? 0;
        const marketValue = (marketPrice || 0) * (p.quantity || 0);
        
        // 실제 총매입금액 계산: 미리 그룹화된 맵에서 조회
        const key = `${p.accountId}::${p.ticker}`;
        const actualTotalBuyAmount = buyTradesByPosition.get(key) ?? 0;
        
        // 평가손익 = 평가금액 - 실제 총매입금액 (실제 계좌 화면과 동일)
        const pnl = marketValue - actualTotalBuyAmount;
        const pnlRate = actualTotalBuyAmount > 0 ? pnl / actualTotalBuyAmount : 0;
        
        return {
          ...p,
          marketPrice,
          marketValue,
          pnl,
          pnlRate,
          actualTotalBuyAmount // 디버깅용
        };
      })
      .filter((p) => p.marketValue > 0);
  }, [positions, adjustedPrices, buyTradesByPosition]);

  // 계좌별 포지션 그룹화
  const positionsByAccount = useMemo(() => {
    const map = new Map<
      string,
      {
        accountId: string;
        accountName: string;
        rows: typeof positionsWithPrice;
      }
    >();
    for (const p of positionsWithPrice) {
      const group = map.get(p.accountId) ?? { accountId: p.accountId, accountName: p.accountName, rows: [] };
      group.rows.push(p);
      map.set(p.accountId, group);
    }
    return Array.from(map.values());
  }, [positionsWithPrice]);

  // 1일과 15일만 표시하는 전체 자산 변동 데이터 (모든 계좌 타입 포함)
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

    // 첫 거래 날짜부터 오늘까지 모든 날짜 생성
    const firstDate = new Date(dates[0]);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // 1일과 15일만 선택
    const selectedDates: string[] = [];
    const currentDate = new Date(firstDate);
    
    while (currentDate <= today) {
      const day = currentDate.getDate();
      // 1일 또는 15일인 경우만 추가
      if (day === 1 || day === 15) {
        selectedDates.push(currentDate.toISOString().split('T')[0]);
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // 마지막 날짜가 1일이나 15일이 아니면 추가
    const lastDateStr = today.toISOString().split('T')[0];
    if (!selectedDates.includes(lastDateStr)) {
      selectedDates.push(lastDateStr);
    }

    // 최신 데이터는 한 번만 계산 (캐싱)
    const latestPositions = computePositions(trades, adjustedPrices, accounts);
    const latestBalances = computeAccountBalances(accounts, ledger, trades);
    
    // 증권계좌: 주식 자산
    const latestStockAsset = latestPositions.reduce((sum, p) => sum + (p.marketValue || 0), 0);
    
    // 증권계좌: 현금 (달러 환율 적용 + 원화)
    const securitiesAccounts = latestBalances.filter((b) => b.account.type === "securities");
    const latestSecuritiesCash = securitiesAccounts.reduce((sum, b) => {
      const account = b.account;
      const usdBalance = account.usdBalance ?? 0;
      const krwBalance = account.krwBalance ?? 0;
      const cash = fxRate ? (usdBalance * fxRate) + krwBalance : krwBalance;
      return sum + cash;
    }, 0);
    
    // 입출금, 저축 계좌 잔액
    const latestCheckingSavings = latestBalances
      .filter((b) => b.account.type === "checking" || b.account.type === "savings")
      .reduce((sum, b) => sum + b.currentBalance, 0);
    
    const latestTotalAsset = latestStockAsset + latestSecuritiesCash + latestCheckingSavings;
    
    const todayStr = today.toISOString().split('T')[0];

    // 역순으로 계산 (최신부터 과거로)
    const result: Array<{ date: string; totalAsset: number }> = [];
    
    for (let i = selectedDates.length - 1; i >= 0; i--) {
      const date = selectedDates[i];
      
      // 최신 날짜면 캐시된 데이터 사용
      if (date === todayStr) {
        result.unshift({
          date,
          totalAsset: latestTotalAsset
        });
        continue;
      }

      // 해당 날짜까지의 거래만 필터링
      const filteredTrades = trades.filter((t) => t.date && t.date <= date);
      const filteredLedger = ledger.filter((l) => l.date && l.date <= date);
      
      // 계산 수행
      const filteredPositions = computePositions(filteredTrades, adjustedPrices, accounts);
      const filteredBalances = computeAccountBalances(accounts, filteredLedger, filteredTrades);
      
      // 증권계좌: 주식 자산
      const stockAsset = filteredPositions.reduce((sum, p) => sum + (p.marketValue || 0), 0);
      
      // 증권계좌: 현금 (달러 환율 적용 + 원화)
      const securitiesBalances = filteredBalances.filter((b) => b.account.type === "securities");
      const securitiesCash = securitiesBalances.reduce((sum, b) => {
        const account = b.account;
        const usdBalance = account.usdBalance ?? 0;
        const krwBalance = account.krwBalance ?? 0;
        const cash = fxRate ? (usdBalance * fxRate) + krwBalance : krwBalance;
        return sum + cash;
      }, 0);
      
      // 입출금, 저축 계좌 잔액
      const checkingSavings = filteredBalances
        .filter((b) => b.account.type === "checking" || b.account.type === "savings")
        .reduce((sum, b) => sum + b.currentBalance, 0);
      
      const totalAsset = stockAsset + securitiesCash + checkingSavings;
      
      result.unshift({
        date,
        totalAsset
      });
    }

    return result;
  }, [trades, adjustedPrices, accounts, ledger, fxRate]);


  // 에러 방지: 데이터가 없거나 잘못된 경우 빈 배열 반환
  const safePositionsWithPrice = positionsWithPrice || [];
  const safeDailyAssetData = dailyAssetData || [];

  // 1. 상위/하위 수익 종목 TOP 10
  const topBottomStocks = useMemo(() => {
    const sorted = [...safePositionsWithPrice].sort((a, b) => b.pnl - a.pnl);
    const top10 = sorted.slice(0, 10);
    const bottom10 = sorted.slice(-10).reverse();
    return [...top10, ...bottom10].map(p => ({
      name: (p.name || p.ticker).length > 20 ? (p.name || p.ticker).slice(0, 20) + "..." : (p.name || p.ticker),
      fullName: p.name || p.ticker,
      pnl: p.pnl,
      fill: p.pnl >= 0 ? "#f43f5e" : "#0ea5e9" // 수익(빨강), 손실(파랑)
    }));
  }, [safePositionsWithPrice]);

  // 2. 시간별 포트폴리오 가치 추이
  const portfolioValueHistory = useMemo(() => {
    const dateSet = new Set<string>();
    trades.forEach((t) => {
      if (t.date) dateSet.add(t.date);
    });
    const dates = Array.from(dateSet).sort();
    if (dates.length === 0) return [];

    // 월별로 샘플링
    const monthMap = new Map<string, string>();
    dates.forEach((date) => {
      const month = date.slice(0, 7);
      if (!monthMap.has(month) || date > monthMap.get(month)!) {
        monthMap.set(month, date);
      }
    });

    const result: Array<{ date: string; totalValue: number; totalCost: number; pnl: number }> = [];
    const sortedMonths = Array.from(monthMap.keys()).sort();

    sortedMonths.forEach((month) => {
      const date = monthMap.get(month)!;
      const filteredTrades = trades.filter((t) => t.date && t.date <= date);
      const filteredPositions = computePositions(filteredTrades, adjustedPrices, accounts);
      
      const totalValue = filteredPositions.reduce((sum, p) => sum + (p.marketValue || 0), 0);
      // 주의: p.totalBuyAmount는 netBuyAmount이므로, 실제 총 매입금액을 직접 계산
      const filteredAccountTrades = trades.filter((t) => t.date && t.date <= date);
      const actualTotalCost = filteredAccountTrades
        .filter(t => t.side === "buy")
        .reduce((sum, t) => sum + t.totalAmount, 0);
      const pnl = totalValue - actualTotalCost;

      result.push({ date, totalValue, totalCost: actualTotalCost, pnl });
    });

    return result;
  }, [trades, adjustedPrices, accounts]);

  // 3. 계좌별 수익률 비교
  // 간단하고 정확한 계산 방식:
  // 1. 총 원금 = 모든 buy 거래의 totalAmount 합계 (실제 투입한 금액)
  // 2. 총 평가액 = 주식 평가액 + 현재 현금 잔액 (증권계좌는 달러+원화 환율 적용)
  // 3. 수익률 = (총 평가액 - 총 원금) / 총 원금 * 100
  const accountPerformance = useMemo(() => {
    return positionsByAccount.map(group => {
      const accountTrades = trades.filter(t => t.accountId === group.accountId);
      const account = accounts.find(a => a.id === group.accountId);
      const accountBalance = balances.find(b => b.account.id === group.accountId);
      
      if (!account || !accountBalance) {
        return null;
      }
      
      // 증권 계좌가 아니거나 주식이 없는 경우 제외
      if (account.type !== "securities" || group.rows.length === 0) {
        return null;
      }
      
      // === 1단계: 총 매입금액 계산 (실제 투입한 현금만) ===
      // cashImpact < 0인 buy 거래만 원금으로 계산 (실제로 현금을 사용한 거래)
      const actualBuyTrades = accountTrades.filter(
        t => t.side === "buy" && t.cashImpact < 0
      );
      const totalCost = actualBuyTrades.reduce((sum, t) => sum + Math.abs(t.cashImpact), 0);
      
      // 원금이 0이면 수익률 계산 불가
      if (totalCost <= 0) {
        return null;
      }
      
      // === 2단계: 주식 평가액 ===
      const stockValue = group.rows.reduce((sum, p) => sum + (p.marketValue || 0), 0);
      
      // === 3단계: 현재 현금 잔액 (증권계좌) ===
      let currentCash = 0;
      if (account.type === "securities") {
        const usdBalance = account.usdBalance ?? 0;
        const krwBalance = account.krwBalance ?? 0;
        // 달러는 환율로 변환하여 합산
        currentCash = fxRate ? (usdBalance * fxRate) + krwBalance : krwBalance;
      }
      
      // === 4단계: 총 평가액 계산 ===
      const totalValue = stockValue + currentCash;
      
      // === 5단계: 평가손익 및 수익률 계산 ===
      const pnl = totalValue - totalCost;
      const pnlRate = (pnl / totalCost) * 100;
      
      // 비정상적인 값 필터링
      if (isNaN(pnlRate) || !isFinite(pnlRate) || Math.abs(pnlRate) > 10000) {
        return null;
      }
      
      return {
        name: group.accountName,
        pnlRate,
        totalValue,
        pnl,
        fill: pnlRate >= 0 ? "#f43f5e" : "#0ea5e9"
      };
    })
    .filter((a): a is NonNullable<typeof a> => a !== null && a.totalValue > 0 && a.pnlRate !== undefined)
    .sort((a, b) => b.pnlRate - a.pnlRate);
  }, [positionsByAccount, balances, accounts, trades, fxRate]);

  // 4. 종목별 수익률 vs 평가금액 (산점도)
  const scatterData = useMemo(() => {
    return safePositionsWithPrice.map(p => ({
      x: p.pnlRate * 100, // 수익률 (%)
      y: p.marketValue, // 평가금액
      name: p.name || p.ticker,
      fill: p.pnl >= 0 ? "#f43f5e" : "#0ea5e9"
    }));
  }, [safePositionsWithPrice]);

  // 5. 포트폴리오 수익률 분포 (히스토그램)
  const pnlRateDistribution = useMemo(() => {
    const bins: { [key: string]: number } = {
      "~-20%": 0,
      "-20%~-10%": 0,
      "-10%~0%": 0,
      "0%~10%": 0,
      "10%~20%": 0,
      "20%~": 0
    };

    safePositionsWithPrice.forEach(p => {
      const rate = p.pnlRate * 100;
      if (rate < -20) bins["~-20%"]++;
      else if (rate < -10) bins["-20%~-10%"]++;
      else if (rate < 0) bins["-10%~0%"]++;
      else if (rate < 10) bins["0%~10%"]++;
      else if (rate < 20) bins["10%~20%"]++;
      else bins["20%~"]++;
    });

    return Object.entries(bins).map(([name, value]) => ({
      name,
      value,
      fill: name.includes("-") || name.startsWith("~") ? "#0ea5e9" : "#f43f5e"
    }));
  }, [safePositionsWithPrice]);

  // 6. 시장별/통화별 자산 분포
  const marketCurrencyDistribution = useMemo(() => {
    const krwPositions = safePositionsWithPrice.filter(p => {
      const account = accounts.find(a => a.id === p.accountId);
      return !account?.currency || account.currency === "KRW";
    });
    const usdPositions = safePositionsWithPrice.filter(p => {
      const account = accounts.find(a => a.id === p.accountId);
      return account?.currency === "USD";
    });
    
    const krwValue = krwPositions.reduce((sum, p) => sum + p.marketValue, 0);
    const usdValue = usdPositions.reduce((sum, p) => sum + p.marketValue, 0);

    return [
      { name: "한국 시장 (KRW)", value: krwValue },
      { name: "미국 시장 (USD)", value: usdValue }
    ].filter(d => d.value > 0);
  }, [safePositionsWithPrice, accounts]);

  return (
    <div>
      <div className="section-header">
        <h2>대시보드</h2>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            const modal = document.createElement("div");
            modal.className = "modal-backdrop";
            const widgetNames: Record<string, string> = {
              summary: "요약 카드",
              assets: "자산 구성",
              income: "수입/지출",
              stocks: "주식 성과",
              portfolio: "포트폴리오"
            };
            modal.innerHTML = `
              <div class="modal" style="max-width: 500px">
                <div class="modal-header">
                  <h3>위젯 표시 설정</h3>
                  <button onclick="this.closest('.modal-backdrop').remove()">닫기</button>
                </div>
                <div class="modal-body">
                  ${Object.entries(widgetNames).map(([id, name]) => `
                    <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px">
                      <input type="checkbox" ${visibleWidgets.has(id) ? "checked" : ""} 
                        data-widget-id="${id}" />
                      <span>${name}</span>
                    </label>
                  `).join("")}
                </div>
              </div>
            `;
            modal.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
              checkbox.addEventListener("change", (e) => {
                const widgetId = (e.target as HTMLInputElement).dataset.widgetId;
                if (widgetId) {
                  toggleWidget(widgetId);
                  (e.target as HTMLInputElement).checked = visibleWidgets.has(widgetId);
                }
              });
            });
            document.body.appendChild(modal);
            modal.addEventListener("click", (e) => {
              if (e.target === modal) modal.remove();
            });
          }}
          style={{ fontSize: 12, padding: "6px 12px" }}
        >
          ⚙️ 위젯 설정
        </button>
      </div>
      {visibleWidgets.has("summary") && (
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
      )}

      {visibleWidgets.has("assets") && (
        <div className="cards-row">
          <div className="card" style={{ gridColumn: "span 1" }}>
            <h3 style={{ margin: "0 0 10px 0", fontSize: 16 }}>자산 구성</h3>
          <div style={{ width: "100%", height: 240, position: "relative", minHeight: 240, minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%" minHeight={240} minWidth={0}>
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
                  {assetSegments.map((entry, index) => {
                    // 부채와 저축의 색상 지정
                    let color = COLORS[index % COLORS.length];
                    if (entry.name === "부채") {
                      color = "#f43f5e"; // 빨간색
                    } else if (entry.name === "저축") {
                      color = "#10b981"; // 초록색
                    }
                    return <Cell key={`cell-${index}`} fill={color} />;
                  })}
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
                {equityPeriod === "all" ? "YTD 보기" : "전체 보기"}
              </button>
            </div>
          </div>
          <div style={{ width: "100%", height: 300, minHeight: 300, minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%" minHeight={300} minWidth={0}>
              <AreaChart data={filteredEquitySeries} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorNetWorth" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorPnl" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
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
                  tickFormatter={(v) => {
                    if (Math.abs(v) >= 100000000) return `${(v / 100000000).toFixed(1)}억`;
                    if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(0)}만`;
                    return `${Math.round(v).toLocaleString()}`;
                  }} 
                  width={50}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip 
                  formatter={(value: any, name: string) => {
                    if (name === "수익률") {
                      return `${Number(value).toFixed(2)}%`;
                    }
                    return Math.round(Number(value || 0)).toLocaleString() + " 원";
                  }}
                  labelFormatter={(label) => `${label}`}
                  contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}
                />
                <Area 
                  type="monotone" 
                  dataKey="netWorth" 
                  name="순자산"
                  stroke="#6366f1" 
                  strokeWidth={2.5}
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
                  strokeDasharray="5 5"
                  opacity={0.7}
                />
                <Area 
                  type="monotone" 
                  dataKey="pnl" 
                  name="수익"
                  stroke="#10b981" 
                  strokeWidth={2}
                  fillOpacity={0.2} 
                  fill="url(#colorPnl)" 
                />
                <Legend 
                  verticalAlign="top" 
                  height={36} 
                  iconType="rect" 
                  wrapperStyle={{ top: -10 }}
                  formatter={(value: string) => {
                    if (value === "순자산") return "순자산 (총 자산)";
                    if (value === "누적입금") return "누적입금 (투입 원금)";
                    if (value === "수익") return "수익 (순자산 - 누적입금)";
                    return value;
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          </div>
        </div>
      )}

      {visibleWidgets.has("income") && (
        <div className="cards-row">
          <div className="card">
            <div className="card-title">이번달 소비 TOP 5</div>
          <div style={{ width: "100%", height: 180, marginTop: 10, minHeight: 180, minWidth: 0 }}>
            {monthlyExpenseByCategory.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%" minHeight={180} minWidth={0}>
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
          <div style={{ width: "100%", height: 180, marginTop: 10, minHeight: 180, minWidth: 0 }}>
            {monthlyDividendSeries.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%" minHeight={180} minWidth={0}>
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
      )}

      {visibleWidgets.has("portfolio") && (
        <div className="cards-row">
          <div className="card" style={{ gridColumn: "span 2" }}>
            <div className="card-title">전체 자산 변동 (일별)</div>
            <div style={{ width: "100%", height: 350, marginTop: 10, minHeight: 350, minWidth: 0 }}>
              {safeDailyAssetData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%" minHeight={350} minWidth={0}>
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
                      const day = date.getDate();
                      // 1일과 15일만 표시
                      if (day === 1 || day === 15) {
                        return `${date.getMonth() + 1}/${day}`;
                      }
                      return "";
                    }}
                    tickMargin={10}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                  />
                  <YAxis 
                    fontSize={11} 
                    tickFormatter={(v) => `${(v / 10000000).toFixed(1)}천만원`} 
                    width={60}
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
                    name="전체 자산"
                    stroke="#6366f1" 
                    strokeWidth={2}
                    fillOpacity={1} 
                    fill="url(#colorTotalAsset)" 
                  />
                  <Legend verticalAlign="top" height={36} iconType="rect" wrapperStyle={{ top: -10 }} />
                </AreaChart>
              </ResponsiveContainer>
              ) : (
                <p className="hint">데이터 없음</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 주식 포트폴리오 분석 */}
      {safePositionsWithPrice.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <h3 style={{ margin: "0 0 24px 0" }}>주식 포트폴리오 분석</h3>

          {/* 높은 우선순위 차트 */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 24, marginBottom: 24 }}>
            {/* 1. 상위/하위 수익 종목 TOP 10 */}
            <div className="card" style={{ border: "1px solid var(--border)", boxShadow: "none", padding: 16 }}>
              <h4 style={{ margin: "0 0 12px 0", textAlign: "center" }}>상위/하위 수익 종목 TOP 10</h4>
              <div style={{ width: "100%", height: Math.max(400, topBottomStocks.length * 30), minHeight: 400, minWidth: 0 }}>
                <ResponsiveContainer width="100%" height="100%" minHeight={400} minWidth={0}>
                  <BarChart
                    data={topBottomStocks}
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
                      {topBottomStocks.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 2. 시간별 포트폴리오 가치 추이 */}
            <div className="card" style={{ border: "1px solid var(--border)", boxShadow: "none", padding: 16 }}>
              <h4 style={{ margin: "0 0 12px 0", textAlign: "center" }}>시간별 포트폴리오 가치 추이</h4>
              <div style={{ width: "100%", height: 300, minHeight: 300, minWidth: 0 }}>
                {portfolioValueHistory.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%" minHeight={300} minWidth={0}>
                    <AreaChart data={portfolioValueHistory} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorTotalValue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorTotalCost" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorPnl" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                      <XAxis 
                        dataKey="date" 
                        fontSize={11} 
                        tickFormatter={(v) => v.slice(5)} 
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
                        labelFormatter={(label) => label}
                        contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="totalValue" 
                        name="총 평가금액"
                        stroke="#6366f1" 
                        strokeWidth={2}
                        fillOpacity={1} 
                        fill="url(#colorTotalValue)" 
                      />
                      <Area 
                        type="monotone" 
                        dataKey="totalCost" 
                        name="총 매입금액"
                        stroke="#0ea5e9" 
                        strokeWidth={2}
                        fillOpacity={1} 
                        fill="url(#colorTotalCost)" 
                      />
                      <Area 
                        type="monotone" 
                        dataKey="pnl" 
                        name="평가손익"
                        stroke="#10b981" 
                        strokeWidth={2}
                        fillOpacity={1} 
                        fill="url(#colorPnl)" 
                      />
                      <Legend verticalAlign="top" height={36} iconType="rect" wrapperStyle={{ top: -10 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%", color: "var(--muted)" }}>
                    거래 내역이 없습니다.
                  </div>
                )}
              </div>
            </div>

            {/* 3. 계좌별 수익률 비교 */}
            <div className="card" style={{ border: "1px solid var(--border)", boxShadow: "none", padding: 16 }}>
              <h4 style={{ margin: "0 0 12px 0", textAlign: "center" }}>계좌별 수익률 비교</h4>
              <div style={{ width: "100%", height: Math.max(300, accountPerformance.length * 40), minHeight: 300, minWidth: 0 }}>
                {accountPerformance.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%" minHeight={300} minWidth={0}>
                    <BarChart
                      data={accountPerformance}
                      layout="vertical"
                      margin={{ top: 5, right: 30, left: 100, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis 
                        type="number"
                        tickFormatter={(val) => `${val.toFixed(1)}%`} 
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
                          `${value.toFixed(2)}%`,
                          `평가금액: ${formatKRW(payload?.payload?.totalValue)}\n평가손익: ${formatKRW(payload?.payload?.pnl)}`
                        ]}
                        cursor={{fill: 'rgba(0,0,0,0.05)'}}
                      />
                      <Bar dataKey="pnlRate" name="수익률" radius={[0, 4, 4, 0]}>
                        {accountPerformance.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%", color: "var(--muted)" }}>
                    데이터 없음
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 중간 우선순위 차트 */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 24 }}>
            {/* 4. 종목별 수익률 vs 평가금액 (산점도) */}
            <div className="card" style={{ border: "1px solid var(--border)", boxShadow: "none", padding: 16 }}>
              <h4 style={{ margin: "0 0 12px 0", textAlign: "center" }}>종목별 수익률 vs 평가금액</h4>
              <div style={{ width: "100%", height: 300, minHeight: 300, minWidth: 0 }}>
                {scatterData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%" minHeight={300} minWidth={0}>
                    <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis 
                        type="number" 
                        dataKey="x" 
                        name="수익률"
                        label={{ value: "수익률 (%)", position: "insideBottom", offset: -5 }}
                        tickFormatter={(val) => `${val.toFixed(0)}%`}
                        fontSize={11}
                      />
                      <YAxis 
                        type="number" 
                        dataKey="y" 
                        name="평가금액"
                        label={{ value: "평가금액 (원)", angle: -90, position: "insideLeft" }}
                        tickFormatter={(val) => `${(val / 1000000).toFixed(0)}백만`}
                        fontSize={11}
                      />
                      <Tooltip 
                        cursor={{ strokeDasharray: '3 3' }}
                        formatter={(value: any, name?: string) => {
                          if (name === "수익률") return `${(value as number).toFixed(2)}%`;
                          if (name === "평가금액") return formatKRW(value as number);
                          return value;
                        }}
                        labelFormatter={(label, payload) => payload?.[0]?.payload?.name || ""}
                      />
                      <Scatter name="종목" data={scatterData} fill="#8884d8">
                        {scatterData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%", color: "var(--muted)" }}>
                    데이터 없음
                  </div>
                )}
              </div>
            </div>

            {/* 5. 포트폴리오 수익률 분포 (히스토그램) */}
            <div className="card" style={{ border: "1px solid var(--border)", boxShadow: "none", padding: 16 }}>
              <h4 style={{ margin: "0 0 12px 0", textAlign: "center" }}>포트폴리오 수익률 분포</h4>
              <div style={{ width: "100%", height: 300, minHeight: 300, minWidth: 0 }}>
                {pnlRateDistribution.some(d => d.value > 0) ? (
                  <ResponsiveContainer width="100%" height="100%" minHeight={300} minWidth={0}>
                    <BarChart data={pnlRateDistribution} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis 
                        dataKey="name" 
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis 
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip formatter={(value: any) => `${value}개 종목`} />
                      <Bar dataKey="value" name="종목 수" radius={[4, 4, 0, 0]}>
                        {pnlRateDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%", color: "var(--muted)" }}>
                    데이터 없음
                  </div>
                )}
              </div>
            </div>

            {/* 6. 시장별/통화별 자산 분포 (도넛 차트) */}
            <div className="card" style={{ border: "1px solid var(--border)", boxShadow: "none", padding: 16 }}>
              <h4 style={{ margin: "0 0 12px 0", textAlign: "center" }}>시장별/통화별 자산 분포</h4>
              <div style={{ width: "100%", height: 300, minHeight: 300, minWidth: 0 }}>
                {marketCurrencyDistribution.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%" minHeight={300} minWidth={0}>
                    <PieChart>
                      <Pie
                        data={marketCurrencyDistribution}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                        label={({ percent }) => percent ? `${(percent * 100).toFixed(1)}%` : "0%"}
                        labelLine={false}
                      >
                        {marketCurrencyDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={index === 0 ? "#0ea5e9" : "#f59e0b"} />
                        ))}
                      </Pie>
                      <Label
                        value={`총 자산\n${formatKRW(marketCurrencyDistribution.reduce((sum, d) => sum + d.value, 0))}`}
                        position="center"
                        fill="var(--text)"
                        style={{ fontSize: "13px", fontWeight: "bold", textAlign: "center" }}
                      />
                      <Tooltip 
                        formatter={(value: any) => formatKRW(value)}
                      />
                      <Legend 
                        wrapperStyle={{ fontSize: "11px" }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%", color: "var(--muted)" }}>
                    데이터 없음
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

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

    </div>
  );
};
