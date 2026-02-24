import type { Account, LedgerEntry, StockPrice, StockTrade } from "./types";
import { isUSDStock, canonicalTickerForMatch } from "./utils/tickerUtils";

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

export function computeAccountBalances(
  accounts: Account[],
  ledger: LedgerEntry[],
  trades: StockTrade[]
): AccountBalanceRow[] {
  return accounts.map((account) => {
    // 수입: toAccountId가 이 계좌인 항목들의 합계
    const incomeEntries = ledger.filter((l) => l.kind === "income" && l.toAccountId === account.id);
    const incomeSum = incomeEntries.reduce((s, l) => s + l.amount, 0);
    // 지출: fromAccountId가 이 계좌인 항목들의 합계
    const expenseEntries = ledger.filter((l) => l.kind === "expense" && l.fromAccountId === account.id);
    const expenseSum = expenseEntries.reduce((s, l) => s + l.amount, 0);
    // 저축·재테크(expense+toAccountId)로 이 계좌에 들어온 금액
    const savingsExpenseInEntries = ledger.filter((l) => l.kind === "expense" && l.toAccountId === account.id);
    const savingsExpenseIn = savingsExpenseInEntries.reduce((s, l) => s + l.amount, 0);
    // 이체: transfer 종류의 거래에서 이 계좌로 들어온 금액과 나간 금액
    // KRW 이체(currency !== "USD")는 currentBalance에, USD 이체는 usdTransferNet에 반영
    const isUsdEntry = (l: LedgerEntry) => l.currency === "USD";
    const transferOutEntries = ledger.filter((l) => {
      if (l.kind !== "transfer" || l.fromAccountId !== account.id) return false;
      return !(l.category === "신용카드" && l.subCategory === "카드대금");
    });
    const transferOut = transferOutEntries.filter((l) => !isUsdEntry(l)).reduce((s, l) => s + l.amount, 0);
    const transferInEntries = ledger.filter((l) => {
      if (l.kind !== "transfer" || l.toAccountId !== account.id) return false;
      return !(l.category === "신용카드" && l.subCategory === "카드대금");
    });
    const transferIn = transferInEntries.filter((l) => !isUsdEntry(l)).reduce((s, l) => s + l.amount, 0);
    const transferNet = transferIn - transferOut;

    // USD 이체 순액 (증권계좌 등에서 달러 계좌 간 이체)
    const usdTransferOut = transferOutEntries.filter((l) => isUsdEntry(l)).reduce((s, l) => s + l.amount, 0);
    const usdTransferIn = transferInEntries.filter((l) => isUsdEntry(l)).reduce((s, l) => s + l.amount, 0);
    const usdTransferNet = usdTransferIn - usdTransferOut;

    // 주식 거래의 현금 영향 (매수: 음수, 매도: 양수)
    const accountTrades = trades.filter((t) => t.accountId === account.id);
    
    // 증권계좌의 경우 달러 종목 거래는 원화 잔액에 영향을 주지 않음 (USD 잔액에서 처리)
    const tradeCashImpact = accountTrades.reduce((s, t) => {
      // 증권계좌의 달러 종목 거래는 cashImpact를 0으로 처리 (USD 잔액에서 이미 처리됨)
      if (account.type === "securities" && isUSDStock(t.ticker)) {
        return s; // 달러 종목은 원화 잔액에 영향 없음
      }
      return s + t.cashImpact;
    }, 0);
    
    // 초기 보유 거래(cashImpact=0)의 totalAmount 합계 (baseBalance에 반영되어야 함)
    const initialHoldingsAmount = accountTrades
      .filter((t) => t.cashImpact === 0 && t.side === "buy")
      .reduce((s, t) => s + t.totalAmount, 0);

    // 현재 잔액 = 초기잔액 + 수입 - 지출 + 이체순액 + 주식거래현금영향 + 현금조정(기타)
    // savings와 debt는 별도 필드로 관리되며, 총자산 계산 시에만 사용됨
    // 증권계좌의 경우 initialCashBalance를 사용, 없으면 initialBalance 사용
    // 초기 보유 거래(cashImpact=0)의 totalAmount는 baseBalance에 포함되어야 함
    const baseBalance = account.type === "securities" 
      ? (account.initialCashBalance ?? account.initialBalance)
      : account.initialBalance;
    const cashAdjustment = account.cashAdjustment ?? 0;
    const savings = account.savings ?? 0;
    const currentBalance =
      baseBalance +
      initialHoldingsAmount + // 초기 보유 거래 금액 추가
      incomeSum -
      expenseSum +
      savingsExpenseIn + // 저축·재테크로 들어온 금액
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

export function computePositions(
  trades: StockTrade[],
  prices: StockPrice[],
  accounts: Account[],
  options?: { fxRate?: number }
): PositionRow[] {
  const byKey = new Map<string, StockTrade[]>();
  for (const t of trades) {
    const norm = canonicalTickerForMatch(t.ticker);
    if (!norm) continue;
    const key = `${t.accountId}::${norm}`;
    const list = byKey.get(key) ?? [];
    list.push(t);
    byKey.set(key, list);
  }

  const rows: PositionRow[] = [];
  const fxRate = options?.fxRate;

  for (const [key, ts] of byKey.entries()) {
    const [accountId, tickerNorm] = key.split("::");
    const account = accounts.find((a) => a.id === accountId);
    const accountName = account?.name ?? account?.id ?? accountId;

    const buys = ts.filter((t) => t.side === "buy");
    const sells = ts.filter((t) => t.side === "sell");

    const buyQty = buys.reduce((s, t) => s + t.quantity, 0);
    const sellQty = sells.reduce((s, t) => s + t.quantity, 0);
    const quantity = buyQty - sellQty;

    // 총매입금액: 매수 거래의 totalAmount 합계
    const totalBuyAmount = buys.reduce((s, t) => s + t.totalAmount, 0);
    // 총매도금액: 매도 거래의 totalAmount 합계
    const totalSellAmount = sells.reduce((s, t) => s + t.totalAmount, 0);
    // 순매입금액: 총매입금액 - 총매도금액 (실제 투자한 순 금액)
    const netBuyAmountRaw = totalBuyAmount - totalSellAmount;

    const priceInfo = prices.find((p) => canonicalTickerForMatch(p.ticker) === tickerNorm);
    const marketPrice = priceInfo?.price ?? 0;
    const canonicalTicker = priceInfo?.ticker ?? ts[0]?.ticker ?? tickerNorm;
    const name = priceInfo?.name ?? ts[0]?.name ?? canonicalTicker;

    // 가격이 원화로 들어온 경우(adjustedPrices): USD 종목/계좌는 순매입금액을 원화로 환산
    const isUSD = (account?.currency === "USD" || isUSDStock(canonicalTicker)) && fxRate != null && fxRate > 0;
    const netBuyAmount = isUSD ? netBuyAmountRaw * fxRate : netBuyAmountRaw;

    // 보유 수량이 0 이하인 경우는 포지션에서 제외
    if (quantity <= 0) {
      continue;
    }

    // 평가금액: 현재가 × 보유수량 (가격이 원화면 원화, 달러면 달러)
    const marketValue = marketPrice * quantity;
    
    // 평가손익: 평가금액 - 순매입금액 (같은 통화로 맞춘 뒤 계산)
    const pnl = marketValue - netBuyAmount;
    
    // 수익률: 순매입금액이 0보다 클 때만 계산
    const pnlRate = netBuyAmount > 0 ? pnl / netBuyAmount : 0;

    // 평균단가: 순매입금액/수량 (표시 통화는 netBuyAmount와 동일)
    const avgPrice = quantity > 0 ? netBuyAmount / quantity : 0;

    rows.push({
      accountId,
      accountName,
      ticker: canonicalTicker,
      name,
      quantity,
      avgPrice,
      totalBuyAmount: netBuyAmount, // 순매입금액 (표시/합산용, 원화면 원화)
      marketPrice,
      marketValue,
      pnl,
      pnlRate
    });
  }

  return rows;
}

/**
 * 기간 내 매도 차익 (FIFO). 지정 계좌들의 증권 매도 실현손익 합계.
 * USD 계좌는 fxRate로 원화 환산 (accounts, fxRate 옵션).
 */
export function computeRealizedGainInPeriod(
  trades: StockTrade[],
  startDate: string,
  endDate: string,
  accountIds: Set<string>,
  options?: { accounts: Account[]; fxRate?: number }
): number {
  type Lot = { qty: number; totalAmount: number };
  const byKey = new Map<string, StockTrade[]>();
  for (const t of trades) {
    if (!accountIds.has(t.accountId)) continue;
    const norm = canonicalTickerForMatch(t.ticker);
    if (!norm) continue;
    const key = `${t.accountId}::${norm}`;
    const list = byKey.get(key) ?? [];
    list.push(t);
    byKey.set(key, list);
  }
  let totalGain = 0;
  for (const list of byKey.values()) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const account = options?.accounts?.find((a) => a.id === list[0].accountId);
    const isUsd = account?.currency === "USD" && options?.fxRate;
    const toKrw = (x: number) => (isUsd ? x * (options!.fxRate!) : x);
    const queue: Lot[] = [];
    for (const t of sorted) {
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
        if (t.date >= startDate && t.date <= endDate) {
          totalGain += toKrw(t.totalAmount - costBasis);
        }
      }
    }
  }
  return totalGain;
}

/** 매도 건별 실현손익 (FIFO). 매도 거래 id → 실현손익(매도총액 - 매수원가). 동일 통화. */
export function computeRealizedPnlByTradeId(trades: StockTrade[]): Map<string, number> {
  type Lot = { qty: number; totalAmount: number };
  const byKey = new Map<string, StockTrade[]>();
  for (const t of trades) {
    const norm = canonicalTickerForMatch(t.ticker);
    if (!norm) continue;
    const key = `${t.accountId}::${norm}`;
    const list = byKey.get(key) ?? [];
    list.push(t);
    byKey.set(key, list);
  }
  const result = new Map<string, number>();
  for (const list of byKey.values()) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const queue: Lot[] = [];
    for (const t of sorted) {
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
        result.set(t.id, realizedPnl);
      }
    }
  }
  return result;
}

export function computeMonthlyNetWorth(
  accounts: Account[],
  ledger: LedgerEntry[],
  trades: StockTrade[]
): MonthlyNetWorthRow[] {
  // distinct months from ledger and trades
  const monthSet = new Set<string>();
  for (const l of ledger) {
    if (l.date) monthSet.add(l.date.slice(0, 7));
  }
  for (const t of trades) {
    if (t.date) monthSet.add(t.date.slice(0, 7));
  }
  const months = Array.from(monthSet).sort();
  if (months.length === 0) return [];

  return months.map((month) => {
    const filteredLedger = ledger.filter((l) => l.date.slice(0, 7) <= month);
    const filteredTrades = trades.filter((t) => t.date.slice(0, 7) <= month);
    const balances = computeAccountBalances(accounts, filteredLedger, filteredTrades);
    const netWorth = balances.reduce((sum, b) => sum + b.currentBalance, 0);
    return { month, netWorth };
  });
}
