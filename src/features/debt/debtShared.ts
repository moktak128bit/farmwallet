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

// KST 기준 일수 차 — new Date("YYYY-MM-DD")는 UTC 파싱이라 자정 경계에서 ±1일 어긋남(KST 규약 위반).
export const daysBetween = (date1: string, date2: string): number => {
  const d1 = parseIsoLocal(date1);
  const d2 = parseIsoLocal(date2);
  if (!d1 || !d2) return NaN; // 잘못된/누락 날짜 — NaN 전파
  return Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
};

/** DebtPage memo — 대출별 원금/이자 상환 누적 */
export interface LoanRepayments {
  principal: Map<string, number>;
  interest: Map<string, number>;
}

interface LoanRow {
  loan: Loan;
  /** 대출금액 − 원금 상환 (0 미만 없음) */
  balance: number;
  principalPaid: number;
  interestPaid: number;
  /** 갚은 원금 비율 0~1 */
  progress: number;
  /** 만기까지 남은 일수 (만기 지남 = 음수) */
  remainingDays: number;
  graceEnd: string | null;
  inGrace: boolean;
}

/**
 * 부채 탭 표·합계 줄의 단일 소스 — 잔금 큰 순 정렬, 합계, 잔금 가중 평균 금리.
 * 가중 금리는 잔금 기준이라 다 갚은 대출의 금리는 영향이 없다 (잔금 0이면 null).
 */
export function summarizeLoans(loans: Loan[], repayments: LoanRepayments, todayIso: string) {
  const rows: LoanRow[] = loans.map((loan) => {
    const principalPaid = repayments.principal.get(loan.id) || 0;
    const interestPaid = repayments.interest.get(loan.id) || 0;
    const balance = Math.max(0, loan.loanAmount - principalPaid);
    const graceEnd = graceEndDate(loan);
    return {
      loan,
      balance,
      principalPaid,
      interestPaid,
      progress: loan.loanAmount > 0 ? Math.min(1, principalPaid / loan.loanAmount) : 1,
      remainingDays: daysBetween(todayIso, loan.maturityDate),
      graceEnd,
      inGrace: graceEnd !== null && todayIso < graceEnd,
    };
  });
  rows.sort((a, b) => b.balance - a.balance);
  const totalBalance = rows.reduce((s, r) => s + r.balance, 0);
  const totalAmount = rows.reduce((s, r) => s + r.loan.loanAmount, 0);
  const weightedRate =
    totalBalance > 0 ? rows.reduce((s, r) => s + r.balance * r.loan.annualInterestRate, 0) / totalBalance : null;
  return { rows, totalBalance, totalAmount, count: loans.length, weightedRate };
}
