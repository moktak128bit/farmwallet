/**
 * 대출 월별 상환 스케줄(원금·이자 분해) — 순수 함수. 3-5(통합 현금흐름) 전용.
 *
 * loanPrepay.ts(4-4)와 같은 모델을 쓴다 — "원 스케줄의 월 납입액/월 원금"은 원금 전체(loanAmount)가
 * 아니라 **기준일(fromIso) 현재 잔금과 그 시점부터 남은 회차**로 정해진다(추가 상환·중도 변제가 있었어도
 * 남은 잔금을 남은 기간에 맞춰 그대로 계속 낸다는 가정 — loanPrepay.simulatePrepayment와 동일 관례).
 * remainingMonthsBetween(회차 올림)·거치 처리도 loanPrepay.ts와 동일 함수를 재사용한다.
 *
 * 결제일 = loanDate의 일(day-of-month), 매월 클램프 — 대출 실행일과 같은 날짜에 자동이체되는
 * 실무 관행을 따른다(Loan에 별도 결제일 필드가 없음). 만기일시(bullet)는 만기 전까지 매월 이자만
 * 결제하다 만기일에 마지막 이자 + 원금 전액을 한 번에 상환.
 *
 * currentBalance는 호출부가 calculations.computeLoanBalanceAt(loans, ledger, fromIso)로
 * 구한 "fromIso 시점 실제 잔금"을 넘길 것 — 이 모듈은 잔금을 계산하지 않는다.
 */
import type { Loan } from "../types";
import { parseIsoLocal, formatIsoLocal, getLastDayOfMonth } from "./date";
import { addMonthsClamped, remainingMonthsBetween } from "./loanPrepay";

interface LoanScheduleEntry {
  loanId: string;
  /** yyyy-mm-dd */
  date: string;
  principal: number;
  interest: number;
  totalPayment: number;
  /** 이 결제 이후 남은 원금 */
  remainingBalance: number;
}

function graceEndOf(loan: Loan): string | null {
  if (!loan.gracePeriodYears || loan.gracePeriodYears <= 0) return null;
  return addMonthsClamped(loan.loanDate, Math.round(loan.gracePeriodYears * 12));
}

function clampedDate(year: number, month0: number, day: number): Date {
  return new Date(year, month0, Math.min(day, getLastDayOfMonth(year, month0 + 1)));
}

function nextMonthSameDay(cursor: Date, day: number): Date {
  const nextMonth0 = (cursor.getMonth() + 1) % 12;
  const nextYear = cursor.getMonth() === 11 ? cursor.getFullYear() + 1 : cursor.getFullYear();
  return clampedDate(nextYear, nextMonth0, day);
}

/**
 * [fromIso, toIso] 범위에 속하는 결제 일정. maturityDate 이후·잔금 소진 후는 생성하지 않는다.
 * currentBalance ≤ 0 이거나 날짜가 무효면 빈 배열.
 */
export function buildLoanPaymentSchedule(
  loan: Loan,
  currentBalance: number,
  fromIso: string,
  toIso: string
): LoanScheduleEntry[] {
  if (!Number.isFinite(currentBalance) || currentBalance <= 0) return [];
  const from = parseIsoLocal(fromIso);
  const to = parseIsoLocal(toIso);
  const maturity = parseIsoLocal(loan.maturityDate);
  const loanDateParsed = parseIsoLocal(loan.loanDate);
  if (!from || !to || !maturity || !loanDateParsed || to < from) return [];

  const remainingMonths = remainingMonthsBetween(fromIso, loan.maturityDate);
  if (remainingMonths <= 0) return [];

  const monthlyRate = Math.max(0, Number(loan.annualInterestRate) || 0) / 100 / 12;
  const graceEnd = graceEndOf(loan);
  const graceMonthsRemaining = Math.min(
    remainingMonths,
    graceEnd && graceEnd > fromIso ? remainingMonthsBetween(fromIso, graceEnd) : 0
  );
  const repayMonths = Math.max(1, remainingMonths - graceMonthsRemaining);
  const day = loanDateParsed.getDate();
  const method = loan.repaymentMethod;

  let payment = 0;
  let principalPerMonth = 0;
  if (method === "equal_payment") {
    payment =
      monthlyRate > 0
        ? (currentBalance * monthlyRate * Math.pow(1 + monthlyRate, repayMonths)) /
          (Math.pow(1 + monthlyRate, repayMonths) - 1)
        : currentBalance / repayMonths;
  } else if (method === "equal_principal") {
    principalPerMonth = currentBalance / repayMonths;
  }

  // fromIso 이후 첫 결제일(같은 달의 day가 이미 지났으면 다음 달)
  let cursor = clampedDate(from.getFullYear(), from.getMonth(), day);
  if (cursor < from) cursor = nextMonthSameDay(cursor, day);

  const entries: LoanScheduleEntry[] = [];
  let balance = currentBalance;

  while (cursor <= to && balance > 0.5) {
    const iso = formatIsoLocal(cursor);
    if (method === "bullet") {
      if (iso >= loan.maturityDate) break; // 만기·만기 이후는 아래 별도 처리
    } else if (cursor > maturity) {
      break;
    }
    const inGrace = graceEnd != null && iso <= graceEnd;
    const interest = balance * monthlyRate;
    let principal = 0;
    if (method === "bullet") {
      principal = 0;
    } else if (!inGrace) {
      principal =
        method === "equal_payment"
          ? Math.min(balance, Math.max(0, payment - interest))
          : Math.min(balance, principalPerMonth);
    }
    balance = Math.max(0, balance - principal);
    entries.push({
      loanId: loan.id,
      date: iso,
      principal,
      interest,
      totalPayment: principal + interest,
      remainingBalance: balance
    });
    cursor = nextMonthSameDay(cursor, day);
  }

  // 만기일시: 만기일이 [fromIso, toIso] 안이고 잔금이 남아 있으면 (마지막 기간 이자 + 원금 전액) 한 번에
  if (method === "bullet" && balance > 0.5 && loan.maturityDate >= fromIso && loan.maturityDate <= toIso) {
    const finalInterest = balance * monthlyRate;
    entries.push({
      loanId: loan.id,
      date: loan.maturityDate,
      principal: balance,
      interest: finalInterest,
      totalPayment: balance + finalInterest,
      remainingBalance: 0
    });
  }

  return entries;
}
