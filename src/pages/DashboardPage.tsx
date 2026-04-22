import React, { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { DeferredResponsiveContainer as ResponsiveContainer } from "../components/charts/DeferredResponsiveContainer";
import { BudgetAlertWidget } from "../features/dashboard/AdvancedWidgets";
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
import {
  getThisMonthKST,
  getTodayKST,
  getLastDayOfMonth,
  parseIsoLocal,
  formatIsoLocal,
  addDaysToIso,
  shiftMonth,
  getMonthEndDate,
  buildMonthRange,
} from "../utils/date";
import { getCategoryType, isSavingsExpenseEntry } from "../utils/category";
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
  // 캘린더에서 선택한 날짜 — null이면 상세 표 숨김, 값이 있으면 해당 날짜 항목만 표시.
  // cashflowMonth가 바뀌면 자동 초기화 (월이 변경되면 이전 달 선택은 무의미).
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);
  React.useEffect(() => { setSelectedCalendarDate(null); }, [cashflowMonth]);
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

  /**
   * 공통: 월 prefix(또는 null=전체) 기준으로 수입/지출/재테크 합계 계산.
   * 메모이즈된 isSavingsExpenseEntry와 함께 단일 루프로 처리.
   */
  const computeSummary = useCallback(
    (monthPrefix: string | null) => {
      const toKrw = (entry: LedgerEntry) =>
        entry.currency === "USD" && fxRate ? entry.amount * fxRate : entry.amount;
      let income = 0;
      let expense = 0;
      let investing = 0;
      for (const entry of ledger) {
        if (!entry.date) continue;
        if (monthPrefix && !entry.date.startsWith(monthPrefix)) continue;
        if (entry.kind === "income") {
          income += toKrw(entry);
        } else if (entry.kind === "expense") {
          expense += toKrw(entry);
        } else if (entry.kind === "transfer") {
          // 저축이체/투자이체 (+ 구버전 저축/투자) → 자산 축적
          const sub = entry.subCategory;
          if (sub === "저축이체" || sub === "투자이체" || sub === "저축" || sub === "투자") {
            investing += toKrw(entry);
          }
        }
      }
      return { income, expense, investing };
    },
    [ledger, fxRate, accounts, categoryPresets]
  );

  /** 전체 기간 합계: 수입, 일반 지출, 재테크 지출 */
  const allTimeSummary = useMemo(() => computeSummary(null), [computeSummary]);

  const monthlySummary = useMemo(() => ({
    month: currentMonth,
    ...computeSummary(currentMonth),
  }), [computeSummary, currentMonth]);

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
  const lastMonthSummary = useMemo(() => ({
    month: lastMonth,
    ...computeSummary(lastMonth),
  }), [computeSummary, lastMonth]);

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
          continue;
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
        const debt = Math.abs(account.debt ?? 0);
        const accountValue = cash + usdToKrw + stock - debt;
        totalValue += accountValue;

        if (account.type === "securities" || account.type === "crypto") {
          totalStockValue += stock;
        } else if (account.type === "savings") {
          totalSavingsValue += cash - debt;
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
      .filter((trade) => canonicalTickerForMatch(trade.ticker) === rise200Canonical)
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
      if (canonicalTickerForMatch(sourceTicker) !== rise200Canonical) return;
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

  /** 순자산 추이: accountTimelineRows에서 month, total 추출 (만원 단위) */
  const netWorthTrendData = useMemo(() => {
    if (accountTimelineRows.length === 0) return [] as Array<{ month: string; value: number }>;
    return accountTimelineRows.map((row) => ({
      month: String(row.month),
      value: Math.round(Number(row.total) / 10000)
    }));
  }, [accountTimelineRows]);

  const calendarWindowStart = useMemo(() => addDaysToIso(today, -365), [today]);
  const calendarWindowEnd = useMemo(() => addDaysToIso(today, 89), [today]);

  const spendingCalendarRows = useMemo(() => {
    const rows: SpendingCalendarRow[] = [];
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
        const isSavings = isSavingsExpenseEntry(entry, accounts, categoryPresets);
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
      } else if (entry.kind === "transfer" &&
                 (entry.subCategory === "저축이체" || entry.subCategory === "투자이체" ||
                  entry.subCategory === "저축" || entry.subCategory === "투자")) {
        // 재테크 이체 (저축·투자) → 실제 자산 축적
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
      // 순수 생활비만: 재테크(투자손실)·저축성지출·신용결제 제외
      if (entry.category === "재테크" || entry.category === "신용결제") return;
      if (isSavingsExpenseEntry(entry, accounts, categoryPresets)) return;
      totalExpense += toKrw(entry);
    });
    const monthlyDividend = totalDividend / 12;
    const monthlyExpense = totalExpense / 12;
    const fireRate = monthlyExpense > 0 ? (monthlyDividend / monthlyExpense) * 100 : 0;
    return { monthlyDividend, monthlyExpense, fireRate };
  }, [ledger, fxRate, accounts, categoryPresets, currentMonth]);

  const topCategoriesThisMonth = useMemo(() => {
    const toKrw = (entry: LedgerEntry) =>
      entry.currency === "USD" && fxRate ? entry.amount * fxRate : entry.amount;
    const catMap = new Map<string, number>();
    ledger.forEach((entry) => {
      if (!entry.date?.startsWith(currentMonth)) return;
      if (entry.kind !== "expense") return;
      // 재테크(투자손실)·신용결제·저축성지출은 생활비 Top 5에서 제외
      if (entry.category === "재테크" || entry.category === "신용결제") return;
      if (isSavingsExpenseEntry(entry, accounts, categoryPresets)) return;
      const cat = entry.subCategory || entry.category || "기타";
      catMap.set(cat, (catMap.get(cat) ?? 0) + toKrw(entry));
    });
    return Array.from(catMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [ledger, currentMonth, fxRate, accounts, categoryPresets]);

  const monthlyTrendData = useMemo(() => {
    const toKrw = (entry: LedgerEntry) =>
      entry.currency === "USD" && fxRate ? entry.amount * fxRate : entry.amount;
    const map = new Map<string, { income: number; expense: number; investing: number }>();
    ledger.forEach((entry) => {
      if (!entry.date) return;
      const m = entry.date.slice(0, 7);
      if (!map.has(m)) map.set(m, { income: 0, expense: 0, investing: 0 });
      const row = map.get(m)!;
      if (entry.kind === "income") row.income += toKrw(entry);
      else if (entry.kind === "expense") {
        if (isSavingsExpenseEntry(entry, accounts, categoryPresets)) row.investing += toKrw(entry);
        else row.expense += toKrw(entry);
      }
    });
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-6)
      .map(([month, data]) => ({
        month: month.slice(5),
        ...data
      }));
  }, [ledger, fxRate, accounts, categoryPresets]);

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
            <div className="card-title">이번 달 지출</div>
            <div className="card-value" style={{ color: "var(--chart-expense)", fontSize: 24 }}>
              {formatKRW(Math.round(monthlySummary.expense))}
            </div>
            <div className="hint" style={{ marginTop: 8 }}>
              전체 기간: {formatKRW(allTimeSummary.expense)}
            </div>
          </div>

          <div className="card" style={{ minHeight: 124, borderLeft: "4px solid var(--chart-income)" }}>
            <div className="card-title">이번 달 수입</div>
            <div className="card-value" style={{ color: "var(--chart-income)", fontSize: 24 }}>
              {formatKRW(Math.round(monthlySummary.income))}
            </div>
            <div className="hint" style={{ marginTop: 8 }}>전체 기간: {formatKRW(allTimeSummary.income)}</div>
          </div>

          <div className="card" style={{ minHeight: 124, borderLeft: "4px solid var(--chart-primary)" }}>
            <div className="card-title">이번 달 재테크</div>
            <div className="card-value" style={{ color: "var(--chart-primary)", fontSize: 24 }}>
              {formatKRW(Math.round(monthlySummary.investing))}
            </div>
            <div className="hint" style={{ marginTop: 8 }}>전체 기간: {formatKRW(allTimeSummary.investing)}</div>
          </div>

          <div className="card" style={{ minHeight: 124, borderLeft: "4px solid var(--success)" }}>
            <div className="card-title">이번 달 수지</div>
            <div className="card-value" style={{ color: monthlySummary.income - monthlySummary.expense >= 0 ? "var(--success)" : "var(--danger)", fontSize: 24 }}>
              {formatKRW(Math.round(monthlySummary.income - monthlySummary.expense))}
            </div>
            <div className="hint" style={{ marginTop: 8 }}>수입 − 지출 (장부 기준)</div>
          </div>
        </div>

        {/* ── 순자산 추이 ─────────────────────────────────────────────────────── */}
        {netWorthTrendData.length >= 2 && (() => {
          const values = netWorthTrendData.map((d) => d.value);
          const minVal = Math.min(...values);
          const maxVal = Math.max(...values);
          const range = maxVal - minVal || 1;
          const PAD_L = 56;
          const PAD_R = 16;
          const PAD_T = 16;
          const PAD_B = 28;
          const W = 600;
          const H = 160;
          const chartW = W - PAD_L - PAD_R;
          const chartH = H - PAD_T - PAD_B;
          const n = netWorthTrendData.length;

          const toX = (i: number) => PAD_L + (i / (n - 1)) * chartW;
          const toY = (v: number) => PAD_T + chartH - ((v - minVal) / range) * chartH;

          const pts = netWorthTrendData.map((d, i) => ({ x: toX(i), y: toY(d.value), ...d }));
          const polyline = pts.map((p) => `${p.x},${p.y}`).join(" ");
          const areaPath =
            `M${pts[0].x},${PAD_T + chartH} ` +
            pts.map((p) => `L${p.x},${p.y}`).join(" ") +
            ` L${pts[pts.length - 1].x},${PAD_T + chartH} Z`;

          const currentPt = pts[pts.length - 1];
          const currentWorth = netWorthTrendData[netWorthTrendData.length - 1].value;

          // Y axis ticks (3 ticks)
          const yTicks = [minVal, Math.round((minVal + maxVal) / 2), maxVal];

          // X axis: show label every N months to avoid crowding
          const labelStep = n <= 12 ? 1 : n <= 24 ? 2 : n <= 36 ? 3 : 6;
          const xLabels = pts.filter((_, i) => i % labelStep === 0 || i === n - 1);

          const gradId = "nwt-grad";

          return (
            <div className="card" style={{ padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                <div className="card-title" style={{ margin: 0 }}>순자산 추이</div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 700, fontSize: 20, color: "var(--primary)" }}>
                    {currentWorth >= 0 ? "" : "-"}{Math.abs(currentWorth).toLocaleString()}만원
                  </div>
                  <div className="hint" style={{ fontSize: 12 }}>현재 순자산</div>
                </div>
              </div>
              <div style={{ width: "100%", overflowX: "auto" }}>
                <svg
                  viewBox={`0 0 ${W} ${H}`}
                  width="100%"
                  style={{ display: "block", minWidth: 280, maxHeight: 180 }}
                  aria-label="순자산 추이 차트"
                >
                  <defs>
                    <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary, #2563eb)" stopOpacity="0.28" />
                      <stop offset="100%" stopColor="var(--primary, #2563eb)" stopOpacity="0.02" />
                    </linearGradient>
                  </defs>

                  {/* Y grid lines + labels */}
                  {yTicks.map((tick) => {
                    const y = toY(tick);
                    const label = tick >= 0
                      ? `${tick.toLocaleString()}`
                      : `-${Math.abs(tick).toLocaleString()}`;
                    return (
                      <g key={tick}>
                        <line
                          x1={PAD_L} y1={y} x2={W - PAD_R} y2={y}
                          stroke="var(--border, #e5e7eb)" strokeWidth={1} strokeDasharray="3 3"
                        />
                        <text
                          x={PAD_L - 4} y={y + 4}
                          textAnchor="end"
                          fontSize={10}
                          fill="var(--text-muted, #9ca3af)"
                        >
                          {label}
                        </text>
                      </g>
                    );
                  })}

                  {/* Gradient fill area */}
                  <path d={areaPath} fill={`url(#${gradId})`} />

                  {/* Line */}
                  <polyline
                    points={polyline}
                    fill="none"
                    stroke="var(--primary, #2563eb)"
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />

                  {/* Data points (small) */}
                  {pts.map((p, i) => (
                    <circle
                      key={i}
                      cx={p.x} cy={p.y} r={2.5}
                      fill="var(--primary, #2563eb)"
                      opacity={0.6}
                    />
                  ))}

                  {/* Current point highlight */}
                  <circle
                    cx={currentPt.x} cy={currentPt.y} r={5}
                    fill="var(--primary, #2563eb)"
                    stroke="var(--bg, #fff)" strokeWidth={2}
                  />

                  {/* X axis labels */}
                  {xLabels.map((p) => (
                    <text
                      key={p.month}
                      x={p.x} y={H - 6}
                      textAnchor="middle"
                      fontSize={9.5}
                      fill="var(--text-muted, #9ca3af)"
                    >
                      {p.month.slice(2)}
                    </text>
                  ))}
                </svg>
              </div>
              <div className="hint" style={{ fontSize: 11, marginTop: 4, textAlign: "right" }}>
                단위: 만원 · {netWorthTrendData[0]?.month} ~ {netWorthTrendData[netWorthTrendData.length - 1]?.month}
              </div>
            </div>
          );
        })()}

        <div className="dashboard-two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div className="card">
            <div className="card-title">이번 달 지출 Top 5 ({currentMonth})</div>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {topCategoriesThisMonth.length === 0 && (
                <div className="hint">이번 달 지출 데이터가 없습니다.</div>
              )}
              {topCategoriesThisMonth.map(([cat, amount], i) => {
                const maxAmt = topCategoriesThisMonth[0]?.[1] ?? 1;
                const pct = (amount / maxAmt) * 100;
                return (
                  <div key={cat}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 2 }}>
                      <span style={{ fontWeight: 600 }}>{i + 1}. {cat}</span>
                      <span style={{ fontWeight: 700, color: "var(--chart-expense)" }}>{formatKRW(Math.round(amount))}</span>
                    </div>
                    <div style={{ height: 6, background: "var(--border)", borderRadius: 3 }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: "var(--chart-expense)", borderRadius: 3, opacity: 1 - i * 0.15 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <div className="card-title">월별 추이 (최근 6개월)</div>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              {monthlyTrendData.map((row) => {
                const maxVal = Math.max(...monthlyTrendData.map(r => Math.max(r.income, r.expense + r.investing)));
                const incPct = maxVal > 0 ? (row.income / maxVal) * 100 : 0;
                const expPct = maxVal > 0 ? (row.expense / maxVal) * 100 : 0;
                const invPct = maxVal > 0 ? (row.investing / maxVal) * 100 : 0;
                return (
                  <div key={row.month}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 2 }}>
                      <span style={{ fontWeight: 600 }}>{row.month}</span>
                      <span className="hint">{formatKRW(Math.round(row.income))} / {formatKRW(Math.round(row.expense))}</span>
                    </div>
                    <div style={{ display: "flex", gap: 2, height: 8 }}>
                      <div style={{ width: `${incPct}%`, background: "var(--chart-income)", borderRadius: 3, minWidth: row.income > 0 ? 2 : 0 }} />
                      <div style={{ width: `${expPct}%`, background: "var(--chart-expense)", borderRadius: 3, minWidth: row.expense > 0 ? 2 : 0 }} />
                      <div style={{ width: `${invPct}%`, background: "var(--chart-primary)", borderRadius: 3, minWidth: row.investing > 0 ? 2 : 0 }} />
                    </div>
                  </div>
                );
              })}
              <div className="hint" style={{ fontSize: 11, marginTop: 4 }}>
                <span style={{ color: "var(--chart-income)" }}>■</span> 수입 <span style={{ color: "var(--chart-expense)" }}>■</span> 지출 <span style={{ color: "var(--chart-primary)" }}>■</span> 재테크
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ marginTop: 0 }}>
          <div className="card-title">이번 달 재테크 세부 ({monthlySummary.month})</div>
          <div
            className="dashboard-four-col"
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

        {/* ── Widget: 이번 달 페이스 예측 ───────────────────────────────── */}
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
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
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
              className="dashboard-two-col"
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
              className="dashboard-two-col"
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
                style={{ fontSize: 14, padding: "6px 14px", fontWeight: 600 }}
                onClick={() => setCashflowMonth((prev) => shiftMonth(prev, -1))}
              >
                ◀ 이전달
              </button>
              <strong style={{ minWidth: 80, textAlign: "center", fontSize: 15 }}>{cashflowMonth}</strong>
              <button
                type="button"
                className="secondary"
                style={{ fontSize: 14, padding: "6px 14px", fontWeight: 600 }}
                onClick={() => setCashflowMonth((prev) => shiftMonth(prev, 1))}
              >
                다음달 ▶
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
              gridTemplateColumns: "repeat(7, minmax(36px, 1fr))",
              gap: 4,
              overflowX: "auto",
              minWidth: 0,
            }}
          >
            {DAY_LABELS.map((day) => (
              <div key={day} style={{ textAlign: "center", fontSize: 13, fontWeight: 700, color: "var(--text-muted)" }}>
                {day}
              </div>
            ))}
            {calendarCells.map((cell) => {
              const isSelected = selectedCalendarDate === cell.date;
              const clickable = cell.inMonth;
              return (
              <div
                key={cell.date}
                onClick={() => {
                  if (!clickable) return;
                  setSelectedCalendarDate((prev) => (prev === cell.date ? null : cell.date));
                }}
                role={clickable ? "button" : undefined}
                tabIndex={clickable ? 0 : undefined}
                onKeyDown={(e) => {
                  if (!clickable) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedCalendarDate((prev) => (prev === cell.date ? null : cell.date));
                  }
                }}
                style={{
                  minHeight: 82,
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 6,
                  background: isSelected
                    ? "var(--primary-light)"
                    : cell.inMonth ? "var(--surface)" : "var(--bg)",
                  opacity: cell.inMonth ? 1 : 0.6,
                  outline: isSelected
                    ? "2px solid var(--primary)"
                    : cell.isToday ? "2px solid var(--primary)" : "none",
                  cursor: clickable ? "pointer" : "default",
                  transition: "background 120ms ease"
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
              );
            })}
          </div>

          <p className="hint" style={{ marginTop: 12, marginBottom: 8 }}>
            {cashflowMonth} 소비 {formatKRW(Math.round(selectedMonthTotals.spending))} / 재테크 {formatKRW(Math.round(selectedMonthTotals.investing))} / 수입 {formatKRW(Math.round(selectedMonthTotals.income))} · {selectedMonthSpendingRows.length}건
          </p>

          {/* 선택 날짜 세부 내역 — 캘린더 셀을 클릭하면 표시, 같은 셀 재클릭 시 닫힘 */}
          {selectedCalendarDate ? (() => {
            const dayRows = selectedMonthSpendingRows.filter((r) => r.date === selectedCalendarDate);
            const daySpending = dayRows.filter((r) => r.type === "spending").reduce((s, r) => s + r.amount, 0);
            const dayInvesting = dayRows.filter((r) => r.type === "investing").reduce((s, r) => s + r.amount, 0);
            const dayIncome = dayRows.filter((r) => r.type === "income").reduce((s, r) => s + r.amount, 0);
            return (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 14 }}>{selectedCalendarDate}</strong>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      소비 {formatKRW(Math.round(daySpending))} · 재테크 {formatKRW(Math.round(dayInvesting))} · 수입 {formatKRW(Math.round(dayIncome))} · {dayRows.length}건
                    </span>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    style={{ fontSize: 12, padding: "4px 10px" }}
                    onClick={() => setSelectedCalendarDate(null)}
                  >
                    닫기
                  </button>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table className="table compact" style={{ width: "100%", fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left" }}>분류</th>
                        <th style={{ textAlign: "left" }}>내역</th>
                        <th style={{ textAlign: "left" }}>계좌</th>
                        <th style={{ textAlign: "right" }}>금액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dayRows.map((row) => (
                        <tr key={`${row.id}:${row.date}`}>
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
                      {dayRows.length === 0 && (
                        <tr>
                          <td colSpan={4} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                            이 날짜에는 기록이 없습니다.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })() : (
            <p className="hint" style={{ marginTop: 8, marginBottom: 0, fontSize: 12, color: "var(--text-muted)" }}>
              캘린더에서 날짜를 클릭하면 해당 날짜의 세부 내역이 표시됩니다.
            </p>
          )}
        </div>


        {/* 예산 초과 알림 */}
        <BudgetAlertWidget
          accounts={accounts}
          ledger={ledger}
          trades={trades}
          prices={prices}
          fxRate={fxRate ?? 1300}
          categoryPresets={categoryPresets}
          budgetGoals={storeData.budgetGoals}
        />
      </div>
    </div>
  );
};
