// ---------------------------------------------------------------------------
// 종합 월간 보고서 (Comprehensive Monthly Summary)
// (순수 이동만 — 로직 변경 없음. 원본 src/utils/reportGenerator.ts 참조)
// ---------------------------------------------------------------------------

import type { Account, LedgerEntry, StockTrade } from "../../types";
import { isInterestRepayment } from "../../calculations";
import { isSavingsExpenseEntry, isCreditPayment, isInvestmentLossEntry } from "../category";
import { tradeAmountKRW as tradeAmountKRWStd } from "../finance";
import { computeMonthlyRealFlows, computeRealSavingsRate } from "../savingsRate";
import { isNonRealIncomeSub } from "../realIncome";
import { INVESTING_ACCOUNT_TYPES, toKrwAmount, buildMonthRange, realizedPnlKRWByTradeId, isDividendIncomeEntry } from "./shared";

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
      // 대출상환: 현재 구조 (지출/대출상환/학자금대출 등) + 구버전 (category=대출상환)
      const isLoanRepay =
        cat === "대출상환" ||
        (cat === "지출" && sub === "대출상환");
      // 이자/원금 구분은 calculations 단일 소스 — substring 정책 재구현 금지
      const isInterest = isInterestRepayment(entry);

      // 저축성지출 판정을 재테크 분기보다 먼저 — 구버전(kind=expense, category=재테크,
      // sub=저축/투자) 항목이 생활소비로 오분류되지 않도록 (consumptionImpact·daily와 동일 순서)
      if (isSavingsExpenseEntry(entry, accounts)) {
        row.savingsExpense += amount;
      } else if (isInvestmentLossEntry(entry)) {
        // 투자손실 — 실질 지출 성격 (isSavingsExpenseEntry 통과 후 cat=재테크의 잔여는 투자손실뿐)
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

    // 거래시점 환율(fxRateAtTrade) 우선 — 투자 정산의 매수/매도 총액(tradeAmountKRW)과 동일 정의.
    // 현재 환율로 환산하면 과거 월의 매수/매도 총액이 오늘 환율에 따라 매일 변하고,
    // 같은 행의 실현손익(거래시점 환율)과 한 행 안에서 환율 기준이 섞인다.
    const amount = tradeAmountKRWStd(trade, fxRate);

    row.tradeCount += 1;
    if (trade.side === "buy") {
      row.buyAmount += amount;
    } else {
      row.sellAmount += amount;
      // pnl은 이미 거래시점 환율로 KRW 환산됨 — 현재환율 재적용 금지
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
