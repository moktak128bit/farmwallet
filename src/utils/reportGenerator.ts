import type { Account, LedgerEntry, StockPrice, StockTrade } from "../types";
import {
  computeAccountBalances,
  computePositions,
  computeRealizedPnlDetailByTradeId
} from "../calculations";
import { buildClosedTradeRecords } from "./investmentRecord";
import { getTodayKST } from "./date";
import { isSavingsExpenseEntry, isCreditPayment } from "./category";
import { isDividendEntry, isInterestEntry } from "./categoryMatch";
import { canonicalTickerForMatch, isUSDStock } from "./finance";
import { computeMonthlyRealFlows, computeRealSavingsRate } from "./savingsRate";
import { isNonRealIncomeSub } from "./realIncome";
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

/**
 * 매도 건별 실현손익(KRW) — lot별 거래시점 환율(fxRateAtTrade) 기준.
 * 대시보드·투자기록 카드(buildClosedTradeRecords)와 동일 정의로 통일 —
 * 과거 USD 매도를 '현재' 환율로 환산하면 환변동분이 손익에 섞여 화면마다 값이 달라짐(불변식: 과거손익 보존).
 */
function realizedPnlKRWByTradeId(trades: StockTrade[], accounts: Account[], fxRate?: number): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of buildClosedTradeRecords(trades, accounts, fxRate)) m.set(r.tradeId, r.realizedPnlKRW);
  return m;
}

