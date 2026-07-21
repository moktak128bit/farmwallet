/**
 * 월별 계좌 타임라인(주식/저축/자산/부채/순자산) 집계 — 순수 모듈 (React 의존 없음).
 * 대시보드 NetWorthTrendChart와 인사이트 자산 탭이 같은 숫자를 보도록 단일 소스로 둔다.
 * computeAccountTimelineRows 본문은 기존 대시보드 훅(useAccountTimelineRows)에서
 * 로직 수정 없이 이동 — 대시보드 숫자가 기준값이므로 본문을 변경하지 않는다.
 */
import type { Account, LedgerEntry, Loan, StockPrice, StockTrade } from "../types";
import { computeLoanBalanceAt, computePositions, positionMarketValueKRW } from "../calculations";
import { buildMonthRange, getMonthEndDate } from "./date";
import { usdBalanceModeDelta } from "./tradeCashImpact";

export type AccountTimelineRow = {
  month: string;
  stock: number;
  savings: number;
  asset: number;
  debt: number;
  total: number;
  /** 연금계좌(isPension)의 순기여분 합계 (자산−계좌부채). 순자산에서 '연금 제외' 보기에 사용. */
  pension: number;
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
}): AccountTimelineRow[] {
  const { accounts, ledger, trades, adjustedPrices, fxRate, currentMonth, monthRange, loans } = params;

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
    const monthPrices = adjustedPrices.filter((price) => {
      if (month === currentMonth) return true;
      if (!price.updatedAt) return false;
      return price.updatedAt.slice(0, 10) <= monthEndDate;
    });
    const monthPositions = computePositions(runningTrades, monthPrices, accounts, {
      fxRate: fxRate ?? undefined,
      priceFallback: "cost"
    });
    const stockByAccount = new Map<string, number>();
    monthPositions.forEach((position) => {
      stockByAccount.set(
        position.accountId,
        (stockByAccount.get(position.accountId) ?? 0) +
          positionMarketValueKRW(position, fxRate)
      );
    });

    let totalStockValue = 0;
    let totalSavingsValue = 0;
    let totalValue = 0;
    let totalAssetValue = 0;
    let totalDebtValue = 0;
    let totalPensionValue = 0;
    const row: AccountTimelineRow = { month, stock: 0, savings: 0, asset: 0, debt: 0, total: 0, pension: 0 };
    accounts.forEach((account) => {
      const cash = runningBalanceByAccount.get(account.id) ?? 0;
      const usdCash =
        account.type === "securities" || account.type === "crypto"
          ? (runningUsdByAccount.get(account.id) ?? 0)
          : 0;
      const usdToKrw = fxRate && usdCash !== 0 ? usdCash * fxRate : 0;
      const stock = stockByAccount.get(account.id) ?? 0;
      const debt = Math.abs(account.debt ?? 0);
      const accountAsset = cash + usdToKrw + stock;
      const accountValue = accountAsset - debt;
      totalAssetValue += accountAsset;
      totalDebtValue += debt;
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
    rows.push(row);
  });

  return rows;
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
