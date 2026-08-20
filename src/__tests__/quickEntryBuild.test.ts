/**
 * 빠른 입력 저장 빌더 — LedgerEntryForm.submitForm(3단 저장)과 **같은 저장 형태**를 고정하는 계약 테스트.
 *
 * 폼(src/features/ledger/LedgerEntryForm.tsx submitForm)의 매핑:
 *   expense : category="지출", subCategory=대분류||"(미분류)", detailCategory=소분류(있을 때만 키), fromAccountId만
 *   income  : category="수입", subCategory=분류||"(미분류)", detailCategory 없음, toAccountId만
 *   transfer: category="이체", subCategory=분류||"(미분류)", detailCategory 없음, from·to
 *   공통    : isFixedExpense(boolean), description trim, amount
 * 폼 코드는 건드리지 않는다 — 여기서 형태가 어긋나면 빌더를 고칠 것.
 */
import { describe, it, expect } from "vitest";
import type { LedgerEntry } from "../types";
import type { Recommendation } from "../utils/categoryRecommendation";
import {
  buildQuickEntryLedgerEntry,
  quickEntryStoredCategory,
  resolveQuickEntryAccounts,
} from "../utils/quickEntryBuild";

const rec = (over: Partial<Recommendation>): Recommendation => ({ score: 1, ...over });
const defaults = { id: "L1", date: "2026-08-20" };

/** 폼 submitForm의 expense 분기를 그대로 옮긴 기준 형태 (storedCategory/storedSubCategory/storedDetailCategory) */
const formExpenseShape = (main: string, detail: string | undefined, fromAccountId: string | undefined): LedgerEntry => ({
  id: "L1",
  date: "2026-08-20",
  kind: "expense",
  isFixedExpense: false,
  category: "지출",
  subCategory: main || "(미분류)",
  ...(detail ? { detailCategory: detail } : {}),
  description: "스타벅스",
  amount: 5500,
  fromAccountId,
  toAccountId: undefined,
});

describe("buildQuickEntryLedgerEntry — 지출", () => {
  it("추천 3단(식비 › 카페)을 폼과 같은 형태로 저장: category=지출/subCategory=식비/detailCategory=카페", () => {
    const entry = buildQuickEntryLedgerEntry(
      { description: "스타벅스", amount: 5500, kind: "expense" },
      rec({ category: "지출", subCategory: "식비", detailCategory: "카페" }),
      { ...defaults, fromAccountId: "A1" }
    );
    expect(entry).toEqual(formExpenseShape("식비", "카페", "A1"));
    // 결함 회귀: detailCategory가 저장되어야 한다
    expect(entry.detailCategory).toBe("카페");
  });

  it("추천에 소분류가 없으면 detailCategory 키 자체가 없음 (폼: storedDetailCategory 없을 때 키 생략)", () => {
    const entry = buildQuickEntryLedgerEntry(
      { description: "스타벅스", amount: 5500, kind: "expense" },
      rec({ category: "지출", subCategory: "식비" }),
      { ...defaults, fromAccountId: "A1" }
    );
    expect(entry).toEqual(formExpenseShape("식비", undefined, "A1"));
    expect("detailCategory" in entry).toBe(false);
  });

  it("추천이 없으면 category=지출/subCategory=(미분류) (category='' 저장 방지)", () => {
    const entry = buildQuickEntryLedgerEntry({ description: "스타벅스", amount: 5500, kind: "expense" }, null, {
      ...defaults,
      fromAccountId: "A1",
    });
    expect(entry).toEqual(formExpenseShape("", undefined, "A1"));
    expect(entry.category).toBe("지출");
    expect(entry.subCategory).toBe("(미분류)");
  });

  it("빈 문자열 소분류·공백은 키 생략, 설명은 trim", () => {
    const entry = buildQuickEntryLedgerEntry(
      { description: "  스타벅스 ", amount: 5500, kind: "expense" },
      rec({ category: "지출", subCategory: "식비", detailCategory: "  " }),
      { ...defaults, fromAccountId: "A1" }
    );
    expect("detailCategory" in entry).toBe(false);
    expect(entry.description).toBe("스타벅스");
  });

  it("지출은 toAccountId를 저장하지 않음 (defaults.toAccountId가 와도 무시)", () => {
    const entry = buildQuickEntryLedgerEntry(
      { description: "스타벅스", amount: 5500, kind: "expense" },
      null,
      { ...defaults, fromAccountId: "A1", toAccountId: "A2" }
    );
    expect(entry.fromAccountId).toBe("A1");
    expect(entry.toAccountId).toBeUndefined();
  });

  it("추천 category가 레거시 값이어도 저장 category는 항상 '지출'", () => {
    const entry = buildQuickEntryLedgerEntry(
      { description: "스타벅스", amount: 5500, kind: "expense" },
      rec({ category: "식비", subCategory: "식비", detailCategory: "카페" }),
      { ...defaults, fromAccountId: "A1" }
    );
    expect(entry.category).toBe("지출");
    expect(entry.subCategory).toBe("식비");
  });
});

