import { useEffect, useMemo, useRef, useState } from "react";
import type { Account, LedgerEntry, Loan, StockPrice, StockTrade } from "../types";
import type { FxPoint } from "../utils/portfolioHistory";
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
  /** 대출 — 리포트 순자산에서 잔금 차감 */
  loans?: Loan[];
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
  /** 일별 환율 이력 — fxRateAtTrade 없는 달러 매도의 실현손익을 거래일 환율로 (대시보드와 같은 입력) */
  fxHistory?: FxPoint[];
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
      params.endDate.slice(0, 7),
      params.fxRate ?? undefined
    ),
    yearlyReport: generateYearlyReport(params.ledger, params.fxRate ?? undefined),
    categoryReport: generateCategoryReport(params.ledger, params.startDate, params.endDate, params.fxRate ?? undefined),
    stockReport: generateStockPerformanceReport(params.trades, params.prices, params.accounts, params.fxRate ?? undefined),
    accountReport: generateAccountReport(params.accounts, params.ledger, params.trades),
    dailyReport: generateDailyReport(
      params.accounts,
      params.ledger,
      params.trades,
      params.prices,
      params.startDate,
      params.endDate,
      params.fxRate ?? undefined,
      params.loans
    ),
    closingReport: generateClosingReportData(
      params.accounts,
      params.ledger,
      params.trades,
      params.prices,
      params.fxRate ?? undefined,
      params.loans
    ),
    accountPerformance: generateAccountPerformanceBreakdown(
      params.accounts,
      params.ledger,
      params.trades,
      params.prices,
      params.fxRate ?? undefined,
      params.fxHistory
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
      params.nonRealIncomeOverride,
      params.fxHistory
    )
  };
}

export function useReportWorker(params: UseReportWorkerParams): UseReportWorkerResult {
  // GAS 빌드(단일 HTML)는 워커 파일을 따로 서빙할 수 없어 메인 스레드 계산으로 — scripts/build-gas.mjs
  const supportsWorker = typeof Worker !== "undefined" && import.meta.env.VITE_GAS_BUILD !== "1";
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const latestHandledRequestRef = useRef(0);
  // GAS(워커 없음): 입력이 실제로 바뀔 때만 다시 계산하고 결과를 그대로 돌려준다.
  // ⚠ 예전엔 deps가 [params](호출부가 매 렌더 새로 만드는 객체)라 매 렌더 재계산 → effect의 setState →
  // 다시 렌더… 무한 루프였다(대시보드 10초에 2만 회 커밋, 가계부 useDeferredValue가 영영 못 따라와 편집이 화면에 안 보임).
  const {
    accounts, loans, ledger, trades, prices, startDate, endDate, fxRate, dateAccountId, nonRealIncomeOverride, fxHistory,
  } = params;
  const fallback = useMemo((): UseReportWorkerResult | null => {
    if (supportsWorker) return null;
    return {
      ...computeSynchronously({
        accounts, loans, ledger, trades, prices, startDate, endDate, fxRate, dateAccountId, nonRealIncomeOverride, fxHistory,
      }),
      isComputing: false,
    };
  }, [supportsWorker, accounts, loans, ledger, trades, prices, startDate, endDate, fxRate, dateAccountId, nonRealIncomeOverride, fxHistory]);

  const [state, setState] = useState<UseReportWorkerResult>(() => ({ ...createEmptyData(), isComputing: false }));

  useEffect(() => {
    if (!supportsWorker) return;

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
  }, [supportsWorker]);

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
        loans: params.loans,
        ledger: params.ledger,
        trades: params.trades,
        prices: params.prices,
        startDate: params.startDate,
        endDate: params.endDate,
        fxRate: params.fxRate,
        dateAccountId: params.dateAccountId,
        nonRealIncomeOverride: params.nonRealIncomeOverride,
        fxHistory: params.fxHistory
      }
    });
  }, [
    supportsWorker,
    params.accounts,
    params.loans,
    params.ledger,
    params.trades,
    params.prices,
    params.startDate,
    params.endDate,
    params.fxRate,
    params.dateAccountId,
    params.nonRealIncomeOverride,
    params.fxHistory
  ]);

  return fallback ?? state;
}
