/**
 * 리포트 생성 유틸리티
 */

import type { Account, LedgerEntry, StockTrade, StockPrice } from "../types";
import { computeAccountBalances, computePositions } from "../calculations";
import { formatKRW, formatUSD } from "./format";

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
  ticker: string;
  name: string;
  totalBuyAmount: number;
  currentValue: number;
  pnl: number;
  pnlRate: number;
  quantity: number;
}

export interface AccountReport {
  accountId: string;
  accountName: string;
  initialBalance: number;
  currentBalance: number;
  change: number;
  changeRate: number;
}

/**
 * 월별 리포트 생성
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
 * 주식 성과 리포트 생성
 */
export function generateStockPerformanceReport(
  trades: StockTrade[],
  prices: StockPrice[],
  accounts: Account[]
): StockPerformanceReport[] {
  const positions = computePositions(trades, prices, accounts);

  return positions.map((pos) => ({
    ticker: pos.ticker,
    name: pos.name || pos.ticker,
    totalBuyAmount: pos.totalCost,
    currentValue: pos.marketValue,
    pnl: pos.pnl,
    pnlRate: pos.pnlRate,
    quantity: pos.quantity
  })).sort((a, b) => b.pnl - a.pnl);
}

/**
 * 계좌 리포트 생성
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
 * 리포트를 CSV 형식으로 변환
 */
export function reportToCSV(report: MonthlyReport[] | CategoryReport[] | StockPerformanceReport[] | AccountReport[] | MonthlyIncomeDetail[]): string {
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

