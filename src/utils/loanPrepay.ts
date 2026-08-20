/**
 * 대출 추가(조기) 상환 시뮬레이션 — 순수 함수.
 *
 * 모델
 *  - 기준일(asOfIso)부터 만기까지 남은 회차를 "월 단위"로 본다. 남은 개월수는 올림(부분 달도 1회차):
 *    오늘 8/21, 만기 3/15면 9/15…3/15 7회, 만기 3/25면 8/25…3/25 8회.
 *  - 거치 중(graceEnd > asOf)이면 거치 잔여 개월 동안은 잔금 전액 이자만, 이후 분할 상환.
 *  - 추가 상환은 **기간 단축형**(월 납입액/월 원금을 그대로 유지해 만기가 앞당겨짐)으로 계산한다.
 *    만기일시(bullet)는 단축 개념이 없고 잔여 기간 이자만 줄어든다.
 *  - 스케줄은 닫힌식 대신 월별 루프로 적산 — 단축 시 마지막 회차가 부분 납입이어도 정확.
 *  - 새 만기 = 원 만기에서 단축 개월만큼 앞으로 (말일 클램프, KST 로컬 파싱).
 *  - 수수료 손익분기(breakEvenFeeRate) = 절감 이자 ÷ 추가 상환액 × 100 (%) — 이보다 수수료율이 높으면 손해.
 *
 * 비교(compareWithInvesting)는 "같은 돈을 투자했을 때 연 기대수익"을 연 절감 이자와 나란히 둔다.
 * 대출 이자 절감만 확정이고 나머지는 과거 실적 기반 **보장 아님** — 표 라벨에 반드시 표기한다.
 * 모든 율은 연 %(5 = 5%)로 받는다 (Loan.annualInterestRate 단위와 동일).
 */
import type { Loan } from "../types";
import { parseIsoLocal, formatIsoLocal, getLastDayOfMonth } from "./date";

interface PrepaySimulation {
  /** 추가 상환으로 줄어드는 잔여 이자 (KRW) */
  interestSaved: number;
  /** 단축 개월수 (만기일시는 0) */
  monthsShortened: number;
  /** 단축 후 만기 (ISO). 기준일이 만기 이후면 null */
  newMaturity: string | null;
  /** 수수료 손익분기율 (%) — 수수료율이 이 값 미만이어야 이득 */
  breakEvenFeeRate: number;
  /** 중도상환수수료 금액 = extra × feeRate% */
  fee: number;
  /** 절감 이자 − 수수료 */
  netSaved: number;
  /** 추가 상환 없이 진행 시 잔여 이자 */
  baselineInterest: number;
  /** 추가 상환 후 잔여 이자 */
  afterInterest: number;
  /** 남은 회차(개월) — 현행 */
  remainingMonths: number;
  /** 남은 회차(개월) — 추가 상환 후 */
  newRemainingMonths: number;
  /** 실제 적용된 추가 상환액 (잔금 초과분은 잘라냄) */
  appliedExtra: number;
}

const EMPTY: PrepaySimulation = {
  interestSaved: 0,
  monthsShortened: 0,
  newMaturity: null,
  breakEvenFeeRate: 0,
  fee: 0,
  netSaved: 0,
  baselineInterest: 0,
  afterInterest: 0,
  remainingMonths: 0,
  newRemainingMonths: 0,
  appliedExtra: 0,
};

/** ISO 날짜에 개월 가산 — 말일 클램프 (1/31 + 1개월 = 2/28·29) */
export function addMonthsClamped(iso: string, months: number): string | null {
  const d = parseIsoLocal(iso);
  if (!d) return null;
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = getLastDayOfMonth(d.getFullYear(), d.getMonth() + 1);
  d.setDate(Math.min(day, last));
  return formatIsoLocal(d);
}

/**
 * 남은 회차 수 (from → to, 올림). to ≤ from 이면 0.
 * (y·m 차이) + (to의 일 > from의 일이면 1) — 부분 달도 한 회차로 센다.
 */
export function remainingMonthsBetween(fromIso: string, toIso: string): number {
  const a = parseIsoLocal(fromIso);
  const b = parseIsoLocal(toIso);
  if (!a || !b || toIso <= fromIso) return 0;
  const raw = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  return Math.max(0, raw + (b.getDate() > a.getDate() ? 1 : 0));
}

