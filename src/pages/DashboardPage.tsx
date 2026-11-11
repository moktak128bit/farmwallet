/**
 * 대시보드 (DashboardPage) — 오케스트레이터
 * ───────────────────────────────────────────────────────
 * 여러 위젯이 공유하는 무거운 파생값(adjustedPrices/balances/positions/
 * accountBalanceSnapshots/accountTimelineRows 등)은 여기서 useMemo·훅으로 1회 계산해
 * 위젯(features/dashboard/*)에 props로 내려준다. 자식은 재계산하지 않는다.
 *
 * 위젯 전용 파생값·상태는 해당 위젯이 소유한다 (부모는 상태를 갖지 않음):
 *   - SpendingCalendarCard   : 캘린더 월/필터/선택일 상태 + 일별 집계
 *   - AccountBalanceTrendCard: 차트 보기(계좌 선택) 상태
 *   - SavingsRatioCard       : 저번달 요약·재테크 세부 (공용 summaryMath 사용)
 *   - DividendCoverageCard / MonthPaceCard / TopExpensesCard / MonthlyTrendCard
 *     / AssetCompositionCard : 자체 집계 memo
 *
 * 자식은 모두 React.memo — 부모가 넘기는 값은 useMemo 결과 또는 원시값으로 참조 고정.
 */
