/**
 * 리포트 생성 유틸리티
 */

import type { Account, LedgerEntry, StockTrade, StockPrice } from "../types";
import { computeAccountBalances, computePositions } from "../calculations";
import { isSavingsExpenseEntry } from "./category";
import { xirr } from "./irr";
import { canonicalTickerForMatch } from "./finance";

export interface MonthlyReport {
  month: string;
  income: number;
  expense: number;
  transfer: number;
  net: number;
}

export interface MonthlyIncomeDetail {
  month: string;
  date: string;
  category: string;
  subCategory?: string;
  description: string;
  accountId?: string;
  accountName?: string;
  amount: number;
}

export interface CategoryReport {
  category: string;
  subCategory?: string;
  total: number;
  count: number;
  average: number;
}

export interface StockPerformanceReport {
  accountId: string;
  ticker: string;
  name: string;
  totalBuyAmount: number;
  currentValue: number;
  pnl: number;
  pnlRate: number;
  quantity: number;
  /** 연간 수익률 (XIRR), 계산 불가 시 undefined */
  irr?: number | null;
}

export interface AccountReport {
  accountId: string;
  accountName: string;
  initialBalance: number;
  currentBalance: number;
  change: number;
  changeRate: number;
}

export interface DailyReport {
  date: string;
  income: number;
  expense: number;
  savingsExpense: number;
  transfer: number;
  stockValue: number;
  cashValue: number;
  savingsValue: number;
  totalAsset: number;
  netWorth: number;
}

/**
 * 월별 리포트 생성
 * 집계 규칙: ledger를 월별로 묶어 수입(income)·지출(expense)·이체(transfer) 금액 합산, net = income - expense
 */
