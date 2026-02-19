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
import type { Account, LedgerEntry, StockPrice, StockTrade, CategoryPresets, TargetPortfolio } from "../types";
import { computeAccountBalances, computeMonthlyNetWorth, computePositions } from "../calculations";
import { formatKRW } from "../utils/format";
import { isUSDStock, canonicalTickerForMatch } from "../utils/tickerUtils";
import { getCategoryType, isSavingsExpenseEntry } from "../utils/categoryUtils";
import { useFxRate } from "../hooks/useFxRate";
import { SAVINGS_RATE_GOAL, ISA_PORTFOLIO } from "../constants/config";
import { getThisMonthKST } from "../utils/dateUtils";

// 가계부 단일 소스: 저축성지출 판단 (LedgerView와 동일 로직)
const isSavingsExpense = (entry: LedgerEntry, accounts: Account[]) =>
  isSavingsExpenseEntry(entry, accounts);

interface Props {
  accounts: Account[];
  ledger: LedgerEntry[];
  trades: StockTrade[];
  prices: StockPrice[];
  categoryPresets: CategoryPresets;
  targetPortfolios?: TargetPortfolio[];
}

const COLORS = ["#0ea5e9", "#6366f1", "#f43f5e", "#10b981", "#f59e0b", "#8b5cf6"];

/** 목표 자산 곡선 (참고용). 2026-01-01 이전 구간 표시용. 이후는 실제 계산값 사용 */
const TARGET_NET_WORTH_CURVE: Record<string, number> = {
  "2025-07-01": 3_120_000,
  "2025-07-15": 3_940_516,
  "2025-08-01": 5_440_516,
  "2025-08-15": 6_220_885,
  "2025-09-01": 7_668_405,
  "2025-09-15": 9_039_432,
  "2025-10-01": 14_308_249,
  "2025-10-15": 15_044_538,
  "2025-11-01": 17_420_644,
  "2025-11-15": 19_026_463,
  "2025-12-01": 19_613_151,
  "2025-12-15": 20_333_151
};
const FIRST_CURVE_DATE = "2025-07-01";
const LAST_CURVE_DATE = "2025-12-15";
const LAST_CURVE_VALUE = TARGET_NET_WORTH_CURVE[LAST_CURVE_DATE] ?? 0;
/** 이 날짜부터 순자산은 실제 계산값 사용 (목표 곡선 미사용) */
const CALC_START_DATE = "2026-01-01";

const DEFAULT_WIDGET_ORDER = ["summary", "assets", "income", "stocks", "portfolio", "targetPortfolio", "458730", "isa"];
const WIDGET_NAMES: Record<string, string> = {
  summary: "요약 카드",
  assets: "자산 구성",
  income: "수입/지출",
  stocks: "주식 성과",
  portfolio: "포트폴리오",
  targetPortfolio: "목표 포트폴리오",
  "458730": "458730 배당율 (TIGER 미국배당다우존스)",
  isa: "ISA 포트폴리오"
};

function normTicker(t: string): string {
  return canonicalTickerForMatch(t);
}

