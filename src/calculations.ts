import type {
  Account,
  LedgerEntry,
  StockPrice,
  StockTrade
} from "./types";
import { isUSDStock, canonicalTickerForMatch } from "./utils/finance";

// ---------------------------------------------------------------------------
// Types (unchanged for callers)
// ---------------------------------------------------------------------------

export interface AccountBalanceRow {
  account: Account;
  incomeSum: number;
  expenseSum: number;
  transferNet: number;
  /** 이체로 인한 USD 순증액 (증권계좌 전용, currency=USD인 ledger 반영) */
  usdTransferNet: number;
  tradeCashImpact: number;
  currentBalance: number;
}

export interface PositionRow {
  accountId: string;
  accountName: string;
  ticker: string;
  name: string;
  quantity: number;
  avgPrice: number;
  totalBuyAmount: number;
  marketPrice: number;
  marketValue: number;
  pnl: number;
  pnlRate: number;
}

export interface MonthlyNetWorthRow {
  month: string; // yyyy-mm
  netWorth: number;
}

// ---------------------------------------------------------------------------
// Helpers (pure, used only inside this module)
// ---------------------------------------------------------------------------

function sumAmount(entries: { amount: number }[]): number {
  return entries.reduce((s, e) => s + e.amount, 0);
}

function isUsdEntry(l: LedgerEntry): boolean {
  return l.currency === "USD";
}

/** 이체 제외: 신용카드·카드대금 이체는 잔액 계산에서 제외 */
function isCardPaymentTransfer(l: LedgerEntry): boolean {
  return l.category === "신용카드" && l.subCategory === "카드대금";
}

/** 계좌·티커별 거래 그룹화 키 */
function tradeGroupKey(accountId: string, ticker: string): string {
  const norm = canonicalTickerForMatch(ticker);
  return norm ? `${accountId}::${norm}` : "";
}

function groupTradesByAccountTicker(
  trades: StockTrade[],
  accountFilter?: (id: string) => boolean
): Map<string, StockTrade[]> {
  const map = new Map<string, StockTrade[]>();
  for (const t of trades) {
    if (accountFilter && !accountFilter(t.accountId)) continue;
    const key = tradeGroupKey(t.accountId, t.ticker);
    if (!key) continue;
    const list = map.get(key) ?? [];
    list.push(t);
    map.set(key, list);
  }
  return map;
}

