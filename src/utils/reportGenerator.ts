import type { Account, LedgerEntry, StockPrice, StockTrade } from "../types";
import {
  computeAccountBalances,
  computePositions,
  computeRealizedPnlByTradeId
} from "../calculations";
import { isSavingsExpenseEntry } from "./category";
import { canonicalTickerForMatch, isUSDStock } from "./finance";
import { xirr, type CashFlowItem } from "./irr";

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

export interface ClosingSnapshot {
  periodType: "weekly" | "monthly";
  periodKey: string;
  startDate: string;
  endDate: string;
  asset: number;
  debt: number;
  netWorth: number;
  income: number;
  expense: number;
  savingsExpense: number;
  transfer: number;
  cashflow: number;
}

export interface MonthlyCloseComment {
  month: string;
  previousMonth: string;
  assetDelta: number;
  netWorthDelta: number;
  cashflowDelta: number;
  summary: string;
}

export interface MonthlyClosingStatus {
  month: string;
  completionRate: number;
  coveredDays: number;
  elapsedDays: number;
  coveredUntil?: string;
  expectedClosings: number;
  completedClosings: number;
  weeklyExpected: number;
  weeklyCompleted: number;
  monthlyExpected: number;
  monthlyCompleted: number;
}

export interface ClosingReportData {
  weeklySnapshots: ClosingSnapshot[];
  monthlySnapshots: ClosingSnapshot[];
  latestComment?: MonthlyCloseComment;
  monthlyStatus: MonthlyClosingStatus;
}

export interface AccountPerformanceBreakdownRow {
  accountId: string;
  accountName: string;
  currentValue: number;
  irr?: number | null;
  ttwr?: number | null;
  realizedPnl: number;
  unrealizedPnl: number;
  dividendContribution: number;
  totalContribution: number;
}

export interface ConsumptionImpactMonthlyRow {
  month: string;
  income: number;
  consumptionExpense: number;
  investmentCapacity: number;
  actualInvested: number;
  capacityGap: number;
  capacityUtilizationRate: number | null;
}

const INVESTING_ACCOUNT_TYPES = new Set<Account["type"]>(["savings", "securities", "crypto"]);

function toKrwAmount(amount: number, currency?: string, fxRate?: number): number {
  if (currency === "USD" && fxRate) return amount * fxRate;
  return amount;
}

function parseIsoLocal(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatIsoLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date: string, days: number): string {
  const d = parseIsoLocal(date);
  d.setDate(d.getDate() + days);
  return formatIsoLocal(d);
}

function getMonthKey(date: string): string {
  return date.slice(0, 7);
}

function getMonthStart(date: string): string {
  return `${getMonthKey(date)}-01`;
}

function getMonthEnd(date: string): string {
  const d = parseIsoLocal(getMonthStart(date));
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return formatIsoLocal(d);
}

