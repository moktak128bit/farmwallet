import React, { useMemo, useState } from "react";
import type { Account, BudgetGoal, CategoryPresets, LedgerEntry, StockTrade, StockPrice } from "../types";
import { formatKRW, formatNumber } from "../utils/formatter";
import {
  WaterfallWidget,
  TopThreeBlocksWidget,
  SubscriptionAlertWidget,
  PortfolioBreakdownWidget,
  DividendCoverageInsightWidget,
  SavingsRateTrendWidget,
  InvestSimulatorWidget
} from "../features/insights/AdvancedInsights";
import {
  RealReturnWidget,
  GoalPlannerWidget,
  InvestCapacityWidget,
  TradeVsSpendWidget,
  ConcentrationWidget,
  type AdvancedWidgetProps
} from "../features/dashboard/AdvancedWidgets";

/* ------------------------------------------------------------------ */
/*  helpers                                                            */
/* ------------------------------------------------------------------ */

const monthOf = (d: string) => (d || "").slice(0, 7);

const isLivingExpense = (l: LedgerEntry) =>
  l.kind === "expense" &&
  l.category !== "신용결제" &&
  l.category !== "재테크" &&
  l.category !== "환전" &&
  l.currency !== "USD" &&
  Number(l.amount) > 0;

/** 이전 달 yyyy-mm 문자열 */
const prevMonth = (ym: string): string => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1); // month is 0-indexed
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** yyyy-mm 기준으로 n개월 전까지 배열 반환 (오래된 순) */
const lastNMonths = (ym: string, n: number): string[] => {
  const result: string[] = [];
  let cur = ym;
  for (let i = 0; i < n; i++) {
    result.unshift(cur);
    cur = prevMonth(cur);
  }
  return result;
};

/** Date 기준 요일 인덱스를 월=0 ... 일=6 으로 재매핑 */
const dowIndex = (dateStr: string): number => {
  const d = new Date(dateStr);
  const jsDay = d.getDay(); // 0=Sun
  return jsDay === 0 ? 6 : jsDay - 1; // Mon=0 ... Sun=6
};

const DOW_KR = ["월", "화", "수", "목", "금", "토", "일"] as const;

/* ------------------------------------------------------------------ */
/*  default month                                                      */
/* ------------------------------------------------------------------ */

