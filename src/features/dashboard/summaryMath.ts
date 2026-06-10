/**
 * 대시보드 공용 가계부 집계 — 순수 함수.
 * DashboardPage(이번달/전체 합계)와 SavingsRatioCard(저번달 합계)가 공유한다.
 * 호출부에서 useMemo로 감싸 재계산을 막는다 (입력: ledger, fxRate, 월 prefix).
 */
import type { LedgerEntry } from "../../types";
import { isCreditPayment } from "../../utils/category";

const toKrw = (entry: LedgerEntry, fxRate: number | null) =>
  entry.currency === "USD" && fxRate ? entry.amount * fxRate : entry.amount;

/**
 * 공통: 월 prefix(또는 null=전체) 기준으로 수입/지출/재테크 합계 계산.
 * 메모이즈된 isSavingsExpenseEntry와 함께 단일 루프로 처리.
 */
export function computeLedgerSummary(
  ledger: LedgerEntry[],
  fxRate: number | null,
  monthPrefix: string | null
): { income: number; expense: number; investing: number } {
  let income = 0;
  let expense = 0;
  let investing = 0;
  for (const entry of ledger) {
    if (!entry.date) continue;
    if (monthPrefix && !entry.date.startsWith(monthPrefix)) continue;
    if (entry.kind === "income") {
      income += toKrw(entry, fxRate);
    } else if (entry.kind === "expense") {
      // 신용결제는 카드 사용 시점에 이미 expense로 잡힘 — 이중계상 방지
      if (isCreditPayment(entry)) continue;
      expense += toKrw(entry, fxRate);
    } else if (entry.kind === "transfer") {
      // 저축이체/투자이체 (+ 구버전 저축/투자) → 자산 축적
      const sub = entry.subCategory;
      if (sub === "저축이체" || sub === "투자이체" || sub === "저축" || sub === "투자") {
        investing += toKrw(entry, fxRate);
      }
    }
  }
  return { income, expense, investing };
}

/** 재테크 세부(저축/투자/투자수익/투자손실)를 각 항목의 정식 소스에서 집계.
 * 저축=transfer 저축이체, 투자=transfer 투자이체, 투자수익=income 투자수익, 투자손실=expense 재테크 투자손실. */
export function computeRecheckBreakdown(
  ledger: LedgerEntry[],
  fxRate: number | null,
  monthPrefix: string
): { 저축: number; 투자: number; 투자수익: number; 투자손실: number } {
  const sub = { 저축: 0, 투자: 0, 투자수익: 0, 투자손실: 0 };
  for (const entry of ledger) {
    if (!entry.date?.startsWith(monthPrefix)) continue;
    const amt = toKrw(entry, fxRate);
    if (entry.kind === "transfer") {
      if (entry.subCategory === "저축이체") sub.저축 += amt;
      else if (entry.subCategory === "투자이체") sub.투자 += amt;
    } else if (entry.kind === "income" && entry.subCategory === "투자수익") {
      sub.투자수익 += amt;
    } else if (entry.kind === "expense" && entry.category === "재테크" && entry.subCategory === "투자손실") {
      sub.투자손실 += amt;
    }
  }
  return sub;
}
