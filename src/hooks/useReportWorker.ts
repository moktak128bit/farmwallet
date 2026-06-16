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

interface UseReportWorkerParams {
  accounts: Account[];
  ledger: LedgerEntry[];
  trades: StockTrade[];
  prices: StockPrice[];
  startDate: string;
  endDate: string;
  fxRate: number | null;
  /** 데이트 계좌 id — localStorage 값이라 워커에 명시 전달 (종합 월간 실질지출용) */
  dateAccountId: string | null;
  /** 설정에서 "비실질"로 지정한 수입 카테고리 — 실질수입에서 제외 (인사이트와 동일 기준) */
  nonRealIncomeOverride?: string[];
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
}

interface UseReportWorkerResult extends ReportWorkerData {
  isComputing: boolean;
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
    comprehensiveMonthly: []
  };
}

function computeSynchronously(params: UseReportWorkerParams): ReportWorkerData {
  return {
    monthlyReport: generateMonthlyReport(
      params.ledger,
      params.startDate.slice(0, 7),
      params.endDate.slice(0, 7),
      params.fxRate ?? undefined
    ),
    monthlyIncomeDetail: generateMonthlyIncomeDetail(
      params.ledger,
      params.accounts,
      params.startDate.slice(0, 7),
      params.endDate.slice(0, 7)
    ),
    yearlyReport: generateYearlyReport(params.ledger, params.fxRate ?? undefined),
    categoryReport: generateCategoryReport(params.ledger, params.startDate, params.endDate),
    stockReport: generateStockPerformanceReport(params.trades, params.prices, params.accounts, params.fxRate ?? undefined),
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
      params.fxRate ?? undefined,
      params.dateAccountId,
      params.nonRealIncomeOverride
    )
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
  }, [supportsWorker, params]);

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
        fxRate: params.fxRate,
        dateAccountId: params.dateAccountId,
        nonRealIncomeOverride: params.nonRealIncomeOverride
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
    params.fxRate,
    params.dateAccountId,
    params.nonRealIncomeOverride
  ]);

  return state;
}
