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
import type { Account, LedgerEntry, StockPrice, StockTrade } from "../types";

interface ReportWorkerPayload {
  accounts: Account[];
  ledger: LedgerEntry[];
  trades: StockTrade[];
  prices: StockPrice[];
  startDate: string;
  endDate: string;
  fxRate: number | null;
  /** 데이트 계좌 id (localStorage 값) — 종합 월간 실질지출의 데이트 50% 차감용. structured-clone 가능 */
  dateAccountId: string | null;
  /** 설정에서 "비실질"로 지정한 수입 카테고리 — 실질수입 제외 (인사이트와 동일 기준) */
  nonRealIncomeOverride?: string[];
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
  error?: string;
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
        payload.fxRate ?? undefined,
        payload.dateAccountId,
        payload.nonRealIncomeOverride
      )
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
      error: error instanceof Error ? error.message : String(error)
    };
    workerScope.postMessage(response);
  }
};

export {};
