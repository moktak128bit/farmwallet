import { useEffect, useMemo, useRef, useState } from "react";
import type { Account, LedgerEntry, StockPrice, StockTrade } from "../types";
import {
  generateAccountPerformanceBreakdown,
  generateAccountReport,
  generateCategoryReport,
  generateClosingReportData,
  generateComprehensiveMonthlyReport,
  generateConsumptionImpactMonthlyReport,
  generateDailyReport,
  generateMonthlyIncomeDetail,
  generateMonthlyReport,
  generateStockPerformanceReport,
  generateYearlyReport
} from "../utils/reportGenerator";
import { isSavingsExpenseEntry } from "../utils/category";

interface PeriodSummary {
  income: number;
  expense: number;
  savings: number;
  investingIn: number;
  investingOut: number;
  investingNet: number;
  net: number;
}

interface PeriodCompareResult {
  thisMonthKey: string;
  lastMonthKey: string;
  lastYearSameMonthKey: string;
  thisMonth: PeriodSummary;
  lastMonth: PeriodSummary;
  lastYearSameMonth: PeriodSummary;
}

interface UseReportWorkerParams {
  accounts: Account[];
  ledger: LedgerEntry[];
  trades: StockTrade[];
  prices: StockPrice[];
  startDate: string;
  endDate: string;
  fxRate: number | null;
}

interface ReportWorkerData {
  monthlyReport: ReturnType<typeof generateMonthlyReport>;
  monthlyIncomeDetail: ReturnType<typeof generateMonthlyIncomeDetail>;
  yearlyReport: ReturnType<typeof generateYearlyReport>;
  categoryReport: ReturnType<typeof generateCategoryReport>;
  stockReport: ReturnType<typeof generateStockPerformanceReport>;
  accountReport: ReturnType<typeof generateAccountReport>;
  dailyReport: ReturnType<typeof generateDailyReport>;
  closingReport: ReturnType<typeof generateClosingReportData>;
  accountPerformance: ReturnType<typeof generateAccountPerformanceBreakdown>;
  consumptionImpact: ReturnType<typeof generateConsumptionImpactMonthlyReport>;
  comprehensiveMonthly: ReturnType<typeof generateComprehensiveMonthlyReport>;
  periodCompare: PeriodCompareResult;
}

interface UseReportWorkerResult extends ReportWorkerData {
  isComputing: boolean;
}

const INVESTING_ACCOUNT_TYPES = new Set<Account["type"]>(["savings", "securities", "crypto"]);

function isInvestingAccount(account: Account | undefined): boolean {
  return !!account && INVESTING_ACCOUNT_TYPES.has(account.type);
}

function createEmptyPeriodSummary(): PeriodSummary {
  return {
    income: 0,
    expense: 0,
    savings: 0,
    investingIn: 0,
    investingOut: 0,
    investingNet: 0,
    net: 0
  };
}

function createEmptyData(): ReportWorkerData {
  return {
    monthlyReport: [],
    monthlyIncomeDetail: [],
    yearlyReport: [],
    categoryReport: [],
    stockReport: [],
    accountReport: [],
    dailyReport: [],
    closingReport: {
      monthlySnapshots: [],
      weeklySnapshots: [],
      latestComment: undefined,
      monthlyStatus: {
        month: "",
        completionRate: 0,
        coveredDays: 0,
        elapsedDays: 0,
        coveredUntil: undefined,
        expectedClosings: 0,
        completedClosings: 0,
        weeklyExpected: 0,
        weeklyCompleted: 0,
        monthlyExpected: 0,
        monthlyCompleted: 0
      }
    },
    accountPerformance: [],
    consumptionImpact: [],
    comprehensiveMonthly: [],
    periodCompare: {
      thisMonthKey: "",
      lastMonthKey: "",
      lastYearSameMonthKey: "",
      thisMonth: createEmptyPeriodSummary(),
      lastMonth: createEmptyPeriodSummary(),
      lastYearSameMonth: createEmptyPeriodSummary()
    }
  };
}

function buildPeriodCompare(
  accounts: Account[],
  ledger: LedgerEntry[],
  fxRate: number | null
): PeriodCompareResult {
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const toKrw = (entry: LedgerEntry) =>
    entry.currency === "USD" && fxRate ? entry.amount * fxRate : entry.amount;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const thisMonthKey = `${year}-${String(month).padStart(2, "0")}`;
  const lastMonthKey =
    month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
  const lastYearSameMonthKey = `${year - 1}-${String(month).padStart(2, "0")}`;

  const summarize = (entries: LedgerEntry[]): PeriodSummary => {
    let income = 0;
    let expense = 0;
    let savings = 0;
    let investingIn = 0;
    let investingOut = 0;
    for (const entry of entries) {
      const amount = toKrw(entry);
      if (entry.kind === "income") {
        income += amount;
        continue;
      }
      if (entry.kind === "expense") {
        if (isSavingsExpenseEntry(entry, accounts)) {
          savings += amount;
          investingIn += amount;
        } else {
          expense += amount;
        }
        continue;
      }
      if (entry.kind === "transfer") {
        const fromAccount = entry.fromAccountId ? accountById.get(entry.fromAccountId) : undefined;
        const toAccount = entry.toAccountId ? accountById.get(entry.toAccountId) : undefined;
        const fromInvesting = isInvestingAccount(fromAccount);
        const toInvesting = isInvestingAccount(toAccount);
        if (!fromInvesting && toInvesting) investingIn += amount;
        if (fromInvesting && !toInvesting) investingOut += amount;
      }
    }
    return {
      income,
      expense,
      savings,
      investingIn,
      investingOut,
      investingNet: investingIn - investingOut,
      net: income - expense - savings
    };
  };

  const thisMonth = summarize(ledger.filter((entry) => entry.date.startsWith(thisMonthKey)));
  const lastMonth = summarize(ledger.filter((entry) => entry.date.startsWith(lastMonthKey)));
  const lastYearSameMonth = summarize(ledger.filter((entry) => entry.date.startsWith(lastYearSameMonthKey)));

  return { thisMonthKey, lastMonthKey, lastYearSameMonthKey, thisMonth, lastMonth, lastYearSameMonth };
}

