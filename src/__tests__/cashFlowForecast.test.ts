import { describe, it, expect } from "vitest";
import { computeCashFlowForecast } from "../utils/cashFlowForecast";
import type { RecurringExpense } from "../types";

function rec(o: Partial<RecurringExpense> & { id: string; amount: number; startDate: string }): RecurringExpense {
  return { title: "항목", category: "구독", frequency: "monthly", ...o } as RecurringExpense;
}

const TODAY = "2026-06-15";

describe("computeCashFlowForecast", () => {
  it("monthly: 윈도우 내 해당 일자만, 오늘 이전·범위 밖 제외", () => {
    const r = [rec({ id: "n", title: "넷플릭스", amount: 17000, startDate: "2026-01-25", frequency: "monthly" })];
    const f = computeCashFlowForecast(r, { todayIso: TODAY, horizonDays: 60 }); // end 2026-08-14
    expect(f.events.map((e) => e.date)).toEqual(["2026-06-25", "2026-07-25"]); // 08-25는 범위 밖
    expect(f.nextEvent?.date).toBe("2026-06-25");
    expect(f.thisMonthRemaining).toBe(17000); // 06-25만 이번 달
    expect(f.next7Days).toBe(0); // 06-22까지 없음
    expect(f.next30Days).toBe(17000); // 07-15까지 06-25
    expect(f.totalHorizon).toBe(34000);
  });

  it("monthly: 오늘 이전 같은 달 발생은 제외", () => {
    const r = [rec({ id: "rent", title: "월세", amount: 500000, startDate: "2026-03-05", frequency: "monthly" })];
    const f = computeCashFlowForecast(r, { todayIso: TODAY, horizonDays: 60 });
    expect(f.events.map((e) => e.date)).toEqual(["2026-07-05", "2026-08-05"]); // 06-05는 오늘 이전
    expect(f.thisMonthRemaining).toBe(0);
  });

  it("monthly: 말일 클램프 (31일 시작 → 짧은 달 말일)", () => {
    const r = [rec({ id: "x", amount: 100, startDate: "2026-01-31", frequency: "monthly" })];
    const f = computeCashFlowForecast(r, { todayIso: "2026-02-01", horizonDays: 30 }); // end 03-03
    // 2026-02는 28일 → 02-28로 클램프
    expect(f.events.map((e) => e.date)).toEqual(["2026-02-28"]);
  });

  it("weekly: 시작일부터 7일 간격 (시작=오늘 포함)", () => {
    const r = [rec({ id: "w", amount: 5000, startDate: "2026-06-15", frequency: "weekly" })];
    const f = computeCashFlowForecast(r, { todayIso: TODAY, horizonDays: 14 }); // end 06-29
    expect(f.events.map((e) => e.date)).toEqual(["2026-06-15", "2026-06-22", "2026-06-29"]);
    expect(f.totalHorizon).toBe(15000);
  });

  it("weekly: 시작일이 과거여도 오늘 이후 첫 발생으로 당겨 정렬", () => {
    const r = [rec({ id: "w2", amount: 5000, startDate: "2026-06-01", frequency: "weekly" })];
    const f = computeCashFlowForecast(r, { todayIso: TODAY, horizonDays: 14 }); // 06-01,08,15,22,29 중 [06-15,06-29]
    expect(f.events.map((e) => e.date)).toEqual(["2026-06-15", "2026-06-22", "2026-06-29"]);
  });

  it("yearly: 시작일의 월·일로 연 1회", () => {
    const r = [rec({ id: "ins", title: "보험", amount: 1200000, startDate: "2025-07-10", frequency: "yearly" })];
    const f = computeCashFlowForecast(r, { todayIso: TODAY, horizonDays: 60 });
    expect(f.events.map((e) => e.date)).toEqual(["2026-07-10"]);
  });

  it("미래 시작 반복은 시작 전 발생 안 함", () => {
    const r = [rec({ id: "fut", amount: 100, startDate: "2026-08-01", frequency: "monthly" })];
    const f = computeCashFlowForecast(r, { todayIso: TODAY, horizonDays: 60 }); // end 08-14
    expect(f.events.map((e) => e.date)).toEqual(["2026-08-01"]);
  });

  it("종료일 이후 발생은 제외", () => {
    const r = [rec({ id: "end", amount: 100, startDate: "2026-01-10", endDate: "2026-06-30", frequency: "monthly" })];
    const f = computeCashFlowForecast(r, { todayIso: TODAY, horizonDays: 60 });
    // 06-10은 오늘 이전, 07-10은 종료일 이후 → 없음
    expect(f.events).toEqual([]);
  });

  it("저축성지출/이체(toAccountId)는 isTransfer=true로 표기되며 현금유출에 포함", () => {
    const r = [rec({ id: "sav", title: "적금", category: "저축", amount: 300000, startDate: "2026-06-20", frequency: "monthly", toAccountId: "acc1" })];
    const f = computeCashFlowForecast(r, { todayIso: TODAY, horizonDays: 30 });
    expect(f.events[0].isTransfer).toBe(true);
    expect(f.totalHorizon).toBe(300000);
  });

  it("금액 0·시작일 없음·빈 입력·잘못된 오늘은 안전하게 빈/제외", () => {
    expect(computeCashFlowForecast([], { todayIso: TODAY }).events).toEqual([]);
    expect(computeCashFlowForecast([rec({ id: "z", amount: 0, startDate: "2026-06-20" })], { todayIso: TODAY }).events).toEqual([]);
    expect(computeCashFlowForecast([{ id: "ns", title: "x", category: "y", amount: 100, frequency: "monthly", startDate: "" }], { todayIso: TODAY }).events).toEqual([]);
    expect(computeCashFlowForecast([rec({ id: "a", amount: 100, startDate: "2026-06-20" })], { todayIso: "bad-date" }).events).toEqual([]);
  });
});
