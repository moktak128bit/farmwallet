import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Label
} from "recharts";
import type { Account, LedgerEntry, StockPrice, StockTrade, CategoryPresets, TargetPortfolio, BudgetGoal } from "../types";
import {
  computeAccountBalances,
  computeMonthlyNetWorth,
  computePositions,
  computeRealizedGainInPeriod,
  computeTotalNetWorth,
  computeTotalStockPnl,
  computeTotalStockValue,
  computeTotalRealizedPnlKRW,
  computeBalanceAtDateForAccounts,
  computeCostBasisAtDateForAccounts,
  computeTotalCashValue,
  computeTotalSavings,
  computeTotalDebt,
  computeExpenseSumForMonthAndCategory
} from "../calculations";
import { formatKRW } from "../utils/formatter";
import { isUSDStock, canonicalTickerForMatch, extractTickerFromText } from "../utils/finance";
import { getCategoryType, getSavingsCategories, isSavingsExpenseEntry } from "../utils/category";
import { useFxRate } from "../hooks/useFxRate";
import { SAVINGS_RATE_GOAL, ISA_PORTFOLIO } from "../constants/config";
import { getThisMonthKST } from "../utils/date";
import { useDashboardIndex } from "./dashboard/hooks/useDashboardIndex";
import { useAppStore } from "../store/appStore";

interface Props {
  accounts?: Account[];
  ledger?: LedgerEntry[];
  trades?: StockTrade[];
  prices?: StockPrice[];
  categoryPresets?: CategoryPresets;
  targetPortfolios?: TargetPortfolio[];
  budgets?: BudgetGoal[];
  dividendTrackingTicker?: string;
  targetNetWorthCurve?: Record<string, number>;
  isaPortfolio?: Array<{ ticker: string; name: string; weight: number; label: string }>;
}

const COLORS = ["#0ea5e9", "#6366f1", "#f43f5e", "#10b981", "#f59e0b", "#8b5cf6"];

const WIDGET_ID_DIVIDEND_TRACKING = "dividendTracking";
const FIRST_CURVE_DATE = "2025-07-01";
const LAST_CURVE_DATE = "2025-12-15";
/** 이 날짜부터 순자산은 실제 계산값 사용 (목표 곡선 미사용) */
const CALC_START_DATE = "2026-01-01";

const DEFAULT_WIDGET_ORDER = ["summary", "assets", "income", "savingsFlow", "budget", "stocks", "portfolio", "targetPortfolio", WIDGET_ID_DIVIDEND_TRACKING, "isa"];

/** 기존 "458730" 위젯 ID를 "dividendTracking"으로 마이그레이션 */
function migrateWidgetId(id: string): string {
  return id === "458730" ? WIDGET_ID_DIVIDEND_TRACKING : id;
}

function getWidgetNames(dividendTicker?: string): Record<string, string> {
  return {
    summary: "요약 카드",
    assets: "자산 구성",
    income: "수입/지출",
    savingsFlow: "저축·투자 기간별 현황",
    budget: "예산 요약",
    stocks: "주식 성과",
    portfolio: "포트폴리오",
    targetPortfolio: "목표 포트폴리오",
    [WIDGET_ID_DIVIDEND_TRACKING]: dividendTicker ? `배당 추적 (${dividendTicker})` : "배당 추적 (티커 선택)",
    isa: "ISA 포트폴리오"
  };
}

function normTicker(t: string): string {
  return canonicalTickerForMatch(t);
}

