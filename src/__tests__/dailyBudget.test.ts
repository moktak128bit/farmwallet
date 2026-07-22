import { describe, it, expect } from "vitest";
import { DEFAULT_DAILY_BUDGET, dailySpend } from "../utils/dailyBudget";
import type { LedgerEntry } from "../types";

const e = (o: Partial<LedgerEntry> & { id: string }): LedgerEntry =>
  ({ date: "2026-07-10", kind: "expense", category: "지출", description: "", amount: 10_000, ...o } as LedgerEntry);

describe("dailySpend — 한도 계산 대상 판정", () => {
  it("기본 제외(신용결제·재테크 등 category 직접)와 일반 지출 합산", () => {
    const cfg = { ...DEFAULT_DAILY_BUDGET, enabled: true };
    const ledger = [
      e({ id: "1", subCategory: "식비", amount: 12_000 }),
      e({ id: "2", category: "신용결제", amount: 300_000 }),
      e({ id: "3", kind: "income", category: "수입", subCategory: "급여", amount: 1_000_000 }),
    ];
    expect(dailySpend(ledger, "2026-07-10", cfg)).toBe(12_000);
  });

  it("excludedSubCategories는 대분류 기준 — 레거시 평면(cat=통신비, sub 없음)도 제외 (회귀)", () => {
    const cfg = { ...DEFAULT_DAILY_BUDGET, enabled: true };
    const ledger = [
      e({ id: "1", subCategory: "식비", amount: 10_000 }),
      e({ id: "2", subCategory: "통신비", amount: 50_000 }),          // 표준 — 제외
      e({ id: "3", category: "통신비", subCategory: undefined, amount: 40_000 }), // 레거시 평면 — 예전엔 sub만 봐서 누락
    ];
    expect(dailySpend(ledger, "2026-07-10", cfg)).toBe(10_000);
  });
});
