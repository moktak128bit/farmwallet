import { describe, it, expect } from "vitest";
import {
  buildFixedCategorySet,
  isFixedExpense,
  classifyExpenses,
} from "../utils/expenseClassification";
import type { CategoryPresets, LedgerEntry } from "../types";

const presets: CategoryPresets = {
  income: ["급여"],
  expense: ["주거", "통신", "식비"],
  transfer: [],
  expenseDetails: [
    { main: "주거", subs: ["월세", "관리비"] },
    { main: "통신", subs: ["휴대폰", "인터넷"] },
    { main: "식비", subs: ["외식", "장보기"] },
  ],
  categoryTypes: {
    fixed: ["주거", "통신"],
  },
};

function exp(o: Partial<LedgerEntry> & { id: string; amount: number }): LedgerEntry {
  return {
    date: "2026-04-01",
    kind: "expense",
    category: "",
    description: "",
    ...o,
  } as LedgerEntry;
}

describe("buildFixedCategorySet", () => {
  it("fixed 대분류 + 그 하위 중분류가 모두 포함", () => {
    const s = buildFixedCategorySet(presets);
    expect(s.has("주거")).toBe(true);
    expect(s.has("월세")).toBe(true);
    expect(s.has("관리비")).toBe(true);
    expect(s.has("통신")).toBe(true);
    expect(s.has("휴대폰")).toBe(true);
    expect(s.has("인터넷")).toBe(true);
  });

  it("fixed에 없는 대분류의 중분류는 포함 안 됨", () => {
    const s = buildFixedCategorySet(presets);
    expect(s.has("식비")).toBe(false);
    expect(s.has("외식")).toBe(false);
  });

  it("presets undefined → 빈 집합", () => {
    expect(buildFixedCategorySet(undefined).size).toBe(0);
  });

  it("categoryTypes.fixed 누락 → 빈 집합", () => {
    const p: CategoryPresets = { income: [], expense: [], transfer: [] };
    expect(buildFixedCategorySet(p).size).toBe(0);
  });

  it("expenseDetails 누락 → 대분류만 포함", () => {
    const p: CategoryPresets = {
      income: [],
      expense: [],
      transfer: [],
      categoryTypes: { fixed: ["주거"] },
    };
    const s = buildFixedCategorySet(p);
    expect(s.has("주거")).toBe(true);
    expect(s.size).toBe(1);
  });
});

describe("isFixedExpense", () => {
  const fixedCats = buildFixedCategorySet(presets);

  it("subCategory가 fixed 집합에 있으면 고정비", () => {
    expect(isFixedExpense(exp({ id: "1", amount: 500_000, category: "주거", subCategory: "월세" }), fixedCats)).toBe(true);
  });

  it("subCategory 없고 category만 fixed면 고정비", () => {
    expect(isFixedExpense(exp({ id: "1", amount: 500_000, category: "통신" }), fixedCats)).toBe(true);
  });

  it("isFixedExpense 플래그가 fixed 집합 매칭보다 우선 (둘 다 true여도 true)", () => {
    expect(isFixedExpense(exp({ id: "1", amount: 100, category: "식비", isFixedExpense: true }), fixedCats)).toBe(true);
  });

  it("플래그 없고 카테고리도 fixed 아니면 변동비", () => {
    expect(isFixedExpense(exp({ id: "1", amount: 10_000, category: "식비", subCategory: "외식" }), fixedCats)).toBe(false);
  });

  it("좌우 공백은 trim 후 매칭 — '주거 ' 도 매칭됨", () => {
    expect(isFixedExpense(exp({ id: "1", amount: 100, category: "주거 " }), fixedCats)).toBe(true);
  });
});

describe("classifyExpenses", () => {
  it("고정비/변동비 합계가 정확히 분리", () => {
    const fExp = [
      exp({ id: "1", amount: 500_000, category: "주거", subCategory: "월세" }),    // 고정
      exp({ id: "2", amount: 100_000, category: "통신", subCategory: "휴대폰" }),   // 고정
      exp({ id: "3", amount: 50_000, category: "식비", subCategory: "외식" }),     // 변동
      exp({ id: "4", amount: 30_000, category: "식비", subCategory: "장보기" }),    // 변동
    ];
    const r = classifyExpenses(fExp, presets);
    expect(r.fixedExpense).toBe(600_000);
    expect(r.variableExpense).toBe(80_000);
  });

  it("isFixedExpense 플래그로 비-고정 카테고리도 고정비 분류", () => {
    const fExp = [
      exp({ id: "1", amount: 200_000, category: "구독", subCategory: "넷플릭스", isFixedExpense: true }),
      exp({ id: "2", amount: 5_000, category: "식비" }),
    ];
    const r = classifyExpenses(fExp, presets);
    expect(r.fixedExpense).toBe(200_000);
    expect(r.variableExpense).toBe(5_000);
  });

  it("presets 없으면 모두 변동비 (플래그 없는 한)", () => {
    const fExp = [
      exp({ id: "1", amount: 100, category: "주거" }),
      exp({ id: "2", amount: 200, category: "식비" }),
    ];
    const r = classifyExpenses(fExp, undefined);
    expect(r.fixedExpense).toBe(0);
    expect(r.variableExpense).toBe(300);
  });

  it("빈 배열 → 0/0", () => {
    expect(classifyExpenses([], presets)).toEqual({ fixedExpense: 0, variableExpense: 0 });
  });

  it("회귀: 합계 = 고정 + 변동 = 입력 amount 합 (누락·중복 없음)", () => {
    const fExp = [
      exp({ id: "1", amount: 500_000, category: "주거", subCategory: "월세" }),
      exp({ id: "2", amount: 100_000, category: "통신" }),
      exp({ id: "3", amount: 50_000, category: "식비" }),
      exp({ id: "4", amount: 80_000, category: "구독", isFixedExpense: true }),
    ];
    const r = classifyExpenses(fExp, presets);
    const inputSum = fExp.reduce((s, l) => s + Number(l.amount), 0);
    expect(r.fixedExpense + r.variableExpense).toBe(inputSum);
  });
});