export const DashboardView: React.FC<Props> = (props) => {
  const storeData = useAppStore((s) => s.data);
  const accounts = props.accounts ?? storeData.accounts;
  const ledger = props.ledger ?? storeData.ledger;
  const trades = props.trades ?? storeData.trades;
  const prices = props.prices ?? storeData.prices;
  const categoryPresets = props.categoryPresets ?? storeData.categoryPresets;
  const targetPortfolios = props.targetPortfolios ?? storeData.targetPortfolios ?? [];
  const budgets = props.budgets ?? storeData.budgetGoals ?? [];
  const dividendTrackingTicker = props.dividendTrackingTicker ?? storeData.dividendTrackingTicker;
  const targetNetWorthCurve = props.targetNetWorthCurve ?? storeData.targetNetWorthCurve ?? {};
  const isaPortfolioProp = props.isaPortfolio ?? storeData.isaPortfolio;
  const isaPortfolio = isaPortfolioProp ?? ISA_PORTFOLIO.map((item) => ({ ticker: item.ticker, name: item.name, weight: item.weight, label: item.label }));
  const WIDGET_NAMES = useMemo(() => getWidgetNames(dividendTrackingTicker), [dividendTrackingTicker]);
  const fxRate = useFxRate(); // useFxRate 훅 사용으로 중복 요청 제거
  const index = useDashboardIndex(ledger, trades);

  const isSavingsExpense = useCallback(
    (entry: LedgerEntry) => isSavingsExpenseEntry(entry, accounts, categoryPresets),
    [accounts, categoryPresets]
  );

  // 위젯 표시/숨김 설정 (기존 "458730" → "dividendTracking" 마이그레이션)
  const [visibleWidgets, setVisibleWidgets] = useState<Set<string>>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("fw-dashboard-widgets");
        if (saved) {
          const arr = JSON.parse(saved) as string[];
          return new Set(Array.isArray(arr) ? arr.map(migrateWidgetId) : DEFAULT_WIDGET_ORDER);
        }
      } catch (e) {
        console.warn("[DashboardView] 위젯 설정 로드 실패", e);
      }
    }
    return new Set(["summary", "assets", "income", "savingsFlow", "stocks", "portfolio", "targetPortfolio", WIDGET_ID_DIVIDEND_TRACKING, "isa"]);
  });

  // 위젯 순서 (표시 순서, localStorage에 저장, 기존 "458730" → "dividendTracking" 마이그레이션)
  const [widgetOrder, setWidgetOrder] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("fw-dashboard-widget-order");
        if (saved) {
          const parsed = JSON.parse(saved) as string[];
          if (Array.isArray(parsed) && parsed.length === DEFAULT_WIDGET_ORDER.length) return parsed.map(migrateWidgetId);
        }
      } catch (e) {
        console.warn("[DashboardView] 위젯 순서 로드 실패", e);
      }
    }
    return [...DEFAULT_WIDGET_ORDER];
  });
  const [widgetSettingsOpen, setWidgetSettingsOpen] = useState(false);
  
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("fw-dashboard-widgets", JSON.stringify(Array.from(visibleWidgets)));
    }
  }, [visibleWidgets]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("fw-dashboard-widget-order", JSON.stringify(widgetOrder));
    }
  }, [widgetOrder]);
  
  const toggleWidget = (widgetId: string) => {
    const newSet = new Set(visibleWidgets);
    if (newSet.has(widgetId)) {
      newSet.delete(widgetId);
    } else {
      newSet.add(widgetId);
    }
    setVisibleWidgets(newSet);
  };

  const moveWidgetOrder = (id: string, direction: "up" | "down") => {
    const idx = widgetOrder.indexOf(id);
    if (idx === -1) return;
    const next = [...widgetOrder];
    const swap = direction === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setWidgetOrder(next);
  };

  useEffect(() => {
    if (!widgetSettingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setWidgetSettingsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [widgetSettingsOpen]);

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
    () => computePositions(trades, adjustedPrices, accounts, { fxRate: fxRate ?? undefined }),
    [trades, adjustedPrices, accounts, fxRate]
  );
  const monthlyNetWorth = useMemo(
    () => computeMonthlyNetWorth(accounts, ledger, trades),
    [accounts, ledger, trades]
  );

  // 계좌별 주식 평가액 맵 (일부 위젯에서 사용)
  const stockMap = useMemo(() => {
    const map = new Map<string, number>();
    positions.forEach((p) => {
      const current = map.get(p.accountId) ?? 0;
      map.set(p.accountId, current + p.marketValue);
    });
    return map;
  }, [positions]);

  const totalNetWorth = useMemo(
    () => computeTotalNetWorth(balances, positions, fxRate),
    [balances, positions, fxRate]
  );
  const totalStockPnl = useMemo(() => computeTotalStockPnl(positions), [positions]);
  const totalStockValue = useMemo(() => computeTotalStockValue(positions), [positions]);
  const totalStockCost = useMemo(
    () => positions.reduce((sum, p) => sum + (p.totalBuyAmount ?? 0), 0),
    [positions]
  );
  const totalStockReturnRate = useMemo(
    () => (totalStockCost > 0 ? (totalStockPnl / totalStockCost) * 100 : null),
    [totalStockPnl, totalStockCost]
  );
  const totalRealizedPnlKRW = useMemo(
    () => computeTotalRealizedPnlKRW(trades, accounts, fxRate),
    [trades, accounts, fxRate]
  );

  const currentMonth = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const budgetUsage = useMemo(() => {
    return budgets.map((b) => {
      const spent = computeExpenseSumForMonthAndCategory(
        ledger,
        currentMonth,
        b.category || undefined
      );
      const limit = b.monthlyLimit || 0;
      const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
      const isOver = spent > limit && limit > 0;
      return { ...b, spent, limit, pct, isOver };
    });
  }, [budgets, ledger, currentMonth]);
  const budgetOverCount = useMemo(() => budgetUsage.filter((b) => b.isOver).length, [budgetUsage]);

  const totalCashValue = useMemo(
    () => computeTotalCashValue(balances, fxRate),
    [balances, fxRate]
  );
  const totalSavings = useMemo(
    () => computeTotalSavings(balances, accounts),
    [balances, accounts]
  );
  const totalDebt = useMemo(() => computeTotalDebt(accounts), [accounts]);
  const totalAssetForPie = useMemo(
    () => totalCashValue + totalSavings + totalStockValue,
    [totalCashValue, totalSavings, totalStockValue]
  );

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

  // 저축·증권 계좌 ID (return2025에서 먼저 사용)
  const savingsOrSecuritiesIdsForReturn = useMemo(
    () => new Set(accounts.filter((a) => a.type === "savings" || a.type === "securities").map((a) => a.id)),
    [accounts]
  );

  // 2025년 수익 (재테크만: 저축·증권 1/1~12/31, 넣은 돈 = 연초 잔액 + 당해 유입)
  const return2025 = useMemo(() => {
    const getRecheckBalanceAtDate = (dateStr: string): number =>
      computeBalanceAtDateForAccounts(
        accounts,
        ledger,
        trades,
        dateStr,
        savingsOrSecuritiesIdsForReturn,
        adjustedPrices,
        { fxRate: fxRate ?? undefined }
      );
    const toKrw = (l: LedgerEntry) => (l.currency === "USD" && fxRate ? l.amount * fxRate : l.amount);
    const in2025 = (l: LedgerEntry) => l.date >= "2025-01-01" && l.date <= "2025-12-31";
    // 2025년 재테크 유입: 대분류 "재테크"만 + 이체로 저축·증권 입금
    const principal2025 =
      ledger
        .filter(
          (l) =>
            l.kind === "expense" && in2025(l) && l.category === "재테크"
        )
        .reduce((s, l) => s + toKrw(l), 0) +
      ledger
        .filter(
          (l) =>
            l.kind === "transfer" && in2025(l) && l.toAccountId && savingsOrSecuritiesIdsForReturn.has(l.toAccountId)
        )
        .reduce((s, l) => s + toKrw(l), 0);
    const transferOut2025 = ledger
      .filter(
        (l) =>
          l.kind === "transfer" &&
          in2025(l) &&
          l.fromAccountId &&
          savingsOrSecuritiesIdsForReturn.has(l.fromAccountId)
      )
      .reduce((s, l) => s + toKrw(l), 0);
    const principal2025Net = principal2025 - transferOut2025;
    const startBalance = getRecheckBalanceAtDate("2024-12-31");
    const endBalanceDec = getRecheckBalanceAtDate("2025-12-31");
    const now = new Date();
    const currentYear = now.getFullYear();
    const endValue = currentYear === 2025
      ? getRecheckBalanceAtDate(now.toISOString().slice(0, 10))
      : endBalanceDec;
    const invested = startBalance + principal2025Net;
    if (invested <= 0 && endValue <= 0) return null;
    const profit = endValue - invested;
    const pct = invested > 0 ? (profit / invested) * 100 : null;
    return {
      invested,
      profit,
      pct,
      endValue,
      endLabel: currentYear === 2025 ? "현재" : "2025-12"
    };
  }, [accounts, ledger, trades, adjustedPrices, fxRate, categoryPresets, savingsOrSecuritiesIdsForReturn]);

  const thisMonth = useMemo(() => getThisMonthKST(), []);

  // 저축·증권 계좌 ID (저축성지출에 해당하는 계좌 = savings + securities)
  const savingsOrSecuritiesIds = useMemo(
    () => new Set(accounts.filter((a) => a.type === "savings" || a.type === "securities").map((a) => a.id)),
    [accounts]
  );

  // 기간별 저축·투자 현황: 월 / 분기 / 년 (원금 = 저축·투자 유입, 수익 = 주식 매도 수익 + 배당 + 이자 + 평가손익)
  const [savingsFlowPeriodType, setSavingsFlowPeriodType] = useState<"month" | "quarter" | "year">("month");
  type SavingsFlowPeriodRow = {
    label: string;
    startDate: string;
    endDate: string;
    principal: number;
    outflows: number;
    cumulativePrincipal: number;
    realizedGain: number;
    valuationGain: number;
    interest: number;
    dividend: number;
    profit: number;
    endBalance: number;
    returnRate: number | null;
  };
  const getSavingsSecuritiesBalanceAtDate = useCallback(
    (dateStr: string): number =>
      computeBalanceAtDateForAccounts(
        accounts,
        ledger,
        trades,
        dateStr,
        savingsOrSecuritiesIds,
        adjustedPrices,
        { fxRate: fxRate ?? undefined }
      ),
    [accounts, ledger, trades, savingsOrSecuritiesIds, adjustedPrices, fxRate]
  );
  const getSavingsSecuritiesCostBasisAtDate = useCallback(
    (dateStr: string): number =>
      computeCostBasisAtDateForAccounts(
        trades,
        dateStr,
        savingsOrSecuritiesIds,
        adjustedPrices,
        accounts,
        { fxRate: fxRate ?? undefined }
      ),
    [trades, savingsOrSecuritiesIds, adjustedPrices, accounts, fxRate]
  );
  const savingsFlowByPeriod = useMemo((): SavingsFlowPeriodRow[] => {
    const now = new Date();
    const savingsCategories = getSavingsCategories(categoryPresets);
    const toKrw = (l: LedgerEntry) => (l.currency === "USD" && fxRate ? l.amount * fxRate : l.amount);
    const dayBefore = (dateStr: string) => {
      const [y, m, d] = dateStr.split("-").map(Number);
      const prev = new Date(y, m - 1, d - 1);
      return prev.toISOString().slice(0, 10);
    };
    const ledgerDates = ledger
      .filter(
        (l) =>
          (l.kind === "expense" && l.date && savingsCategories.includes(l.category!)) ||
          (l.kind === "transfer" && l.date && (savingsOrSecuritiesIds.has(l.toAccountId!) || savingsOrSecuritiesIds.has(l.fromAccountId!)))
      )
      .map((l) => l.date!);
    const tradeDates = trades.filter((t) => savingsOrSecuritiesIds.has(t.accountId)).map((t) => t.date);
    const allDates = [...ledgerDates, ...tradeDates];
    const earliestDate = allDates.length > 0 ? allDates.reduce((a, b) => (a < b ? a : b)) : now.toISOString().slice(0, 10);
    const earliestMonth = earliestDate.slice(0, 7);

    const fullPeriods: { label: string; startDate: string; endDate: string }[] = [];
    if (savingsFlowPeriodType === "month") {
      const [ey, em] = earliestMonth.split("-").map(Number);
      const startYear = ey;
      const startMonth = em;
      const endYear = now.getFullYear();
      const endMonth = now.getMonth() + 1;
      for (let y = startYear; y <= endYear; y++) {
        const mStart = y === startYear ? startMonth : 1;
        const mEnd = y === endYear ? endMonth : 12;
        for (let m = mStart; m <= mEnd; m++) {
          const startDate = `${y}-${String(m).padStart(2, "0")}-01`;
          const lastDay = new Date(y, m, 0).getDate();
          const endDate = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
          fullPeriods.push({ label: `${y}-${String(m).padStart(2, "0")}`, startDate, endDate });
        }
      }
    } else if (savingsFlowPeriodType === "quarter") {
      const [ey] = earliestMonth.split("-").map(Number);
      const endYear = now.getFullYear();
      const currentQ = Math.floor(now.getMonth() / 3) + 1;
      for (let y = ey; y <= endYear; y++) {
        const qEnd = y === endYear ? currentQ : 4;
        for (let q = 1; q <= qEnd; q++) {
          const startMonth = (q - 1) * 3 + 1;
          const endMonth = q * 3;
          const startDate = `${y}-${String(startMonth).padStart(2, "0")}-01`;
          const endDate = `${y}-${String(endMonth).padStart(2, "0")}-${String(new Date(y, endMonth, 0).getDate()).padStart(2, "0")}`;
          fullPeriods.push({ label: `${y}-Q${q}`, startDate, endDate });
        }
      }
    } else {
      const [ey] = earliestMonth.split("-").map(Number);
      const endYear = now.getFullYear();
      for (let y = ey; y <= endYear; y++) {
        fullPeriods.push({
          label: `${y}`,
          startDate: `${y}-01-01`,
          endDate: `${y}-12-31`
        });
      }
    }

    const rows: SavingsFlowPeriodRow[] = [];
    let cumulativePrincipal = 0;
    for (const { label, startDate, endDate } of fullPeriods) {
      const inPeriod = (l: LedgerEntry) => l.date >= startDate && l.date <= endDate;
      // 원금 = 저축성 지출(재테크+저축성지출) + 이체 입금 − 이체 출금
      const savingsExpenseAmount = ledger
        .filter(
          (l) =>
            l.kind === "expense" && inPeriod(l) && savingsCategories.includes(l.category!)
        )
        .reduce((s, l) => s + toKrw(l), 0);
      const transferIn = ledger
        .filter(
          (l) =>
            l.kind === "transfer" && inPeriod(l) && l.toAccountId && savingsOrSecuritiesIds.has(l.toAccountId)
        )
        .reduce((s, l) => s + toKrw(l), 0);
      const outflows = ledger
        .filter(
          (l) =>
            l.kind === "transfer" && inPeriod(l) && l.fromAccountId && savingsOrSecuritiesIds.has(l.fromAccountId)
        )
        .reduce((s, l) => s + toKrw(l), 0);
      const principal = savingsExpenseAmount + transferIn - outflows;
      cumulativePrincipal += principal;
      const startBalance = getSavingsSecuritiesBalanceAtDate(dayBefore(startDate));
      const endBalance = getSavingsSecuritiesBalanceAtDate(endDate);
      const startCostBasis = getSavingsSecuritiesCostBasisAtDate(dayBefore(startDate));
      const endCostBasis = getSavingsSecuritiesCostBasisAtDate(endDate);
      const realizedGain = computeRealizedGainInPeriod(trades, startDate, endDate, savingsOrSecuritiesIds, { accounts, fxRate: fxRate ?? undefined });
      // 평가상승 = 기간 말 미실현손익 − 기간 초 미실현손익 (잔액·매입원가는 해당 시점 기준)
      const unrealizedStart = startBalance - startCostBasis;
      const unrealizedEnd = endBalance - endCostBasis;
      const valuationGain = unrealizedEnd - unrealizedStart;
      const interest = ledger
        .filter(
          (l) =>
            l.kind === "income" &&
            inPeriod(l) &&
            (l.category?.includes("이자") || l.subCategory?.includes("이자") || l.description?.includes("이자"))
        )
        .reduce((s, l) => s + toKrw(l), 0);
      const dividend = ledger
        .filter(
          (l) =>
            l.kind === "income" &&
            inPeriod(l) &&
            (l.category?.includes("배당") || l.subCategory?.includes("배당") || l.description?.includes("배당"))
        )
        .reduce((s, l) => s + toKrw(l), 0);
      const profit = realizedGain + valuationGain + interest + dividend;
      let returnRate: number | null = principal > 0 ? profit / principal : null;
      if (returnRate != null && (returnRate > 10 || returnRate < -1)) returnRate = null;
      rows.push({
        label,
        startDate,
        endDate,
        principal,
        outflows,
        cumulativePrincipal,
        realizedGain,
        valuationGain,
        interest,
        dividend,
        profit,
        endBalance,
        returnRate
      });
    }
    const take = savingsFlowPeriodType === "month" ? 12 : savingsFlowPeriodType === "quarter" ? 8 : 5;
    return rows.slice(-take);
  }, [savingsFlowPeriodType, ledger, trades, savingsOrSecuritiesIds, getSavingsSecuritiesBalanceAtDate, getSavingsSecuritiesCostBasisAtDate, categoryPresets, fxRate]);

  // 순자산 변화 추적 (이전 월 대비)
  const netWorthChangeAnalysis = useMemo(() => {
    if (netWorthSeries.length < 2) {
      return null;
    }

    const currentMonth = thisMonth;
    const currentIndex = netWorthSeries.findIndex(r => r.month === currentMonth);
    
    if (currentIndex < 1) {
      // 이전 월 데이터가 없으면 가장 최근 두 월 비교
      const last = netWorthSeries[netWorthSeries.length - 1];
      const prev = netWorthSeries[netWorthSeries.length - 2];
      if (!last || !prev) return null;
      
      const change = last.netWorth - prev.netWorth;
      const changePercent = prev.netWorth !== 0 ? (change / prev.netWorth) * 100 : 0;
      
      // 이전 월의 순자산 구성 요소 계산
      const prevMonth = prev.month;
      const prevFilteredLedger = ledger.filter(l => l.date.slice(0, 7) <= prevMonth);
      const prevFilteredTrades = trades.filter(t => t.date.slice(0, 7) <= prevMonth);
      const prevBalances = computeAccountBalances(accounts, prevFilteredLedger, prevFilteredTrades);
      const prevPositions = computePositions(prevFilteredTrades, adjustedPrices, accounts, { fxRate: fxRate ?? undefined });
      const prevStockMap = new Map<string, number>();
      prevPositions.forEach((p) => {
        const current = prevStockMap.get(p.accountId) ?? 0;
        prevStockMap.set(p.accountId, current + p.marketValue);
      });
      
      const prevCash = computeTotalCashValue(prevBalances, fxRate);
      const prevStock = prevPositions.reduce((s, p) => s + p.marketValue, 0);
      const prevSavings = computeTotalSavings(prevBalances, accounts);
      const prevDebt = accounts.reduce((s, a) => s + (a.debt ?? 0), 0);
      
      // 현재 월의 순자산 구성 요소
      const currentCash = totalCashValue;
      const currentStock = totalStockValue;
      const currentSavings = totalSavings;
      const currentDebt = totalDebt;
      
      // 변화 요인 분석
      const cashChange = currentCash - prevCash;
      const stockChange = currentStock - prevStock;
      const savingsChange = currentSavings - prevSavings;
      const debtChange = currentDebt - prevDebt;
      
      // 해당 기간의 수입/지출
      const periodIncome = ledger
        .filter(l => {
          const month = l.date.slice(0, 7);
          return month > prevMonth && month <= currentMonth && l.kind === "income";
        })
        .reduce((s, l) => s + l.amount, 0);
      
      const periodExpense = ledger
        .filter(l => {
          const month = l.date.slice(0, 7);
          return month > prevMonth && month <= currentMonth && l.kind === "expense" && !isSavingsExpense(l);
        })
        .reduce((s, l) => s + l.amount, 0);
      
      const periodSavingsExpense = ledger
        .filter(l => {
          const month = l.date.slice(0, 7);
          return month > prevMonth && month <= currentMonth && isSavingsExpense(l);
        })
        .reduce((s, l) => s + l.amount, 0);
      
      return {
        prevMonth: prev.month,
        currentMonth: last.month,
        change,
        changePercent,
        factors: {
          cashChange,
          stockChange,
          savingsChange,
          debtChange,
          periodIncome,
          periodExpense,
          periodSavingsExpense
        }
      };
    }
    
    const current = netWorthSeries[currentIndex];
    const prev = netWorthSeries[currentIndex - 1];
    
    const change = current.netWorth - prev.netWorth;
    const changePercent = prev.netWorth !== 0 ? (change / prev.netWorth) * 100 : 0;
    
    // 이전 월의 순자산 구성 요소 계산
    const prevMonth = prev.month;
    const prevFilteredLedger = ledger.filter(l => l.date.slice(0, 7) <= prevMonth);
    const prevFilteredTrades = trades.filter(t => t.date.slice(0, 7) <= prevMonth);
    const prevBalances = computeAccountBalances(accounts, prevFilteredLedger, prevFilteredTrades);
    const prevPositions = computePositions(prevFilteredTrades, adjustedPrices, accounts, { fxRate: fxRate ?? undefined });
    
    const prevCash = computeTotalCashValue(prevBalances, fxRate);
    const prevStock = prevPositions.reduce((s, p) => s + p.marketValue, 0);
    const prevSavings = computeTotalSavings(prevBalances, accounts);
    const prevDebt = accounts.reduce((s, a) => s + (a.debt ?? 0), 0);
    
    // 현재 월의 순자산 구성 요소
    const currentCash = totalCashValue;
    const currentStock = totalStockValue;
    const currentSavings = totalSavings;
    const currentDebt = totalDebt;
    
    // 변화 요인 분석
    const cashChange = currentCash - prevCash;
    const stockChange = currentStock - prevStock;
    const savingsChange = currentSavings - prevSavings;
    const debtChange = currentDebt - prevDebt;
    
    // 해당 기간의 수입/지출
    const periodIncome = ledger
      .filter(l => {
        const month = l.date.slice(0, 7);
        return month > prevMonth && month <= currentMonth && l.kind === "income";
      })
      .reduce((s, l) => s + l.amount, 0);
    
    const periodExpense = ledger
      .filter(l => {
        const month = l.date.slice(0, 7);
        return month > prevMonth && month <= currentMonth && l.kind === "expense" && !isSavingsExpense(l);
      })
      .reduce((s, l) => s + l.amount, 0);
    
    const periodSavingsExpense = ledger
      .filter(l => {
        const month = l.date.slice(0, 7);
        return month > prevMonth && month <= currentMonth && isSavingsExpense(l);
      })
      .reduce((s, l) => s + l.amount, 0);
    
    return {
      prevMonth: prev.month,
      currentMonth: current.month,
      change,
      changePercent,
      factors: {
        cashChange,
        stockChange,
        savingsChange,
        debtChange,
        periodIncome,
        periodExpense,
        periodSavingsExpense
      }
    };
  }, [netWorthSeries, thisMonth, ledger, trades, accounts, balances, positions, adjustedPrices, totalCashValue, totalStockValue, totalSavings, totalDebt]);

  const _legacyAssetSegments = useMemo(() => {
    const stock = totalStockValue;
    const debtAbs = Math.max(0, totalDebt);
    
    return [
      { name: "주식", value: stock },
      { name: "현금", value: totalCashValue },
      { name: "저축", value: totalSavings },
      { name: "부채", value: debtAbs }
    ].filter(i => i.value > 0);
  }, [totalCashValue, totalSavings, totalStockValue, totalDebt]);

  const assetSegments = useMemo(() => {
    return [
      { name: "주식", value: totalStockValue },
      { name: "현금", value: totalCashValue },
      { name: "저축", value: totalSavings }
    ].filter((i) => i.value > 0);
  }, [totalCashValue, totalSavings, totalStockValue]);

  const monthlyIncome = useMemo(() => {
    const monthEntries = index.ledgerByMonth.get(thisMonth) ?? [];
    return monthEntries.filter((l) => l.kind === "income").reduce((s, l) => s + l.amount, 0);
  }, [index.ledgerByMonth, thisMonth]);

  /** 이번달 급여만 (subCategory 또는 category가 '급여') */
  const monthlySalaryThisMonth = useMemo(() => {
    const isSalary = (l: LedgerEntry) =>
      ((l.subCategory ?? "").trim() === "급여" || (l.category ?? "").trim() === "급여");
    return ledger
      .filter(
        (l) =>
          l.kind === "income" &&
          l.date.startsWith(thisMonth) &&
          isSalary(l)
      )
      .reduce((s, l) => s + l.amount, 0);
  }, [ledger, thisMonth]);

  /** 저축 목표 기준 급여. 이번달 없으면 최근 월 급여 사용 (아직 월급 날 전인 경우 등) */
  const monthlySalary = useMemo(() => {
    if (monthlySalaryThisMonth > 0) return monthlySalaryThisMonth;
    const isSalary = (l: LedgerEntry) =>
      ((l.subCategory ?? "").trim() === "급여" || (l.category ?? "").trim() === "급여");
    const salaryEntries = ledger
      .filter((l) => l.kind === "income" && isSalary(l) && l.amount > 0)
      .sort((a, b) => b.date.localeCompare(a.date));
    if (salaryEntries.length === 0) return 0;
    return salaryEntries[0].amount;
  }, [ledger, monthlySalaryThisMonth]);
  
  // 이번달 순소비: 저축·투자·원금상환 제외한 실제 소비만
  const monthlyNetConsumption = useMemo(() =>
    ledger
      .filter((l) => {
        // expense이고 저축성지출이 아닌 것만
        if (l.kind === "expense" && !isSavingsExpense(l) && l.date.startsWith(thisMonth)) {
          return true;
        }
        return false;
      })
      .reduce((s, l) => s + l.amount, 0),
    [ledger, thisMonth, accounts, categoryPresets]
  );
  
  // 이전 총지출 계산 (하위 호환성)
  const monthlyExpense = useMemo(() =>
    ledger
      .filter((l) => {
        if (l.kind === "expense" && l.date.startsWith(thisMonth)) return true;
        if (isSavingsExpense(l) && l.date.startsWith(thisMonth)) return true;
        return false;
      })
      .reduce((s, l) => s + l.amount, 0),
    [ledger, thisMonth, accounts, categoryPresets]
  );
  
  // 이번달 저축성 지출 합계
  const monthlySavingsExpense = useMemo(() =>
    ledger
      .filter((l) => isSavingsExpense(l) && l.date.startsWith(thisMonth))
      .reduce((s, l) => s + l.amount, 0),
    [ledger, thisMonth, accounts, categoryPresets]
  );
  
  // 저축률: 저축성지출 ÷ 수입
  const savingsRate = useMemo(() => {
    if (monthlyIncome <= 0) return 0;
    return (monthlySavingsExpense / monthlyIncome) * 100;
  }, [monthlyIncome, monthlySavingsExpense]);
  
  // 최근 3개월 평균 순소비 계산
  const avgNetConsumption3Months = useMemo(() => {
    const months: string[] = [];
    const now = new Date();
    for (let i = 0; i < 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(d.toISOString().slice(0, 7));
    }
    
    const monthlyAmounts = months.map((month) => {
      return ledger
        .filter((l) => {
          if (l.kind === "expense" && !isSavingsExpense(l) && l.date.startsWith(month)) {
            return true;
          }
          return false;
        })
        .reduce((s, l) => s + l.amount, 0);
    });
    
    const sum = monthlyAmounts.reduce((s, v) => s + v, 0);
    return sum / 3;
  }, [ledger, accounts, categoryPresets]);
  
  // 비상금 지수: 현금성 자산 ÷ 최근 3개월 평균 순소비
  const emergencyFundIndex = useMemo(() => {
    if (avgNetConsumption3Months <= 0) return 0;
    return totalCashValue / avgNetConsumption3Months;
  }, [totalCashValue, avgNetConsumption3Months]);
  const monthlyExpenseByCategory = useMemo(() => {
    const map = new Map<string, number>();
    ledger
      .filter((l) => l.kind === "expense" && !isSavingsExpense(l) && l.date.startsWith(thisMonth))
      .forEach((l) => {
        const key = l.category || "기타";
        map.set(key, (map.get(key) ?? 0) + l.amount);
      });
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [ledger, thisMonth, accounts, categoryPresets]);

  // 월별 카테고리별 소비 데이터 (대분류 기준, 최근 12개월) — 저축성지출 제외, 순소비만
  const monthlyExpenseByCategoryTimeSeries = useMemo(() => {
    const categoryMonthMap = new Map<string, Map<string, number>>();
    
    ledger
      .filter((l) => l.kind === "expense" && !isSavingsExpense(l) && l.date)
      .forEach((l) => {
        const month = l.date.slice(0, 7);
        const category = l.category || "기타";
        if (!categoryMonthMap.has(category)) {
          categoryMonthMap.set(category, new Map());
        }
        const monthMap = categoryMonthMap.get(category)!;
        monthMap.set(month, (monthMap.get(month) ?? 0) + l.amount);
      });

    // 모든 월 수집
    const allMonths = new Set<string>();
    categoryMonthMap.forEach((monthMap) => {
      monthMap.forEach((_, month) => allMonths.add(month));
    });

    // 최근 12개월만 선택
    const sortedMonths = Array.from(allMonths).sort().slice(-12);

    // 각 카테고리의 총 소비 금액 계산 (TOP N 선택용)
    const categoryTotals = new Map<string, number>();
    categoryMonthMap.forEach((monthMap, category) => {
      const total = Array.from(monthMap.values()).reduce((sum, val) => sum + val, 0);
      categoryTotals.set(category, total);
    });

    // TOP 10 카테고리 선택
    const topCategories = Array.from(categoryTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([category]) => category);

    // 월별 데이터 생성
    return sortedMonths.map((month) => {
      const data: { month: string; [key: string]: number | string } = { month };
      topCategories.forEach((category) => {
        const monthMap = categoryMonthMap.get(category);
        data[category] = monthMap?.get(month) ?? 0;
      });
      return data;
    });
  }, [ledger, accounts, categoryPresets]);

  // 월별 소분류 포함 소비 데이터 — 저축성지출 제외, 순소비만
  const monthlyExpenseByCategoryDetail = useMemo(() => {
    const detailMonthMap = new Map<string, Map<string, number>>();
    
    ledger
      .filter((l) => l.kind === "expense" && !isSavingsExpense(l) && l.date)
      .forEach((l) => {
        const month = l.date.slice(0, 7);
        const category = l.category || "기타";
        const subCategory = l.subCategory;
        const key = subCategory ? `${category} > ${subCategory}` : category;
        if (!detailMonthMap.has(key)) {
          detailMonthMap.set(key, new Map());
        }
        const monthMap = detailMonthMap.get(key)!;
        monthMap.set(month, (monthMap.get(month) ?? 0) + l.amount);
      });

    return detailMonthMap;
  }, [ledger, accounts, categoryPresets]);

  // 라인 차트용 카테고리 목록 추출
  const expenseCategories = useMemo(() => {
    if (monthlyExpenseByCategoryTimeSeries.length === 0) return [];
    const firstData = monthlyExpenseByCategoryTimeSeries[0];
    return Object.keys(firstData).filter(key => key !== "month");
  }, [monthlyExpenseByCategoryTimeSeries]);

  // 주말 vs 평일 소비 (이번 달, 저축성지출 제외 소비만)
  const weekendVsWeekday = useMemo(() => {
    const [y, m] = thisMonth.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const last = new Date(y, m, 0);
    let weekendDays = 0;
    let weekdayDays = 0;
    for (let d = 1; d <= last.getDate(); d++) {
      const day = new Date(y, m - 1, d).getDay();
      if (day === 0 || day === 6) weekendDays += 1;
      else weekdayDays += 1;
    }
    let weekendTotal = 0;
    let weekdayTotal = 0;
    ledger
      .filter((l) => l.kind === "expense" && !isSavingsExpense(l) && l.date.startsWith(thisMonth))
      .forEach((l) => {
        const parts = l.date.split("-").map(Number);
        const day = new Date(parts[0], parts[1] - 1, parts[2]).getDay();
        if (day === 0 || day === 6) weekendTotal += l.amount;
        else weekdayTotal += l.amount;
      });
    const weekendAvg = weekendDays > 0 ? weekendTotal / weekendDays : 0;
    const weekdayAvg = weekdayDays > 0 ? weekdayTotal / weekdayDays : 0;
    return {
      weekendTotal,
      weekdayTotal,
      weekendDays,
      weekdayDays,
      weekendAvg,
      weekdayAvg,
      total: weekendTotal + weekdayTotal
    };
  }, [ledger, thisMonth, accounts, categoryPresets]);

  // 1. 자산군별 비중 분석 (Doughnut Chart)
  const assetAllocation = useMemo(() => {
    // 현금: checking, savings 계좌 잔액 합계
    const cashBalance = balances
      .filter((b) => b.account.type === "checking" || b.account.type === "savings")
      .reduce((sum, b) => sum + b.currentBalance, 0);
    
    // 주식: securities 계좌의 주식 평가액 합계
    const stockValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
    
    // 증권계좌 현금: KRW + USD(환율 적용)
    const securitiesCash = balances
      .filter((b) => b.account.type === "securities")
      .reduce((sum, b) => {
        const krw = b.currentBalance;
        const usd = (b.account.usdBalance ?? 0) + (b.usdTransferNet ?? 0);
        return sum + krw + (fxRate && usd ? usd * fxRate : 0);
      }, 0);
    
    const totalAssets = cashBalance + stockValue + securitiesCash;
    
    if (totalAssets === 0) return [];
    
    return [
      { name: "현금", value: cashBalance, ratio: (cashBalance / totalAssets) * 100 },
      { name: "주식", value: stockValue, ratio: (stockValue / totalAssets) * 100 },
      { name: "증권계좌 현금", value: securitiesCash, ratio: (securitiesCash / totalAssets) * 100 }
    ].filter(item => item.value > 0);
  }, [balances, positions, fxRate]);

  // 2. 종목별 비중 분석 (Bar Chart)
  const stockWeightByTicker = useMemo(() => {
    if (positions.length === 0) return [];
    
    const totalStockValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
    if (totalStockValue === 0) return [];
    
    // 종목별로 평가액 합계 (같은 티커가 여러 계좌에 있을 수 있음)
    const tickerMap = new Map<string, { name: string; value: number }>();
    positions.forEach((p) => {
      const current = tickerMap.get(p.ticker) ?? { name: p.name, value: 0 };
      tickerMap.set(p.ticker, {
        name: current.name,
        value: current.value + p.marketValue
      });
    });
    
    // 평가액 기준 내림차순 정렬
    const sorted = Array.from(tickerMap.entries())
      .map(([ticker, data]) => ({
        ticker,
        name: data.name,
        value: data.value,
        ratio: (data.value / totalStockValue) * 100
      }))
      .sort((a, b) => b.value - a.value);
    
    // 상위 10개 종목 + 기타
    const top10 = sorted.slice(0, 10);
    const others = sorted.slice(10);
    const othersValue = others.reduce((sum, item) => sum + item.value, 0);
    
    if (othersValue > 0) {
      return [
        ...top10,
        {
          ticker: "기타",
          name: `기타 (${others.length}개 종목)`,
          value: othersValue,
          ratio: (othersValue / totalStockValue) * 100
        }
      ];
    }
    
    return top10;
  }, [positions]);

  // 3. 투자 원금 대비 수익률 추이 (Line Chart)
  const investmentPerformanceSeries = useMemo(() => {
    if (trades.length === 0) return [];
    
    // 모든 거래를 날짜순 정렬
    const sortedTrades = [...trades].sort((a, b) => a.date.localeCompare(b.date));
    
    // 월별 누적 투입 금액 계산 (매수 거래의 totalAmount 누적)
    const monthlyInvestment = new Map<string, number>();
    let cumulativeInvestment = 0;
    
    sortedTrades.forEach((t) => {
      if (t.side === "buy") {
        cumulativeInvestment += t.totalAmount;
        const month = t.date.slice(0, 7);
        // 해당 월의 마지막 투입 금액 기록
        monthlyInvestment.set(month, cumulativeInvestment);
      }
    });
    
    // 월별 평가액 계산 (월말 기준)
    const months = new Set<string>();
    trades.forEach((t) => months.add(t.date.slice(0, 7)));
    const sortedMonths = Array.from(months).sort();
    
    return sortedMonths.map((month) => {
      // 해당 월까지의 거래로 positions 계산
      const filteredTrades = trades.filter((t) => t.date.slice(0, 7) <= month);
      const monthPositions = computePositions(filteredTrades, adjustedPrices, accounts, { fxRate: fxRate ?? undefined });
      const monthEndValue = monthPositions.reduce((sum, p) => sum + p.marketValue, 0);
      
      // 해당 월의 누적 투입 금액
      const investedAmount = monthlyInvestment.get(month) ?? 0;
      
      // 수익률 계산
      const returnRate = investedAmount > 0 
        ? ((monthEndValue - investedAmount) / investedAmount) * 100 
        : 0;
      
      return {
        month,
        investedAmount,
        marketValue: monthEndValue,
        returnRate
      };
    }).filter(item => item.investedAmount > 0 || item.marketValue > 0);
  }, [trades, adjustedPrices, accounts, fxRate]);

  // 4. 외화 자산 비중 (Pie Chart) - 주식만
  const foreignAssetRatio = useMemo(() => {
    if (positions.length === 0) return [];
    
    const totalStockValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
    if (totalStockValue === 0) return [];
    
    // USD 종목과 KRW 종목 분리
    let usdValue = 0;
    let krwValue = 0;
    
    positions.forEach((p) => {
      if (isUSDStock(p.ticker)) {
        usdValue += p.marketValue;
      } else {
        krwValue += p.marketValue;
      }
    });
    
    return [
      { name: "국내 주식", value: krwValue, ratio: (krwValue / totalStockValue) * 100 },
      { name: "해외 주식", value: usdValue, ratio: (usdValue / totalStockValue) * 100 }
    ].filter(item => item.value > 0);
  }, [positions]);
  
  const monthlyDividendSeries = useMemo(() => {
    const map = new Map<string, number>();
    ledger
      .filter((l) => l.kind === "income")
      .filter(
        (l) =>
          (l.category && l.category.includes("배당")) ||
          (l.subCategory && l.subCategory.includes("배당")) ||
          (l.description && l.description.includes("배당"))
      )
      .forEach((l) => {
        const month = l.date.slice(0, 7);
        map.set(month, (map.get(month) ?? 0) + l.amount);
      });
    return Array.from(map.entries())
      .map(([month, value]) => ({ month, value }))
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-12); // 12개월로 확장
  }, [ledger]);
  
  // 이번달 고정비 vs 변동비 분석
  const monthlyFixedVariableExpense = useMemo(() => {
    let fixedExpense = 0;
    let variableExpense = 0;
    
    ledger
      .filter((l) => {
        // expense이고 저축성지출이 아닌 것만
        if (l.kind === "expense" && !isSavingsExpense(l) && l.date.startsWith(thisMonth)) {
          return true;
        }
        return false;
      })
      .forEach((l) => {
        // 카테고리 타입 시스템 우선 사용, 없으면 기존 isFixedExpense 플래그 사용
        const categoryType = getCategoryType(l.category, l.subCategory, l.kind, categoryPresets, l, accounts);
        if (categoryType === "fixed") {
          fixedExpense += l.amount;
        } else if (categoryType === "variable") {
          variableExpense += l.amount;
        } else {
          // categoryType이 fixed/variable이 아닌 경우 (저축성지출 등), 기존 로직 사용
          if (l.isFixedExpense) {
            fixedExpense += l.amount;
          } else {
            variableExpense += l.amount;
          }
        }
      });
    
    return {
      fixedExpense,
      variableExpense,
      total: fixedExpense + variableExpense,
      fixedRatio: fixedExpense + variableExpense > 0 
        ? (fixedExpense / (fixedExpense + variableExpense)) * 100 
        : 0,
      variableRatio: fixedExpense + variableExpense > 0 
        ? (variableExpense / (fixedExpense + variableExpense)) * 100 
        : 0
    };
  }, [ledger, thisMonth, accounts, categoryPresets]);

  // 월평균 고정비 (최근 12개월) + 카테고리별 월평균 내역
  const monthlyAvgFixedExpenseData = useMemo(() => {
    const monthTotals = new Map<string, number>();
    const categoryByMonth = new Map<string, Map<string, number>>();
    ledger
      .filter((l) => l.kind === "expense" && !isSavingsExpense(l))
      .forEach((l) => {
        const month = l.date.slice(0, 7);
        const categoryType = getCategoryType(l.category, l.subCategory, l.kind, categoryPresets, l, accounts);
        if (categoryType === "fixed" || (categoryType !== "variable" && l.isFixedExpense)) {
          monthTotals.set(month, (monthTotals.get(month) ?? 0) + l.amount);
          if (!categoryByMonth.has(month)) categoryByMonth.set(month, new Map());
          const cat = l.category || "(미분류)";
          const m = categoryByMonth.get(month)!;
          m.set(cat, (m.get(cat) ?? 0) + l.amount);
        }
      });
    const values = Array.from(monthTotals.values()).filter((v) => v > 0);
    const avg = values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
    const monthCount = values.length;
    const categorySums = new Map<string, number>();
    categoryByMonth.forEach((catMap) => {
      catMap.forEach((amt, cat) => {
        categorySums.set(cat, (categorySums.get(cat) ?? 0) + amt);
      });
    });
    const breakdown = Array.from(categorySums.entries())
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, sum]) => ({ category: cat, amount: monthCount > 0 ? sum / monthCount : sum }));
    return { avg, breakdown };
  }, [ledger, accounts, categoryPresets]);

  const monthlyAvgFixedExpense = monthlyAvgFixedExpenseData.avg;

  // 가장 최근 달 배당금 (현재가 2월이면 1월 배당금 등)
  const latestMonthDividend = useMemo(() => {
    const monthTotals = new Map<string, number>();
    ledger
      .filter((l) => l.kind === "income")
      .filter((l) => (l.category && l.category.includes("배당")) || (l.subCategory && l.subCategory.includes("배당")) || (l.description && l.description.includes("배당")))
      .forEach((l) => {
        const month = l.date.slice(0, 7);
        monthTotals.set(month, (monthTotals.get(month) ?? 0) + l.amount);
      });
    const sorted = Array.from(monthTotals.entries())
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[0].localeCompare(a[0]));
    if (sorted.length === 0) return { month: "", amount: 0 };
    const [month, amount] = sorted[0];
    return { month, amount };
  }, [ledger]);

  // 배당 추적 위젯: 선택된 티커의 월별 배당 및 배당율
  const dividendTrackingMonthly = useMemo(() => {
    if (!dividendTrackingTicker || !dividendTrackingTicker.trim()) return [];
    const TICKER = dividendTrackingTicker.trim();
    const TICKER_CANON = canonicalTickerForMatch(TICKER);
    const isDividend458730 = (l: LedgerEntry) => {
      if (l.kind !== "income") return false;
      const hasDividend = (l.category && l.category.includes("배당")) || (l.subCategory && l.subCategory.includes("배당")) || (l.description && l.description.includes("배당"));
      if (!hasDividend) return false;
      const desc = l.description ?? "";
      const cat = l.category ?? "";
      const extracted = extractTickerFromText(desc) ?? extractTickerFromText(cat);
      if (!extracted) return desc.includes(TICKER) || cat.includes(TICKER);
      return canonicalTickerForMatch(extracted) === TICKER_CANON;
    };

    const byMonth = new Map<string, number>();
    for (const [month, entries] of index.ledgerByMonth) {
      const dividendSum = entries.filter(isDividend458730).reduce((s, l) => s + l.amount, 0);
      if (dividendSum > 0) byMonth.set(month, (byMonth.get(month) ?? 0) + dividendSum);
    }

    // 해당 월 말일까지의 458730 매수/매도 누적 → 비용기준(원금)
    const getSnapshotAtMonth = (month: string): { costBasis: number; shares: number } => {
      const endDate = `${month}-31`;
      const tickerTrades = trades
        .filter(
          (t) =>
            t.date &&
            t.date <= endDate &&
            canonicalTickerForMatch(t.ticker) === TICKER_CANON
        )
        .sort((a, b) => a.date.localeCompare(b.date));

      const byAccount = new Map<string, typeof tickerTrades>();
      tickerTrades.forEach((t) => {
        const list = byAccount.get(t.accountId) ?? [];
        list.push(t);
        byAccount.set(t.accountId, list);
      });

      let shares = 0;
      let costBasis = 0;
      byAccount.forEach((accountTrades) => {
        type Lot = { qty: number; cost: number };
        const lots: Lot[] = [];
        for (const t of accountTrades) {
          if (t.side === "buy") {
            lots.push({ qty: t.quantity, cost: t.totalAmount });
            continue;
          }
          let remaining = t.quantity;
          while (remaining > 0 && lots.length > 0) {
            const lot = lots[0];
            const useQty = Math.min(remaining, lot.qty);
            const unitCost = lot.cost / lot.qty;
            lot.qty -= useQty;
            lot.cost -= unitCost * useQty;
            remaining -= useQty;
            if (lot.qty <= 0) lots.shift();
          }
        }

        shares += lots.reduce((sum, lot) => sum + lot.qty, 0);
        costBasis += lots.reduce((sum, lot) => sum + lot.cost, 0);
      });

      return {
        costBasis: Math.max(0, costBasis),
        shares: Math.max(0, shares)
      };
    };

    // 해당 월 말일까지의 보유 수량
    const sorted = Array.from(byMonth.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-24);

    const prevMonth = (m: string): string => {
      const [y, mo] = m.split("-").map(Number);
      if (mo === 1) return `${y - 1}-12`;
      return `${y}-${String(mo - 1).padStart(2, "0")}`;
    };

    let cumulativeDividend = 0;
    return sorted.map(([month, dividend]) => {
      cumulativeDividend += dividend;
      const snapshot = getSnapshotAtMonth(month);
      const costBasis = snapshot.costBasis;
      const shares = snapshot.shares;
      const yieldMonthly = costBasis > 0 ? (dividend / costBasis) * 100 : 0;
      // TTM 배당률 = 최근 12개월 누적 배당금 ÷ 해당 월말 원금
      let ttmDividend = 0;
      let m = month;
      for (let i = 0; i < 12; i++) {
        ttmDividend += byMonth.get(m) ?? 0;
        m = prevMonth(m);
      }
      const yieldAnnual = costBasis > 0 ? (ttmDividend / costBasis) * 100 : 0;
      // 누적 배당 수익률: 투입금 대비 지금까지 받은 배당 합계
      const cumulativeYield = costBasis > 0 ? (cumulativeDividend / costBasis) * 100 : 0;
      // 주당 배당금(원/주), 주당 배당율(월배당율 %)
      const dividendPerShare = shares > 0 ? dividend / shares : 0;
      const yieldPerShare = yieldMonthly;
      return {
        month,
        dividend,
        costBasis,
        yieldMonthly,
        yieldAnnual,
        cumulativeDividend,
        cumulativeYield,
        dividendPerShare,
        yieldPerShare,
        shares
      };
    });
  }, [index.ledgerByMonth, ledger, trades, adjustedPrices, accounts, fxRate, dividendTrackingTicker]);

  // 배당 추적 위젯 데이터가 비어 있을 때 필터 통과 여부 디버깅
  useEffect(() => {
    if (!dividendTrackingTicker || dividendTrackingMonthly.length > 0) return;
    const TICKER = dividendTrackingTicker.trim();
    const TICKER_CANON = canonicalTickerForMatch(TICKER);
    const isDividendForTicker = (l: LedgerEntry) => {
      if (l.kind !== "income") return false;
      const hasDividend = (l.category && l.category.includes("배당")) || (l.subCategory && l.subCategory.includes("배당")) || (l.description && l.description.includes("배당"));
      if (!hasDividend) return false;
      const desc = l.description ?? "";
      const cat = l.category ?? "";
      const extracted = extractTickerFromText(desc) ?? extractTickerFromText(cat);
      if (!extracted) return desc.includes(TICKER) || cat.includes(TICKER);
      return canonicalTickerForMatch(extracted) === TICKER_CANON;
    };
    const passed = ledger.filter(isDividendForTicker);
    const withDividend = ledger.filter((l) => l.kind === "income" && ((l.category ?? "").includes("배당") || (l.subCategory ?? "").includes("배당") || (l.description ?? "").includes("배당")));
    console.log("[배당 추적 위젯] 배당 내역 없음. 필터 통과 건수:", passed.length, "/ 배당 수입 전체:", withDividend.length, "건. 통과한 항목 샘플:", passed.slice(0, 3));
  }, [ledger, dividendTrackingMonthly.length, dividendTrackingTicker]);

  // 이번달 배당금
  const monthlyDividend = useMemo(() => {
    const monthEntries = index.ledgerByMonth.get(thisMonth) ?? [];
    return monthEntries
      .filter((l) => l.kind === "income")
      .filter(
        (l) =>
          (l.category && l.category.includes("배당")) ||
          (l.subCategory && l.subCategory.includes("배당")) ||
          (l.description && l.description.includes("배당"))
      )
      .reduce((s, l) => s + l.amount, 0);
  }, [index.ledgerByMonth, thisMonth]);
  
  // 배당금 커버리지 비율: 가장 최근 달 배당금 ÷ 월평균 고정비
  const dividendCoverageRatio = useMemo(() => {
    if (monthlyAvgFixedExpense <= 0 || latestMonthDividend.amount <= 0) return 0;
    return (latestMonthDividend.amount / monthlyAvgFixedExpense) * 100;
  }, [latestMonthDividend.amount, monthlyAvgFixedExpense]);

  // 주식 비율 트리맵 데이터
  // 중요: positions의 totalBuyAmount는 netBuyAmount이므로, 실제 총매입금액을 직접 계산해야 함
  // 성능 최적화: trades를 미리 그룹화하여 반복 필터링 방지
  // Keep dashboard PnL aligned with computePositions net cost basis.
  
  const positionsWithPrice = useMemo(() => {
    return positions
      .filter((p) => p.quantity > 0)
      .map((p) => {
        const priceInfo = adjustedPrices.find((x) => x.ticker === p.ticker);
        const marketPrice = priceInfo?.price ?? p.marketPrice ?? 0;
        const marketValue = (marketPrice || 0) * (p.quantity || 0);
        
        // 실제 총매입금액 계산: 미리 그룹화된 맵에서 조회
        const actualTotalBuyAmount = p.totalBuyAmount;
        
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
  }, [positions, adjustedPrices]);

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

  // 목표 포트폴리오 vs 실제 비중 차트 데이터 (주식 탭과 동일 로직: 전체 계좌, marketValue는 이미 KRW)
  const targetPortfolioChartData = useMemo(() => {
    const target = targetPortfolios.find((t) => t.accountId === null && t.items.length > 0) ?? targetPortfolios.find((t) => t.items.length > 0);
    if (!target || target.items.length === 0 || positionsWithPrice.length === 0) return [];
    // positionsWithPrice의 marketValue는 adjustedPrices 기준이라 이미 KRW
    const totalMarketValueKRW = positionsWithPrice.reduce((sum, p) => sum + (p.marketValue ?? 0), 0);
    if (totalMarketValueKRW <= 0) return [];

    return target.items.map((item) => {
      const currentValueKRW = positionsWithPrice
        .filter((p) => normTicker(p.ticker) === normTicker(item.ticker))
        .reduce((s, p) => s + (p.marketValue ?? 0), 0);
      const currentPercent = totalMarketValueKRW > 0 ? (currentValueKRW / totalMarketValueKRW) * 100 : 0;
      const priceInfo = adjustedPrices.find((x) => normTicker(x.ticker) === normTicker(item.ticker));
      const baseName = priceInfo?.name ?? item.ticker;
      const displayName = item.alias?.trim() || baseName;
      const name = displayName.length > 12 ? `${displayName.slice(0, 11)}…` : displayName;
      return {
        name,
        ticker: item.ticker,
        target: item.targetPercent,
        actual: Math.round(currentPercent * 10) / 10,
        달성도: item.targetPercent > 0 ? Math.round((currentPercent / item.targetPercent) * 100) : 0
      };
    });
  }, [targetPortfolios, positionsWithPrice, adjustedPrices]);
  
  // 종목 집중도 경고: 특정 종목 비중이 15% 이상인 경우
  const concentrationWarnings = useMemo(() => {
    return stockWeightByTicker
      .filter((item) => item.ratio >= 15 && item.ticker !== "기타")
      .map((item) => ({
        ...item,
        warningLevel: item.ratio >= 20 ? "high" : "medium" // 20% 이상은 높은 경고
      }));
  }, [stockWeightByTicker]);
  
  // MDD (최대 낙폭): 월별 데이터 기준
  const maxDrawdown = useMemo(() => {
    if (netWorthSeries.length === 0) return { value: 0, period: null };
    
    let peak = netWorthSeries[0].netWorth;
    let maxDD = 0;
    let maxDDPeriod: { start: string; end: string } | null = null;
    let currentDrawdownStart: string | null = null;
    
    for (const point of netWorthSeries) {
      if (point.netWorth > peak) {
        peak = point.netWorth;
        currentDrawdownStart = null;
      } else {
        const drawdown = ((peak - point.netWorth) / peak) * 100;
        if (drawdown > maxDD) {
          maxDD = drawdown;
          if (!currentDrawdownStart) {
            currentDrawdownStart = netWorthSeries.find((p) => p.netWorth === peak)?.month ?? point.month;
          }
          maxDDPeriod = {
            start: currentDrawdownStart,
            end: point.month
          };
        }
      }
    }
    
    return {
      value: maxDD,
      period: maxDDPeriod
    };
  }, [netWorthSeries]);

  // 전체 자산 변동: 2025-07-01 ~ 2025-12-15 고정 표, 2026-01-01부터 실제 계산
  const dailyAssetData = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split("T")[0];
    const startStr = "2025-01-01";
    const firstDate = new Date(startStr);
    const selectedDates: string[] = [];
    const currentDate = new Date(firstDate);
    while (currentDate <= today) {
      const d = currentDate.getDate();
      if (d === 1 || d === 15) selectedDates.push(currentDate.toISOString().split("T")[0]);
      currentDate.setDate(currentDate.getDate() + 1);
    }
    if (!selectedDates.includes(todayStr)) selectedDates.push(todayStr);

    return selectedDates.map((date) => {
      // 2025-07-01 이전: 0원
      if (date < FIRST_CURVE_DATE) {
        return { date, totalAsset: 0 };
      }
      // 2025-07-01 ~ 2025-12-15: 고정 표 값
      if (date in targetNetWorthCurve) {
        return { date, totalAsset: targetNetWorthCurve[date] };
      }
      // 2025-12-16 ~ 2025-12-31: 마지막 값 유지
      if (date > LAST_CURVE_DATE && date < CALC_START_DATE) {
        const lastCurveVal = targetNetWorthCurve[LAST_CURVE_DATE] ?? 0;
        return { date, totalAsset: lastCurveVal };
      }
      // 2026-01-01 이후: computeTotalNetWorth와 동일한 계산 (현금·USD·주식·부채 일관 적용)
      if (date >= CALC_START_DATE) {
        const filteredTrades = trades.filter((t) => t.date && t.date <= date);
        const filteredLedger = ledger.filter((l) => l.date && l.date <= date);

        const filteredPositions = computePositions(filteredTrades, adjustedPrices, accounts, { fxRate: fxRate ?? undefined });
        const filteredBalances = computeAccountBalances(accounts, filteredLedger, filteredTrades);

        const totalAsset = computeTotalNetWorth(
          filteredBalances,
          filteredPositions,
          fxRate ?? undefined
        );
        return { date, totalAsset };
      }
      return { date, totalAsset: 0 };
    });
  }, [trades, adjustedPrices, accounts, ledger, targetNetWorthCurve]);


  // 에러 방지: 데이터가 없거나 잘못된 경우 빈 배열 반환
  const safePositionsWithPrice = positionsWithPrice || [];
  const safeDailyAssetData = dailyAssetData || [];

  // 1. 상위/하위 수익 종목 TOP 10
  const topStocks = useMemo(() => {
    const sorted = [...safePositionsWithPrice].sort((a, b) => b.pnl - a.pnl);
    return sorted.slice(0, 10).map((p, index) => ({
      rank: index + 1,
      ticker: p.ticker,
      name: p.name || p.ticker,
      pnl: p.pnl,
      pnlRate: p.pnlRate * 100,
      marketValue: p.marketValue
    }));
  }, [safePositionsWithPrice]);

  const bottomStocks = useMemo(() => {
    const sorted = [...safePositionsWithPrice].sort((a, b) => a.pnl - b.pnl);
    return sorted.slice(0, 10).map((p, index) => ({
      rank: index + 1,
      ticker: p.ticker,
      name: p.name || p.ticker,
      pnl: p.pnl,
      pnlRate: p.pnlRate * 100,
      marketValue: p.marketValue
    }));
  }, [safePositionsWithPrice]);

  // 2. 시간별 포트폴리오 가치 추이 (2025-07부터)
  const portfolioValueHistory = useMemo(() => {
    const dateSet = new Set<string>();
    trades.forEach((t) => {
      if (t.date) dateSet.add(t.date);
    });
    const dates = Array.from(dateSet).sort();
    if (dates.length === 0) return [];

    const lastDayOfMonth: Record<string, number> = { "01": 31, "02": 28, "03": 31, "04": 30, "05": 31, "06": 30, "07": 31, "08": 31, "09": 30, "10": 31, "11": 30, "12": 31 };
    const toDate = (ym: string, day: number) => `${ym}-${String(day).padStart(2, "0")}`;
    const monthsBetween = (start: string, end: string) => {
      const out: string[] = [];
      let [y, m] = start.split("-").map(Number);
      const [ey, em] = end.split("-").map(Number);
      while (y < ey || (y === ey && m <= em)) {
        out.push(`${y}-${String(m).padStart(2, "0")}`);
        if (m === 12) { y++; m = 1; } else { m++; }
      }
      return out;
    };

    const maxMonth = dates[dates.length - 1]!.slice(0, 7);
    const sortedMonths = monthsBetween("2025-07", maxMonth);
    if (sortedMonths.length === 0) return [];

    const result: Array<{ date: string; totalValue: number; totalCost: number; pnl: number }> = [];

    sortedMonths.forEach((month) => {
      const [y, m] = month.split("-").map(Number);
      const last = lastDayOfMonth[String(m).padStart(2, "0")] ?? 31;
      const date = toDate(month, last);
      const filteredTrades = trades.filter((t) => t.date && t.date <= date);
      const filteredPositions = computePositions(filteredTrades, adjustedPrices, accounts, { fxRate: fxRate ?? undefined });
      const totalValue = filteredPositions.reduce((sum, p) => sum + (p.marketValue || 0), 0);
      const actualTotalCost = filteredTrades
        .filter((t) => t.side === "buy")
        .reduce((sum, t) => sum + t.totalAmount, 0);
      const pnl = totalValue - actualTotalCost;

      result.push({
        date,
        totalValue,
        totalCost: actualTotalCost,
        pnl: Math.max(0, pnl)
      });
    });

    return result;
  }, [trades, adjustedPrices, accounts]);


  return (
    <div>
      <div className="section-header">
        <h2>대시보드</h2>
        <button
          type="button"
          className="secondary"
          onClick={() => setWidgetSettingsOpen(true)}
          style={{ fontSize: 12, padding: "6px 12px" }}
        >
          위젯 설정
        </button>
      </div>
      {widgetSettingsOpen && (
        <div
          className="modal-backdrop"
          onClick={(e) => e.target === e.currentTarget && setWidgetSettingsOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="modal" style={{ maxWidth: 500 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>위젯 표시 및 순서</h3>
              <button type="button" onClick={() => setWidgetSettingsOpen(false)}>닫기</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>표시 여부를 선택하고, 순서는 위/아래로 변경할 수 있습니다.</p>
              {widgetOrder.map((id, index) => (
                <div
                  key={id}
                  style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}
                >
                  <input
                    type="checkbox"
                    id={`widget-${id}`}
                    checked={visibleWidgets.has(id)}
                    onChange={() => toggleWidget(id)}
                  />
                  <label htmlFor={`widget-${id}`} style={{ flex: 1 }}>{WIDGET_NAMES[id] ?? id}</label>
                  <button
                    type="button"
                    className="secondary"
                    style={{ padding: "4px 8px", fontSize: 11 }}
                    onClick={() => moveWidgetOrder(id, "up")}
                    disabled={index === 0}
                    title="위로"
                  >
                    위
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    style={{ padding: "4px 8px", fontSize: 11 }}
                    onClick={() => moveWidgetOrder(id, "down")}
                    disabled={index === widgetOrder.length - 1}
                    title="아래로"
                  >
                    아래
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column" }}>
      {visibleWidgets.has("summary") && (
        <div className="cards-row" style={{ order: widgetOrder.indexOf("summary") }}>
        <div className="card highlight">
          <div className="card-title">전체 순자산</div>
          <div className={`card-value ${totalNetWorth >= 0 ? "" : "negative"}`}>
            {Math.round(totalNetWorth).toLocaleString()} 원
          </div>
          {netWorthChangeAnalysis && (
            <div style={{ marginTop: 12, fontSize: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ color: "rgba(255, 255, 255, 0.85)" }}>
                  {netWorthChangeAnalysis.prevMonth} → {netWorthChangeAnalysis.currentMonth}
                </span>
                <span className={netWorthChangeAnalysis.change >= 0 ? "positive" : "negative"} style={{ fontWeight: 600 }}>
                  {netWorthChangeAnalysis.change >= 0 ? "+" : ""}{Math.round(netWorthChangeAnalysis.change).toLocaleString()}원
                  {netWorthChangeAnalysis.changePercent !== 0 && (
                    <span style={{ marginLeft: 4, fontSize: 11 }}>
                      ({netWorthChangeAnalysis.changePercent >= 0 ? "+" : ""}{netWorthChangeAnalysis.changePercent.toFixed(1)}%)
                    </span>
                  )}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.9)", lineHeight: 1.6, fontWeight: 500 }}>
                {netWorthChangeAnalysis.factors.periodIncome > 0 && (
                  <div>수입: <span style={{ color: "rgba(16, 185, 129, 1)", fontWeight: 600 }}>+{Math.round(netWorthChangeAnalysis.factors.periodIncome).toLocaleString()}원</span></div>
                )}
                {netWorthChangeAnalysis.factors.periodExpense > 0 && (
                  <div>지출: <span style={{ color: "rgba(244, 63, 94, 1)", fontWeight: 600 }}>-{Math.round(netWorthChangeAnalysis.factors.periodExpense).toLocaleString()}원</span></div>
                )}
                {netWorthChangeAnalysis.factors.periodSavingsExpense > 0 && (
                  <div>저축: <span style={{ color: "rgba(16, 185, 129, 0.9)", fontWeight: 600 }}>-{Math.round(netWorthChangeAnalysis.factors.periodSavingsExpense).toLocaleString()}원</span></div>
                )}
                {Math.abs(netWorthChangeAnalysis.factors.stockChange) > 1000 && (
                  <div>
                    주식: <span style={{ color: netWorthChangeAnalysis.factors.stockChange >= 0 ? "rgba(16, 185, 129, 1)" : "rgba(244, 63, 94, 1)", fontWeight: 600 }}>
                      {netWorthChangeAnalysis.factors.stockChange >= 0 ? "+" : ""}
                      {Math.round(netWorthChangeAnalysis.factors.stockChange).toLocaleString()}원
                    </span>
                  </div>
                )}
                {Math.abs(netWorthChangeAnalysis.factors.cashChange) > 1000 && (
                  <div>
                    현금: <span style={{ color: netWorthChangeAnalysis.factors.cashChange >= 0 ? "rgba(16, 185, 129, 1)" : "rgba(244, 63, 94, 1)", fontWeight: 600 }}>
                      {netWorthChangeAnalysis.factors.cashChange >= 0 ? "+" : ""}
                      {Math.round(netWorthChangeAnalysis.factors.cashChange).toLocaleString()}원
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-title">이번달 총수입</div>
          <div className="card-value positive">{Math.round(monthlyIncome).toLocaleString()} 원</div>
        </div>
        <div className="card">
          <div className="card-title">이번달 순소비</div>
          <div className="card-value negative">{Math.round(monthlyNetConsumption).toLocaleString()} 원</div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>
            (저축·투자·원금상환 제외)
          </div>
        </div>
        <div className="card">
          <div className="card-title">저축액</div>
          <div className="card-value positive">{Math.round(monthlySavingsExpense).toLocaleString()} 원</div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>
            저축성지출
          </div>
        </div>
        <div className="card">
          <div className="card-title">비상금 지수</div>
          <div className={`card-value ${emergencyFundIndex >= 6 ? "positive" : emergencyFundIndex >= 3 ? "" : "negative"}`}>
            {emergencyFundIndex.toFixed(1)}개월
          </div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>
            현금성자산 ÷ 평균순소비(3M)
          </div>
        </div>
        {return2025 != null && (
          <div className="card">
            <div className="card-title">2025 수익 (1/1~12/31, 넣은 돈 대비)</div>
            <div className={`card-value ${return2025.profit >= 0 ? "positive" : "negative"}`}>
              {return2025.profit >= 0 ? "+" : ""}{Math.round(return2025.profit).toLocaleString()}원
            </div>
            <div style={{ fontSize: 13, marginTop: 4 }}>
              {return2025.pct != null ? (
                <span className={return2025.pct >= 0 ? "positive" : "negative"}>
                  {return2025.pct >= 0 ? "+" : ""}{return2025.pct.toFixed(2)}%
                </span>
              ) : (
                <span style={{ color: "var(--text-muted)" }}>수익률 -</span>
              )}
              <span style={{ color: "var(--text-muted)", marginLeft: 8 }}>
                넣은 돈 {Math.round(return2025.invested).toLocaleString()}원 → {return2025.endLabel} {Math.round(return2025.endValue).toLocaleString()}원
              </span>
            </div>
          </div>
        )}
      </div>
      )}

      {visibleWidgets.has("assets") && (
        <div className="cards-row" style={{ order: widgetOrder.indexOf("assets") }}>
          <div className="card" style={{ gridColumn: "span 1" }}>
            <h3 style={{ margin: "0 0 10px 0", fontSize: 16 }}>자산 구성</h3>
          <div style={{ width: "100%", height: 240, position: "relative", minHeight: 240, minWidth: 0, display: "block" }}>
            {assetSegments.length > 0 ? (
            <ResponsiveContainer width="100%" height={240} minHeight={240} minWidth={0}>
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
                    value={Math.round(totalAssetForPie / 10000) + "만원"}
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
            ) : (
              <p className="hint">데이터 없음</p>
            )}
          </div>
          <div className="hint" style={{ marginTop: 8, textAlign: "center" }}>
            순자산: {Math.round(totalNetWorth).toLocaleString()}원
          </div>
          </div>
          
        </div>
      )}

      {visibleWidgets.has("income") && (
        <div className="cards-row" style={{ order: widgetOrder.indexOf("income") }}>
          <div className="card">
            <div className="card-title">고정비 vs 변동비 비중</div>
            <div style={{ width: "100%", height: 180, marginTop: 10, minHeight: 180, minWidth: 0, display: "block" }}>
              {monthlyFixedVariableExpense.total > 0 ? (
                <ResponsiveContainer width="100%" height={180} minHeight={180} minWidth={0}>
                  <BarChart layout="vertical" data={[
                    { name: "고정비", value: monthlyFixedVariableExpense.fixedExpense, ratio: monthlyFixedVariableExpense.fixedRatio },
                    { name: "변동비", value: monthlyFixedVariableExpense.variableExpense, ratio: monthlyFixedVariableExpense.variableRatio }
                  ]} margin={{ left: 50, right: 10 }}>
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" width={45} fontSize={11} />
                    <Tooltip 
                      formatter={(val: any, name: any, props: any) => [
                        Math.round(Number(val || 0)).toLocaleString() + " 원",
                        `${props.payload.name} (${props.payload.ratio.toFixed(1)}%)`
                      ]} 
                    />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={30}>
                      <Cell fill="#6366f1" /> {/* 고정비 */}
                      <Cell fill="#f43f5e" /> {/* 변동비 */}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="hint">데이터 없음</p>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-title">월평균 고정비</div>
            <div style={{ padding: "20px 10px" }}>
              <div style={{ fontSize: 28, fontWeight: "bold", color: "var(--text)", textAlign: "center" }}>
                {Math.round(monthlyAvgFixedExpense).toLocaleString()}원
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4, textAlign: "center" }}>
                최근 12개월 평균
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, textAlign: "center" }}>
                이번 달 고정비: {Math.round(monthlyFixedVariableExpense.fixedExpense).toLocaleString()}원
              </div>
              {monthlyAvgFixedExpenseData.breakdown.length > 0 && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--text-secondary)" }}>
                  <div style={{ marginBottom: 6, fontWeight: 600 }}>고정비 내역</div>
                  {monthlyAvgFixedExpenseData.breakdown.map(({ category, amount }) => (
                    <div key={category} style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                      <span>{category}</span>
                      <span>{Math.round(amount).toLocaleString()}원</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-title">배당금 커버리지 비율</div>
            <div style={{ padding: "20px 10px", textAlign: "center" }}>
              <div style={{ fontSize: 32, fontWeight: "bold", marginBottom: 8, color: dividendCoverageRatio >= 100 ? "var(--color-positive)" : dividendCoverageRatio >= 50 ? "var(--color-warning)" : "var(--color-negative)" }}>
                {dividendCoverageRatio.toFixed(1)}%
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 12 }}>
                최근 달 배당금 ÷ 월평균 고정비
              </div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span>{latestMonthDividend.month || "최근 달"} 배당금:</span>
                  <span>{Math.round(latestMonthDividend.amount).toLocaleString()}원</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>월평균 고정비:</span>
                  <span>{Math.round(monthlyAvgFixedExpense).toLocaleString()}원</span>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">최근 12개월 배당금</div>
          <div style={{ width: "100%", height: 180, marginTop: 10, minHeight: 180, minWidth: 0, display: "block" }}>
            {monthlyDividendSeries.length > 0 ? (
              <ResponsiveContainer width="100%" height={180} minHeight={180} minWidth={0}>
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

          <div className="card">
            <div className="card-title">주말 VS 평일 소비 ({thisMonth})</div>
            <div style={{ width: "100%", height: 180, marginTop: 10, minHeight: 180, minWidth: 0, display: "block" }}>
              {weekendVsWeekday.total > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={120} minHeight={120} minWidth={0}>
                    <BarChart
                      data={[
                        { name: "평일", value: weekendVsWeekday.weekdayTotal, days: weekendVsWeekday.weekdayDays },
                        { name: "주말", value: weekendVsWeekday.weekendTotal, days: weekendVsWeekday.weekendDays }
                      ]}
                      layout="vertical"
                      margin={{ left: 40, right: 10, top: 4, bottom: 4 }}
                    >
                      <XAxis type="number" hide />
                      <YAxis dataKey="name" type="category" width={40} fontSize={12} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(val: any) => Math.round(Number(val || 0)).toLocaleString() + " 원"} />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={28}>
                        <Cell fill="#6366f1" />
                        <Cell fill="#f59e0b" />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <div style={{ display: "flex", justifyContent: "space-around", padding: "8px 12px 0", fontSize: 12, color: "var(--text-secondary)", borderTop: "1px solid var(--border)" }}>
                    <span>평일 {weekendVsWeekday.weekdayDays}일 · {Math.round(weekendVsWeekday.weekdayTotal).toLocaleString()}원</span>
                    <span>주말 {weekendVsWeekday.weekendDays}일 · {Math.round(weekendVsWeekday.weekendTotal).toLocaleString()}원</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-around", padding: "4px 12px 0", fontSize: 11, color: "var(--text-muted)" }}>
                    <span>일평균 {Math.round(weekendVsWeekday.weekdayAvg).toLocaleString()}원</span>
                    <span>일평균 {Math.round(weekendVsWeekday.weekendAvg).toLocaleString()}원</span>
                  </div>
                </>
              ) : (
                <p className="hint">이번 달 소비 데이터 없음</p>
              )}
            </div>
          </div>

        {/* 월별 소비 추이 차트 */}
        {monthlyExpenseByCategoryTimeSeries.length > 0 && expenseCategories.length > 0 ? (
          <>
            <div className="card" style={{ gridColumn: "span 2" }}>
              <div className="card-title">월별 카테고리별 소비 추이</div>
              <div style={{ width: "100%", height: 350, marginTop: 10, minHeight: 350, minWidth: 0, display: "block" }}>
                <ResponsiveContainer width="100%" height={350} minHeight={350} minWidth={0}>
                  <LineChart data={monthlyExpenseByCategoryTimeSeries} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
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
                      formatter={(value: any, name?: string) => [
                        Math.round(Number(value || 0)).toLocaleString() + " 원",
                        name ?? ""
                      ]}
                      labelFormatter={(label) => `${label}`}
                      contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}
                    />
                    <Legend 
                      verticalAlign="top" 
                      height={36} 
                      iconType="line"
                      wrapperStyle={{ fontSize: "11px" }}
                    />
                    {expenseCategories.map((category, index) => (
                      <Line
                        key={category}
                        type="monotone"
                        dataKey={category}
                        stroke={COLORS[index % COLORS.length]}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card" style={{ gridColumn: "span 2" }}>
              <div className="card-title">월별 카테고리별 소비 (누적)</div>
              <div style={{ width: "100%", height: 350, marginTop: 10, minHeight: 350, minWidth: 0, display: "block" }}>
                <ResponsiveContainer width="100%" height={350} minHeight={350} minWidth={0}>
                  <BarChart data={monthlyExpenseByCategoryTimeSeries} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
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
                      formatter={(value: any, name?: string) => [
                        Math.round(Number(value || 0)).toLocaleString() + " 원",
                        name ?? ""
                      ]}
                      labelFormatter={(label) => `${label}`}
                      contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}
                    />
                    <Legend 
                      verticalAlign="top" 
                      height={36} 
                      iconType="rect"
                      wrapperStyle={{ fontSize: "11px" }}
                    />
                    {expenseCategories.map((category, index) => (
                      <Bar
                        key={category}
                        dataKey={category}
                        stackId="expense"
                        fill={COLORS[index % COLORS.length]}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        ) : (
          monthlyExpenseByCategoryTimeSeries.length === 0 && (
            <div className="card" style={{ gridColumn: "span 2" }}>
              <div className="card-title">월별 소비 추이</div>
              <p className="hint" style={{ textAlign: "center", padding: 40 }}>
                월별 소비 데이터가 없습니다.
              </p>
            </div>
          )
        )}
      </div>
      )}

      {visibleWidgets.has("savingsFlow") && (
        <div className="cards-row" style={{ order: widgetOrder.indexOf("savingsFlow") }}>
          <div className="card" style={{ gridColumn: "span 2" }}>
            <div className="card-title">저축·투자 기간별 현황</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
              원금 = 기간 내 순유입(저축성 지출 + 이체 입금 − 이체 출금). 누적원금 = 데이터 최초 시점부터 해당 기간 말까지의 원금 누적. 평가상승 = 기간 말 미실현손익 − 기간 초 미실현손익. 수익 = 매도차익 + 배당 + 이자 + 평가상승. 잔액·매입원가는 해당 시점 기준(현재가 적용).
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {(["month", "quarter", "year"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={savingsFlowPeriodType === t ? "primary" : "secondary"}
                  style={{ padding: "6px 12px", fontSize: 12 }}
                  onClick={() => setSavingsFlowPeriodType(t)}
                >
                  {t === "month" ? "월" : t === "quarter" ? "분기" : "년"}
                </button>
              ))}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="table" style={{ minWidth: 680, fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>기간</th>
                    <th style={{ textAlign: "right" }}>원금</th>
                    <th style={{ textAlign: "right" }}>누적원금</th>
                    <th style={{ textAlign: "right" }}>매도차익</th>
                    <th style={{ textAlign: "right" }}>평가상승</th>
                    <th style={{ textAlign: "right" }}>이자</th>
                    <th style={{ textAlign: "right" }}>배당</th>
                    <th style={{ textAlign: "right" }}>수익</th>
                    <th style={{ textAlign: "right" }}>수익률</th>
                  </tr>
                </thead>
                <tbody>
                  {savingsFlowByPeriod.map((row) => (
                    <tr key={row.label}>
                      <td style={{ fontWeight: 500 }}>{row.label}</td>
                      <td className="number" style={{ textAlign: "right" }}>
                        {Math.round(row.principal).toLocaleString()}
                      </td>
                      <td className="number" style={{ textAlign: "right" }}>
                        {Math.round(row.cumulativePrincipal).toLocaleString()}
                      </td>
                      <td className="number" style={{ textAlign: "right", color: row.realizedGain >= 0 ? "var(--color-positive)" : "var(--color-negative)" }}>
                        {row.realizedGain >= 0 ? "+" : ""}{Math.round(row.realizedGain).toLocaleString()}
                      </td>
                      <td className="number" style={{ textAlign: "right", color: row.valuationGain >= 0 ? "var(--color-positive)" : "var(--color-negative)" }}>
                        {row.valuationGain >= 0 ? "+" : ""}{Math.round(row.valuationGain).toLocaleString()}
                      </td>
                      <td className="number" style={{ textAlign: "right", color: "var(--color-positive)" }}>
                        +{Math.round(row.interest).toLocaleString()}
                      </td>
                      <td className="number" style={{ textAlign: "right", color: "var(--color-positive)" }}>
                        +{Math.round(row.dividend).toLocaleString()}
                      </td>
                      <td className="number" style={{ textAlign: "right", fontWeight: 600, color: row.profit >= 0 ? "var(--color-positive)" : "var(--color-negative)" }}>
                        {row.profit >= 0 ? "+" : ""}{Math.round(row.profit).toLocaleString()}
                      </td>
                      <td className="number" style={{ textAlign: "right" }}>
                        {row.returnRate != null ? `${(row.returnRate * 100).toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {visibleWidgets.has("budget") && (
        <div className="cards-row" style={{ order: widgetOrder.indexOf("budget") }}>
          <div className="card">
            <div className="card-title">
              예산 요약
              {budgetOverCount > 0 && (
                <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, background: "var(--danger)", color: "white", padding: "2px 8px", borderRadius: 4 }}>
                  초과 {budgetOverCount}건
                </span>
              )}
            </div>
            <div style={{ padding: "12px 0" }}>
              {budgetUsage.length === 0 ? (
                <p className="hint">설정된 예산이 없습니다. 예산/반복 탭에서 추가하세요.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {budgetUsage.map((b) => (
                    <div key={b.id} style={{ fontSize: 13 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontWeight: 500 }}>{b.category}</span>
                        <span className="number" style={{ color: b.isOver ? "var(--danger)" : "var(--text-secondary)" }}>
                          {Math.round(b.spent).toLocaleString()} / {Math.round(b.limit).toLocaleString()}원
                          {b.isOver && " 초과"}
                        </span>
                      </div>
                      <div style={{ height: 6, background: "var(--surface-hover)", borderRadius: 3, overflow: "hidden" }}>
                        <div
                          style={{
                            width: `${Math.min(100, b.pct)}%`,
                            height: "100%",
                            background: b.isOver ? "var(--danger)" : b.pct >= 90 ? "var(--warning)" : "var(--primary)",
                            borderRadius: 3,
                            transition: "width 0.2s"
                          }}
                        />
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{b.pct.toFixed(0)}% 사용</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {visibleWidgets.has("stocks") && (
        <div className="cards-row" style={{ order: widgetOrder.indexOf("stocks") }}>
          <div className="card">
            <div className="card-title">주식 성과</div>
            <div style={{ padding: "12px 0" }}>
              {totalStockValue === 0 && totalRealizedPnlKRW === 0 ? (
                <p className="hint">주식 거래/매도 내역이 없습니다.</p>
              ) : (
                <>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>현재 보유 종목 평가손익</div>
                    <div style={{ fontSize: 20, fontWeight: 600, color: totalStockPnl >= 0 ? "var(--success)" : "var(--danger)" }}>
                      {totalStockPnl >= 0 ? "+" : ""}{Math.round(totalStockPnl).toLocaleString()}원
                    </div>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>매도 확정 손익 (FIFO)</div>
                    <div style={{ fontSize: 20, fontWeight: 600, color: totalRealizedPnlKRW >= 0 ? "var(--success)" : "var(--danger)" }}>
                      {totalRealizedPnlKRW >= 0 ? "+" : ""}{Math.round(totalRealizedPnlKRW).toLocaleString()}원
                    </div>
                  </div>
                  <div style={{ paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>총 손익 (평가 + 실현)</div>
                    <div style={{ fontSize: 18, fontWeight: 600, color: (totalStockPnl + totalRealizedPnlKRW) >= 0 ? "var(--success)" : "var(--danger)" }}>
                      {(totalStockPnl + totalRealizedPnlKRW) >= 0 ? "+" : ""}{Math.round(totalStockPnl + totalRealizedPnlKRW).toLocaleString()}원
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {visibleWidgets.has("targetPortfolio") && (
        <div className="cards-row" style={{ order: widgetOrder.indexOf("targetPortfolio") }}>
          <div className="card" style={{ gridColumn: "span 2" }}>
            <div className="card-title">목표 포트폴리오 · 목표 vs 실제 비중</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
              주식 탭에서 설정한 목표 포트폴리오(전체 계좌)와 현재 보유 비중을 비교합니다.
            </div>
            <div style={{ width: "100%", height: 240, minHeight: 240, minWidth: 0 }}>
              {targetPortfolioChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={targetPortfolioChartData} layout="vertical" margin={{ left: 50, right: 20, top: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                    <XAxis type="number" domain={[0, "auto"]} tickFormatter={(v) => `${v}%`} fontSize={11} />
                    <YAxis dataKey="name" type="category" width={90} fontSize={11} tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}
                      formatter={(value: number | undefined) => [`${value ?? 0}%`, ""]}
                      labelFormatter={(label, payload) => payload?.[0]?.payload?.ticker ? `${payload[0].payload.ticker} · ${label}` : label}
                    />
                    <Legend />
                    <Bar dataKey="target" name="목표 비중" fill="#94a3b8" radius={[0, 4, 4, 0]} barSize={12} />
                    <Bar dataKey="actual" name="실제 비중" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={12} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="hint" style={{ padding: 24 }}>
                  목표 포트폴리오가 없거나, 주식 보유가 없습니다. 주식 탭에서 목표를 설정하세요.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {visibleWidgets.has("portfolio") && (
        <div className="cards-row" style={{ order: widgetOrder.indexOf("portfolio") }}>
          <div className="card" style={{ gridColumn: "span 2" }}>
            <div className="card-title">전체 자산 변동 (매월 1일, 15일 기준) · 2025-07 이전 0원, 2026-01부터 계산</div>
            <div style={{ width: "100%", height: 350, marginTop: 10, minHeight: 350, minWidth: 0, display: "block" }}>
              {safeDailyAssetData.length > 0 ? (
              <ResponsiveContainer width="100%" height={350} minHeight={350} minWidth={0}>
                <LineChart data={safeDailyAssetData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
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
                  <Line 
                    type="monotone" 
                    dataKey="totalAsset" 
                    name="전체 자산"
                    stroke="#6366f1" 
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: "#6366f1" }}
                    activeDot={{ r: 6 }}
                  />
                  <Legend verticalAlign="top" height={36} iconType="line" wrapperStyle={{ top: -10 }} />
                </LineChart>
              </ResponsiveContainer>
              ) : (
                <p className="hint">데이터 없음</p>
              )}
            </div>
            
            {/* 표 추가 */}
            {safeDailyAssetData.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <h4 style={{ margin: "0 0 12px 0", fontSize: 14, fontWeight: 600 }}>전체 자산 변동 표 (매월 1일, 15일 기준) · 2025-07 이전 0원, 2026-01부터 계산</h4>
                <div style={{ overflowX: "auto" }}>
                  <table className="data-table compact" style={{ fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th style={{ width: "120px" }}>날짜</th>
                        <th className="number" style={{ width: "150px" }}>전체 자산</th>
                        <th className="number" style={{ width: "150px" }}>변동액</th>
                        <th className="number" style={{ width: "100px" }}>변동률</th>
                      </tr>
                    </thead>
                    <tbody>
                      {safeDailyAssetData.map((item, index) => {
                        const prevItem = index > 0 ? safeDailyAssetData[index - 1] : null;
                        const change = prevItem ? item.totalAsset - prevItem.totalAsset : 0;
                        const changeRate = prevItem && prevItem.totalAsset !== 0 
                          ? (change / prevItem.totalAsset) * 100 
                          : 0;
                        const date = new Date(item.date);
                        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                        
                        return (
                          <tr key={item.date}>
                            <td>{dateStr}</td>
                            <td className="number" style={{ fontWeight: 600 }}>
                              {formatKRW(item.totalAsset)}
                            </td>
                            <td className="number" style={{ 
                              color: change >= 0 ? "var(--success)" : "var(--danger)",
                              fontWeight: 600
                            }}>
                              {change >= 0 ? "+" : ""}{formatKRW(change)}
                            </td>
                            <td className="number" style={{ 
                              color: changeRate >= 0 ? "var(--success)" : "var(--danger)",
                              fontWeight: 600
                            }}>
                              {changeRate >= 0 ? "+" : ""}{changeRate.toFixed(2)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {visibleWidgets.has(WIDGET_ID_DIVIDEND_TRACKING) && (
        <div className="cards-row" style={{ order: widgetOrder.indexOf(WIDGET_ID_DIVIDEND_TRACKING) }}>
          <div className="card" style={{ gridColumn: "span 2" }}>
            <div className="card-title">
              {dividendTrackingTicker ? `${dividendTrackingTicker} 배당 추적 · 월별 배당율` : "배당 추적 (티커 선택)"}
            </div>
            {!dividendTrackingTicker ? (
              <p className="hint" style={{ textAlign: "center", padding: 40 }}>설정 탭에서 배당 추적할 티커를 선택하세요.</p>
            ) : (
            <>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
              월별 배당금 ÷ 해당 월말 원금 기준 · TTM 배당률 = 최근 12개월 누적 배당 ÷ 원금 · 누적 수익률 = 투입금 대비 지금까지 받은 배당 합계
            </div>
            {dividendTrackingMonthly.length > 0 ? (
              <>
                {(() => {
                  const last = dividendTrackingMonthly[dividendTrackingMonthly.length - 1];
                  return (
                    <div style={{ marginBottom: 12, padding: "10px 12px", background: "var(--surface-hover)", borderRadius: 8, fontSize: 13 }}>
                      <strong>보유</strong> {last.shares}주
                      {last.shares > 0 && (
                        <>
                          {" · "}
                          <strong>주당 배당금</strong> {Math.round(last.dividendPerShare).toLocaleString()}원/주
                          {" · "}
                          <strong>주당 배당율</strong> {last.yieldPerShare.toFixed(3)}%
                        </>
                      )}
                      {last.shares === 0 && (
                        <span style={{ color: "var(--text-muted)" }}> (주식 탭에서 {dividendTrackingTicker} 매수/매도 입력 시 표시)</span>
                      )}
                    </div>
                  );
                })()}
                {/* 주당 배당금 · 주당 배당율 그래프 */}
                <div style={{ marginBottom: 24 }}>
                  <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>주당 배당금 · 주당 배당율 (월별)</h4>
                  <div style={{ width: "100%", height: 180, minHeight: 180 }}>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={dividendTrackingMonthly} margin={{ top: 10, right: 50, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                        <XAxis dataKey="month" fontSize={11} tickFormatter={(v) => v.slice(5)} />
                        <YAxis
                          yAxisId="left"
                          fontSize={11}
                          tickFormatter={(v) => `${v.toFixed(2)}%`}
                          width={45}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          fontSize={11}
                          tickFormatter={(v) => `${Math.round(v)}원`}
                          width={50}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          formatter={(val: unknown, name?: string, props?: any) => {
                            const p = props?.payload;
                            const row = (Array.isArray(p) ? p[0] : p) as typeof dividendTrackingMonthly[0] | undefined;
                            if (!row) return [String(val ?? ""), name ?? ""];
                            if ((name ?? "") === "주당 배당율") {
                              return [`${row.yieldPerShare.toFixed(3)}%`, "주당 배당율"];
                            }
                            return [`${Math.round(row.dividendPerShare).toLocaleString()}원/주 (${row.shares}주)`, "주당 배당금"];
                          }}
                          labelFormatter={(label) => label}
                        />
                        <Bar
                          yAxisId="right"
                          dataKey="dividendPerShare"
                          fill="#10b981"
                          radius={[4, 4, 0, 0]}
                          barSize={20}
                          name="주당 배당금"
                        />
                        <Line
                          yAxisId="left"
                          type="monotone"
                          dataKey="yieldPerShare"
                          stroke="#6366f1"
                          strokeWidth={2}
                          dot={{ r: 3 }}
                          name="주당 배당율"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div style={{ width: "100%", height: 200, marginTop: 10, minHeight: 200 }}>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={dividendTrackingMonthly} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                      <XAxis dataKey="month" fontSize={11} tickFormatter={(v) => v.slice(5)} />
                      <YAxis 
                        yAxisId="left" 
                        fontSize={11} 
                        tickFormatter={(v) => `${v.toFixed(2)}%`}
                        width={45}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis 
                        yAxisId="right" 
                        orientation="right" 
                        fontSize={11} 
                        tickFormatter={(v) => `${Math.round(v / 1000)}천`}
                        width={50}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip 
                        formatter={(val: any, name?: string, props?: any) => {
                          const row = Array.isArray(props?.payload) ? props.payload[0] : props?.payload;
                          if (!row) return [val, name ?? ""];
                          if ((name ?? "") === "yield") {
                            return [`월 ${row.yieldMonthly.toFixed(3)}% / TTM ${row.yieldAnnual.toFixed(2)}%`, "배당율"];
                          }
                          if ((name ?? "") === "누적") {
                            return [`누적 수익률 ${row.cumulativeYield.toFixed(2)}%`, "누적 수익률"];
                          }
                          if ((name ?? "") === "배당금") {
                            const shares = row.shares ?? 0;
                            const perShare = shares > 0 ? ` · ${row.shares}주 보유, 주당 ${Math.round(row.dividendPerShare ?? 0).toLocaleString()}원` : "";
                            return [`${Math.round(val).toLocaleString()}원${perShare}`, "배당금"];
                          }
                          return [`${Math.round(val).toLocaleString()}원`, name ?? ""];
                        }}
                        labelFormatter={(label) => `${label}`}
                      />
                      <Bar yAxisId="right" dataKey="dividend" fill="#10b981" radius={[4, 4, 0, 0]} barSize={24} name="배당금" />
                      <Line yAxisId="left" type="monotone" dataKey="yieldAnnual" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} name="TTM 배당률 (%)" />
                      <Line yAxisId="left" type="monotone" dataKey="cumulativeYield" stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 3 }} name="누적" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ marginTop: 16, overflowX: "auto" }}>
                  <table className="data-table compact" style={{ fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>월</th>
                        <th className="number">배당금</th>
                        <th className="number" style={{ minWidth: 90 }}>주당 배당금</th>
                        <th className="number" style={{ minWidth: 64 }}>보유(주)</th>
                        <th className="number">주당 배당율</th>
                        <th className="number">원금(월말)</th>
                        <th className="number">TTM</th>
                        <th className="number">누적 배당금</th>
                        <th className="number">누적 수익률</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...dividendTrackingMonthly].reverse().map((row) => (
                        <tr key={row.month}>
                          <td>{row.month}</td>
                          <td className="number">{formatKRW(Math.round(row.dividend))}</td>
                          <td className="number" style={{ whiteSpace: "nowrap" }}>{row.shares > 0 ? `${Math.round(row.dividendPerShare).toLocaleString()}원/주` : "-"}</td>
                          <td className="number" style={{ whiteSpace: "nowrap" }}>{row.shares}주</td>
                          <td className="number">{row.yieldPerShare.toFixed(3)}%</td>
                          <td className="number">{formatKRW(Math.round(row.costBasis))}</td>
                          <td className="number positive">{row.yieldAnnual.toFixed(2)}%</td>
                          <td className="number">{formatKRW(Math.round(row.cumulativeDividend))}</td>
                          <td className="number positive" style={{ fontWeight: 600 }}>{row.cumulativeYield.toFixed(2)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="hint" style={{ textAlign: "center", padding: 40 }}>{dividendTrackingTicker} 배당 내역이 없습니다.</p>
            )}
            </>
            )}
          </div>
        </div>
      )}

      {visibleWidgets.has("isa") && (
        <div className="cards-row" style={{ order: widgetOrder.indexOf("isa") }}>
          <div className="card" style={{ gridColumn: "span 2" }}>
            <div className="card-title">ISA 포트폴리오 (목표 비중)</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
              {isaPortfolio.map((item) => `${item.label} ${item.weight}%`).join(" · ")}
            </div>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div style={{ width: 280, height: 280, minWidth: 280, minHeight: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={isaPortfolio.map((item) => ({ name: item.label, value: item.weight }))}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                      dataKey="value"
                      stroke="none"
                    >
                      {isaPortfolio.map((_, index) => (
                        <Cell key={`isa-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                      <Label
                        value="목표"
                        position="center"
                        fill="var(--text-muted)"
                        style={{ fontSize: 12 }}
                      />
                    </Pie>
                    <Tooltip
                      formatter={(value?: number) => [`${(value ?? 0)}%`, "목표 비중"]}
                      contentStyle={{ borderRadius: 8, border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}
                    />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <table className="data-table compact" style={{ fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th>구성</th>
                      <th className="number">목표</th>
                      <th>종목</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isaPortfolio.map((item, i) => (
                      <tr key={item.ticker}>
                        <td>
                          <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS[i % COLORS.length], marginRight: 6, verticalAlign: "middle" }} />
                          {item.label}
                        </td>
                        <td className="number">{item.weight}%</td>
                        <td style={{ fontSize: 11, color: "var(--text-muted)" }}>{item.name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 주식 포트폴리오 분석 */}
      {safePositionsWithPrice.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <h3 style={{ margin: "0 0 24px 0" }}>주식 포트폴리오 분석</h3>

          {/* MDD 표시 카드 */}
          {maxDrawdown.value > 0 && (
            <div className="card" style={{ border: "1px solid var(--border)", boxShadow: "none", padding: 16, marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h4 style={{ margin: "0 0 8px 0" }}>최대 낙폭 (MDD)</h4>
                  <div style={{ fontSize: 24, fontWeight: "bold", color: maxDrawdown.value >= 30 ? "#f43f5e" : maxDrawdown.value >= 20 ? "#f59e0b" : "var(--text)" }}>
                    {maxDrawdown.value.toFixed(2)}%
                  </div>
                </div>
                {maxDrawdown.period && (
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", textAlign: "right" }}>
                    <div>기간:</div>
                    <div>{maxDrawdown.period.start} ~ {maxDrawdown.period.end}</div>
                  </div>
                )}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 8 }}>
                전고점 대비 최대 하락률 (월별 기준)
              </div>
            </div>
          )}

          {/* 누적 투입금 대비 평가액: 넣은돈, 수익금(±), 평가금 */}
          <div className="card" style={{ border: "1px solid var(--border)", boxShadow: "none", padding: 16, marginBottom: 24 }}>
            <h4 style={{ margin: "0 0 12px 0", textAlign: "center" }}>누적 투입금 대비 평가액</h4>
            <div style={{ width: "100%", height: 300, minHeight: 300, minWidth: 0, display: "block" }}>
              {portfolioValueHistory.length > 0 ? (
                <ResponsiveContainer width="100%" height={300} minHeight={300} minWidth={0}>
                  <AreaChart data={portfolioValueHistory} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <defs>
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
                      tickFormatter={(v) => `${Math.round(v / 10000)}만`}
                      ticks={(() => {
                        const maxV = Math.max(0, ...portfolioValueHistory.flatMap((d) => [d.totalValue, d.totalCost]));
                        const cap = Math.ceil(maxV / 5000000) * 5000000 || 5000000;
                        const arr = [];
                        for (let t = 0; t <= cap; t += 5000000) arr.push(t);
                        return arr;
                      })()}
                      width={50}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      formatter={(value?: number) => formatKRW(value ?? 0)}
                      labelFormatter={(label) => label}
                      contentStyle={{ borderRadius: 8, border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}
                    />
                    <Area
                      type="monotone"
                      dataKey="totalCost"
                      name="투자금"
                      stackId="inv"
                      stroke="#0ea5e9"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorTotalCost)"
                    />
                    <Area
                      type="monotone"
                      dataKey="pnl"
                      name="수익"
                      stackId="inv"
                      stroke="#10b981"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorPnl)"
                    />
                    <Line
                      type="monotone"
                      dataKey="totalValue"
                      name="평가금"
                      stroke="#6366f1"
                      strokeWidth={2}
                      dot={false}
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

        </div>
      )}
      </div>

      {/* 재미있는 인사이트 섹션 */}
      <div style={{ marginTop: 32 }}>
        <h3 style={{ margin: "0 0 24px 0" }}>💡 재미있는 인사이트</h3>
        
        <div className="cards-row">
          {/* 이번 달 가장 많이 쓴 카테고리 */}
          {monthlyExpenseByCategory.length > 0 && (
            <div className="card">
              <div className="card-title">이번 달 가장 많이 쓴 항목</div>
              <div style={{ padding: "16px 0" }}>
                <div style={{ fontSize: 24, fontWeight: "bold", marginBottom: 8, color: "var(--primary)" }}>
                  {monthlyExpenseByCategory[0].name}
                </div>
                <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>
                  {Math.round(monthlyExpenseByCategory[0].value).toLocaleString()}원
                </div>
                {monthlyIncome > 0 && (
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    총수입의 {((monthlyExpenseByCategory[0].value / monthlyIncome) * 100).toFixed(1)}%
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 이번 달 평균 일일 소비 */}
          {monthlyNetConsumption > 0 && (
            <div className="card">
              <div className="card-title">이번 달 평균 일일 소비</div>
              <div style={{ padding: "16px 0" }}>
                <div style={{ fontSize: 24, fontWeight: "bold", marginBottom: 8, color: "var(--text)" }}>
                  {Math.round(monthlyNetConsumption / new Date().getDate()).toLocaleString()}원
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  순소비 {Math.round(monthlyNetConsumption).toLocaleString()}원 ÷ {new Date().getDate()}일
                </div>
              </div>
            </div>
          )}

          {/* 저축률 목표 달성 */}
          <div className="card">
            <div className="card-title">저축률 목표 달성</div>
            <div style={{ padding: "16px 0" }}>
              <div style={{ fontSize: 24, fontWeight: "bold", marginBottom: 8, color: savingsRate >= SAVINGS_RATE_GOAL ? "var(--success)" : savingsRate >= SAVINGS_RATE_GOAL * 0.5 ? "var(--warning)" : "var(--danger)" }}>
                {savingsRate.toFixed(1)}%
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                {savingsRate >= SAVINGS_RATE_GOAL ? "🎉 목표 달성!" : savingsRate >= SAVINGS_RATE_GOAL * 0.5 ? "👍 괜찮아요" : "💪 더 노력해요"}
              </div>
              {monthlyIncome > 0 && (
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
                  저축액: {Math.round(monthlySavingsExpense).toLocaleString()}원
                </div>
              )}
            </div>
          </div>

          {/* 비상금 지수 해석 */}
          <div className="card">
            <div className="card-title">비상금 지수</div>
            <div style={{ padding: "16px 0" }}>
              <div style={{ fontSize: 24, fontWeight: "bold", marginBottom: 8, color: emergencyFundIndex >= 6 ? "var(--success)" : emergencyFundIndex >= 3 ? "var(--warning)" : "var(--danger)" }}>
                {emergencyFundIndex.toFixed(1)}개월
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                {emergencyFundIndex >= 6 
                  ? "✅ 충분한 비상금" 
                  : emergencyFundIndex >= 3 
                    ? "⚠️ 보통 수준" 
                    : "🔴 비상금 부족"}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
                현금: {Math.round(totalCashValue).toLocaleString()}원
              </div>
            </div>
          </div>

          {/* 주식 수익률 */}
          {(totalStockValue > 0 || totalRealizedPnlKRW !== 0) && (
            <div className="card">
              <div className="card-title">주식 총 수익률</div>
              <div style={{ padding: "16px 0" }}>
                {totalStockValue > 0 && (
                  <>
                    <div style={{ fontSize: 24, fontWeight: "bold", marginBottom: 8, color: totalStockPnl >= 0 ? "var(--success)" : "var(--danger)" }}>
                      {totalStockReturnRate != null
                        ? `${totalStockReturnRate >= 0 ? "+" : ""}${totalStockReturnRate.toFixed(2)}%`
                        : "-"}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      평가손익: {totalStockPnl >= 0 ? "+" : ""}{Math.round(totalStockPnl).toLocaleString()}원
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
                      평가액: {Math.round(totalStockValue).toLocaleString()}원
                    </div>
                  </>
                )}
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: totalStockValue > 0 ? 8 : 0 }}>
                  실현손익(매도 확정): <span style={{ color: totalRealizedPnlKRW >= 0 ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>{totalRealizedPnlKRW >= 0 ? "+" : ""}{Math.round(totalRealizedPnlKRW).toLocaleString()}원</span>
                </div>
              </div>
            </div>
          )}

          {/* 배당금 커버리지 해석 */}
          {(latestMonthDividend.amount > 0 || monthlyDividend > 0) && (
            <div className="card">
              <div className="card-title">배당금 커버리지</div>
              <div style={{ padding: "16px 0" }}>
                <div style={{ fontSize: 24, fontWeight: "bold", marginBottom: 8, color: dividendCoverageRatio >= 100 ? "var(--success)" : dividendCoverageRatio >= 50 ? "var(--warning)" : "var(--text)" }}>
                  {dividendCoverageRatio.toFixed(1)}%
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  {dividendCoverageRatio >= 100 
                    ? "🎯 배당으로 고정비 충당 가능!" 
                    : dividendCoverageRatio >= 50 
                      ? "👍 절반 이상 커버" 
                      : "💪 더 투자하세요"}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
                  {latestMonthDividend.month ? `${latestMonthDividend.month} 배당` : "최근 달 배당"}: {Math.round(latestMonthDividend.amount).toLocaleString()}원
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 재미있는 사실들 */}
        <div className="cards-row" style={{ marginTop: 24 }}>
          {/* 이번 달 소비로 살 수 있는 것들 */}
          {monthlyNetConsumption > 0 && (
            <div className="card">
              <div className="card-title">💰 이번 달 소비로 살 수 있는 것</div>
              <div style={{ padding: "12px 0", fontSize: 13, lineHeight: 1.8 }}>
                {(() => {
                  const amount = monthlyNetConsumption;
                  const insights: string[] = [];
                  
                  // 아이폰 (150만원 기준)
                  if (amount >= 1500000) {
                    insights.push(`📱 아이폰 ${Math.floor(amount / 1500000)}대`);
                  }
                  // 맥북 (200만원 기준)
                  if (amount >= 2000000) {
                    insights.push(`💻 맥북 ${Math.floor(amount / 2000000)}대`);
                  }
                  // 커피 (5,000원 기준)
                  if (amount >= 5000) {
                    insights.push(`☕ 커피 ${Math.floor(amount / 5000)}잔`);
                  }
                  // 치킨 (20,000원 기준)
                  if (amount >= 20000) {
                    insights.push(`🍗 치킨 ${Math.floor(amount / 20000)}마리`);
                  }
                  // 영화 (15,000원 기준)
                  if (amount >= 15000) {
                    insights.push(`🎬 영화 ${Math.floor(amount / 15000)}편`);
                  }
                  
                  return insights.length > 0 ? (
                    <div>
                      {insights.map((insight, idx) => (
                        <div key={idx} style={{ marginBottom: 4 }}>{insight}</div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ color: "var(--text-muted)" }}>소비 데이터가 부족합니다</div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* 소비 트렌드 */}
          {monthlyExpenseByCategoryTimeSeries.length >= 2 && (
            <div className="card">
              <div className="card-title">📊 소비 트렌드</div>
              <div style={{ padding: "12px 0", fontSize: 13, lineHeight: 1.8 }}>
                {(() => {
                  const insights: string[] = [];
                  const lastMonth = monthlyExpenseByCategoryTimeSeries[monthlyExpenseByCategoryTimeSeries.length - 1];
                  const prevMonth = monthlyExpenseByCategoryTimeSeries[monthlyExpenseByCategoryTimeSeries.length - 2];
                  
                  if (lastMonth && prevMonth) {
                    expenseCategories.forEach(category => {
                      const last = (lastMonth[category] as number) || 0;
                      const prev = (prevMonth[category] as number) || 0;
                      if (prev > 0 && last > 0) {
                        const change = ((last - prev) / prev) * 100;
                        if (Math.abs(change) >= 20) {
                          insights.push(
                            `${category}: ${change >= 0 ? "↑" : "↓"} ${Math.abs(change).toFixed(0)}%`
                          );
                        }
                      }
                    });
                  }
                  
                  return insights.length > 0 ? (
                    <div>
                      {insights.map((insight, idx) => (
                        <div key={idx} style={{ marginBottom: 4 }}>{insight}</div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ color: "var(--text-muted)" }}>변화가 없거나 데이터가 부족합니다</div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* 재미있는 통계 */}
          <div className="card">
            <div className="card-title">🎯 재미있는 통계</div>
            <div style={{ padding: "12px 0", fontSize: 13, lineHeight: 1.8 }}>
              {(() => {
                const insights: string[] = [];
                
                // 저축률 해석
                if (savingsRate >= SAVINGS_RATE_GOAL) {
                  insights.push(`🌟 저축률 ${SAVINGS_RATE_GOAL}% 이상! 목표 달성`);
                } else if (savingsRate >= SAVINGS_RATE_GOAL * 0.5) {
                  insights.push(`👍 저축률 ${SAVINGS_RATE_GOAL}%에 근접 중`);
                } else {
                  insights.push("💪 저축률 개선 여지 있음");
                }
                
                // 비상금 해석
                if (emergencyFundIndex >= 12) {
                  insights.push("🛡️ 비상금 12개월 이상! 매우 안전");
                } else if (emergencyFundIndex < 3) {
                  insights.push("⚠️ 비상금 3개월 미만, 위험");
                }
                
                // 주식 수익률 해석
                if (totalStockReturnRate != null && totalStockValue > 0) {
                  const returnRate = totalStockReturnRate;
                  if (returnRate >= 20) {
                    insights.push("🚀 주식 수익률 20% 이상! 대박");
                  } else if (returnRate < -10) {
                    insights.push("📉 주식 손실 10% 이상, 리밸런싱 고려");
                  }
                }
                
                // 배당 커버리지 해석
                if (dividendCoverageRatio >= 100) {
                  insights.push("🎯 배당으로 고정비 100% 커버! 재정 자유");
                }
                
                // MDD 해석
                if (maxDrawdown.value >= 30) {
                  insights.push("⚠️ 최대 낙폭 30% 이상, 리스크 관리 필요");
                }
                
                return insights.length > 0 ? (
                  <div>
                    {insights.map((insight, idx) => (
                      <div key={idx} style={{ marginBottom: 4 }}>{insight}</div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: "var(--text-muted)" }}>통계 데이터가 부족합니다</div>
                );
              })()}
            </div>
          </div>

          {/* 목표 달성률 - 저축 목표: 월급의 70%. 저축 = 저축성지출에 포함된 항목들 */}
          <div className="card">
            <div className="card-title">🎯 이번 달 목표 달성률</div>
            <div style={{ padding: "12px 0", fontSize: 13, lineHeight: 1.8 }}>
              {(() => {
                const baseIncome = monthlySalary > 0 ? monthlySalary : monthlyIncome;
                const savingsGoal = baseIncome > 0 ? baseIncome * (SAVINGS_RATE_GOAL / 100) : 0;
                const currentSavings = monthlySavingsExpense;
                const savingsGoalRate = savingsGoal > 0 ? (currentSavings * 100) / savingsGoal : 0;
                const usedSalary = monthlySalary > 0;
                const usedPrevMonthSalary = usedSalary && monthlySalaryThisMonth === 0;
                return (
                  <div>
                    <div style={{ marginBottom: 8 }}>
                      {usedPrevMonthSalary && (
                        <p className="hint" style={{ marginBottom: 8, fontSize: 12 }}>
                          이번 달 급여가 아직 없어, 최근 급여 기준으로 목표를 계산했습니다.
                        </p>
                      )}
                      {!usedSalary && monthlyIncome > 0 && (
                        <p className="hint" style={{ marginBottom: 8, fontSize: 12 }}>
                          급여 입력이 없어 총수입 기준으로 목표를 계산했습니다.
                        </p>
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span>저축 목표 (월급 {SAVINGS_RATE_GOAL}%):</span>
                        <span>{Math.round(savingsGoal).toLocaleString()}원</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span>현재 저축:</span>
                        <span>{Math.round(currentSavings).toLocaleString()}원</span>
                      </div>
                      <div style={{
                        marginTop: 8,
                        padding: "8px",
                        borderRadius: "6px",
                        backgroundColor: savingsGoalRate >= 100 ? "var(--success-light)" : savingsGoalRate >= 50 ? "var(--warning-light)" : "var(--danger-light)",
                        textAlign: "center",
                        fontWeight: 600,
                        color: savingsGoalRate >= 100 ? "var(--success)" : savingsGoalRate >= 50 ? "var(--warning)" : "var(--danger)"
                      }}>
                        {savingsGoalRate.toFixed(0)}% 달성
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
