import type {
  Account,
  AccountBalanceRow,
  LedgerEntry,
  PositionRow,
  StockPrice,
  StockTrade
} from "./types";
import { isKRWStock, isUSDStock, canonicalTickerForMatch } from "./utils/finance";

// Re-export calculation result types from single source (types.ts)
export type { AccountBalanceRow, PositionRow } from "./types";

// ---------------------------------------------------------------------------
// Helpers (pure, used only inside this module)
// ---------------------------------------------------------------------------

function sumAmount(entries: { amount: number }[]): number {
  return entries.reduce((s, e) => s + e.amount, 0);
}

function isUsdEntry(l: LedgerEntry): boolean {
  return l.currency === "USD";
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

/** 매도 건별 FIFO 실현손익 상세: 실현손익, 매수원가(평균단가×수량), 수량 (동일 통화) */
export type RealizedPnlDetail = { pnl: number; costBasis: number; quantity: number };

function fifoRealizedPnlDetailBySell(
  sortedTrades: StockTrade[],
  toKrw?: (amount: number) => number
): Map<string, RealizedPnlDetail> {
  type Lot = { qty: number; totalAmount: number };
  const result = new Map<string, RealizedPnlDetail>();
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
        const unitCost = lot.totalAmount / lot.qty;
        const cost = unitCost * use;
        costBasis += cost;
        remaining -= use;
        lot.qty -= use;
        lot.totalAmount = unitCost * lot.qty;
        if (lot.qty <= 0) queue.shift();
      }
      const realizedPnl = t.totalAmount - costBasis;
      result.set(t.id, {
        pnl: convert(realizedPnl),
        costBasis: convert(costBasis),
        quantity: t.quantity
      });
    }
  }
  return result;
}

/** FIFO로 매도 건별 실현손익 계산. 반환: 매도 거래 id -> 실현손익 (동일 통화) */
function fifoRealizedPnlBySell(
  sortedTrades: StockTrade[],
  toKrw?: (amount: number) => number
): Map<string, number> {
  const detail = fifoRealizedPnlDetailBySell(sortedTrades, toKrw);
  const result = new Map<string, number>();
  detail.forEach((d, id) => result.set(id, d.pnl));
  return result;
}

// ---------------------------------------------------------------------------
// computeAccountBalances
// 규칙: 수입·지출·저축성지출·이체(KRW/USD 구분)·주식 매수/매도(cashImpact 합계)·초기잔액·cashAdjustment·savings → currentBalance. 증권계좌 포함 모든 계좌에 tradeCashImpact 반영.
// 최적화: ledger/trades 1회 순회 후 Map으로 O(1) 조회
// ---------------------------------------------------------------------------

function buildLedgerIndex(
  ledger: LedgerEntry[]
): {
  incomeByTo: Map<string, number>;
  expenseByFrom: Map<string, number>;
  expenseByTo: Map<string, number>;
  transferOutKrw: Map<string, number>;
  transferInKrw: Map<string, number>;
  transferOutUsd: Map<string, number>;
  transferInUsd: Map<string, number>;
} {
  const incomeByTo = new Map<string, number>();
  const expenseByFrom = new Map<string, number>();
  const expenseByTo = new Map<string, number>();
  const transferOutKrw = new Map<string, number>();
  const transferInKrw = new Map<string, number>();
  const transferOutUsd = new Map<string, number>();
  const transferInUsd = new Map<string, number>();

  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

  for (const l of ledger) {
    if (l.kind === "income" && l.toAccountId) add(incomeByTo, l.toAccountId, l.amount);
    else if (l.kind === "expense") {
      if (l.fromAccountId) add(expenseByFrom, l.fromAccountId, l.amount);
      if (l.toAccountId) add(expenseByTo, l.toAccountId, l.amount);
    } else if (l.kind === "transfer") {
      const isUsd = isUsdEntry(l);
      if (l.fromAccountId) add(isUsd ? transferOutUsd : transferOutKrw, l.fromAccountId, l.amount);
      if (l.toAccountId) add(isUsd ? transferInUsd : transferInKrw, l.toAccountId, l.amount);
    }
  }

  return {
    incomeByTo,
    expenseByFrom,
    expenseByTo,
    transferOutKrw,
    transferInKrw,
    transferOutUsd,
    transferInUsd
  };
}

