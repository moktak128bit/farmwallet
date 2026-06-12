import { describe, it, expect } from "vitest";
import { graceEndDate, isInGracePeriod } from "../features/debt/debtShared";
import { calculateTotalInterest } from "../features/debt/LoanCardsSection";
import type { Loan } from "../types";

function makeLoan(overrides: Partial<Loan>): Loan {
  return {
    id: "l1",
    institution: "은행",
    loanName: "테스트대출",
    loanAmount: 10_000_000,
    annualInterestRate: 5,
    repaymentMethod: "bullet",
    loanDate: "2021-01-01",
    maturityDate: "2024-01-01",
    ...overrides,
  } as Loan;
}

describe("graceEndDate — 로컬 파싱 + 월 가산 말일 클램프", () => {
  it("거치기간 미설정이면 null", () => {
    expect(graceEndDate(makeLoan({ gracePeriodYears: undefined }))).toBeNull();
    expect(graceEndDate(makeLoan({ gracePeriodYears: 0 }))).toBeNull();
  });

  it("일반 케이스: 1년 거치 → 같은 날짜의 다음 해", () => {
    const loan = makeLoan({ loanDate: "2025-01-15", gracePeriodYears: 1 });
    expect(graceEndDate(loan)).toBe("2026-01-15");
  });

  it("말일 클램프: 3/31 + 1개월 → 4/30 (5/1로 오버플로하지 않음)", () => {
    const loan = makeLoan({ loanDate: "2025-03-31", gracePeriodYears: 1 / 12 });
    expect(graceEndDate(loan)).toBe("2025-04-30");
  });

  it("2월 클램프: 11/30 + 3개월 → 평년 2/28", () => {
    const loan = makeLoan({ loanDate: "2024-11-30", gracePeriodYears: 0.25 });
    expect(graceEndDate(loan)).toBe("2025-02-28");
  });

  it("윤년 2월 클램프: 11/30 + 3개월 → 윤년 2/29", () => {
    const loan = makeLoan({ loanDate: "2023-11-30", gracePeriodYears: 0.25 });
    expect(graceEndDate(loan)).toBe("2024-02-29");
  });

  it("isInGracePeriod: 만료일 전이면 true, 이후면 false", () => {
    const loan = makeLoan({ loanDate: "2025-01-15", gracePeriodYears: 1 });
    expect(isInGracePeriod(loan, "2025-06-01")).toBe(true);
    expect(isInGracePeriod(loan, "2026-01-15")).toBe(false);
  });
});

describe("calculateTotalInterest — 거치기간 이자 가산 + 개월수 정수 보정", () => {
  it("만기일시(bullet): 거치 여부와 무관하게 전 기간 원금 전액 이자", () => {
    // 2021-01-01 → 2024-01-01 = 1095일 = 정확히 3년 (윤일 없음)
    const noGrace = makeLoan({ repaymentMethod: "bullet", gracePeriodYears: undefined });
    const withGrace = makeLoan({ repaymentMethod: "bullet", gracePeriodYears: 1 });
    // 10,000,000 × 5% × 3년 = 1,500,000
    expect(calculateTotalInterest(noGrace)).toBeCloseTo(1_500_000, 0);
    // 기존 버그: 거치년수만큼 이자 기간이 통째로 빠졌다 — 이제 동일해야 한다
    expect(calculateTotalInterest(withGrace)).toBeCloseTo(calculateTotalInterest(noGrace), 6);
  });

  it("원금균등(equal_principal): 거치기간 이자 + 상환기간 이자", () => {
    // 1년 만기, 거치 0.5년 → 상환 6개월 (월이율 1%)
    const loan = makeLoan({
      repaymentMethod: "equal_principal",
      loanAmount: 12_000_000,
      annualInterestRate: 12,
      loanDate: "2021-01-01",
      maturityDate: "2022-01-01",
      gracePeriodYears: 0.5,
    });
    // 거치 이자: 12,000,000 × 12% × 0.5 = 720,000
    // 상환 이자: (12+10+8+6+4+2)백만 × 1% = 420,000
    expect(calculateTotalInterest(loan)).toBeCloseTo(1_140_000, 0);
  });

  it("원금균등: 소수 개월(11.44 등)을 정수 회차로 보정", () => {
    // 2021-01-01 → 2021-12-15 = 348일 = 11.44개월 → 11회차로 보정
    const loan = makeLoan({
      repaymentMethod: "equal_principal",
      loanAmount: 11_000_000,
      annualInterestRate: 12,
      loanDate: "2021-01-01",
      maturityDate: "2021-12-15",
      gracePeriodYears: undefined,
    });
    // 월 원금 1,000,000 / (11+10+…+1)백만 × 1% = 660,000
    expect(calculateTotalInterest(loan)).toBeCloseTo(660_000, 0);
  });

  it("원리금균등(equal_payment): 거치 이자 + 상환기간 상각 이자 (독립 시뮬레이션 대조)", () => {
    const loan = makeLoan({
      repaymentMethod: "equal_payment",
      loanAmount: 10_000_000,
      annualInterestRate: 6,
      loanDate: "2021-01-01",
      maturityDate: "2022-01-01",
      gracePeriodYears: 0.5,
    });
    // 독립 검산: 월 잔액 시뮬레이션으로 상각 이자 합산
    const P = 10_000_000;
    const r = 0.06 / 12;
    const n = 6;
    const payment = (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    let balance = P;
    let amortizedInterest = 0;
    for (let i = 0; i < n; i++) {
      const interest = balance * r;
      amortizedInterest += interest;
      balance -= payment - interest;
    }
    const graceInterest = P * 0.06 * 0.5; // 300,000
    expect(calculateTotalInterest(loan)).toBeCloseTo(graceInterest + amortizedInterest, 2);
  });

  it("거치기간이 전체 기간 이상이면 전체 기간으로 클램프", () => {
    // 1년 만기인데 거치 3년 → 이자 = 원금 × 연이율 × 1년
    const loan = makeLoan({
      repaymentMethod: "equal_principal",
      loanAmount: 10_000_000,
      annualInterestRate: 5,
      loanDate: "2021-01-01",
      maturityDate: "2022-01-01",
      gracePeriodYears: 3,
    });
    expect(calculateTotalInterest(loan)).toBeCloseTo(500_000, 0);
  });
});
