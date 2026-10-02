// ---------------------------------------------------------------------------
// reportGenerator 분해 — 일별 리포트 및 결산(주간/월간 마감, ClosingReportSection용).
// (순수 이동만 — 로직 변경 없음. 원본 src/utils/reportGenerator.ts 참조)
// ---------------------------------------------------------------------------

import type { Account, LedgerEntry, Loan, StockPrice, StockTrade } from "../../types";
import { computeAccountBalances, computeBalanceSheet, computePositions } from "../../calculations";
import { getTodayKST } from "../date";
import { isSavingsExpenseEntry, isCreditPayment, isInvestmentEntry } from "../category";
import { toKrwAmount } from "./shared";

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

function getWeekStartMonday(date: string): string {
  const d = parseIsoLocal(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return formatIsoLocal(d);
}

export function generateDailyReport(
  accounts: Account[],
  ledger: LedgerEntry[],
  trades: StockTrade[],
  prices: StockPrice[],
  startDate?: string,
  endDate?: string,
  fxRate?: number,
  /** 대출 잔금을 순자산에서 빼기 위해 필요 — 없으면 대출 미반영(구버전 호출 호환) */
  loans?: Loan[]
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

    // 저축/투자 이체 + 저축성지출(투자손실 제외 — isSavingsExpenseEntry 내부에서 처리됨).
    // 재테크 이체 판정은 isInvestmentEntry 단일 소스 — 4값 리터럴 재나열 금지(INVESTMENT_TRANSFER_SUBS 복붙 이력)
    const daySavingsExpense = filteredLedger
      .filter((entry) => entry.date === date && (
        isSavingsExpenseEntry(entry, accounts) || isInvestmentEntry(entry)
      ))
      .reduce((sum, entry) => sum + toKrwAmount(entry.amount, entry.currency, fxRate), 0);

    // 일반 이체 (저축이체/투자이체 제외 — savings로 따로 집계됨)
    const dayTransfer = filteredLedger
      .filter((entry) => entry.kind === "transfer" && entry.date === date && !isInvestmentEntry(entry))
      .reduce((sum, entry) => sum + toKrwAmount(entry.amount, entry.currency, fxRate), 0);

    const positions = computePositions(filteredTrades, prices, accounts);
    const balances = computeAccountBalances(accounts, filteredLedger, filteredTrades);

    // 총자산·순자산과 그 분해(주식/현금/저축)는 모두 앱 공용 대차 정의(computeBalanceSheet) 한 장에서 —
    // 그날까지의 잔액·포지션·대출 잔금 기준. 분해를 계좌 타입별 총액으로 따로 구하면 마이너스 통장(현금에 음수로
    // 섞임)·account.debt·환율 미로드 USD 처리가 총자산과 달라 "주식+현금+저축 ≠ 총자산"이 된다.
    const sheet = computeBalanceSheet(balances, positions, fxRate, loans, filteredLedger, date);
    const totalAsset = sheet.totalAssets;
    const netWorth = sheet.netWorth;
    const stockValue = sheet.investedValue;
    const savingsValue = sheet.savings;
    const cashValue = totalAsset - stockValue - savingsValue;

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
  fxRate?: number,
  loans?: Loan[]
): ClosingReportData {
  const today = getTodayKST();
  const allDates = [...ledger.map((entry) => entry.date), ...trades.map((trade) => trade.date)]
    .filter(Boolean)
    .sort();
  const firstDate = allDates[0] ?? today;
  const latestActivityDate = allDates.length > 0 ? allDates[allDates.length - 1] : undefined;

  const dailyRows = generateDailyReport(accounts, ledger, trades, prices, firstDate, today, fxRate, loans);

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