describe("buildQuickEntryLedgerEntry — 수입/이체", () => {
  it("수입: category=수입/subCategory=분류, detailCategory 없음, toAccountId만", () => {
    const entry = buildQuickEntryLedgerEntry(
      { description: "월급", amount: 3000000, kind: "income" },
      rec({ category: "수입", subCategory: "월급", detailCategory: "무시됨" }),
      { ...defaults, fromAccountId: "A9", toAccountId: "A1" }
    );
    expect(entry).toEqual({
      id: "L1",
      date: "2026-08-20",
      kind: "income",
      isFixedExpense: false,
      category: "수입",
      subCategory: "월급",
      description: "월급",
      amount: 3000000,
      fromAccountId: undefined,
      toAccountId: "A1",
    });
    expect("detailCategory" in entry).toBe(false);
  });

  it("수입 추천 없음 → subCategory=(미분류)", () => {
    const entry = buildQuickEntryLedgerEntry({ description: "용돈", amount: 10000, kind: "income" }, null, {
      ...defaults,
      toAccountId: "A1",
    });
    expect(entry.category).toBe("수입");
    expect(entry.subCategory).toBe("(미분류)");
  });

  it("이체: category=이체, from·to 둘 다, detailCategory 없음", () => {
    const entry = buildQuickEntryLedgerEntry(
      { description: "저축", amount: 100000, kind: "transfer" },
      rec({ category: "이체", subCategory: "저축이체", fromAccountId: "A1", toAccountId: "A2" }),
      { ...defaults, fromAccountId: "A1", toAccountId: "A2" }
    );
    expect(entry).toEqual({
      id: "L1",
      date: "2026-08-20",
      kind: "transfer",
      isFixedExpense: false,
      category: "이체",
      subCategory: "저축이체",
      description: "저축",
      amount: 100000,
      fromAccountId: "A1",
      toAccountId: "A2",
    });
  });
});

describe("quickEntryStoredCategory — 미리보기와 저장이 같은 매핑", () => {
  it("지출 3단", () => {
    expect(quickEntryStoredCategory("expense", rec({ subCategory: "식비", detailCategory: "카페" }))).toEqual({
      category: "지출",
      subCategory: "식비",
      detailCategory: "카페",
    });
  });
  it("수입/이체는 detail 없음", () => {
    expect(quickEntryStoredCategory("income", rec({ subCategory: "월급", detailCategory: "x" }))).toEqual({
      category: "수입",
      subCategory: "월급",
    });
    expect(quickEntryStoredCategory("transfer", null)).toEqual({ category: "이체", subCategory: "(미분류)" });
  });
});

describe("resolveQuickEntryAccounts — kind별 계좌", () => {
  it("지출: 기본 계좌를 출금으로", () => {
    expect(resolveQuickEntryAccounts("expense", null, "A1")).toEqual({ ok: true, fromAccountId: "A1" });
  });
  it("수입: 기본 계좌를 입금으로", () => {
    expect(resolveQuickEntryAccounts("income", null, "A1")).toEqual({ ok: true, toAccountId: "A1" });
  });
  it("이체: 추천의 from/to 사용, from 없으면 기본 계좌", () => {
    expect(resolveQuickEntryAccounts("transfer", { fromAccountId: "A1", toAccountId: "A2" }, "A9")).toEqual({
      ok: true,
      fromAccountId: "A1",
      toAccountId: "A2",
    });
    expect(resolveQuickEntryAccounts("transfer", { toAccountId: "A2" }, "A9")).toEqual({
      ok: true,
      fromAccountId: "A9",
      toAccountId: "A2",
    });
  });
  it("이체: 입금 계좌 없음·동일 계좌는 거부", () => {
    expect(resolveQuickEntryAccounts("transfer", null, "A1")).toEqual({ ok: false, reason: "transfer-needs-both" });
    expect(resolveQuickEntryAccounts("transfer", { fromAccountId: "A1", toAccountId: "A1" }, "A9")).toEqual({
      ok: false,
      reason: "transfer-needs-both",
    });
  });
});
