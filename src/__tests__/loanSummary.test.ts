import { describe, it, expect } from "vitest";
import { summarizeLoans } from "../features/debt/debtShared";
import type { Loan } from "../types";

const loan = (over: Partial<Loan>): Loan => ({
  id: "L1",
  institution: "은행",
  loanName: "대출",
  loanAmount: 10_000_000,
  annualInterestRate: 4,
  repaymentMethod: "equal_payment",
  loanDate: "2025-01-01",
  maturityDate: "2030-01-01",
  ...over,
});

describe("summarizeLoans — 부채 탭 표·합계 줄", () => {
  const loans = [
    loan({ id: "A", loanName: "작은 대출", loanAmount: 2_000_000, annualInterestRate: 1.7 }),
    loan({ id: "B", loanName: "큰 대출", loanAmount: 20_000_000, annualInterestRate: 4.7 }),
    loan({ id: "C", loanName: "다 갚은 대출", loanAmount: 1_000_000, annualInterestRate: 9 }),
  ];
  const repayments = {
    principal: new Map([["B", 5_000_000], ["C", 1_000_000]]),
    interest: new Map([["A", 40_000], ["B", 300_000]]),
  };
  const s = summarizeLoans(loans, repayments, "2026-09-22");

  it("잔금 = 대출금액 − 원금 상환 (0 미만 없음), 잔금 큰 순 정렬", () => {
    expect(s.rows.map((r) => r.loan.id)).toEqual(["B", "A", "C"]);
    expect(s.rows[0].balance).toBe(15_000_000);
    expect(s.rows[2].balance).toBe(0);
  });

  it("합계·건수·진행률", () => {
    expect(s.totalBalance).toBe(17_000_000);
    expect(s.count).toBe(3);
    expect(s.rows[0].progress).toBeCloseTo(0.25, 6);
    expect(s.rows[2].progress).toBe(1);
  });

  it("가중 금리는 잔금 가중 — 다 갚은 대출(잔금 0)의 9%는 영향 없음", () => {
    // (15,000,000×4.7 + 2,000,000×1.7) / 17,000,000 = 4.347…
    expect(s.weightedRate).toBeCloseTo(4.347, 2);
  });

  it("남은 기간(일)은 오늘(KST) 기준, 만기 지난 대출은 음수", () => {
    expect(s.rows[0].remainingDays).toBeGreaterThan(1000);
    const past = summarizeLoans([loan({ maturityDate: "2020-01-01" })], { principal: new Map(), interest: new Map() }, "2026-09-22");
    expect(past.rows[0].remainingDays).toBeLessThan(0);
  });

  it("대출이 없으면 합계 0·가중 금리 null", () => {
    const e = summarizeLoans([], { principal: new Map(), interest: new Map() }, "2026-09-22");
    expect(e.totalBalance).toBe(0);
    expect(e.weightedRate).toBeNull();
    expect(e.rows).toEqual([]);
  });
});
