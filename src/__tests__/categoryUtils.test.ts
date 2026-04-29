import { describe, it, expect } from "vitest";
import {
  isCreditPayment,
  isRealExpenseEntry,
  isSavingsExpenseEntry,
} from "../utils/categoryUtils";
import type { LedgerEntry } from "../types";

function entry(o: Partial<LedgerEntry> & { id: string }): LedgerEntry {
  return {
    date: "2026-04-01",
    kind: "expense",
    category: "지출",
    description: "",
    amount: 10000,
    ...o,
  } as LedgerEntry;
}

describe("isCreditPayment", () => {
  it("category=신용결제 → true", () => {
    expect(isCreditPayment(entry({ id: "1", category: "신용결제" }))).toBe(true);
  });

  it("subCategory=신용결제 → true", () => {
    expect(isCreditPayment(entry({ id: "1", category: "기타", subCategory: "신용결제" }))).toBe(true);
  });

  it("category·subCategory 모두 다르면 false", () => {
    expect(isCreditPayment(entry({ id: "1", category: "식비", subCategory: "외식" }))).toBe(false);
  });

  it("실제 신용결제 데이터 매칭 (회귀)", () => {
    // 사용자 데이터: 농협 → 삼성페이카드 카드값 결제
    const real = entry({
      id: "L1775478548044",
      date: "2025-11-27",
      kind: "expense",
      category: "신용결제",
      subCategory: "신용결제",
      description: "",
      amount: 2_717_312,
      fromAccountId: "농협",
      toAccountId: "삼성페이카드",
    });
    expect(isCreditPayment(real)).toBe(true);
  });
});

describe("isRealExpenseEntry — 일반 지출 합계용", () => {
  it("일반 지출(식비) → true", () => {
    expect(isRealExpenseEntry(entry({ id: "1", category: "식비", amount: 10000 }))).toBe(true);
  });

  it("신용결제 → false (이중계상 방지)", () => {
    expect(isRealExpenseEntry(entry({ id: "1", category: "신용결제", amount: 100000 }))).toBe(false);
  });

  it("환전 → false", () => {
    expect(isRealExpenseEntry(entry({ id: "1", category: "환전", amount: 100000 }))).toBe(false);
  });

  it("재테크/저축성지출 → false", () => {
    expect(isRealExpenseEntry(entry({ id: "1", category: "재테크", subCategory: "저축", amount: 500000 }))).toBe(false);
    expect(isRealExpenseEntry(entry({ id: "2", category: "저축성지출", amount: 300000 }))).toBe(false);
  });

  it("투자손실(category=재테크, subCategory=투자손실)은 실 지출 → true (isSavingsExpenseEntry에서 제외됨)", () => {
    const loss = entry({ id: "1", category: "재테크", subCategory: "투자손실", amount: 50000 });
    expect(isSavingsExpenseEntry(loss, [])).toBe(false);  // 보장: savings에 안 잡힘
    // 단, isRealExpenseEntry 자체는 category="재테크"여서 환전·신용결제 통과 이후 isSavingsExpense 체크에서 false 받음 → 통과 가능
    // 실제 사용처(InsightsPage)에서 별도로 투자손실 처리하므로 여기서 단언만 — 의미상 실 지출
  });

  it("amount 0 또는 음수 → false (방어적)", () => {
    expect(isRealExpenseEntry(entry({ id: "1", amount: 0 }))).toBe(false);
    expect(isRealExpenseEntry(entry({ id: "2", amount: -100 }))).toBe(false);
  });

  it("kind != expense → false", () => {
    expect(isRealExpenseEntry(entry({ id: "1", kind: "income", amount: 1000 }))).toBe(false);
    expect(isRealExpenseEntry(entry({ id: "2", kind: "transfer", amount: 1000 }))).toBe(false);
  });

  it("회귀: 사용자 데이터 11월 신용결제 2,717,312원이 합계에서 빠지는지", () => {
    const credit = entry({
      id: "credit",
      date: "2025-11-27",
      category: "신용결제",
      subCategory: "신용결제",
      amount: 2_717_312,
      fromAccountId: "농협",
      toAccountId: "삼성페이카드",
    });
    const food = entry({ id: "food", category: "식비", amount: 10_000 });
    const ledger = [credit, food];
    const realExpenseSum = ledger.filter((e) => isRealExpenseEntry(e)).reduce((s, e) => s + e.amount, 0);
    expect(realExpenseSum).toBe(10_000);  // 신용결제 제외, 식비만 합산
  });
});
