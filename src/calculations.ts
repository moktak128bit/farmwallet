import type { Account, LedgerEntry, StockPrice, StockTrade } from "./types";

export interface AccountBalanceRow {
  account: Account;
  incomeSum: number;
  expenseSum: number;
  transferNet: number;
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
    const incomeSum = ledger
      .filter((l) => l.kind === "income" && l.toAccountId === account.id)
      .reduce((s, l) => s + l.amount, 0);
    
    // 지출: fromAccountId가 이 계좌인 항목들의 합계
    const expenseSum = ledger
      .filter((l) => l.kind === "expense" && l.fromAccountId === account.id)
      .reduce((s, l) => s + l.amount, 0);
    
    // 이체: transfer 종류의 거래에서 이 계좌로 들어온 금액과 나간 금액
    const transferOut = ledger
      .filter((l) => l.kind === "transfer" && l.fromAccountId === account.id)
      .reduce((s, l) => s + l.amount, 0);
    const transferIn = ledger
      .filter((l) => l.kind === "transfer" && l.toAccountId === account.id)
      .reduce((s, l) => s + l.amount, 0);
    const transferNet = transferIn - transferOut;

    // 주식 거래의 현금 영향 (매수: 음수, 매도: 양수)
    const tradeCashImpact = trades
      .filter((t) => t.accountId === account.id)
      .reduce((s, t) => s + t.cashImpact, 0);

    // 현재 잔액 = 초기잔액 + 수입 - 지출 + 이체순액 + 주식거래현금영향
    // savings와 debt는 별도 필드로 관리되며, 총자산 계산 시에만 사용됨
    const currentBalance =
      account.initialBalance + incomeSum - expenseSum + transferNet + tradeCashImpact;

    return {
      account,
      incomeSum,
      expenseSum,
      transferNet,
      tradeCashImpact,
      currentBalance
    };
  });
}

export function computePositions(
  trades: StockTrade[],
  prices: StockPrice[],
  accounts: Account[]
): PositionRow[] {
  const byKey = new Map<string, StockTrade[]>();
  for (const t of trades) {
    const key = `${t.accountId}::${t.ticker}`;
    const list = byKey.get(key) ?? [];
    list.push(t);
    byKey.set(key, list);
  }

  const rows: PositionRow[] = [];

  for (const [key, ts] of byKey.entries()) {
    const [accountId, ticker] = key.split("::");
    const accountName =
      accounts.find((a) => a.id === accountId)?.name ?? accounts.find((a) => a.id === accountId)?.id ??
      accountId;

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
    const netBuyAmount = totalBuyAmount - totalSellAmount;
    
    const priceInfo = prices.find((p) => p.ticker === ticker);
    const marketPrice = priceInfo?.price ?? 0;
    const name = priceInfo?.name ?? ts[0]?.name ?? ticker;

    // 평균단가: 매수 금액을 매수 수량으로 나눈 값 (매수한 평균 단가)
    const avgPrice = buyQty > 0 ? totalBuyAmount / buyQty : 0;
    
    // 평가금액: 현재가 × 보유수량
    const marketValue = marketPrice * quantity;
    
    // 평가손익: 평가금액 - 순매입금액
    // 보유수량이 0이면 평가손익도 0
    const pnl = quantity > 0 ? marketValue - netBuyAmount : 0;
    
    // 수익률: 순매입금액이 0보다 클 때만 계산
    const pnlRate = netBuyAmount > 0 ? pnl / netBuyAmount : 0;

    rows.push({
      accountId,
      accountName,
      ticker,
      name,
      quantity,
      avgPrice,
      totalBuyAmount: netBuyAmount, // 순매입금액을 totalBuyAmount로 사용
      marketPrice,
      marketValue,
      pnl,
      pnlRate
    });
  }

  return rows;
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

