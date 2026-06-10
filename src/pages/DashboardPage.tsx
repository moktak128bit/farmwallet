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
import React, { lazy, Suspense, useMemo } from "react";
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
import { computeLedgerSummary, computeRecheckBreakdown } from "../features/dashboard/summaryMath";
import { useAccountTimelineRows } from "../features/dashboard/hooks/useAccountTimelineRows";
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
  getThisMonthKST,
  getTodayKST,
  getMonthEndDate,
  buildMonthRange,
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
  const currentMonth = useMemo(() => getThisMonthKST(), []);
  const today = useMemo(() => getTodayKST(), []);

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

  /** 전체 기간 합계: 수입, 일반 지출, 재테크 지출 */
  const allTimeSummary = useMemo(
    () => computeLedgerSummary(ledger, fxRate, null),
    [ledger, fxRate]
  );

  const monthlySummary = useMemo(() => ({
    month: currentMonth,
    ...computeLedgerSummary(ledger, fxRate, currentMonth),
  }), [ledger, fxRate, currentMonth]);

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

  /** 월별 계좌 타임라인 — 무거운 집계는 훅(features/dashboard/hooks)으로 분리, 호출은 부모 1회 */
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
        <MonthlySummaryCards monthlySummary={monthlySummary} allTimeSummary={allTimeSummary} />

        <SalaryTimerCard ledger={ledger} />

        <ExpenseIncomeCompareCard ledger={ledger} month={currentMonth} />

        <InvestmentSummaryCard
          accounts={accounts}
          ledger={ledger}
          trades={trades}
          prices={adjustedPrices}
          fxRate={fxRate}
        />

        <InvestmentRecordCard trades={trades} accounts={accounts} ledger={ledger} fxRate={fxRate} />

        <NetWorthTrendChart data={netWorthTrendData} />

        <div className="dashboard-two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <TopExpensesCard
            currentMonth={currentMonth}
            ledger={ledger}
            accounts={accounts}
            categoryPresets={categoryPresets}
            fxRate={fxRate}
          />
          <MonthlyTrendCard
            ledger={ledger}
            accounts={accounts}
            categoryPresets={categoryPresets}
            fxRate={fxRate}
          />
        </div>

        <InvestmentBreakdownCard
          month={monthlySummary.month}
          monthlyRecheckBreakdown={monthlyRecheckBreakdown}
          totalRealizedPnl={totalRealizedPnl}
        />

        <MonthPaceCard
          currentMonth={currentMonth}
          today={today}
          ledger={ledger}
          accounts={accounts}
          categoryPresets={categoryPresets}
          fxRate={fxRate}
        />

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
          <SavingsRatioCard ledger={ledger} fxRate={fxRate} currentMonth={currentMonth} />

          <DividendCoverageCard
            ledger={ledger}
            accounts={accounts}
            categoryPresets={categoryPresets}
            fxRate={fxRate}
            currentMonth={currentMonth}
          />
        </div>

        <AssetCompositionCard
          balances={balances}
          positions={positions}
          fxRate={fxRate}
          totalNetWorth={totalNetWorth}
          totalDebt={totalDebt}
        />

        <AccountBalanceTrendCard
          accountBalanceSnapshots={accountBalanceSnapshots}
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

        {cmaAccount && (
          <div style={{ marginTop: 16 }}>
            <CmaBalanceTrendCard
              accountBalanceSnapshots={accountBalanceSnapshots}
              accountId={cmaAccount.id}
              accountName={cmaAccount.name || cmaAccount.id}
            />
          </div>
        )}

        <SpendingCalendarCard
          ledger={ledger}
          accounts={accounts}
          categoryPresets={categoryPresets}
          fxRate={fxRate}
          currentMonth={currentMonth}
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