export const DashboardView: React.FC<Props> = ({
  accounts,
  ledger,
  trades,
  prices,
  categoryPresets,
  targetPortfolios = []
}) => {
  const fxRate = useFxRate(); // useFxRate 훅 사용으로 중복 요청 제거
  
  // 위젯 표시/숨김 설정
  const [visibleWidgets, setVisibleWidgets] = useState<Set<string>>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("fw-dashboard-widgets");
        if (saved) return new Set(JSON.parse(saved));
      } catch {}
    }
    return new Set(["summary", "assets", "income", "stocks", "portfolio", "targetPortfolio", "458730", "isa"]);
  });

  // 위젯 순서 (표시 순서, localStorage에 저장)
  const [widgetOrder, setWidgetOrder] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("fw-dashboard-widget-order");
        if (saved) {
          const parsed = JSON.parse(saved) as string[];
          if (Array.isArray(parsed) && parsed.length === DEFAULT_WIDGET_ORDER.length) return parsed;
        }
      } catch {}
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

  // 전체 순자산 계산: 현금(KRW+USD) + 주식 + 저축 - 부채 (계좌 화면과 동일 로직)
  const totalNetWorth = useMemo(() => {
    return balances.reduce((sum, row) => {
      const krwCash = row.currentBalance;
      const stockAsset = stockMap.get(row.account.id) ?? 0;
      const debt = row.account.debt ?? 0;
      // 증권계좌 USD: usdBalance + usdTransferNet (계좌 화면과 동일)
      const usdCash = row.account.type === "securities"
        ? (row.account.usdBalance ?? 0) + (row.usdTransferNet ?? 0)
        : 0;
      const usdToKrw = fxRate && usdCash !== 0 ? usdCash * fxRate : 0;
      // currentBalance에 이미 account.savings 포함됨 → 별도 추가 시 이중 합산
      return sum + krwCash + usdToKrw + stockAsset - debt;
    }, 0);
  }, [balances, stockMap, fxRate]);

  const totalStockPnl = useMemo(() => positions.reduce((s, p) => s + p.pnl, 0), [positions]);
  const totalStockValue = useMemo(() => positions.reduce((s, p) => s + p.marketValue, 0), [positions]);
  
  // 현금 잔액: 입출금/증권/기타 계좌 (증권 USD 포함, 계좌 화면과 동일)
  const totalCashValue = useMemo(() => {
    return balances
      .filter((b) => b.account.type === "checking" || b.account.type === "securities" || b.account.type === "other")
      .reduce((s, b) => {
        const krw = b.currentBalance;
        const usd = b.account.type === "securities"
          ? (b.account.usdBalance ?? 0) + (b.usdTransferNet ?? 0)
          : 0;
        return s + krw + (fxRate && usd ? usd * fxRate : 0);
      }, 0);
  }, [balances, fxRate]);
  
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

  const thisMonth = useMemo(() => getThisMonthKST(), []);

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
      const prevPositions = computePositions(prevFilteredTrades, adjustedPrices, accounts);
      const prevStockMap = new Map<string, number>();
      prevPositions.forEach((p) => {
        const current = prevStockMap.get(p.accountId) ?? 0;
        prevStockMap.set(p.accountId, current + p.marketValue);
      });
      
      const prevCash = prevBalances.reduce((s, b) => s + b.currentBalance, 0);
      const prevStock = prevPositions.reduce((s, p) => s + p.marketValue, 0);
      const prevSavings = prevBalances
        .filter((b) => b.account.type === "savings")
        .reduce((s, b) => s + b.currentBalance, 0) + accounts.reduce((s, a) => s + (a.savings ?? 0), 0);
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
          return month > prevMonth && month <= currentMonth && l.kind === "expense" && !isSavingsExpense(l, accounts);
        })
        .reduce((s, l) => s + l.amount, 0);
      
      const periodSavingsExpense = ledger
        .filter(l => {
          const month = l.date.slice(0, 7);
          return month > prevMonth && month <= currentMonth && isSavingsExpense(l, accounts);
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
    const prevPositions = computePositions(prevFilteredTrades, adjustedPrices, accounts);
    
    const prevCash = prevBalances
      .filter((b) => b.account.type === "checking" || b.account.type === "securities" || b.account.type === "other")
      .reduce((s, b) => s + b.currentBalance, 0);
    const prevStock = prevPositions.reduce((s, p) => s + p.marketValue, 0);
    const prevSavings = prevBalances
      .filter((b) => b.account.type === "savings")
      .reduce((s, b) => s + b.currentBalance, 0) + accounts.reduce((s, a) => s + (a.savings ?? 0), 0);
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
        return month > prevMonth && month <= currentMonth && l.kind === "expense" && !isSavingsExpense(l, accounts);
      })
      .reduce((s, l) => s + l.amount, 0);
    
    const periodSavingsExpense = ledger
      .filter(l => {
        const month = l.date.slice(0, 7);
        return month > prevMonth && month <= currentMonth && isSavingsExpense(l, accounts);
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

  const monthlyIncome = useMemo(() => 
    ledger
      .filter((l) => l.kind === "income" && l.date.startsWith(thisMonth))
      .reduce((s, l) => s + l.amount, 0),
    [ledger, thisMonth]
  );

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
        if (l.kind === "expense" && !isSavingsExpense(l, accounts) && l.date.startsWith(thisMonth)) {
          return true;
        }
        return false;
      })
      .reduce((s, l) => s + l.amount, 0),
    [ledger, thisMonth, accounts]
  );
  
  // 이전 총지출 계산 (하위 호환성)
  const monthlyExpense = useMemo(() =>
    ledger
      .filter((l) => {
        if (l.kind === "expense" && l.date.startsWith(thisMonth)) return true;
        if (isSavingsExpense(l, accounts) && l.date.startsWith(thisMonth)) return true;
        return false;
      })
      .reduce((s, l) => s + l.amount, 0),
    [ledger, thisMonth, accounts]
  );
  
  // 이번달 저축성 지출 합계
  const monthlySavingsExpense = useMemo(() =>
    ledger
      .filter((l) => isSavingsExpense(l, accounts) && l.date.startsWith(thisMonth))
      .reduce((s, l) => s + l.amount, 0),
    [ledger, thisMonth, accounts]
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
          if (l.kind === "expense" && !isSavingsExpense(l, accounts) && l.date.startsWith(month)) {
            return true;
          }
          return false;
        })
        .reduce((s, l) => s + l.amount, 0);
    });
    
    const sum = monthlyAmounts.reduce((s, v) => s + v, 0);
    return sum / 3;
  }, [ledger, accounts]);
  
  // 비상금 지수: 현금성 자산 ÷ 최근 3개월 평균 순소비
  const emergencyFundIndex = useMemo(() => {
    if (avgNetConsumption3Months <= 0) return 0;
    return totalCashValue / avgNetConsumption3Months;
  }, [totalCashValue, avgNetConsumption3Months]);
  const monthlyExpenseByCategory = useMemo(() => {
    const map = new Map<string, number>();
    ledger
      .filter((l) => {
        if (l.kind === "expense" && l.date.startsWith(thisMonth)) return true;
        if (isSavingsExpense(l, accounts) && l.date.startsWith(thisMonth)) return true;
        return false;
      })
      .forEach((l) => {
        // 저축성지출의 경우 카테고리를 "저축성지출"로 통일
        const key = isSavingsExpense(l, accounts) ? "저축성지출" : (l.category || "기타");
        map.set(key, (map.get(key) ?? 0) + l.amount);
      });
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [ledger, thisMonth, accounts]);

  // 월별 카테고리별 소비 데이터 (대분류 기준, 최근 12개월)
  const monthlyExpenseByCategoryTimeSeries = useMemo(() => {
    const categoryMonthMap = new Map<string, Map<string, number>>();
    
    // 실제 지출(expense)과 저축성지출(transfer to savings/securities) 포함
    ledger
      .filter((l) => {
        // expense만 포함
        if (l.kind === "expense" && l.date) return true;
        // 저축성지출(transfer to savings/securities)도 포함
        if (isSavingsExpense(l, accounts) && l.date) return true;
        return false;
      })
      .forEach((l) => {
        const month = l.date.slice(0, 7);
        // 저축성지출의 경우 카테고리를 "저축성지출"로 통일, 그 외는 원래 카테고리 사용
        const category = isSavingsExpense(l, accounts) ? "저축성지출" : (l.category || "기타");
        
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
  }, [ledger, accounts]);

  // 월별 소분류 포함 소비 데이터
  const monthlyExpenseByCategoryDetail = useMemo(() => {
    const detailMonthMap = new Map<string, Map<string, number>>();
    
    // 실제 지출(expense)과 저축성지출(transfer to savings/securities) 포함
    ledger
      .filter((l) => {
        // expense만 포함
        if (l.kind === "expense" && l.date) return true;
        // 저축성지출(transfer to savings/securities)도 포함
        if (isSavingsExpense(l, accounts) && l.date) return true;
        return false;
      })
      .forEach((l) => {
        const month = l.date.slice(0, 7);
        // 저축성지출의 경우 카테고리를 "저축성지출"로 통일, 그 외는 원래 카테고리 사용
        const category = isSavingsExpense(l, accounts) ? "저축성지출" : (l.category || "기타");
        const subCategory = l.subCategory;
        const key = subCategory ? `${category} > ${subCategory}` : category;
        
        if (!detailMonthMap.has(key)) {
          detailMonthMap.set(key, new Map());
        }
        const monthMap = detailMonthMap.get(key)!;
        monthMap.set(month, (monthMap.get(month) ?? 0) + l.amount);
      });

    return detailMonthMap;
  }, [ledger]);

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
      .filter((l) => l.kind === "expense" && !isSavingsExpense(l, accounts) && l.date.startsWith(thisMonth))
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
  }, [ledger, thisMonth, accounts]);

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
      const monthPositions = computePositions(filteredTrades, adjustedPrices, accounts);
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
  }, [trades, adjustedPrices, accounts]);

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
        if (l.kind === "expense" && !isSavingsExpense(l, accounts) && l.date.startsWith(thisMonth)) {
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
      .filter((l) => l.kind === "expense" && !isSavingsExpense(l, accounts))
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
      .filter((l) => (l.category && l.category.includes("배당")) || (l.description && l.description.includes("배당")))
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

  // 458730 (TIGER 미국배당다우존스) 전용 월별 배당 및 배당율
  const dividend458730Monthly = useMemo(() => {
    const TICKER = "458730";
    const isDividend458730 = (l: LedgerEntry) =>
      l.kind === "income" &&
      ((l.category && l.category.includes("배당")) || (l.description && l.description.includes("배당"))) &&
      (l.description || "").includes(TICKER);

    const byMonth = new Map<string, number>();
    ledger.filter(isDividend458730).forEach((l) => {
      const month = l.date.slice(0, 7);
      byMonth.set(month, (byMonth.get(month) ?? 0) + l.amount);
    });

    // 해당 월 말일까지의 458730 매수/매도 누적 → 비용기준(원금)
    const getCostBasisAtMonth = (month: string): number => {
      const endDate = `${month}-31`;
      let buyTotal = 0;
      let sellTotal = 0;
      trades
        .filter((t) => canonicalTickerForMatch(t.ticker) === canonicalTickerForMatch(TICKER))
        .forEach((t) => {
          if (t.date > endDate) return;
          if (t.side === "buy") buyTotal += t.totalAmount;
          else if (t.side === "sell") sellTotal += t.totalAmount;
        });
      return Math.max(0, buyTotal - sellTotal);
    };

    // 해당 월 말일까지의 458730 보유 수량
    const getSharesAtMonth = (month: string): number => {
      const endDate = `${month}-31`;
      let qty = 0;
      trades
        .filter((t) => canonicalTickerForMatch(t.ticker) === canonicalTickerForMatch(TICKER))
        .forEach((t) => {
          if (t.date > endDate) return;
          if (t.side === "buy") qty += t.quantity;
          else if (t.side === "sell") qty -= t.quantity;
        });
      return Math.max(0, qty);
    };

    const sorted = Array.from(byMonth.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-24);

    let cumulativeDividend = 0;
    return sorted.map(([month, dividend]) => {
      cumulativeDividend += dividend;
      const costBasis = getCostBasisAtMonth(month);
      const shares = getSharesAtMonth(month);
      const yieldMonthly = costBasis > 0 ? (dividend / costBasis) * 100 : 0;
      const yieldAnnual = yieldMonthly * 12;
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
  }, [ledger, trades]);
  
  // 이번달 배당금
  const monthlyDividend = useMemo(() => {
    return ledger
      .filter((l) => l.kind === "income" && l.date.startsWith(thisMonth))
      .filter(
        (l) =>
          (l.category && l.category.includes("배당")) ||
          (l.description && l.description.includes("배당"))
      )
      .reduce((s, l) => s + l.amount, 0);
  }, [ledger, thisMonth]);
  
  // 배당금 커버리지 비율: 가장 최근 달 배당금 ÷ 월평균 고정비
  const dividendCoverageRatio = useMemo(() => {
    if (monthlyAvgFixedExpense <= 0 || latestMonthDividend.amount <= 0) return 0;
    return (latestMonthDividend.amount / monthlyAvgFixedExpense) * 100;
  }, [latestMonthDividend.amount, monthlyAvgFixedExpense]);

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

  // 목표 포트폴리오 vs 실제 비중 차트 데이터 (전체 계좌 기준)
  const targetPortfolioChartData = useMemo(() => {
    const target = targetPortfolios.find((t) => t.accountId === null && t.items.length > 0) ?? targetPortfolios.find((t) => t.items.length > 0);
    if (!target || target.items.length === 0 || positionsWithPrice.length === 0) return [];
    const rate = fxRate ?? 0;
    const totalMarketValueKRW = positionsWithPrice.reduce((sum, p) => {
      const isUSD = isUSDStock(p.ticker);
      return sum + (isUSD ? (p.marketValue ?? 0) * rate : (p.marketValue ?? 0));
    }, 0);
    if (totalMarketValueKRW <= 0) return [];

    return target.items.map((item) => {
      const currentValue = positionsWithPrice
        .filter((p) => normTicker(p.ticker) === normTicker(item.ticker))
        .reduce((s, p) => s + (p.marketValue ?? 0), 0);
      const isUSD = isUSDStock(item.ticker);
      const currentValueKRW = isUSD ? currentValue * rate : currentValue;
      const currentPercent = totalMarketValueKRW > 0 ? (currentValueKRW / totalMarketValueKRW) * 100 : 0;
      const priceInfo = adjustedPrices.find((x) => normTicker(x.ticker) === normTicker(item.ticker));
      const name = priceInfo?.name ?? item.ticker;
      return {
        name: name.length > 12 ? `${item.ticker}` : name,
        ticker: item.ticker,
        target: item.targetPercent,
        actual: Math.round(currentPercent * 10) / 10,
        달성도: item.targetPercent > 0 ? Math.round((currentPercent / item.targetPercent) * 100) : 0
      };
    });
  }, [targetPortfolios, positionsWithPrice, adjustedPrices, fxRate]);
  
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
      if (date in TARGET_NET_WORTH_CURVE) {
        return { date, totalAsset: TARGET_NET_WORTH_CURVE[date] };
      }
      // 2025-12-16 ~ 2025-12-31: 마지막 값 유지
      if (date > LAST_CURVE_DATE && date < CALC_START_DATE) {
        return { date, totalAsset: LAST_CURVE_VALUE };
      }
      // 2026-01-01 이후: 전체 순자산과 동일한 실제 계산 (초기잔액·저축·부채 포함)
      if (date >= CALC_START_DATE) {
        const filteredTrades = trades.filter((t) => t.date && t.date <= date);
        const filteredLedger = ledger.filter((l) => l.date && l.date <= date);

        const filteredPositions = computePositions(filteredTrades, adjustedPrices, accounts);
        const filteredBalances = computeAccountBalances(accounts, filteredLedger, filteredTrades);

        const stockMap = new Map<string, number>();
        filteredPositions.forEach((p) => {
          const cur = stockMap.get(p.accountId) ?? 0;
          stockMap.set(p.accountId, cur + (p.marketValue || 0));
        });

        const totalAsset = filteredBalances.reduce((sum, row) => {
          const cashAsset = row.currentBalance;
          const stockAsset = stockMap.get(row.account.id) ?? 0;
          const debt = row.account.debt ?? 0;
          const savings = row.account.savings ?? 0;
          return sum + cashAsset + stockAsset + savings - debt;
        }, 0);
        return { date, totalAsset };
      }
      return { date, totalAsset: 0 };
    });
  }, [trades, adjustedPrices, accounts, ledger]);


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
      const filteredPositions = computePositions(filteredTrades, adjustedPrices, accounts);
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
            ) : (
              <p className="hint">데이터 없음</p>
            )}
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

      {visibleWidgets.has("458730") && (
        <div className="cards-row" style={{ order: widgetOrder.indexOf("458730") }}>
          <div className="card" style={{ gridColumn: "span 2" }}>
            <div className="card-title">458730 TIGER 미국배당다우존스 · 월별 배당율</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
              월별 배당금 ÷ 해당 월말 원금 기준 · 연환산 = 월배당율 × 12 · 누적 수익률 = 투입금 대비 지금까지 받은 배당 합계
            </div>
            {dividend458730Monthly.length > 0 ? (
              <>
                {/* 주당 배당금 · 주당 배당율 그래프 */}
                <div style={{ marginBottom: 24 }}>
                  <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>주당 배당금 · 주당 배당율 (월별)</h4>
                  <div style={{ width: "100%", height: 180, minHeight: 180 }}>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={dividend458730Monthly} margin={{ top: 10, right: 50, left: 0, bottom: 0 }}>
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
                            const row = (Array.isArray(p) ? p[0] : p) as typeof dividend458730Monthly[0] | undefined;
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
                    <BarChart data={dividend458730Monthly} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
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
                          const row = props?.payload;
                          if (!row) return [val, name ?? ""];
                          if ((name ?? "") === "yield") {
                            return [`월 ${row.yieldMonthly.toFixed(3)}% / 연환산 ${row.yieldAnnual.toFixed(2)}%`, "배당율"];
                          }
                          if ((name ?? "") === "누적") {
                            return [`누적 수익률 ${row.cumulativeYield.toFixed(2)}%`, "누적 수익률"];
                          }
                          return [`${Math.round(val).toLocaleString()}원`, "배당금"];
                        }}
                        labelFormatter={(label) => `${label}`}
                      />
                      <Bar yAxisId="right" dataKey="dividend" fill="#10b981" radius={[4, 4, 0, 0]} barSize={24} name="배당금" />
                      <Line yAxisId="left" type="monotone" dataKey="yieldAnnual" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} name="연환산 배당율 (%)" />
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
                        <th className="number">주당 배당금</th>
                        <th className="number">보유</th>
                        <th className="number">주당 배당율</th>
                        <th className="number">원금(월말)</th>
                        <th className="number">연환산</th>
                        <th className="number">누적 배당금</th>
                        <th className="number">누적 수익률</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...dividend458730Monthly].reverse().map((row) => (
                        <tr key={row.month}>
                          <td>{row.month}</td>
                          <td className="number">{formatKRW(Math.round(row.dividend))}</td>
                          <td className="number">{row.shares > 0 ? `${Math.round(row.dividendPerShare).toLocaleString()}원/주` : "-"}</td>
                          <td className="number">{row.shares}주</td>
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
              <p className="hint" style={{ textAlign: "center", padding: 40 }}>458730 배당 내역이 없습니다.</p>
            )}
          </div>
        </div>
      )}

      {visibleWidgets.has("isa") && (
        <div className="cards-row" style={{ order: widgetOrder.indexOf("isa") }}>
          <div className="card" style={{ gridColumn: "span 2" }}>
            <div className="card-title">ISA 포트폴리오 (목표 비중)</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
              AI 20% · 우주항공 20% · 양자 20% · 배당 20% · 금 10% · 달러 10%
            </div>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div style={{ width: 280, height: 280, minWidth: 280, minHeight: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={ISA_PORTFOLIO.map((item) => ({ name: item.label, value: item.weight }))}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                      dataKey="value"
                      stroke="none"
                    >
                      {ISA_PORTFOLIO.map((_, index) => (
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
                    {ISA_PORTFOLIO.map((item, i) => (
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
          {totalStockValue > 0 && (
            <div className="card">
              <div className="card-title">주식 총 수익률</div>
              <div style={{ padding: "16px 0" }}>
                <div style={{ fontSize: 24, fontWeight: "bold", marginBottom: 8, color: totalStockPnl >= 0 ? "var(--success)" : "var(--danger)" }}>
                  {totalStockPnl >= 0 ? "+" : ""}{((totalStockPnl / (totalStockValue - totalStockPnl)) * 100).toFixed(2)}%
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  {totalStockPnl >= 0 ? "📈 수익" : "📉 손실"}: {Math.round(Math.abs(totalStockPnl)).toLocaleString()}원
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
                  평가액: {Math.round(totalStockValue).toLocaleString()}원
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
                if (totalStockPnl > 0 && totalStockValue > 0) {
                  const returnRate = (totalStockPnl / (totalStockValue - totalStockPnl)) * 100;
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