function pickDefaultMonth(ledger: LedgerEntry[]): string {
  const months = ledger
    .filter((l) => l.kind === "expense" && l.date)
    .map((l) => monthOf(l.date))
    .filter(Boolean)
    .sort();
  return months.length ? months[months.length - 1] : new Date().toISOString().slice(0, 7);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface Props {
  accounts: Account[];
  ledger: LedgerEntry[];
  trades?: StockTrade[];
  prices?: StockPrice[];
  fxRate?: number;
  categoryPresets: CategoryPresets;
  budgetGoals?: BudgetGoal[];
}

export const InsightsView: React.FC<Props> = ({ accounts, ledger, trades = [], prices = [], fxRate = 1350, categoryPresets, budgetGoals: _goals }) => {
  const [month, setMonth] = useState<string>(() => pickDefaultMonth(ledger));
  const [activeTab, setActiveTab] = useState<"overview" | "spending" | "invest" | "insights">("overview");

  /* --- month options --- */
  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    ledger.forEach((l) => {
      if (l.date) set.add(monthOf(l.date));
    });
    const months = Array.from(set).sort((a, b) => b.localeCompare(a));
    return months.length ? months : [new Date().toISOString().slice(0, 7)];
  }, [ledger]);

  /* --- filtered entries --- */
  const livingEntries = useMemo(
    () => ledger.filter((l) => isLivingExpense(l) && monthOf(l.date) === month),
    [ledger, month]
  );

  const prevLivingEntries = useMemo(() => {
    const pm = prevMonth(month);
    return ledger.filter((l) => isLivingExpense(l) && monthOf(l.date) === pm);
  }, [ledger, month]);

  const totalLiving = useMemo(() => livingEntries.reduce((s, e) => s + Number(e.amount), 0), [livingEntries]);
  const prevTotalLiving = useMemo(
    () => prevLivingEntries.reduce((s, e) => s + Number(e.amount), 0),
    [prevLivingEntries]
  );

  const totalIncome = useMemo(
    () =>
      ledger
        .filter((l) => l.kind === "income" && monthOf(l.date) === month && Number(l.amount) > 0)
        .reduce((s, e) => s + Number(e.amount), 0),
    [ledger, month]
  );

  // 급여계 (급여+상여+수당)
  const salaryIncome = useMemo(() => {
    const salarySubCategories = ["급여", "상여", "수당"];
    return ledger
      .filter((l) => l.kind === "income" && monthOf(l.date) === month && salarySubCategories.includes(l.subCategory ?? ""))
      .reduce((s, e) => s + Number(e.amount), 0);
  }, [ledger, month]);

  // 누적 저축률(흐름) — 선택 월까지 기준
  const cumulativeStats = useMemo(() => {
    let cumIncome = 0;
    let cumLiving = 0;
    for (const l of ledger) {
      if (!l.date || monthOf(l.date) > month) continue;
      if (l.kind === "income" && Number(l.amount) > 0) cumIncome += Number(l.amount);
      if (isLivingExpense(l)) cumLiving += Number(l.amount);
    }
    const flowRate = cumIncome > 0 ? ((cumIncome - cumLiving) / cumIncome) * 100 : 0;
    return { cumIncome, cumLiving, flowRate };
  }, [ledger, month]);

  /* ================================================================ */
  /*  1. Spending Analogies                                           */
  /* ================================================================ */
  const analogies = useMemo(() => {
    const items: { icon: string; label: string; unit: string; price: number }[] = [
      { icon: "[C]", label: "커피", unit: "잔", price: 5500 },
      { icon: "[Ch]", label: "치킨", unit: "마리", price: 22000 },
      { icon: "[M]", label: "영화", unit: "편", price: 15000 },
      { icon: "[N]", label: "넷플릭스", unit: "월", price: 17000 },
      { icon: "[T]", label: "택시 기본요금", unit: "회", price: 4800 },
    ];
    return items.map((it) => ({
      ...it,
      count: totalLiving > 0 ? Math.floor(totalLiving / it.price) : 0,
      equiv: totalLiving,
    }));
  }, [totalLiving]);

  /* ================================================================ */
  /*  2. Category Trends                                              */
  /* ================================================================ */
  const categoryTrends = useMemo(() => {
    const thisMap = new Map<string, number>();
    const prevMap = new Map<string, number>();
    for (const e of livingEntries) {
      const cat = e.category || "기타";
      thisMap.set(cat, (thisMap.get(cat) ?? 0) + Number(e.amount));
    }
    for (const e of prevLivingEntries) {
      const cat = e.category || "기타";
      prevMap.set(cat, (prevMap.get(cat) ?? 0) + Number(e.amount));
    }
    const allCats = new Set([...thisMap.keys(), ...prevMap.keys()]);
    const rows: { category: string; thisMonth: number; lastMonth: number; change: number; pct: number }[] = [];
    for (const cat of allCats) {
      const tm = thisMap.get(cat) ?? 0;
      const lm = prevMap.get(cat) ?? 0;
      const change = tm - lm;
      const pct = lm > 0 ? (change / lm) * 100 : tm > 0 ? 100 : 0;
      rows.push({ category: cat, thisMonth: tm, lastMonth: lm, change, pct });
    }
    rows.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    return rows.slice(0, 8);
  }, [livingEntries, prevLivingEntries]);

  /* ================================================================ */
  /*  3. Spending Patterns (day of week)                              */
  /* ================================================================ */
  const spendingPatterns = useMemo(() => {
    const dowTotals = Array(7).fill(0) as number[];
    const dailyMap = new Map<string, number>();

    for (const e of livingEntries) {
      const idx = dowIndex(e.date);
      const amt = Number(e.amount);
      dowTotals[idx] += amt;
      dailyMap.set(e.date, (dailyMap.get(e.date) ?? 0) + amt);
    }

    const maxDow = Math.max(...dowTotals, 1);
    const dailyAmounts = Array.from(dailyMap.values());
    const avgDaily = dailyAmounts.length > 0 ? dailyAmounts.reduce((a, b) => a + b, 0) / dailyAmounts.length : 0;

    let mostExpensiveDay = "";
    let mostExpensiveAmount = 0;
    for (const [date, amt] of dailyMap) {
      if (amt > mostExpensiveAmount) {
        mostExpensiveDay = date;
        mostExpensiveAmount = amt;
      }
    }

    return {
      dowTotals,
      maxDow,
      avgDaily,
      mostExpensiveDay,
      mostExpensiveAmount,
    };
  }, [livingEntries]);

  /* ================================================================ */
  /*  4. Spending Score                                               */
  /* ================================================================ */
  const scoreData = useMemo(() => {
    // savings rate points (40)
    const savingsRate = totalIncome > 0 ? 1 - totalLiving / totalIncome : 0;
    let savingsPoints = 0;
    if (savingsRate >= 0.5) savingsPoints = 40;
    else if (savingsRate >= 0.3) savingsPoints = 30;
    else if (savingsRate >= 0.2) savingsPoints = 20;
    else if (savingsRate >= 0.1) savingsPoints = 10;

    // improvement points (30)
    let improvementPoints = 0;
    if (prevTotalLiving > 0 && totalLiving < prevTotalLiving) {
      const decreasePct = ((prevTotalLiving - totalLiving) / prevTotalLiving) * 100;
      improvementPoints = Math.min(30, Math.round(30 * (decreasePct / 20)));
    }

    // consistency points (30)
    const dailyMap = new Map<string, number>();
    for (const e of livingEntries) {
      dailyMap.set(e.date, (dailyMap.get(e.date) ?? 0) + Number(e.amount));
    }
    const dailyAmounts = Array.from(dailyMap.values());
    let consistencyPoints = 0;
    if (dailyAmounts.length >= 2) {
      const mean = dailyAmounts.reduce((a, b) => a + b, 0) / dailyAmounts.length;
      const variance = dailyAmounts.reduce((s, v) => s + (v - mean) ** 2, 0) / dailyAmounts.length;
      const stddev = Math.sqrt(variance);
      const cv = mean > 0 ? stddev / mean : 999;
      if (cv < 0.5) consistencyPoints = 30;
      else if (cv < 1.0) consistencyPoints = 20;
      else if (cv < 1.5) consistencyPoints = 10;
    } else if (dailyAmounts.length === 1) {
      consistencyPoints = 30; // only one spending day => perfectly consistent
    }

    const total = savingsPoints + improvementPoints + consistencyPoints;

    let grade: string;
    let comment: string;
    if (total >= 90) {
      grade = "A+"; comment = "완벽한 소비 습관이에요!";
    } else if (total >= 80) {
      grade = "A"; comment = "정말 잘 관리하고 있어요!";
    } else if (total >= 70) {
      grade = "B+"; comment = "꽤 좋은 소비 패턴이에요!";
    } else if (total >= 60) {
      grade = "B"; comment = "나쁘지 않아요, 조금만 더!";
    } else if (total >= 50) {
      grade = "C+"; comment = "개선의 여지가 있어요.";
    } else if (total >= 40) {
      grade = "C"; comment = "소비 조절이 필요해요.";
    } else {
      grade = "D"; comment = "지출을 돌아볼 시간이에요!";
    }

    return {
      total,
      grade,
      comment,
      savingsPoints,
      improvementPoints,
      consistencyPoints,
      savingsRate,
    };
  }, [totalLiving, prevTotalLiving, totalIncome, livingEntries]);

  /* ================================================================ */
  /*  5. Spending Pace Forecast                                       */
  /* ================================================================ */
  const paceForecast = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const today = new Date();
    const isCurrentMonth =
      today.getFullYear() === y && today.getMonth() + 1 === m;

    const daysInMonth = new Date(y, m, 0).getDate();
    const dayOfMonth = isCurrentMonth ? today.getDate() : daysInMonth;
    const dayRatio = dayOfMonth / daysInMonth;

    const projectedTotal = dayRatio > 0 ? totalLiving / dayRatio : 0;
    const vsLastMonth =
      prevTotalLiving > 0
        ? ((projectedTotal - prevTotalLiving) / prevTotalLiving) * 100
        : null;

    return { dayOfMonth, daysInMonth, dayRatio, projectedTotal, vsLastMonth };
  }, [month, totalLiving, prevTotalLiving]);

  /* ================================================================ */
  /*  6. Unusual Spending Detection                                    */
  /* ================================================================ */
  const unusualSpending = useMemo(() => {
    // build per-category averages over the past 3 months (excluding current)
    const months3 = lastNMonths(prevMonth(month), 3);
    const catHistory = new Map<string, number[]>();
    for (const e of ledger) {
      if (!isLivingExpense(e)) continue;
      const m = monthOf(e.date);
      if (!months3.includes(m)) continue;
      const cat = e.category || "기타";
      if (!catHistory.has(cat)) catHistory.set(cat, []);
      catHistory.get(cat)!.push(Number(e.amount));
    }
    const catAvg = new Map<string, number>();
    for (const [cat, amounts] of catHistory) {
      const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      catAvg.set(cat, avg);
    }

    const flagged: {
      entry: LedgerEntry;
      avg: number;
      ratio: number;
    }[] = [];

    for (const entry of livingEntries) {
      const cat = entry.category || "기타";
      const avg = catAvg.get(cat);
      if (avg == null || avg <= 0) continue;
      const ratio = Number(entry.amount) / avg;
      if (ratio >= 2) {
        flagged.push({ entry, avg, ratio });
      }
    }

    flagged.sort((a, b) => b.ratio - a.ratio);
    return flagged.slice(0, 5);
  }, [ledger, month, livingEntries]);

  /* ================================================================ */
  /*  7. Key Insights Summary                                          */
  /* ================================================================ */
  const keySummary = useMemo(() => {
    // savings rate
    const savingsRate =
      totalIncome > 0 ? 1 - totalLiving / totalIncome : null;

    // biggest category this month
    const catMap = new Map<string, number>();
    for (const e of livingEntries) {
      const cat = e.category || "기타";
      catMap.set(cat, (catMap.get(cat) ?? 0) + Number(e.amount));
    }
    let biggestCat = "";
    let biggestAmt = 0;
    for (const [cat, amt] of catMap) {
      if (amt > biggestAmt) {
        biggestCat = cat;
        biggestAmt = amt;
      }
    }
    const biggestCatPct = totalLiving > 0 ? (biggestAmt / totalLiving) * 100 : 0;

    // any category over 2x last month
    const prevCatMap = new Map<string, number>();
    for (const e of prevLivingEntries) {
      const cat = e.category || "기타";
      prevCatMap.set(cat, (prevCatMap.get(cat) ?? 0) + Number(e.amount));
    }
    const spikedCats: { cat: string; ratio: number }[] = [];
    for (const [cat, amt] of catMap) {
      const prev = prevCatMap.get(cat) ?? 0;
      if (prev > 0 && amt / prev >= 2) {
        spikedCats.push({ cat, ratio: amt / prev });
      }
    }
    spikedCats.sort((a, b) => b.ratio - a.ratio);

    return { savingsRate, biggestCat, biggestAmt, biggestCatPct, spikedCats };
  }, [totalLiving, totalIncome, livingEntries, prevLivingEntries]);

  /* ================================================================ */
  /*  8. Category Heatmap (last 6 months)                             */
  /* ================================================================ */
  const heatmapData = useMemo(() => {
    const months6 = lastNMonths(month, 6);

    // gather all living expenses across 6 months
    const catMonthMap = new Map<string, Map<string, number>>(); // cat -> (month -> amount)
    for (const e of ledger) {
      if (!isLivingExpense(e)) continue;
      const m = monthOf(e.date);
      if (!months6.includes(m)) continue;
      const cat = e.category || "기타";
      if (!catMonthMap.has(cat)) catMonthMap.set(cat, new Map());
      const mMap = catMonthMap.get(cat)!;
      mMap.set(m, (mMap.get(m) ?? 0) + Number(e.amount));
    }

    // top 8 categories by total
    const catTotals = Array.from(catMonthMap.entries()).map(([cat, mMap]) => {
      let total = 0;
      for (const v of mMap.values()) total += v;
      return { cat, total, mMap };
    });
    catTotals.sort((a, b) => b.total - a.total);
    const top8 = catTotals.slice(0, 8);

    // normalize per category
    const rows = top8.map(({ cat, mMap }) => {
      const values = months6.map((m) => mMap.get(m) ?? 0);
      const max = Math.max(...values, 1);
      return {
        category: cat,
        cells: months6.map((m, i) => ({
          month: m,
          amount: values[i],
          intensity: values[i] / max,
        })),
      };
    });

    return { months: months6, rows };
  }, [ledger, month]);

  /* ================================================================ */
  /*  9. KPI Summary                                                   */
  /* ================================================================ */
  const kpiData = useMemo(() => {
    const monthEntries = ledger.filter((l) => monthOf(l.date) === month);
    const income = monthEntries
      .filter((l) => l.kind === "income")
      .reduce((s, e) => s + Number(e.amount), 0);
    const expense = monthEntries
      .filter((l) => l.kind === "expense")
      .reduce((s, e) => s + Number(e.amount), 0);
    const savingsRate = income > 0 ? ((income - expense) / income) * 100 : 0;

    // previous month for comparison
    const pm = prevMonth(month);
    const prevEntries = ledger.filter((l) => monthOf(l.date) === pm);
    const prevIncome = prevEntries
      .filter((l) => l.kind === "income")
      .reduce((s, e) => s + Number(e.amount), 0);
    const prevExpense = prevEntries
      .filter((l) => l.kind === "expense")
      .reduce((s, e) => s + Number(e.amount), 0);

    const incomeChange = prevIncome > 0 ? ((income - prevIncome) / prevIncome) * 100 : null;
    const expenseChange = prevExpense > 0 ? ((expense - prevExpense) / prevExpense) * 100 : null;

    return { income, expense, savingsRate, incomeChange, expenseChange };
  }, [ledger, month]);

  /* ================================================================ */
  /*  10. Monthly Trend (last 6 months)                                */
  /* ================================================================ */
  const monthlyTrend = useMemo(() => {
    const months6 = lastNMonths(month, 6);
    return months6.map((m) => {
      const entries = ledger.filter((l) => monthOf(l.date) === m);
      const inc = entries.filter((l) => l.kind === "income").reduce((s, e) => s + Number(e.amount), 0);
      const living = entries.filter((l) => isLivingExpense(l)).reduce((s, e) => s + Number(e.amount), 0);
      const savings = inc - living;
      const rate = inc > 0 ? ((inc - living) / inc) * 100 : 0;
      return { month: m, income: inc, expense: living, savings, savingsRate: rate };
    });
  }, [ledger, month]);

  /* ================================================================ */
  /*  11. Fun Statistics                                               */
  /* ================================================================ */
  const funStats = useMemo(() => {
    const monthEntries = ledger.filter((l) => monthOf(l.date) === month);
    const expenses = monthEntries.filter((l) => l.kind === "expense");

    // Zero-spend days
    const [y, m] = month.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const today = new Date();
    const isCurrentMonth = today.getFullYear() === y && today.getMonth() + 1 === m;
    const maxDay = isCurrentMonth ? today.getDate() : daysInMonth;
    const spendDates = new Set(expenses.map((e) => e.date));
    let zeroSpendDays = 0;
    for (let d = 1; d <= maxDay; d++) {
      const dateStr = `${month}-${String(d).padStart(2, "0")}`;
      if (!spendDates.has(dateStr)) zeroSpendDays++;
    }

    // Most expensive single transaction
    let maxSingle = { amount: 0, desc: "", date: "" };
    for (const e of expenses) {
      if (Number(e.amount) > maxSingle.amount) {
        maxSingle = { amount: Number(e.amount), desc: e.description || e.category || "기타", date: e.date };
      }
    }

    // Category-based fun counts
    const countByKeyword = (keywords: string[]) => {
      return expenses.filter((e) => {
        const text = `${e.category || ""} ${e.subCategory || ""} ${e.description || ""}`.toLowerCase();
        return keywords.some((kw) => text.includes(kw));
      }).length;
    };

    const cafeCount = countByKeyword(["카페", "커피", "스타벅스", "투썸", "이디야", "메가", "빽다방", "할리스", "카페인"]);
    const diningCount = countByKeyword(["외식", "식당", "배달", "배민", "요기요", "쿠팡이츠", "음식"]);
    const transportCount = countByKeyword(["교통", "택시", "주유", "충전", "기름", "주차", "톨게이트", "고속도로"]);
    const subscriptionCount = countByKeyword(["구독", "넷플릭스", "유튜브", "멜론", "스포티파이", "gpt", "chatgpt", "claude", "ai"]);

    // Total transactions count
    const totalTxCount = monthEntries.length;
    const expenseCount = expenses.length;
    const incomeCount = monthEntries.filter((l) => l.kind === "income").length;

    // Average daily spending
    const totalExpense = expenses.reduce((s, e) => s + Number(e.amount), 0);
    const avgDaily = maxDay > 0 ? totalExpense / maxDay : 0;

    // Weekday vs weekend spending
    const weekdayExpense = expenses
      .filter((e) => { const d = new Date(e.date).getDay(); return d >= 1 && d <= 5; })
      .reduce((s, e) => s + Number(e.amount), 0);
    const weekendExpense = totalExpense - weekdayExpense;

    return {
      zeroSpendDays,
      maxSingle,
      cafeCount,
      diningCount,
      transportCount,
      subscriptionCount,
      totalTxCount,
      expenseCount,
      incomeCount,
      avgDaily,
      weekdayExpense,
      weekendExpense,
      daysInMonth: maxDay,
    };
  }, [ledger, month]);

  /* ================================================================ */
  /*  12. Top Spending Dates                                           */
  /* ================================================================ */
  const topSpendingDates = useMemo(() => {
    const dateMap = new Map<string, { total: number; items: { desc: string; amount: number }[] }>();
    for (const e of livingEntries) {
      const d = e.date;
      if (!dateMap.has(d)) dateMap.set(d, { total: 0, items: [] });
      const entry = dateMap.get(d)!;
      entry.total += Number(e.amount);
      entry.items.push({ desc: e.description || e.category || "기타", amount: Number(e.amount) });
    }
    return Array.from(dateMap.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [livingEntries]);

  /* ================================================================ */
  /*  Styles                                                          */
  /* ================================================================ */
  const cardStyle: React.CSSProperties = {
    padding: 16,
    borderRadius: 12,
  };

  const cardTitleStyle: React.CSSProperties = {
    margin: "0 0 12px 0",
    fontSize: 16,
    fontWeight: 700,
    color: "var(--text)",
  };

  const subtleText: React.CSSProperties = {
    fontSize: 12,
    color: "var(--text-muted)",
  };

  /* ================================================================ */
  /*  Tab & KPI styles                                                */
  /* ================================================================ */
  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: "8px 18px",
    borderRadius: 8,
    border: "1px solid " + (active ? "var(--primary)" : "var(--border)"),
    background: active ? "var(--primary)" : "transparent",
    color: active ? "#fff" : "var(--text)",
    fontWeight: active ? 700 : 500,
    fontSize: 14,
    cursor: "pointer",
    transition: "all 0.15s",
  });

  const kpiCardStyle: React.CSSProperties = {
    flex: "1 1 140px",
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  };

  const kpiLabel: React.CSSProperties = { fontSize: 11, color: "var(--text-muted)", fontWeight: 600 };
  const kpiValue: React.CSSProperties = { fontSize: 20, fontWeight: 800, color: "var(--text)" };
  const kpiBadge = (positive: boolean): React.CSSProperties => ({
    fontSize: 11,
    fontWeight: 700,
    color: positive ? "#059669" : "#dc2626",
    background: positive ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)",
    borderRadius: 4,
    padding: "1px 6px",
    alignSelf: "flex-start",
  });

  /* ================================================================ */
  /*  Render                                                          */
  /* ================================================================ */
  const trendMax = Math.max(...monthlyTrend.map((d) => Math.max(d.income, d.expense)), 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header + Month Selector */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>인사이트</h2>
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          style={{ padding: "6px 10px", borderRadius: 6, marginLeft: "auto" }}
        >
          {monthOptions.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      {/* KPI Cards — always visible */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div style={kpiCardStyle}>
          <span style={kpiLabel}>총수입</span>
          <span style={{ ...kpiValue, color: "var(--success)" }}>{formatKRW(Math.round(kpiData.income))}</span>
          {kpiData.incomeChange !== null && (
            <span style={kpiBadge(kpiData.incomeChange >= 0)}>
              {kpiData.incomeChange >= 0 ? "+" : ""}{Math.round(kpiData.incomeChange)}% vs 전월
            </span>
          )}
          {totalIncome > 0 && (
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              급여 {Math.round((salaryIncome / totalIncome) * 100)}%
            </span>
          )}
        </div>
        <div style={kpiCardStyle}>
          <span style={kpiLabel}>소비지출</span>
          <span style={{ ...kpiValue, color: "var(--danger)" }}>{formatKRW(Math.round(totalLiving))}</span>
          {prevTotalLiving > 0 && (
            <span style={kpiBadge(totalLiving <= prevTotalLiving)}>
              {totalLiving >= prevTotalLiving ? "+" : ""}{Math.round(((totalLiving - prevTotalLiving) / prevTotalLiving) * 100)}% vs 전월
            </span>
          )}
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            일 평균 {formatKRW(Math.round(funStats.daysInMonth > 0 ? totalLiving / funStats.daysInMonth : 0))}
          </span>
        </div>
        <div style={kpiCardStyle}>
          <span style={kpiLabel}>저축률(흐름)</span>
          <span style={{ ...kpiValue, color: (() => { const r = totalIncome > 0 ? ((totalIncome - totalLiving) / totalIncome) * 100 : 0; return r >= 30 ? "var(--success)" : r >= 0 ? "var(--primary)" : "var(--danger)"; })() }}>
            {totalIncome > 0 ? `${Math.round(((totalIncome - totalLiving) / totalIncome) * 100)}%` : "-"}
          </span>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            누적 {Math.round(cumulativeStats.flowRate)}% · 목표 30%+
          </span>
        </div>
        <div style={kpiCardStyle}>
          <span style={kpiLabel}>재테크/투자</span>
          <span style={{ ...kpiValue, color: "var(--primary)" }}>{formatKRW(Math.round(kpiData.expense - totalLiving))}</span>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            총지출 대비 {totalLiving + (kpiData.expense - totalLiving) > 0 ? Math.round(((kpiData.expense - totalLiving) / kpiData.expense) * 100) : 0}%
          </span>
        </div>
      </div>

      {/* Tab Buttons */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {([
          ["overview", "개요"],
          ["spending", "소비 분석"],
          ["invest", "투자 분석"],
          ["insights", "종합 진단"],
        ] as const).map(([key, label]) => (
          <button key={key} style={tabBtnStyle(activeTab === key)} onClick={() => setActiveTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {/* ============================================================ */}
      {/*  OVERVIEW TAB                                                */}
      {/* ============================================================ */}
      {activeTab === "overview" && (
        <>
          {/* Monthly Income vs Expense Trend — SVG Bar Chart */}
          <div className="card" style={cardStyle}>
            <h3 style={cardTitleStyle}>월별 수입/지출 추이</h3>
            <svg viewBox="0 0 600 220" style={{ width: "100%", maxHeight: 220 }}>
              {/* Grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
                const y = 190 - pct * 170;
                return (
                  <g key={pct}>
                    <line x1={50} y1={y} x2={580} y2={y} stroke="var(--border)" strokeWidth={0.5} />
                    <text x={46} y={y + 4} textAnchor="end" fill="var(--text-muted)" fontSize={9}>
                      {formatNumber(Math.round((trendMax * pct) / 10000))}만
                    </text>
                  </g>
                );
              })}
              {/* Bars */}
              {monthlyTrend.map((d, i) => {
                const barW = 32;
                const gap = (530 - monthlyTrend.length * barW * 2) / (monthlyTrend.length + 1);
                const x = 50 + gap + i * (barW * 2 + gap);
                const incH = (d.income / trendMax) * 170;
                const expH = (d.expense / trendMax) * 170;
                return (
                  <g key={d.month}>
                    {/* Income bar */}
                    <rect
                      x={x}
                      y={190 - incH}
                      width={barW - 2}
                      height={Math.max(incH, 1)}
                      rx={4}
                      fill="var(--success)"
                      opacity={0.7}
                    >
                      <title>수입: {formatKRW(Math.round(d.income))}</title>
                    </rect>
                    {/* Expense bar */}
                    <rect
                      x={x + barW}
                      y={190 - expH}
                      width={barW - 2}
                      height={Math.max(expH, 1)}
                      rx={4}
                      fill="var(--danger)"
                      opacity={0.7}
                    >
                      <title>지출: {formatKRW(Math.round(d.expense))}</title>
                    </rect>
                    {/* Month label */}
                    <text
                      x={x + barW - 1}
                      y={208}
                      textAnchor="middle"
                      fill="var(--text-muted)"
                      fontSize={10}
                    >
                      {d.month.slice(5)}월
                    </text>
                    {/* Savings rate label */}
                    <text
                      x={x + barW - 1}
                      y={218}
                      textAnchor="middle"
                      fill={d.savingsRate >= 30 ? "var(--success)" : d.savingsRate >= 0 ? "var(--text-muted)" : "var(--danger)"}
                      fontSize={8}
                      fontWeight={600}
                    >
                      {d.income > 0 ? `${Math.round(d.savingsRate)}%` : ""}
                    </text>
                  </g>
                );
              })}
              {/* Legend */}
              <rect x={50} y={3} width={10} height={10} rx={2} fill="var(--success)" opacity={0.7} />
              <text x={64} y={12} fill="var(--text-muted)" fontSize={10}>수입</text>
              <rect x={100} y={3} width={10} height={10} rx={2} fill="var(--danger)" opacity={0.7} />
              <text x={114} y={12} fill="var(--text-muted)" fontSize={10}>지출</text>
            </svg>
          </div>

          {/* Savings Rate Trend */}
          <div className="card" style={cardStyle}>
            <h3 style={cardTitleStyle}>저축률 추이</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {monthlyTrend.map((d) => {
                const rate = Math.round(d.savingsRate);
                const color = rate >= 30 ? "var(--success)" : rate >= 0 ? "var(--primary)" : "var(--danger)";
                return (
                  <div
                    key={d.month}
                    style={{
                      flex: "1 1 80px",
                      background: "var(--bg)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: "10px 8px",
                      textAlign: "center",
                    }}
                  >
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
                      {d.month.slice(5)}월
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 800, color }}>
                      {d.income > 0 ? `${rate}%` : "-"}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                      {d.income > 0 ? formatKRW(Math.round(d.savings)) : "수입 없음"}
                    </div>
                    {/* Mini bar */}
                    <div style={{ height: 4, background: "var(--border)", borderRadius: 2, marginTop: 6, overflow: "hidden" }}>
                      <div style={{ width: `${Math.max(Math.min(rate, 100), 0)}%`, height: "100%", background: color, borderRadius: 2 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Spending Analogies — also shown in overview */}
          <div className="card" style={cardStyle}>
            <h3 style={cardTitleStyle}>이번달 소비 비유</h3>
            {totalLiving === 0 ? (
              <p style={subtleText}>이번 달 생활비 지출이 없습니다.</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
                {analogies.map((a) => (
                  <div
                    key={a.label}
                    style={{
                      background: "var(--bg)",
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      padding: "12px 14px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <span style={{ fontSize: 28 }}>{a.icon}</span>
                    <span style={{ fontWeight: 700, fontSize: 18, color: "var(--text)" }}>
                      {a.label} {formatNumber(a.count)}{a.unit}
                    </span>
                    <span style={subtleText}>@{formatKRW(a.price)}/{a.unit}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Spending Score — also in overview for quick glance */}
          <div className="card" style={cardStyle}>
            <h3 style={cardTitleStyle}>소비 점수</h3>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "10px 0" }}>
              <div
                style={{
                  position: "relative",
                  width: 140,
                  height: 140,
                  borderRadius: "50%",
                  background: `conic-gradient(${scoreData.total >= 70 ? "var(--success)" : scoreData.total >= 40 ? "var(--primary)" : "var(--danger)"} ${scoreData.total * 3.6}deg, var(--border) ${scoreData.total * 3.6}deg)`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    width: 112,
                    height: 112,
                    borderRadius: "50%",
                    background: "var(--surface)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <span style={{ fontSize: 32, fontWeight: 800, color: "var(--text)" }}>{scoreData.total}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--primary)" }}>{scoreData.grade}</span>
                </div>
              </div>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", textAlign: "center" }}>{scoreData.comment}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
              {[
                { label: "저축률", pts: scoreData.savingsPoints, max: 40, sub: totalIncome > 0 ? `${Math.round(scoreData.savingsRate * 100)}%` : "수입 없음" },
                { label: "전월 대비 개선", pts: scoreData.improvementPoints, max: 30, sub: prevTotalLiving > 0 ? (totalLiving < prevTotalLiving ? `${Math.round(((prevTotalLiving - totalLiving) / prevTotalLiving) * 100)}% 절약` : "전월 대비 증가") : "전월 데이터 없음" },
                { label: "일관성", pts: scoreData.consistencyPoints, max: 30, sub: "일별 편차 기준" },
              ].map((item) => (
                <div key={item.label} style={{ background: "var(--bg)", borderRadius: 8, padding: "10px 12px", textAlign: "center", border: "1px solid var(--border)" }}>
                  <div style={subtleText}>{item.label}</div>
                  <div style={{ fontWeight: 700, fontSize: 18, color: "var(--text)" }}>
                    {item.pts}<span style={{ fontSize: 12, color: "var(--text-muted)" }}>/{item.max}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{item.sub}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ============================================================ */}
      {/*  SPENDING TAB                                                */}
      {/* ============================================================ */}
      {activeTab === "spending" && (
        <>
      {/* 1. Spending Analogies */}
      <div className="card" style={cardStyle}>
        <h3 style={cardTitleStyle}>
          이번달 소비 비유
        </h3>
        {totalLiving === 0 ? (
          <p style={subtleText}>이번 달 생활비 지출이 없습니다.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
            {analogies.map((a) => (
              <div
                key={a.label}
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "12px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <span style={{ fontSize: 28 }}>{a.icon}</span>
                <span style={{ fontWeight: 700, fontSize: 18, color: "var(--text)" }}>
                  {a.label} {formatNumber(a.count)}{a.unit}
                </span>
                <span style={subtleText}>
                  @{formatKRW(a.price)}/{a.unit}
                </span>
              </div>
            ))}
          </div>
        )}
        {totalLiving > 0 && (
          <p style={{ ...subtleText, marginTop: 10, textAlign: "right" }}>
            이번 달 총 생활비: {formatKRW(Math.round(totalLiving))}
          </p>
        )}
      </div>

      {/* ============================================================ */}
      {/*  2. Category Trends                                          */}
      {/* ============================================================ */}
      <div className="card" style={cardStyle}>
        <h3 style={cardTitleStyle}>
          카테고리 변화 추이
        </h3>
        <p style={{ ...subtleText, margin: "0 0 10px 0" }}>
          전월 대비 카테고리별 지출 변화 (생활비 기준)
        </p>
        {categoryTrends.length === 0 ? (
          <p style={subtleText}>데이터가 부족합니다.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {categoryTrends.map((row) => {
              const isIncrease = row.change > 0;
              const isDecrease = row.change < 0;
              const color = isDecrease ? "var(--success)" : isIncrease ? "var(--danger)" : "var(--text-muted)";
              const arrow = isIncrease ? "^" : isDecrease ? "v" : "-";
              return (
                <div
                  key={row.category}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 12px",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ fontWeight: 600, minWidth: 80, fontSize: 13, color: "var(--text)" }}>
                    {row.category}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 100 }}>
                    {formatKRW(Math.round(row.lastMonth))} {"->"} {formatKRW(Math.round(row.thisMonth))}
                  </span>
                  <span style={{ marginLeft: "auto", fontWeight: 700, fontSize: 14, color }}>
                    {arrow} {formatKRW(Math.abs(Math.round(row.change)))}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color,
                      background: isDecrease
                        ? "rgba(16,185,129,0.12)"
                        : isIncrease
                          ? "rgba(239,68,68,0.12)"
                          : "transparent",
                      borderRadius: 4,
                      padding: "2px 6px",
                    }}
                  >
                    {row.pct >= 0 ? "+" : ""}{Math.round(row.pct)}%
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/*  3. Spending Patterns                                        */}
      {/* ============================================================ */}
      <div className="card" style={cardStyle}>
        <h3 style={cardTitleStyle}>
          소비 패턴
        </h3>
        <p style={{ ...subtleText, margin: "0 0 10px 0" }}>
          요일별 지출 합계 (생활비)
        </p>
        {totalLiving === 0 ? (
          <p style={subtleText}>이번 달 지출이 없습니다.</p>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {DOW_KR.map((label, idx) => {
                const val = spendingPatterns.dowTotals[idx];
                const pct = spendingPatterns.maxDow > 0 ? (val / spendingPatterns.maxDow) * 100 : 0;
                const isMax = val === spendingPatterns.maxDow && val > 0;
                return (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        width: 24,
                        textAlign: "center",
                        fontWeight: isMax ? 800 : 600,
                        fontSize: 13,
                        color: isMax ? "var(--primary)" : "var(--text)",
                      }}
                    >
                      {label}
                    </span>
                    <div
                      style={{
                        flex: 1,
                        height: 22,
                        background: "var(--bg)",
                        borderRadius: 6,
                        overflow: "hidden",
                        border: "1px solid var(--border)",
                        position: "relative",
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.max(pct, 1)}%`,
                          height: "100%",
                          background: isMax
                            ? "linear-gradient(90deg, var(--primary), #6366f1)"
                            : "var(--primary)",
                          opacity: isMax ? 1 : 0.5,
                          borderRadius: 6,
                          transition: "width 0.3s ease",
                        }}
                      />
                    </div>
                    <span
                      style={{
                        minWidth: 90,
                        textAlign: "right",
                        fontSize: 12,
                        fontWeight: isMax ? 700 : 400,
                        color: isMax ? "var(--primary)" : "var(--text-muted)",
                      }}
                    >
                      {formatKRW(Math.round(val))}
                    </span>
                  </div>
                );
              })}
            </div>
            <div
              style={{
                display: "flex",
                gap: 16,
                marginTop: 14,
                flexWrap: "wrap",
                paddingTop: 10,
                borderTop: "1px solid var(--border)",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={subtleText}>일 평균 지출</span>
                <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>
                  {formatKRW(Math.round(spendingPatterns.avgDaily))}
                </span>
              </div>
              {spendingPatterns.mostExpensiveDay && (
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={subtleText}>최고 지출일</span>
                  <span style={{ fontWeight: 700, fontSize: 15, color: "var(--danger)" }}>
                    {spendingPatterns.mostExpensiveDay} ({formatKRW(Math.round(spendingPatterns.mostExpensiveAmount))})
                  </span>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ============================================================ */}
      {/*  4. Spending Score                                           */}
      {/* ============================================================ */}
      <div className="card" style={cardStyle}>
        <h3 style={cardTitleStyle}>
          소비 점수
        </h3>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "10px 0" }}>
          {/* Circular score display */}
          <div
            style={{
              position: "relative",
              width: 140,
              height: 140,
              borderRadius: "50%",
              background: `conic-gradient(
                ${scoreData.total >= 70 ? "var(--success)" : scoreData.total >= 40 ? "var(--primary)" : "var(--danger)"} ${scoreData.total * 3.6}deg,
                var(--border) ${scoreData.total * 3.6}deg
              )`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 112,
                height: 112,
                borderRadius: "50%",
                background: "var(--surface)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span style={{ fontSize: 32, fontWeight: 800, color: "var(--text)" }}>
                {scoreData.total}
              </span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--primary)" }}>
                {scoreData.grade}
              </span>
            </div>
          </div>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", textAlign: "center" }}>
            {scoreData.comment}
          </span>
        </div>

        {/* Score breakdown */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 8,
            marginTop: 12,
            paddingTop: 12,
            borderTop: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              background: "var(--bg)",
              borderRadius: 8,
              padding: "10px 12px",
              textAlign: "center",
              border: "1px solid var(--border)",
            }}
          >
            <div style={subtleText}>저축률</div>
            <div style={{ fontWeight: 700, fontSize: 18, color: "var(--text)" }}>
              {scoreData.savingsPoints}<span style={{ fontSize: 12, color: "var(--text-muted)" }}>/40</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {totalIncome > 0 ? `${Math.round(scoreData.savingsRate * 100)}%` : "수입 없음"}
            </div>
          </div>
          <div
            style={{
              background: "var(--bg)",
              borderRadius: 8,
              padding: "10px 12px",
              textAlign: "center",
              border: "1px solid var(--border)",
            }}
          >
            <div style={subtleText}>전월 대비 개선</div>
            <div style={{ fontWeight: 700, fontSize: 18, color: "var(--text)" }}>
              {scoreData.improvementPoints}<span style={{ fontSize: 12, color: "var(--text-muted)" }}>/30</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {prevTotalLiving > 0
                ? totalLiving < prevTotalLiving
                  ? `${Math.round(((prevTotalLiving - totalLiving) / prevTotalLiving) * 100)}% 절약`
                  : "전월 대비 증가"
                : "전월 데이터 없음"}
            </div>
          </div>
          <div
            style={{
              background: "var(--bg)",
              borderRadius: 8,
              padding: "10px 12px",
              textAlign: "center",
              border: "1px solid var(--border)",
            }}
          >
            <div style={subtleText}>일관성</div>
            <div style={{ fontWeight: 700, fontSize: 18, color: "var(--text)" }}>
              {scoreData.consistencyPoints}<span style={{ fontSize: 12, color: "var(--text-muted)" }}>/30</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              일별 편차 기준
            </div>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/*  5. Spending Pace Forecast                                   */}
      {/* ============================================================ */}
      <div className="card" style={cardStyle}>
        <h3 style={cardTitleStyle}>지출 속도 예측</h3>
        <p style={{ ...subtleText, margin: "0 0 12px 0" }}>
          현재까지의 소비 속도로 이번 달 말 예상 지출을 계산합니다.
        </p>
        {totalLiving === 0 ? (
          <p style={subtleText}>이번 달 지출 데이터가 없습니다.</p>
        ) : (
          <>
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: "var(--text)",
                marginBottom: 12,
                lineHeight: 1.3,
              }}
            >
              현재 속도라면 이번 달 예상 지출:{" "}
              <span style={{ color: "var(--danger)" }}>
                {formatKRW(Math.round(paceForecast.projectedTotal))}
              </span>
            </div>

            {/* Progress bar: month elapsed vs budget used */}
            <div style={{ marginBottom: 10 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 11,
                  color: "var(--text-muted)",
                  marginBottom: 4,
                }}
              >
                <span>
                  이달 경과: {paceForecast.dayOfMonth}일 /{" "}
                  {paceForecast.daysInMonth}일 (
                  {Math.round(paceForecast.dayRatio * 100)}%)
                </span>
                {prevTotalLiving > 0 && (
                  <span>
                    예산 대비:{" "}
                    {Math.round(
                      (paceForecast.projectedTotal / prevTotalLiving) * 100
                    )}
                    % of 지난달
                  </span>
                )}
              </div>
              {/* Month elapsed bar */}
              <div
                style={{
                  position: "relative",
                  height: 10,
                  background: "var(--bg)",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  overflow: "hidden",
                  marginBottom: 4,
                }}
              >
                <div
                  style={{
                    width: `${Math.min(paceForecast.dayRatio * 100, 100)}%`,
                    height: "100%",
                    background: "var(--primary)",
                    opacity: 0.5,
                    borderRadius: 6,
                  }}
                />
              </div>
              {/* Projected spending bar vs last month */}
              {prevTotalLiving > 0 && (
                <div
                  style={{
                    position: "relative",
                    height: 10,
                    background: "var(--bg)",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(
                        (paceForecast.projectedTotal / prevTotalLiving) * 100,
                        100
                      )}%`,
                      height: "100%",
                      background:
                        paceForecast.projectedTotal > prevTotalLiving * 1.2
                          ? "var(--danger)"
                          : paceForecast.projectedTotal < prevTotalLiving
                          ? "var(--success)"
                          : "var(--primary)",
                      borderRadius: 6,
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
              )}
            </div>

            {/* Warning / good news banner */}
            {prevTotalLiving > 0 &&
              paceForecast.projectedTotal > prevTotalLiving * 1.2 && (
                <div
                  style={{
                    marginTop: 8,
                    padding: "10px 14px",
                    borderRadius: 8,
                    background: "rgba(239,68,68,0.08)",
                    border: "1px solid rgba(239,68,68,0.2)",
                    fontSize: 13,
                    color: "#dc2626",
                    fontWeight: 600,
                  }}
                >
                  지난달보다 20%+ 초과 예상 (지난달:{" "}
                  {formatKRW(Math.round(prevTotalLiving))}, 예상:{" "}
                  {formatKRW(Math.round(paceForecast.projectedTotal))})
                </div>
              )}
            {prevTotalLiving > 0 &&
              paceForecast.projectedTotal < prevTotalLiving && (
                <div
                  style={{
                    marginTop: 8,
                    padding: "10px 14px",
                    borderRadius: 8,
                    background: "rgba(16,185,129,0.08)",
                    border: "1px solid rgba(16,185,129,0.2)",
                    fontSize: 13,
                    color: "#059669",
                    fontWeight: 600,
                  }}
                >
                  지난달보다 적게 쓸 수 있어요 (지난달:{" "}
                  {formatKRW(Math.round(prevTotalLiving))}, 예상:{" "}
                  {formatKRW(Math.round(paceForecast.projectedTotal))})
                </div>
              )}
            {paceForecast.vsLastMonth !== null && (
              <p style={{ ...subtleText, marginTop: 10 }}>
                전월 대비 예상 변화:{" "}
                <span
                  style={{
                    fontWeight: 700,
                    color:
                      paceForecast.vsLastMonth > 0
                        ? "var(--danger)"
                        : "var(--success)",
                  }}
                >
                  {paceForecast.vsLastMonth > 0 ? "+" : ""}
                  {Math.round(paceForecast.vsLastMonth)}%
                </span>
              </p>
            )}
          </>
        )}
      </div>

      {/* ============================================================ */}
      {/*  6. Unusual Spending Alert                                   */}
      {/* ============================================================ */}
      <div className="card" style={cardStyle}>
        <h3 style={cardTitleStyle}>이상 지출 감지</h3>
        <p style={{ ...subtleText, margin: "0 0 12px 0" }}>
          최근 3개월 카테고리 평균보다 2배 이상 지출된 항목
        </p>
        {unusualSpending.length === 0 ? (
          <p style={{ ...subtleText, textAlign: "center", padding: "16px 0" }}>
            이번 달 이상 지출이 없습니다
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {unusualSpending.map(({ entry, avg, ratio }, idx) => (
              <div
                key={`${entry.date}-${entry.description}-${idx}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 14px",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 70 }}>
                  {entry.date}
                </span>
                <span
                  style={{
                    flex: 1,
                    fontWeight: 600,
                    fontSize: 13,
                    color: "var(--text)",
                    minWidth: 80,
                  }}
                >
                  {entry.description || entry.category || "기타"}
                </span>
                <span style={{ fontWeight: 700, fontSize: 14, color: "var(--danger)" }}>
                  {formatKRW(Math.round(Number(entry.amount)))}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#b45309",
                    background: "rgba(245,158,11,0.12)",
                    border: "1px solid rgba(245,158,11,0.25)",
                    borderRadius: 5,
                    padding: "2px 8px",
                    whiteSpace: "nowrap",
                  }}
                >
                  평소 대비 {ratio.toFixed(1)}배
                </span>
                <span style={{ ...subtleText, width: "100%", marginTop: 2 }}>
                  카테고리 [{entry.category || "기타"}] 평균:{" "}
                  {formatKRW(Math.round(avg))}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/*  7. Key Insights Summary                                     */}
      {/* ============================================================ */}
      <div className="card" style={cardStyle}>
        <h3 style={cardTitleStyle}>핵심 인사이트 요약</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Green: savings rate */}
          <div
            style={{
              background: "rgba(16,185,129,0.08)",
              border: "1px solid rgba(16,185,129,0.15)",
              borderRadius: 8,
              padding: "14px 18px",
              fontSize: 13,
            }}
          >
            <span style={{ fontWeight: 700, color: "#059669" }}>저축률</span>{" "}
            {keySummary.savingsRate === null ? (
              <span style={{ color: "var(--text-muted)" }}>
                이번 달 수입 데이터가 없어 저축률을 계산할 수 없습니다.
              </span>
            ) : keySummary.savingsRate >= 0.3 ? (
              <span style={{ color: "var(--text)" }}>
                이번 달 저축률이{" "}
                <strong>{Math.round(keySummary.savingsRate * 100)}%</strong>로
                건강한 수준입니다. 잘 하고 있어요!
              </span>
            ) : keySummary.savingsRate >= 0 ? (
              <span style={{ color: "var(--text)" }}>
                저축률이{" "}
                <strong>{Math.round(keySummary.savingsRate * 100)}%</strong>로
                30% 이상을 목표로 해 보세요.
              </span>
            ) : (
              <span style={{ color: "#dc2626" }}>
                이번 달 지출이 수입을 초과했습니다 (저축률:{" "}
                <strong>{Math.round(keySummary.savingsRate * 100)}%</strong>).
                지출 점검이 필요해요.
              </span>
            )}
          </div>

          {/* Yellow: biggest category */}
          {keySummary.biggestCat && (
            <div
              style={{
                background: "rgba(245,158,11,0.08)",
                border: "1px solid rgba(245,158,11,0.15)",
                borderRadius: 8,
                padding: "14px 18px",
                fontSize: 13,
              }}
            >
              <span style={{ fontWeight: 700, color: "#b45309" }}>최대 지출 카테고리</span>{" "}
              <span style={{ color: "var(--text)" }}>
                이번 달 지출의{" "}
                <strong>{Math.round(keySummary.biggestCatPct)}%</strong>가{" "}
                <strong>{keySummary.biggestCat}</strong>에 집중되어 있습니다 (
                {formatKRW(Math.round(keySummary.biggestAmt))}).{" "}
                {keySummary.biggestCatPct > 40
                  ? "한 카테고리 비중이 너무 높아요."
                  : "적정 수준입니다."}
              </span>
            </div>
          )}

          {/* Red: category spiked 2x vs last month */}
          {keySummary.spikedCats.length > 0 && (
            <div
              style={{
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.15)",
                borderRadius: 8,
                padding: "14px 18px",
                fontSize: 13,
              }}
            >
              <span style={{ fontWeight: 700, color: "#dc2626" }}>전월 대비 급증 카테고리</span>{" "}
              <span style={{ color: "var(--text)" }}>
                {keySummary.spikedCats
                  .map((s) => `${s.cat} (${s.ratio.toFixed(1)}배)`)
                  .join(", ")}
                {keySummary.spikedCats.length === 1
                  ? " 카테고리가"
                  : " 카테고리들이"}{" "}
                지난달 대비 2배 이상 지출됐습니다.
              </span>
            </div>
          )}

          {/* Blue: income structure */}
          <div
            style={{
              background: "rgba(59,130,246,0.08)",
              border: "1px solid rgba(59,130,246,0.15)",
              borderRadius: 8,
              padding: "14px 18px",
              fontSize: 13,
            }}
          >
            <span style={{ fontWeight: 700, color: "#2563eb" }}>수입 구조</span>{" "}
            {totalIncome === 0 ? (
              <span style={{ color: "var(--text-muted)" }}>
                이번 달 수입이 기록되지 않았습니다. 수입을 입력하면 더 정확한
                인사이트를 받을 수 있어요.
              </span>
            ) : (
              <span style={{ color: "var(--text)" }}>
                이번 달 수입:{" "}
                <strong>{formatKRW(Math.round(totalIncome))}</strong>, 생활비:{" "}
                <strong>{formatKRW(Math.round(totalLiving))}</strong>.{" "}
                {totalIncome > 0
                  ? `생활비 비중 ${Math.round((totalLiving / totalIncome) * 100)}%.`
                  : ""}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/*  8. Category Heatmap                                         */}
      {/* ============================================================ */}
      <div className="card" style={cardStyle}>
        <h3 style={cardTitleStyle}>
          월별 카테고리 히트맵
        </h3>
        <p style={{ ...subtleText, margin: "0 0 10px 0" }}>
          최근 6개월 카테고리별 지출 강도 (카테고리 내 최대치 대비)
        </p>
        {heatmapData.rows.length === 0 ? (
          <p style={subtleText}>데이터가 부족합니다.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "separate",
                borderSpacing: 3,
                fontSize: 12,
              }}
            >
              <thead>
                <tr>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "6px 8px",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                      minWidth: 70,
                    }}
                  >
                    카테고리
                  </th>
                  {heatmapData.months.map((m) => (
                    <th
                      key={m}
                      style={{
                        textAlign: "center",
                        padding: "6px 4px",
                        color: "var(--text-muted)",
                        fontWeight: 600,
                        minWidth: 60,
                      }}
                    >
                      {m.slice(2).replace("-", ".")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmapData.rows.map((row) => (
                  <tr key={row.category}>
                    <td
                      style={{
                        padding: "6px 8px",
                        fontWeight: 600,
                        color: "var(--text)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {row.category}
                    </td>
                    {row.cells.map((cell) => {
                      const r = 239, g = 68, b = 68; // red tones for spending
                      const bg =
                        cell.amount > 0
                          ? `rgba(${r}, ${g}, ${b}, ${Math.max(cell.intensity * 0.85, 0.08)})`
                          : "var(--bg)";
                      return (
                        <td
                          key={cell.month}
                          title={`${row.category} ${cell.month}: ${formatKRW(Math.round(cell.amount))}`}
                          style={{
                            textAlign: "center",
                            padding: "8px 4px",
                            borderRadius: 6,
                            background: bg,
                            color: cell.intensity > 0.5 ? "#fff" : "var(--text)",
                            fontWeight: cell.intensity > 0.5 ? 700 : 400,
                            cursor: "default",
                            transition: "background 0.2s",
                            minWidth: 60,
                          }}
                        >
                          {cell.amount > 0 ? formatNumber(Math.round(cell.amount / 10000)) + "만" : "-"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Legend */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginTop: 8,
                justifyContent: "flex-end",
              }}
            >
              <span style={subtleText}>낮음</span>
              {[0.1, 0.3, 0.5, 0.7, 0.9].map((intensity) => (
                <div
                  key={intensity}
                  style={{
                    width: 18,
                    height: 14,
                    borderRadius: 3,
                    background: `rgba(239, 68, 68, ${intensity * 0.85})`,
                  }}
                />
              ))}
              <span style={subtleText}>높음</span>
            </div>
          </div>
        )}
      </div>
      {/* end spending tab */}
        </>
      )}

      {/* ============================================================ */}
      {/*  INVEST TAB                                                  */}
      {/* ============================================================ */}
      {activeTab === "invest" && (
        <>
      {(() => {
        const wp = { accounts, ledger, trades, prices, fxRate, categoryPresets, month };
        return (
          <>
            <WaterfallWidget {...wp} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 12 }}>
              <TopThreeBlocksWidget {...wp} />
              <SubscriptionAlertWidget {...wp} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 12 }}>
              <PortfolioBreakdownWidget {...wp} />
              <DividendCoverageInsightWidget {...wp} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 12 }}>
              <SavingsRateTrendWidget {...wp} />
              <InvestSimulatorWidget {...wp} />
            </div>
          </>
        );
      })()}
      {(() => {
        const awp: AdvancedWidgetProps = { accounts, ledger, trades, prices, fxRate, categoryPresets, budgetGoals: _goals };
        return (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 12 }}>
              <RealReturnWidget {...awp} />
              <GoalPlannerWidget {...awp} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 12 }}>
              <InvestCapacityWidget {...awp} />
              <TradeVsSpendWidget {...awp} />
            </div>
            <ConcentrationWidget {...awp} />
          </>
        );
      })()}
        </>
      )}

      {/* ============================================================ */}
      {/*  INSIGHTS TAB (종합 진단)                                     */}
      {/* ============================================================ */}
      {activeTab === "insights" && (
        <>
          {/* Fun Statistics Grid */}
          <div className="card" style={cardStyle}>
            <h3 style={cardTitleStyle}>재미 통계</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
              {[
                { label: "무지출 일수", value: `${funStats.zeroSpendDays}일`, sub: `${funStats.daysInMonth}일 중`, color: "#059669" },
                { label: "카페/커피", value: `${funStats.cafeCount}회`, sub: funStats.cafeCount > 0 ? `월 ${funStats.cafeCount}잔 페이스` : "이번 달 기록 없음", color: "#8b5cf6" },
                { label: "외식/배달", value: `${funStats.diningCount}회`, sub: funStats.diningCount > 0 ? "맛집 탐방 중" : "", color: "#f59e0b" },
                { label: "교통/주유", value: `${funStats.transportCount}회`, sub: "", color: "#3b82f6" },
                { label: "구독 서비스", value: `${funStats.subscriptionCount}건`, sub: "AI/OTT 포함", color: "#ec4899" },
                { label: "총 거래건수", value: `${funStats.totalTxCount}건`, sub: `지출 ${funStats.expenseCount} / 수입 ${funStats.incomeCount}`, color: "var(--primary)" },
                { label: "주중 vs 주말", value: funStats.weekdayExpense + funStats.weekendExpense > 0 ? `${Math.round((funStats.weekendExpense / (funStats.weekdayExpense + funStats.weekendExpense)) * 100)}%` : "-", sub: "주말 지출 비중", color: "#6366f1" },
                { label: "최대 단건 지출", value: funStats.maxSingle.amount > 0 ? formatKRW(Math.round(funStats.maxSingle.amount)) : "-", sub: funStats.maxSingle.desc, color: "#dc2626" },
              ].map((item) => (
                <div
                  key={item.label}
                  style={{
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderLeft: `4px solid ${item.color}`,
                    borderRadius: 10,
                    padding: "14px 14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>{item.label}</span>
                  <span style={{ fontSize: 22, fontWeight: 800, color: item.color }}>{item.value}</span>
                  {item.sub && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{item.sub}</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Top 5 Spending Dates */}
          <div className="card" style={cardStyle}>
            <h3 style={cardTitleStyle}>지출 많은 날 TOP 5</h3>
            {topSpendingDates.length === 0 ? (
              <p style={subtleText}>이번 달 생활비 데이터가 없습니다.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {topSpendingDates.map((d, idx) => {
                  const maxTotal = topSpendingDates[0]?.total || 1;
                  const pct = (d.total / maxTotal) * 100;
                  const medals = ["#fbbf24", "#94a3b8", "#cd7f32", "var(--text-muted)", "var(--text-muted)"];
                  return (
                    <div
                      key={d.date}
                      style={{
                        background: "var(--bg)",
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        padding: "12px 14px",
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      {/* Background bar */}
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 0,
                          bottom: 0,
                          width: `${pct}%`,
                          background: "rgba(239, 68, 68, 0.06)",
                          borderRadius: 10,
                          transition: "width 0.3s",
                        }}
                      />
                      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 20, fontWeight: 800, color: medals[idx], minWidth: 28, textAlign: "center" }}>
                          {idx + 1}
                        </span>
                        <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600, minWidth: 85 }}>
                          {d.date}
                        </span>
                        <span style={{ fontWeight: 700, fontSize: 16, color: "var(--danger)", marginLeft: "auto" }}>
                          {formatKRW(Math.round(d.total))}
                        </span>
                      </div>
                      <div style={{ position: "relative", display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                        {d.items.slice(0, 4).map((item, j) => (
                          <span
                            key={j}
                            style={{
                              fontSize: 11,
                              color: "var(--text-muted)",
                              background: "var(--surface)",
                              border: "1px solid var(--border)",
                              borderRadius: 4,
                              padding: "2px 6px",
                            }}
                          >
                            {item.desc} {formatKRW(Math.round(item.amount))}
                          </span>
                        ))}
                        {d.items.length > 4 && (
                          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>+{d.items.length - 4}건</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Spending Pace Forecast */}
          <div className="card" style={cardStyle}>
            <h3 style={cardTitleStyle}>지출 속도 예측</h3>
            {totalLiving === 0 ? (
              <p style={subtleText}>이번 달 지출 데이터가 없습니다.</p>
            ) : (
              <>
                <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text)", marginBottom: 12 }}>
                  현재 속도라면 예상 지출:{" "}
                  <span style={{ color: "var(--danger)" }}>{formatKRW(Math.round(paceForecast.projectedTotal))}</span>
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <div style={{ flex: 1, height: 10, background: "var(--bg)", borderRadius: 6, border: "1px solid var(--border)", overflow: "hidden" }}>
                    <div style={{ width: `${Math.min(paceForecast.dayRatio * 100, 100)}%`, height: "100%", background: "var(--primary)", opacity: 0.5, borderRadius: 6 }} />
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", justifyContent: "space-between" }}>
                  <span>{paceForecast.dayOfMonth}일 / {paceForecast.daysInMonth}일 경과</span>
                  {paceForecast.vsLastMonth !== null && (
                    <span style={{ fontWeight: 700, color: paceForecast.vsLastMonth > 0 ? "var(--danger)" : "var(--success)" }}>
                      전월 대비 {paceForecast.vsLastMonth > 0 ? "+" : ""}{Math.round(paceForecast.vsLastMonth)}%
                    </span>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Unusual Spending Alert */}
          <div className="card" style={cardStyle}>
            <h3 style={cardTitleStyle}>이상 지출 감지</h3>
            <p style={{ ...subtleText, margin: "0 0 10px 0" }}>최근 3개월 카테고리 평균보다 2배 이상 지출</p>
            {unusualSpending.length === 0 ? (
              <div style={{ textAlign: "center", padding: "20px 0", color: "var(--success)", fontWeight: 600, fontSize: 14 }}>
                이번 달 이상 지출 없음
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {unusualSpending.map(({ entry, avg, ratio }, idx) => (
                  <div
                    key={`${entry.date}-${idx}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "10px 12px",
                      background: "var(--bg)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 70 }}>{entry.date}</span>
                    <span style={{ flex: 1, fontWeight: 600, fontSize: 13, color: "var(--text)", minWidth: 80 }}>
                      {entry.description || entry.category || "기타"}
                    </span>
                    <span style={{ fontWeight: 700, color: "var(--danger)" }}>{formatKRW(Math.round(Number(entry.amount)))}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#b45309", background: "rgba(245,158,11,0.12)", borderRadius: 4, padding: "2px 6px" }}>
                      {ratio.toFixed(1)}배
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Key Insights Summary — colored insight boxes */}
          <div className="card" style={cardStyle}>
            <h3 style={cardTitleStyle}>종합 진단</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* Savings rate */}
              <div style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.15)", borderRadius: 8, padding: "14px 18px", fontSize: 13 }}>
                <span style={{ fontWeight: 700, color: "#059669" }}>저축률</span>{" "}
                {keySummary.savingsRate === null ? (
                  <span style={{ color: "var(--text-muted)" }}>수입 데이터가 없어 저축률을 계산할 수 없습니다.</span>
                ) : keySummary.savingsRate >= 0.3 ? (
                  <span style={{ color: "var(--text)" }}>
                    이번 달 저축률 <strong>{Math.round(keySummary.savingsRate * 100)}%</strong>로 건강한 수준입니다.
                  </span>
                ) : keySummary.savingsRate >= 0 ? (
                  <span style={{ color: "var(--text)" }}>
                    저축률 <strong>{Math.round(keySummary.savingsRate * 100)}%</strong> — 30% 이상을 목표로 해 보세요.
                  </span>
                ) : (
                  <span style={{ color: "#dc2626" }}>
                    지출이 수입을 초과 (저축률 <strong>{Math.round(keySummary.savingsRate * 100)}%</strong>). 지출 점검이 필요해요.
                  </span>
                )}
              </div>

              {/* Biggest category */}
              {keySummary.biggestCat && (
                <div style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 8, padding: "14px 18px", fontSize: 13 }}>
                  <span style={{ fontWeight: 700, color: "#b45309" }}>최대 지출</span>{" "}
                  <span style={{ color: "var(--text)" }}>
                    지출의 <strong>{Math.round(keySummary.biggestCatPct)}%</strong>가{" "}
                    <strong>{keySummary.biggestCat}</strong>에 집중 ({formatKRW(Math.round(keySummary.biggestAmt))}).{" "}
                    {keySummary.biggestCatPct > 40 ? "비중이 높습니다." : "적정 수준입니다."}
                  </span>
                </div>
              )}

              {/* Spiked categories */}
              {keySummary.spikedCats.length > 0 && (
                <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: 8, padding: "14px 18px", fontSize: 13 }}>
                  <span style={{ fontWeight: 700, color: "#dc2626" }}>급증 카테고리</span>{" "}
                  <span style={{ color: "var(--text)" }}>
                    {keySummary.spikedCats.map((s) => `${s.cat} (${s.ratio.toFixed(1)}배)`).join(", ")} — 전월 대비 2배 이상 지출.
                  </span>
                </div>
              )}

              {/* Income structure */}
              <div style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.15)", borderRadius: 8, padding: "14px 18px", fontSize: 13 }}>
                <span style={{ fontWeight: 700, color: "#2563eb" }}>수입 구조</span>{" "}
                {totalIncome === 0 ? (
                  <span style={{ color: "var(--text-muted)" }}>이번 달 수입이 기록되지 않았습니다.</span>
                ) : (
                  <span style={{ color: "var(--text)" }}>
                    수입 <strong>{formatKRW(Math.round(totalIncome))}</strong>, 생활비{" "}
                    <strong>{formatKRW(Math.round(totalLiving))}</strong>.{" "}
                    생활비 비중 {Math.round((totalLiving / totalIncome) * 100)}%.
                  </span>
                )}
              </div>

              {/* Spending pattern */}
              <div style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.15)", borderRadius: 8, padding: "14px 18px", fontSize: 13 }}>
                <span style={{ fontWeight: 700, color: "#7c3aed" }}>소비 패턴</span>{" "}
                <span style={{ color: "var(--text)" }}>
                  {funStats.zeroSpendDays > 0
                    ? `무지출 ${funStats.zeroSpendDays}일 달성. `
                    : "무지출일이 없습니다. "}
                  {funStats.weekdayExpense + funStats.weekendExpense > 0 && (
                    <>주말 지출 비중 {Math.round((funStats.weekendExpense / (funStats.weekdayExpense + funStats.weekendExpense)) * 100)}%. </>
                  )}
                  {funStats.cafeCount > 10 && "카페 지출이 잦습니다. "}
                  {funStats.diningCount > 15 && "외식/배달 빈도가 높습니다. "}
                  일 평균 {formatKRW(Math.round(funStats.avgDaily))}.
                </span>
              </div>
            </div>
          </div>
        </>
      )}

    </div>
  );
};
