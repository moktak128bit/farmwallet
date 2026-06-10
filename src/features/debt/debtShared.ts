/**
 * 대출(DebtPage) 공유 헬퍼 — 상태 없는 순수 함수만 모음.
 * DebtPage 오케스트레이터와 features/debt/* 자식들이 함께 사용한다.
 */
import type { Loan, LedgerEntry } from "../../types";

/** 거치기간 만료일: loanDate + gracePeriodYears (소수 허용). 미설정이면 null. */
export function graceEndDate(loan: Loan): string | null {
  if (!loan.gracePeriodYears || loan.gracePeriodYears <= 0) return null;
  const d = new Date(loan.loanDate);
  if (Number.isNaN(d.getTime())) return null;
  const months = Math.round(loan.gracePeriodYears * 12);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** 오늘이 거치기간 내인가? */
export function isInGracePeriod(loan: Loan, todayIso: string): boolean {
  const end = graceEndDate(loan);
  return end !== null && todayIso < end;
}

// 지금까지 갚은 내역.
// 카테고리 구조 3세대 모두 매칭:
//  - 최초: (category="대출", subCategory="빚")
//  - 구버전: (category="대출상환") 플랫 메인
//  - 현재: (category="지출", subCategory="대출상환") 중첩
export const isLoanRepaymentEntry = (l: LedgerEntry) =>
  l.kind === "expense" &&
  (
    (l.category === "대출" && l.subCategory === "빚") ||
    l.category === "대출상환" ||
    (l.category === "지출" && l.subCategory === "대출상환")
  );
