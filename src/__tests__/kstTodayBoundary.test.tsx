// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, renderHook, cleanup } from "@testing-library/react";
import { getTodayKST, getThisMonthKST } from "../utils/date";
import { BudgetDashboardSection } from "../features/budget/BudgetDashboardSection";
import { useInsightsData } from "../features/insights/useInsightsData";
import type { LedgerEntry } from "../types";

/**
 * KST 자정 경계 회귀 테스트 — '오늘' 일자 계산이 브라우저 로컬/UTC(new Date())가 아니라
 * KST(getTodayKST) 기준인지 고정한다.
 *   UTC 2026-08-19T15:30Z = KST 2026-08-20 00:30 → 오늘은 8/20이어야 한다.
 *   UTC 2026-08-19T14:30Z = KST 2026-08-19 23:30 → 오늘은 8/19.
 * 머신 타임존과 무관하게 동일해야 한다 (getKoreaTime이 timezoneOffset으로 보정).
 */
const AFTER_KST_MIDNIGHT = new Date("2026-08-19T15:30:00Z"); // KST 08-20 00:30
const BEFORE_KST_MIDNIGHT = new Date("2026-08-19T14:30:00Z"); // KST 08-19 23:30

const freeze = (d: Date) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(d);
};

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("getTodayKST — 자정 경계", () => {
  it("KST 00:30(UTC 전날 15:30)이면 KST 날짜(다음 날)를 돌려준다", () => {
    freeze(AFTER_KST_MIDNIGHT);
    expect(getTodayKST()).toBe("2026-08-20");
    expect(getThisMonthKST()).toBe("2026-08");
  });
  it("KST 23:30(UTC 14:30)이면 아직 같은 날", () => {
    freeze(BEFORE_KST_MIDNIGHT);
    expect(getTodayKST()).toBe("2026-08-19");
  });
  it("월말 자정 직후 — 월도 KST 기준으로 넘어간다 (UTC 08-31 15:30 = KST 09-01)", () => {
    freeze(new Date("2026-08-31T15:30:00Z"));
    expect(getTodayKST()).toBe("2026-09-01");
    expect(getThisMonthKST()).toBe("2026-09");
  });
});

describe("BudgetDashboardSection — 'N/M일차' 오늘 일자는 KST", () => {
  it("KST 08-20 00:30이면 20/31일차·11일 남음 (new Date()였다면 UTC 기준 19일차로 어긋남)", () => {
    freeze(AFTER_KST_MIDNIGHT);
    const { container } = render(<BudgetDashboardSection budgetUsage={[]} accounts={[]} />);
    expect(container.textContent).toContain("(20/31일차)");
    expect(container.textContent).toContain("11일 남음");
  });
  it("KST 08-19 23:30이면 19/31일차", () => {
    freeze(BEFORE_KST_MIDNIGHT);
    const { container } = render(<BudgetDashboardSection budgetUsage={[]} accounts={[]} />);
    expect(container.textContent).toContain("(19/31일차)");
  });
});

describe("useInsightsData — 무지출일 분모(totalDays)는 KST 오늘까지", () => {
  const ledger: LedgerEntry[] = [
    { id: "e1", date: "2026-08-01", kind: "expense", category: "지출", subCategory: "식비", description: "", amount: 10_000 },
  ];
  const run = () =>
    renderHook(() =>
      // (ledger, rawTrades, allTrades, accounts, prices, selMonth, presets, budgetGoals, dateAccountId, fxRate, timelineRows, allLedger)
      useInsightsData(ledger, [], [], [], [], "2026-08", undefined, undefined, null, null, [], ledger)
    ).result.current;

  it("진행 중인 달: KST 08-20 00:30 → totalDays=20, zeroDays=19", () => {
    freeze(AFTER_KST_MIDNIGHT);
    const d = run();
    expect(d.totalDays).toBe(20);
    expect(d.zeroDays).toBe(19);
  });
  it("진행 중인 달: KST 08-19 23:30 → totalDays=19", () => {
    freeze(BEFORE_KST_MIDNIGHT);
    expect(run().totalDays).toBe(19);
  });
  it("완결된 달은 월 전체 일수", () => {
    freeze(AFTER_KST_MIDNIGHT);
    const prev = renderHook(() =>
      useInsightsData(
        [{ ...ledger[0], date: "2026-07-01" }], [], [], [], [], "2026-07", undefined, undefined, null, null, [], [{ ...ledger[0], date: "2026-07-01" }]
      )
    ).result.current;
    expect(prev.totalDays).toBe(31);
  });
});
