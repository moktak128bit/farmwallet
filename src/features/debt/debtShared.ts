/**
 * 대출(DebtPage) 공유 헬퍼 — 상태 없는 순수 함수만 모음.
 * DebtPage 오케스트레이터와 features/debt/* 자식들이 함께 사용한다.
 */
import type { Loan, LedgerEntry } from "../../types";
import { parseIsoLocal, formatIsoLocal, getLastDayOfMonth } from "../../utils/date";
import { hasLoanRepaymentStructure } from "../../calculations";

/**
 * 거치기간 만료일: loanDate + gracePeriodYears (소수 허용). 미설정이면 null.
 * - parseIsoLocal/formatIsoLocal로 UTC/로컬 혼용 제거 (toISOString은 타임존에 따라 하루 밀림)
 * - setMonth 월말 오버플로 방지: 1월 31일 + 1개월 → 3월 3일이 아니라 2월 말일로 클램프
 */
export function graceEndDate(loan: Loan): string | null {
  if (!loan.gracePeriodYears || loan.gracePeriodYears <= 0) return null;
  const d = parseIsoLocal(loan.loanDate);
  if (!d) return null;
  const months = Math.round(loan.gracePeriodYears * 12);
  const day = d.getDate();
  d.setDate(1); // 먼저 1일로 옮겨 월 가산 시 오버플로 방지
  d.setMonth(d.getMonth() + months);
  const lastDay = getLastDayOfMonth(d.getFullYear(), d.getMonth() + 1);
  d.setDate(Math.min(day, lastDay));
  return formatIsoLocal(d);
}

/** 오늘이 거치기간 내인가? */
export function isInGracePeriod(loan: Loan, todayIso: string): boolean {
  const end = graceEndDate(loan);
  return end !== null && todayIso < end;
}

// 지금까지 갚은 내역. 판정은 calculations.hasLoanRepaymentStructure 단일 소스에 위임한다
// (예전엔 여기와 calculations.ts가 같은 3세대 조건을 따로 들고 있어 한쪽만 고치면 어긋났다).
export const isLoanRepaymentEntry = (l: LedgerEntry) =>
  l.kind === "expense" && hasLoanRepaymentStructure(l);