export function generateMonthlyReport(
  ledger: LedgerEntry[],
  startMonth?: string,
  endMonth?: string
): MonthlyReport[] {
  const reports = new Map<string, { income: number; expense: number; transfer: number }>();

  ledger.forEach((entry) => {
    const month = entry.date.slice(0, 7); // YYYY-MM

    if (startMonth && month < startMonth) return;
    if (endMonth && month > endMonth) return;

    if (!reports.has(month)) {
      reports.set(month, { income: 0, expense: 0, transfer: 0 });
    }

    const report = reports.get(month)!;
    if (entry.kind === "income") {
      report.income += entry.amount;
    } else if (entry.kind === "expense") {
      report.expense += entry.amount;
    } else if (entry.kind === "transfer") {
      report.transfer += entry.amount;
    }
  });

  return Array.from(reports.entries())
    .map(([month, data]) => ({
      month,
      income: data.income,
      expense: data.expense,
      transfer: data.transfer,
      net: data.income - data.expense
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * 연도별 리포트 생성
 * 집계 규칙: ledger를 연도별로 묶어 수입·지출·이체 합산 (generateMonthlyReport와 동일, 단위만 연도)
 */
export function generateYearlyReport(ledger: LedgerEntry[]): MonthlyReport[] {
  const reports = new Map<string, { income: number; expense: number; transfer: number }>();

  ledger.forEach((entry) => {
    const year = entry.date.slice(0, 4); // YYYY

    if (!reports.has(year)) {
      reports.set(year, { income: 0, expense: 0, transfer: 0 });
    }

    const report = reports.get(year)!;
    if (entry.kind === "income") {
      report.income += entry.amount;
    } else if (entry.kind === "expense") {
      report.expense += entry.amount;
    } else if (entry.kind === "transfer") {
      report.transfer += entry.amount;
    }
  });

  return Array.from(reports.entries())
    .map(([month, data]) => ({
      month,
      income: data.income,
      expense: data.expense,
      transfer: data.transfer,
      net: data.income - data.expense
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * 카테고리별 리포트 생성
 * 집계 규칙: expense만 기간 필터 후 대분류(·세부)별 금액 합산, 건수·평균
 */
export function generateCategoryReport(
  ledger: LedgerEntry[],
  startDate?: string,
  endDate?: string
): CategoryReport[] {
  const reports = new Map<string, { total: number; count: number }>();

  ledger.forEach((entry) => {
    if (entry.kind !== "expense") return;
    if (startDate && entry.date < startDate) return;
    if (endDate && entry.date > endDate) return;

    const key = entry.subCategory ? `${entry.category}:${entry.subCategory}` : entry.category;
    if (!reports.has(key)) {
      reports.set(key, { total: 0, count: 0 });
    }

    const report = reports.get(key)!;
    report.total += entry.amount;
    report.count += 1;
  });

  return Array.from(reports.entries())
    .map(([key, data]) => {
      const [category, subCategory] = key.split(":");
      return {
        category,
        subCategory: subCategory || undefined,
        total: data.total,
        count: data.count,
        average: data.count > 0 ? data.total / data.count : 0
      };
    })
    .sort((a, b) => b.total - a.total);
}

/**
 * 주식 성과 리포트 생성 (종목·계좌별 IRR 포함)
 * 집계 규칙: calculations.computePositions로 포지션 산출 후, 종목별 cashFlow + 현재 평가액으로 XIRR 계산
 */
export function generateStockPerformanceReport(
  trades: StockTrade[],
  prices: StockPrice[],
  accounts: Account[]
): StockPerformanceReport[] {
  const positions = computePositions(trades, prices, accounts);
  const today = new Date().toISOString().slice(0, 10);

  return positions.map((pos) => {
    const posTrades = trades
      .filter(
        (t) =>
          t.accountId === pos.accountId &&
          canonicalTickerForMatch(t.ticker) === canonicalTickerForMatch(pos.ticker)
      )
      .sort((a, b) => a.date.localeCompare(b.date));
    const flows = posTrades.map((t) => ({ date: t.date, amount: t.cashImpact }));
    flows.push({ date: today, amount: pos.marketValue });
    const irrVal = xirr(flows);
    return {
      accountId: pos.accountId,
      ticker: pos.ticker,
      name: pos.name || pos.ticker,
      totalBuyAmount: pos.totalBuyAmount,
      currentValue: pos.marketValue,
      pnl: pos.pnl,
      pnlRate: pos.pnlRate,
      quantity: pos.quantity,
      irr: irrVal != null ? irrVal : undefined
    };
  }).sort((a, b) => b.pnl - a.pnl);
}

/**
 * 계좌 리포트 생성
 * 집계 규칙: calculations.computeAccountBalances로 계좌별 잔액 산출 후, 초기잔액 대비 변동·변동률
 */
export function generateAccountReport(
  accounts: Account[],
  ledger: LedgerEntry[],
  trades: StockTrade[]
): AccountReport[] {
  const balances = computeAccountBalances(accounts, ledger, trades);

  return balances.map((balance) => {
    const account = balance.account;
    const initial = account.initialBalance + (account.cashAdjustment ?? 0) + (account.initialCashBalance ?? 0);
    const current = balance.currentBalance;
    const change = current - initial;
    const changeRate = initial !== 0 ? (change / initial) * 100 : 0;

    return {
      accountId: account.id,
      accountName: account.name,
      initialBalance: initial,
      currentBalance: current,
      change,
      changeRate
    };
  }).sort((a, b) => b.currentBalance - a.currentBalance);
}

/**
 * 월별 수입 상세 리포트 생성 (배당/이자 등)
 * 집계 규칙: ledger 중 income만, 배당/이자 관련 카테고리·설명 필터 후 월·일자순 정렬
 */
export function generateMonthlyIncomeDetail(
  ledger: LedgerEntry[],
  accounts: Account[],
  startMonth?: string,
  endMonth?: string
): MonthlyIncomeDetail[] {
  const accountMap = new Map(accounts.map(a => [a.id, a]));
  
  return ledger
    .filter(entry => {
      if (entry.kind !== "income") return false;
      const month = entry.date.slice(0, 7);
      if (startMonth && month < startMonth) return false;
      if (endMonth && month > endMonth) return false;
      // 배당/이자 관련 카테고리만 필터링
      const category = entry.category || entry.subCategory || "";
      const description = entry.description || "";
      return category.includes("배당") || category.includes("이자") || 
             description.includes("배당") || description.includes("이자");
    })
    .map(entry => {
      const account = entry.toAccountId ? accountMap.get(entry.toAccountId) : undefined;
      return {
        month: entry.date.slice(0, 7),
        date: entry.date,
        category: entry.category || "",
        subCategory: entry.subCategory,
        description: entry.description,
        accountId: entry.toAccountId,
        accountName: account?.name,
        amount: entry.amount
      };
    })
    .sort((a, b) => {
      if (a.month !== b.month) return a.month.localeCompare(b.month);
      return a.date.localeCompare(b.date);
    });
}

/**
 * 일별 리포트 생성 (일자별 자산 계산)
 * 집계 규칙: 날짜별로 ledger/trades 자른 뒤 계산; 일별 수입·지출·저축성지출·이체 합계, computeAccountBalances·computePositions로 잔액·평가액 산출 후 현금·저축·주식·순자산
 */
export function generateDailyReport(
  accounts: Account[],
  ledger: LedgerEntry[],
  trades: StockTrade[],
  prices: StockPrice[],
  startDate?: string,
  endDate?: string,
  fxRate?: number
): DailyReport[] {
  // 모든 날짜 수집
  const dateSet = new Set<string>();
  trades.forEach((t) => {
    if (t.date) dateSet.add(t.date);
  });
  ledger.forEach((l) => {
    if (l.date) dateSet.add(l.date);
  });
  
  if (dateSet.size === 0) return [];
  
  const allDates = Array.from(dateSet).sort();
  const firstDate = allDates[0];
  const lastDate = allDates[allDates.length - 1];
  
  // 날짜 범위 결정
  const start = startDate || firstDate;
  const end = endDate || lastDate;
  
  // 시작일부터 종료일까지 모든 날짜 생성
  const dates: string[] = [];
  const currentDate = new Date(start);
  const endDateObj = new Date(end);
  
  while (currentDate <= endDateObj) {
    dates.push(currentDate.toISOString().split('T')[0]);
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  // USD를 KRW로 변환한 가격 목록
  const adjustedPrices = fxRate ? prices.map((p) => {
    if (p.currency && p.currency !== "KRW" && p.currency === "USD") {
      return { ...p, price: p.price * fxRate, currency: "KRW" };
    }
    return p;
  }) : prices;
  
  const reports: DailyReport[] = [];
  
  for (const date of dates) {
    // 해당 날짜까지의 거래와 ledger만 필터링
    const filteredTrades = trades.filter((t) => t.date && t.date <= date);
    const filteredLedger = ledger.filter((l) => l.date && l.date <= date);
    
    // 해당 날짜의 수입/지출/저축/이체 계산 (가계부 단일 소스: isSavingsExpenseEntry)
    const dayIncome = filteredLedger
      .filter((l) => l.kind === "income" && l.date === date)
      .reduce((sum, l) => sum + l.amount, 0);
    
    const dayExpense = filteredLedger
      .filter((l) => l.kind === "expense" && !isSavingsExpenseEntry(l, accounts) && l.date === date)
      .reduce((sum, l) => sum + l.amount, 0);
    
    const daySavingsExpense = filteredLedger
      .filter((l) => isSavingsExpenseEntry(l, accounts) && l.date === date)
      .reduce((sum, l) => sum + l.amount, 0);
    
    const dayTransfer = filteredLedger
      .filter((l) => l.kind === "transfer" && l.date === date)
      .reduce((sum, l) => sum + l.amount, 0);
    
    // 해당 날짜까지의 자산 계산
    const positions = computePositions(filteredTrades, adjustedPrices, accounts, { fxRate: fxRate ?? undefined });
    const balances = computeAccountBalances(accounts, filteredLedger, filteredTrades);
    
    // 주식 평가액
    const stockValue = positions.reduce((sum, p) => sum + (p.marketValue || 0), 0);
    
    // 현금 (입출금, 증권계좌 현금)
    const securitiesAccounts = balances.filter((b) => b.account.type === "securities");
    const securitiesCash = securitiesAccounts.reduce((sum, b) => {
      const account = b.account;
      const usdBalance = (account.usdBalance ?? 0) + (b.usdTransferNet ?? 0);
      const krwBalance = b.currentBalance;
      const cash = fxRate ? (usdBalance * fxRate) + krwBalance : krwBalance;
      return sum + cash;
    }, 0);
    
    const checkingSavings = balances
      .filter((b) => b.account.type === "checking" || b.account.type === "other")
      .reduce((sum, b) => sum + b.currentBalance, 0);
    
    const cashValue = securitiesCash + checkingSavings;
    
    // 저축
    const savingsValue = balances
      .filter((b) => b.account.type === "savings")
      .reduce((sum, b) => sum + b.currentBalance, 0) + 
      accounts
        .filter((a) => a.type !== "savings")
        .reduce((sum, a) => sum + (a.savings ?? 0), 0);
    
    // 부채
    const debt = accounts.reduce((sum, a) => sum + (a.debt ?? 0), 0);
    
    // 전체 자산
    const totalAsset = stockValue + cashValue + savingsValue;
    
    // 순자산
    const netWorth = totalAsset - debt;
    
    reports.push({
      date,
      income: dayIncome,
      expense: dayExpense,
      savingsExpense: daySavingsExpense,
      transfer: dayTransfer,
      stockValue,
      cashValue,
      savingsValue,
      totalAsset,
      netWorth
    });
  }
  
  return reports;
}

/**
 * 리포트를 CSV 형식으로 변환
 */
export function reportToCSV(report: MonthlyReport[] | CategoryReport[] | StockPerformanceReport[] | AccountReport[] | MonthlyIncomeDetail[] | DailyReport[]): string {
  if (report.length === 0) return "";

  const first = report[0];
  const headers = Object.keys(first);
  const rows = report.map((r) => Object.values(r).map((v) => {
    if (typeof v === "number") {
      return v.toLocaleString();
    }
    return String(v ?? "");
  }));

  return [headers, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
}
