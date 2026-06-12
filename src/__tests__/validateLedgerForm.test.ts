/**
 * 가계부 입력 폼 검증(validateLedgerForm) 단위 테스트.
 * - 할인 초과 검증: 수입·지출 공통 (지출 누락 버그 회귀 방지)
 * - 미래 날짜 거부, 금액 형식 검증
 */
import { describe, it, expect } from "vitest";
import { validateLedgerForm, type LedgerFormSnapshot } from "../features/ledger/validateLedgerForm";
import { parseAmount as sharedParseAmount } from "../utils/parseAmount";
import { getTodayKST } from "../utils/date";
import type { Account } from "../types";

const accounts = [
  { id: "농협", name: "농협", type: "checking" },
  { id: "카카오", name: "카카오", type: "checking" },
] as Account[];

const parseAmount = (value: string, allowDecimal?: boolean) =>
  sharedParseAmount(value, { allowDecimal });

const baseForm = (over: Partial<LedgerFormSnapshot> = {}): LedgerFormSnapshot => ({
  date: getTodayKST(),
  amount: "10,000",
  currency: "KRW",
  fromAccountId: "농협",
  toAccountId: "",
  mainCategory: "식비",
  subCategory: "외식",
  discountAmount: "",
  ...over,
});

const validateExpense = (form: LedgerFormSnapshot) =>
  validateLedgerForm({
    form,
    kindForTab: "expense",
    effectiveFormKind: "expense",
    accounts,
    parseAmount,
  });

const validateIncome = (form: LedgerFormSnapshot) =>
  validateLedgerForm({
    form,
    kindForTab: "income",
    effectiveFormKind: "income",
    accounts,
    parseAmount,
  });

describe("validateLedgerForm — 지출 할인", () => {
  it("할인 ≤ 금액이면 통과", () => {
    const errors = validateExpense(baseForm({ discountAmount: "3,000" }));
    expect(errors.discountAmount).toBeUndefined();
  });

  it("할인 = 금액(전액 할인, 0원)이면 통과", () => {
    const errors = validateExpense(baseForm({ discountAmount: "10,000" }));
    expect(errors.discountAmount).toBeUndefined();
  });

  it("할인 > 금액이면 거부 (음수 금액 저장 방지)", () => {
    const errors = validateExpense(baseForm({ discountAmount: "15,000" }));
    expect(errors.discountAmount).toBe("할인은 금액(할인 전)을 넘을 수 없습니다");
  });
});

describe("validateLedgerForm — 수입 할인 (기존 규칙 유지)", () => {
  it("할인 > 금액이면 거부", () => {
    const errors = validateIncome(
      baseForm({ toAccountId: "카카오", fromAccountId: "", subCategory: "급여", discountAmount: "15,000" })
    );
    expect(errors.discountAmount).toBe("할인은 금액(할인 전)을 넘을 수 없습니다");
  });

  it("할인 후 순액이 0이면 거부 (수입은 순액 > 0 필요)", () => {
    const errors = validateIncome(
      baseForm({ toAccountId: "카카오", fromAccountId: "", subCategory: "급여", discountAmount: "10,000" })
    );
    expect(errors.amount).toBe("할인 후 실제 수입액은 0보다 커야 합니다");
  });
});

describe("validateLedgerForm — 날짜·금액", () => {
  it("미래 날짜는 거부", () => {
    const errors = validateExpense(baseForm({ date: "2999-01-01" }));
    expect(errors.date).toBeTruthy();
  });

  it("빈 날짜는 거부", () => {
    const errors = validateExpense(baseForm({ date: "" }));
    expect(errors.date).toBeTruthy();
  });

  it("금액 0은 거부", () => {
    const errors = validateExpense(baseForm({ amount: "0" }));
    expect(errors.amount).toBe("금액은 0보다 커야 합니다");
  });
});