export function computeAccountBalances(
  accounts: Account[],
  ledger: LedgerEntry[],
  trades: StockTrade[]
): AccountBalanceRow[] {
  const idx = buildLedgerIndex(ledger);
  const tradeCashByAccount = new Map<string, number>();
  for (const t of trades) {
    if (!t?.accountId) continue;
    const impact = Number(t.cashImpact);
    const add = Number.isFinite(impact) ? impact : 0;
    tradeCashByAccount.set(t.accountId, (tradeCashByAccount.get(t.accountId) ?? 0) + add);
  }

  return accounts.map((account) => {
    const incomeSum = idx.incomeByTo.get(account.id) ?? 0;
    const expenseSum = idx.expenseByFrom.get(account.id) ?? 0;
    const savingsExpenseIn = idx.expenseByTo.get(account.id) ?? 0;

    const transferOutKrw = idx.transferOutKrw.get(account.id) ?? 0;
    const transferInKrw = idx.transferInKrw.get(account.id) ?? 0;
    const transferNet = transferInKrw - transferOutKrw;

    const usdTransferOut = idx.transferOutUsd.get(account.id) ?? 0;
    const usdTransferIn = idx.transferInUsd.get(account.id) ?? 0;
    const usdTransferNet = usdTransferIn - usdTransferOut;

    const tradeCashImpact = tradeCashByAccount.get(account.id) ?? 0;

    const baseBalance =
      account.type === "securities" || account.type === "crypto"
        ? (account.initialCashBalance ?? account.initialBalance)
        : account.initialBalance;
    const cashAdjustment = account.cashAdjustment ?? 0;
    const savings = account.savings ?? 0;

    const currentBalance =
      baseBalance +
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
  options?: { fxRate?: number; priceFallback?: "zero" | "cost" }
): PositionRow[] {
  let tradesSorted = trades;
  for (let i = 1; i < trades.length; i += 1) {
    const prev = trades[i - 1];
    const curr = trades[i];
    if (prev.date > curr.date || (prev.date === curr.date && prev.id > curr.id)) {
      tradesSorted = [...trades].sort((a, b) => {
        if (a.date === b.date) return a.id.localeCompare(b.id);
        return a.date.localeCompare(b.date);
      });
      break;
    }
  }

  const byKey = groupTradesByAccountTicker(tradesSorted);
  const accountNameById = new Map(
    accounts.map((account) => [account.id, account.name ?? account.id])
  );
  const latestPriceByTicker = new Map<string, StockPrice>();
  for (const price of prices) {
    const tickerNorm = canonicalTickerForMatch(price.ticker);
    if (!tickerNorm) continue;
    const prev = latestPriceByTicker.get(tickerNorm);
    if (!prev) {
      latestPriceByTicker.set(tickerNorm, price);
      continue;
    }
    const prevUpdated = prev.updatedAt ?? "";
    const nextUpdated = price.updatedAt ?? "";
    if (nextUpdated >= prevUpdated) {
      latestPriceByTicker.set(tickerNorm, price);
    }
  }

  const rows: PositionRow[] = [];

  const currentFx = options?.fxRate ?? undefined;
  const isUsdTicker = (ticker: string) => isUSDStock(ticker);

  for (const [key, ts] of byKey.entries()) {
    const [accountId, tickerNorm] = key.split("::");
    const accountName = accountNameById.get(accountId) ?? accountId;

    // Keep unrealized basis consistent with FIFO realized PnL calculation.
    // USD 종목: lot에 매입 당시 환율 저장 → 매입가 원화 = sum(달러 × 당시 환율)
    type Lot = { qty: number; totalAmount: number; fxRateAtTrade?: number };
    const queue: Lot[] = [];
    for (const t of ts) {
      if (t.side === "buy") {
        queue.push({
          qty: t.quantity,
          totalAmount: t.totalAmount,
          fxRateAtTrade: t.fxRateAtTrade
        });
        continue;
      }
      let remaining = t.quantity;
      while (remaining > 0 && queue.length > 0) {
        const lot = queue[0];
        const use = Math.min(remaining, lot.qty);
        const unitCost = lot.totalAmount / lot.qty;
        lot.qty -= use;
        lot.totalAmount = unitCost * lot.qty;
        remaining -= use;
        if (lot.qty <= 0) queue.shift();
      }
    }
    const quantity = queue.reduce((s, lot) => s + lot.qty, 0);
    if (quantity <= 0) continue;
    const remainingCostBasis = queue.reduce((s, lot) => s + lot.totalAmount, 0);
    const avgPrice = quantity > 0 ? remainingCostBasis / quantity : 0;
    // USD 종목: 매입가 원화 = 잔여 매입 달러 × 매입 당시 환율 (없으면 현재 환율)
    const remainingCostBasisKRW =
      isUsdTicker(tickerNorm) && quantity > 0 && currentFx != null
        ? queue.reduce(
            (s, lot) =>
              s + lot.totalAmount * (lot.fxRateAtTrade ?? currentFx),
            0
          )
        : undefined;

    const priceInfo = latestPriceByTicker.get(tickerNorm);
    const hasMarketPrice =
      typeof priceInfo?.price === "number" && Number.isFinite(priceInfo.price);
    const marketPrice = hasMarketPrice
      ? (priceInfo?.price ?? 0)
      : options?.priceFallback === "cost"
        ? avgPrice
        : 0;
    // 시세 API에 currency가 없을 때 티커 규칙으로 보완 (미국 주식이 원화로 잘못 합산되는 것 방지)
    const marketCurrency: "KRW" | "USD" | undefined =
      priceInfo?.currency === "USD"
        ? "USD"
        : priceInfo?.currency === "KRW"
          ? "KRW"
          : isUsdTicker(tickerNorm)
            ? "USD"
            : isKRWStock(tickerNorm)
              ? "KRW"
              : undefined;
    const firstTrade = ts[0];
    // 포지션 티커는 항상 tickerNorm(대문자 정규형)만 사용 — prices에 'bitx'로 들어 있어도 표시는 'BITX'
    const rowTicker = tickerNorm;
    const name = priceInfo?.name ?? firstTrade?.name ?? rowTicker;

    const marketValue = marketPrice * quantity;
    const pnl = marketValue - remainingCostBasis;
    const pnlRate = remainingCostBasis > 0 ? pnl / remainingCostBasis : 0;

    rows.push({
      accountId,
      accountName,
      ticker: rowTicker,
      name,
      quantity,
      avgPrice,
      totalBuyAmount: remainingCostBasis,
      totalBuyAmountKRW: remainingCostBasisKRW,
      marketPrice,
      marketValue,
      marketCurrency,
      pnl,
      pnlRate
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// computeRealizedPnlByTradeId / computeRealizedPnlDetailByTradeId
// 규칙: 매도 건별 FIFO 실현손익 (동일 통화). Detail은 평균단가 대비 수익률 표시용.
// ---------------------------------------------------------------------------

export function computeRealizedPnlByTradeId(
  trades: StockTrade[]
): Map<string, number> {
  const byKey = groupTradesByAccountTicker(trades);
  const result = new Map<string, number>();

  for (const [, list] of byKey.entries()) {
    const sorted = [...list].sort((a, b) => {
      const d = a.date.localeCompare(b.date);
      if (d !== 0) return d;
      // 같은 날짜: 매수 먼저, 매도 나중에 (FIFO 올바른 계산을 위해)
      if (a.side === "buy" && b.side === "sell") return -1;
      if (a.side === "sell" && b.side === "buy") return 1;
      return 0;
    });
    const bySell = fifoRealizedPnlBySell(sorted);
    bySell.forEach((pnl, id) => result.set(id, pnl));
  }

  return result;
}

/** 매도 건별 실현손익 + 매수원가(평균단가×수량) + 수량. 평균단가 = costBasis/quantity, 수익률 = pnl/costBasis */
export function computeRealizedPnlDetailByTradeId(
  trades: StockTrade[]
): Map<string, RealizedPnlDetail> {
  const byKey = groupTradesByAccountTicker(trades);
  const result = new Map<string, RealizedPnlDetail>();

  for (const [, list] of byKey.entries()) {
    const sorted = [...list].sort((a, b) => {
      const d = a.date.localeCompare(b.date);
      if (d !== 0) return d;
      if (a.side === "buy" && b.side === "sell") return -1;
      if (a.side === "sell" && b.side === "buy") return 1;
      return 0;
    });
    const bySell = fifoRealizedPnlDetailBySell(sorted);
    bySell.forEach((detail, id) => result.set(id, detail));
  }

  return result;
}

// ---------------------------------------------------------------------------
// Dashboard / UI aggregation (no inline reduce in views)
// ---------------------------------------------------------------------------

export type AccountBalanceRowLike = { account: Account; currentBalance: number; usdTransferNet?: number };
export type PositionRowLike = {
  accountId: string;
  marketValue: number;
  totalBuyAmount?: number;
  pnl?: number;
  marketCurrency?: "KRW" | "USD";
  ticker?: string;
};

/** 포지션 평가액을 원화로 환산 (순자산·계좌 합계용). currency 누락 시 티커로 USD 여부 추정. */
export function positionMarketValueKRW(
  p: Pick<PositionRow, "marketValue" | "marketCurrency"> & { ticker?: string },
  fxRate?: number | null
): number {
  const rate = fxRate ?? 0;
  const isUsd =
    p.marketCurrency === "USD" ||
    (p.marketCurrency !== "KRW" && Boolean(p.ticker && isUSDStock(p.ticker)));
  if (isUsd) return rate > 0 ? p.marketValue * rate : 0;
  return p.marketValue;
}

/** 전체 순자산: 현금(KRW+USD환산) + 주식 평가액 + 부채(음수) */
export function computeTotalNetWorth(
  balances: AccountBalanceRowLike[],
  positions: PositionRowLike[],
  fxRate?: number | null
): number {
  const stockMap = new Map<string, number>();
  positions.forEach((p) => {
    stockMap.set(p.accountId, (stockMap.get(p.accountId) ?? 0) + positionMarketValueKRW(p, fxRate));
  });
  return balances.reduce((sum, row) => {
    const krwCash = row.currentBalance;
    const stockAsset = stockMap.get(row.account.id) ?? 0;
    const debt = Math.abs(row.account.debt ?? 0);
    const usdCash =
      row.account.type === "securities" || row.account.type === "crypto"
        ? (row.account.usdBalance ?? 0) + (row.usdTransferNet ?? 0)
        : 0;
    const usdToKrw = fxRate && usdCash !== 0 ? usdCash * fxRate : 0;
    return sum + krwCash + usdToKrw + stockAsset - debt;
  }, 0);
}



/** 특정 일자·계좌 집합 기준 잔액: 현금 + 주식평가액 + USD환산 (저축·증권 합계용) */
export function computeBalanceAtDateForAccounts(
  accounts: Account[],
  ledger: LedgerEntry[],
  trades: StockTrade[],
  dateStr: string,
  accountIds: Set<string>,
  prices: StockPrice[],
  options?: { fxRate?: number | null; priceFallback?: "cost" | "zero" }
): number {
  const filteredLedger = ledger.filter((l) => l.date && l.date <= dateStr);
  const filteredTrades = trades.filter((t) => t.date && t.date <= dateStr);
  const bal = computeAccountBalances(accounts, filteredLedger, filteredTrades);
  const pos = computePositions(filteredTrades, prices, accounts, {
    fxRate: options?.fxRate ?? undefined,
    priceFallback: options?.priceFallback
  });
  const stockMap = new Map<string, number>();
  const fxRate = options?.fxRate;
  pos.forEach((p) => {
    if (!accountIds.has(p.accountId)) return;
    stockMap.set(
      p.accountId,
      (stockMap.get(p.accountId) ?? 0) + positionMarketValueKRW(p, fxRate)
    );
  });
  return bal.reduce((sum, row) => {
    if (!accountIds.has(row.account.id)) return sum;
    const cash = row.currentBalance;
    const stock = stockMap.get(row.account.id) ?? 0;
    const usd =
      row.account.type === "securities" || row.account.type === "crypto"
        ? (row.account.usdBalance ?? 0) + (row.usdTransferNet ?? 0)
        : 0;
    const usdKrw = fxRate && usd ? usd * fxRate : 0;
    return sum + cash + usdKrw + stock;
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

/** 부채 합계 (음수=부채, 양수=선결제/환급) */
export function computeTotalDebt(accounts: Account[]): number {
  return -accounts.reduce((s, a) => s + Math.abs(a.debt ?? 0), 0);
}