/** 배당 수입 판정 — categoryMatch 단일 진입점 (category/subCategory 정확 매칭, 위양성 방지) */
function isDividendIncomeEntry(entry: LedgerEntry): boolean {
  return entry.kind === "income" && isDividendEntry(entry);
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
    if (entry.kind === "expense" && !isCreditPayment(entry)) report.expense += entry.amount;
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
    if (entry.kind === "expense" && !isCreditPayment(entry)) report.expense += entry.amount;
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
  const today = getTodayKST();

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

      // 배당·이자 판정 — categoryMatch 단일 진입점 (substring 위양성 방지)
      return isDividendEntry(entry) || isInterestEntry(entry);
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

    // 신용결제(레거시)는 카드 사용 시점에 이미 잡힘 — 월별/연간과 동일 기준으로 제외 (이중계상 방지)
    const dayExpense = filteredLedger
      .filter(
        (entry) =>
          entry.kind === "expense" &&
          !isCreditPayment(entry) &&
          !isSavingsExpenseEntry(entry, accounts) &&
          entry.date === date
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
  const today = getTodayKST();
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
      // 순자산 = 자산 − 부채 ⇒ 부채 = 자산 − 순자산 (양수)
      debt: asset - netWorth,
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
          ? `${previous.periodKey} 대비 순자산이 늘었습니다.`
          : `${previous.periodKey} 대비 순자산이 줄었습니다.`
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
  const today = getTodayKST();

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

  const realizedByTradeId = realizedPnlKRWByTradeId(trades, accounts, fxRate);
  const realizedByAccount = new Map<string, number>();
  for (const trade of trades) {
    if (trade.side !== "sell") continue;
    // pnl은 이미 거래시점 환율로 KRW 환산됨 — convertPositionAmount(현재환율) 재적용 금지
    const pnl = realizedByTradeId.get(trade.id) ?? 0;
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

// ---------------------------------------------------------------------------
// 투자 정산 (Investment reconciliation)
// 규칙: 주식·코인 계좌를 하나의 "투자 세계"로 보고, 자본 흐름과 손익을 분리해 정산.
//   투자 총성과 = 현재 평가액 − 순투입원금
//   순투입원금  = 투자계좌 초기자본 + 누적 입금(이체) − 누적 출금(이체, 생활비 회수 포함)
// 매수/매도 총액은 계좌 안에서 현금↔주식 형태만 바꾼 "거래량"이라 손익·정산에 들어가지 않음.
// ---------------------------------------------------------------------------

/** 투자 정산 — 투자 계좌(주식·코인)만 집계 대상으로 삼는다 */
const RECONCILIATION_ACCOUNT_TYPES = new Set<Account["type"]>(["securities", "crypto"]);

export interface InvestmentReconciliationAccountRow {
  accountId: string;
  accountName: string;
  /** 초기자본 + 입금 − 출금 (계좌 간 이체 포함) */
  netContributed: number;
  currentValue: number;
  /** currentValue − netContributed */
  totalReturn: number;
  realizedPnl: number;
  unrealizedPnl: number;
  dividendIncome: number;
  irr?: number | null;
}

/** 보유 종목의 미실현 손익 (평가수익·평가손실 공통) */
export interface InvestmentPositionPnlRow {
  accountName: string;
  ticker: string;
  name: string;
  /** 미실현 손익 (KRW) */
  pnl: number;
  /** 손익률 (비율, 예: -0.12 = −12%) */
  pnlRate: number;
}

/** 월별 실현손익 (이익·손실 분리) */
export interface InvestmentMonthlyPnlRow {
  month: string; // yyyy-mm
  realizedGain: number;
  realizedLoss: number; // 0 이하
}

/** 확정(매도 완료)된 거래 한 건 */
export interface InvestmentRealizedTradeRow {
  date: string; // 매도일
  accountName: string;
  ticker: string;
  name: string;
  /** 실현손익 (KRW) */
  pnl: number;
  /** 매수원가 대비 수익률 (비율, 예: -0.12 = −12%) */
  returnRate: number;
}

export interface InvestmentReconciliation {
  /** 집계 대상 투자 계좌가 하나라도 있는지 */
  hasData: boolean;
  // ── 자본 흐름 ──
  initialCapital: number;
  deposits: number;
  withdrawals: number;
  netContributed: number;
  currentValue: number;
  totalReturn: number;
  returnRate: number | null;
  irr: number | null;
  // ── 손익 분해 (순액) ──
  realizedPnl: number;
  unrealizedPnl: number;
  dividendIncome: number;
  pnlSum: number;
  /** totalReturn − pnlSum: 초기 보유분·계좌 입금 수입 등으로 설명되지 않는 차이 */
  residual: number;
  // ── 이익/손실 총액 (상계 전) ──
  realizedGain: number;     // 이익 본 매도 합계 (≥ 0)
  realizedLoss: number;     // 손실 본 매도 합계 (≤ 0)
  winningTrades: InvestmentRealizedTradeRow[];  // 확정수익 거래
  losingTrades: InvestmentRealizedTradeRow[];   // 확정손실 거래
  unrealizedGain: number;   // 평가이익 종목 합계 (≥ 0)
  unrealizedLoss: number;   // 평가손실 종목 합계 (≤ 0)
  winningPositions: InvestmentPositionPnlRow[];
  losingPositions: InvestmentPositionPnlRow[];
  monthlyPnl: InvestmentMonthlyPnlRow[];
  // ── 거래 활동량 (참고: 손익 아님) ──
  buyVolume: number;
  sellVolume: number;
  tradeCount: number;
  accounts: InvestmentReconciliationAccountRow[];
}

/**
 * 투자 정산표 계산. accountPerformance(전체 기간 계좌 성과 분해)를 입력으로 받아
 * 평가액·실현/미실현/배당을 재사용하고, 자본 흐름(입금·출금·초기자본)만 추가로 계산한다.
 */
export function computeInvestmentReconciliation(
  accounts: Account[],
  ledger: LedgerEntry[],
  trades: StockTrade[],
  prices: StockPrice[],
  accountPerformance: AccountPerformanceBreakdownRow[],
  fxRate?: number
): InvestmentReconciliation {
  const empty: InvestmentReconciliation = {
    hasData: false,
    initialCapital: 0, deposits: 0, withdrawals: 0, netContributed: 0,
    currentValue: 0, totalReturn: 0, returnRate: null, irr: null,
    realizedPnl: 0, unrealizedPnl: 0, dividendIncome: 0, pnlSum: 0, residual: 0,
    realizedGain: 0, realizedLoss: 0, unrealizedGain: 0, unrealizedLoss: 0,
    winningTrades: [], losingTrades: [],
    winningPositions: [], losingPositions: [], monthlyPnl: [],
    buyVolume: 0, sellVolume: 0, tradeCount: 0, accounts: []
  };

  const investingAccounts = accounts.filter((a) => RECONCILIATION_ACCOUNT_TYPES.has(a.type));
  if (investingAccounts.length === 0) return empty;

  const investingIds = new Set(investingAccounts.map((a) => a.id));
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const perfById = new Map(accountPerformance.map((r) => [r.accountId, r]));

  // 초기자본 C0 — 어떤 거래도 반영되기 전 투자계좌의 기본 잔액
  const earlyMap = accountValueMapAtDate(accounts, ledger, trades, prices, "1900-01-01", fxRate);
  const contributedByAccount = new Map<string, number>();
  let initialCapital = 0;
  for (const a of investingAccounts) {
    const base = earlyMap.get(a.id) ?? 0;
    contributedByAccount.set(a.id, base);
    initialCapital += base;
  }

  // 입금·출금 — 투자계좌 경계를 넘는 이체(transfer)만 집계
  let deposits = 0;
  let withdrawals = 0;
  const netFlowByDate = new Map<string, number>(); // 투자 세계로의 순유입 (IRR용)
  for (const entry of ledger) {
    if (entry.kind !== "transfer") continue;
    const amount = toKrwAmount(entry.amount, entry.currency, fxRate);
    if (!(amount > 0)) continue;
    const fromInv = !!entry.fromAccountId && investingIds.has(entry.fromAccountId);
    const toInv = !!entry.toAccountId && investingIds.has(entry.toAccountId);
    if (toInv) {
      contributedByAccount.set(entry.toAccountId!, (contributedByAccount.get(entry.toAccountId!) ?? 0) + amount);
    }
    if (fromInv) {
      contributedByAccount.set(entry.fromAccountId!, (contributedByAccount.get(entry.fromAccountId!) ?? 0) - amount);
    }
    if (toInv && !fromInv) {
      deposits += amount;
      netFlowByDate.set(entry.date, (netFlowByDate.get(entry.date) ?? 0) + amount);
    }
    if (fromInv && !toInv) {
      withdrawals += amount;
      netFlowByDate.set(entry.date, (netFlowByDate.get(entry.date) ?? 0) - amount);
    }
  }

  // 평가액·손익 — accountPerformance 재사용
  let currentValue = 0;
  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let dividendIncome = 0;
  const accountRows: InvestmentReconciliationAccountRow[] = investingAccounts.map((a) => {
    const perf = perfById.get(a.id);
    const cv = perf?.currentValue ?? 0;
    const nc = contributedByAccount.get(a.id) ?? 0;
    const realized = perf?.realizedPnl ?? 0;
    const unrealized = perf?.unrealizedPnl ?? 0;
    const dividend = perf?.dividendContribution ?? 0;
    currentValue += cv;
    realizedPnl += realized;
    unrealizedPnl += unrealized;
    dividendIncome += dividend;
    return {
      accountId: a.id,
      accountName: a.name,
      netContributed: nc,
      currentValue: cv,
      totalReturn: cv - nc,
      realizedPnl: realized,
      unrealizedPnl: unrealized,
      dividendIncome: dividend,
      irr: perf?.irr ?? null
    };
  });
  accountRows.sort((a, b) => b.currentValue - a.currentValue);

  // 거래 활동량 + 실현손익 이익/손실 분리 + 확정 거래 목록 + 월별 추이
  const realizedDetailByTradeId = computeRealizedPnlDetailByTradeId(trades);
  let buyVolume = 0;
  let sellVolume = 0;
  let tradeCount = 0;
  let realizedGain = 0;
  let realizedLoss = 0;
  const winningTrades: InvestmentRealizedTradeRow[] = [];
  const losingTrades: InvestmentRealizedTradeRow[] = [];
  const monthlyPnlMap = new Map<string, { gain: number; loss: number }>();
  for (const t of trades) {
    if (!investingIds.has(t.accountId)) continue;
    const account = accountById.get(t.accountId);
    const amount = convertPositionAmount(t.totalAmount, t.ticker, account, fxRate);
    tradeCount += 1;
    if (t.side === "buy") {
      buyVolume += amount;
      continue;
    }
    sellVolume += amount;
    const detail = realizedDetailByTradeId.get(t.id);
    const rawPnl = detail?.pnl ?? 0;
    const costBasis = detail?.costBasis ?? 0;
    const pnl = convertPositionAmount(rawPnl, t.ticker, account, fxRate);
    const month = t.date.slice(0, 7);
    const bucket = monthlyPnlMap.get(month) ?? { gain: 0, loss: 0 };
    if (pnl >= 0) {
      realizedGain += pnl;
      bucket.gain += pnl;
    } else {
      realizedLoss += pnl;
      bucket.loss += pnl;
    }
    monthlyPnlMap.set(month, bucket);
    const tradeRow: InvestmentRealizedTradeRow = {
      date: t.date,
      accountName: account?.name ?? t.accountId,
      ticker: t.ticker,
      name: t.name,
      pnl,
      returnRate: costBasis > 0 ? rawPnl / costBasis : 0
    };
    if (pnl >= 0) winningTrades.push(tradeRow);
    else losingTrades.push(tradeRow);
  }
  winningTrades.sort((a, b) => b.pnl - a.pnl); // 수익 큰 거래 먼저
  losingTrades.sort((a, b) => a.pnl - b.pnl); // 손실 큰 거래 먼저
  const monthlyPnl: InvestmentMonthlyPnlRow[] = Array.from(monthlyPnlMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => ({ month, realizedGain: v.gain, realizedLoss: v.loss }));

  // 미실현 손익 이익/손실 분리 + 평가수익·평가손실 종목 목록
  let unrealizedGain = 0;
  let unrealizedLoss = 0;
  const winningPositions: InvestmentPositionPnlRow[] = [];
  const losingPositions: InvestmentPositionPnlRow[] = [];
  for (const p of computePositions(trades, prices, accounts)) {
    if (!investingIds.has(p.accountId)) continue;
    const account = accountById.get(p.accountId);
    const pnl = convertPositionAmount(p.pnl, p.ticker, account, fxRate);
    const row: InvestmentPositionPnlRow = {
      accountName: account?.name ?? p.accountId,
      ticker: p.ticker,
      name: p.name,
      pnl,
      pnlRate: p.pnlRate
    };
    if (pnl > 0) {
      unrealizedGain += pnl;
      winningPositions.push(row);
    } else if (pnl < 0) {
      unrealizedLoss += pnl;
      losingPositions.push(row);
    }
  }
  winningPositions.sort((a, b) => b.pnl - a.pnl); // 수익 큰 종목 먼저
  losingPositions.sort((a, b) => a.pnl - b.pnl); // 손실 큰 종목 먼저

  const netContributed = initialCapital + deposits - withdrawals;
  const totalReturn = currentValue - netContributed;
  const pnlSum = realizedPnl + unrealizedPnl + dividendIncome;

  // 포트폴리오 IRR — 초기자본·이체 순유입을 음(−), 현재 평가액을 양(+)으로
  const today = getTodayKST();
  let firstDate = today;
  for (const e of ledger) if (e.date && e.date < firstDate) firstDate = e.date;
  for (const t of trades) if (t.date && t.date < firstDate) firstDate = t.date;
  const irrFlows: CashFlowItem[] = [];
  if (Math.abs(initialCapital) > 0.000001) irrFlows.push({ date: firstDate, amount: -initialCapital });
  for (const [date, net] of Array.from(netFlowByDate.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    if (Math.abs(net) > 0.000001) irrFlows.push({ date, amount: -net });
  }
  if (Math.abs(currentValue) > 0.000001) irrFlows.push({ date: today, amount: currentValue });
  const irr = irrFlows.length >= 2 ? (xirr(irrFlows) ?? null) : null;

  return {
    hasData: true,
    initialCapital,
    deposits,
    withdrawals,
    netContributed,
    currentValue,
    totalReturn,
    returnRate: netContributed > 0 ? totalReturn / netContributed : null,
    irr,
    realizedPnl,
    unrealizedPnl,
    dividendIncome,
    pnlSum,
    residual: totalReturn - pnlSum,
    realizedGain,
    realizedLoss,
    winningTrades,
    losingTrades,
    unrealizedGain,
    unrealizedLoss,
    winningPositions,
    losingPositions,
    monthlyPnl,
    buyVolume,
    sellVolume,
    tradeCount,
    accounts: accountRows
  };
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
      // 신용결제는 카드 사용 시점에 이미 잡힘 — 이중계상 방지
      if (isCreditPayment(entry)) continue;
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

/** 수입 카테고리 분류: 허수(정산/환불/용돈/대출 등)를 걸러낸 진짜 수입 — utils/realIncome 단일 소스 */

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
  livingExpense: number;        // 생활소비 (재테크/신용결제/대출상환 제외 — 대출상환은 loanRepayment에 별도 집계)
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

  // ── 핵심 지표 (실질 기준 — utils/savingsRate.computeMonthlyRealFlows 단일 소스) ──
  realIncome: number;           // 실질수입 (정산·일시소득·이월 제외, USD 환산)
  realExpense: number;          // 실질지출 (환전·신용결제·재테크 제외, 투자손실 포함, 데이트 50% 차감)
  realNet: number;              // 실질 순수입 = 실질수입 − 실질지출
  realSavingsRate: number | null; // 실질 저축률 = realNet / 실질수입 (%) — 실질수입 0이면 null
  totalNet: number;             // 장부 순수입 = totalIncome - totalExpense
}

export function generateComprehensiveMonthlyReport(
  ledger: LedgerEntry[],
  trades: StockTrade[],
  accounts: Account[],
  startMonth?: string,
  endMonth?: string,
  fxRate?: number,
  dateAccountId?: string | null,
  nonRealIncomeOverride?: string[]
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
  type Accum = Omit<ComprehensiveMonthlyRow, "month" | "realIncome" | "realExpense" | "realNet" | "realSavingsRate" | "totalNet">;
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

      if (isNonRealIncomeSub(cat) || isNonRealIncomeSub(sub)) {
        row.nonRealIncome += amount;
      } else if (CAPITAL_INCOME_CATEGORIES.has(cat) || CAPITAL_INCOME_CATEGORIES.has(sub)) {
        row.capitalIncome += amount;
        // 배당 수입 별도 집계
        if (cat === "배당" || isDividendIncomeEntry(entry)) {
          row.dividendIncome += amount;
        }
      } else {
        row.earnedIncome += amount;
        // 비표준 표기(예: "수입-배당")가 카테고리에 남아있을 수 있음
        if (isDividendIncomeEntry(entry) && cat !== "배당") {
          row.dividendIncome += amount;
        }
      }
      continue;
    }

    if (entry.kind === "expense") {
      // 신용결제는 카드 사용 시점에 이미 잡힘 — 이중계상 방지
      if (isCreditPayment(entry)) continue;
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

      // 저축성지출 판정을 재테크 분기보다 먼저 — 구버전(kind=expense, category=재테크,
      // sub=저축/투자) 항목이 생활소비로 오분류되지 않도록 (consumptionImpact·daily와 동일 순서)
      if (isSavingsExpenseEntry(entry, accounts)) {
        row.savingsExpense += amount;
      } else if (cat === "재테크") {
        // 투자손실 — 실질 지출 성격
        row.livingExpense += amount;
      } else if (cat === "신용결제" || cat === "신용카드") {
        row.creditPayment += amount;
      } else if (isLoanRepay) {
        // 대출상환은 loanRepayment에만 집계 — livingExpense와 이중 가산 금지
        row.loanRepayment += amount;
        if (isInterest) row.loanInterest += amount;
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
  const realizedByTradeId = realizedPnlKRWByTradeId(trades, accounts, fxRate);
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
      // pnl은 이미 거래시점 환율로 KRW 환산됨 — convertPositionAmount(현재환율) 재적용 금지
      row.realizedPnl += realizedByTradeId.get(trade.id) ?? 0;
    }
  }

  // 월별 실질수입/실질지출 — utils/savingsRate 단일 소스 (인사이트 실질 저축률과 동일 정의)
  const realFlows = computeMonthlyRealFlows(ledger, {
    fxRate: fxRate ?? null,
    dateAccountId: dateAccountId ?? null,
    startMonth: rangeStart,
    endMonth: rangeEnd,
    nonRealIncomeOverride
  });

  // 최종 행 생성
  return months.map((month) => {
    const r = rows.get(month)!;
    const rf = realFlows.get(month);
    const realIncome = rf?.realIncome ?? 0;
    const realExpense = rf?.realExpense ?? 0;
    const realNet = realIncome - realExpense;
    const realSavingsRate = computeRealSavingsRate(realIncome, realExpense);
    const totalNet = r.totalIncome - r.totalExpense;

    return { month, ...r, realIncome, realExpense, realNet, realSavingsRate, totalNet };
  });
}