/** FIFO로 매도 건별 실현손익 계산. 반환: 매도 거래 id -> 실현손익 (동일 통화) */
function fifoRealizedPnlBySell(
  sortedTrades: StockTrade[],
  toKrw?: (amount: number) => number
): Map<string, number> {
  type Lot = { qty: number; totalAmount: number };
  const result = new Map<string, number>();
  const queue: Lot[] = [];
  const convert = toKrw ?? ((x: number) => x);

  for (const t of sortedTrades) {
    if (t.side === "buy") {
      queue.push({ qty: t.quantity, totalAmount: t.totalAmount });
    } else {
      let remaining = t.quantity;
      let costBasis = 0;
      while (remaining > 0 && queue.length > 0) {
        const lot = queue[0];
        const use = Math.min(remaining, lot.qty);
        const cost = (lot.totalAmount / lot.qty) * use;
        costBasis += cost;
        remaining -= use;
        lot.qty -= use;
        lot.totalAmount -= cost;
        if (lot.qty <= 0) queue.shift();
      }
      const realizedPnl = t.totalAmount - costBasis;
      result.set(t.id, convert(realizedPnl));
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// computeAccountBalances
// 규칙: 수입(toAccountId)·지출(fromAccountId)·저축성지출(toAccountId)·이체(KRW/USD 구분)·주식 cashImpact·초기잔액·initialHoldings·cashAdjustment·savings → currentBalance
// ---------------------------------------------------------------------------

export function computeAccountBalances(
  accounts: Account[],
  ledger: LedgerEntry[],
  trades: StockTrade[]
): AccountBalanceRow[] {
  return accounts.map((account) => {
    const incomeSum = sumAmount(
      ledger.filter((l) => l.kind === "income" && l.toAccountId === account.id)
    );
    const expenseSum = sumAmount(
      ledger.filter((l) => l.kind === "expense" && l.fromAccountId === account.id)
    );
    const savingsExpenseIn = sumAmount(
      ledger.filter((l) => l.kind === "expense" && l.toAccountId === account.id)
    );

    const transferOutEntries = ledger.filter(
      (l) =>
        l.kind === "transfer" &&
        l.fromAccountId === account.id &&
        !isCardPaymentTransfer(l)
    );
    const transferInEntries = ledger.filter(
      (l) =>
        l.kind === "transfer" &&
        l.toAccountId === account.id &&
        !isCardPaymentTransfer(l)
    );

    const transferOutKrw = sumAmount(transferOutEntries.filter((l) => !isUsdEntry(l)));
    const transferInKrw = sumAmount(transferInEntries.filter((l) => !isUsdEntry(l)));
    const transferNet = transferInKrw - transferOutKrw;

    const usdTransferOut = sumAmount(transferOutEntries.filter(isUsdEntry));
    const usdTransferIn = sumAmount(transferInEntries.filter(isUsdEntry));
    const usdTransferNet = usdTransferIn - usdTransferOut;

    const accountTrades = trades.filter((t) => t.accountId === account.id);
    const tradeCashImpact = accountTrades.reduce((s, t) => {
      if (account.type === "securities" && isUSDStock(t.ticker)) return s;
      return s + t.cashImpact;
    }, 0);

    const initialHoldingsAmount = accountTrades
      .filter((t) => t.cashImpact === 0 && t.side === "buy")
      .reduce((s, t) => s + t.totalAmount, 0);

    const baseBalance =
      account.type === "securities"
        ? (account.initialCashBalance ?? account.initialBalance)
        : account.initialBalance;
    const cashAdjustment = account.cashAdjustment ?? 0;
    const savings = account.savings ?? 0;

    const currentBalance =
      baseBalance +
      initialHoldingsAmount +
      incomeSum -
      expenseSum +
      savingsExpenseIn +
      transferNet +
      tradeCashImpact +
      cashAdjustment +
      savings;

    return {
      account,
      incomeSum,
      expenseSum,
      transferNet,
      usdTransferNet,
      tradeCashImpact,
      currentBalance
    };
  });
}

// ---------------------------------------------------------------------------
// computePositions
// 규칙: 계좌·티커별 그룹 → 수량·순매입금액·평가금액·pnl·pnlRate, USD는 fxRate 원화 환산
// ---------------------------------------------------------------------------

export function computePositions(
  trades: StockTrade[],
  prices: StockPrice[],
  accounts: Account[],
  options?: { fxRate?: number }
): PositionRow[] {
  const byKey = groupTradesByAccountTicker(trades);
  const fxRate = options?.fxRate;
  const rows: PositionRow[] = [];

  for (const [key, ts] of byKey.entries()) {
    const [accountId, tickerNorm] = key.split("::");
    const account = accounts.find((a) => a.id === accountId);
    const accountName = account?.name ?? account?.id ?? accountId;

    const buys = ts.filter((t) => t.side === "buy");
    const sells = ts.filter((t) => t.side === "sell");
    const buyQty = buys.reduce((s, t) => s + t.quantity, 0);
    const sellQty = sells.reduce((s, t) => s + t.quantity, 0);
    const quantity = buyQty - sellQty;

    if (quantity <= 0) continue;

    const totalBuyAmount = buys.reduce((s, t) => s + t.totalAmount, 0);
    const totalSellAmount = sells.reduce((s, t) => s + t.totalAmount, 0);
    const netBuyAmountRaw = totalBuyAmount - totalSellAmount;

    const priceInfo = prices.find(
      (p) => canonicalTickerForMatch(p.ticker) === tickerNorm
    );
    const marketPrice = priceInfo?.price ?? 0;
    const canonicalTicker = priceInfo?.ticker ?? ts[0]?.ticker ?? tickerNorm;
    const name = priceInfo?.name ?? ts[0]?.name ?? canonicalTicker;

    const isUSD =
      (account?.currency === "USD" || isUSDStock(canonicalTicker)) &&
      fxRate != null &&
      fxRate > 0;
    const netBuyAmount = isUSD ? netBuyAmountRaw * fxRate! : netBuyAmountRaw;

    const marketValue = marketPrice * quantity;
    const pnl = marketValue - netBuyAmount;
    const pnlRate = netBuyAmount > 0 ? pnl / netBuyAmount : 0;
    const avgPrice = quantity > 0 ? netBuyAmount / quantity : 0;

    rows.push({
      accountId,
      accountName,
      ticker: canonicalTicker,
      name,
      quantity,
      avgPrice,
      totalBuyAmount: netBuyAmount,
      marketPrice,
      marketValue,
      pnl,
      pnlRate
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// computeRealizedGainInPeriod
// 규칙: FIFO 매도 실현손익, 기간 내 매도만 합산, USD 계좌는 fxRate 원화
// ---------------------------------------------------------------------------

export function computeRealizedGainInPeriod(
  trades: StockTrade[],
  startDate: string,
  endDate: string,
  accountIds: Set<string>,
  options?: { accounts: Account[]; fxRate?: number }
): number {
  const byKey = groupTradesByAccountTicker(trades, (id) => accountIds.has(id));
  let totalGain = 0;

  for (const [, list] of byKey.entries()) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const account = options?.accounts?.find((a) => a.id === list[0].accountId);
    const isUsd = account?.currency === "USD" && options?.fxRate;
    const toKrw = (x: number) => (isUsd ? x * options!.fxRate! : x);

    const bySell = fifoRealizedPnlBySell(sorted, toKrw);
    for (const t of sorted) {
      if (t.side !== "sell") continue;
      if (t.date >= startDate && t.date <= endDate) {
        totalGain += bySell.get(t.id) ?? 0;
      }
    }
  }

  return totalGain;
}

// ---------------------------------------------------------------------------
// computeRealizedPnlByTradeId
// 규칙: 매도 건별 FIFO 실현손익 (동일 통화)
// ---------------------------------------------------------------------------

export function computeRealizedPnlByTradeId(
  trades: StockTrade[]
): Map<string, number> {
  const byKey = groupTradesByAccountTicker(trades);
  const result = new Map<string, number>();

  for (const [, list] of byKey.entries()) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const bySell = fifoRealizedPnlBySell(sorted);
    bySell.forEach((pnl, id) => result.set(id, pnl));
  }

  return result;
}

/**
 * 특정 월·카테고리(선택) 기준 지출 합계.
 * 예산 모니터 등에서 사용.
 */
export function computeExpenseSumForMonthAndCategory(
  ledger: LedgerEntry[],
  month: string,
  category?: string
): number {
  return ledger
    .filter((l) => l.kind === "expense" && l.date.startsWith(month))
    .filter((l) => {
      if (category == null) return true;
      return l.category === category || l.subCategory === category;
    })
    .reduce((s, l) => s + l.amount, 0);
}

// ---------------------------------------------------------------------------
// computeMonthlyNetWorth
// 규칙: 월별로 ledger/trades 자르고 computeAccountBalances 잔액 합계 → netWorth
// 주의: 주식 미포함. 현금·저축·증권계좌 KRW 잔액만 합산 (현금성 자산만)
// ---------------------------------------------------------------------------

export function computeMonthlyNetWorth(
  accounts: Account[],
  ledger: LedgerEntry[],
  trades: StockTrade[]
): MonthlyNetWorthRow[] {
  const monthSet = new Set<string>();
  ledger.forEach((l) => l.date && monthSet.add(l.date.slice(0, 7)));
  trades.forEach((t) => t.date && monthSet.add(t.date.slice(0, 7)));
  const months = Array.from(monthSet).sort();
  if (months.length === 0) return [];

  return months.map((month) => {
    const filteredLedger = ledger.filter((l) => l.date.slice(0, 7) <= month);
    const filteredTrades = trades.filter((t) => t.date.slice(0, 7) <= month);
    const balances = computeAccountBalances(
      accounts,
      filteredLedger,
      filteredTrades
    );
    const netWorth = balances.reduce((sum, b) => sum + b.currentBalance, 0);
    return { month, netWorth };
  });
}

// ---------------------------------------------------------------------------
// Dashboard / UI aggregation (no inline reduce in views)
// ---------------------------------------------------------------------------

export type AccountBalanceRowLike = { account: Account; currentBalance: number; usdTransferNet?: number };
export type PositionRowLike = { accountId: string; marketValue: number; totalBuyAmount?: number; pnl?: number };

/** 전체 순자산: 현금(KRW+USD환산) + 주식 평가액 - 부채 */
export function computeTotalNetWorth(
  balances: AccountBalanceRowLike[],
  positions: PositionRowLike[],
  fxRate?: number | null
): number {
  const stockMap = new Map<string, number>();
  positions.forEach((p) => {
    stockMap.set(p.accountId, (stockMap.get(p.accountId) ?? 0) + p.marketValue);
  });
  return balances.reduce((sum, row) => {
    const krwCash = row.currentBalance;
    const stockAsset = stockMap.get(row.account.id) ?? 0;
    const debt = row.account.debt ?? 0;
    const usdCash =
      row.account.type === "securities"
        ? (row.account.usdBalance ?? 0) + (row.usdTransferNet ?? 0)
        : 0;
    const usdToKrw = fxRate && usdCash !== 0 ? usdCash * fxRate : 0;
    return sum + krwCash + usdToKrw + stockAsset - debt;
  }, 0);
}

export function computeTotalStockPnl(positions: PositionRowLike[]): number {
  return positions.reduce((s, p) => s + (p.pnl ?? 0), 0);
}

export function computeTotalStockValue(positions: PositionRowLike[]): number {
  return positions.reduce((s, p) => s + p.marketValue, 0);
}

/** 누적 실현손익 원화: 매도 건별 FIFO 실현손익 합계, USD 계좌는 fxRate 환산 */
export function computeTotalRealizedPnlKRW(
  trades: StockTrade[],
  accounts: Account[],
  fxRate?: number | null
): number {
  const byId = computeRealizedPnlByTradeId(trades);
  let krw = 0;
  trades.forEach((t) => {
    if (t.side !== "sell") return;
    const pnl = byId.get(t.id) ?? 0;
    const account = accounts.find((a) => a.id === t.accountId);
    if (account?.currency === "USD" && fxRate) krw += pnl * fxRate;
    else if (isUSDStock(t.ticker) && fxRate) krw += pnl * fxRate;
    else krw += pnl;
  });
  return krw;
}

/** 특정 일자·계좌 집합 기준 잔액: 현금 + 주식평가액 + USD환산 (저축·증권 합계용) */
export function computeBalanceAtDateForAccounts(
  accounts: Account[],
  ledger: LedgerEntry[],
  trades: StockTrade[],
  dateStr: string,
  accountIds: Set<string>,
  prices: StockPrice[],
  options?: { fxRate?: number | null }
): number {
  const filteredLedger = ledger.filter((l) => l.date && l.date <= dateStr);
  const filteredTrades = trades.filter((t) => t.date && t.date <= dateStr);
  const bal = computeAccountBalances(accounts, filteredLedger, filteredTrades);
  const pos = computePositions(filteredTrades, prices, accounts, {
    fxRate: options?.fxRate ?? undefined
  });
  const stockMap = new Map<string, number>();
  pos.forEach((p) => {
    if (!accountIds.has(p.accountId)) return;
    stockMap.set(p.accountId, (stockMap.get(p.accountId) ?? 0) + p.marketValue);
  });
  const fxRate = options?.fxRate;
  return bal.reduce((sum, row) => {
    if (!accountIds.has(row.account.id)) return sum;
    const cash = row.currentBalance;
    const stock = stockMap.get(row.account.id) ?? 0;
    const usd =
      row.account.type === "securities"
        ? (row.account.usdBalance ?? 0) + (row.usdTransferNet ?? 0)
        : 0;
    const usdKrw = fxRate && usd ? usd * fxRate : 0;
    return sum + cash + usdKrw + stock;
  }, 0);
}

/** 특정 일자·계좌 집합 기준 보유 포지션 매입원가 합계 */
export function computeCostBasisAtDateForAccounts(
  trades: StockTrade[],
  dateStr: string,
  accountIds: Set<string>,
  prices: StockPrice[],
  accounts: Account[],
  options?: { fxRate?: number | null }
): number {
  const filteredTrades = trades.filter((t) => t.date && t.date <= dateStr);
  const pos = computePositions(filteredTrades, prices, accounts, {
    fxRate: options?.fxRate ?? undefined
  });
  return pos
    .filter((p) => accountIds.has(p.accountId))
    .reduce((sum, p) => sum + (p.totalBuyAmount ?? 0), 0);
}

/** 현금 잔액 합계: 입출금/증권/기타 계좌, 증권 USD는 fxRate 환산. currentBalance 그대로 사용 (account.savings 차감 없음) */
export function computeTotalCashValue(
  balances: AccountBalanceRowLike[],
  fxRate?: number | null
): number {
  return balances
    .filter(
      (b) =>
        b.account.type === "checking" ||
        b.account.type === "securities" ||
        b.account.type === "other"
    )
    .reduce((s, b) => {
      const krw = b.currentBalance;
      const usd =
        b.account.type === "securities"
          ? (b.account.usdBalance ?? 0) + (b.usdTransferNet ?? 0)
          : 0;
      return s + krw + (fxRate && usd ? usd * fxRate : 0);
    }, 0);
}

/** 저축 합계: savings 타입 계좌 잔액만 (account.savings는 currentBalance에 이미 포함되어 있어 별도 합산 시 이중 집계됨) */
export function computeTotalSavings(
  balances: AccountBalanceRowLike[],
  _accounts: Account[]
): number {
  return balances
    .filter((b) => b.account.type === "savings")
    .reduce((s, b) => s + b.currentBalance, 0);
}

/** 부채 합계 */
export function computeTotalDebt(accounts: Account[]): number {
  return accounts.reduce((s, a) => s + (a.debt ?? 0), 0);
}
