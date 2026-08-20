import { describe, it, expect } from "vitest";
import {
  simulatePrepayment,
  compareWithInvesting,
  remainingMonthsBetween,
  addMonthsClamped,
} from "../utils/loanPrepay";
import type { Loan } from "../types";

function makeLoan(overrides: Partial<Loan>): Loan {
  return {
    id: "l1",
    institution: "은행",
    loanName: "테스트대출",
    loanAmount: 12_000_000,
    annualInterestRate: 12,
    repaymentMethod: "equal_principal",
    loanDate: "2025-01-15",
    maturityDate: "2027-01-15",
    ...overrides,
  };
}

describe("remainingMonthsBetween / addMonthsClamped — 회차 올림·말일 클램프", () => {
  it("남은 회차는 부분 달을 1회차로 올림", () => {
    expect(remainingMonthsBetween("2026-08-21", "2027-03-15")).toBe(7); // 9/15…3/15
    expect(remainingMonthsBetween("2026-08-21", "2027-03-25")).toBe(8); // 8/25…3/25
    expect(remainingMonthsBetween("2026-01-15", "2027-01-15")).toBe(12);
  });
  it("같은 날·과거·잘못된 날짜는 0", () => {
    expect(remainingMonthsBetween("2026-08-21", "2026-08-21")).toBe(0);
    expect(remainingMonthsBetween("2026-08-21", "2026-01-01")).toBe(0);
    expect(remainingMonthsBetween("bad", "2026-01-01")).toBe(0);
  });
  it("월 가산·감산은 말일 클램프", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2027-03-31", -1)).toBe("2027-02-28");
    expect(addMonthsClamped("2026-01-15", 12)).toBe("2027-01-15");
    expect(addMonthsClamped("bad", 1)).toBeNull();
  });
});

describe("simulatePrepayment — 만기일시(bullet)", () => {
  const loan = makeLoan({ repaymentMethod: "bullet", annualInterestRate: 5, loanAmount: 10_000_000 });
  it("잔여 12개월: 절감 이자 = 추가상환 × 연 5%, 기간 단축 없음, 손익분기 수수료율 5%", () => {
    const r = simulatePrepayment(loan, 10_000_000, 2_000_000, "2026-01-15");
    expect(r.remainingMonths).toBe(12);
    expect(r.baselineInterest).toBeCloseTo(500_000, 0);
    expect(r.afterInterest).toBeCloseTo(400_000, 0);
    expect(r.interestSaved).toBeCloseTo(100_000, 0);
    expect(r.monthsShortened).toBe(0);
    expect(r.newMaturity).toBe("2027-01-15");
    expect(r.breakEvenFeeRate).toBeCloseTo(5, 6);
    expect(r.fee).toBe(0);
    expect(r.netSaved).toBeCloseTo(100_000, 0);
  });
  it("수수료율 손익분기: 5%면 순절감 0, 6%면 손해", () => {
    const even = simulatePrepayment(loan, 10_000_000, 2_000_000, "2026-01-15", { feeRate: 5 });
    expect(even.fee).toBeCloseTo(100_000, 0);
    expect(even.netSaved).toBeCloseTo(0, 0);
    const lose = simulatePrepayment(loan, 10_000_000, 2_000_000, "2026-01-15", { feeRate: 6 });
    expect(lose.netSaved).toBeCloseTo(-20_000, 0);
  });
  it("feeRate 미지정이면 loan.prepaymentFeeRate 사용, 둘 다 없으면 0", () => {
    const withField = simulatePrepayment({ ...loan, prepaymentFeeRate: 1 }, 10_000_000, 2_000_000, "2026-01-15");
    expect(withField.fee).toBeCloseTo(20_000, 0);
    const override = simulatePrepayment({ ...loan, prepaymentFeeRate: 1 }, 10_000_000, 2_000_000, "2026-01-15", { feeRate: 0 });
    expect(override.fee).toBe(0);
  });
});

