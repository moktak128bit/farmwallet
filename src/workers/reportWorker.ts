/// <reference lib="webworker" />

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
import type { Account, LedgerEntry, StockPrice, StockTrade } from "../types";

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

interface ReportWorkerPayload {
  accounts: Account[];
  ledger: LedgerEntry[];
  trades: StockTrade[];
  prices: StockPrice[];
  startDate: string;
  endDate: string;
  fxRate: number | null;
}

interface ReportWorkerRequest {
  requestId: number;
  payload: ReportWorkerPayload;
}

interface ReportWorkerResponse {
  requestId: number;
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
  error?: string;
}

const INVESTING_ACCOUNT_TYPES = new Set<Account["type"]>(["savings", "securities", "crypto"]);

function isInvestingAccount(account: Account | undefined): boolean {
  return !!account && INVESTING_ACCOUNT_TYPES.has(account.type);
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

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<ReportWorkerRequest>) => {
  const { requestId, payload } = event.data;
  try {
    const response: ReportWorkerResponse = {
      requestId,
      monthlyReport: generateMonthlyReport(payload.ledger, payload.startDate.slice(0, 7), payload.endDate.slice(0, 7)),
      monthlyIncomeDetail: generateMonthlyIncomeDetail(
        payload.ledger,
        payload.accounts,
        payload.startDate.slice(0, 7),
        payload.endDate.slice(0, 7)
      ),
      yearlyReport: generateYearlyReport(payload.ledger),
      categoryReport: generateCategoryReport(payload.ledger, payload.startDate, payload.endDate),
      stockReport: generateStockPerformanceReport(payload.trades, payload.prices, payload.accounts),
      accountReport: generateAccountReport(payload.accounts, payload.ledger, payload.trades),
      dailyReport: generateDailyReport(
        payload.accounts,
        payload.ledger,
        payload.trades,
        payload.prices,
        payload.startDate,
        payload.endDate,
        payload.fxRate ?? undefined
      ),
      closingReport: generateClosingReportData(
        payload.accounts,
        payload.ledger,
        payload.trades,
        payload.prices,
        payload.fxRate ?? undefined
      ),
      accountPerformance: generateAccountPerformanceBreakdown(
        payload.accounts,
        payload.ledger,
        payload.trades,
        payload.prices,
        payload.fxRate ?? undefined
      ),
      consumptionImpact: generateConsumptionImpactMonthlyReport(
        payload.ledger,
        payload.accounts,
        payload.startDate.slice(0, 7),
        payload.endDate.slice(0, 7),
        payload.fxRate ?? undefined
      ),
      comprehensiveMonthly: generateComprehensiveMonthlyReport(
        payload.ledger,
        payload.trades,
        payload.accounts,
        payload.startDate.slice(0, 7),
        payload.endDate.slice(0, 7),
        payload.fxRate ?? undefined
      ),
      periodCompare: buildPeriodCompare(payload.accounts, payload.ledger, payload.fxRate)
    };

    workerScope.postMessage(response);
  } catch (error) {
    const response: ReportWorkerResponse = {
      requestId,
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
        thisMonth: { income: 0, expense: 0, savings: 0, investingIn: 0, investingOut: 0, investingNet: 0, net: 0 },
        lastMonth: { income: 0, expense: 0, savings: 0, investingIn: 0, investingOut: 0, investingNet: 0, net: 0 },
        lastYearSameMonth: { income: 0, expense: 0, savings: 0, investingIn: 0, investingOut: 0, investingNet: 0, net: 0 }
      },
      error: error instanceof Error ? error.message : String(error)
    };
    workerScope.postMessage(response);
  }
};

export {};
