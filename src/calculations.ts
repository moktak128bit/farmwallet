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
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'calculations.ts:computeAccountBalances',message:'함수 시작',data:{accountsCount:accounts.length,ledgerCount:ledger.length,tradesCount:trades.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  return accounts.map((account) => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'calculations.ts:computeAccountBalances',message:'계좌 계산 시작',data:{accountId:account.id,accountType:account.type,initialBalance:account.initialBalance},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    // 수입: toAccountId가 이 계좌인 항목들의 합계
    const incomeEntries = ledger.filter((l) => l.kind === "income" && l.toAccountId === account.id);
    const incomeSum = incomeEntries.reduce((s, l) => s + l.amount, 0);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'calculations.ts:computeAccountBalances',message:'수입 계산 완료',data:{accountId:account.id,incomeCount:incomeEntries.length,incomeSum},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    // 지출: fromAccountId가 이 계좌인 항목들의 합계
    const expenseEntries = ledger.filter((l) => l.kind === "expense" && l.fromAccountId === account.id);
    const expenseSum = expenseEntries.reduce((s, l) => s + l.amount, 0);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'calculations.ts:computeAccountBalances',message:'지출 계산 완료',data:{accountId:account.id,expenseCount:expenseEntries.length,expenseSum},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'calculations.ts:computeAccountBalances',message:'이체 계산 완료',data:{accountId:account.id,transferOutCount:transferOutEntries.length,transferOut,transferInCount:transferInEntries.length,transferIn,transferNet},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion

    // 주식 거래의 현금 영향 (매수: 음수, 매도: 양수)
    const accountTrades = trades.filter((t) => t.accountId === account.id);
    const tradeCashImpact = accountTrades.reduce((s, t) => s + t.cashImpact, 0);
    
    // 초기 보유 거래(cashImpact=0)의 totalAmount 합계 (baseBalance에 반영되어야 함)
    const initialHoldingsAmount = accountTrades
      .filter((t) => t.cashImpact === 0 && t.side === "buy")
      .reduce((s, t) => s + t.totalAmount, 0);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'calculations.ts:computeAccountBalances',message:'주식 거래 현금 영향 계산 완료',data:{accountId:account.id,tradesCount:accountTrades.length,tradeCashImpact,initialHoldingsAmount,trades:accountTrades.map(t=>({id:t.id,side:t.side,quantity:t.quantity,price:t.price,fee:t.fee,totalAmount:t.totalAmount,cashImpact:t.cashImpact}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion

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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'calculations.ts:computeAccountBalances',message:'최종 잔액 계산 완료',data:{accountId:account.id,baseBalance,incomeSum,expenseSum,transferNet,tradeCashImpact,cashAdjustment,savings,currentBalance},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion

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
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'calculations.ts:computePositions',message:'함수 시작',data:{tradesCount:trades.length,pricesCount:prices.length,accountsCount:accounts.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
  // #endregion
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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/882185e7-1338-4f3b-a05b-acdab4efccb1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'calculations.ts:computePositions',message:'포지션 계산',data:{accountId,ticker,buyCount:buys.length,buyQty,totalBuyAmount,sellCount:sells.length,sellQty,totalSellAmount,netBuyAmount,quantity,buys:buys.map(t=>({id:t.id,quantity:t.quantity,price:t.price,fee:t.fee,totalAmount:t.totalAmount})),sells:sells.map(t=>({id:t.id,quantity:t.quantity,price:t.price,fee:t.fee,totalAmount:t.totalAmount}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    
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
