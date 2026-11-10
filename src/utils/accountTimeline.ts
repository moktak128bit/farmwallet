/**
 * 월별 계좌 타임라인(주식/저축/자산/부채/순자산) 집계 — 순수 모듈 (React 의존 없음).
 * 대시보드 NetWorthTrendChart와 인사이트 자산 탭이 같은 숫자를 보도록 단일 소스로 둔다.
 * computeAccountTimelineRows 본문은 기존 대시보드 훅(useAccountTimelineRows)에서
 * 로직 수정 없이 이동 — 대시보드 숫자가 기준값이므로 본문을 변경하지 않는다.
 */
import type { Account, HistoricalDailyClose, LedgerEntry, Loan, StockPrice, StockTrade } from "../types";
import { accountDebtOffset, computeLoanBalanceAt, computePositions, positionMarketValueKRW } from "../calculations";
import { buildMonthRange, getMonthEndDate } from "./date";
import { usdBalanceModeDelta } from "./tradeCashImpact";
import { canonicalTickerForMatch, isUSDStock } from "./finance";
import { fxAsOf, type FxPoint } from "./portfolioHistory";

export type AccountTimelineRow = {
  month: string;
  stock: number;
  savings: number;
  asset: number;
  debt: number;
  total: number;
  /** 연금계좌(isPension)의 순기여분 합계 (자산−계좌부채). 순자산에서 '연금 제외' 보기에 사용. */
  pension: number;
  /** 그 시점 시세(종가)가 없어 매입원가로 평가한 보유 종목 금액 — stock 중 원가 대체분 */
  stockAtCost?: number;
  /** 보유 종목을 모두 매입원가로 평가한 순자산 — 시세 기준이 섞인 구간의 변화를 같은 기준으로 비교할 때 사용 */
  costBasisTotal?: number;
};