/** 거치 종료일 (loanDate + gracePeriodYears, 말일 클램프). 미설정이면 null */
function graceEndOf(loan: Loan): string | null {
  if (!loan.gracePeriodYears || loan.gracePeriodYears <= 0) return null;
  return addMonthsClamped(loan.loanDate, Math.round(loan.gracePeriodYears * 12));
}

interface ScheduleResult {
  interest: number;
  /** 분할 상환 회차 수 (거치 제외) */
  repayMonths: number;
}

/**
 * 월별 스케줄 적산.
 *  - graceMonths 동안 잔금 전액 이자만.
 *  - equal_payment: 매월 payment 고정, 잔금 < payment면 마지막 회차 부분 납입.
 *  - equal_principal: 매월 principalPerMonth 고정 + 잔금 이자.
 *  - bullet: 잔여 기간 내내 전액 이자 (maxMonths = 잔여 전체).
 * maxMonths는 무한 루프 방지 상한(원 스케줄 회차 수).
 */
function runSchedule(params: {
  balance: number;
  monthlyRate: number;
  graceMonths: number;
  method: Loan["repaymentMethod"];
  payment: number;
  principalPerMonth: number;
  maxMonths: number;
}): ScheduleResult {
  const { monthlyRate, graceMonths, method, payment, principalPerMonth, maxMonths } = params;
  let balance = params.balance;
  if (balance <= 0) return { interest: 0, repayMonths: 0 };
  let interest = balance * monthlyRate * graceMonths;
  if (method === "bullet") {
    return { interest: interest + balance * monthlyRate * maxMonths, repayMonths: maxMonths };
  }
  let months = 0;
  // 납입액이 이자조차 못 덮으면(비정상) 원 회차 수에서 끊는다 — 무한 루프 방지
  while (balance > 0.5 && months < maxMonths) {
    const i = balance * monthlyRate;
    interest += i;
    const principal = method === "equal_payment" ? Math.min(balance, Math.max(0, payment - i)) : Math.min(balance, principalPerMonth);
    balance -= principal;
    months += 1;
    if (principal <= 0) break;
  }
  return { interest, repayMonths: months };
}

/**
 * 추가 상환 시뮬레이션.
 * @param currentBalance 기준일 현재 잔금(원금) — 대출 카드의 현재 잔금(loanAmount − 원금 상환 누적)
 * @param extraKRW 추가 상환액 (≤0 이면 전부 0 결과)
 * @param asOfIso 기준일 (YYYY-MM-DD, KST)
 * @param opts.feeRate 중도상환수수료율 (%) — 미지정이면 loan.prepaymentFeeRate, 그것도 없으면 0
 */
export function simulatePrepayment(
  loan: Loan,
  currentBalance: number,
  extraKRW: number,
  asOfIso: string,
  opts?: { feeRate?: number }
): PrepaySimulation {
  const feeRate = Math.max(0, opts?.feeRate ?? loan.prepaymentFeeRate ?? 0);
  const balance = Number.isFinite(currentBalance) ? Math.max(0, currentBalance) : 0;
  const extra = Number.isFinite(extraKRW) ? Math.min(Math.max(0, extraKRW), balance) : 0;
  const remainingMonths = remainingMonthsBetween(asOfIso, loan.maturityDate);
  if (balance <= 0 || remainingMonths <= 0) {
    return { ...EMPTY, newMaturity: remainingMonths > 0 ? loan.maturityDate : null, remainingMonths };
  }

  const monthlyRate = Math.max(0, loan.annualInterestRate || 0) / 100 / 12;
  const graceEnd = graceEndOf(loan);
  const graceMonths = Math.min(
    remainingMonths,
    graceEnd && graceEnd > asOfIso ? remainingMonthsBetween(asOfIso, graceEnd) : 0
  );
  const repayMonths = remainingMonths - graceMonths;
  const method = loan.repaymentMethod;

  // 원 스케줄의 월 납입액/월 원금 — 추가 상환 후에도 유지(기간 단축형)
  let payment = 0;
  let principalPerMonth = 0;
  if (method !== "bullet") {
    const n = Math.max(1, repayMonths);
    principalPerMonth = balance / n;
    if (monthlyRate === 0) payment = balance / n;
    else {
      const f = Math.pow(1 + monthlyRate, n);
      payment = (balance * monthlyRate * f) / (f - 1);
    }
  }
  const maxMonths = method === "bullet" ? repayMonths : Math.max(1, repayMonths);

  const base = runSchedule({ balance, monthlyRate, graceMonths, method, payment, principalPerMonth, maxMonths });
  if (extra <= 0) {
    return {
      ...EMPTY,
      newMaturity: loan.maturityDate,
      baselineInterest: base.interest,
      afterInterest: base.interest,
      remainingMonths,
      newRemainingMonths: remainingMonths,
    };
  }
  const after = runSchedule({
    balance: balance - extra,
    monthlyRate,
    graceMonths,
    method,
    payment,
    principalPerMonth,
    maxMonths,
  });

  const interestSaved = Math.max(0, base.interest - after.interest);
  // 거치 중 상환: 거치 개월은 그대로, 분할 회차만 줄어든다. 전액 상환(잔금 0)이면 거치도 의미 없음 → 전부 단축.
  const fullPayoff = balance - extra <= 0.5;
  const newRemainingMonths = fullPayoff ? 0 : graceMonths + after.repayMonths;
  const monthsShortened =
    method === "bullet" && !fullPayoff ? 0 : Math.max(0, remainingMonths - newRemainingMonths);
  const newMaturity =
    monthsShortened > 0 ? addMonthsClamped(loan.maturityDate, -monthsShortened) : loan.maturityDate;
  const fee = extra * (feeRate / 100);
  return {
    interestSaved,
    monthsShortened,
    newMaturity,
    breakEvenFeeRate: extra > 0 ? (interestSaved / extra) * 100 : 0,
    fee,
    netSaved: interestSaved - fee,
    baselineInterest: base.interest,
    afterInterest: after.interest,
    remainingMonths,
    newRemainingMonths,
    appliedExtra: extra,
  };
}

