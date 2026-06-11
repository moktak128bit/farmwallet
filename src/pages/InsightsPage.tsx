/**
 * 인사이트 (InsightsPage) — 조립자(orchestrator).
 * 기간 필터 상태(selMonth/periodMonths)와 파생 데이터셋(D) 조립만 담당하고,
 * 영역별 UI·로직은 features/insights/ 모듈이 소유한다:
 *   - useInsightsData: 탭들이 공유하는 대형 memo 데이터셋(D) 계산.
 *   - InsightsHeader / InsightsTabNav: 상단 헤더·탭 네비게이션 — React.memo.
 *   - tabs/*: 탭별 화면 — React.lazy로 분할 로드해 처음 방문하는 탭의 청크만
 *     내려받는다 (로딩 중에는 ChartSkeleton 표시). ForecastView·SettlementView도
 *     해당 탭에서만 쓰이므로 함께 lazy 분할.
 */
import React, { lazy, Suspense, useCallback, useMemo, useState } from "react";
import type { Account, LedgerEntry, Loan, StockTrade, StockPrice, CategoryPresets, BudgetGoal, RecurringExpense } from "../types";
import { W, type D } from "../features/insights/insightsShared";
import { useAppStore } from "../store/appStore";
import { useDateAccountId } from "../hooks/useDateAccountSettings";
import { useAccountTimelineRows } from "../hooks/useAccountTimelineRows";
import { buildAdjustedPrices, buildTimelineMonthRange } from "../utils/accountTimeline";
import { getThisMonthKST } from "../utils/date";
import { useInsightsData } from "../features/insights/useInsightsData";
import { InsightsHeader } from "../features/insights/InsightsHeader";
import { InsightsTabNav, type TabId } from "../features/insights/InsightsTabNav";
import { ChartSkeleton } from "../components/charts/ChartSkeleton";

const OverviewTab = lazy(() => import("../features/insights/tabs/OverviewTab").then((m) => ({ default: m.OverviewTab })));
const ExpenseTab = lazy(() => import("../features/insights/tabs/ExpenseTab").then((m) => ({ default: m.ExpenseTab })));
const IncomeTab = lazy(() => import("../features/insights/tabs/IncomeTab").then((m) => ({ default: m.IncomeTab })));
const AssetTab = lazy(() => import("../features/insights/tabs/AssetTab").then((m) => ({ default: m.AssetTab })));
const InvestTab = lazy(() => import("../features/insights/tabs/InvestTab").then((m) => ({ default: m.InvestTab })));
const DateTab = lazy(() => import("../features/insights/tabs/DateTab").then((m) => ({ default: m.DateTab })));
const PatternTab = lazy(() => import("../features/insights/tabs/PatternTab").then((m) => ({ default: m.PatternTab })));
const ForecastView = lazy(() => import("../features/insights/ForecastView").then((m) => ({ default: m.ForecastView })));
const SettlementView = lazy(() => import("../features/dating/SettlementView").then((m) => ({ default: m.SettlementView })));

const TabMap: Record<TabId, React.LazyExoticComponent<React.ComponentType<{ d: D }>>> = {
  overview: OverviewTab, expense: ExpenseTab, income: IncomeTab, asset: AssetTab, invest: InvestTab, date: DateTab, pattern: PatternTab,
};

/** loans 미보유(undefined) 시 폴백 — 모듈 상수로 참조 고정 (memo 계약) */
const EMPTY_LOANS: Loan[] = [];

interface Props {
  accounts: Account[];
  ledger: LedgerEntry[];
  trades?: StockTrade[];
  prices?: StockPrice[];
  categoryPresets: CategoryPresets;
  budgetGoals?: BudgetGoal[];
  recurringExpenses?: RecurringExpense[];
  fxRate?: number | null;
  onAddLedger?: (entry: LedgerEntry) => void;
}

