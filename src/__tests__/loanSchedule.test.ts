import { describe, it, expect } from "vitest";
import { buildLoanPaymentSchedule } from "../utils/loanSchedule";
import { remainingMonthsBetween } from "../utils/loanPrepay";
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

describe("buildLoanPaymentSchedule — 원금균등", () => {
  it("결제일은 loanDate의 일(15일), 잔금÷남은회차 고정 원금 + 잔금 이자", () => {
    const loan = makeLoan({ repaymentMethod: "equal_principal", annualInterestRate: 12 });
    const fromIso = "2026-08-01";
    // remainingMonthsBetween(2026-08-01, 2027-01-15) = 6회 (5개월+부분달 올림)
    const n = remainingMonthsBetween(fromIso, loan.maturityDate);
    expect(n).toBe(6);
    const entries = buildLoanPaymentSchedule(loan, 1_200_000, fromIso, "2026-11-01");
    expect(entries.map((e) => e.date)).toEqual(["2026-08-15", "2026-09-15", "2026-10-15"]);
    const principalPerMonth = 1_200_000 / n; // 200,000
    expect(entries[0].principal).toBeCloseTo(principalPerMonth, 0);
    expect(entries[0].interest).toBeCloseTo(1_200_000 * (0.12 / 12), 0);
    expect(entries[0].remainingBalance).toBeCloseTo(1_200_000 - principalPerMonth, 0);
    expect(entries[1].remainingBalance).toBeCloseTo(1_200_000 - 2 * principalPerMonth, 0);
    expect(entries[2].remainingBalance).toBeCloseTo(1_200_000 - 3 * principalPerMonth, 0);
    // 원금+이자 = 총납입액
    for (const e of entries) expect(e.principal + e.interest).toBeCloseTo(e.totalPayment, 6);
  });

  it("잔금 소진 후(또는 만기 이후) 결제일은 생성하지 않는다", () => {
    const loan = makeLoan({ repaymentMethod: "equal_principal" });
    const entries = buildLoanPaymentSchedule(loan, 1_200_000, "2026-08-01", "2028-06-01");
    // remainingMonthsBetween(2026-08-01, 2027-01-15)=6 -> 6회에 전액 상환, 그 이후는 생성 안 됨
    expect(entries.length).toBe(6);
    expect(entries[entries.length - 1].remainingBalance).toBe(0);
    expect(entries[entries.length - 1].date <= loan.maturityDate).toBe(true);
  });
});

describe("buildLoanPaymentSchedule — 원리금균등", () => {
  it("매월 총 납입액이 거의 동일(마지막 회차 제외)", () => {
    const loan = makeLoan({ repaymentMethod: "equal_payment", annualInterestRate: 6 });
    const entries = buildLoanPaymentSchedule(loan, 6_000_000, "2026-08-01", "2027-02-01");
    expect(entries.length).toBeGreaterThan(1);
    const first = entries[0].totalPayment;
    for (const e of entries.slice(0, -1)) {
      expect(e.totalPayment).toBeCloseTo(first, 0);
    }
    for (const e of entries) {
      expect(e.principal + e.interest).toBeCloseTo(e.totalPayment, 6);
    }
  });

  it("이자율 0%면 균등 분할(이자 0)", () => {
    const loan = makeLoan({
      repaymentMethod: "equal_payment",
      annualInterestRate: 0,
      loanDate: "2026-01-15",
      maturityDate: "2026-04-15",
    });
    const fromIso = "2026-01-01";
    // remainingMonthsBetween(2026-01-01, 2026-04-15) = 4회(부분달 올림)
    const n = remainingMonthsBetween(fromIso, loan.maturityDate);
    expect(n).toBe(4);
    const entries = buildLoanPaymentSchedule(loan, 3_000_000, fromIso, "2026-04-01");
    for (const e of entries) {
      expect(e.interest).toBe(0);
      expect(e.principal).toBeCloseTo(3_000_000 / n, 0);
    }
  });
});

describe("buildLoanPaymentSchedule — 만기일시(bullet)", () => {
  it("만기 전까지는 이자만, 만기일에 마지막 이자+원금 전액 한 번에", () => {
    const loan = makeLoan({
      repaymentMethod: "bullet",
      annualInterestRate: 12,
      loanDate: "2026-01-15",
      maturityDate: "2026-04-15",
    });
    const entries = buildLoanPaymentSchedule(loan, 12_000_000, "2026-01-01", "2026-05-01");
    expect(entries.map((e) => e.date)).toEqual(["2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15"]);
    const interestOnly = entries.filter((e) => e.date < "2026-04-15");
    expect(interestOnly.length).toBe(3);
    for (const e of interestOnly) {
      expect(e.principal).toBe(0);
      expect(e.interest).toBeCloseTo(12_000_000 * (0.12 / 12), 0);
    }
    const bulletEntry = entries.find((e) => e.date === "2026-04-15")!;
    expect(bulletEntry.principal).toBe(12_000_000);
    expect(bulletEntry.interest).toBeCloseTo(12_000_000 * (0.12 / 12), 0);
    expect(bulletEntry.remainingBalance).toBe(0);
  });

  it("만기가 범위 밖이면 원금 항목이 생기지 않는다(이자만 계속)", () => {
    const loan = makeLoan({
      repaymentMethod: "bullet",
      annualInterestRate: 12,
      loanDate: "2026-01-15",
      maturityDate: "2027-01-15",
    });
    const entries = buildLoanPaymentSchedule(loan, 12_000_000, "2026-01-01", "2026-03-01");
    expect(entries.every((e) => e.principal === 0)).toBe(true);
  });
});

describe("buildLoanPaymentSchedule — 거치 기간", () => {
  it("거치 중에는 원금 0, 이자만 결제", () => {
    const loan = makeLoan({
      repaymentMethod: "equal_principal",
      annualInterestRate: 12,
      loanDate: "2026-01-15",
      maturityDate: "2028-01-15",
      gracePeriodYears: 1,
    });
    const entries = buildLoanPaymentSchedule(loan, 12_000_000, "2026-01-01", "2026-04-01");
    for (const e of entries) {
      expect(e.principal).toBe(0);
      expect(e.interest).toBeCloseTo(12_000_000 * (0.12 / 12), 0);
    }
  });
});

describe("buildLoanPaymentSchedule — 말일 클램프·경계", () => {
  it("loanDate가 31일이면 30일까지인 달은 말일로 클램프", () => {
    const loan = makeLoan({ loanDate: "2026-01-31", maturityDate: "2027-01-31", repaymentMethod: "equal_principal" });
    const entries = buildLoanPaymentSchedule(loan, 1_200_000, "2026-04-01", "2026-05-01");
    expect(entries.map((e) => e.date)).toEqual(["2026-04-30"]);
  });

  it("잔금 0 이하·무효 날짜·범위 역전·이미 만기 지남은 빈 배열", () => {
    const loan = makeLoan({});
    expect(buildLoanPaymentSchedule(loan, 0, "2026-01-01", "2026-12-01")).toEqual([]);
    expect(buildLoanPaymentSchedule(loan, -100, "2026-01-01", "2026-12-01")).toEqual([]);
    expect(buildLoanPaymentSchedule(loan, 1_000_000, "2026-12-01", "2026-01-01")).toEqual([]);
    expect(buildLoanPaymentSchedule({ ...loan, maturityDate: "bad" }, 1_000_000, "2026-01-01", "2026-12-01")).toEqual([]);
    // fromIso가 이미 만기 이후
    expect(buildLoanPaymentSchedule(loan, 1_000_000, "2027-06-01", "2027-12-01")).toEqual([]);
  });
});