export function computeAccountTimelineRows(params: {
  accounts: Account[];
  ledger: LedgerEntry[];
  trades: StockTrade[];
  /** USD 시세를 원화 환산해 둔 가격 목록 (buildAdjustedPrices 결과) */
  adjustedPrices: StockPrice[];
  fxRate: number | null;
  currentMonth: string;
  monthRange: string[];
  loans: Loan[];
  /** 일별 종가 — 지난 월말 보유 종목을 그날 시가로 평가. 없는 종목만 원가 대체(stockAtCost) */
  historicalDailyCloses?: HistoricalDailyClose[];
  /** 일별 환율 — 지난 월말 USD 종가·달러 현금 환산 (없으면 현재 환율) */
  fxHistory?: FxPoint[];
}): AccountTimelineRow[] {
  const { accounts, ledger, trades, adjustedPrices, fxRate, currentMonth, monthRange, loans } = params;
  const fxHistory = params.fxHistory ?? [];

  // 종가 인덱스: canonical ticker → 날짜 오름차순. 월은 오름차순으로 돌므로 포인터로 전진.
  const closesByTicker = new Map<string, HistoricalDailyClose[]>();
  for (const c of params.historicalDailyCloses ?? []) {
    const t = canonicalTickerForMatch(c.ticker);
    if (!t || !c.date || !(Number(c.close) > 0)) continue;
    const arr = closesByTicker.get(t);
    if (arr) arr.push(c);
    else closesByTicker.set(t, [c]);
  }
  for (const arr of closesByTicker.values()) arr.sort((a, b) => a.date.localeCompare(b.date));
  const closePtr = new Map<string, number>();

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
  const runningUsdByAccount = new Map<string, number>();
  // account.usdBalance는 모든 잔액모드 거래가 이미 반영된 '현재' 달러 보유량이다.
  // 타임라인은 과거부터 쌓아 올리므로, 전체 거래분을 빼서 '최초' 달러 보유량으로 되돌린 뒤 시작한다.
  // (monthRange는 장부·거래 첫 월부터 연속 생성되므로 모든 거래가 아래 루프에서 다시 더해진다.)
  const usdModeDeltaTotal = new Map<string, number>();
  for (const trade of trades) {
    const delta = usdBalanceModeDelta(trade);
    if (delta === 0) continue;
    usdModeDeltaTotal.set(trade.accountId, (usdModeDeltaTotal.get(trade.accountId) ?? 0) + delta);
  }
  accounts.forEach((account) => {
    const baseBalance =
      account.type === "securities" || account.type === "crypto"
        ? (account.initialCashBalance ?? account.initialBalance)
        : account.initialBalance;
    runningBalanceByAccount.set(
      account.id,
      baseBalance + (account.cashAdjustment ?? 0) + (account.savings ?? 0)
    );
    runningUsdByAccount.set(
      account.id,
      (account.usdBalance ?? 0) - (usdModeDeltaTotal.get(account.id) ?? 0)
    );
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
            runningUsdByAccount.set(
              entry.fromAccountId,
              (runningUsdByAccount.get(entry.fromAccountId) ?? 0) - entry.amount
            );
          }
          if (entry.toAccountId) {
            runningUsdByAccount.set(
              entry.toAccountId,
              (runningUsdByAccount.get(entry.toAccountId) ?? 0) + entry.amount
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
      // 원화 현금모드는 cashImpact로, 달러 잔액모드는 달러 증감으로 — 둘은 상호 배타적이라
      // 나란히 적용해도 이중 차감되지 않는다(잔액모드면 cashImpact=0, 현금모드면 델타=0).
      // computeAccountBalances가 통화 구분 없이 cashImpact를 전부 반영하는 것과 같은 기준.
      runningBalanceByAccount.set(
        trade.accountId,
        (runningBalanceByAccount.get(trade.accountId) ?? 0) + trade.cashImpact
      );
      const usdDelta = usdBalanceModeDelta(trade);
      if (usdDelta !== 0) {
        runningUsdByAccount.set(
          trade.accountId,
          (runningUsdByAccount.get(trade.accountId) ?? 0) + usdDelta
        );
      }
    }

    const monthEndDate = getMonthEndDate(month);
    const isCurrent = month === currentMonth;
    // 지난 월말은 그 시점 환율·종가로 — 현재 시세로 과거를 평가하거나(시세 기준 혼합) 원가로만 두면
    // 평가손익 전체가 "이번 달 변화"로 몰린다(전월 대비 ▼1,310만 같은 착시).
    const monthFx = isCurrent ? fxRate : (fxAsOf(fxHistory, monthEndDate, fxRate) ?? fxRate);
    const snapshotPrices = isCurrent
      ? adjustedPrices
      : adjustedPrices.filter((price) => !!price.updatedAt && price.updatedAt.slice(0, 10) <= monthEndDate);
    let monthPrices: StockPrice[] = snapshotPrices;
    if (!isCurrent && closesByTicker.size > 0) {
      const closePrices: StockPrice[] = [];
      const fromCloses = new Set<string>();
      for (const [ticker, arr] of closesByTicker) {
        let i = closePtr.get(ticker) ?? -1;
        while (i + 1 < arr.length && arr[i + 1].date <= monthEndDate) i += 1;
        closePtr.set(ticker, i);
        if (i < 0) continue;
        const c = arr[i];
        const usd = c.currency === "USD" || (c.currency !== "KRW" && isUSDStock(ticker));
        if (usd && !(monthFx && monthFx > 0)) continue;
        fromCloses.add(ticker);
        closePrices.push({ ticker, price: usd ? c.close * (monthFx as number) : c.close, currency: "KRW", updatedAt: c.date });
      }
      // 같은 종목은 그날 종가가 우선, 종가가 없는 종목만 시세 스냅샷을 쓴다
      monthPrices = [...closePrices, ...snapshotPrices.filter((p) => !fromCloses.has(canonicalTickerForMatch(p.ticker)))];
    }
    const pricedTickers = new Set<string>();
    for (const p of monthPrices) if (Number(p.price) > 0) pricedTickers.add(canonicalTickerForMatch(p.ticker));
    const monthPositions = computePositions(runningTrades, monthPrices, accounts, {
      fxRate: monthFx ?? undefined,
      priceFallback: "cost"
    });
    const stockByAccount = new Map<string, number>();
    let stockAtCost = 0;
    let stockMarketMinusCost = 0;
    monthPositions.forEach((position) => {
      const value = positionMarketValueKRW(position, monthFx);
      stockByAccount.set(position.accountId, (stockByAccount.get(position.accountId) ?? 0) + value);
      if (!(position.quantity > 0)) return;
      const usd = isUSDStock(position.ticker);
      const costKrw = position.totalBuyAmountKRW ?? (usd ? position.totalBuyAmount * (monthFx ?? 0) : position.totalBuyAmount);
      if (!pricedTickers.has(canonicalTickerForMatch(position.ticker))) stockAtCost += value;
      else stockMarketMinusCost += value - costKrw;
    });

    let totalStockValue = 0;
    let totalSavingsValue = 0;
    let totalValue = 0;
    let totalAssetValue = 0;
    let totalDebtValue = 0;
    let totalPensionValue = 0;
    const row: AccountTimelineRow = { month, stock: 0, savings: 0, asset: 0, debt: 0, total: 0, pension: 0, stockAtCost: 0, costBasisTotal: 0 };
    accounts.forEach((account) => {
      const cash = runningBalanceByAccount.get(account.id) ?? 0;
      const usdCash =
        account.type === "securities" || account.type === "crypto"
          ? (runningUsdByAccount.get(account.id) ?? 0)
          : 0;
      const usdToKrw = monthFx && usdCash !== 0 ? usdCash * monthFx : 0;
      const stock = stockByAccount.get(account.id) ?? 0;
      const debt = accountDebtOffset(account);
      const accountAsset = cash + usdToKrw + stock;
      const accountValue = accountAsset - debt;
      // 자산/부채 묶음은 계좌 순가치의 부호로 — computeBalanceSheet와 같은 규칙.
      // (예전엔 자산에 카드 음수 잔액이 섞이고 부채는 초기 account.debt만 세어 "자산 대비 부채 비율"이 두 기준을 섞었다.)
      if (accountValue >= 0) totalAssetValue += accountValue;
      else totalDebtValue -= accountValue;
      totalValue += accountValue;
      if (account.isPension) totalPensionValue += accountValue;

      if (account.type === "securities" || account.type === "crypto") {
        totalStockValue += stock;
      } else if (account.type === "savings") {
        totalSavingsValue += cash - debt;
      }
    });

    // 월말 시점 대출 잔금 차감 (원금 상환은 차감, 이자 상환은 잔금 불변)
    const monthLoanBalance = computeLoanBalanceAt(loans, ledger, monthEndDate);
    totalDebtValue += monthLoanBalance;
    totalValue -= monthLoanBalance;

    row.stock = totalStockValue;
    row.savings = totalSavingsValue;
    row.asset = totalAssetValue;
    row.debt = totalDebtValue;
    row.total = totalValue;
    row.pension = totalPensionValue;
    row.stockAtCost = stockAtCost;
    row.costBasisTotal = totalValue - stockMarketMinusCost;
    rows.push(row);
  });

  return rows;
}