export const InsightsView: React.FC<Props> = ({ accounts, ledger, trades = [], prices = [], categoryPresets, budgetGoals, recurringExpenses = [], fxRate = null, onAddLedger }) => {
  const [tab, setTab] = useState<TabId>("overview");
  const [selMonth, setSelMonth] = useState<string | null>(null);
  const [periodMonths, setPeriodMonths] = useState<number | null>(null); // null = 전체
  const { filteredLedger, filteredTrades } = useMemo(() => {
    if (periodMonths == null) return { filteredLedger: ledger, filteredTrades: trades };
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - periodMonths);
    const cutoffIso = cutoff.toISOString().slice(0, 10);
    return {
      filteredLedger: ledger.filter((l) => (l.date ?? "") >= cutoffIso),
      filteredTrades: trades.filter((t) => (t.date ?? "") >= cutoffIso),
    };
  }, [ledger, trades, periodMonths]);
  // 데이트 계좌 ID — Settings에서 설정하는 값. localStorage 변경은 storage 이벤트로 반영.
  const dateAccountId = useDateAccountId();

  // 순자산 타임라인 — 대시보드와 동일 계산(시세·환율·대출 반영). 누적 정확성을 위해
  // 기간 필터 전의 전체 ledger/trades를 사용한다.
  const loans = useAppStore((s) => s.data.loans) ?? EMPTY_LOANS;
  const currentMonth = useMemo(() => getThisMonthKST(), []);
  const adjustedPrices = useMemo(() => buildAdjustedPrices(prices, fxRate), [prices, fxRate]);
  const timelineMonthRange = useMemo(() => buildTimelineMonthRange(ledger, trades, currentMonth), [ledger, trades, currentMonth]);
  const timelineRows = useAccountTimelineRows({
    accounts,
    ledger,
    trades,
    adjustedPrices,
    fxRate,
    currentMonth,
    monthRange: timelineMonthRange,
    loans,
  });

  const d = useInsightsData(filteredLedger, filteredTrades, trades, accounts, prices, selMonth, categoryPresets, budgetGoals, dateAccountId, fxRate, timelineRows, ledger);

  const handleSelectPeriod = useCallback((v: number | null) => { setPeriodMonths(v); setSelMonth(null); }, []);
  const handleSelectMonth = useCallback((v: string | null) => {
    setSelMonth(v);
    if (v) setPeriodMonths(null); // 특정 월 선택 시 period 리셋 (충돌 제거)
  }, []);
  const handleSettle = useCallback((entry: LedgerEntry) => onAddLedger?.(entry), [onAddLedger]);

  const dateRange = d.months.length > 0 ? `${d.months[0].replace("-", ".")} ~ ${d.months[d.months.length - 1].replace("-", ".")}` : "";
  const ActiveTab = TabMap[tab];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, fontFamily: "'Pretendard Variable', 'Pretendard', -apple-system, sans-serif" }}>
      {/* Header */}
      <InsightsHeader
        dateRange={dateRange}
        txCount={d.txCount}
        months={d.months}
        ml={d.ml}
        selMonth={selMonth}
        periodMonths={periodMonths}
        onSelectPeriod={handleSelectPeriod}
        onSelectMonth={handleSelectMonth}
      />

      {/* Tabs */}
      <InsightsTabNav tab={tab} onSelectTab={setTab} selMonthLabel={selMonth ? d.ml[selMonth] : null} />

      {/* Content — 탭 청크 lazy 로드 (첫 방문 시에만 스켈레톤) */}
      <div style={{ padding: "20px 24px", maxWidth: 1200, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        <Suspense fallback={<ChartSkeleton height={300} />}>
          <ActiveTab d={d} />
          {tab === "overview" && (
            <ForecastView ledger={ledger} recurring={recurringExpenses} formatNumber={W} />
          )}
          {tab === "date" && (
            <SettlementView
              data={{ accounts, ledger, trades, prices: [], categoryPresets, recurringExpenses, budgetGoals: budgetGoals ?? [], customSymbols: [] }}
              onSettle={handleSettle}
              formatNumber={W}
            />
          )}
        </Suspense>
      </div>
    </div>
  );
};
