import React, { lazy, Suspense, useMemo, useState } from "react";
import { DeferredResponsiveContainer as ResponsiveContainer } from "../components/charts/DeferredResponsiveContainer";
import type {
  Account,
  LedgerEntry,
  RecurringExpense,
  StockPrice,
  StockTrade
} from "../types";
import {
  computeAccountBalances,
  computeBalanceAtDateForAccounts,
  computePositions,
  computeRealizedPnlByTradeId,
  computeTotalDebt,
  computeTotalNetWorth,
  computeTotalSavings,
  positionMarketValueKRW
} from "../calculations";
import { formatKRW } from "../utils/formatter";
import { useFxRateValue } from "../context/FxRateContext";
import { useAppStore } from "../store/appStore";
import { getThisMonthKST, getTodayKST } from "../utils/date";
import { getCategoryType, getSavingsCategories, isSavingsExpenseEntry } from "../utils/category";
import { canonicalTickerForMatch, extractTickerFromText, isUSDStock } from "../utils/finance";
import { parseQuantityFromNote } from "../utils/dividend";
import { ISA_PORTFOLIO } from "../constants/config";
const LazyPortfolioDashboardCharts = lazy(() =>
  import("../features/stocks/PortfolioDashboardCharts").then((m) => ({ default: m.PortfolioDashboardCharts }))
);

// 인라인 차트 — recharts가 초기 번들에 포함되지 않도록 개별 lazy import
const LazyWeekendChart = lazy(() =>
  import("../features/dashboard/DashboardInlineCharts").then((m) => ({ default: m.WeekendChart }))
);
const LazyAssetTreemap = lazy(() =>
  import("../features/dashboard/DashboardInlineCharts").then((m) => ({ default: m.AssetTreemap }))
);
const LazyAccountBalanceChart = lazy(() =>
  import("../features/dashboard/DashboardInlineCharts").then((m) => ({ default: m.AccountBalanceChart }))
);
const LazyDividendTrendChart = lazy(() =>
  import("../features/dashboard/DashboardInlineCharts").then((m) => ({ default: m.DividendTrendChart }))
);
const LazySpendingLineChart = lazy(() =>
  import("../features/dashboard/DashboardInlineCharts").then((m) => ({ default: m.SpendingLineChart }))
);
const LazyMonthlySavingsBarChart = lazy(() =>
  import("../features/dashboard/DashboardInlineCharts").then((m) => ({ default: m.MonthlySavingsBarChart }))
);
const LazyCategorySpendBarChart = lazy(() =>
  import("../features/dashboard/DashboardInlineCharts").then((m) => ({ default: m.CategorySpendBarChart }))
);
const LazyDowPatternChart = lazy(() =>
  import("../features/dashboard/DashboardInlineCharts").then((m) => ({ default: m.DowPatternChart }))
);
const LazyMonthlySavingsRateChart = lazy(() =>
  import("../features/dashboard/DashboardInlineCharts").then((m) => ({ default: m.MonthlySavingsRateChart }))
);
const LazyCumulativePnlAreaChart = lazy(() =>
  import("../features/dashboard/DashboardInlineCharts").then((m) => ({ default: m.CumulativePnlAreaChart }))
);

interface Props {
  accounts?: Account[];
  ledger?: LedgerEntry[];
  trades?: StockTrade[];
  prices?: StockPrice[];
}

type SpendingCalendarRow = {
  id: string;
  date: string;
  title: string;
  category: string;
  amount: number;
  type: "spending" | "investing" | "income";
  fromAccountId?: string;
  fromAccountName?: string;
  toAccountId?: string;
  toAccountName?: string;
  source: "ledger";
};

type UpcomingCashflowRow = {
  id: string;
  date: string;
  title: string;
  category: string;
  amount: number;
  fromAccountId?: string;
  fromAccountName?: string;
  source: "ledger" | "recurring";
};

type SpendingByDate = { spending: number; investing: number; income: number; count: number };

type CalendarCell = {
  date: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  spending: number;
  investing: number;
  income: number;
  count: number;
};

const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

function getLastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function parseIsoLocal(date: string): Date | null {
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return null;
  const parsed = new Date(y, m - 1, d);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatIsoLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDaysToIso(date: string, days: number): string {
  const parsed = parseIsoLocal(date);
  if (!parsed) return date;
  parsed.setDate(parsed.getDate() + days);
  return formatIsoLocal(parsed);
}

function shiftMonth(month: string, offset: number): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  const shifted = new Date(y, m - 1 + offset, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthEndDate(month: string): string {
  const [year, monthNum] = month.split("-").map(Number);
  const lastDay = new Date(year, monthNum, 0).getDate();
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}

function buildMonthRange(startMonth: string, endMonth: string): string[] {
  const result: string[] = [];
  let [year, month] = startMonth.split("-").map(Number);
  const [endYear, endMonthNum] = endMonth.split("-").map(Number);

  while (year < endYear || (year === endYear && month <= endMonthNum)) {
    result.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return result;
}

function isDividendIncome(entry: LedgerEntry): boolean {
  if (entry.kind !== "income") return false;
  return (
    (entry.category ?? "").includes("배당") ||
    (entry.subCategory ?? "").includes("배당") ||
    (entry.description ?? "").includes("배당")
  );
}

function makeCashflowKey(
  date: string,
  amount: number,
  category: string,
  title: string,
  fromAccountId?: string,
  toAccountId?: string
): string {
  return [
    date,
    amount.toFixed(2),
    category,
    title,
    fromAccountId ?? "",
    toAccountId ?? ""
  ].join("|");
}
function generateRecurringOutflows(
  recurring: RecurringExpense[],
  windowStart: string,
  windowEnd: string,
  accountNameById: Map<string, string>,
  existingKeys: Set<string>
): UpcomingCashflowRow[] {
  const rows: UpcomingCashflowRow[] = [];
  const windowStartDate = parseIsoLocal(windowStart);
  const windowEndDate = parseIsoLocal(windowEnd);
  if (!windowStartDate || !windowEndDate) return rows;

  for (const item of recurring) {
    if (!item.startDate || item.amount <= 0) continue;
    const startDate = parseIsoLocal(item.startDate);
    if (!startDate) continue;
    if (item.endDate && item.endDate < windowStart) continue;

    const title = item.title || item.category || "반복 지출";
    const category = item.toAccountId
      ? `이체${item.category ? `/${item.category}` : ""}`
      : (item.category || "고정지출");

    const addOccurrence = (date: string) => {
      if (date < windowStart || date > windowEnd) return;
      if (date < item.startDate) return;
      if (item.endDate && date > item.endDate) return;
      const key = makeCashflowKey(
        date,
        item.amount,
        category,
        title,
        item.fromAccountId,
        item.toAccountId
      );
      if (existingKeys.has(key)) return;
      existingKeys.add(key);
      rows.push({
        id: `${item.id}:${date}`,
        date,
        title,
        category,
        amount: item.amount,
        fromAccountId: item.fromAccountId,
        fromAccountName: item.fromAccountId
          ? accountNameById.get(item.fromAccountId)
          : undefined,
        source: "recurring"
      });
    };

    if (item.frequency === "weekly") {
      const cursor = new Date(startDate);
      if (cursor < windowStartDate) {
        const diffMs = windowStartDate.getTime() - cursor.getTime();
        const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
        const step = Math.ceil(diffDays / 7);
        cursor.setDate(cursor.getDate() + step * 7);
      }
      while (cursor <= windowEndDate) {
        const date = formatIsoLocal(cursor);
        if (item.endDate && date > item.endDate) break;
        addOccurrence(date);
        cursor.setDate(cursor.getDate() + 7);
      }
      continue;
    }

    if (item.frequency === "monthly") {
      const anchorDay = startDate.getDate();
      let year = startDate.getFullYear();
      let month = startDate.getMonth() + 1;
      const endYear = windowEndDate.getFullYear();
      const endMonth = windowEndDate.getMonth() + 1;

      while (year < endYear || (year === endYear && month <= endMonth)) {
        const day = Math.min(anchorDay, getLastDayOfMonth(year, month));
        const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        if (item.endDate && date > item.endDate) break;
        addOccurrence(date);
        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
      }
      continue;
    }

    const anchorMonth = startDate.getMonth() + 1;
    const anchorDay = startDate.getDate();
    let year = startDate.getFullYear();
    const endYear = windowEndDate.getFullYear();

    while (year <= endYear) {
      const day = Math.min(anchorDay, getLastDayOfMonth(year, anchorMonth));
      const date = `${year}-${String(anchorMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (item.endDate && date > item.endDate) break;
      addOccurrence(date);
      year += 1;
    }
  }

  return rows;
}

function buildCalendarCells(
  month: string,
  byDate: Map<string, SpendingByDate>,
  today: string
): CalendarCell[] {
  const [year, monthNum] = month.split("-").map(Number);
  if (!year || !monthNum) return [];

  const firstDay = new Date(year, monthNum - 1, 1);
  const startOffset = firstDay.getDay();
  const start = new Date(year, monthNum - 1, 1 - startOffset);

  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const current = new Date(start);
    current.setDate(start.getDate() + i);
    const date = formatIsoLocal(current);
    const summary = byDate.get(date);
    cells.push({
      date,
      day: current.getDate(),
      inMonth: date.slice(0, 7) === month,
      isToday: date === today,
      spending: summary?.spending ?? 0,
      investing: summary?.investing ?? 0,
      income: summary?.income ?? 0,
      count: summary?.count ?? 0
    });
  }
  return cells;
}

export const DashboardView: React.FC<Props> = (props) => {
  const storeData = useAppStore((s) => s.data);
  const accounts = props.accounts ?? storeData.accounts;
  const ledger = props.ledger ?? storeData.ledger;
  const trades = props.trades ?? storeData.trades;
  const prices = props.prices ?? storeData.prices;
  const recurring = storeData.recurringExpenses ?? [];
  const categoryPresets = storeData.categoryPresets;
  const trackedTicker = canonicalTickerForMatch(
    (storeData.dividendTrackingTicker ?? "458730").trim() || "458730"
  );
  const trackedTickerName =
    ISA_PORTFOLIO.find((x) => canonicalTickerForMatch(x.ticker) === trackedTicker)?.name ??
    storeData.tickerDatabase?.find((t) => canonicalTickerForMatch(t.ticker) === trackedTicker)?.name ??
    trackedTicker;

  /** 배당·해당금액 변동 카드에서 추적할 종목 (종목코드 표기) */
  const RISE_200_TICKER = "0167B0";
  const rise200Canonical = canonicalTickerForMatch(RISE_200_TICKER);
  const rise200TickerName =
    ISA_PORTFOLIO.find((x) => canonicalTickerForMatch(x.ticker) === rise200Canonical)?.name?.trim() ||
    storeData.tickerDatabase?.find((t) => canonicalTickerForMatch(t.ticker) === rise200Canonical)?.name?.trim() ||
    prices.find((p) => canonicalTickerForMatch(p.ticker) === rise200Canonical)?.name?.trim() ||
    trades.find((t) => canonicalTickerForMatch(t.ticker) === rise200Canonical)?.name?.trim() ||
    "";
  const rise200CardTitle =
    rise200TickerName !== ""
      ? `${RISE_200_TICKER} · ${rise200TickerName} 해당금액 변동 (전체 기준)`
      : `${RISE_200_TICKER} 해당금액 변동 (전체 기준)`;

  const fxRate = useFxRateValue();
  const currentMonth = useMemo(() => getThisMonthKST(), []);
  const today = useMemo(() => getTodayKST(), []);

  const [cashflowMonth, setCashflowMonth] = useState<string>(currentMonth);
  const [spendingFilterType, setSpendingFilterType] = useState<"" | "spending" | "investing" | "income">("");
  const [accountBalanceChartView, setAccountBalanceChartView] = useState<string>("total");

  const monthRange = useMemo(() => {
    const monthSet = new Set<string>();
    ledger.forEach((l) => l.date && monthSet.add(l.date.slice(0, 7)));
    trades.forEach((t) => t.date && monthSet.add(t.date.slice(0, 7)));
    monthSet.add(currentMonth);
    const sorted = Array.from(monthSet).sort();
    if (sorted.length === 0) return [] as string[];
    return buildMonthRange(sorted[0], sorted[sorted.length - 1]);
  }, [ledger, trades, currentMonth]);

  const adjustedPrices = useMemo(() => {
    if (!fxRate) return prices;
    return prices.map((p) =>
      p.currency === "USD" ? { ...p, price: p.price * fxRate, currency: "KRW" as const } : p
    );
  }, [prices, fxRate]);

  /** 매월 15일·월말 스냅샷 날짜 (오늘 이전만) */
  const balanceSnapshotDates = useMemo(() => {
    const out: string[] = [];
    monthRange.forEach((month) => {
      const d15 = `${month}-15`;
      const dEnd = getMonthEndDate(month);
      if (d15 <= today) out.push(d15);
      if (dEnd <= today) out.push(dEnd);
    });
    return out.sort();
  }, [monthRange, today]);

  /** 계좌별 잔액 스냅샷 (매월 15·월말): 그 시점 현금+주식평가금+USD환산. 가격은 해당 일자 이전 시세 사용, 없으면 매입원가로 평가 */
  const accountBalanceSnapshots = useMemo(() => {
    if (balanceSnapshotDates.length === 0 || accounts.length === 0) return [];
    return balanceSnapshotDates.map((dateStr) => {
      const pricesAsOfDate = adjustedPrices.filter((p) => {
        if (!p.updatedAt) return false;
        return p.updatedAt.slice(0, 10) <= dateStr;
      });
      const row: Record<string, number | string> = {
        date: dateStr,
        label: dateStr.slice(5, 7) + "-" + dateStr.slice(8, 10)
      };
      let total = 0;
      accounts.forEach((account) => {
        const bal = computeBalanceAtDateForAccounts(
          accounts,
          ledger,
          trades,
          dateStr,
          new Set([account.id]),
          pricesAsOfDate,
          { fxRate: fxRate ?? null, priceFallback: "cost" }
        );
        row[account.id] = bal;
        total += bal;
      });
      row.total = total;
      return row;
    });
  }, [balanceSnapshotDates, accounts, ledger, trades, adjustedPrices, fxRate]);

  /** 전체 기간 합계: 수입, 일반 지출, 재테크 지출 */
  const allTimeSummary = useMemo(() => {
    const toKrw = (entry: LedgerEntry) =>
      entry.currency === "USD" && fxRate ? entry.amount * fxRate : entry.amount;
    let income = 0;
    let expense = 0;
    let investing = 0;
    ledger.forEach((entry) => {
      if (!entry.date) return;
      if (entry.kind === "income") {
        income += toKrw(entry);
        return;
      }
      if (entry.kind === "expense") {
        if (isSavingsExpenseEntry(entry, accounts, categoryPresets)) {
          investing += toKrw(entry);
        } else {
          expense += toKrw(entry);
        }
      }
    });
    return { income, expense, investing };
  }, [ledger, fxRate, accounts, categoryPresets]);

  const monthlySummary = useMemo(() => {
    const toKrw = (entry: LedgerEntry) =>
      entry.currency === "USD" && fxRate ? entry.amount * fxRate : entry.amount;

    let income = 0;
    let expense = 0;
    let investing = 0;

    ledger.forEach((entry) => {
      if (!entry.date || !entry.date.startsWith(currentMonth)) return;

      if (entry.kind === "income") {
        income += toKrw(entry);
        return;
      }

      if (entry.kind === "expense") {
        if (isSavingsExpenseEntry(entry, accounts, categoryPresets)) {
          investing += toKrw(entry);
        } else {
          expense += toKrw(entry);
        }
      }
    });

    return {
      month: currentMonth,
      income,
      expense,
      investing
    };
  }, [ledger, currentMonth, fxRate, accounts, categoryPresets]);

  /** 이번 달 재테크 세부: 저축, 투자, 투자수익, 투자손실 (가계부 category=재테크 기준) */
  const monthlyRecheckBreakdown = useMemo(() => {
    const toKrw = (entry: LedgerEntry) =>
      entry.currency === "USD" && fxRate ? entry.amount * fxRate : entry.amount;
    const sub = { 저축: 0, 투자: 0, 투자수익: 0, 투자손실: 0 };
    ledger.forEach((entry) => {
      if (!entry.date?.startsWith(currentMonth) || entry.kind !== "expense" || entry.category !== "재테크") return;
      const amt = toKrw(entry);
      const key = entry.subCategory as keyof typeof sub;
      if (key in sub) sub[key] += amt;
      else if (entry.subCategory === "주식매수") sub.투자 += amt;
    });
    return sub;
  }, [ledger, currentMonth, fxRate]);

  const lastMonth = useMemo(() => shiftMonth(currentMonth, -1), [currentMonth]);

  /** 저번달 요약 (저축 대비 비교 위젯용) */
  const lastMonthSummary = useMemo(() => {
    const toKrw = (entry: LedgerEntry) =>
      entry.currency === "USD" && fxRate ? entry.amount * fxRate : entry.amount;
    let income = 0;
    let expense = 0;
    let investing = 0;
    ledger.forEach((entry) => {
      if (!entry.date || !entry.date.startsWith(lastMonth)) return;
      if (entry.kind === "income") {
        income += toKrw(entry);
        return;
      }
      if (entry.kind === "expense") {
        if (isSavingsExpenseEntry(entry, accounts, categoryPresets)) {
          investing += toKrw(entry);
        } else {
          expense += toKrw(entry);
        }
      }
    });
    return { month: lastMonth, income, expense, investing };
  }, [ledger, lastMonth, fxRate, accounts, categoryPresets]);

  /** 저번달 재테크 세부 (저축 대비 비교 위젯용) */
  const lastMonthRecheckBreakdown = useMemo(() => {
    const toKrw = (entry: LedgerEntry) =>
      entry.currency === "USD" && fxRate ? entry.amount * fxRate : entry.amount;
    const sub = { 저축: 0, 투자: 0, 투자수익: 0, 투자손실: 0 };
    ledger.forEach((entry) => {
      if (!entry.date?.startsWith(lastMonth) || entry.kind !== "expense" || entry.category !== "재테크") return;
      const amt = toKrw(entry);
      const key = entry.subCategory as keyof typeof sub;
      if (key in sub) sub[key] += amt;
      else if (entry.subCategory === "주식매수") sub.투자 += amt;
    });
    return sub;
  }, [ledger, lastMonth, fxRate]);

  const lastMonthSavingsRate = useMemo(() => {
    const { income, investing } = lastMonthSummary;
    if (income <= 0) return null;
    return (investing / income) * 100;
  }, [lastMonthSummary]);

  const lastMonthInvestingRatio = useMemo(() => {
    const 저축 = lastMonthRecheckBreakdown.저축;
    const 투자 = lastMonthRecheckBreakdown.투자;
    const total = 저축 + 투자;
    if (total <= 0) return { stockPct: 0, savingsPct: 0 };
    return {
      stockPct: (투자 / total) * 100,
      savingsPct: (저축 / total) * 100
    };
  }, [lastMonthRecheckBreakdown]);

  /** 누적 실현손익: 매도 건 FIFO 실현손익 합계 (원화 환산) */
  const totalRealizedPnl = useMemo(() => {
    const byId = computeRealizedPnlByTradeId(trades);
    let krw = 0;
    trades.forEach((t) => {
      if (t.side !== "sell") return;
      const pnl = byId.get(t.id) ?? 0;
      krw += isUSDStock(t.ticker) && fxRate ? pnl * fxRate : pnl;
    });
    return krw;
  }, [trades, fxRate]);

  const balances = useMemo(
    () => computeAccountBalances(accounts, ledger, trades),
    [accounts, ledger, trades]
  );

  const positions = useMemo(
    () =>
      computePositions(trades, adjustedPrices, accounts, {
        fxRate: fxRate ?? undefined,
        priceFallback: "cost"
      }),
    [trades, adjustedPrices, accounts, fxRate]
  );

  const positionsWithPrice = useMemo(() => {
    const accountNameById = new Map(accounts.map((a) => [a.id, a.name ?? a.id]));
    return positions.map((p) => ({
      accountId: p.accountId,
      accountName: accountNameById.get(p.accountId) ?? p.accountId,
      ticker: p.ticker,
      name: p.name,
      marketValue: p.marketValue,
      currency: isUSDStock(p.ticker) ? "USD" : "KRW"
    }));
  }, [positions, accounts]);

  const positionsByAccount = useMemo(() => {
    const map = new Map<string, { accountId: string; accountName: string; rows: any[] }>();
    for (const p of positionsWithPrice) {
      const prev = map.get(p.accountId);
      if (prev) prev.rows.push(p);
      else map.set(p.accountId, { accountId: p.accountId, accountName: p.accountName, rows: [p] });
    }
    return Array.from(map.values()).sort((a, b) => a.accountName.localeCompare(b.accountName));
  }, [positionsWithPrice]);

  const totalSavings = useMemo(
    () => computeTotalSavings(balances, accounts),
    [balances, accounts]
  );
  const totalStock = useMemo(
    () => positions.reduce((s, p) => s + positionMarketValueKRW(p, fxRate), 0),
    [positions, fxRate]
  );
  const totalDebt = useMemo(() => computeTotalDebt(accounts), [accounts]);
  const totalNetWorth = useMemo(
    () => computeTotalNetWorth(balances, positions, fxRate),
    [balances, positions, fxRate]
  );

  const accountTimelineRows = useMemo(() => {
    type AccountTimelineRow = {
      month: string;
      stock: number;
      savings: number;
      total: number;
    };

    const accountById = new Map(accounts.map((account) => [account.id, account]));
    const ledgerByMonth = new Map<string, LedgerEntry[]>();
    const tradesByMonth = new Map<string, StockTrade[]>();

    ledger.forEach((entry) => {
      if (!entry.date) return;
      const month = entry.date.slice(0, 7);
      const rows = ledgerByMonth.get(month);
      if (rows) rows.push(entry);
      else ledgerByMonth.set(month, [entry]);
    });
    trades.forEach((trade) => {
      if (!trade.date) return;
      const month = trade.date.slice(0, 7);
      const rows = tradesByMonth.get(month);
      if (rows) rows.push(trade);
      else tradesByMonth.set(month, [trade]);
    });

    const runningBalanceByAccount = new Map<string, number>();
    const runningUsdTransferNetByAccount = new Map<string, number>();
    accounts.forEach((account) => {
      const baseBalance =
        account.type === "securities" || account.type === "crypto"
          ? (account.initialCashBalance ?? account.initialBalance)
          : account.initialBalance;
      runningBalanceByAccount.set(
        account.id,
        baseBalance + (account.cashAdjustment ?? 0) + (account.savings ?? 0)
      );
      runningUsdTransferNetByAccount.set(account.id, 0);
    });

    const runningTrades: StockTrade[] = [];
    const rows: AccountTimelineRow[] = [];

    monthRange.forEach((month) => {
      const monthLedger = ledgerByMonth.get(month) ?? [];
      for (const entry of monthLedger) {
        if (entry.kind === "income" && entry.toAccountId) {
          runningBalanceByAccount.set(
            entry.toAccountId,
            (runningBalanceByAccount.get(entry.toAccountId) ?? 0) + entry.amount
          );
          continue;
        }
        if (entry.kind === "expense") {
          if (entry.fromAccountId) {
            runningBalanceByAccount.set(
              entry.fromAccountId,
              (runningBalanceByAccount.get(entry.fromAccountId) ?? 0) - entry.amount
            );
          }
          if (entry.toAccountId) {
            runningBalanceByAccount.set(
              entry.toAccountId,
              (runningBalanceByAccount.get(entry.toAccountId) ?? 0) + entry.amount
            );
          }
          continue;
        }
        if (entry.kind === "transfer") {
          if (entry.currency === "USD") {
            if (entry.fromAccountId) {
              runningUsdTransferNetByAccount.set(
                entry.fromAccountId,
                (runningUsdTransferNetByAccount.get(entry.fromAccountId) ?? 0) - entry.amount
              );
            }
            if (entry.toAccountId) {
              runningUsdTransferNetByAccount.set(
                entry.toAccountId,
                (runningUsdTransferNetByAccount.get(entry.toAccountId) ?? 0) + entry.amount
              );
            }
          } else {
            if (entry.fromAccountId) {
              runningBalanceByAccount.set(
                entry.fromAccountId,
                (runningBalanceByAccount.get(entry.fromAccountId) ?? 0) - entry.amount
              );
            }
            if (entry.toAccountId) {
              runningBalanceByAccount.set(
                entry.toAccountId,
                (runningBalanceByAccount.get(entry.toAccountId) ?? 0) + entry.amount
              );
            }
          }
        }
      }

      const monthTrades = tradesByMonth.get(month) ?? [];
      for (const trade of monthTrades) {
        runningTrades.push(trade);
        const account = accountById.get(trade.accountId);
        if ((account?.type === "securities" || account?.type === "crypto") && isUSDStock(trade.ticker)) continue;
        runningBalanceByAccount.set(
          trade.accountId,
          (runningBalanceByAccount.get(trade.accountId) ?? 0) + trade.cashImpact
        );
      }

      const monthEndDate = getMonthEndDate(month);
      const monthPrices = adjustedPrices.filter((price) => {
        if (month === currentMonth) return true;
        if (!price.updatedAt) return false;
        return price.updatedAt.slice(0, 10) <= monthEndDate;
      });
      const monthPositions = computePositions(runningTrades, monthPrices, accounts, {
        fxRate: fxRate ?? undefined,
        priceFallback: "cost"
      });
      const stockByAccount = new Map<string, number>();
      monthPositions.forEach((position) => {
        stockByAccount.set(
          position.accountId,
          (stockByAccount.get(position.accountId) ?? 0) +
            positionMarketValueKRW(position, fxRate)
        );
      });

      let totalStockValue = 0;
      let totalSavingsValue = 0;
      let totalValue = 0;
      const row: AccountTimelineRow = { month, stock: 0, savings: 0, total: 0 };
      accounts.forEach((account) => {
        const cash = runningBalanceByAccount.get(account.id) ?? 0;
        const usdCash =
          account.type === "securities" || account.type === "crypto"
            ? (account.usdBalance ?? 0) + (runningUsdTransferNetByAccount.get(account.id) ?? 0)
            : 0;
        const usdToKrw = fxRate && usdCash !== 0 ? usdCash * fxRate : 0;
        const stock = stockByAccount.get(account.id) ?? 0;
        const debt = account.debt ?? 0;
        const accountValue = cash + usdToKrw + stock + debt;
        totalValue += accountValue;

        if (account.type === "securities" || account.type === "crypto") {
          totalStockValue += stock;
        } else if (account.type === "savings") {
          totalSavingsValue += cash + debt;
        }
      });

      row.stock = totalStockValue;
      row.savings = totalSavingsValue;
      row.total = totalValue;
      rows.push(row);
    });

    return rows;
  }, [monthRange, ledger, trades, adjustedPrices, accounts, fxRate, currentMonth]);

  const savingsRate = useMemo(() => {
    const { income, investing } = monthlySummary;
    if (income <= 0) return null;
    return (investing / income) * 100;
  }, [monthlySummary]);


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

  const portfolioTreemapData = useMemo(() => {
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

  const investingSavingsRatio = useMemo(() => {
    const investable = totalStock + totalSavings;
    if (investable <= 0) return { stockPct: 0, savingsPct: 0 };
    return {
      stockPct: (totalStock / investable) * 100,
      savingsPct: (totalSavings / investable) * 100
    };
  }, [totalStock, totalSavings]);

  const dividendCoverage = useMemo(() => {
    const months = [shiftMonth(currentMonth, -2), shiftMonth(currentMonth, -1), currentMonth];
    const monthSetRecent = new Set(months);
    const toKrw = (entry: LedgerEntry) =>
      entry.currency === "USD" && fxRate ? entry.amount * fxRate : entry.amount;
    const dividendByMonth = new Map<string, number>();
    const fixedByMonth = new Map<string, number>();

    for (const entry of ledger) {
      const month = entry.date?.slice(0, 7);
      if (!month || !monthSetRecent.has(month)) continue;

      if (isDividendIncome(entry)) {
        dividendByMonth.set(month, (dividendByMonth.get(month) ?? 0) + toKrw(entry));
        continue;
      }
      if (entry.kind !== "expense") continue;
      if (isSavingsExpenseEntry(entry, accounts, categoryPresets)) continue;
      const categoryType = getCategoryType(
        entry.category,
        entry.subCategory,
        entry.kind,
        categoryPresets,
        entry,
        accounts
      );
      if (categoryType === "fixed" || entry.isFixedExpense) {
        fixedByMonth.set(month, (fixedByMonth.get(month) ?? 0) + toKrw(entry));
      }
    }

    const rows = months.map((month) => {
      const dividend = dividendByMonth.get(month) ?? 0;
      const fixedExpense = fixedByMonth.get(month) ?? 0;
      return {
        month,
        dividend,
        fixedExpense,
        coverageRate: fixedExpense > 0 ? (dividend / fixedExpense) * 100 : null
      };
    });

    const monthlyDividendAvg =
      rows.reduce((sum, row) => sum + row.dividend, 0) / months.length;
    const monthlyFixedExpenseAvg =
      rows.reduce((sum, row) => sum + row.fixedExpense, 0) / months.length;
    const coverageRate =
      monthlyFixedExpenseAvg > 0
        ? (monthlyDividendAvg / monthlyFixedExpenseAvg) * 100
        : null;

    return {
      months,
      rows,
      monthlyDividendAvg,
      monthlyFixedExpenseAvg,
      coverageRate
    };
  }, [ledger, fxRate, accounts, categoryPresets, currentMonth]);

  const trackedDividendTrend = useMemo(() => {
    type TrendRow = {
      month: string;
      shares: number;
      dividend: number;
      costBasis: number;
      yieldRate: number | null;
    };

    const toKrw = (entry: LedgerEntry) =>
      entry.currency === "USD" && fxRate ? entry.amount * fxRate : entry.amount;
    const dividendByMonth = new Map<string, number>();
    /** 배당 수령일별 금액 + 입금 계좌(해당 계좌 기준 평단가/매입금액) */
    const dividendEntriesByDate: { date: string; amount: number; quantityFromNote?: number; toAccountId?: string }[] = [];
    const tickerTrades = trades
      .filter((trade) => canonicalTickerForMatch(trade.ticker) === trackedTicker)
      .sort((a, b) => a.date.localeCompare(b.date));
    const monthSet = new Set<string>();

    ledger.forEach((entry) => {
      if (!isDividendIncome(entry)) return;
      const sourceTicker = (
        extractTickerFromText(entry.description ?? "") ??
        extractTickerFromText(entry.subCategory ?? "") ??
        extractTickerFromText(entry.category ?? "")
      )?.toUpperCase();
      if (!sourceTicker) return;
      if (canonicalTickerForMatch(sourceTicker) !== trackedTicker) return;
      const date = entry.date?.slice(0, 10);
      const month = entry.date?.slice(0, 7);
      if (!date || !month) return;
      const amount = toKrw(entry);
      dividendByMonth.set(month, (dividendByMonth.get(month) ?? 0) + amount);
      const quantityFromNote = parseQuantityFromNote(entry.note) ?? undefined;
      dividendEntriesByDate.push({ date, amount, quantityFromNote, toAccountId: entry.toAccountId });
      monthSet.add(month);
    });
    dividendEntriesByDate.sort((a, b) => a.date.localeCompare(b.date));

    tickerTrades.forEach((trade) => monthSet.add(trade.date.slice(0, 7)));
    const months = Array.from(monthSet).sort();
    if (months.length === 0) {
      return {
        ticker: trackedTicker,
        rows: [] as TrendRow[],
        latest: null as TrendRow | null,
        previous: null as TrendRow | null,
        shareChange: 0,
        shareChangeRate: null as number | null,
        dividendChange: 0,
        dividendChangeRate: null as number | null,
        yieldChange: 0,
        yieldChangeRate: null as number | null,
        changeRate: null as number | null,
        yieldSumLast12Months: null as number | null
      };
    }

    /** 해당일 기준 보유 주식 수 (그날 거래 제외 = “배당 받을 때” 보유, 모든 계좌 합산) */
    const getQuantityAtDate = (ticker: string, date: string, accountId?: string): number => {
      const ct = canonicalTickerForMatch(ticker);
      const relevant = trades.filter(
        (t) =>
          canonicalTickerForMatch(t.ticker) === ct &&
          t.date < date &&
          (!accountId || t.accountId === accountId)
      );
      let qty = 0;
      for (const t of relevant) {
        const side = (t.side ?? "").toString().toLowerCase();
        if (side === "buy") qty += t.quantity;
        else if (side === "sell") qty -= t.quantity;
      }
      return Math.max(0, qty);
    };

    type Lot = { qty: number; totalAmount: number };
    /** 해당일 거래 전 매입원가 합계(FIFO). accountId 있으면 해당 계좌만. 달러 종목은 호출부에서 원화 환산 */
    const getCostBasisAtDate = (beforeDate: string, accountId?: string): number => {
      const list = accountId ? tickerTrades.filter((t) => t.accountId === accountId) : tickerTrades;
      const lots: Lot[] = [];
      for (const trade of list) {
        if (trade.date >= beforeDate) break;
        const side = (trade.side ?? "").toString().toLowerCase();
        if (side === "buy") {
          lots.push({ qty: trade.quantity, totalAmount: trade.totalAmount });
        } else if (side === "sell") {
          let remaining = trade.quantity;
          while (remaining > 0 && lots.length > 0) {
            const lot = lots[0];
            const used = Math.min(remaining, lot.qty);
            const usedCost = lot.qty > 0 ? (lot.totalAmount / lot.qty) * used : 0;
            lot.qty -= used;
            lot.totalAmount -= usedCost;
            remaining -= used;
            if (lot.qty <= 0) lots.shift();
          }
        }
      }
      return lots.reduce((sum, lot) => sum + lot.totalAmount, 0);
    };

    const fullMonths = buildMonthRange(months[0], months[months.length - 1]);
    const lots: Lot[] = [];
    let tradeIndex = 0;
    const rows: TrendRow[] = [];
    let prevYieldRate: number | null = null;

    for (const month of fullMonths) {
      while (
        tradeIndex < tickerTrades.length &&
        tickerTrades[tradeIndex].date.slice(0, 7) <= month
      ) {
        const trade = tickerTrades[tradeIndex];
        const side = (trade.side ?? "").toString().toLowerCase();
        if (side === "buy") {
          lots.push({ qty: trade.quantity, totalAmount: trade.totalAmount });
        } else if (side === "sell") {
          let remaining = trade.quantity;
          while (remaining > 0 && lots.length > 0) {
            const lot = lots[0];
            const used = Math.min(remaining, lot.qty);
            const usedCost = lot.qty > 0 ? (lot.totalAmount / lot.qty) * used : 0;
            lot.qty -= used;
            lot.totalAmount -= usedCost;
            remaining -= used;
            if (lot.qty <= 0) lots.shift();
          }
        }
        tradeIndex += 1;
      }

      const dividend = dividendByMonth.get(month) ?? 0;
      const entriesInMonth = dividendEntriesByDate.filter((e) => e.date.startsWith(month));
      const firstEntry = entriesInMonth[0];
      const accountIdForMonth = firstEntry?.toAccountId;
      const firstEntryWithQty = entriesInMonth.find((e) => e.quantityFromNote != null);
      const shares =
        firstEntryWithQty?.quantityFromNote != null
          ? firstEntryWithQty.quantityFromNote
          : entriesInMonth.length > 0
            ? getQuantityAtDate(trackedTicker, firstEntry.date, accountIdForMonth)
            : lots.reduce((sum, lot) => sum + lot.qty, 0);
      let effectiveCostBasis = 0;
      for (const e of entriesInMonth) {
        const costAtPaymentDate = getCostBasisAtDate(e.date, e.toAccountId ?? accountIdForMonth);
        effectiveCostBasis += costAtPaymentDate;
      }
      // 달러 종목: 매입금액을 원화로 환산해 배당금(원화)과 동일 단위로 배당률 계산
      if (isUSDStock(trackedTicker) && fxRate && effectiveCostBasis > 0) {
        effectiveCostBasis = effectiveCostBasis * fxRate;
      }
      let yieldRate: number | null =
        dividend > 0 && effectiveCostBasis > 0 ? (dividend / effectiveCostBasis) * 100 : null;
      if (yieldRate != null) prevYieldRate = yieldRate;
      else if (prevYieldRate != null) yieldRate = prevYieldRate; // 배당 0인 달은 이전 달 배당률 유지(그래프 끊김 방지)

      rows.push({
        month,
        shares,
        dividend,
        costBasis: effectiveCostBasis,
        yieldRate
      });
    }

    const latest = rows.length > 0 ? rows[rows.length - 1] : null;
    const previous = rows.length > 1 ? rows[rows.length - 2] : null;
    const shareChange = latest && previous ? latest.shares - previous.shares : 0;
    const shareChangeRate =
      latest && previous && previous.shares > 0
        ? (shareChange / previous.shares) * 100
        : null;
    const dividendChange =
      latest && previous ? latest.dividend - previous.dividend : 0;
    const dividendChangeRate =
      latest && previous && previous.dividend > 0
        ? (dividendChange / previous.dividend) * 100
        : null;
    const yieldChange =
      latest &&
      previous &&
      latest.yieldRate != null &&
      previous.yieldRate != null
        ? latest.yieldRate - previous.yieldRate
        : 0;
    const yieldChangeRate =
      latest &&
      previous &&
      latest.yieldRate != null &&
      previous.yieldRate != null &&
      previous.yieldRate > 0
        ? (yieldChange / previous.yieldRate) * 100
        : null;

    const last12Rows = rows.slice(-12);
    const yieldSumLast12Months =
      last12Rows.length > 0
        ? last12Rows.reduce((sum, r) => sum + (r.yieldRate ?? 0), 0)
        : null;

    return {
      ticker: trackedTicker,
      rows,
      latest,
      previous,
      shareChange,
      shareChangeRate,
      dividendChange,
      dividendChangeRate,
      yieldChange,
      yieldChangeRate,
      changeRate: dividendChangeRate,
      yieldSumLast12Months
    };
  }, [ledger, trades, fxRate, trackedTicker]);

  const rise200DividendTrend = useMemo(() => {
    type TrendRow = {
      month: string;
      shares: number;
      dividend: number;
      costBasis: number;
      yieldRate: number | null;
    };
    const toKrw = (entry: LedgerEntry) =>
      entry.currency === "USD" && fxRate ? entry.amount * fxRate : entry.amount;
    const dividendByMonth = new Map<string, number>();
    const dividendEntriesByDate: { date: string; amount: number; quantityFromNote?: number; toAccountId?: string }[] = [];
    const tickerTrades = trades
      .filter((trade) => canonicalTickerForMatch(trade.ticker) === RISE_200_TICKER)
      .sort((a, b) => a.date.localeCompare(b.date));
    const monthSet = new Set<string>();
    ledger.forEach((entry) => {
      if (!isDividendIncome(entry)) return;
      const sourceTicker = (
        extractTickerFromText(entry.description ?? "") ??
        extractTickerFromText(entry.subCategory ?? "") ??
        extractTickerFromText(entry.category ?? "")
      )?.toUpperCase();
      if (!sourceTicker) return;
      if (canonicalTickerForMatch(sourceTicker) !== RISE_200_TICKER) return;
      const date = entry.date?.slice(0, 10);
      const month = entry.date?.slice(0, 7);
      if (!date || !month) return;
      const amount = toKrw(entry);
      dividendByMonth.set(month, (dividendByMonth.get(month) ?? 0) + amount);
      const quantityFromNote = parseQuantityFromNote(entry.note) ?? undefined;
      dividendEntriesByDate.push({ date, amount, quantityFromNote, toAccountId: entry.toAccountId });
      monthSet.add(month);
    });
    dividendEntriesByDate.sort((a, b) => a.date.localeCompare(b.date));
    tickerTrades.forEach((trade) => monthSet.add(trade.date.slice(0, 7)));
    const months = Array.from(monthSet).sort();
    if (months.length === 0) {
      return {
        ticker: RISE_200_TICKER,
        rows: [] as TrendRow[],
        latest: null as TrendRow | null,
        previous: null as TrendRow | null,
        shareChange: 0,
        shareChangeRate: null as number | null,
        dividendChange: 0,
        dividendChangeRate: null as number | null,
        yieldChange: 0,
        yieldChangeRate: null as number | null,
        changeRate: null as number | null,
        yieldSumLast12Months: null as number | null
      };
    }
    const getQuantityAtDate = (ticker: string, date: string, accountId?: string): number => {
      const ct = canonicalTickerForMatch(ticker);
      const relevant = trades.filter(
        (t) =>
          canonicalTickerForMatch(t.ticker) === ct &&
          t.date < date &&
          (!accountId || t.accountId === accountId)
      );
      let qty = 0;
      for (const t of relevant) {
        const side = (t.side ?? "").toString().toLowerCase();
        if (side === "buy") qty += t.quantity;
        else if (side === "sell") qty -= t.quantity;
      }
      return Math.max(0, qty);
    };
    type Lot = { qty: number; totalAmount: number };
    const getCostBasisAtDate = (beforeDate: string, accountId?: string): number => {
      const list = accountId ? tickerTrades.filter((t) => t.accountId === accountId) : tickerTrades;
      const lots: Lot[] = [];
      for (const trade of list) {
        if (trade.date >= beforeDate) break;
        const side = (trade.side ?? "").toString().toLowerCase();
        if (side === "buy") {
          lots.push({ qty: trade.quantity, totalAmount: trade.totalAmount });
        } else if (side === "sell") {
          let remaining = trade.quantity;
          while (remaining > 0 && lots.length > 0) {
            const lot = lots[0];
            const used = Math.min(remaining, lot.qty);
            const usedCost = lot.qty > 0 ? (lot.totalAmount / lot.qty) * used : 0;
            lot.qty -= used;
            lot.totalAmount -= usedCost;
            remaining -= used;
            if (lot.qty <= 0) lots.shift();
          }
        }
      }
      return lots.reduce((sum, lot) => sum + lot.totalAmount, 0);
    };
    const fullMonths = buildMonthRange(months[0], months[months.length - 1]);
    const lots: Lot[] = [];
    let tradeIndex = 0;
    const rows: TrendRow[] = [];
    let prevYieldRate: number | null = null;
    for (const month of fullMonths) {
      while (
        tradeIndex < tickerTrades.length &&
        tickerTrades[tradeIndex].date.slice(0, 7) <= month
      ) {
        const trade = tickerTrades[tradeIndex];
        const side = (trade.side ?? "").toString().toLowerCase();
        if (side === "buy") {
          lots.push({ qty: trade.quantity, totalAmount: trade.totalAmount });
        } else if (side === "sell") {
          let remaining = trade.quantity;
          while (remaining > 0 && lots.length > 0) {
            const lot = lots[0];
            const used = Math.min(remaining, lot.qty);
            const usedCost = lot.qty > 0 ? (lot.totalAmount / lot.qty) * used : 0;
            lot.qty -= used;
            lot.totalAmount -= usedCost;
            remaining -= used;
            if (lot.qty <= 0) lots.shift();
          }
        }
        tradeIndex += 1;
      }
      const dividend = dividendByMonth.get(month) ?? 0;
      const entriesInMonth = dividendEntriesByDate.filter((e) => e.date.startsWith(month));
      const firstEntry = entriesInMonth[0];
      const accountIdForMonth = firstEntry?.toAccountId;
      const firstEntryWithQty = entriesInMonth.find((e) => e.quantityFromNote != null);
      const shares =
        firstEntryWithQty?.quantityFromNote != null
          ? firstEntryWithQty.quantityFromNote
          : entriesInMonth.length > 0
            ? getQuantityAtDate(RISE_200_TICKER, firstEntry.date, accountIdForMonth)
            : lots.reduce((sum, lot) => sum + lot.qty, 0);
      let effectiveCostBasis = 0;
      for (const e of entriesInMonth) {
        const costAtPaymentDate = getCostBasisAtDate(e.date, e.toAccountId ?? accountIdForMonth);
        effectiveCostBasis += costAtPaymentDate;
      }
      if (isUSDStock(RISE_200_TICKER) && fxRate && effectiveCostBasis > 0) {
        effectiveCostBasis = effectiveCostBasis * fxRate;
      }
      let yieldRate: number | null =
        dividend > 0 && effectiveCostBasis > 0 ? (dividend / effectiveCostBasis) * 100 : null;
      if (yieldRate != null) prevYieldRate = yieldRate;
      else if (prevYieldRate != null) yieldRate = prevYieldRate;
      rows.push({
        month,
        shares,
        dividend,
        costBasis: effectiveCostBasis,
        yieldRate
      });
    }
    const latest = rows.length > 0 ? rows[rows.length - 1] : null;
    const previous = rows.length > 1 ? rows[rows.length - 2] : null;
    const shareChange = latest && previous ? latest.shares - previous.shares : 0;
    const shareChangeRate =
      latest && previous && previous.shares > 0
        ? (shareChange / previous.shares) * 100
        : null;
    const dividendChange =
      latest && previous ? latest.dividend - previous.dividend : 0;
    const dividendChangeRate =
      latest && previous && previous.dividend > 0
        ? (dividendChange / previous.dividend) * 100
        : null;
    const yieldChange =
      latest &&
      previous &&
      latest.yieldRate != null &&
      previous.yieldRate != null
        ? latest.yieldRate - previous.yieldRate
        : 0;
    const yieldChangeRate =
      latest &&
      previous &&
      latest.yieldRate != null &&
      previous.yieldRate != null &&
      previous.yieldRate > 0
        ? (yieldChange / previous.yieldRate) * 100
        : null;
    const last12Rows = rows.slice(-12);
    const yieldSumLast12Months =
      last12Rows.length > 0
        ? last12Rows.reduce((sum, r) => sum + (r.yieldRate ?? 0), 0)
        : null;
    return {
      ticker: RISE_200_TICKER,
      rows,
      latest,
      previous,
      shareChange,
      shareChangeRate,
      dividendChange,
      dividendChangeRate,
      yieldChange,
      yieldChangeRate,
      changeRate: dividendChangeRate,
      yieldSumLast12Months
    };
  }, [ledger, trades, fxRate]);

  const recentExpenseRows90 = useMemo(() => {
    const startDate = addDaysToIso(today, -89);
    return ledger.filter((entry) => {
      if (entry.kind !== "expense") return false;
      if (!entry.date || entry.date < startDate || entry.date > today) return false;
      if (isSavingsExpenseEntry(entry, accounts, categoryPresets)) return false;
      return true;
    });
  }, [ledger, today, accounts, categoryPresets]);

  const recentExpenseRows30 = useMemo(() => {
    const startDate = addDaysToIso(today, -29);
    return recentExpenseRows90.filter((entry) => entry.date >= startDate);
  }, [recentExpenseRows90, today]);

  const weekendWeekdayStats = useMemo(() => {
    const toKrw = (entry: LedgerEntry) =>
      entry.currency === "USD" && fxRate ? entry.amount * fxRate : entry.amount;

    let weekdaySpend = 0;
    let weekendSpend = 0;
    let weekdayCount = 0;
    let weekendCount = 0;

    recentExpenseRows30.forEach((entry) => {
      const parsed = parseIsoLocal(entry.date);
      if (!parsed) return;
      const day = parsed.getDay();
      const amount = toKrw(entry);
      if (day === 0 || day === 6) {
        weekendSpend += amount;
        weekendCount += 1;
      } else {
        weekdaySpend += amount;
        weekdayCount += 1;
      }
    });

    const totalSpend = weekendSpend + weekdaySpend;
    const weekendRatio = totalSpend > 0 ? (weekendSpend / totalSpend) * 100 : 0;

    return {
      weekdaySpend,
      weekendSpend,
      weekdayCount,
      weekendCount,
      totalSpend,
      weekendRatio
    };
  }, [recentExpenseRows30, fxRate]);

  const weekendWeekdayMiniRows = useMemo(
    () => [
      { label: "평일", amount: weekendWeekdayStats.weekdaySpend },
      { label: "주말", amount: weekendWeekdayStats.weekendSpend }
    ],
    [weekendWeekdayStats]
  );

  const catalogSpendRows = useMemo(() => {
    const toKrw = (entry: LedgerEntry) =>
      entry.currency === "USD" && fxRate ? entry.amount * fxRate : entry.amount;
    const map = new Map<string, number>();

    recentExpenseRows90.forEach((entry) => {
      const key =
        entry.subCategory && entry.subCategory !== entry.category
          ? `${entry.category} / ${entry.subCategory}`
          : (entry.category || entry.subCategory || "(미분류)");
      map.set(key, (map.get(key) ?? 0) + toKrw(entry));
    });

    const total = Array.from(map.values()).reduce((sum, value) => sum + value, 0);
    return Array.from(map.entries())
      .map(([catalog, amount]) => ({
        catalog,
        amount,
        ratio: total > 0 ? (amount / total) * 100 : 0
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);
  }, [recentExpenseRows90, fxRate]);
  const accountNameById = useMemo(() => {
    return new Map(accounts.map((account) => [account.id, account.name || account.id]));
  }, [accounts]);
  const assetGrowthRows = useMemo(() => {
    if (accountTimelineRows.length === 0) return [];
    return accountTimelineRows.map((row, index) => {
      const value = Number(row.total ?? 0);
      const prev = index > 0 ? Number(accountTimelineRows[index - 1].total ?? 0) : 0;
      const change = index > 0 ? value - prev : 0;
      const changeRate =
        index > 0 && prev !== 0 ? (change / Math.abs(prev)) * 100 : null;
      const stock = Number(row.stock ?? 0);
      const savings = Number(row.savings ?? 0);
      return {
        month: String(row.month),
        value,
        change,
        changeRate,
        stock,
        savings
      };
    });
  }, [accountTimelineRows]);

  const calendarWindowStart = useMemo(() => addDaysToIso(today, -365), [today]);
  const calendarWindowEnd = useMemo(() => addDaysToIso(today, 89), [today]);

  const spendingCalendarRows = useMemo(() => {
    const rows: SpendingCalendarRow[] = [];
    const savingsCategories = getSavingsCategories(categoryPresets);
    const toKrw = (entry: LedgerEntry) =>
      entry.currency === "USD" && fxRate ? entry.amount * fxRate : entry.amount;

    ledger.forEach((entry) => {
      if (!entry.date || entry.date < calendarWindowStart || entry.date > calendarWindowEnd) return;
      if (entry.kind === "transfer") return;

      const amount = toKrw(entry);
      if (amount <= 0) return;

      const title = entry.subCategory || entry.description || entry.category || "미분류";
      const category = entry.category || "";

      if (entry.kind === "income") {
        rows.push({
          id: entry.id,
          date: entry.date,
          title,
          category,
          amount,
          type: "income",
          toAccountId: entry.toAccountId,
          toAccountName: entry.toAccountId ? accountNameById.get(entry.toAccountId) : undefined,
          source: "ledger"
        });
        return;
      }

      if (entry.kind === "expense") {
        if (!entry.fromAccountId) return;
        const isSavings = savingsCategories.includes(entry.category ?? "");
        rows.push({
          id: entry.id,
          date: entry.date,
          title,
          category,
          amount,
          type: isSavings ? "investing" : "spending",
          fromAccountId: entry.fromAccountId,
          fromAccountName: accountNameById.get(entry.fromAccountId),
          source: "ledger"
        });
      }
    });

    return rows.sort((a, b) => {
      const byDate = a.date.localeCompare(b.date);
      if (byDate !== 0) return byDate;
      return b.amount - a.amount;
    });
  }, [ledger, today, calendarWindowStart, calendarWindowEnd, fxRate, accountNameById, categoryPresets]);

  const filteredSpendingRows = useMemo(() => {
    if (!spendingFilterType) return spendingCalendarRows;
    return spendingCalendarRows.filter((row) => row.type === spendingFilterType);
  }, [spendingCalendarRows, spendingFilterType]);

  const spendingByDate = useMemo(() => {
    const map = new Map<string, SpendingByDate>();
    spendingCalendarRows.forEach((row) => {
      const prev = map.get(row.date) ?? { spending: 0, investing: 0, income: 0, count: 0 };
      if (row.type === "spending") {
        map.set(row.date, { ...prev, spending: prev.spending + row.amount, count: prev.count + 1 });
      } else if (row.type === "investing") {
        map.set(row.date, { ...prev, investing: prev.investing + row.amount, count: prev.count + 1 });
      } else {
        map.set(row.date, { ...prev, income: prev.income + row.amount, count: prev.count + 1 });
      }
    });
    return map;
  }, [spendingCalendarRows]);

  const calendarCells = useMemo(
    () => buildCalendarCells(cashflowMonth, spendingByDate, today),
    [cashflowMonth, spendingByDate, today]
  );

  const selectedMonthSpendingRows = useMemo(
    () => filteredSpendingRows.filter((row) => row.date.slice(0, 7) === cashflowMonth),
    [filteredSpendingRows, cashflowMonth]
  );

  const selectedMonthTotals = useMemo(
    () => {
      const t = { spending: 0, investing: 0, income: 0 };
      selectedMonthSpendingRows.forEach((row) => {
        t[row.type] += row.amount;
      });
      return t;
    },
    [selectedMonthSpendingRows]
  );

  // ── Widget 1: 순자산 누적 곡선 — accountTimelineRows already has { month, total } ──

  // ── Widget 2: 요일별 지출 패턴 (최근 90일) ────────────────────────────────
  const dowPatternRows = useMemo(() => {
    const toKrw = (entry: LedgerEntry) =>
      entry.currency === "USD" && fxRate ? entry.amount * fxRate : entry.amount;
    const totals = [0, 0, 0, 0, 0, 0, 0];
    const counts = [0, 0, 0, 0, 0, 0, 0];
    recentExpenseRows90.forEach((entry) => {
      const parsed = parseIsoLocal(entry.date);
      if (!parsed) return;
      const day = parsed.getDay();
      totals[day] += toKrw(entry);
      counts[day] += 1;
    });
    const labels = ["일", "월", "화", "수", "목", "금", "토"];
    return labels.map((label, i) => ({
      label,
      avg: counts[i] > 0 ? totals[i] / counts[i] : 0,
    }));
  }, [recentExpenseRows90, fxRate]);

  // ── Widget 3: 월별 저축률 히스토리 ──────────────────────────────────────────
  const monthlySavingsRateRows = useMemo(() => {
    const toKrw = (entry: LedgerEntry) =>
      entry.currency === "USD" && fxRate ? entry.amount * fxRate : entry.amount;
    const byMonth = new Map<string, { income: number; investing: number }>();
    ledger.forEach((entry) => {
      if (!entry.date) return;
      const month = entry.date.slice(0, 7);
      const prev = byMonth.get(month) ?? { income: 0, investing: 0 };
      if (entry.kind === "income") {
        byMonth.set(month, { ...prev, income: prev.income + toKrw(entry) });
      } else if (entry.kind === "expense" && isSavingsExpenseEntry(entry, accounts, categoryPresets)) {
        byMonth.set(month, { ...prev, investing: prev.investing + toKrw(entry) });
      }
    });
    return Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, { income, investing }]) => ({
        month,
        rate: income > 0 ? Math.round((investing / income) * 1000) / 10 : null,
      }));
  }, [ledger, fxRate, accounts, categoryPresets]);

  // ── Widget 4: 누적 실현손익 곡선 ─────────────────────────────────────────────
  const cumulativePnlRows = useMemo(() => {
    if (trades.length === 0) return [] as Array<{ date: string; label: string; value: number }>;
    const byId = computeRealizedPnlByTradeId(trades);
    const sellTrades = trades
      .filter((t) => t.side === "sell" && t.date)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (sellTrades.length === 0) return [] as Array<{ date: string; label: string; value: number }>;
    let cumulative = 0;
    const rows: Array<{ date: string; label: string; value: number }> = [];
    for (const t of sellTrades) {
      const pnl = byId.get(t.id) ?? 0;
      cumulative += isUSDStock(t.ticker) && fxRate ? pnl * fxRate : pnl;
      const last = rows[rows.length - 1];
      if (last && last.date === t.date) {
        last.value = Math.round(cumulative);
      } else {
        rows.push({ date: t.date, label: t.date.slice(5), value: Math.round(cumulative) });
      }
    }
    return rows;
  }, [trades, fxRate]);

  // ── Widget 5: 이번 달 페이스 예측 ────────────────────────────────────────────
  const monthPaceData = useMemo(() => {
    const [year, monthNum] = currentMonth.split("-").map(Number);
    const totalDays = new Date(year, monthNum, 0).getDate();
    const todayDay = parseInt(today.slice(8, 10), 10);
    const elapsed = Math.min(Math.max(todayDay, 1), totalDays);
    const projectedExpense = (monthlySummary.expense / elapsed) * totalDays;
    const toKrw = (entry: LedgerEntry) =>
      entry.currency === "USD" && fxRate ? entry.amount * fxRate : entry.amount;
    const prevTotals = [-1, -2, -3].map((offset) => {
      const m = shiftMonth(currentMonth, offset);
      let total = 0;
      ledger.forEach((entry) => {
        if (!entry.date?.startsWith(m)) return;
        if (entry.kind !== "expense") return;
        if (isSavingsExpenseEntry(entry, accounts, categoryPresets)) return;
        total += toKrw(entry);
      });
      return total;
    });
    const avgPrev3 = prevTotals.reduce((s, v) => s + v, 0) / 3;
    return {
      currentExpense: monthlySummary.expense,
      projectedExpense,
      avgPrev3,
      elapsed,
      totalDays,
      pace: avgPrev3 > 0 ? (projectedExpense / avgPrev3) * 100 : null,
    };
  }, [currentMonth, today, monthlySummary.expense, ledger, fxRate, accounts, categoryPresets]);

  // ── Widget 6: 지출 히트맵 데이터 (최근 52주) ────────────────────────────────
  const spendingHeatmapData = useMemo(() => {
    type HeatCell = { date: string; spending: number; inFuture: boolean };
    const startDate = addDaysToIso(today, -363);
    const startParsed = parseIsoLocal(startDate);
    if (!startParsed) return { weeks: [] as HeatCell[][], q1: 0, q2: 0, q3: 0 };
    const gridStart = new Date(startParsed.getTime());
    gridStart.setDate(gridStart.getDate() - gridStart.getDay());
    const amounts: number[] = [];
    const weeks: HeatCell[][] = [];
    const cursor = new Date(gridStart.getTime());
    for (let w = 0; w < 54; w++) {
      const weekStartStr = formatIsoLocal(cursor);
      if (weekStartStr > addDaysToIso(today, 7)) break;
      const week: HeatCell[] = [];
      for (let d = 0; d < 7; d++) {
        const dateStr = formatIsoLocal(cursor);
        const spending = spendingByDate.get(dateStr)?.spending ?? 0;
        const inFuture = dateStr > today;
        week.push({ date: dateStr, spending, inFuture });
        if (spending > 0 && !inFuture) amounts.push(spending);
        cursor.setDate(cursor.getDate() + 1);
      }
      weeks.push(week);
    }
    const sorted = [...amounts].sort((a, b) => a - b);
    const n = sorted.length;
    const q1 = n > 0 ? (sorted[Math.floor(n * 0.33)] ?? 0) : 0;
    const q2 = n > 0 ? (sorted[Math.floor(n * 0.66)] ?? 0) : 0;
    const q3 = n > 0 ? (sorted[Math.floor(n * 0.9)] ?? 0) : 0;
    return { weeks, q1, q2, q3 };
  }, [today, spendingByDate]);

  // ── Widget 7: 카테고리×월 히트맵 (최근 6개월) ────────────────────────────────
  const categoryMonthHeatmap = useMemo(() => {
    const toKrw = (entry: LedgerEntry) =>
      entry.currency === "USD" && fxRate ? entry.amount * fxRate : entry.amount;
    const recentMonths: string[] = [];
    for (let i = 5; i >= 0; i--) recentMonths.push(shiftMonth(currentMonth, -i));
    const monthSet = new Set(recentMonths);
    const byKey = new Map<string, number>();
    const catTotals = new Map<string, number>();
    ledger.forEach((entry) => {
      if (!entry.date) return;
      const month = entry.date.slice(0, 7);
      if (!monthSet.has(month)) return;
      if (entry.kind !== "expense") return;
      if (isSavingsExpenseEntry(entry, accounts, categoryPresets)) return;
      const cat = entry.category || "(미분류)";
      const amt = toKrw(entry);
      byKey.set(`${month}:${cat}`, (byKey.get(`${month}:${cat}`) ?? 0) + amt);
      catTotals.set(cat, (catTotals.get(cat) ?? 0) + amt);
    });
    const topCats = Array.from(catTotals.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 7)
      .map(([cat]) => cat);
    const maxVal = Math.max(...Array.from(byKey.values()), 1);
    return { months: recentMonths, cats: topCats, data: byKey, maxVal };
  }, [ledger, fxRate, accounts, categoryPresets, currentMonth]);

  // ── Widget 8: FIRE 진행도 (최근 12개월 배당 vs 생활비) ───────────────────────
  const fireProgress = useMemo(() => {
    const toKrw = (entry: LedgerEntry) =>
      entry.currency === "USD" && fxRate ? entry.amount * fxRate : entry.amount;
    const months12: string[] = [];
    for (let i = 11; i >= 0; i--) months12.push(shiftMonth(currentMonth, -i));
    const monthSet = new Set(months12);
    let totalDividend = 0;
    let totalExpense = 0;
    ledger.forEach((entry) => {
      if (!entry.date) return;
      const month = entry.date.slice(0, 7);
      if (!monthSet.has(month)) return;
      if (isDividendIncome(entry)) {
        totalDividend += toKrw(entry);
        return;
      }
      if (entry.kind !== "expense") return;
      if (isSavingsExpenseEntry(entry, accounts, categoryPresets)) return;
      totalExpense += toKrw(entry);
    });
    const monthlyDividend = totalDividend / 12;
    const monthlyExpense = totalExpense / 12;
    const fireRate = monthlyExpense > 0 ? (monthlyDividend / monthlyExpense) * 100 : 0;
    return { monthlyDividend, monthlyExpense, fireRate };
  }, [ledger, fxRate, accounts, categoryPresets, currentMonth]);

  return (
    <div>
      <div className="section-header">
        <h2>대시보드</h2>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 16
          }}
        >
          <div className="card" style={{ minHeight: 124, borderLeft: "4px solid var(--chart-expense)" }}>
            <div className="card-title">전체 지출 (전체 기간)</div>
            <div className="card-value" style={{ color: "var(--chart-expense)", fontSize: 24 }}>
              {formatKRW(Math.round(allTimeSummary.expense))}
            </div>
            <div className="hint" style={{ marginTop: 8 }}>
              일반 지출만 (재테크·저축 제외)
            </div>
          </div>

          <div className="card" style={{ minHeight: 124, borderLeft: "4px solid var(--chart-income)" }}>
            <div className="card-title">전체 수입 (전체 기간)</div>
            <div className="card-value" style={{ color: "var(--chart-income)", fontSize: 24 }}>
              {formatKRW(Math.round(allTimeSummary.income))}
            </div>
            <div className="hint" style={{ marginTop: 8 }}>전체 기간 수입 합계</div>
          </div>

          <div className="card" style={{ minHeight: 124, borderLeft: "4px solid var(--chart-primary)" }}>
            <div className="card-title">전체 재테크 (전체 기간)</div>
            <div className="card-value" style={{ color: "var(--chart-primary)", fontSize: 24 }}>
              {formatKRW(Math.round(allTimeSummary.investing))}
            </div>
            <div className="hint" style={{ marginTop: 8 }}>재테크·저축성 지출 합계</div>
          </div>
        </div>

        <div className="card" style={{ marginTop: 0 }}>
          <div className="card-title">이번 달 재테크 세부 ({monthlySummary.month})</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 12,
              marginTop: 12
            }}
          >
            <div style={{ padding: "10px 12px", background: "var(--surface)", borderRadius: 8 }}>
              <div className="hint" style={{ fontSize: 12 }}>저축</div>
              <div className="card-value" style={{ fontSize: 18 }}>{formatKRW(Math.round(monthlyRecheckBreakdown.저축))}</div>
            </div>
            <div style={{ padding: "10px 12px", background: "var(--surface)", borderRadius: 8 }}>
              <div className="hint" style={{ fontSize: 12 }}>투자(매수 등)</div>
              <div className="card-value" style={{ fontSize: 18 }}>{formatKRW(Math.round(monthlyRecheckBreakdown.투자))}</div>
            </div>
            <div style={{ padding: "10px 12px", background: "var(--surface)", borderRadius: 8, borderLeft: "3px solid var(--chart-income)" }}>
              <div className="hint" style={{ fontSize: 12 }}>투자수익</div>
              <div className="card-value" style={{ fontSize: 18, color: "var(--chart-income)" }}>{formatKRW(Math.round(monthlyRecheckBreakdown.투자수익))}</div>
            </div>
            <div style={{ padding: "10px 12px", background: "var(--surface)", borderRadius: 8, borderLeft: "3px solid var(--chart-expense)" }}>
              <div className="hint" style={{ fontSize: 12 }}>투자손실</div>
              <div className="card-value" style={{ fontSize: 18, color: "var(--chart-expense)" }}>{formatKRW(Math.round(monthlyRecheckBreakdown.투자손실))}</div>
            </div>
          </div>
          <div className="hint" style={{ marginTop: 10, fontSize: 12 }}>
            누적 실현손익(매도 기준): {totalRealizedPnl >= 0 ? "+" : ""}{formatKRW(Math.round(totalRealizedPnl))}
          </div>
        </div>

        <Suspense
          fallback={
            <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", minHeight: 120 }}>
              포트폴리오 차트 로딩 중…
            </div>
          }
        >
          <LazyPortfolioDashboardCharts
            positionsWithPrice={positionsWithPrice}
            positionsByAccount={positionsByAccount}
            balances={balances}
            fxRate={fxRate}
          />
        </Suspense>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 16,
            alignItems: "stretch"
          }}
        >
          <div className="card" style={{ minHeight: 200 }}>
            <div className="card-title">저축 대비 비교 (저번달)</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 8 }}>
              <div>
                <div className="hint" style={{ fontSize: 12, marginBottom: 4 }}>저번달 저축 ({lastMonthSummary.month})</div>
                <div
                  className="card-value"
                  style={{ fontSize: 22, color: lastMonthSavingsRate != null ? "var(--chart-primary)" : "var(--text-muted)" }}
                >
                  {lastMonthSavingsRate != null ? `${lastMonthSavingsRate.toFixed(1)}%` : "-"}
                </div>
                <div className="hint" style={{ fontSize: 12, marginTop: 4 }}>수입 대비 저축비율</div>
              </div>
              <div>
                <div className="hint" style={{ fontSize: 12, marginBottom: 4 }}>지출 구성 (주식 대비 저축)</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>
                  주식 {lastMonthInvestingRatio.stockPct.toFixed(0)}% / 저축 {lastMonthInvestingRatio.savingsPct.toFixed(0)}%
                </div>
                <div className="hint" style={{ fontSize: 12, marginTop: 4 }}>
                  {formatKRW(Math.round(lastMonthRecheckBreakdown.투자))} / {formatKRW(Math.round(lastMonthRecheckBreakdown.저축))}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 12, height: 8, display: "flex", borderRadius: 4, overflow: "hidden" }}>
              <div
                style={{
                  width: `${lastMonthInvestingRatio.stockPct}%`,
                  background: "var(--chart-primary)",
                  minWidth: lastMonthInvestingRatio.stockPct > 0 ? 4 : 0
                }}
              />
              <div
                style={{
                  width: `${lastMonthInvestingRatio.savingsPct}%`,
                  background: "var(--chart-positive)",
                  minWidth: lastMonthInvestingRatio.savingsPct > 0 ? 4 : 0
                }}
              />
            </div>
          </div>

          <div className="card" style={{ minHeight: 180 }}>
            <div className="card-title">해당 금액 상세 (최근 3개월 기준)</div>
            <div
              className="card-value"
              style={{
                fontSize: 20,
                color:
                  dividendCoverage.coverageRate != null && dividendCoverage.coverageRate >= 100
                    ? "var(--primary)"
                    : "var(--danger)"
              }}
            >
              {dividendCoverage.coverageRate == null ? "-" : `${dividendCoverage.coverageRate.toFixed(1)}%`}
            </div>
            <div className="hint" style={{ marginTop: 4 }}>
              배당 {formatKRW(Math.round(dividendCoverage.monthlyDividendAvg))}
              {" / 예정"}
              {formatKRW(Math.round(dividendCoverage.monthlyFixedExpenseAvg))}
            </div>
            <div
              style={{
                marginTop: 16,
                display: "flex",
                alignItems: "center",
                gap: 12
              }}
            >
              <div
                style={{
                  flex: 1,
                  position: "relative",
                  height: 28,
                  minWidth: 60
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "var(--chart-expense)",
                    opacity: 0.3,
                    borderRadius: 6
                  }}
                  aria-hidden
                />
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: "50%",
                    transform: "translateY(-50%)",
                    height: 10,
                    width: `${
                      dividendCoverage.monthlyFixedExpenseAvg > 0
                        ? Math.min(
                            100,
                            (dividendCoverage.monthlyDividendAvg / dividendCoverage.monthlyFixedExpenseAvg) * 100
                          )
                        : 0
                    }%`,
                    minWidth: dividendCoverage.monthlyDividendAvg > 0 ? 4 : 0,
                    background: "var(--chart-income)",
                    borderRadius: 4
                  }}
                />
              </div>
              <span
                style={{
                  flexShrink: 0,
                  fontSize: 13,
                  fontWeight: 700,
                  color:
                    dividendCoverage.coverageRate != null && dividendCoverage.coverageRate >= 100
                      ? "var(--primary)"
                      : "var(--text)"
                }}
              >
                커버리지 {dividendCoverage.coverageRate == null ? "-" : `${dividendCoverage.coverageRate.toFixed(1)}%`}
              </span>
            </div>
          </div>

          <div className="card" style={{ minHeight: 240 }}>
            <div className="card-title">주말 지출 대비 평일 지출(최근 30일)</div>
            <div className="card-value" style={{ fontSize: 20 }}>{weekendWeekdayStats.weekendRatio.toFixed(1)}%</div>
            <div className="hint" style={{ marginTop: 8 }}>
              주말 {formatKRW(Math.round(weekendWeekdayStats.weekendSpend))}
              {" / 평일 "}
              {formatKRW(Math.round(weekendWeekdayStats.weekdaySpend))}
            </div>
            <Suspense fallback={<div style={{ height: 140, marginTop: 12 }} />}>
              <LazyWeekendChart rows={weekendWeekdayMiniRows} />
            </Suspense>
          </div>
        </div>

        <div className="card" style={{ marginTop: 16, padding: 20 }}>
          <div className="card-title" style={{ fontSize: 18 }}>자산 구성 (종류별)</div>
          <div style={{ width: "100%", height: 220, marginTop: 12 }}>
            <Suspense fallback={<div style={{ height: 220 }} />}>
              <LazyAssetTreemap portfolioTreemapData={portfolioTreemapData} portfolioByType={portfolioByType} />
            </Suspense>
          </div>
          <div className="hint" style={{ marginTop: 12, textAlign: "center", fontSize: 13 }}>
            순자산 {formatKRW(Math.round(totalNetWorth))}
            {totalDebt < 0 && (
              <span style={{ marginLeft: 8, color: "var(--chart-expense)" }}>
                (부채 {formatKRW(Math.round(Math.abs(totalDebt)))})
              </span>
            )}
          </div>
        </div>

        {accountBalanceSnapshots.length > 0 && (
          <div className="card" style={{ marginTop: 16, padding: 20 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, marginBottom: 12 }}>
              <div className="card-title" style={{ margin: 0 }}>계좌별 잔액 추이 (매월 15·월말 기준)</div>
              <select
                value={accountBalanceChartView}
                onChange={(e) => setAccountBalanceChartView(e.target.value)}
                style={{
                  minWidth: 160,
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  color: "var(--text)",
                  fontSize: 13
                }}
              >
                <option value="total">전체 합계</option>
                <option value="all">모두 보기 (계좌별 + 합계)</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>{acc.name || acc.id}</option>
                ))}
              </select>
            </div>
            <div style={{ width: "100%", height: 280 }}>
              <Suspense fallback={<div style={{ height: 280 }} />}>
                <LazyAccountBalanceChart
                  accountBalanceSnapshots={accountBalanceSnapshots}
                  accountBalanceChartView={accountBalanceChartView}
                  accounts={accounts}
                />
              </Suspense>
            </div>
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 16,
            marginTop: 16
          }}
        >
          <div className="card" style={{ minHeight: 320 }}>
            <div className="card-title" style={{ marginBottom: 12 }}>{trackedTickerName} 해당금액 변동 (전체 기준)</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(200px, 280px) 1fr",
                gap: 20,
                alignItems: "stretch"
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 12, justifyContent: "center" }}>
                <div
                  className={`card-value ${trackedDividendTrend.changeRate == null ? "" : trackedDividendTrend.changeRate >= 0 ? "positive" : "negative"}`}
                  style={{ marginBottom: 0 }}
                >
                  {trackedDividendTrend.changeRate == null
                    ? "-"
                    : `${trackedDividendTrend.changeRate >= 0 ? "+" : ""}${trackedDividendTrend.changeRate.toFixed(1)}%`}
                </div>
                <div className="hint" style={{ marginTop: 0 }}>
                  {trackedDividendTrend.latest && trackedDividendTrend.previous
                    ? `${trackedDividendTrend.previous.month} ${formatKRW(Math.round(trackedDividendTrend.previous.dividend))} → ${trackedDividendTrend.latest.month} ${formatKRW(Math.round(trackedDividendTrend.latest.dividend))}`
                    : `${trackedDividendTrend.ticker} 배당 데이터가 없습니다.`}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                  <div className={trackedDividendTrend.shareChange >= 0 ? "positive" : "negative"}>
                    주식수 {trackedDividendTrend.shareChange >= 0 ? "+" : ""}{trackedDividendTrend.shareChange.toLocaleString()}
                    {trackedDividendTrend.shareChangeRate == null ? "" : ` (${trackedDividendTrend.shareChangeRate >= 0 ? "+" : ""}${trackedDividendTrend.shareChangeRate.toFixed(1)}%)`}
                  </div>
                  <div className={trackedDividendTrend.dividendChange >= 0 ? "positive" : "negative"}>
                    배당 {trackedDividendTrend.dividendChange >= 0 ? "+" : ""}{formatKRW(Math.round(trackedDividendTrend.dividendChange))}
                  </div>
                  <div className={trackedDividendTrend.yieldChangeRate != null && trackedDividendTrend.yieldChangeRate >= 0 ? "positive" : "negative"}>
                    배당율 변화 {trackedDividendTrend.yieldChangeRate == null ? "-" : `${trackedDividendTrend.yieldChangeRate >= 0 ? "+" : ""}${trackedDividendTrend.yieldChangeRate.toFixed(1)}%`}
                  </div>
                  <div style={{ marginTop: 4, paddingTop: 8, borderTop: "1px solid var(--border)", fontSize: 13, fontWeight: 600 }}>
                    최근 12개월간 총 배당율 {trackedDividendTrend.yieldSumLast12Months == null ? "-" : `${trackedDividendTrend.yieldSumLast12Months.toFixed(2)}%`}
                  </div>
                  {trackedDividendTrend.latest && trackedDividendTrend.latest.shares > 0 && (
                    <div className="hint" style={{ marginTop: 8, padding: 8, background: "var(--surface)", borderRadius: 8, fontSize: 12 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>{trackedDividendTrend.latest.month} 산식</div>
                      <div>평단가 {formatKRW(Math.round(trackedDividendTrend.latest.costBasis / trackedDividendTrend.latest.shares))}</div>
                      <div>주당 배당금 {formatKRW(Math.round(trackedDividendTrend.latest.dividend / trackedDividendTrend.latest.shares))}</div>
                      <div>매입금액 {formatKRW(Math.round(trackedDividendTrend.latest.costBasis))} → 배당률 {trackedDividendTrend.latest.yieldRate != null ? `${trackedDividendTrend.latest.yieldRate.toFixed(2)}%` : "-"}</div>
                    </div>
                  )}
                </div>
              </div>
              <div style={{ minHeight: 260 }}>
                <Suspense fallback={<div style={{ height: 260 }} />}>
                  <LazyDividendTrendChart rows={trackedDividendTrend.rows} />
                </Suspense>
              </div>
            </div>
          </div>

          <div className="card" style={{ minHeight: 320 }}>
            <div className="card-title" style={{ marginBottom: 12 }}>{rise200CardTitle}</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(200px, 280px) 1fr",
                gap: 20,
                alignItems: "stretch"
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 12, justifyContent: "center" }}>
                <div
                  className={`card-value ${rise200DividendTrend.changeRate == null ? "" : rise200DividendTrend.changeRate >= 0 ? "positive" : "negative"}`}
                  style={{ marginBottom: 0 }}
                >
                  {rise200DividendTrend.changeRate == null
                    ? "-"
                    : `${rise200DividendTrend.changeRate >= 0 ? "+" : ""}${rise200DividendTrend.changeRate.toFixed(1)}%`}
                </div>
                <div className="hint" style={{ marginTop: 0 }}>
                  {rise200DividendTrend.latest && rise200DividendTrend.previous
                    ? `${rise200DividendTrend.previous.month} ${formatKRW(Math.round(rise200DividendTrend.previous.dividend))} → ${rise200DividendTrend.latest.month} ${formatKRW(Math.round(rise200DividendTrend.latest.dividend))}`
                    : `${rise200DividendTrend.ticker} 배당 데이터가 없습니다.`}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                  <div className={rise200DividendTrend.shareChange >= 0 ? "positive" : "negative"}>
                    주식수 {rise200DividendTrend.shareChange >= 0 ? "+" : ""}{rise200DividendTrend.shareChange.toLocaleString()}
                    {rise200DividendTrend.shareChangeRate == null ? "" : ` (${rise200DividendTrend.shareChangeRate >= 0 ? "+" : ""}${rise200DividendTrend.shareChangeRate.toFixed(1)}%)`}
                  </div>
                  <div className={rise200DividendTrend.dividendChange >= 0 ? "positive" : "negative"}>
                    배당 {rise200DividendTrend.dividendChange >= 0 ? "+" : ""}{formatKRW(Math.round(rise200DividendTrend.dividendChange))}
                  </div>
                  <div className={rise200DividendTrend.yieldChangeRate != null && rise200DividendTrend.yieldChangeRate >= 0 ? "positive" : "negative"}>
                    배당율 변화 {rise200DividendTrend.yieldChangeRate == null ? "-" : `${rise200DividendTrend.yieldChangeRate >= 0 ? "+" : ""}${rise200DividendTrend.yieldChangeRate.toFixed(1)}%`}
                  </div>
                  <div style={{ marginTop: 4, paddingTop: 8, borderTop: "1px solid var(--border)", fontSize: 13, fontWeight: 600 }}>
                    최근 12개월간 총 배당율 {rise200DividendTrend.yieldSumLast12Months == null ? "-" : `${rise200DividendTrend.yieldSumLast12Months.toFixed(2)}%`}
                  </div>
                  {rise200DividendTrend.latest && rise200DividendTrend.latest.shares > 0 && (
                    <div className="hint" style={{ marginTop: 8, padding: 8, background: "var(--surface)", borderRadius: 8, fontSize: 12 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>{rise200DividendTrend.latest.month} 산식</div>
                      <div>평단가 {formatKRW(Math.round(rise200DividendTrend.latest.costBasis / rise200DividendTrend.latest.shares))}</div>
                      <div>주당 배당금 {formatKRW(Math.round(rise200DividendTrend.latest.dividend / rise200DividendTrend.latest.shares))}</div>
                      <div>매입금액 {formatKRW(Math.round(rise200DividendTrend.latest.costBasis))} → 배당률 {rise200DividendTrend.latest.yieldRate != null ? `${rise200DividendTrend.latest.yieldRate.toFixed(2)}%` : "-"}</div>
                    </div>
                  )}
                </div>
              </div>
              <div style={{ minHeight: 260 }}>
                <Suspense fallback={<div style={{ height: 260 }} />}>
                  <LazyDividendTrendChart rows={rise200DividendTrend.rows} />
                </Suspense>
              </div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-title" style={{ marginBottom: 12 }}>지출 구성 비율</div>

          <div style={{ width: "100%", height: 320, minHeight: 320 }}>
            {assetGrowthRows.length > 0 ? (
              <Suspense fallback={<div style={{ height: 320 }} />}>
                <LazySpendingLineChart rows={assetGrowthRows} />
              </Suspense>
            ) : (
              <p className="hint">지출 데이터가 없습니다.</p>
            )}
          </div>
          {assetGrowthRows.length > 0 && assetGrowthRows.length > 1 && (() => {
            const last = assetGrowthRows[assetGrowthRows.length - 1];
            const hasGrowth = last.changeRate != null;
            return (
              <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 16, alignItems: "baseline" }}>
                <span className="hint" style={{ margin: 0 }}>
                  최근 지출 {formatKRW(Math.round(last.value))}
                </span>
                {hasGrowth && (
                  <span
                    className={last.changeRate! >= 0 ? "positive" : "negative"}
                    style={{ fontWeight: 600, fontSize: 13 }}
                  >
                    전일 대비 {last.change! >= 0 ? "+" : ""}{formatKRW(Math.round(last.change!))} ({last.changeRate! >= 0 ? "+" : ""}{last.changeRate!.toFixed(2)}%)
                  </span>
                )}
              </div>
            );
          })()}
          {assetGrowthRows.length > 1 && (
            <div style={{ marginTop: 16, overflowX: "auto" }}>
              <table className="table compact" style={{ width: "100%", fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>월</th>
                    <th style={{ textAlign: "right" }}>누적자산</th>
                    <th style={{ textAlign: "right" }}>전월 대비</th>
                    <th style={{ textAlign: "right" }}>성장률</th>
                  </tr>
                </thead>
                <tbody>
                  {[...assetGrowthRows].reverse().map((row) => (
                    <tr key={row.month}>
                      <td style={{ fontWeight: 500 }}>{row.month}</td>
                      <td className="number" style={{ textAlign: "right" }}>{formatKRW(Math.round(row.value))}</td>
                      <td
                        className={
                          row.changeRate == null
                            ? "number"
                            : (row.change || 0) >= 0
                              ? "number positive"
                              : "number negative"
                        }
                        style={{ textAlign: "right" }}
                      >
                        {row.changeRate == null
                          ? "-"
                          : ((row.change || 0) >= 0 ? "+" : "") + formatKRW(Math.round(row.change || 0))}
                      </td>
                      <td
                        className={
                          row.changeRate == null
                            ? "number"
                            : row.changeRate >= 0
                              ? "number positive"
                              : "number negative"
                        }
                        style={{ textAlign: "right", fontWeight: 600 }}
                      >
                        {row.changeRate == null
                          ? "-"
                          : (row.changeRate >= 0 ? "+" : "") + row.changeRate.toFixed(2) + "%"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {assetGrowthRows.length > 0 && (
            <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--border)" }}>
              <div className="hint" style={{ marginBottom: 12, fontWeight: 600, color: "var(--text)" }}>
                월별 자산 / 저축 추이</div>
              <div style={{ width: "100%", height: 200 }}>
                <Suspense fallback={<div style={{ height: 200 }} />}>
                  <LazyMonthlySavingsBarChart rows={assetGrowthRows} />
                </Suspense>
              </div>
            </div>
          )}
          <p className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
            전체 지출 = 현금 + 주식평가금 + 배당수익 등
          </p>
        </div>

        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <div className="card-title" style={{ margin: 0 }}>소비 캘린더</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className="hint" style={{ margin: 0, fontSize: 12 }}>분류</span>
              <select
                value={spendingFilterType}
                onChange={(e) => setSpendingFilterType((e.target.value || "") as "" | "spending" | "investing" | "income")}
                style={{
                  minWidth: 130,
                  padding: "4px 8px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  color: "var(--text)",
                  fontSize: 12
                }}
              >
                <option value="">전체</option>
                <option value="spending">내가 쓴 소비</option>
                <option value="investing">재테크</option>
                <option value="income">수입</option>
              </select>
              <button
                type="button"
                className="secondary"
                style={{ fontSize: 12, padding: "4px 10px" }}
                onClick={() => setCashflowMonth((prev) => shiftMonth(prev, -1))}
              >
                이전달
              </button>
              <strong style={{ minWidth: 70, textAlign: "center" }}>{cashflowMonth}</strong>
              <button
                type="button"
                className="secondary"
                style={{ fontSize: 12, padding: "4px 10px" }}
                onClick={() => setCashflowMonth((prev) => shiftMonth(prev, 1))}
              >
                다음달
              </button>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 16,
              marginBottom: 12,
              padding: "12px 16px",
              background: "var(--surface)",
              borderRadius: 8,
              border: "1px solid var(--border)"
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--chart-income)" }}>
              수입 {formatKRW(Math.round(selectedMonthTotals.income))}
            </span>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--chart-expense)" }}>
              지출 {formatKRW(Math.round(selectedMonthTotals.spending))}
            </span>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--chart-primary)" }}>
              재테크 {formatKRW(Math.round(selectedMonthTotals.investing))}
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
              gap: 6
            }}
          >
            {DAY_LABELS.map((day) => (
              <div key={day} style={{ textAlign: "center", fontSize: 13, fontWeight: 700, color: "var(--text-muted)" }}>
                {day}
              </div>
            ))}
            {calendarCells.map((cell) => (
              <div
                key={cell.date}
                style={{
                  minHeight: 82,
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 6,
                  background: cell.inMonth ? "var(--surface)" : "var(--bg)",
                  opacity: cell.inMonth ? 1 : 0.6,
                  outline: cell.isToday ? "2px solid var(--primary)" : "none"
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: cell.date < today ? "var(--text-muted)" : "var(--text)" }}>
                  {cell.day}
                </div>
                {cell.spending > 0 && (
                  <div style={{ marginTop: 4, fontSize: 11, color: "var(--chart-expense)", fontWeight: 600 }}>
                    소비 {formatKRW(Math.round(cell.spending))}
                  </div>
                )}
                {cell.investing > 0 && (
                  <div style={{ marginTop: 2, fontSize: 11, color: "var(--chart-primary)", fontWeight: 600 }}>
                    재테크 {formatKRW(Math.round(cell.investing))}
                  </div>
                )}
                {cell.income > 0 && (
                  <div style={{ marginTop: 2, fontSize: 11, color: "var(--chart-income)", fontWeight: 600 }}>
                    수입 {formatKRW(Math.round(cell.income))}
                  </div>
                )}
                {cell.count > 0 && (
                  <div style={{ marginTop: 2, fontSize: 10, color: "var(--text-muted)" }}>
                    {cell.count}건
                  </div>
                )}
              </div>
            ))}
          </div>

          <p className="hint" style={{ marginTop: 12, marginBottom: 8 }}>
            {cashflowMonth} 소비 {formatKRW(Math.round(selectedMonthTotals.spending))} / 재테크 {formatKRW(Math.round(selectedMonthTotals.investing))} / 수입 {formatKRW(Math.round(selectedMonthTotals.income))} · {selectedMonthSpendingRows.length}건
          </p>

          <div style={{ overflowX: "auto" }}>
            <table className="table compact" style={{ width: "100%", fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>일자</th>
                  <th style={{ textAlign: "left" }}>분류</th>
                  <th style={{ textAlign: "left" }}>내역</th>
                  <th style={{ textAlign: "left" }}>계좌</th>
                  <th style={{ textAlign: "right" }}>금액</th>
                </tr>
              </thead>
              <tbody>
                {selectedMonthSpendingRows.slice(0, 30).map((row) => (
                  <tr key={`${row.id}:${row.date}`}>
                    <td>{row.date}</td>
                    <td>
                      <span
                        style={{
                          color: row.type === "spending" ? "var(--chart-expense)" : row.type === "investing" ? "var(--chart-primary)" : "var(--chart-income)",
                          fontWeight: 600
                        }}
                      >
                        {row.type === "spending" ? "내가 쓴 소비" : row.type === "investing" ? "재테크" : "수입"}
                      </span>
                    </td>
                    <td title={row.category}>
                      {row.title}
                      {row.category && <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>({row.category})</span>}
                    </td>
                    <td>{row.type === "income" ? (row.toAccountName || row.toAccountId || "-") : (row.fromAccountName || row.fromAccountId || "-")}</td>
                    <td
                      className="number"
                      style={{
                        textAlign: "right",
                        color: row.type === "income" ? "var(--chart-income)" : "var(--chart-expense)",
                        fontWeight: 700
                      }}
                    >
                      {row.type === "income" ? "+" : "-"}{formatKRW(Math.round(row.amount))}
                    </td>
                  </tr>
                ))}
                {selectedMonthSpendingRows.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                      해당 기간 데이터가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-title" style={{ marginBottom: 12 }}>카테고리별 지출 분석 (최근 90일)</div>

          {catalogSpendRows.length > 0 && (
            <div style={{ width: "100%", height: 220, marginBottom: 16 }}>
              <Suspense fallback={<div style={{ height: 220 }} />}>
                <LazyCategorySpendBarChart rows={catalogSpendRows} />
              </Suspense>
            </div>
          )}

          <div style={{ overflowX: "auto" }}>
            <table className="table compact" style={{ width: "100%", fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>카테고리</th>
                  <th style={{ textAlign: "right" }}>금액</th>
                  <th style={{ textAlign: "right" }}>금액</th>
                </tr>
              </thead>
              <tbody>
                {catalogSpendRows.map((row) => (
                  <tr key={row.catalog}>
                    <td>{row.catalog}</td>
                    <td className="number" style={{ textAlign: "right" }}>
                      {formatKRW(Math.round(row.amount))}
                    </td>
                    <td className="number" style={{ textAlign: "right", fontWeight: 700 }}>
                      {row.ratio.toFixed(1)}%
                    </td>
                  </tr>
                ))}
                {catalogSpendRows.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                      해당 기간 데이터가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Widget 2: 누적 실현손익 곡선 ────────────────────────────────── */}
        {cumulativePnlRows.length > 1 && (
          <div className="card">
            <div className="card-title" style={{ marginBottom: 12 }}>누적 실현손익 곡선 (매도 기준)</div>
            <div style={{ width: "100%", height: 200 }}>
              <Suspense fallback={<div style={{ height: 200 }} />}>
                <LazyCumulativePnlAreaChart rows={cumulativePnlRows} />
              </Suspense>
            </div>
            <div className="hint" style={{ marginTop: 8 }}>
              누적 실현손익:{" "}
              <strong style={{ color: totalRealizedPnl >= 0 ? "var(--chart-income)" : "var(--chart-expense)" }}>
                {totalRealizedPnl >= 0 ? "+" : ""}{formatKRW(Math.round(totalRealizedPnl))}
              </strong>
            </div>
          </div>
        )}

        {/* ── Widget 3: 월별 저축률 히스토리 ──────────────────────────────── */}
        {monthlySavingsRateRows.length > 1 && (
          <div className="card">
            <div className="card-title" style={{ marginBottom: 12 }}>월별 저축률 히스토리</div>
            <div style={{ width: "100%", height: 200 }}>
              <Suspense fallback={<div style={{ height: 200 }} />}>
                <LazyMonthlySavingsRateChart rows={monthlySavingsRateRows} />
              </Suspense>
            </div>
            {(() => {
              const last = monthlySavingsRateRows.filter((r) => r.rate != null).slice(-1)[0];
              if (!last || last.rate == null) return null;
              return (
                <div className="hint" style={{ marginTop: 8 }}>
                  최근 월 저축률:{" "}
                  <strong style={{ color: last.rate >= 30 ? "var(--chart-positive)" : "var(--chart-warning)" }}>
                    {last.rate.toFixed(1)}%
                  </strong>
                  {savingsRate != null && (
                    <span style={{ marginLeft: 12 }}>이번 달: <strong>{savingsRate.toFixed(1)}%</strong></span>
                  )}
                  <span style={{ marginLeft: 12, color: "var(--text-muted)" }}>기준선 30%</span>
                </div>
              );
            })()}
          </div>
        )}

        {/* ── Widget 4: FIRE 진행도 ────────────────────────────────────────── */}
        <div className="card">
          <div className="card-title" style={{ marginBottom: 16 }}>FIRE 진행도 (배당 / 생활비)</div>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 24 }}>
            {(() => {
              const pct = fireProgress.fireRate;
              const r = 70;
              const cx = 90;
              const cy = 78;
              const strokeW = 14;
              const fullLen = Math.PI * r;
              const fillLen = (Math.min(pct, 100) / 100) * fullLen;
              const d = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
              const color = pct >= 100 ? "#059669" : pct >= 50 ? "#d97706" : "#dc2626";
              return (
                <svg width={180} height={96} viewBox="0 0 180 96" style={{ flexShrink: 0 }}>
                  <path d={d} fill="none" stroke="var(--border)" strokeWidth={strokeW} strokeLinecap="round" />
                  <path
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeWidth={strokeW}
                    strokeLinecap="round"
                    strokeDasharray={`${fillLen.toFixed(2)} ${fullLen.toFixed(2)}`}
                  />
                  <text x={cx} y={cy - 4} textAnchor="middle" fontSize={24} fontWeight={700} fill="var(--text)">
                    {pct.toFixed(1)}%
                  </text>
                  <text x={cx} y={cy + 14} textAnchor="middle" fontSize={11} fill="var(--text-muted)">
                    배당 / 생활비
                  </text>
                </svg>
              );
            })()}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <div className="hint" style={{ fontSize: 12 }}>월 평균 배당 (최근 12M)</div>
                <div style={{ fontWeight: 700, fontSize: 18, color: "var(--chart-income)" }}>
                  {formatKRW(Math.round(fireProgress.monthlyDividend))}
                </div>
              </div>
              <div>
                <div className="hint" style={{ fontSize: 12 }}>월 평균 생활비 (최근 12M)</div>
                <div style={{ fontWeight: 700, fontSize: 18, color: "var(--chart-expense)" }}>
                  {formatKRW(Math.round(fireProgress.monthlyExpense))}
                </div>
              </div>
              {fireProgress.fireRate >= 100 && (
                <div style={{ fontSize: 13, fontWeight: 700, color: "#059669" }}>
                  🎯 배당이 생활비를 커버합니다!
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Widget 5: 요일별 지출 패턴 ──────────────────────────────────── */}
        {recentExpenseRows90.length > 0 && (
          <div className="card">
            <div className="card-title" style={{ marginBottom: 4 }}>요일별 평균 지출 패턴 (최근 90일)</div>
            <div className="hint" style={{ marginBottom: 12 }}>주말(주황), 평일(빨강)</div>
            <div style={{ width: "100%", height: 180 }}>
              <Suspense fallback={<div style={{ height: 180 }} />}>
                <LazyDowPatternChart rows={dowPatternRows} />
              </Suspense>
            </div>
          </div>
        )}

        {/* ── Widget 6: 이번 달 페이스 예측 ───────────────────────────────── */}
        <div className="card">
          <div className="card-title" style={{ marginBottom: 12 }}>이번 달 페이스 예측 ({currentMonth})</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
              gap: 12,
              marginBottom: 16
            }}
          >
            <div style={{ padding: "10px 12px", background: "var(--surface)", borderRadius: 8 }}>
              <div className="hint" style={{ fontSize: 12 }}>현재 지출</div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{formatKRW(Math.round(monthPaceData.currentExpense))}</div>
              <div className="hint" style={{ fontSize: 11 }}>{monthPaceData.elapsed}일 / {monthPaceData.totalDays}일</div>
            </div>
            <div style={{ padding: "10px 12px", background: "var(--surface)", borderRadius: 8 }}>
              <div className="hint" style={{ fontSize: 12 }}>이달 예상 (페이스)</div>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 18,
                  color: monthPaceData.pace != null && monthPaceData.pace > 110 ? "var(--chart-expense)" : "var(--text)"
                }}
              >
                {formatKRW(Math.round(monthPaceData.projectedExpense))}
              </div>
              {monthPaceData.pace != null && (
                <div
                  className="hint"
                  style={{ fontSize: 11, color: monthPaceData.pace > 100 ? "var(--chart-expense)" : "var(--chart-income)" }}
                >
                  평균 대비 {monthPaceData.pace > 100 ? "+" : ""}{(monthPaceData.pace - 100).toFixed(1)}%
                </div>
              )}
            </div>
            <div style={{ padding: "10px 12px", background: "var(--surface)", borderRadius: 8 }}>
              <div className="hint" style={{ fontSize: 12 }}>최근 3달 평균</div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{formatKRW(Math.round(monthPaceData.avgPrev3))}</div>
            </div>
          </div>
          {monthPaceData.avgPrev3 > 0 && (() => {
            const barMax = monthPaceData.avgPrev3 * 1.5;
            const projPct = Math.min(100, (monthPaceData.projectedExpense / barMax) * 100);
            const avgPct = (monthPaceData.avgPrev3 / barMax) * 100;
            return (
              <div>
                <div style={{ position: "relative", height: 12, background: "var(--border)", borderRadius: 6, overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${projPct}%`,
                      background: projPct > avgPct ? "var(--chart-expense)" : "var(--chart-income)",
                      borderRadius: 6,
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      left: `${avgPct}%`,
                      top: 0,
                      bottom: 0,
                      width: 2,
                      background: "var(--text-muted)",
                    }}
                  />
                </div>
                <div className="hint" style={{ marginTop: 4, fontSize: 11 }}>
                  세로선 = 3달 평균. 막대 최대 = 평균 × 1.5
                </div>
              </div>
            );
          })()}
        </div>

        {/* ── Widget 7: 지출 히트맵 (52주 GitHub 스타일) ──────────────────── */}
        {spendingHeatmapData.weeks.length > 0 && (
          <div className="card">
            <div className="card-title" style={{ marginBottom: 12 }}>지출 히트맵 (최근 52주)</div>
            <div style={{ overflowX: "auto" }}>
              <div style={{ display: "flex", gap: 3, minWidth: "max-content" }}>
                {spendingHeatmapData.weeks.map((week, wi) => (
                  <div key={wi} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {week.map((cell) => {
                      const { spending, inFuture, date } = cell;
                      const { q1, q2, q3 } = spendingHeatmapData;
                      const bg = inFuture
                        ? "transparent"
                        : spending <= 0
                        ? "var(--border)"
                        : spending <= q1
                        ? "rgba(220,38,38,0.18)"
                        : spending <= q2
                        ? "rgba(220,38,38,0.42)"
                        : spending <= q3
                        ? "rgba(220,38,38,0.68)"
                        : "rgba(220,38,38,0.92)";
                      return (
                        <div
                          key={date}
                          title={`${date}: ${spending > 0 ? formatKRW(Math.round(spending)) : "지출 없음"}`}
                          style={{ width: 12, height: 12, borderRadius: 2, background: bg }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
              <span className="hint" style={{ fontSize: 11 }}>적음</span>
              {(["rgba(220,38,38,0.18)", "rgba(220,38,38,0.42)", "rgba(220,38,38,0.68)", "rgba(220,38,38,0.92)"] as const).map(
                (c, i) => <div key={i} style={{ width: 12, height: 12, borderRadius: 2, background: c }} />
              )}
              <span className="hint" style={{ fontSize: 11 }}>많음</span>
            </div>
          </div>
        )}

        {/* ── Widget 8: 카테고리×월 히트맵 ────────────────────────────────── */}
        {categoryMonthHeatmap.cats.length > 0 && (
          <div className="card">
            <div className="card-title" style={{ marginBottom: 12 }}>카테고리 × 월별 지출 히트맵 (최근 6개월)</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "separate", borderSpacing: 4, fontSize: 12, width: "100%" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600, color: "var(--text-muted)" }}>
                      카테고리
                    </th>
                    {categoryMonthHeatmap.months.map((m) => (
                      <th
                        key={m}
                        style={{ textAlign: "center", padding: "4px 8px", fontWeight: 600, color: "var(--text-muted)", minWidth: 68 }}
                      >
                        {m.slice(5)}월
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {categoryMonthHeatmap.cats.map((cat) => (
                    <tr key={cat}>
                      <td style={{ padding: "4px 8px", fontWeight: 500, whiteSpace: "nowrap" }}>{cat}</td>
                      {categoryMonthHeatmap.months.map((m) => {
                        const val = categoryMonthHeatmap.data.get(`${m}:${cat}`) ?? 0;
                        const intensity = val / categoryMonthHeatmap.maxVal;
                        return (
                          <td
                            key={m}
                            title={`${cat} ${m}: ${formatKRW(Math.round(val))}`}
                            style={{
                              textAlign: "center",
                              padding: "6px 8px",
                              borderRadius: 6,
                              background:
                                val > 0
                                  ? `rgba(220,38,38,${Math.min(0.9, intensity * 0.8 + 0.1).toFixed(2)})`
                                  : "var(--surface)",
                              color: intensity > 0.5 ? "white" : "var(--text)",
                              fontWeight: val > 0 ? 600 : 400,
                            }}
                          >
                            {val > 0 ? `${Math.round(val / 10000)}만` : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