describe("simulatePrepayment — 원금균등(equal_principal)", () => {
  const loan = makeLoan({ repaymentMethod: "equal_principal", annualInterestRate: 12 });
  it("12M·12%·12개월: 기준 이자 780,000, 3M 상환 → 9회차·450,000, 3개월 단축", () => {
    const r = simulatePrepayment(loan, 12_000_000, 3_000_000, "2026-01-15");
    expect(r.remainingMonths).toBe(12);
    expect(r.baselineInterest).toBeCloseTo(780_000, 0);
    expect(r.afterInterest).toBeCloseTo(450_000, 0);
    expect(r.interestSaved).toBeCloseTo(330_000, 0);
    expect(r.newRemainingMonths).toBe(9);
    expect(r.monthsShortened).toBe(3);
    expect(r.newMaturity).toBe("2026-10-15");
    expect(r.breakEvenFeeRate).toBeCloseTo(11, 6);
  });
  it("새 만기는 말일 클램프 (3/31 − 1개월 = 2/28)", () => {
    const l = makeLoan({ repaymentMethod: "equal_principal", maturityDate: "2027-03-31" });
    const r = simulatePrepayment(l, 12_000_000, 1_000_000, "2026-03-31");
    expect(r.remainingMonths).toBe(12);
    expect(r.monthsShortened).toBe(1);
    expect(r.newMaturity).toBe("2027-02-28");
  });
});

describe("simulatePrepayment — 원리금균등(equal_payment)", () => {
  const loan = makeLoan({ repaymentMethod: "equal_payment", annualInterestRate: 12 });
  it("12M·12%·12개월: 월 납입 유지 시 6M 상환 → 6회차, 이자 794,226 → 207,045", () => {
    const r = simulatePrepayment(loan, 12_000_000, 6_000_000, "2026-01-15");
    expect(r.baselineInterest).toBeCloseTo(794_225.57, 0);
    expect(r.afterInterest).toBeCloseTo(207_044.66, 0);
    expect(r.interestSaved).toBeCloseTo(587_180.91, 0);
    expect(r.newRemainingMonths).toBe(6);
    expect(r.monthsShortened).toBe(6);
    expect(r.newMaturity).toBe("2026-07-15");
  });
  it("이율 0%면 이자 0, 단축만 발생", () => {
    const r = simulatePrepayment({ ...loan, annualInterestRate: 0 }, 12_000_000, 6_000_000, "2026-01-15");
    expect(r.baselineInterest).toBe(0);
    expect(r.interestSaved).toBe(0);
    expect(r.monthsShortened).toBe(6);
    expect(r.breakEvenFeeRate).toBe(0);
  });
});

describe("simulatePrepayment — 거치 중 상환", () => {
  // 거치 1년(2026-01-15~2027-01-15), 기준일 2026-07-15 → 거치 6개월 + 분할 12개월
  const loan = makeLoan({
    repaymentMethod: "equal_principal",
    annualInterestRate: 12,
    loanDate: "2026-01-15",
    gracePeriodYears: 1,
    maturityDate: "2028-01-15",
  });
  it("거치 잔여 개월은 잔금 전액 이자, 분할 회차만 단축", () => {
    const r = simulatePrepayment(loan, 12_000_000, 3_000_000, "2026-07-15");
    expect(r.remainingMonths).toBe(18);
    expect(r.baselineInterest).toBeCloseTo(720_000 + 780_000, 0);
    expect(r.afterInterest).toBeCloseTo(540_000 + 450_000, 0);
    expect(r.interestSaved).toBeCloseTo(510_000, 0);
    expect(r.newRemainingMonths).toBe(15);
    expect(r.monthsShortened).toBe(3);
    expect(r.newMaturity).toBe("2027-10-15");
  });
  it("거치 종료 후 기준일이면 거치 이자 없음 (일반 스케줄과 동일)", () => {
    const r = simulatePrepayment(loan, 12_000_000, 3_000_000, "2027-01-15");
    expect(r.remainingMonths).toBe(12);
    expect(r.baselineInterest).toBeCloseTo(780_000, 0);
  });
});

