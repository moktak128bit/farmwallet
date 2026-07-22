import { describe, it, expect } from "vitest";
import { computeBudgetGoalSpent } from "../utils/budgetUsage";
import { BUDGET_ALL_CATEGORY } from "../types";
import type { BudgetGoal, LedgerEntry } from "../types";

const goal = (o: Partial<BudgetGoal> & { category: string }): BudgetGoal => ({
  id: "b1",
  monthlyLimit: 1_000_000,
  ...o,
});

const e = (o: Partial<LedgerEntry> & { id: string }): LedgerEntry =>
  ({ date: "2026-07-10", kind: "expense", category: "지출", description: "", amount: 10_000, ...o } as LedgerEntry);

const M = "2026-07";

describe("computeBudgetGoalSpent — 예산 탭·대시보드 위젯 단일 소스", () => {
  it("개별 카테고리 예산 — 대분류(expenseMainName) 매칭, 현행·레거시 형태 모두", () => {
    const ledger = [
      e({ id: "1", subCategory: "식비", amount: 30_000 }),                  // 현행 (sub=대분류)
      e({ id: "2", category: "식비", subCategory: undefined, amount: 20_000 }), // 레거시 평면 (cat 폴백)
      e({ id: "3", subCategory: "통신비", amount: 50_000 }),                 // 다른 대분류
    ];
    expect(computeBudgetGoalSpent(goal({ category: "식비" }), ledger, M)).toBe(50_000);
  });

  it("신용결제·환전·저축성지출·투자손실은 예산 사용액에 들어가지 않는다", () => {
    // 회귀: 예전 대시보드 위젯은 이들을 안 걸러 예산 게이지가 90%로 부풀었다 (탭은 50%)
    const ledger = [
      e({ id: "1", subCategory: "식비", amount: 100_000 }),
      e({ id: "2", category: "신용결제", amount: 500_000 }),               // 이중계상
      e({ id: "3", category: "환전", amount: 300_000 }),                   // 통화 이동
      e({ id: "4", category: "저축성지출", amount: 200_000 }),             // 자산 축적
      e({ id: "5", category: "재테크", subCategory: "투자손실", amount: 400_000 }), // 재테크 순집계로
    ];
    expect(computeBudgetGoalSpent(goal({ category: BUDGET_ALL_CATEGORY }), ledger, M)).toBe(100_000);
  });

  it("USD 지출은 환율로 환산된다 — 회귀: 예산 탭이 원본 달러 액면을 더하던 버그", () => {
    const ledger = [
      e({ id: "1", subCategory: "식비", amount: 100, currency: "USD" } as Partial<LedgerEntry> & { id: string }),
    ];
    expect(computeBudgetGoalSpent(goal({ category: "식비" }), ledger, M, { fxRate: 1300 })).toBe(130_000);
    // 환율 미지정이면 액면 그대로 (toKrwAmount 정책과 동일)
    expect(computeBudgetGoalSpent(goal({ category: "식비" }), ledger, M)).toBe(100);
  });

  it("전체 예산 — excludeCategories(대분류)·excludeAccountIds(fromAccountId) 제외", () => {
    const ledger = [
      e({ id: "1", subCategory: "식비", amount: 100_000 }),
      e({ id: "2", subCategory: "데이트비", amount: 80_000 }),
      e({ id: "3", subCategory: "통신비", fromAccountId: "moim", amount: 60_000 }),
    ];
    const g = goal({ category: BUDGET_ALL_CATEGORY, excludeCategories: ["데이트비"], excludeAccountIds: ["moim"] });
    expect(computeBudgetGoalSpent(g, ledger, M)).toBe(100_000);
  });

  it("다른 달·수입·이체는 집계되지 않는다", () => {
    const ledger = [
      e({ id: "1", subCategory: "식비", amount: 100_000 }),
      e({ id: "2", date: "2026-06-30", subCategory: "식비", amount: 999_999 }),
      e({ id: "3", kind: "income", category: "수입", subCategory: "급여", amount: 3_000_000 }),
      e({ id: "4", kind: "transfer", category: "이체", subCategory: "저축이체", amount: 500_000 }),
    ];
    expect(computeBudgetGoalSpent(goal({ category: BUDGET_ALL_CATEGORY }), ledger, M)).toBe(100_000);
  });
});
