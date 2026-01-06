import type { Account, LedgerEntry, StockPrice, StockTrade } from "./types";
import { isUSDStock } from "./utils/tickerUtils";

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
    const incomeEntries = ledger.filter((l) => l.kind === "income" && l.toAccountId === account.id);
    const incomeSum = incomeEntries.reduce((s, l) => s + l.amount, 0);
    // 지출: fromAccountId가 이 계좌인 항목들의 합계
    const expenseEntries = ledger.filter((l) => l.kind === "expense" && l.fromAccountId === account.id);
    const expenseSum = expenseEntries.reduce((s, l) => s + l.amount, 0);
    // 이체: transfer 종류의 거래에서 이 계좌로 들어온 금액과 나간 금액
    // 단, "신용카드" > "카드대금"은 자산 계산에서 제외 (이미 지출로 반영되었으므로)
    const transferOutEntries = ledger.filter((l) => {
      if (l.kind !== "transfer" || l.fromAccountId !== account.id) return false;
      // 카드대금 결제는 자산 계산에서 제외
      return !(l.category === "신용카드" && l.subCategory === "카드대금");
    });
    const transferOut = transferOutEntries.reduce((s, l) => s + l.amount, 0);
    const transferInEntries = ledger.filter((l) => {
      if (l.kind !== "transfer" || l.toAccountId !== account.id) return false;
      // 카드대금 결제는 자산 계산에서 제외
      return !(l.category === "신용카드" && l.subCategory === "카드대금");
    });
    const transferIn = transferInEntries.reduce((s, l) => s + l.amount, 0);
    const transferNet = transferIn - transferOut;

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
      transferNet +
      tradeCashImpact +
      cashAdjustment +
      savings;

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
    
    // 보유 수량이 0 이하인 경우는 포지션에서 제외
    if (quantity <= 0) {
      continue;
    }

    // 평가금액: 현재가 × 보유수량
    const marketValue = marketPrice * quantity;
    
    // 평가손익: 평가금액 - 순매입금액
    const pnl = marketValue - netBuyAmount;
    
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