interface InvestCompareRow {
  key: "loan" | "twr" | "dividend" | "deposit";
  label: string;
  /** 연 % */
  ratePct: number;
  /** 연 기대 금액 (KRW) = extra × rate */
  annualKRW: number;
  /** 확정 여부 — 대출 이자 절감만 true, 나머지는 '보장 아님' */
  guaranteed: boolean;
  /** 대출 절감 대비 차이 (KRW, 양수면 투자가 유리) */
  vsLoanKRW: number;
}

interface InvestComparison {
  rows: InvestCompareRow[];
  /** 대출 절감보다 연 기대수익이 큰 대안 중 최대 — 없으면 null (=상환이 유리) */
  bestAlternative: InvestCompareRow | null;
  /** 대안 수익률이 전부 '보장 아님'임을 알리는 고정 문구 */
  disclaimer: string;
}

/**
 * 추가 상환(연 이자 절감 = extra × 대출금리) vs 같은 돈의 투자 기대수익(연).
 * 제공된 대안만 행으로 포함. 율은 전부 연 %(세전).
 */
export function compareWithInvesting(
  extraKRW: number,
  loanRatePct: number,
  alternatives: { twrAnnual?: number | null; dividendYield?: number | null; depositRate?: number | null }
): InvestComparison {
  const extra = Number.isFinite(extraKRW) ? Math.max(0, extraKRW) : 0;
  const loanRate = Number.isFinite(loanRatePct) ? Math.max(0, loanRatePct) : 0;
  const loanAnnual = extra * (loanRate / 100);
  const rows: InvestCompareRow[] = [
    { key: "loan", label: "대출 이자 절감 (확정)", ratePct: loanRate, annualKRW: loanAnnual, guaranteed: true, vsLoanKRW: 0 },
  ];
  const push = (key: InvestCompareRow["key"], label: string, rate: number | null | undefined) => {
    if (rate == null || !Number.isFinite(rate)) return;
    const annual = extra * (rate / 100);
    rows.push({ key, label, ratePct: rate, annualKRW: annual, guaranteed: false, vsLoanKRW: annual - loanAnnual });
  };
  push("twr", "포트폴리오 연환산 TWR (과거 실적·보장 아님)", alternatives.twrAnnual);
  push("dividend", "배당 수익률 (향후 12개월 예상·보장 아님)", alternatives.dividendYield);
  push("deposit", "예금 금리 (세전·가정)", alternatives.depositRate);
  let best: InvestCompareRow | null = null;
  for (const r of rows) {
    if (r.guaranteed || r.vsLoanKRW <= 0) continue;
    if (!best || r.vsLoanKRW > best.vsLoanKRW) best = r;
  }
  return {
    rows,
    bestAlternative: best,
    disclaimer: "투자 수익률은 과거 실적 기반 추정이며 보장되지 않습니다. 대출 이자 절감만 확정 수익입니다.",
  };
}