function computeSynchronously(params: UseReportWorkerParams): ReportWorkerData {
  return {
    monthlyReport: generateMonthlyReport(
      params.ledger,
      params.startDate.slice(0, 7),
      params.endDate.slice(0, 7)
    ),
    monthlyIncomeDetail: generateMonthlyIncomeDetail(
      params.ledger,
      params.accounts,
      params.startDate.slice(0, 7),
      params.endDate.slice(0, 7)
    ),
    yearlyReport: generateYearlyReport(params.ledger),
    categoryReport: generateCategoryReport(params.ledger, params.startDate, params.endDate),
    stockReport: generateStockPerformanceReport(params.trades, params.prices, params.accounts),
    accountReport: generateAccountReport(params.accounts, params.ledger, params.trades),
    dailyReport: generateDailyReport(
      params.accounts,
      params.ledger,
      params.trades,
      params.prices,
      params.startDate,
      params.endDate,
      params.fxRate ?? undefined
    ),
    closingReport: generateClosingReportData(
      params.accounts,
      params.ledger,
      params.trades,
      params.prices,
      params.fxRate ?? undefined
    ),
    accountPerformance: generateAccountPerformanceBreakdown(
      params.accounts,
      params.ledger,
      params.trades,
      params.prices,
      params.fxRate ?? undefined
    ),
    consumptionImpact: generateConsumptionImpactMonthlyReport(
      params.ledger,
      params.accounts,
      params.startDate.slice(0, 7),
      params.endDate.slice(0, 7),
      params.fxRate ?? undefined
    ),
    comprehensiveMonthly: generateComprehensiveMonthlyReport(
      params.ledger,
      params.trades,
      params.accounts,
      params.startDate.slice(0, 7),
      params.endDate.slice(0, 7),
      params.fxRate ?? undefined
    ),
    periodCompare: buildPeriodCompare(params.accounts, params.ledger, params.fxRate)
  };
}

export function useReportWorker(params: UseReportWorkerParams): UseReportWorkerResult {
  const supportsWorker = typeof Worker !== "undefined";
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const latestHandledRequestRef = useRef(0);
  const fallback = useMemo(() => {
    if (supportsWorker) return null;
    return computeSynchronously(params);
  }, [
    supportsWorker,
    params.accounts,
    params.ledger,
    params.trades,
    params.prices,
    params.startDate,
    params.endDate,
    params.fxRate
  ]);

  const [state, setState] = useState<UseReportWorkerResult>(() => ({
    ...(fallback ?? createEmptyData()),
    isComputing: false
  }));

  useEffect(() => {
    if (!supportsWorker) {
      if (!fallback) return;
      setState({ ...fallback, isComputing: false });
      return;
    }

    const worker = new Worker(new URL("../workers/reportWorker.ts", import.meta.url), {
      type: "module"
    });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<ReportWorkerData & { requestId: number; error?: string }>) => {
      const { requestId, error, ...data } = event.data;
      if (requestId < latestHandledRequestRef.current) return;
      latestHandledRequestRef.current = requestId;

      if (error) {
        console.warn("[useReportWorker] worker failed, keeping previous value", error);
        setState((prev) => ({ ...prev, isComputing: false }));
        return;
      }

      setState({
        ...(data as ReportWorkerData),
        isComputing: false
      });
    };

    worker.onerror = (event) => {
      console.warn("[useReportWorker] worker error", event.message);
      setState((prev) => ({ ...prev, isComputing: false }));
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [supportsWorker, fallback]);

  useEffect(() => {
    if (!supportsWorker) return;
    const worker = workerRef.current;
    if (!worker) return;

    const requestId = ++requestIdRef.current;
    setState((prev) => ({ ...prev, isComputing: true }));

    worker.postMessage({
      requestId,
      payload: {
        accounts: params.accounts,
        ledger: params.ledger,
        trades: params.trades,
        prices: params.prices,
        startDate: params.startDate,
        endDate: params.endDate,
        fxRate: params.fxRate
      }
    });
  }, [
    supportsWorker,
    params.accounts,
    params.ledger,
    params.trades,
    params.prices,
    params.startDate,
    params.endDate,
    params.fxRate
  ]);

  return state;
}