import React, { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { BudgetAlertWidget } from "../features/dashboard/BudgetAlertWidget";
import { InvestmentSummaryCard } from "../features/dashboard/InvestmentSummaryCard";
import { DashboardGlance } from "../features/dashboard/DashboardGlance";
import { computeInvestmentTotals, computeMonthPace, nearestLoanMaturity } from "../features/dashboard/glanceMath";
import { findOverdueRecurring } from "../utils/recurringAlert";
import { buildFxHistory, fxAsOf } from "../utils/portfolioHistory";
import { ExpenseIncomeCompareCard } from "../features/dashboard/ExpenseIncomeCompareCard";
import { NetWorthTrendChart } from "../features/dashboard/NetWorthTrendChart";
import { CmaBalanceTrendCard } from "../features/dashboard/CmaBalanceTrendCard";
import { MonthPaceCard } from "../features/dashboard/MonthPaceCard";
import { CashFlowForecastCard } from "../features/dashboard/CashFlowForecastCard";
import { CashFlowProjectionCard } from "../features/dashboard/CashFlowProjectionCard";
import { SalaryTimerCard } from "../features/dashboard/SalaryTimerCard";
import { SpendingCalendarCard } from "../features/dashboard/SpendingCalendarCard";
import { TopExpensesCard } from "../features/dashboard/TopExpensesCard";
import { MonthlyTrendCard } from "../features/dashboard/MonthlyTrendCard";
import { InvestmentBreakdownCard } from "../features/dashboard/InvestmentBreakdownCard";
import { SavingsRatioCard } from "../features/dashboard/SavingsRatioCard";
import { DividendCoverageCard } from "../features/dashboard/DividendCoverageCard";
import { DividendGrowthCard } from "../features/dashboard/DividendGrowthCard";
import { DividendPortfolioCard } from "../features/dashboard/DividendPortfolioCard";
import { AssetCompositionCard } from "../features/dashboard/AssetCompositionCard";
import { AccountBalanceTrendCard } from "../features/dashboard/AccountBalanceTrendCard";
import { StockCostVsMarketCard } from "../features/dashboard/StockCostVsMarketCard";
import { TotalAssetTrendCard } from "../features/dashboard/TotalAssetTrendCard";
import { computeLedgerSummary, computeRecheckBreakdown, EXPENSE_BOX_EXCLUDED_NAMES, isBeforePayday } from "../features/dashboard/summaryMath";
import { computeUnrealizedPL } from "../utils/portfolioMetrics";
import { computeIncomeNatureKeys } from "../utils/incomeClassification";
import { isDashboardWidgetVisible, loadHiddenDashboardWidgets } from "../features/dashboard/dashboardWidgets";
import { TaxActionsCard } from "../features/dashboard/TaxActionsCard";
import { DashboardSection } from "../features/dashboard/DashboardSection";
import { formatKRW, formatKrwCompact } from "../utils/formatter";
import { buildDividendGrowth, resolveTrackedTickers } from "../utils/dividendGrowth";
import { buildDividendPortfolio } from "../utils/dividendPortfolio";
import { useAccountTimelineRows } from "../hooks/useAccountTimelineRows";
import { buildAdjustedPrices, buildTimelineMonthRange, netWorthChangeSeries } from "../utils/accountTimeline";
import type {
  Account,
  LedgerEntry,
  StockPrice,
  StockTrade
} from "../types";
import {
  computeAccountBalances,
  computeAccountValuesAtDate,
  computeBalanceSheet,
  computeLoanBalancesById,
  computePositions
} from "../calculations";
import { BalanceSheetStrip } from "../components/BalanceSheetStrip";
import { buildClosedTradeRecords, summarizeRecords } from "../utils/investmentRecord";
import { useFxRateValue } from "../context/FxRateContext";
import { useAppStore } from "../store/appStore";
import { useQuoteRefreshActivity } from "../features/stocks/useQuoteRefresh";
import {
  getTodayKST,
  getMonthEndDate,
  shiftMonth,
} from "../utils/date";
import { canonicalTickerForMatch, isUSDStock } from "../utils/finance";
import { latestRecordedDate } from "../utils/ledgerFreshness";
const LazyPortfolioDashboardCharts = lazy(() =>
  import("../features/stocks/PortfolioDashboardCharts").then((m) => ({ default: m.PortfolioDashboardCharts }))
);
const LazyPortfolioPerformanceSection = lazy(() =>
  import("../features/stocks/PortfolioPerformanceSection").then((m) => ({ default: m.PortfolioPerformanceSection }))
);
const LazySecuritiesValueTrendCard = lazy(() =>
  import("../features/stocks/SecuritiesValueTrendCard").then((m) => ({ default: m.SecuritiesValueTrendCard }))
);

interface Props {
  accounts?: Account[];
  ledger?: LedgerEntry[];
  trades?: StockTrade[];
  prices?: StockPrice[];
}

export const DashboardView: React.FC<Props> = (props) => {
  const storeData = useAppStore((s) => s.data);
  const accounts = props.accounts ?? storeData.accounts;
  const ledger = props.ledger ?? storeData.ledger;
  const trades = props.trades ?? storeData.trades;
  const prices = props.prices ?? storeData.prices;
  const categoryPresets = storeData.categoryPresets;

  const fxRate = useFxRateValue();

  // 오늘/이번달 — 자정을 넘겨 탭을 켜둔 경우 대비, 탭 복귀(visibilitychange/focus) 시 재계산.
  // 날짜가 실제로 바뀐 경우에만 상태가 갱신되어 불필요한 리렌더는 없다.
  const [today, setToday] = useState<string>(() => getTodayKST());
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      const next = getTodayKST();
      setToday((prev) => (prev === next ? prev : next));
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  // 이번달(KST) = 오늘(KST)의 YYYY-MM — getThisMonthKST()와 동일 기준, today 갱신 시 함께 갱신
  const currentMonth = useMemo(() => today.slice(0, 7), [today]);

  // 위젯 표시/숨김 — 설정 탭에서 저장한 숨김 목록을 마운트 시 적용
  // (대시보드 탭은 전환 시 언마운트/재마운트되므로 설정 변경 후 돌아오면 즉시 반영됨)
  const [hiddenWidgets] = useState<Set<string>>(() => loadHiddenDashboardWidgets());
  const show = (id: string) => isDashboardWidgetVisible(id, hiddenWidgets, today);

  const monthRange = useMemo(() => buildTimelineMonthRange(ledger, trades, currentMonth), [ledger, trades, currentMonth]);

  const adjustedPrices = useMemo(() => buildAdjustedPrices(prices, fxRate), [prices, fxRate]);

  // 배당 위젯이 공유하는 추적 종목 — 설정('배당 성장 추적 티커') + 자동 보충.
  // 포트폴리오 합계와 종목별 성장 카드가 같은 목록을 봐야 두 위젯의 숫자가 서로 설명된다.
  const trackedDividendTickers = useMemo(
    () => resolveTrackedTickers(storeData.dividendTrackingTicker, ledger, trades),
    [storeData.dividendTrackingTicker, ledger, trades]
  );

  // 배당 포트폴리오 합계 — 추적 종목의 원금 대비 배당률·월 수령액
  const dividendPortfolio = useMemo(
    () => buildDividendPortfolio({ ledger, trades, currentMonth, fxRate, tickers: trackedDividendTickers }),
    [ledger, trades, currentMonth, fxRate, trackedDividendTickers]
  );

  // 배당 성장 추적 — 설정 티커(쉼표 구분 복수 가능) + 자동 보충(보유 중 & 분배 기록 ≥2건, 최근 수령 순)
  const dividendGrowthData = useMemo(() => {
    return trackedDividendTickers
      .map((t) =>
        buildDividendGrowth({
          ticker: t,
          ledger,
          trades,
          prices,
          historicalDailyCloses: storeData.historicalDailyCloses,
          marketEnvSnapshots: storeData.marketEnvSnapshots,
          currentMonth,
          fxRate, // USD 종목의 분배금·주가·평단을 KRW로 정규화 (불변식 #5)
        })
      )
      .filter((d): d is NonNullable<typeof d> => d != null);
  }, [
    trackedDividendTickers,
    storeData.historicalDailyCloses,
    storeData.marketEnvSnapshots,
    ledger,
    trades,
    prices,
    currentMonth,
    fxRate,
  ]);

  /** 일별 환율 이력 — fxRateAtTrade 없는 USD 매도를 거래일 환율로 환산(주식 탭과 같은 소스).
   *  없으면 현재 환율로 환산돼 실현손익이 날마다 흔들린다. */
  const fxHistory = useMemo(
    () => buildFxHistory(storeData.historicalDailyFx, storeData.marketEnvSnapshots),
    [storeData.historicalDailyFx, storeData.marketEnvSnapshots]
  );

  /** 매월 15일·월말 스냅샷 날짜 (오늘 이전만) + 마지막 점 = 오늘(현재 시세 — 계좌 탭과 같은 값) */
  const balanceSnapshotDates = useMemo(() => {
    const out: string[] = [];
    monthRange.forEach((month) => {
      const d15 = `${month}-15`;
      const dEnd = getMonthEndDate(month);
      if (d15 < today) out.push(d15);
      if (dEnd < today) out.push(dEnd);
    });
    out.push(today);
    return out.sort();
  }, [monthRange, today]);

  /** 일별 종가 인덱스(canonical ticker → 날짜 오름차순) — 지난 스냅샷을 그날 시가로 평가 */
  const historicalDailyCloses = storeData.historicalDailyCloses;
  const closesByTicker = useMemo(() => {
    const m = new Map<string, Array<{ date: string; close: number; currency?: string }>>();
    for (const c of historicalDailyCloses ?? []) {
      const t = canonicalTickerForMatch(c.ticker);
      if (!t || !c.date || !(Number(c.close) > 0)) continue;
      const arr = m.get(t);
      if (arr) arr.push(c);
      else m.set(t, [c]);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.date.localeCompare(b.date));
    return m;
  }, [historicalDailyCloses]);

  /** 계좌별 잔액 스냅샷 (매월 15·월말 + 오늘): 계좌 순가치(현금+주식평가+USD환산−계좌 부채).
   *  total = 양수 계좌 합(총자산 — 계좌 탭 대차와 같은 정의, 대출 미차감).
   *  지난 점은 그날 종가·환율로, 종가가 없는 종목만 원가 — atCost=원가 대체 금액(라벨용).
   *  (예전엔 오늘 갱신된 시세가 'updatedAt ≤ 과거 날짜'에 걸려 전부 원가로 대체되고, 카드 잔액을 부채 차감 없이 더했다) */
  const accountBalanceSnapshots = useMemo(() => {
    if (balanceSnapshotDates.length === 0 || accounts.length === 0) return [];
    return balanceSnapshotDates.map((dateStr) => {
      const isToday = dateStr === today;
      const fxAt = isToday ? fxRate : (fxAsOf(fxHistory, dateStr, fxRate) ?? fxRate);
      let prices = adjustedPrices;
      if (!isToday) {
        const fromCloses = new Set<string>();
        const closePrices: StockPrice[] = [];
        for (const [ticker, arr] of closesByTicker) {
          let c: (typeof arr)[number] | null = null;
          for (const x of arr) {
            if (x.date > dateStr) break;
            c = x;
          }
          if (!c) continue;
          const usd = c.currency === "USD" || (c.currency !== "KRW" && isUSDStock(ticker));
          if (usd && !(fxAt && fxAt > 0)) continue;
          fromCloses.add(ticker);
          closePrices.push({ ticker, price: usd ? c.close * (fxAt as number) : c.close, currency: "KRW", updatedAt: c.date });
        }
        prices = [
          ...closePrices,
          ...adjustedPrices.filter((p) => !!p.updatedAt && p.updatedAt.slice(0, 10) <= dateStr && !fromCloses.has(canonicalTickerForMatch(p.ticker))),
        ];
      }
      const { byAccount, stockAtCost } = computeAccountValuesAtDate(accounts, ledger, trades, dateStr, prices, {
        fxRate: fxAt ?? null,
        priceFallback: "cost",
      });
      const row: Record<string, number | string> = {
        date: dateStr,
        label: dateStr.slice(5, 7) + "-" + dateStr.slice(8, 10),
      };
      let total = 0;
      for (const account of accounts) {
        const v = byAccount.get(account.id) ?? 0;
        row[account.id] = v;
        if (v > 0) total += v;
      }
      row.total = total;
      row.atCost = stockAtCost;
      return row;
    });
  }, [balanceSnapshotDates, accounts, ledger, trades, adjustedPrices, fxRate, fxHistory, closesByTicker, today]);

  /** 근로소득(월급·수당·상여) 키 — 인사이트와 동일한 단일 소스. 수입 카드·추이·비교·저축률이 공유.
   *  이 키가 지정되면 정산·용돈·배당 등 비근로 유입은 "수입"에서 제외된다. */
  const salaryKeys = useMemo(() => computeIncomeNatureKeys(ledger, accounts, categoryPresets?.categoryTypes).salaryKeys, [ledger, accounts, categoryPresets]);

  /** 전체 기간 합계: 수입(근로소득), 일반 지출, 재테크 (categoryPresets로 레거시 저축성지출도 재테크 분류) */
  const allTimeSummary = useMemo(
    () => computeLedgerSummary(ledger, fxRate, null, categoryPresets, salaryKeys, EXPENSE_BOX_EXCLUDED_NAMES),
    [ledger, fxRate, categoryPresets, salaryKeys]
  );

  const monthlySummary = useMemo(() => ({
    month: currentMonth,
    ...computeLedgerSummary(ledger, fxRate, currentMonth, categoryPresets, salaryKeys, EXPENSE_BOX_EXCLUDED_NAMES),
  }), [ledger, fxRate, currentMonth, categoryPresets, salaryKeys]);

  const monthlyRecheckBreakdown = useMemo(
    () => computeRecheckBreakdown(ledger, fxRate, currentMonth),
    [ledger, fxRate, currentMonth]
  );


  /** 누적 실현손익: 매도 건 FIFO 실현손익 합계 (KRW, 거래시점 환율 — 투자기록 카드·리포트와 동일 정의).
   *  환율을 확정할 수 없는 기록(fxUnreliable)은 summarizeRecords가 빼고 건수를 돌려준다. */
  const { totalRealizedPnl, excludedUnreliable } = useMemo(() => {
    const summary = summarizeRecords(buildClosedTradeRecords(trades, accounts, fxRate ?? undefined, fxHistory));
    return { totalRealizedPnl: summary.totalPnl, excludedUnreliable: summary.excludedUnreliable };
  }, [trades, accounts, fxRate, fxHistory]);

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

  const loans = useMemo(() => storeData.loans ?? [], [storeData.loans]);
  /** 총자산·총부채·순자산 단일 소스 — 계좌 탭·인사이트·부채 탭과 같은 정의 */
  const balanceSheet = useMemo(
    () => computeBalanceSheet(balances, positions, fxRate, loans, ledger),
    [balances, positions, fxRate, loans, ledger]
  );

  /** 월별 계좌 타임라인 — 무거운 집계는 공용 훅(hooks/useAccountTimelineRows)으로 분리, 호출은 부모 1회 */
  const accountTimelineRows = useAccountTimelineRows({
    accounts,
    ledger,
    trades,
    adjustedPrices,
    fxRate,
    currentMonth,
    monthRange,
    loans,
    historicalDailyCloses: storeData.historicalDailyCloses,
    fxHistory
  });

  /** 순자산 변화용 월별 시계열(KRW) — 목표 ETA 페이스·첫 화면 스파크라인·전월 대비가 공유.
   *  지난 월말이 원가로 평가된 구간이 섞이면 전 구간을 원가 기준으로 맞춘다(netWorthChangeSeries) —
   *  안 그러면 평가손익 전체가 이번 달 변화로 몰린다. */
  const netWorthChange = useMemo(() => netWorthChangeSeries(accountTimelineRows), [accountTimelineRows]);
  // 마지막 점은 지금 순자산(시가)으로 맞춘다 — 변화량(페이스·증감)은 같은 기준, 목표까지 남은 금액은 현재 시가 기준
  const netWorthSeriesKrw = useMemo(() => {
    const { series } = netWorthChange;
    const lastRow = accountTimelineRows[accountTimelineRows.length - 1];
    if (!lastRow || series.length === 0) return series;
    const offset = lastRow.total - series[series.length - 1].value;
    return offset === 0 ? series : series.map((p) => ({ month: p.month, value: p.value + offset }));
  }, [netWorthChange, accountTimelineRows]);

  /** 순자산 추이: accountTimelineRows에서 month, total 추출 (만원 단위) */
  const netWorthTrendData = useMemo(() => {
    if (accountTimelineRows.length === 0) return [] as Array<{ month: string; value: number; asset: number; debt: number; pension: number; changeValue: number }>;
    return accountTimelineRows.map((row, i) => ({
      month: String(row.month),
      value: Math.round(Number(row.total) / 10000),
      changeValue: Math.round(netWorthChange.series[i].value / 10000),
      asset: Math.round(Number(row.asset) / 10000),
      debt: Math.round(Number(row.debt) / 10000),
      pension: Math.round(Number(row.pension) / 10000)
    }));
  }, [accountTimelineRows, netWorthChange]);

  const cmaAccount = useMemo(() => accounts.find((a) => a.id === "CMA") ?? null, [accounts]);

  /** 전월 근로소득 — 요약 카드의 "급여 아직 없음" 기준선 */
  const prevMonthIncome = useMemo(
    () => computeLedgerSummary(ledger, fxRate, shiftMonth(currentMonth, -1), categoryPresets, salaryKeys, EXPENSE_BOX_EXCLUDED_NAMES).income,
    [ledger, fxRate, currentMonth, categoryPresets, salaryKeys]
  );

  /** 급여 전 판정 — 요약 카드·전월 대비 카드·섹션 요약이 같은 값을 쓴다 */
  const beforePayday = isBeforePayday(monthlySummary.income, prevMonthIncome, allTimeSummary.income > 0);

  /** 마지막 기록일 — 캡처를 모아 입력하므로 '오늘'과 다를 수 있다. 첫 화면 KPI가 어느 날까지의 기록인지 밝힌다. */
  const lastRecordDate = useMemo(() => latestRecordedDate(ledger), [ledger]);

  /** 첫 화면(한눈에 보기) 값 — 상세 카드와 같은 계산(glanceMath)을 부모에서 1회 */
  const monthPace = useMemo(
    () => computeMonthPace(ledger, currentMonth, today, categoryPresets, fxRate),
    [ledger, currentMonth, today, categoryPresets, fxRate]
  );
  const investmentTotals = useMemo(
    () => computeInvestmentTotals({ accounts, ledger, trades, balances, positions, fxRate }),
    [accounts, ledger, trades, balances, positions, fxRate]
  );
  const nextLoan = useMemo(
    () => nearestLoanMaturity(loans, computeLoanBalancesById(loans, ledger, today)),
    [loans, ledger, today]
  );
  const recurringExpenses = storeData.recurringExpenses;
  const recurringMissing = useMemo(
    () => findOverdueRecurring(recurringExpenses ?? [], ledger).filter((i) => !i.alreadyLogged).length,
    [recurringExpenses, ledger]
  );

  /** 접힌 섹션 줄의 대표 숫자 셋 — 접힌 상태 자체가 요약이 되게 */
  const unrealizedNet = useMemo(() => {
    const u = computeUnrealizedPL(positions, fxRate);
    return u.unrealizedGain - u.unrealizedLoss;
  }, [positions, fxRate]);
  /** 보유 중인데 시세가 없는 종목 수 — positions는 priceFallback:"cost"라 시세가 없으면 평가손익이 0으로
   *  보인다("평가손익 +0원"). 미반영 종목을 세어 0을 사실처럼 표시하지 않는다(시세 미로드 = 중립 표기). */
  const { openPositionCount, unpricedCount } = useMemo(() => {
    const priced = new Set<string>();
    for (const p of adjustedPrices) {
      if (typeof p.price === "number" && Number.isFinite(p.price) && p.price > 0) priced.add(canonicalTickerForMatch(p.ticker));
    }
    let open = 0;
    let unpriced = 0;
    for (const p of positions) {
      if (!(p.quantity > 0)) continue;
      open++;
      if (!priced.has(canonicalTickerForMatch(p.ticker))) unpriced++;
    }
    return { openPositionCount: open, unpricedCount: unpriced };
  }, [positions, adjustedPrices]);
  const quotesLoading = useQuoteRefreshActivity((s) => s.running > 0);
  const unrealizedLabel =
    openPositionCount > 0 && unpricedCount === openPositionCount
      ? quotesLoading
        ? "평가손익 시세 불러오는 중"
        : "평가손익 시세 없음"
      : `평가손익 ${Math.round(unrealizedNet) === 0 ? "" : unrealizedNet > 0 ? "+" : "−"}${formatKrwCompact(Math.abs(unrealizedNet))}원${unpricedCount > 0 ? ` (시세 없는 ${unpricedCount}종목 제외)` : ""}`;
  const assetsSummary = `순자산 ${formatKrwCompact(balanceSheet.netWorth)}원 · 총자산 ${formatKrwCompact(balanceSheet.totalAssets)}원 · ${unrealizedLabel}`;
  const spendingSummary = `지출 ${formatKRW(Math.round(monthlySummary.expense))} · 재테크 ${formatKRW(Math.round(monthlySummary.investing))} · ${beforePayday ? "급여 전" : `수지 ${formatKRW(Math.round(monthlySummary.income - monthlySummary.expense))}`}`;
  const dividendsSummary = dividendPortfolio
    ? `12개월 배당 ${formatKrwCompact(dividendPortfolio.received12)}원 · 월 배당 ${formatKrwCompact(dividendPortfolio.monthlyAvg)}원${dividendPortfolio.yoc != null ? ` · 배당률 ${dividendPortfolio.yoc.toFixed(2)}%` : ""}`
    : undefined;

  /** 섹션 안 위젯이 모두 숨김이면 섹션 헤더도 그리지 않는다 */
  const anyShown = (ids: string[]) => ids.some(show);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* ── 첫 화면: 질문 3열(이번 달 얼마 썼나 · 내 자산은 · 투자·배당은) + 확인할 일. 상세는 아래 접이식 섹션 ── */}
      {show("summary") && (
        <DashboardGlance
          today={today}
          lastRecordDate={lastRecordDate}
          monthExpense={monthlySummary.expense}
          monthIncome={monthlySummary.income}
          monthInvesting={monthlySummary.investing}
          beforePayday={beforePayday}
          pace={monthPace}
          bs={balanceSheet}
          // 평행이동 전 시계열 — 첫 화면은 "시작(실제) + 증가 = 지금(시가)"이 맞아야 하고,
          // 마지막 점(원가)과 지금의 차이를 평가손익으로 따로 밝힌다(DashboardGlance)
          netWorthSeries={netWorthChange.series}
          netWorthBasis={netWorthChange.basis}
          nextLoan={nextLoan}
          invest={investmentTotals}
          allUnpriced={openPositionCount > 0 && unpricedCount === openPositionCount}
          quotesLoading={quotesLoading}
          unpricedCount={unpricedCount}
          unrealizedPnl={openPositionCount > 0 && unpricedCount === openPositionCount ? null : unrealizedNet}
          excludedUnreliable={excludedUnreliable}
          dividend={dividendPortfolio}
          recurringMissing={recurringMissing}
        />
      )}

      {/* ── 자산·투자: 성과·추이·구성 차트 (기본 접힘, 접힌 줄에 순자산) ── */}
      {/* 섹션 표시 조건 = 섹션 안에 그려지는 위젯 목록 그대로 (빠지면 그 위젯만 켠 사용자는 도달 경로가 없다) */}
      {anyShown(["investmentSummary", "investmentPerformance", "securitiesValueTrend", "netWorthTrend", "assetComposition", "portfolioCharts", "accountBalanceTrend", "stockCostVsMarket", "totalAssetTrend", "cmaBalanceTrend"]) && (
        <DashboardSection id="assets" title="자산·투자" summary={assetsSummary}>
          <BalanceSheetStrip bs={balanceSheet} />
          {show("investmentSummary") && (
            <InvestmentSummaryCard
              accounts={accounts}
              ledger={ledger}
              trades={trades}
              balances={balances}
              positions={positions}
              fxRate={fxRate}
              netWorthSeries={netWorthSeriesKrw}
              netWorth={balanceSheet.netWorth}
              unpricedCount={unpricedCount}
              fxHistory={fxHistory}
            />
          )}
          {show("investmentPerformance") && (
            <Suspense fallback={<div className="card" style={{ minHeight: 360 }} />}>
              <LazyPortfolioPerformanceSection />
            </Suspense>
          )}

          {show("securitiesValueTrend") && (
            <Suspense fallback={<div className="card" style={{ minHeight: 320 }} />}>
              <LazySecuritiesValueTrendCard />
            </Suspense>
          )}

          {show("netWorthTrend") && <NetWorthTrendChart data={netWorthTrendData} changeBasis={netWorthChange.basis} />}

          {show("assetComposition") && (
            <AssetCompositionCard
              balances={balances}
              positions={positions}
              fxRate={fxRate}
              totalNetWorth={balanceSheet.netWorth}
              totalDebt={-balanceSheet.totalLiabilities}
            />
          )}

          {show("portfolioCharts") && (
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
          )}

          {show("accountBalanceTrend") && (
            <AccountBalanceTrendCard
              accountBalanceSnapshots={accountBalanceSnapshots}
              accounts={accounts}
            />
          )}

          {show("stockCostVsMarket") && (
            <StockCostVsMarketCard
              today={today}
              accounts={accounts}
              trades={trades}
              prices={prices}
              fxRate={fxRate}
              marketEnvSnapshots={storeData.marketEnvSnapshots}
            />
          )}

          {show("totalAssetTrend") && (
            <TotalAssetTrendCard
              today={today}
              accounts={accounts}
              ledger={ledger}
              trades={trades}
              prices={prices}
              fxRate={fxRate}
              marketEnvSnapshots={storeData.marketEnvSnapshots}
            />
          )}

          {cmaAccount && show("cmaBalanceTrend") && (
            <CmaBalanceTrendCard
              accountBalanceSnapshots={accountBalanceSnapshots}
              accountId={cmaAccount.id}
              accountName={cmaAccount.name || cmaAccount.id}
            />
          )}
        </DashboardSection>
      )}

      {/* ── 이번 달 소비·현금흐름 (기본 접힘, 접힌 줄에 이번 달 지출) ── */}
      {anyShown(["monthCompare", "topExpenses", "monthlyTrend", "investmentBreakdown", "monthPace", "salaryTimer", "cashFlow", "cashFlowProjection", "spendingCalendar", "budgetAlert"]) && (
        <DashboardSection id="spending" title="이번 달 소비·현금흐름" summary={spendingSummary}>
          {show("monthCompare") && (
            <ExpenseIncomeCompareCard
              ledger={ledger}
              month={currentMonth}
              fxRate={fxRate}
              categoryPresets={categoryPresets}
              salaryKeys={salaryKeys}
              beforePayday={beforePayday}
            />
          )}
          {(show("topExpenses") || show("monthlyTrend")) && (
            <div className="dashboard-two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {show("topExpenses") && (
                <TopExpensesCard
                  currentMonth={currentMonth}
                  ledger={ledger}
                  categoryPresets={categoryPresets}
                  fxRate={fxRate}
                />
              )}
              {show("monthlyTrend") && (
                <MonthlyTrendCard
                  ledger={ledger}
                  categoryPresets={categoryPresets}
                  fxRate={fxRate}
                  salaryKeys={salaryKeys}
                />
              )}
            </div>
          )}

          {show("investmentBreakdown") && (
            <InvestmentBreakdownCard
              month={monthlySummary.month}
              monthlyRecheckBreakdown={monthlyRecheckBreakdown}
              totalRealizedPnl={totalRealizedPnl}
            />
          )}

          {show("monthPace") && (
            <MonthPaceCard
              currentMonth={currentMonth}
              today={today}
              ledger={ledger}
              accounts={accounts}
              categoryPresets={categoryPresets}
              fxRate={fxRate}
            />
          )}

          {show("salaryTimer") && <SalaryTimerCard ledger={ledger} fxRate={fxRate} />}

          {show("cashFlow") && (
            <CashFlowForecastCard
              recurring={storeData.recurringExpenses ?? []}
              ledger={ledger}
              accounts={accounts}
              fxRate={fxRate}
              categoryPresets={categoryPresets}
            />
          )}

          {show("cashFlowProjection") && (
            <CashFlowProjectionCard
              accounts={accounts}
              ledger={ledger}
              loans={loans}
              recurring={storeData.recurringExpenses ?? []}
              fxRate={fxRate}
              categoryPresets={categoryPresets}
            />
          )}

          {show("spendingCalendar") && (
            <SpendingCalendarCard
              ledger={ledger}
              accounts={accounts}
              categoryPresets={categoryPresets}
              fxRate={fxRate}
              currentMonth={currentMonth}
              today={today}
            />
          )}

          {/* 예산 초과 알림 */}
          {show("budgetAlert") && (
            <BudgetAlertWidget
              ledger={ledger}
              budgetGoals={storeData.budgetGoals}
              accounts={accounts}
              fxRate={fxRate}
              categoryPresets={storeData.categoryPresets}
            />
          )}
        </DashboardSection>
      )}

      {/* ── 배당·저축·세금 (기본 접힘, 접힌 줄에 최근 12개월 배당) ── */}
      {(anyShown(["savingsRatio", "dividendCoverage", "dividendGrowth", "taxActions"]) || (show("dividendPortfolio") && !!dividendPortfolio)) && (
        <DashboardSection
          id="dividends"
          title="배당·저축·세금"
          summary={dividendsSummary}
        >
          {show("dividendPortfolio") && dividendPortfolio && <DividendPortfolioCard data={dividendPortfolio} />}
          {(show("savingsRatio") || show("dividendCoverage")) && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: 16,
                alignItems: "stretch"
              }}
            >
              {show("savingsRatio") && (
                <SavingsRatioCard
                  ledger={ledger}
                  fxRate={fxRate}
                  currentMonth={currentMonth}
                  categoryPresets={categoryPresets}
                  salaryKeys={salaryKeys}
                />
              )}

              {show("dividendCoverage") && (
                <DividendCoverageCard
                  ledger={ledger}
                  accounts={accounts}
                  categoryPresets={categoryPresets}
                  fxRate={fxRate}
                  currentMonth={currentMonth}
                />
              )}
            </div>
          )}

          {/* 배당 성장 추적 — 장기 적립 종목별 분배금·분배율·주가. 한 행에 카드 1개 (차트 가독성) */}
          {show("dividendGrowth") &&
            dividendGrowthData.map((d) => <DividendGrowthCard key={d.ticker} data={d} />)}

          {/* 절세 액션 (4-2) — 종합과세·해외주식 양도세·절세계좌를 한 목록으로. 10~12월엔 기본 표시,
              그 외엔 위젯 설정에서 켜야 보임(연중 위젯 피로 방지) */}
          {show("taxActions") && <TaxActionsCard />}
        </DashboardSection>
      )}
    </div>
  );
};