function shiftMonth(month: string, offset: number): string {
  const [y, m] = month.split("-").map(Number);
  const shifted = new Date(y, m - 1 + offset, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

function buildMonthRange(startMonth: string, endMonth: string): string[] {
  const result: string[] = [];
  let current = startMonth;
  while (current <= endMonth) {
    result.push(current);
    current = shiftMonth(current, 1);
  }
  return result;
}

function getWeekStartMonday(date: string): string {
  const d = parseIsoLocal(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return formatIsoLocal(d);
}

function convertPositionAmount(
  amount: number,
  ticker: string,
  account: Account | undefined,
  fxRate?: number
): number {
  if (!fxRate) return amount;
  if (isUSDStock(ticker) || account?.currency === "USD") {
    return amount * fxRate;
  }
  return amount;
}

function isDividendIncomeEntry(entry: LedgerEntry): boolean {
  if (entry.kind !== "income") return false;
  const source = `${entry.category ?? ""} ${entry.subCategory ?? ""} ${entry.description ?? ""}`.toLowerCase();
  return source.includes("배당") || source.includes("dividend");
}

function accountValueMapAtDate(
  accounts: Account[],
  ledger: LedgerEntry[],
  trades: StockTrade[],
  prices: StockPrice[],
  date: string,
  fxRate?: number
): Map<string, number> {
  const filteredLedger = ledger.filter((entry) => entry.date <= date);
  const filteredTrades = trades.filter((trade) => trade.date <= date);
  const balances = computeAccountBalances(accounts, filteredLedger, filteredTrades);
  const positions = computePositions(filteredTrades, prices, accounts);
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  const stockByAccount = new Map<string, number>();
  for (const position of positions) {
    const account = accountById.get(position.accountId);
    const converted = convertPositionAmount(position.marketValue, position.ticker, account, fxRate);
    stockByAccount.set(position.accountId, (stockByAccount.get(position.accountId) ?? 0) + converted);
  }

  const result = new Map<string, number>();
  for (const row of balances) {
    const usdCash =
      (row.account.type === "securities" || row.account.type === "crypto") && fxRate
        ? ((row.account.usdBalance ?? 0) + (row.usdTransferNet ?? 0)) * fxRate
        : 0;
    const stockValue = stockByAccount.get(row.account.id) ?? 0;
    result.set(row.account.id, row.currentBalance + usdCash + stockValue);
  }

  return result;
}

export function generateMonthlyReport(
  ledger: LedgerEntry[],
  startMonth?: string,
  endMonth?: string
): MonthlyReport[] {
  const reports = new Map<string, { income: number; expense: number; transfer: number }>();

  for (const entry of ledger) {
    const month = entry.date.slice(0, 7);
    if (startMonth && month < startMonth) continue;
    if (endMonth && month > endMonth) continue;

    if (!reports.has(month)) {
      reports.set(month, { income: 0, expense: 0, transfer: 0 });
    }

    const report = reports.get(month)!;
    if (entry.kind === "income") report.income += entry.amount;
    if (entry.kind === "expense") report.expense += entry.amount;
    if (entry.kind === "transfer") report.transfer += entry.amount;
  }

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

export function generateYearlyReport(ledger: LedgerEntry[]): MonthlyReport[] {
  const reports = new Map<string, { income: number; expense: number; transfer: number }>();

  for (const entry of ledger) {
    const year = entry.date.slice(0, 4);

    if (!reports.has(year)) {
      reports.set(year, { income: 0, expense: 0, transfer: 0 });
    }

    const report = reports.get(year)!;
    if (entry.kind === "income") report.income += entry.amount;
    if (entry.kind === "expense") report.expense += entry.amount;
    if (entry.kind === "transfer") report.transfer += entry.amount;
  }

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

export function generateCategoryReport(
  ledger: LedgerEntry[],
  startDate?: string,
  endDate?: string
): CategoryReport[] {
  const reports = new Map<string, { total: number; count: number }>();

  for (const entry of ledger) {
    if (entry.kind !== "expense") continue;
    if (startDate && entry.date < startDate) continue;
    if (endDate && entry.date > endDate) continue;

    const key = entry.subCategory ? `${entry.category}:${entry.subCategory}` : entry.category;
    if (!reports.has(key)) {
      reports.set(key, { total: 0, count: 0 });
    }

    const row = reports.get(key)!;
    row.total += entry.amount;
    row.count += 1;
  }

  return Array.from(reports.entries())
    .map(([key, value]) => {
      const [category, subCategory] = key.split(":");
      return {
        category,
        subCategory: subCategory || undefined,
        total: value.total,
        count: value.count,
        average: value.count > 0 ? value.total / value.count : 0
      };
    })
    .sort((a, b) => b.total - a.total);
}

export function generateStockPerformanceReport(
  trades: StockTrade[],
  prices: StockPrice[],
  accounts: Account[]
): StockPerformanceReport[] {
  const positions = computePositions(trades, prices, accounts);
  const today = formatIsoLocal(new Date());

  return positions
    .map((position) => {
      const positionTrades = trades
        .filter(
          (trade) =>
            trade.accountId === position.accountId &&
            canonicalTickerForMatch(trade.ticker) === canonicalTickerForMatch(position.ticker)
        )
        .sort((a, b) => a.date.localeCompare(b.date));

      const flows: CashFlowItem[] = positionTrades.map((trade) => ({
        date: trade.date,
        amount: trade.cashImpact
      }));
      flows.push({ date: today, amount: position.marketValue });

      return {
        accountId: position.accountId,
        ticker: position.ticker,
        name: position.name || position.ticker,
        totalBuyAmount: position.totalBuyAmount,
        currentValue: position.marketValue,
        pnl: position.pnl,
        pnlRate: position.pnlRate,
        quantity: position.quantity,
        irr: xirr(flows) ?? undefined
      };
    })
    .sort((a, b) => b.pnl - a.pnl);
}

export function generateAccountReport(
  accounts: Account[],
  ledger: LedgerEntry[],
  trades: StockTrade[]
): AccountReport[] {
  const balances = computeAccountBalances(accounts, ledger, trades);

  return balances
    .map((balance) => {
      const account = balance.account;
      const initial =
        account.initialBalance + (account.cashAdjustment ?? 0) + (account.initialCashBalance ?? 0);
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
    })
    .sort((a, b) => b.currentBalance - a.currentBalance);
}

export function generateMonthlyIncomeDetail(
  ledger: LedgerEntry[],
  accounts: Account[],
  startMonth?: string,
  endMonth?: string
): MonthlyIncomeDetail[] {
  const accountMap = new Map(accounts.map((account) => [account.id, account]));

  return ledger
    .filter((entry) => {
      if (entry.kind !== "income") return false;
      const month = entry.date.slice(0, 7);
      if (startMonth && month < startMonth) return false;
      if (endMonth && month > endMonth) return false;

      const category = `${entry.category ?? ""} ${entry.subCategory ?? ""}`;
      const description = entry.description ?? "";
      return (
        category.includes("배당") ||
        category.includes("이자") ||
        description.includes("배당") ||
        description.includes("이자") ||
        category.toLowerCase().includes("dividend") ||
        category.toLowerCase().includes("interest") ||
        description.toLowerCase().includes("dividend") ||
        description.toLowerCase().includes("interest")
      );
    })
    .map((entry) => ({
      month: entry.date.slice(0, 7),
      date: entry.date,
      category: entry.category || "",
      subCategory: entry.subCategory,
      description: entry.description,
      accountId: entry.toAccountId,
      accountName: entry.toAccountId ? accountMap.get(entry.toAccountId)?.name : undefined,
      amount: entry.amount
    }))
    .sort((a, b) => (a.month === b.month ? a.date.localeCompare(b.date) : a.month.localeCompare(b.month)));
}

export function generateDailyReport(
  accounts: Account[],
  ledger: LedgerEntry[],
  trades: StockTrade[],
  prices: StockPrice[],
  startDate?: string,
  endDate?: string,
  fxRate?: number
): DailyReport[] {
  const dateSet = new Set<string>();
  for (const trade of trades) {
    if (trade.date) dateSet.add(trade.date);
  }
  for (const entry of ledger) {
    if (entry.date) dateSet.add(entry.date);
  }

  if (dateSet.size === 0) return [];

  const allDates = Array.from(dateSet).sort();
  const start = startDate || allDates[0];
  const end = endDate || allDates[allDates.length - 1];

  const dates: string[] = [];
  let cursor = parseIsoLocal(start);
  const endObj = parseIsoLocal(end);
  while (cursor <= endObj) {
    dates.push(formatIsoLocal(cursor));
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
  }

  const reports: DailyReport[] = [];

  for (const date of dates) {
    const filteredTrades = trades.filter((trade) => trade.date && trade.date <= date);
    const filteredLedger = ledger.filter((entry) => entry.date && entry.date <= date);

    const dayIncome = filteredLedger
      .filter((entry) => entry.kind === "income" && entry.date === date)
      .reduce((sum, entry) => sum + toKrwAmount(entry.amount, entry.currency, fxRate), 0);

    const dayExpense = filteredLedger
      .filter(
        (entry) =>
          entry.kind === "expense" && !isSavingsExpenseEntry(entry, accounts) && entry.date === date
      )
      .reduce((sum, entry) => sum + toKrwAmount(entry.amount, entry.currency, fxRate), 0);

    // 저축/투자 이체 + 저축성지출(투자손실 제외 — isSavingsExpenseEntry 내부에서 처리됨)
    const daySavingsExpense = filteredLedger
      .filter((entry) => entry.date === date && (
        isSavingsExpenseEntry(entry, accounts) ||
        (entry.kind === "transfer" && (
          entry.subCategory === "저축이체" || entry.subCategory === "투자이체" ||
          entry.subCategory === "저축" || entry.subCategory === "투자"
        ))
      ))
      .reduce((sum, entry) => sum + toKrwAmount(entry.amount, entry.currency, fxRate), 0);

    // 일반 이체 (저축이체/투자이체 제외 — savings로 따로 집계됨)
    const dayTransfer = filteredLedger
      .filter((entry) => entry.kind === "transfer" && entry.date === date &&
        entry.subCategory !== "저축이체" && entry.subCategory !== "투자이체" &&
        entry.subCategory !== "저축" && entry.subCategory !== "투자")
      .reduce((sum, entry) => sum + toKrwAmount(entry.amount, entry.currency, fxRate), 0);

    const positions = computePositions(filteredTrades, prices, accounts);
    const balances = computeAccountBalances(accounts, filteredLedger, filteredTrades);

    const accountById = new Map(accounts.map((account) => [account.id, account]));

    const stockValue = positions.reduce((sum, position) => {
      const account = accountById.get(position.accountId);
      return sum + convertPositionAmount(position.marketValue, position.ticker, account, fxRate);
    }, 0);

    const securitiesCash = balances
      .filter((balance) => balance.account.type === "securities" || balance.account.type === "crypto")
      .reduce((sum, balance) => {
        const usdBalance = (balance.account.usdBalance ?? 0) + (balance.usdTransferNet ?? 0);
        const convertedUsd = fxRate ? usdBalance * fxRate : 0;
        return sum + balance.currentBalance + convertedUsd;
      }, 0);

    const checkingAndOtherCash = balances
      .filter((balance) => balance.account.type === "checking" || balance.account.type === "other")
      .reduce((sum, balance) => sum + balance.currentBalance, 0);

    const cashValue = securitiesCash + checkingAndOtherCash;

    const savingsValue =
      balances
        .filter((balance) => balance.account.type === "savings")
        .reduce((sum, balance) => sum + balance.currentBalance, 0) +
      accounts
        .filter((account) => account.type !== "savings")
        .reduce((sum, account) => sum + (account.savings ?? 0), 0);

    const debt = accounts.reduce((sum, account) => sum + Math.abs(account.debt ?? 0), 0);
    const totalAsset = stockValue + cashValue + savingsValue;
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

export function generateClosingReportData(
  accounts: Account[],
  ledger: LedgerEntry[],
  trades: StockTrade[],
  prices: StockPrice[],
  fxRate?: number
): ClosingReportData {
  const today = formatIsoLocal(new Date());
  const allDates = [...ledger.map((entry) => entry.date), ...trades.map((trade) => trade.date)]
    .filter(Boolean)
    .sort();
  const firstDate = allDates[0] ?? today;
  const latestActivityDate = allDates.length > 0 ? allDates[allDates.length - 1] : undefined;

  const dailyRows = generateDailyReport(accounts, ledger, trades, prices, firstDate, today, fxRate);

  const monthlyStatusBase: MonthlyClosingStatus = {
    month: today.slice(0, 7),
    completionRate: 0,
    coveredDays: 0,
    elapsedDays: parseIsoLocal(today).getDate(),
    coveredUntil: undefined,
    expectedClosings: 0,
    completedClosings: 0,
    weeklyExpected: 0,
    weeklyCompleted: 0,
    monthlyExpected: 0,
    monthlyCompleted: 0
  };

  if (dailyRows.length === 0) {
    return {
      weeklySnapshots: [],
      monthlySnapshots: [],
      latestComment: undefined,
      monthlyStatus: monthlyStatusBase
    };
  }

  const dailyMap = new Map(dailyRows.map((row) => [row.date, row]));

  const aggregateSnapshot = (
    periodType: "weekly" | "monthly",
    periodKey: string,
    startDate: string,
    endDate: string
  ): ClosingSnapshot | null => {
    const rows = dailyRows.filter((row) => row.date >= startDate && row.date <= endDate);
    if (rows.length === 0) return null;
    const endRow = dailyMap.get(endDate) ?? rows[rows.length - 1];
    const income = rows.reduce((sum, row) => sum + row.income, 0);
    const expense = rows.reduce((sum, row) => sum + row.expense, 0);
    const savingsExpense = rows.reduce((sum, row) => sum + row.savingsExpense, 0);
    const transfer = rows.reduce((sum, row) => sum + row.transfer, 0);
    const asset = endRow.totalAsset;
    const netWorth = endRow.netWorth;
    return {
      periodType,
      periodKey,
      startDate,
      endDate,
      asset,
      debt: netWorth - asset,
      netWorth,
      income,
      expense,
      savingsExpense,
      transfer,
      cashflow: income - expense - savingsExpense
    };
  };

  const weeklySnapshots: ClosingSnapshot[] = [];
  let weekCursor = getWeekStartMonday(firstDate);
  while (weekCursor <= today) {
    const weekEnd = addDays(weekCursor, 6);
    if (weekEnd > today) break;
    const start = weekCursor < firstDate ? firstDate : weekCursor;
    const snapshot = aggregateSnapshot("weekly", `${start}~${weekEnd}`, start, weekEnd);
    if (snapshot) weeklySnapshots.push(snapshot);
    weekCursor = addDays(weekCursor, 7);
  }

  const monthlySnapshots: ClosingSnapshot[] = [];
  let monthCursor = getMonthStart(firstDate);
  while (monthCursor <= today) {
    const monthEnd = getMonthEnd(monthCursor);
    if (monthEnd > today) break;
    const start = monthCursor < firstDate ? firstDate : monthCursor;
    const snapshot = aggregateSnapshot("monthly", monthCursor.slice(0, 7), start, monthEnd);
    if (snapshot) monthlySnapshots.push(snapshot);
    monthCursor = addDays(monthEnd, 1);
  }

  let latestComment: MonthlyCloseComment | undefined;
  if (monthlySnapshots.length >= 2) {
    const current = monthlySnapshots[monthlySnapshots.length - 1];
    const previous = monthlySnapshots[monthlySnapshots.length - 2];
    const assetDelta = current.asset - previous.asset;
    const netWorthDelta = current.netWorth - previous.netWorth;
    const cashflowDelta = current.cashflow - previous.cashflow;

    latestComment = {
      month: current.periodKey,
      previousMonth: previous.periodKey,
      assetDelta,
      netWorthDelta,
      cashflowDelta,
      summary:
        netWorthDelta >= 0
          ? `Net worth improved versus ${previous.periodKey}.`
          : `Net worth declined versus ${previous.periodKey}.`
    };
  }

  const currentMonthStart = getMonthStart(today);
  const currentMonthEnd = getMonthEnd(today);
  const elapsedDays = parseIsoLocal(today).getDate();
  const coveredUntil =
    latestActivityDate && latestActivityDate >= currentMonthStart
      ? latestActivityDate > today
        ? today
        : latestActivityDate
      : undefined;
  const coveredDays = coveredUntil ? parseIsoLocal(coveredUntil).getDate() : 0;

  let weeklyExpected = 0;
  let weeklyCompleted = 0;
  let weeklyCountCursor = getWeekStartMonday(currentMonthStart);
  while (weeklyCountCursor <= today) {
    const weekEnd = addDays(weeklyCountCursor, 6);
    if (weekEnd > today) break;
    if (getMonthKey(weekEnd) === getMonthKey(today)) {
      weeklyExpected += 1;
      if (coveredUntil && weekEnd <= coveredUntil) weeklyCompleted += 1;
    }
    weeklyCountCursor = addDays(weeklyCountCursor, 7);
  }

  const monthlyExpected = today >= currentMonthEnd ? 1 : 0;
  const monthlyCompleted = coveredUntil && coveredUntil >= currentMonthEnd ? 1 : 0;

  const expectedClosings = weeklyExpected + monthlyExpected;
  const completedClosings = weeklyCompleted + monthlyCompleted;
  const completionRate =
    expectedClosings > 0
      ? (completedClosings / expectedClosings) * 100
      : elapsedDays > 0
        ? (coveredDays / elapsedDays) * 100
        : 0;

  return {
    weeklySnapshots,
    monthlySnapshots,
    latestComment,
    monthlyStatus: {
      month: today.slice(0, 7),
      completionRate,
      coveredDays,
      elapsedDays,
      coveredUntil,
      expectedClosings,
      completedClosings,
      weeklyExpected,
      weeklyCompleted,
      monthlyExpected,
      monthlyCompleted
    }
  };
}

export function generateAccountPerformanceBreakdown(
  accounts: Account[],
  ledger: LedgerEntry[],
  trades: StockTrade[],
  prices: StockPrice[],
  fxRate?: number
): AccountPerformanceBreakdownRow[] {
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const today = formatIsoLocal(new Date());

  const timelineDates = Array.from(
    new Set<string>([today, ...ledger.map((entry) => entry.date), ...trades.map((trade) => trade.date)])
  )
    .filter(Boolean)
    .sort();

  const valuesByDate = new Map<string, Map<string, number>>();
  for (const date of timelineDates) {
    valuesByDate.set(date, accountValueMapAtDate(accounts, ledger, trades, prices, date, fxRate));
  }

  const flowsByAccountDate = new Map<string, Map<string, number>>();
  const addFlow = (accountId: string, date: string, amount: number) => {
    const accountFlows = flowsByAccountDate.get(accountId) ?? new Map<string, number>();
    accountFlows.set(date, (accountFlows.get(date) ?? 0) + amount);
    flowsByAccountDate.set(accountId, accountFlows);
  };

  for (const entry of ledger) {
    const amount = toKrwAmount(entry.amount, entry.currency, fxRate);
    if (entry.toAccountId) addFlow(entry.toAccountId, entry.date, amount);
    if (entry.fromAccountId) addFlow(entry.fromAccountId, entry.date, -amount);
  }

  const realizedByTradeId = computeRealizedPnlByTradeId(trades);
  const realizedByAccount = new Map<string, number>();
  for (const trade of trades) {
    if (trade.side !== "sell") continue;
    const account = accountById.get(trade.accountId);
    let pnl = realizedByTradeId.get(trade.id) ?? 0;
    pnl = convertPositionAmount(pnl, trade.ticker, account, fxRate);
    realizedByAccount.set(trade.accountId, (realizedByAccount.get(trade.accountId) ?? 0) + pnl);
  }

  const positions = computePositions(trades, prices, accounts);
  const unrealizedByAccount = new Map<string, number>();
  for (const position of positions) {
    const account = accountById.get(position.accountId);
    const converted = convertPositionAmount(position.pnl, position.ticker, account, fxRate);
    unrealizedByAccount.set(
      position.accountId,
      (unrealizedByAccount.get(position.accountId) ?? 0) + converted
    );
  }

  const dividendByAccount = new Map<string, number>();
  for (const entry of ledger) {
    if (!isDividendIncomeEntry(entry) || !entry.toAccountId) continue;
    const amount = toKrwAmount(entry.amount, entry.currency, fxRate);
    dividendByAccount.set(
      entry.toAccountId,
      (dividendByAccount.get(entry.toAccountId) ?? 0) + amount
    );
  }

  const firstDate = timelineDates[0] ?? today;
  const lastDate = timelineDates[timelineDates.length - 1] ?? today;

  const rows: AccountPerformanceBreakdownRow[] = [];

  for (const account of accounts) {
    const accountFlows = flowsByAccountDate.get(account.id) ?? new Map<string, number>();

    const startValue = valuesByDate.get(firstDate)?.get(account.id) ?? 0;
    const endValue = valuesByDate.get(lastDate)?.get(account.id) ?? 0;

    const irrFlows: CashFlowItem[] = [];
    if (Math.abs(startValue) > 0.000001) {
      irrFlows.push({ date: firstDate, amount: -startValue });
    }
    for (const date of timelineDates) {
      const externalFlow = accountFlows.get(date) ?? 0;
      if (Math.abs(externalFlow) <= 0.000001) continue;
      irrFlows.push({ date, amount: -externalFlow });
    }
    if (Math.abs(endValue) > 0.000001) {
      irrFlows.push({ date: lastDate, amount: endValue });
    }

    const irr = xirr(irrFlows) ?? undefined;

    let factor = 1;
    let periods = 0;
    for (let i = 1; i < timelineDates.length; i += 1) {
      const prevDate = timelineDates[i - 1];
      const date = timelineDates[i];
      const prevValue = valuesByDate.get(prevDate)?.get(account.id) ?? 0;
      const currentValue = valuesByDate.get(date)?.get(account.id) ?? 0;
      const flowOnDate = accountFlows.get(date) ?? 0;
      if (prevValue <= 0) continue;

      const periodReturn = (currentValue - flowOnDate) / prevValue - 1;
      if (!Number.isFinite(periodReturn)) continue;
      if (periodReturn <= -0.999999) continue;

      factor *= 1 + periodReturn;
      periods += 1;
    }

    const ttwr = periods > 0 ? factor - 1 : undefined;

    const realizedPnl = realizedByAccount.get(account.id) ?? 0;
    const unrealizedPnl = unrealizedByAccount.get(account.id) ?? 0;
    const dividendContribution = dividendByAccount.get(account.id) ?? 0;
    const totalContribution = realizedPnl + unrealizedPnl + dividendContribution;

    rows.push({
      accountId: account.id,
      accountName: account.name,
      currentValue: endValue,
      irr,
      ttwr,
      realizedPnl,
      unrealizedPnl,
      dividendContribution,
      totalContribution
    });
  }

  return rows.sort((a, b) => b.currentValue - a.currentValue);
}

export function generateConsumptionImpactMonthlyReport(
  ledger: LedgerEntry[],
  accounts: Account[],
  startMonth?: string,
  endMonth?: string,
  fxRate?: number
): ConsumptionImpactMonthlyRow[] {
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  const availableMonths = Array.from(new Set(ledger.map((entry) => entry.date.slice(0, 7)))).sort();
  const rangeStart = startMonth ?? availableMonths[0];
  const rangeEnd = endMonth ?? availableMonths[availableMonths.length - 1];
  if (!rangeStart || !rangeEnd) return [];

  const months = buildMonthRange(rangeStart, rangeEnd);
  const rows = new Map<string, { income: number; consumptionExpense: number; actualInvested: number }>();
  for (const month of months) {
    rows.set(month, { income: 0, consumptionExpense: 0, actualInvested: 0 });
  }

  for (const entry of ledger) {
    const month = entry.date.slice(0, 7);
    if (month < rangeStart || month > rangeEnd) continue;

    const row = rows.get(month);
    if (!row) continue;

    const amount = toKrwAmount(entry.amount, entry.currency, fxRate);

    if (entry.kind === "income") {
      row.income += amount;
      continue;
    }

    if (entry.kind === "expense") {
      if (isSavingsExpenseEntry(entry, accounts)) {
        row.actualInvested += amount;
      } else if (entry.category === "재테크") {
        // 투자손실
        row.consumptionExpense += amount;
      } else {
        row.consumptionExpense += amount;
      }
      continue;
    }

    if (entry.kind === "transfer" && (
      entry.subCategory === "저축이체" || entry.subCategory === "투자이체" ||
      entry.subCategory === "저축" || entry.subCategory === "투자"
    )) {
      row.actualInvested += amount;
      continue;
    }

    if (entry.kind === "transfer") {
      const fromAccount = entry.fromAccountId ? accountById.get(entry.fromAccountId) : undefined;
      const toAccount = entry.toAccountId ? accountById.get(entry.toAccountId) : undefined;
      const fromInvesting = !!fromAccount && INVESTING_ACCOUNT_TYPES.has(fromAccount.type);
      const toInvesting = !!toAccount && INVESTING_ACCOUNT_TYPES.has(toAccount.type);

      if (!fromInvesting && toInvesting) row.actualInvested += amount;
      else if (fromInvesting && !toInvesting) row.actualInvested -= amount;
    }
  }

  return months.map((month) => {
    const row = rows.get(month)!;
    const investmentCapacity = row.income - row.consumptionExpense;
    const capacityGap = investmentCapacity - row.actualInvested;
    const capacityUtilizationRate =
      investmentCapacity > 0 ? (row.actualInvested / investmentCapacity) * 100 : null;

    return {
      month,
      income: row.income,
      consumptionExpense: row.consumptionExpense,
      investmentCapacity,
      actualInvested: row.actualInvested,
      capacityGap,
      capacityUtilizationRate
    };
  });
}

// ---------------------------------------------------------------------------
// 종합 월간 보고서 (Comprehensive Monthly Summary)
// ---------------------------------------------------------------------------

/** 수입 카테고리 분류: 허수(정산/용돈/원래 보유 자산/대출/처분소득/지원)를 걸러낸 진짜 수입 */
const NON_REAL_INCOME_CATEGORIES = new Set([
  "정산", "용돈", "이월", "원래 보유 자산", "대출", "처분소득", "지원"
]);

/** 자본소득 카테고리 (근로소득과 분리) */
const CAPITAL_INCOME_CATEGORIES = new Set([
  "배당", "이자", "투자수익"
]);

export interface ComprehensiveMonthlyRow {
  month: string;

  // ── 수입 ──
  totalIncome: number;          // 전체 수입 (장부 기준)
  earnedIncome: number;         // 근로소득 (급여/수당/상여/부수익/기타수입)
  capitalIncome: number;        // 자본소득 (배당/이자/투자수익)
  nonRealIncome: number;        // 허수 수입 (정산/용돈/원래 보유 자산/대출/처분소득/지원)

  // ── 지출 ──
  totalExpense: number;         // 전체 지출 (장부 기준)
  livingExpense: number;        // 생활소비 (재테크/신용결제 제외)
  savingsExpense: number;       // 저축성 지출 (재테크)
  creditPayment: number;        // 신용카드 결제 (이중계산 제외용)

  // ── 이체 ──
  transferTotal: number;        // 이체 총액
  investingIn: number;          // 투자계좌로 이체
  investingOut: number;         // 투자계좌에서 출금

  // ── 투자 성과 (해당 월) ──
  realizedPnl: number;          // 실현 손익 (매도)
  dividendIncome: number;       // 배당 수입 (수입 중 배당 카테고리)
  tradeCount: number;           // 매매 건수
  buyAmount: number;            // 매수 총액
  sellAmount: number;           // 매도 총액

  // ── 대출 ──
  loanRepayment: number;        // 대출상환 지출
  loanInterest: number;         // 대출이자 (주담대이자 등)

  // ── 핵심 지표 ──
  realNet: number;              // 진짜 순수입 = 근로소득 - 생활소비
  realSavingsRate: number | null; // 진짜 저축률 = realNet / earnedIncome (%)
  totalNet: number;             // 장부 순수입 = totalIncome - totalExpense
}

export function generateComprehensiveMonthlyReport(
  ledger: LedgerEntry[],
  trades: StockTrade[],
  accounts: Account[],
  startMonth?: string,
  endMonth?: string,
  fxRate?: number
): ComprehensiveMonthlyRow[] {
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  // 월 범위 결정
  const allMonths = new Set<string>();
  for (const e of ledger) allMonths.add(e.date.slice(0, 7));
  for (const t of trades) allMonths.add(t.date.slice(0, 7));
  const sorted = Array.from(allMonths).sort();
  const rangeStart = startMonth ?? sorted[0];
  const rangeEnd = endMonth ?? sorted[sorted.length - 1];
  if (!rangeStart || !rangeEnd) return [];

  const months = buildMonthRange(rangeStart, rangeEnd);

  // 초기화
  type Accum = Omit<ComprehensiveMonthlyRow, "month" | "realNet" | "realSavingsRate" | "totalNet">;
  const rows = new Map<string, Accum>();
  for (const m of months) {
    rows.set(m, {
      totalIncome: 0, earnedIncome: 0, capitalIncome: 0, nonRealIncome: 0,
      totalExpense: 0, livingExpense: 0, savingsExpense: 0, creditPayment: 0,
      transferTotal: 0, investingIn: 0, investingOut: 0,
      realizedPnl: 0, dividendIncome: 0, tradeCount: 0, buyAmount: 0, sellAmount: 0,
      loanRepayment: 0, loanInterest: 0
    });
  }

  // 가계부 집계
  for (const entry of ledger) {
    const month = entry.date.slice(0, 7);
    if (month < rangeStart || month > rangeEnd) continue;
    const row = rows.get(month);
    if (!row) continue;

    const amount = toKrwAmount(entry.amount, entry.currency, fxRate);

    if (entry.kind === "income") {
      row.totalIncome += amount;
      const cat = entry.category ?? "";
      const sub = entry.subCategory ?? "";

      if (NON_REAL_INCOME_CATEGORIES.has(cat) || NON_REAL_INCOME_CATEGORIES.has(sub)) {
        row.nonRealIncome += amount;
      } else if (CAPITAL_INCOME_CATEGORIES.has(cat) || CAPITAL_INCOME_CATEGORIES.has(sub)) {
        row.capitalIncome += amount;
        // 배당 수입 별도 집계
        if (cat === "배당" || isDividendIncomeEntry(entry)) {
          row.dividendIncome += amount;
        }
      } else {
        row.earnedIncome += amount;
        // 배당 키워드가 설명에 있을 수 있음
        if (isDividendIncomeEntry(entry) && cat !== "배당") {
          row.dividendIncome += amount;
        }
      }
      continue;
    }

    if (entry.kind === "expense") {
      row.totalExpense += amount;
      const cat = entry.category ?? "";
      const sub = entry.subCategory ?? "";
      const detail = entry.detailCategory ?? "";
      // 대출상환: 현재 구조 (지출/대출상환/학자금대출 등) + 구버전 (category=대출상환)
      const isLoanRepay =
        cat === "대출상환" ||
        (cat === "지출" && sub === "대출상환");
      const isInterest =
        sub.includes("이자") || sub === "주담대이자" ||
        detail.includes("이자");

      if (cat === "재테크") {
        // 투자손실
        row.livingExpense += amount;
      } else if (isSavingsExpenseEntry(entry, accounts)) {
        row.savingsExpense += amount;
      } else if (cat === "신용결제" || cat === "신용카드") {
        row.creditPayment += amount;
      } else if (isLoanRepay) {
        row.loanRepayment += amount;
        if (isInterest) row.loanInterest += amount;
        row.livingExpense += amount;
      } else if (cat === "주거비" && sub === "주담대이자") {
        row.loanInterest += amount;
        row.livingExpense += amount;
      } else {
        row.livingExpense += amount;
      }
      continue;
    }

    if (entry.kind === "transfer") {
      row.transferTotal += amount;
      const fromAccount = entry.fromAccountId ? accountById.get(entry.fromAccountId) : undefined;
      const toAccount = entry.toAccountId ? accountById.get(entry.toAccountId) : undefined;
      // 카드 계좌로의 이체 = 신용결제 (카드 대금 납부)
      if (toAccount && toAccount.type === "card") {
        row.creditPayment += amount;
      }
      const fromInvesting = !!fromAccount && INVESTING_ACCOUNT_TYPES.has(fromAccount.type);
      const toInvesting = !!toAccount && INVESTING_ACCOUNT_TYPES.has(toAccount.type);
      if (!fromInvesting && toInvesting) row.investingIn += amount;
      if (fromInvesting && !toInvesting) row.investingOut += amount;
    }
  }

  // 매매 집계 (월별)
  const realizedByTradeId = computeRealizedPnlByTradeId(trades);
  for (const trade of trades) {
    const month = trade.date.slice(0, 7);
    if (month < rangeStart || month > rangeEnd) continue;
    const row = rows.get(month);
    if (!row) continue;

    const account = accountById.get(trade.accountId);
    const amount = convertPositionAmount(trade.totalAmount, trade.ticker, account, fxRate);

    row.tradeCount += 1;
    if (trade.side === "buy") {
      row.buyAmount += amount;
    } else {
      row.sellAmount += amount;
      let pnl = realizedByTradeId.get(trade.id) ?? 0;
      pnl = convertPositionAmount(pnl, trade.ticker, account, fxRate);
      row.realizedPnl += pnl;
    }
  }

  // 최종 행 생성
  return months.map((month) => {
    const r = rows.get(month)!;
    const realNet = r.earnedIncome - r.livingExpense;
    const realSavingsRate = r.earnedIncome > 0 ? (realNet / r.earnedIncome) * 100 : null;
    const totalNet = r.totalIncome - r.totalExpense;

    return { month, ...r, realNet, realSavingsRate, totalNet };
  });
}

export function reportToCSV<T extends object>(report: T[]): string {
  if (report.length === 0) return "";

  const firstRow = report[0] as Record<string, unknown>;
  const headers = Object.keys(firstRow);
  const rows = report.map((row) =>
    headers.map((header) => {
      const value = (row as Record<string, unknown>)[header];
      if (typeof value === "number") return value.toLocaleString();
      return String(value ?? "");
    })
  );

  return [headers, ...rows]
    .map((row) => row.map((cell) => `"${cell}"`).join(","))
    .join("\n");
}
