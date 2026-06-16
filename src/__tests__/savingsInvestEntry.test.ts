/**
 * 재테크 탭 직접 입력(투자수익·투자손실·배당·이자)의 저장 매핑이
 * 분류 단일소스(summaryMath·categoryMatch·categoryUtils)와 정확히 맞물리는지 검증.
 * 폼이 만들어내는 엔트리를 각 집계 함수가 올바른 성격으로 인식해야 화면 수치가 일관된다.
 */
import { describe, it, expect } from "vitest";
import { SAVINGS_INVEST_SUBS, savingsInvestStored } from "../features/ledger/LedgerEntryForm";
import { classifyLedgerFlow } from "../features/dashboard/summaryMath";
import { isInvestmentKind } from "../utils/categoryUtils";
import { isDividendEntry, isInterestEntry } from "../utils/categoryMatch";
import type { LedgerEntry } from "../types";

const asEntry = (sub: string): LedgerEntry => {
  const m = savingsInvestStored(sub);
  return { id: "x", date: "2026-06-15", kind: m.kind, category: m.category, subCategory: m.subCategory, description: "", amount: 100_000 };
};

describe("savingsInvestStored — 재테크 입력 저장 매핑", () => {
  it("투자손실 → 지출/재테크/투자손실", () => {
    expect(savingsInvestStored("투자손실")).toEqual({ kind: "expense", category: "재테크", subCategory: "투자손실" });
  });
  it("투자수익 → 수입/수입/투자수익", () => {
    expect(savingsInvestStored("투자수익")).toEqual({ kind: "income", category: "수입", subCategory: "투자수익" });
  });
  it("배당/이자 → 수입 (배당/이자 탭 입력과 동일 형태)", () => {
    expect(savingsInvestStored("배당")).toEqual({ kind: "income", category: "수입", subCategory: "배당" });
    expect(savingsInvestStored("이자")).toEqual({ kind: "income", category: "수입", subCategory: "이자" });
  });

  it("4종 중분류 모두 매핑된다", () => {
    for (const sub of SAVINGS_INVEST_SUBS) {
      const m = savingsInvestStored(sub);
      expect(m.subCategory).toBe(sub);
    }
  });
});

describe("재테크 입력 엔트리가 분류 단일소스에 올바르게 인식됨", () => {
  it("투자손실: 재테크(investing)로 분류 — 일반 지출에서 제외", () => {
    const e = asEntry("투자손실");
    expect(classifyLedgerFlow(e)).toBe("investing"); // 생활 지출이 아니라 재테크
    expect(isInvestmentKind(e)).toBe(true);
  });
  it("투자수익: 재테크(investing)로 분류 — 일반 수입에서 제외", () => {
    const e = asEntry("투자수익");
    expect(classifyLedgerFlow(e)).toBe("investing");
    expect(isInvestmentKind(e)).toBe(true);
  });
  it("배당: isDividendEntry 정확 매칭", () => {
    expect(isDividendEntry(asEntry("배당"))).toBe(true);
  });
  it("이자: isInterestEntry 정확 매칭", () => {
    expect(isInterestEntry(asEntry("이자"))).toBe(true);
  });
});
