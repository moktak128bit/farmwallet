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
import { DividendGrowthCard } from "../features/dashboard/DividendGrowthCard";
import { AssetCompositionCard } from "../features/dashboard/AssetCompositionCard";
import { AccountBalanceTrendCard } from "../features/dashboard/AccountBalanceTrendCard";
import { StockCostVsMarketCard } from "../features/dashboard/StockCostVsMarketCard";
import { TotalAssetTrendCard } from "../features/dashboard/TotalAssetTrendCard";
import { computeLedgerSummary, computeRecheckBreakdown } from "../features/dashboard/summaryMath";
import { loadHiddenDashboardWidgets } from "../features/dashboard/dashboardWidgets";
import { buildDividendGrowth, resolveTrackedTickers } from "../utils/dividendGrowth";
import { useAccountTimelineRows } from "../hooks/useAccountTimelineRows";
import { buildAdjustedPrices, buildTimelineMonthRange } from "../utils/accountTimeline";
import type {
  Account,
  LedgerEntry,
  StockPrice,
  StockTrade
} from "../types";
import {
  computeAccountBalances,
  computeBalanceAtDateForAccounts,
  computePositions,
  computeRealizedPnlByTradeId,
  computeTotalDebt,
  computeTotalNetWorth
} from "../calculations";
import { useFxRateValue } from "../context/FxRateContext";
import { useAppStore } from "../store/appStore";
import {
  getTodayKST,
  getMonthEndDate,
} from "../utils/date";
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
  const show = (id: string) => !hiddenWidgets.has(id);

  const monthRange = useMemo(() => buildTimelineMonthRange(ledger, trades, currentMonth), [ledger, trades, currentMonth]);

  const adjustedPrices = useMemo(() => buildAdjustedPrices(prices, fxRate), [prices, fxRate]);

  // 배당 성장 추적 — 설정 티커(쉼표 구분 복수 가능) + 자동 보충(보유 중 & 분배 기록 ≥2건, 최근 수령 순)
  const dividendGrowthData = useMemo(() => {
    const tickers = resolveTrackedTickers(storeData.dividendTrackingTicker, ledger, trades);
    return tickers
      .map((t) =>
        buildDividendGrowth({
          ticker: t,
          ledger,
          trades,
          prices,
          historicalDailyCloses: storeData.historicalDailyCloses,
          marketEnvSnapshots: storeData.marketEnvSnapshots,
          currentMonth,
        })
      )
      .filter((d): d is NonNullable<typeof d> => d != null);
  }, [
    storeData.dividendTrackingTicker,
    storeData.historicalDailyCloses,
    storeData.marketEnvSnapshots,
    ledger,
    trades,
    prices,
    currentMonth,
  ]);

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

  /** 전체 기간 합계: 수입, 일반 지출, 재테크 (categoryPresets로 레거시 저축성지출도 재테크 분류) */
  const allTimeSummary = useMemo(
    () => computeLedgerSummary(ledger, fxRate, null, categoryPresets),
    [ledger, fxRate, categoryPresets]
  );

  const monthlySummary = useMemo(() => ({
    month: currentMonth,
    ...computeLedgerSummary(ledger, fxRate, currentMonth, categoryPresets),
  }), [ledger, fxRate, currentMonth, categoryPresets]);

  const monthlyRecheckBreakdown = useMemo(
    () => computeRecheckBreakdown(ledger, fxRate, currentMonth),
    [ledger, fxRate, currentMonth]
  );

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

  const loans = useMemo(() => storeData.loans ?? [], [storeData.loans]);
  const totalDebt = useMemo(() => computeTotalDebt(accounts, loans, ledger), [accounts, loans, ledger]);
  const totalNetWorth = useMemo(
    () => computeTotalNetWorth(balances, positions, fxRate, loans, ledger),
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
    loans
  });

  /** 순자산 추이: accountTimelineRows에서 month, total 추출 (만원 단위) */
  const netWorthTrendData = useMemo(() => {
    if (accountTimelineRows.length === 0) return [] as Array<{ month: string; value: number; asset: number; debt: number }>;
    return accountTimelineRows.map((row) => ({
      month: String(row.month),
      value: Math.round(Number(row.total) / 10000),
      asset: Math.round(Number(row.asset) / 10000),
      debt: Math.round(Number(row.debt) / 10000)
    }));
  }, [accountTimelineRows]);

  const cmaAccount = useMemo(() => accounts.find((a) => a.id === "CMA") ?? null, [accounts]);

  return (
    <div>
      <div className="section-header">
        <h2>대시보드</h2>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        {show("summary") && (
          <MonthlySummaryCards monthlySummary={monthlySummary} allTimeSummary={allTimeSummary} />
        )}

        {show("salaryTimer") && <SalaryTimerCard ledger={ledger} fxRate={fxRate} />}

        {show("monthCompare") && (
          <ExpenseIncomeCompareCard
            ledger={ledger}
            month={currentMonth}
            fxRate={fxRate}
            categoryPresets={categoryPresets}
          />
        )}

        {show("investmentSummary") && (
          <InvestmentSummaryCard
            accounts={accounts}
            ledger={ledger}
            trades={trades}
            balances={balances}
            positions={positions}
            fxRate={fxRate}
          />
        )}

        {show("netWorthTrend") && <NetWorthTrendChart data={netWorthTrendData} />}

        {(show("topExpenses") || show("monthlyTrend")) && (
          <div className="dashboard-two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {show("topExpenses") && (
              <TopExpensesCard
                currentMonth={currentMonth}
                ledger={ledger}
                accounts={accounts}
                categoryPresets={categoryPresets}
                fxRate={fxRate}
              />
            )}
            {show("monthlyTrend") && (
              <MonthlyTrendCard
                ledger={ledger}
                categoryPresets={categoryPresets}
                fxRate={fxRate}
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

        {/* 배당 성장 추적 — 장기 적립 종목별 분배금·분배율·주가 (종목당 카드 1개) */}
        {show("dividendGrowth") && dividendGrowthData.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
              gap: 16,
              alignItems: "stretch"
            }}
          >
            {dividendGrowthData.map((d) => (
              <DividendGrowthCard key={d.ticker} data={d} />
            ))}
          </div>
        )}

        {show("assetComposition") && (
          <AssetCompositionCard
            balances={balances}
            positions={positions}
            fxRate={fxRate}
            totalNetWorth={totalNetWorth}
            totalDebt={totalDebt}
          />
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
          <div style={{ marginTop: 16 }}>
            <CmaBalanceTrendCard
              accountBalanceSnapshots={accountBalanceSnapshots}
              accountId={cmaAccount.id}
              accountName={cmaAccount.name || cmaAccount.id}
            />
          </div>
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
          />
        )}
      </div>
    </div>
  );
};