/**
 * 순자산 "변화"(전월 대비·페이스·스파크라인)용 시계열 — 모든 점이 같은 평가 기준이어야 한다.
 * 지난 월말 중 원가 대체 비중(stockAtCost/stock)이 20%를 넘는 점이 있으면 시가 기준이 섞인 것이므로
 * 전 구간을 원가 기준(costBasisTotal, 평가손익 제외)으로 비교한다. 아니면 시가 기준(total).
 */
export function netWorthChangeSeries(rows: AccountTimelineRow[]): { series: { month: string; value: number }[]; basis: "market" | "cost" } {
  const mixed = rows.slice(0, -1).some((r) => r.stock > 0 && (r.stockAtCost ?? 0) / r.stock > 0.2);
  return {
    basis: mixed ? "cost" : "market",
    series: rows.map((r) => ({ month: r.month, value: mixed ? (r.costBasisTotal ?? r.total) : r.total })),
  };
}

/** USD 시세를 원화 환산한 가격 목록. fxRate 없으면 동일 참조 반환 (memo 계약 유지). */
export function buildAdjustedPrices(prices: StockPrice[], fxRate: number | null): StockPrice[] {
  if (!fxRate) return prices;
  return prices.map((p) =>
    p.currency === "USD" ? { ...p, price: p.price * fxRate, currency: "KRW" as const } : p
  );
}

/** 장부·거래 기록 첫 월부터 currentMonth까지의 연속 "YYYY-MM" 배열 (타임라인 X축). */
export function buildTimelineMonthRange(
  ledger: LedgerEntry[],
  trades: StockTrade[],
  currentMonth: string
): string[] {
  const monthSet = new Set<string>();
  ledger.forEach((l) => l.date && monthSet.add(l.date.slice(0, 7)));
  trades.forEach((t) => t.date && monthSet.add(t.date.slice(0, 7)));
  monthSet.add(currentMonth);
  const sorted = Array.from(monthSet).sort();
  if (sorted.length === 0) return [] as string[];
  return buildMonthRange(sorted[0], sorted[sorted.length - 1]);
}
