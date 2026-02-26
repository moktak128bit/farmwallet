import React, { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  Treemap,
  XAxis,
  YAxis
} from "recharts";
import type {
  Account,
  LedgerEntry,
  RecurringExpense,
  StockPrice,
  StockTrade
} from "../types";
import {
  computeAccountBalances,
  computePositions,
  computeTotalDebt,
  computeTotalNetWorth,
  computeTotalSavings
} from "../calculations";
import { formatKRW } from "../utils/formatter";
import { useFxRate } from "../hooks/useFxRate";
import { useAppStore } from "../store/appStore";
import { getThisMonthKST, getTodayKST } from "../utils/date";
import { getCategoryType, getSavingsCategories, isSavingsExpenseEntry } from "../utils/category";
import { canonicalTickerForMatch, extractTickerFromText, isUSDStock } from "../utils/finance";

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
const ACCOUNT_LINE_COLORS = [
  "#2563eb",
  "#dc2626",
  "#059669",
  "#7c3aed",
  "#d97706",
  "#db2777",
  "#0891b2",
  "#84cc16"
];

function TreemapContent(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  fill?: string;
  index?: number;
  depth?: number;
  tooltipIndex?: string;
  children?: unknown[];
}) {
  const { x = 0, y = 0, width = 0, height = 0, name = "", fill, index = 0 } = props;
  const colors = [
    "var(--chart-series-a)",
    "var(--chart-positive)",
    "var(--chart-primary)",
    "#0ea5e9",
    "#10b981",
    "#f59e0b"
  ];
  const color = fill || colors[index % colors.length];
  const showLabel = width >= 48 && height >= 24 && name;
  const label = name.length > 12 ? `${name.slice(0, 10)}...` : name;
  const rx = Math.round(x);
  const ry = Math.round(y);
  const rw = Math.max(0, Math.round(width));
  const rh = Math.max(0, Math.round(height));
  return (
    <g>
      <rect
        x={rx}
        y={ry}
        width={rw}
        height={rh}
        fill={color}
        stroke="var(--surface)"
        strokeWidth={1}
        shapeRendering="crispEdges"
      />
      {showLabel && (
        <text
          x={rx + 6}
          y={ry + rh / 2}
          dominantBaseline="middle"
          fontSize={11}
          fontWeight={600}
          fill="white"
          stroke="#0f172a"
          strokeWidth={2}
          strokeLinejoin="round"
          paintOrder="stroke"
          style={{ textRendering: "optimizeLegibility" }}
        >
          {label}
        </text>
      )}
    </g>
  );
}

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

  const fxRate = useFxRate();
  const currentMonth = useMemo(() => getThisMonthKST(), []);
  const today = useMemo(() => getTodayKST(), []);

  const [cashflowMonth, setCashflowMonth] = useState<string>(currentMonth);
  const [spendingFilterType, setSpendingFilterType] = useState<"" | "spending" | "investing" | "income">("");

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

  const totalSavings = useMemo(
    () => computeTotalSavings(balances, accounts),
    [balances, accounts]
  );
  const totalStock = useMemo(
    () => positions.reduce((s, p) => s + p.marketValue, 0),
    [positions]
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
        account.type === "securities"
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
        if (account?.type === "securities" && isUSDStock(trade.ticker)) continue;
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
          (stockByAccount.get(position.accountId) ?? 0) + position.marketValue
        );
      });

      let totalStockValue = 0;
      let totalSavingsValue = 0;
      let totalValue = 0;
      const row: AccountTimelineRow = { month, stock: 0, savings: 0, total: 0 };
      accounts.forEach((account) => {
        const cash = runningBalanceByAccount.get(account.id) ?? 0;
        const usdCash =
          account.type === "securities"
            ? (account.usdBalance ?? 0) + (runningUsdTransferNetByAccount.get(account.id) ?? 0)
            : 0;
        const usdToKrw = fxRate && usdCash !== 0 ? usdCash * fxRate : 0;
        const stock = stockByAccount.get(account.id) ?? 0;
        const debt = account.debt ?? 0;
        const accountValue = cash + usdToKrw + stock + debt;
        totalValue += accountValue;

        if (account.type === "securities") {
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


  const portfolioTreemapData = useMemo(() => {
    type TreemapChild = { name: string; value: number; fill: string };
    type TreemapGroup = { name: string; value: number; fill: string; children: TreemapChild[] };

    const cashColor = "#2563eb";
    const savingsColor = "#059669";
    const stockColor = "#7c3aed";

    const cashChildren: TreemapChild[] = [];
    const savingsChildren: TreemapChild[] = [];
    const stockChildren: TreemapChild[] = [];

    balances.forEach((row) => {
      const { account } = row;
      const label = account.name || account.id;
      if (account.type === "checking" || account.type === "other") {
        const v = row.currentBalance;
        if (v > 0) {
          cashChildren.push({ name: label, value: v, fill: "#3b82f6" });
        }
      } else if (account.type === "securities") {
        const krw = row.currentBalance;
        const usd = (account.usdBalance ?? 0) + (row.usdTransferNet ?? 0);
        const usdKrw = fxRate && usd ? usd * fxRate : 0;
        const cashTotal = krw + usdKrw;
        if (cashTotal > 0) {
          cashChildren.push({ name: label, value: cashTotal, fill: "#3b82f6" });
        }
      } else if (account.type === "savings") {
        const v = row.currentBalance;
        if (v > 0) {
          savingsChildren.push({ name: label, value: v, fill: "#10b981" });
        }
      }
    });

    const stockByTicker = new Map<string, { value: number; name: string }>();
    positions.forEach((p) => {
      const ticker = p.ticker || p.accountId;
      const label = p.name || p.ticker || ticker;
      const prev = stockByTicker.get(ticker);
      if (prev) {
        prev.value += p.marketValue;
      } else {
        stockByTicker.set(ticker, { value: p.marketValue, name: label });
      }
    });
    stockByTicker.forEach(({ value, name }) => {
      if (value > 0) {
        stockChildren.push({ name, value, fill: "#8b5cf6" });
      }
    });

    const groups: TreemapGroup[] = [];
    const cashTotal = cashChildren.reduce((s, c) => s + c.value, 0);
    if (cashTotal > 0) {
      groups.push({ name: "현금", value: cashTotal, fill: cashColor, children: cashChildren });
    }
    const savingsTotal = savingsChildren.reduce((s, c) => s + c.value, 0);
    if (savingsTotal > 0) {
      groups.push({ name: "예적금", value: savingsTotal, fill: savingsColor, children: savingsChildren });
    }
    const stockTotal = stockChildren.reduce((s, c) => s + c.value, 0);
    if (stockTotal > 0) {
      groups.push({ name: "주식", value: stockTotal, fill: stockColor, children: stockChildren });
    }

    return groups;
  }, [balances, positions, fxRate]);

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
      yieldRate: number | null;
    };

    const toKrw = (entry: LedgerEntry) =>
      entry.currency === "USD" && fxRate ? entry.amount * fxRate : entry.amount;
    const dividendByMonth = new Map<string, number>();
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
      const month = entry.date?.slice(0, 7);
      if (!month) return;
      dividendByMonth.set(month, (dividendByMonth.get(month) ?? 0) + toKrw(entry));
      monthSet.add(month);
    });

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
        changeRate: null as number | null
      };
    }

    const fullMonths = buildMonthRange(months[0], months[months.length - 1]);
    type Lot = { qty: number; totalAmount: number };
    const lots: Lot[] = [];
    let tradeIndex = 0;
    const rows: TrendRow[] = [];

    for (const month of fullMonths) {
      while (
        tradeIndex < tickerTrades.length &&
        tickerTrades[tradeIndex].date.slice(0, 7) <= month
      ) {
        const trade = tickerTrades[tradeIndex];
        if (trade.side === "buy") {
          lots.push({ qty: trade.quantity, totalAmount: trade.totalAmount });
        } else {
          let remaining = trade.quantity;
          while (remaining > 0 && lots.length > 0) {
            const lot = lots[0];
            const used = Math.min(remaining, lot.qty);
            const usedCost = (lot.totalAmount / lot.qty) * used;
            lot.qty -= used;
            lot.totalAmount -= usedCost;
            remaining -= used;
            if (lot.qty <= 0) lots.shift();
          }
        }
        tradeIndex += 1;
      }

      const shares = lots.reduce((sum, lot) => sum + lot.qty, 0);
      const costBasis = lots.reduce((sum, lot) => sum + lot.totalAmount, 0);
      const dividend = dividendByMonth.get(month) ?? 0;
      const yieldRate = costBasis > 0 ? (dividend / costBasis) * 100 : null;

      rows.push({
        month,
        shares,
        dividend,
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
      changeRate: dividendChangeRate
    };
  }, [ledger, trades, fxRate, trackedTicker]);

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
          <div className="card" style={{ minHeight: 124, borderLeft: "4px solid var(--chart-primary)" }}>
            <div className="card-title">전체 지출</div>
            <div className="card-value">{formatKRW(Math.round(totalNetWorth))}</div>
            <div className="hint" style={{ marginTop: 8 }}>
              전체 지출(주식 평가금 반영, 배당 포함)
            </div>
          </div>

          <div className="card" style={{ minHeight: 124, borderLeft: "4px solid var(--chart-income)" }}>
            <div className="card-title">이번 달 수입 ({monthlySummary.month})</div>
            <div className="card-value" style={{ color: "var(--chart-income)" }}>
              {formatKRW(Math.round(monthlySummary.income))}
            </div>
            <div className="hint" style={{ marginTop: 8 }}>당월 실제 수입 합계</div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 16
          }}
        >
          <div className="card" style={{ minHeight: 200 }}>
            <div className="card-title">저축 대비 비교</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 8 }}>
              <div>
                <div className="hint" style={{ fontSize: 11, marginBottom: 4 }}>이번 달 저축 ({monthlySummary.month})</div>
                <div
                  className="card-value"
                  style={{ fontSize: 22, color: savingsRate != null ? "var(--chart-primary)" : "var(--text-muted)" }}
                >
                  {savingsRate != null ? `${savingsRate.toFixed(1)}%` : "-"}
                </div>
                <div className="hint" style={{ fontSize: 11, marginTop: 4 }}>수입 대비 저축비율</div>
              </div>
              <div>
                <div className="hint" style={{ fontSize: 11, marginBottom: 4 }}>지출 구성 (주식 대비 저축)</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>
                  주식 {investingSavingsRatio.stockPct.toFixed(0)}% / 저축 {investingSavingsRatio.savingsPct.toFixed(0)}%
                </div>
                <div className="hint" style={{ fontSize: 11, marginTop: 4 }}>
                  {formatKRW(Math.round(totalStock))} / {formatKRW(Math.round(totalSavings))}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 12, height: 8, display: "flex", borderRadius: 4, overflow: "hidden" }}>
              <div
                style={{
                  width: `${investingSavingsRatio.stockPct}%`,
                  background: "var(--chart-primary)",
                  minWidth: investingSavingsRatio.stockPct > 0 ? 4 : 0
                }}
              />
              <div
                style={{
                  width: `${investingSavingsRatio.savingsPct}%`,
                  background: "var(--chart-positive)",
                  minWidth: investingSavingsRatio.savingsPct > 0 ? 4 : 0
                }}
              />
            </div>
          </div>
        </div>

        <div className="card" style={{ marginTop: 16, padding: 20 }}>
          <div className="card-title" style={{ fontSize: 18 }}>자산 구성 트리맵 (종류별)</div>
          <div style={{ width: "100%", height: 420, marginTop: 12 }}>
            {portfolioTreemapData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <Treemap
                  data={portfolioTreemapData}
                  dataKey="value"
                  nameKey="name"
                  stroke="var(--surface)"
                  fill="var(--chart-series-a)"
                  content={(props: React.ComponentProps<typeof TreemapContent>) => <TreemapContent {...props} />}
                >
                  <Tooltip
                    formatter={(val: number) => formatKRW(Math.round(val))}
                    contentStyle={{ fontSize: 13, fontWeight: 600 }}
                  />
                </Treemap>
              </ResponsiveContainer>
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  color: "var(--text-muted)",
                  fontSize: 13
                }}
              >
                지출 데이터가 없습니다.
              </div>
            )}
          </div>
          <div className="hint" style={{ marginTop: 12, textAlign: "center" }}>
            순자산 {formatKRW(Math.round(totalNetWorth))}
            {totalDebt < 0 && (
              <span style={{ marginLeft: 8, color: "var(--chart-expense)" }}>
                (부채 {formatKRW(Math.round(Math.abs(totalDebt)))})
              </span>
            )}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16
          }}
        >
          <div className="card" style={{ minHeight: 180 }}>
            <div className="card-title">해당 금액 상세 (최근 3개월 기준)</div>
            <div
              className="card-value"
              style={{
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
            {/* Bullet Chart: 가계부 지출 막대=100% */}
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
            <div className="card-title">TIGER 미국배당 해당금액 변동 (전체 기준)</div>
            <div
              className={`card-value ${
                trackedDividendTrend.changeRate == null
                  ? ""
                  : trackedDividendTrend.changeRate >= 0
                    ? "positive"
                    : "negative"
              }`}
            >
              {trackedDividendTrend.changeRate == null
                ? "-"
                : `${trackedDividendTrend.changeRate >= 0 ? "+" : ""}${trackedDividendTrend.changeRate.toFixed(1)}%`}
            </div>
            <div className="hint" style={{ marginTop: 8 }}>
              {trackedDividendTrend.latest && trackedDividendTrend.previous
                ? `${trackedDividendTrend.previous.month} ${formatKRW(Math.round(trackedDividendTrend.previous.dividend))} → ${trackedDividendTrend.latest.month} ${formatKRW(Math.round(trackedDividendTrend.latest.dividend))}`
                : `${trackedDividendTrend.ticker} 배당 데이터가 없습니다.`}
            </div>
            <div style={{ width: "100%", height: 130, marginTop: 12 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trackedDividendTrend.rows} margin={{ top: 8, right: 12, left: 12, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="month" fontSize={11} tickFormatter={(v) => String(v).slice(2)} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="left" hide />
                  <YAxis yAxisId="right" orientation="right" hide />
                  <Legend wrapperStyle={{ fontSize: 12 }} iconSize={10} iconType="circle" />
                  <Tooltip
                    formatter={(val: any, name?: string) => {
                      if (name === "주수") return [`${Number(val).toLocaleString()}주`, name];
                      return [formatKRW(Math.round(Number(val ?? 0))), name ?? ""];
                    }}
                    contentStyle={{ fontSize: 13, fontWeight: 600 }}
                  />
                  <Bar yAxisId="left" dataKey="dividend" name="배당금(수입)" fill="var(--chart-income)" maxBarSize={32} radius={[4, 4, 0, 0]} />
                  <Line yAxisId="right" dataKey="shares" name="주수" stroke="var(--chart-expense)" strokeWidth={2.5} dot={{ r: 4, fill: "var(--chart-expense)" }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div style={{ width: "100%", height: 80, marginTop: 10 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trackedDividendTrend.rows} margin={{ top: 8, right: 12, left: 12, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="month" fontSize={11} tickFormatter={(v) => String(v).slice(2)} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Legend wrapperStyle={{ fontSize: 12 }} iconSize={10} iconType="circle" />
                  <Tooltip
                    formatter={(val: any, name?: string) => [
                      val == null ? "-" : `${Number(val).toFixed(2)}%`,
                      name ?? "배당률"
                    ]}
                    contentStyle={{ fontSize: 13, fontWeight: 600 }}
                  />
                  <Line dataKey="yieldRate" name="배당률" stroke="var(--chart-warning)" strokeWidth={2.5} dot={{ r: 4, fill: "var(--chart-warning)" }} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
              <div className={trackedDividendTrend.shareChange >= 0 ? "positive" : "negative"}>
                주식수 {trackedDividendTrend.shareChange >= 0 ? "+" : ""}{trackedDividendTrend.shareChange.toLocaleString()}
                {trackedDividendTrend.shareChangeRate == null ? "" : ` (${trackedDividendTrend.shareChangeRate >= 0 ? "+" : ""}${trackedDividendTrend.shareChangeRate.toFixed(1)}%)`}
              </div>
              <div className={trackedDividendTrend.dividendChange >= 0 ? "positive" : "negative"}>
                배당 {trackedDividendTrend.dividendChange >= 0 ? "+" : ""}{formatKRW(Math.round(trackedDividendTrend.dividendChange))}
              </div>
              <div className={trackedDividendTrend.yieldChange >= 0 ? "positive" : "negative"}>
                배당·{trackedDividendTrend.yieldChangeRate == null ? "-" : `${trackedDividendTrend.yieldChangeRate >= 0 ? "+" : ""}${trackedDividendTrend.yieldChangeRate.toFixed(1)}%`}
              </div>
            </div>
          </div>

          <div className="card" style={{ minHeight: 240 }}>
            <div className="card-title">주말 지출 대비 평일 지출(최근 30일)</div>
            <div className="card-value">{weekendWeekdayStats.weekendRatio.toFixed(1)}%</div>
            <div className="hint" style={{ marginTop: 8 }}>
              주말 {formatKRW(Math.round(weekendWeekdayStats.weekendSpend))}
              {" / 평일 "}
              {formatKRW(Math.round(weekendWeekdayStats.weekdaySpend))}
            </div>
            <div style={{ width: "100%", height: 140, marginTop: 12 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={weekendWeekdayMiniRows} margin={{ top: 8, right: 12, left: 12, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" fontSize={12} axisLine={false} tickLine={false} tick={{ fontWeight: 600 }} />
                  <YAxis hide />
                  <Tooltip formatter={(val: any) => [formatKRW(Math.round(Number(val ?? 0))), "지출"]} contentStyle={{ fontSize: 13, fontWeight: 600 }} />
                  <Bar dataKey="amount" name="지출" maxBarSize={48} radius={[6, 6, 0, 0]}>
                    {weekendWeekdayMiniRows.map((_, index) => (
                      <Cell key={index} fill={index === 0 ? "var(--chart-series-a)" : "var(--chart-series-b)"} />
                    ))}
                  </Bar>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-title" style={{ marginBottom: 12 }}>지출 구성 비율</div>

          <div style={{ width: "100%", height: 320, minHeight: 320 }}>
            {assetGrowthRows.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={assetGrowthRows} margin={{ top: 16, right: 24, left: 20, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="month" fontSize={11} axisLine={false} tickLine={false} />
                  <YAxis
                    fontSize={11}
                    tickFormatter={(v) => `${Math.round(Number(v) / 10000)}만`}
                    axisLine={false}
                    tickLine={false}
                    width={56}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.[0]?.payload) return null;
                      const p = payload[0].payload as { value: number; change?: number; changeRate?: number | null };
                      return (
                        <div
                          style={{
                            padding: "10px 14px",
                            borderRadius: 8,
                            background: "var(--surface)",
                            border: "1px solid var(--border)",
                            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                            fontSize: 12
                          }}
                        >
                          <div style={{ fontWeight: 700, marginBottom: 8 }}>{label}</div>
                          <div>당월 지출: {formatKRW(Math.round(p.value))}</div>
                          {p.change != null && (
                            <div>
                              전일 대비{" "}
                              <span className={p.change >= 0 ? "positive" : "negative"}>
                                {p.change >= 0 ? "+" : ""}{formatKRW(Math.round(p.change))}
                              </span>
                            </div>
                          )}
                          {p.changeRate != null && (
                            <div>
                              전일 비율{" "}
                              <span className={p.changeRate >= 0 ? "positive" : "negative"}>
                                {p.changeRate >= 0 ? "+" : ""}{p.changeRate.toFixed(2)}%
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    name="전체 지출"
                    stroke={ACCOUNT_LINE_COLORS[0]}
                    strokeWidth={2.4}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
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
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={[...assetGrowthRows].reverse()}
                    margin={{ top: 8, right: 12, left: 8, bottom: 8 }}
                    layout="vertical"
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                    <XAxis
                      type="number"
                      tickFormatter={(v) => `${Math.round(Number(v) / 10000)}만`}
                      fontSize={10}
                      axisLine={false}
                      tickLine={false}
                      width={50}
                    />
                    <YAxis
                      type="category"
                      dataKey="month"
                      width={56}
                      fontSize={10}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 10 }}
                    />
                    <Tooltip
                      formatter={(val: number) => formatKRW(Math.round(val))}
                      contentStyle={{ fontSize: 12, fontWeight: 600 }}
                      labelFormatter={(v) => String(v)}
                    />
                    <Bar dataKey="stock" name="주식(주식)" stackId="a" fill="var(--chart-primary)" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="savings" name="저축 적금" stackId="a" fill="var(--chart-positive)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
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
              display: "grid",
              gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
              gap: 6
            }}
          >
            {DAY_LABELS.map((day) => (
              <div key={day} style={{ textAlign: "center", fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>
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
                <div style={{ fontSize: 12, fontWeight: 600, color: cell.date < today ? "var(--text-muted)" : "var(--text)" }}>
                  {cell.day}
                </div>
                {cell.spending > 0 && (
                  <div style={{ marginTop: 4, fontSize: 10, color: "var(--chart-expense)", fontWeight: 600 }}>
                    소비 {formatKRW(Math.round(cell.spending))}
                  </div>
                )}
                {cell.investing > 0 && (
                  <div style={{ marginTop: 2, fontSize: 10, color: "var(--chart-primary)", fontWeight: 600 }}>
                    재테크 {formatKRW(Math.round(cell.investing))}
                  </div>
                )}
                {cell.income > 0 && (
                  <div style={{ marginTop: 2, fontSize: 10, color: "var(--chart-income)", fontWeight: 600 }}>
                    수입 {formatKRW(Math.round(cell.income))}
                  </div>
                )}
                {cell.count > 0 && (
                  <div style={{ marginTop: 2, fontSize: 9, color: "var(--text-muted)" }}>
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
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[...catalogSpendRows].reverse()}
                  layout="vertical"
                  margin={{ top: 4, right: 24, left: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                  <XAxis type="number" tickFormatter={(v) => `${Math.round(v / 10000)}만`} fontSize={11} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="catalog" width={120} fontSize={11} axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
                  <Tooltip
                    formatter={(val: any) => [formatKRW(Math.round(Number(val ?? 0))), "금액"]}
                    contentStyle={{ borderRadius: 8, border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}
                  />
                  <Bar dataKey="amount" name="지출" fill="var(--chart-expense)" maxBarSize={28} radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
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
      </div>
    </div>
  );
};
