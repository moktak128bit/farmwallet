import React, { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { BudgetAlertWidget } from "../features/dashboard/BudgetAlertWidget";
import { InvestmentSummaryCard } from "../features/dashboard/InvestmentSummaryCard";
import { InvestmentRecordCard } from "../features/dashboard/InvestmentRecordCard";
import { MonthlySummaryCards } from "../features/dashboard/MonthlySummaryCards";
import { ExpenseIncomeCompareCard } from "../features/dashboard/ExpenseIncomeCompareCard";
import { NetWorthTrendChart } from "../features/dashboard/NetWorthTrendChart";
import { CmaBalanceTrendCard } from "../features/dashboard/CmaBalanceTrendCard";
import { MonthPaceCard } from "../features/dashboard/MonthPaceCard";
import { SalaryTimerCard } from "../features/dashboard/SalaryTimerCard";
import { SpendingCalendarCard } from "../features/dashboard/SpendingCalendarCard";
import { TopExpensesCard } from "../features/dashboard/TopExpensesCard";
import { MonthlyTrendCard } from "../features/dashboard/MonthlyTrendCard";
import { InvestmentBreakdownCard } from "../features/dashboard/InvestmentBreakdownCard";
import { SavingsRatioCard } from "../features/dashboard/SavingsRatioCard";
import { DividendCoverageCard } from "../features/dashboard/DividendCoverageCard";
import { AssetCompositionCard } from "../features/dashboard/AssetCompositionCard";
import { AccountBalanceTrendCard } from "../features/dashboard/AccountBalanceTrendCard";
import { StockCostVsMarketCard } from "../features/dashboard/StockCostVsMarketCard";
import { TotalAssetTrendCard } from "../features/dashboard/TotalAssetTrendCard";
import type {
  Account,
  LedgerEntry,
  StockPrice,
  StockTrade
} from "../types";
import {
  computeAccountBalances,
  computeBalanceAtDateForAccounts,
  computeLoanBalanceAt,
  computePositions,
  computeRealizedPnlByTradeId,
  computeTotalDebt,
  computeTotalNetWorth,
  positionMarketValueKRW
} from "../calculations";
import { useFxRateValue } from "../context/FxRateContext";
import { useAppStore } from "../store/appStore";
import {
  getThisMonthKST,
  getTodayKST,
  formatIsoLocal,
  addDaysToIso,
  shiftMonth,
  getMonthEndDate,
  buildMonthRange,
} from "../utils/date";
import { getCategoryType, isSavingsExpenseEntry, isCreditPayment } from "../utils/category";
import { isUSDStock } from "../utils/finance";
const LazyPortfolioDashboardCharts = lazy(() =>
  import("../features/stocks/PortfolioDashboardCharts").then((m) => ({ default: m.PortfolioDashboardCharts }))
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
  subCategory?: string;
  description?: string;
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

function isDividendIncome(entry: LedgerEntry): boolean {
  if (entry.kind !== "income") return false;
  return (
    (entry.category ?? "").includes("배당") ||
    (entry.subCategory ?? "").includes("배당") ||
    (entry.description ?? "").includes("배당")
  );
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
  const categoryPresets = storeData.categoryPresets;

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
          // 신용결제는 카드 사용 시점에 이미 expense로 잡힘 — 이중계상 방지
          if (isCreditPayment(entry)) continue;
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
    [ledger, fxRate]
  );

  /** 전체 기간 합계: 수입, 일반 지출, 재테크 지출 */
  const allTimeSummary = useMemo(() => computeSummary(null), [computeSummary]);

  const monthlySummary = useMemo(() => ({
    month: currentMonth,
    ...computeSummary(currentMonth),
  }), [computeSummary, currentMonth]);

  /** 재테크 세부(저축/투자/투자수익/투자손실)를 각 항목의 정식 소스에서 집계.
   * 저축=transfer 저축이체, 투자=transfer 투자이체, 투자수익=income 투자수익, 투자손실=expense 재테크 투자손실. */
  const computeRecheckBreakdown = useCallback(
    (monthPrefix: string) => {
      const toKrw = (entry: LedgerEntry) =>
        entry.currency === "USD" && fxRate ? entry.amount * fxRate : entry.amount;
      const sub = { 저축: 0, 투자: 0, 투자수익: 0, 투자손실: 0 };
      for (const entry of ledger) {
        if (!entry.date?.startsWith(monthPrefix)) continue;
        const amt = toKrw(entry);
        if (entry.kind === "transfer") {
          if (entry.subCategory === "저축이체") sub.저축 += amt;
          else if (entry.subCategory === "투자이체") sub.투자 += amt;
        } else if (entry.kind === "income" && entry.subCategory === "투자수익") {
          sub.투자수익 += amt;
        } else if (entry.kind === "expense" && entry.category === "재테크" && entry.subCategory === "투자손실") {
          sub.투자손실 += amt;
        }
      }
      return sub;
    },
    [ledger, fxRate]
  );

  const monthlyRecheckBreakdown = useMemo(
    () => computeRecheckBreakdown(currentMonth),
    [computeRecheckBreakdown, currentMonth]
  );

  const lastMonth = useMemo(() => shiftMonth(currentMonth, -1), [currentMonth]);

  /** 저번달 요약 (저축 대비 비교 위젯용) */
  const lastMonthSummary = useMemo(() => ({
    month: lastMonth,
    ...computeSummary(lastMonth),
  }), [computeSummary, lastMonth]);

  /** 저번달 재테크 세부 (저축 대비 비교 위젯용) */
  const lastMonthRecheckBreakdown = useMemo(
    () => computeRecheckBreakdown(lastMonth),
    [computeRecheckBreakdown, lastMonth]
  );

  const lastMonthSavingsRate = useMemo(() => {
    const { income, investing } = lastMonthSummary;
    if (income <= 0) return null;
    // 저축률 = (transfer 저축이체+투자이체) / 수입. 투자손실(실소비)은 제외.
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
    type PositionRow = (typeof positionsWithPrice)[number];
    const map = new Map<string, { accountId: string; accountName: string; rows: PositionRow[] }>();
    for (const p of positionsWithPrice) {
      const prev = map.get(p.accountId);
      if (prev) prev.rows.push(p);
      else map.set(p.accountId, { accountId: p.accountId, accountName: p.accountName, rows: [p] });
    }
    return Array.from(map.values()).sort((a, b) => a.accountName.localeCompare(b.accountName));
  }, [positionsWithPrice]);

  const loans = storeData.loans ?? [];
  const totalDebt = useMemo(() => computeTotalDebt(accounts, loans, ledger), [accounts, loans, ledger]);
  const totalNetWorth = useMemo(
    () => computeTotalNetWorth(balances, positions, fxRate, loans, ledger),
    [balances, positions, fxRate, loans, ledger]
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

      // 월말 시점 대출 잔금 차감 (원금 상환은 차감, 이자 상환은 잔금 불변)
      const monthLoanBalance = computeLoanBalanceAt(loans, ledger, monthEndDate);
      totalValue -= monthLoanBalance;

      row.stock = totalStockValue;
      row.savings = totalSavingsValue;
      row.total = totalValue;
      rows.push(row);
    });

    return rows;
  }, [monthRange, ledger, trades, adjustedPrices, accounts, fxRate, currentMonth, loans]);

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
      // 신용결제(카드 청구액 결제 이체)는 실제 지출의 중복 — 고정비 집계에서 제외
      if (entry.category === "신용결제") continue;
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


  const accountNameById = useMemo(() => {
    return new Map(accounts.map((account) => [account.id, account.name || account.id]));
  }, [accounts]);
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
      const subCategory = entry.subCategory || undefined;
      const description = entry.description || undefined;

      if (entry.kind === "income") {
        rows.push({
          id: entry.id,
          date: entry.date,
          title,
          category,
          subCategory,
          description,
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
          subCategory,
          description,
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
  }, [ledger, calendarWindowStart, calendarWindowEnd, fxRate, accountNameById, accounts, categoryPresets]);

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

  // ── Widget 5: 이번 달 페이스 예측 ────────────────────────────────────────────
  // 페이스 = 현재까지 지출 추세로 월말 예상 지출 / 과거 3개월 평균 지출 × 100
  // 중요: 과거 3개월과 현재월은 같은 필터 정책을 써야 비교 의미가 있음
  //   → 저축성지출(재테크/저축 등)·신용결제(카드대금은 실제 지출의 이체) 제외
  const monthPaceData = useMemo(() => {
    const [year, monthNum] = currentMonth.split("-").map(Number);
    const totalDays = new Date(year, monthNum, 0).getDate();
    const todayDay = parseInt(today.slice(8, 10), 10);
    const elapsed = Math.min(Math.max(todayDay, 1), totalDays);
    const toKrw = (entry: LedgerEntry) =>
      entry.currency === "USD" && fxRate ? entry.amount * fxRate : entry.amount;
    const sumMonth = (m: string) => {
      let total = 0;
      ledger.forEach((entry) => {
        if (!entry.date?.startsWith(m)) return;
        if (entry.kind !== "expense") return;
        if (entry.category === "신용결제") return;
        if (isSavingsExpenseEntry(entry, accounts, categoryPresets)) return;
        total += toKrw(entry);
      });
      return total;
    };
    const currentExpense = sumMonth(currentMonth);
    const projectedExpense = (currentExpense / elapsed) * totalDays;
    const prevTotals = [-1, -2, -3].map((offset) => sumMonth(shiftMonth(currentMonth, offset)));
    const avgPrev3 = prevTotals.reduce((s, v) => s + v, 0) / 3;
    return {
      currentExpense,
      projectedExpense,
      avgPrev3,
      elapsed,
      totalDays,
      pace: avgPrev3 > 0 ? (projectedExpense / avgPrev3) * 100 : null,
    };
  }, [currentMonth, today, ledger, fxRate, accounts, categoryPresets]);

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
        // 신용결제는 카드 결제 이체로 실제 지출의 중복 — expense 집계에서 제외 (topCategoriesThisMonth와 일관)
        if (entry.category === "신용결제") return;
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
        <MonthlySummaryCards monthlySummary={monthlySummary} allTimeSummary={allTimeSummary} />

        <SalaryTimerCard ledger={ledger} />

        <ExpenseIncomeCompareCard ledger={ledger} month={currentMonth} />

        <InvestmentSummaryCard
          accounts={accounts}
          ledger={ledger}
          trades={trades}
          prices={adjustedPrices}
          fxRate={fxRate ?? null}
        />

        <InvestmentRecordCard trades={trades} accounts={accounts} ledger={ledger} fxRate={fxRate ?? null} />

        <NetWorthTrendChart data={netWorthTrendData} />

        <div className="dashboard-two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <TopExpensesCard currentMonth={currentMonth} topCategoriesThisMonth={topCategoriesThisMonth} />
          <MonthlyTrendCard monthlyTrendData={monthlyTrendData} />
        </div>

        <InvestmentBreakdownCard
          month={monthlySummary.month}
          monthlyRecheckBreakdown={monthlyRecheckBreakdown}
          totalRealizedPnl={totalRealizedPnl}
        />

        <MonthPaceCard currentMonth={currentMonth} data={monthPaceData} />

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
          <SavingsRatioCard
            lastMonthLabel={lastMonthSummary.month}
            lastMonthSavingsRate={lastMonthSavingsRate}
            lastMonthInvestingRatio={lastMonthInvestingRatio}
            lastMonthRecheckBreakdown={lastMonthRecheckBreakdown}
          />

          <DividendCoverageCard dividendCoverage={dividendCoverage} />
        </div>

        <AssetCompositionCard
          portfolioTreemapData={portfolioTreemapData}
          portfolioByType={portfolioByType}
          totalNetWorth={totalNetWorth}
          totalDebt={totalDebt}
        />

        <AccountBalanceTrendCard
          accountBalanceSnapshots={accountBalanceSnapshots}
          accountBalanceChartView={accountBalanceChartView}
          setAccountBalanceChartView={setAccountBalanceChartView}
          accounts={accounts}
        />

        <StockCostVsMarketCard
          today={today}
          accounts={accounts}
          trades={trades}
          prices={prices}
          fxRate={fxRate}
        />

        <TotalAssetTrendCard
          today={today}
          accounts={accounts}
          ledger={ledger}
          trades={trades}
          prices={prices}
          fxRate={fxRate}
          marketEnvSnapshots={storeData.marketEnvSnapshots}
        />

        {(() => {
          const cmaAccount = accounts.find((a) => a.id === "CMA");
          if (!cmaAccount) return null;
          return (
            <div style={{ marginTop: 16 }}>
              <CmaBalanceTrendCard
                accountBalanceSnapshots={accountBalanceSnapshots}
                accountId={cmaAccount.id}
                accountName={cmaAccount.name || cmaAccount.id}
              />
            </div>
          );
        })()}

        <SpendingCalendarCard
          cashflowMonth={cashflowMonth}
          setCashflowMonth={setCashflowMonth}
          spendingFilterType={spendingFilterType}
          setSpendingFilterType={setSpendingFilterType}
          calendarCells={calendarCells}
          selectedMonthTotals={selectedMonthTotals}
          selectedMonthSpendingRows={selectedMonthSpendingRows}
          selectedCalendarDate={selectedCalendarDate}
          setSelectedCalendarDate={setSelectedCalendarDate}
          today={today}
        />


        {/* 예산 초과 알림 */}
        <BudgetAlertWidget
          ledger={ledger}
          budgetGoals={storeData.budgetGoals}
          accounts={accounts}
        />
      </div>
    </div>
  );
};
