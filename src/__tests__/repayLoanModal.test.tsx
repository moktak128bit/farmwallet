// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Account, Loan } from "../types";
import { RepayLoanModal } from "../features/debt/RepayLoanModal";

afterEach(cleanup);

describe("RepayLoanModal — 금액 붙여넣기 (회귀)", () => {
  it("'1,234,567.00'을 붙여넣으면 1,234,567원으로 기록 (소수부를 이어붙여 100배가 되지 않음)", () => {
    const onChangeLedger = vi.fn();
    const loan = {
      id: "loan1", institution: "IBK", loanName: "신용대출", loanAmount: 100_000_000,
      annualInterestRate: 5, repaymentMethod: "bullet", loanDate: "2026-01-01", maturityDate: "2028-01-01",
    } as Loan;
    const account = { id: "a1", name: "입출금", type: "checking", institution: "", initialBalance: 0 } as Account;
    render(
      <RepayLoanModal
        loan={loan}
        ledger={[]}
        loanRepayments={{ principal: new Map(), interest: new Map() }}
        cashAccounts={[account]}
        loanRepaymentSubOptions={["원금상환", "이자상환"]}
        onChangeLedger={onChangeLedger}
        onClose={() => {}}
      />
    );
    const input = screen.getByLabelText(/상환 금액/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1,234,567.00" } });
    fireEvent.click(screen.getByRole("button", { name: "상환 기록" }));
    expect(onChangeLedger).toHaveBeenCalledTimes(1);
    expect(onChangeLedger.mock.calls[0][0][0].amount).toBe(1234567);
  });
});
