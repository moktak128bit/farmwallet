// ---------------------------------------------------------------------------
// reportGenerator 분해 — 월간/연간/카테고리/주식/계좌 기본 리포트.
// (순수 이동만 — 로직 변경 없음. 원본 src/utils/reportGenerator.ts 참조)
// ---------------------------------------------------------------------------

import type { Account, LedgerEntry, StockPrice, StockTrade } from "../../types";
import { computeAccountBalances, computePositions, positionMarketValueKRW } from "../../calculations";
import { getTodayKST } from "../date";
import { isSavingsExpenseEntry, isCreditPayment } from "../category";
import { expenseMainName } from "../categoryMerge";
import { isDividendEntry, isInterestEntry } from "../categoryMatch";
import { canonicalTickerForMatch } from "../finance";
import { toKrwByRate } from "../currency";
import { isExcludedIncomeEntry } from "../savingsRate";
import { xirr, type CashFlowItem } from "../irr";

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

export function generateMonthlyReport(
  ledger: LedgerEntry[],
  startMonth?: string,
  endMonth?: string,
  fxRate?: number | null
): MonthlyReport[] {
  const toKrw = (e: LedgerEntry) => toKrwByRate(e.amount, e.currency, fxRate);
  const reports = new Map<string, { income: number; expense: number; transfer: number }>();

  for (const entry of ledger) {
    const month = entry.date.slice(0, 7);
    if (startMonth && month < startMonth) continue;
    if (endMonth && month > endMonth) continue;

    if (!reports.has(month)) {
      reports.set(month, { income: 0, expense: 0, transfer: 0 });
    }

    const report = reports.get(month)!;
    // 수입도 대시보드·인사이트와 동일 게이트 — 이월(원래 보유 자산)·퇴직연금은 소득이 아니다
    // (안 거르면 앱 시작 월의 수입이 이월액만큼 부풀어 순수지가 왜곡됨)
    if (entry.kind === "income" && !isExcludedIncomeEntry(entry)) report.income += toKrw(entry);
    // 지출 분류 단일 소스와 통일 — 신용결제(이중계상) + 저축성지출(자산 축적, 실소비 아님) 제외.
    // (일별 리포트·대시보드·인사이트와 같은 기준. accounts는 isSavingsExpenseEntry 내부 미사용.)
    if (entry.kind === "expense" && !isCreditPayment(entry) && !isSavingsExpenseEntry(entry, []))
      report.expense += toKrw(entry);
    if (entry.kind === "transfer") report.transfer += toKrw(entry);
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

export function generateYearlyReport(ledger: LedgerEntry[], fxRate?: number | null): MonthlyReport[] {
  const toKrw = (e: LedgerEntry) => toKrwByRate(e.amount, e.currency, fxRate);
  const reports = new Map<string, { income: number; expense: number; transfer: number }>();

  for (const entry of ledger) {
    const year = entry.date.slice(0, 4);

    if (!reports.has(year)) {
      reports.set(year, { income: 0, expense: 0, transfer: 0 });
    }

    const report = reports.get(year)!;
    // 수입 게이트는 월간 리포트와 동일 (이월·퇴직연금 제외 — 시작 연도 수입 부풀림 방지)
    if (entry.kind === "income" && !isExcludedIncomeEntry(entry)) report.income += toKrw(entry);
    // 지출 분류 단일 소스와 통일 — 신용결제(이중계상) + 저축성지출(자산 축적, 실소비 아님) 제외.
    // (일별 리포트·대시보드·인사이트와 같은 기준. accounts는 isSavingsExpenseEntry 내부 미사용.)
    if (entry.kind === "expense" && !isCreditPayment(entry) && !isSavingsExpenseEntry(entry, []))
      report.expense += toKrw(entry);
    if (entry.kind === "transfer") report.transfer += toKrw(entry);
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
    // 월간·연간 리포트와 동일 게이트 — 안 거르면 카테고리 합이 월간 지출 합계보다 커진다
    // (레거시 신용결제 = 카드 사용분과 이중계상, 저축성지출 = 실소비 아님)
    if (isCreditPayment(entry) || isSavingsExpenseEntry(entry, [])) continue;

    // 대분류:소분류 키 — 표준 스키마(cat="지출")를 raw로 키잉하면 전부 "지출" 한 덩어리가 된다
    const main = expenseMainName(entry) || "기타";
    const det = (entry.detailCategory || "").trim();
    const key = det ? `${main}:${det}` : main;
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
  accounts: Account[],
  fxRate?: number
): StockPerformanceReport[] {
  // fxRate를 넘겨 USD 종목의 매입원가(매입 당시 환율)·평가액(현재 환율)을 모두 KRW로 정규화한다.
  // cashImpact(현금흐름)는 totalAmountKRW(원화)이므로, 이를 섞지 않으려면 종가도 KRW여야
  // IRR이 'KRW 유출 + USD 종가 유입'으로 환율배수만큼 왜곡되지 않는다.
  const positions = computePositions(trades, prices, accounts, { fxRate });
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

      // 평가액·매입원가를 KRW로 통일 (USD 종목은 환산, KRW 종목은 그대로)
      const currentValueKRW = positionMarketValueKRW(position, fxRate);
      const totalBuyAmountKRW = position.totalBuyAmountKRW ?? position.totalBuyAmount;
      const pnlKRW = currentValueKRW - totalBuyAmountKRW;
      const pnlRateKRW = totalBuyAmountKRW > 0 ? pnlKRW / totalBuyAmountKRW : 0;

      const flows: CashFlowItem[] = positionTrades.map((trade) => ({
        date: trade.date,
        amount: trade.cashImpact // KRW (totalAmountKRW) 또는 USD잔액모드 0
      }));
      flows.push({ date: today, amount: currentValueKRW });

      return {
        accountId: position.accountId,
        ticker: position.ticker,
        name: position.name || position.ticker,
        totalBuyAmount: totalBuyAmountKRW,
        currentValue: currentValueKRW,
        pnl: pnlKRW,
        pnlRate: pnlRateKRW,
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
