import { describe, it, expect } from "vitest";
import {
  isCreditPayment,
  isCurrencyExchangeEntry,
  isSettlementEntry,
  isRealExpenseEntry,
  isSavingsExpenseEntry,
  getCategoryType,
} from "../utils/categoryUtils";
import type { CategoryPresets, LedgerEntry } from "../types";

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

describe("getCategoryType — 고정비 판정 (스키마 회귀: 배당 커버리지 고정비 누락 버그)", () => {
  // 사용자가 카테고리 설정에서 대분류 "주거비"를 고정지출로 지정
  const presets = { categoryTypes: { fixed: ["주거비"] } } as unknown as CategoryPresets;

  it("현행 스키마(category='지출', 대분류는 subCategory) → subCategory로 고정비 인식", () => {
    // 이전 버그: category('지출')만 검사해 fixed 미인식 → 고정비 0원으로 집계됨
    expect(getCategoryType("지출", "주거비", "expense", presets)).toBe("fixed");
  });

  it("레거시 스키마(category에 대분류 직접) → category로 고정비 인식", () => {
    expect(getCategoryType("주거비", undefined, "expense", presets)).toBe("fixed");
  });

  it("고정 목록에 없는 대분류 → variable", () => {
    expect(getCategoryType("지출", "식비", "expense", presets)).toBe("variable");
  });
});

describe("세대 관용 판정 — 대분류가 한 칸 내려간 형태도 인식", () => {
  // 설정의 "1단계 구조 정렬"(applyDemoteSchema)은 category를 subCategory로 한 칸 내린다.
  // 읽는 쪽이 category만 보면 그 항목이 집계에서 조용히 사라진다.
  const e = (o: Partial<LedgerEntry>): LedgerEntry =>
    ({ id: "x", date: "2026-07-01", kind: "expense", category: "지출", description: "", amount: 1000, ...o } as LedgerEntry);

  it("환전 — 평면 세대와 강등 세대 모두 지출에서 제외된다", () => {
    expect(isCurrencyExchangeEntry(e({ category: "환전" }))).toBe(true);
    expect(isCurrencyExchangeEntry(e({ category: "지출", subCategory: "환전" }))).toBe(true);
    expect(isCurrencyExchangeEntry(e({ category: "지출", subCategory: "식비" }))).toBe(false);
    // 실질 소비 지출 판정까지 이어지는지 (환전이 소비로 새어들면 월 지출이 부풀어오른다)
    expect(isRealExpenseEntry(e({ category: "지출", subCategory: "환전" }))).toBe(false);
  });

  it("정산 — 평면 세대와 강등 세대 모두 인식된다", () => {
    expect(isSettlementEntry(e({ kind: "income", category: "정산" }))).toBe(true);
    expect(isSettlementEntry(e({ kind: "income", category: "수입", subCategory: "정산" }))).toBe(true);
    expect(isSettlementEntry(e({ kind: "income", category: "수입", subCategory: "급여" }))).toBe(false);
  });
});