describe("simulatePrepayment — 경계 입력", () => {
  const loan = makeLoan({ repaymentMethod: "equal_principal" });
  it("0·음수·NaN 추가 상환은 전부 0 결과 (만기는 원래대로)", () => {
    for (const extra of [0, -100, NaN]) {
      const r = simulatePrepayment(loan, 12_000_000, extra, "2026-01-15");
      expect(r.interestSaved).toBe(0);
      expect(r.monthsShortened).toBe(0);
      expect(r.fee).toBe(0);
      expect(r.breakEvenFeeRate).toBe(0);
      expect(r.appliedExtra).toBe(0);
      expect(r.newMaturity).toBe("2027-01-15");
      expect(r.baselineInterest).toBeCloseTo(780_000, 0);
    }
  });
  it("잔금 0 / 만기 경과 → 0 결과", () => {
    const zero = simulatePrepayment(loan, 0, 1_000_000, "2026-01-15");
    expect(zero.interestSaved).toBe(0);
    expect(zero.appliedExtra).toBe(0);
    const past = simulatePrepayment(loan, 12_000_000, 1_000_000, "2027-02-01");
    expect(past.remainingMonths).toBe(0);
    expect(past.newMaturity).toBeNull();
    expect(past.interestSaved).toBe(0);
  });
  it("잔금 초과 상환은 잔금까지만 적용 — 전액 상환이면 전 기간 단축", () => {
    const r = simulatePrepayment(loan, 12_000_000, 50_000_000, "2026-01-15");
    expect(r.appliedExtra).toBe(12_000_000);
    expect(r.interestSaved).toBeCloseTo(780_000, 0);
    expect(r.monthsShortened).toBe(12);
    expect(r.newRemainingMonths).toBe(0);
    expect(r.newMaturity).toBe("2026-01-15");
  });
  it("음수 수수료율은 0으로 취급", () => {
    const r = simulatePrepayment(loan, 12_000_000, 1_000_000, "2026-01-15", { feeRate: -3 });
    expect(r.fee).toBe(0);
  });
});

describe("compareWithInvesting — 연 절감 vs 기대수익 (보장 아님 라벨)", () => {
  it("대출 행은 확정, 대안은 guaranteed=false + 라벨에 '보장 아님'", () => {
    const c = compareWithInvesting(10_000_000, 5, { twrAnnual: 8, dividendYield: 3 });
    expect(c.rows).toHaveLength(3);
    const [loan, twr, div] = c.rows;
    expect(loan.guaranteed).toBe(true);
    expect(loan.annualKRW).toBeCloseTo(500_000, 0);
    expect(twr.guaranteed).toBe(false);
    expect(twr.label).toContain("보장 아님");
    expect(twr.annualKRW).toBeCloseTo(800_000, 0);
    expect(twr.vsLoanKRW).toBeCloseTo(300_000, 0);
    expect(div.label).toContain("보장 아님");
    expect(div.vsLoanKRW).toBeCloseTo(-200_000, 0);
    expect(c.bestAlternative?.key).toBe("twr");
    expect(c.disclaimer).toContain("보장");
  });
  it("대안이 전부 대출금리 미만이면 bestAlternative null (상환 유리)", () => {
    const c = compareWithInvesting(10_000_000, 6, { twrAnnual: 4, dividendYield: 3, depositRate: 3.5 });
    expect(c.rows).toHaveLength(4);
    expect(c.bestAlternative).toBeNull();
  });
  it("null/미제공 대안은 행에서 생략, 음수·NaN 금액은 0", () => {
    const c = compareWithInvesting(-5, 5, { twrAnnual: null, dividendYield: undefined });
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0].annualKRW).toBe(0);
    const n = compareWithInvesting(NaN, NaN, { depositRate: 3 });
    expect(n.rows[0].annualKRW).toBe(0);
    expect(n.rows[1].annualKRW).toBe(0);
  });
});
