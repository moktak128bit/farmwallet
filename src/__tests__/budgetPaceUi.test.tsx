// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, cleanup } from "@testing-library/react";
import { BudgetAlertWidget } from "../features/dashboard/BudgetAlertWidget";
import { BudgetDashboardSection } from "../features/budget/BudgetDashboardSection";
import { computeBudgetPace } from "../utils/budgetPace";
import type { BudgetGoal, LedgerEntry } from "../types";

/**
 * 예산 페이스 UI — 대시보드 위젯은 한도를 넘기 전에 '초과 예상'을 선행 경고하고,
 * 예산 탭 카드는 '이 페이스면 월말 N원 · 남은 N일 하루 N원'과 전월 동기(1~N일)를 보여준다.
 * 오늘 = KST 2026-08-10 (UTC 08-10 03:00).
 */
const TODAY = new Date("2026-08-10T03:00:00Z");

const freeze = (d: Date) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(d);
};
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const e = (o: Partial<LedgerEntry> & { id: string; date: string }): LedgerEntry =>
  ({ kind: "expense", category: "지출", subCategory: "식비", description: "", amount: 10_000, ...o } as LedgerEntry);

const FOOD: BudgetGoal = { id: "b1", category: "식비", monthlyLimit: 300_000 };

describe("BudgetAlertWidget — 초과 예상 선행 경고", () => {
  it("사용 33%(80% 문턱 미만)여도 페이스상 월말 초과면 '초과 예상' 배지+경고", () => {
    freeze(TODAY);
    // 10일간 100,000원 → 선형 310,000 > 한도 300,000
    const ledger = [e({ id: "1", date: "2026-08-03", amount: 60_000 }), e({ id: "2", date: "2026-08-09", amount: 40_000 })];
    const { container } = render(<BudgetAlertWidget ledger={ledger} budgetGoals={[FOOD]} />);
    const text = container.textContent ?? "";
    expect(text).toContain("1건 초과 예상");
    expect(text).toContain("월말 310,000원");
    expect(text).toContain("식비(월말 +3%) 예산이 이 페이스면 월말에 초과될 예정입니다.");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("페이스가 한도 안이면 경고 없음 (기존 80%/100% 문턱 동작 보존)", () => {
    freeze(TODAY);
    const ledger = [e({ id: "1", date: "2026-08-03", amount: 30_000 })]; // 선형 93,000
    const { container } = render(<BudgetAlertWidget ledger={ledger} budgetGoals={[FOOD]} />);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).not.toContain("초과 예상");
    expect(container.textContent).toContain("남은 21일 하루");
  });

  it("이미 초과(100%↑)면 '초과'가 우선 — 초과 예상 배지는 붙지 않는다", () => {
    freeze(TODAY);
    const ledger = [e({ id: "1", date: "2026-08-03", amount: 300_000 })];
    const { container } = render(<BudgetAlertWidget ledger={ledger} budgetGoals={[FOOD]} />);
    expect(container.textContent).toContain("1건 초과");
    expect(container.textContent).not.toContain("초과 예상");
    expect(container.textContent).toContain("식비 예산을 초과했습니다!");
  });
});

describe("BudgetDashboardSection — 카드 페이스 줄·전월 동기", () => {
  it("'이 페이스면 월말 N원(한도 ±x%) · 남은 N일 하루 N원' + 전월 동기(1~N일) 표시", () => {
    freeze(TODAY);
    const ledger = [
      e({ id: "1", date: "2026-08-03", amount: 60_000 }),
      e({ id: "2", date: "2026-08-09", amount: 40_000 }),
      e({ id: "p1", date: "2026-07-05", amount: 50_000 }),
      e({ id: "p2", date: "2026-07-20", amount: 500_000 }), // 동기 밖 — 전월 동기에 안 들어감, 이력(월말 예상)엔 반영
    ];
    const pace = computeBudgetPace(FOOD, ledger, "2026-08", "2026-08-10");
    const rows = [{ ...FOOD, spent: pace.spent, remain: FOOD.monthlyLimit - pace.spent, pace }];
    const { container } = render(<BudgetDashboardSection budgetUsage={rows} accounts={[]} />);
    const text = container.textContent ?? "";
    expect(text).toContain("초과 예상");
    expect(text).toContain("이 페이스면 월말");
    expect(text).toContain("남은 21일 하루");
    expect(text).toContain("전월 동기(1~10일) 50,000원");
    expect(text).toContain("(+100%)"); // 100,000 vs 50,000
    expect(text).not.toContain("속도 초과"); // 예전 선형 배지 제거
  });
});
