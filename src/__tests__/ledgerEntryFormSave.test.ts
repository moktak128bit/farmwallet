/**
 * 가계부 폼 저장 형태 회귀.
 *  - 수정 저장(mergeEditedEntry): 폼에 없는 필드(note·loanId·settledLedgerIds·수입/지출 USD)를 잃지 않고,
 *    폼이 다루는 선택 필드는 종류·분류가 바뀌면 지워진다.
 *  - 지출 탭에 대분류 "재테크"로 들어온 항목(복사·템플릿·최근 칩)은 재테크 형태로 저장(expenseStored).
 */
import { describe, it, expect } from "vitest";
import { expenseStored, mergeEditedEntry } from "../features/ledger/LedgerEntryForm";
import { classifyLedgerFlow } from "../features/dashboard/summaryMath";
import { isInvestmentLossEntry } from "../utils/categoryUtils";
import type { LedgerEntry } from "../types";

type Base = Omit<LedgerEntry, "id">;
const prevOf = (o: Partial<LedgerEntry>): LedgerEntry =>
  ({ id: "L1", date: "2026-06-10", kind: "expense", category: "지출", description: "", amount: 1000, ...o } as LedgerEntry);

describe("mergeEditedEntry — 수정 저장이 폼 밖 필드를 지우지 않는다", () => {
  it("대출 상환: loanId·note 보존", () => {
    const prev = prevOf({ subCategory: "대출상환", detailCategory: "원금상환", loanId: "LN1", note: "3회차", amount: 500_000, fromAccountId: "A1" });
    const base: Base = { date: "2026-06-11", kind: "expense", category: "지출", subCategory: "대출상환", detailCategory: "원금상환", description: "IBK", amount: 600_000, fromAccountId: "A1" };
    const next = mergeEditedEntry(prev, base);
    expect(next).toMatchObject({ id: "L1", loanId: "LN1", note: "3회차", amount: 600_000, date: "2026-06-11" });
  });

  it("정산 입금: settledLedgerIds 보존 (정산한 지출이 미정산으로 되살아나지 않게)", () => {
    const prev = prevOf({ kind: "income", category: "수입", subCategory: "정산", toAccountId: "A1", settledLedgerIds: ["L7", "L8"], amount: 40_000 });
    const base: Base = { date: "2026-06-10", kind: "income", category: "수입", subCategory: "정산", description: "데이트 정산", amount: 40_000, toAccountId: "A1" };
    expect(mergeEditedEntry(prev, base).settledLedgerIds).toEqual(["L7", "L8"]);
  });

  it("USD 지출: 종류가 그대로면 currency 유지 ($30이 30원으로 둔갑 금지)", () => {
    const prev = prevOf({ subCategory: "구독비", currency: "USD", amount: 30, fromAccountId: "U1" });
    const base: Base = { date: "2026-06-10", kind: "expense", category: "지출", subCategory: "구독비", description: "", amount: 30, fromAccountId: "U1" };
    expect(mergeEditedEntry(prev, base).currency).toBe("USD");
  });

  it("지출→수입 전환: detailCategory·fromAccountId·discountAmount·tags·currency가 남지 않는다", () => {
    const prev = prevOf({ subCategory: "식비", detailCategory: "외식", fromAccountId: "A1", discountAmount: 500, tags: ["t"], currency: "USD" });
    const base: Base = { date: "2026-06-10", kind: "income", category: "수입", subCategory: "급여", description: "", amount: 1000, toAccountId: "A1" };
    const next = mergeEditedEntry(prev, base);
    expect(next.detailCategory).toBeUndefined();
    expect(next.fromAccountId).toBeUndefined();
    expect(next.discountAmount).toBeUndefined();
    expect(next.tags).toBeUndefined();
    expect(next.currency).toBeUndefined();
    expect(next.toAccountId).toBe("A1");
  });

  it("이체 통화는 폼 값을 따른다 (USD→KRW 전환 반영)", () => {
    const prev = prevOf({ kind: "transfer", category: "이체", subCategory: "계좌이체", currency: "USD", fromAccountId: "U1", toAccountId: "A1" });
    const base: Base = { date: "2026-06-10", kind: "transfer", category: "이체", subCategory: "계좌이체", description: "", amount: 1000, fromAccountId: "U1", toAccountId: "A1" };
    expect(mergeEditedEntry(prev, base).currency).toBeUndefined();
  });
});

describe("expenseStored — 지출 탭 대분류 '재테크'는 재테크 형태로 저장", () => {
  it("현행 지출은 {지출, 대분류, 소분류}", () => {
    expect(expenseStored("식비", "외식")).toEqual({ category: "지출", subCategory: "식비", detailCategory: "외식" });
    expect(expenseStored("", "")).toEqual({ category: "지출", subCategory: "(미분류)", detailCategory: undefined });
  });

  it("재테크/수수료 → {재테크, 수수료}: 소비가 아니라 재테크 순집계(−)", () => {
    const s = expenseStored("재테크", "수수료");
    expect(s).toEqual({ category: "재테크", subCategory: "수수료", detailCategory: undefined });
    const entry = { id: "x", date: "2026-06-10", kind: "expense", description: "", amount: 1000, ...s } as LedgerEntry;
    expect(classifyLedgerFlow(entry)).toBe("investing");
    expect(isInvestmentLossEntry(entry)).toBe(true);
  });
});
