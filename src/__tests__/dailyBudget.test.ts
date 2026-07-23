import { describe, it, expect } from "vitest";
import { DEFAULT_DAILY_BUDGET, dailySpend, weeklySpend } from "../utils/dailyBudget";
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

describe("dailySpend/weeklySpend — USD 항목 환율 환산 (회귀)", () => {
  const cfg = { ...DEFAULT_DAILY_BUDGET, enabled: true };
  it("USD 지출은 fxRate로 원화 환산 후 합산 (액면 달러가 원화로 섞이던 버그)", () => {
    const ledger = [
      e({ id: "1", subCategory: "식비", amount: 10_000 }),               // KRW
      e({ id: "2", subCategory: "식비", amount: 5, currency: "USD" }),    // USD 수수료
    ];
    // fxRate 1,380 → USD 5 = 6,900원. 총 16,900원
    expect(dailySpend(ledger, "2026-07-10", cfg, 1_380)).toBe(16_900);
    // fxRate 미전달 시 USD는 액면 유지(하위호환) → 10,005
    expect(dailySpend(ledger, "2026-07-10", cfg)).toBe(10_005);
  });

  it("weeklySpend도 동일하게 USD 환산", () => {
    const ledger = [
      e({ id: "1", date: "2026-07-06", subCategory: "식비", amount: 3, currency: "USD" }),
    ];
    expect(weeklySpend(ledger, "2026-07-05", "2026-07-11", cfg, 1_400)).toBe(4_200);
  });
});
