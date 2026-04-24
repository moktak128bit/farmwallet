import { describe, it, expect } from "vitest";
import { forecastNextMonth } from "../utils/forecast";
import type { LedgerEntry, RecurringExpense } from "../types";

const mkExpense = (date: string, category: string, amount: number): LedgerEntry => ({
  id: Math.random().toString(36).slice(2),
  date,
  kind: "expense",
  category,
  description: "test",
  amount,
});

const mkRecurring = (
  category: string,
  amount: number,
  freq: "monthly" | "weekly" | "yearly" = "monthly"
): RecurringExpense => ({
  id: Math.random().toString(36).slice(2),
  title: "test",
  amount,
  category,
  frequency: freq,
  startDate: "2024-01-01",
});

describe("forecastNextMonth", () => {
  it("빈 데이터: 카테고리 없음, 합계 0", () => {
    const r = forecastNextMonth([], [], "2024-06");
    expect(r.byCategory).toEqual([]);
    expect(r.totalForecast).toBe(0);
    expect(r.totalLower).toBe(0);
    expect(r.totalUpper).toBe(0);
    expect(r.baseMonth).toBe("2024-06");
    expect(r.forecastMonth).toBe("2024-07");
  });

  it("월 경계 처리: 12월 → 다음 해 1월", () => {
    const r = forecastNextMonth([], [], "2024-12");
    expect(r.forecastMonth).toBe("2025-01");
  });

  it("반복지출만 있을 때 forecast = recurring 합계, std=0이라 lower=upper=forecast", () => {
    const recurring = [mkRecurring("통신비", 50_000)];
    const r = forecastNextMonth([], recurring, "2024-06");
    expect(r.byCategory).toHaveLength(1);
    const c = r.byCategory[0];
    expect(c.category).toBe("통신비");
    expect(c.recurringAmount).toBe(50_000);
    expect(c.forecast).toBe(50_000);
    expect(c.lower).toBe(50_000);
    expect(c.upper).toBe(50_000);
  });

  it("variableAverage: lookback 기간 내 expense 평균", () => {
    const ledger: LedgerEntry[] = [
      mkExpense("2024-01-15", "외식", 100_000),
      mkExpense("2024-02-15", "외식", 200_000),
      mkExpense("2024-03-15", "외식", 300_000),
      mkExpense("2024-04-15", "외식", 100_000),
      mkExpense("2024-05-15", "외식", 200_000),
      mkExpense("2024-06-15", "외식", 300_000),
    ];
    // currentMonth=2024-06, lookback=6 → 2024-01..2024-06 모두 포함
    const r = forecastNextMonth(ledger, [], "2024-06", 6);
    const c = r.byCategory.find((x) => x.category === "외식");
    expect(c).toBeDefined();
    expect(c!.variableAverage).toBe(200_000); // (100+200+300+100+200+300)/6
    expect(c!.basedOnMonths).toBe(6);
  });

  it("forecast = max(recurring, variableAverage)", () => {
    const ledger: LedgerEntry[] = [
      mkExpense("2024-06-01", "통신비", 30_000),
    ];
    const recurring = [mkRecurring("통신비", 50_000)];
    const r = forecastNextMonth(ledger, recurring, "2024-06");
    const c = r.byCategory.find((x) => x.category === "통신비")!;
    expect(c.forecast).toBe(50_000); // recurring이 더 큼
  });

  it("std로 인한 신뢰구간: lower는 0 미만으로 안 떨어짐", () => {
    const ledger: LedgerEntry[] = [
      mkExpense("2024-06-01", "기타", 1000),
      // 다른 달은 0
    ];
    const r = forecastNextMonth(ledger, [], "2024-06", 6);
    const c = r.byCategory.find((x) => x.category === "기타")!;
    expect(c.lower).toBeGreaterThanOrEqual(0);
    expect(c.upper).toBeGreaterThanOrEqual(c.forecast);
  });

  it("expense 외 kind는 제외 (income, transfer 무시)", () => {
    const ledger: LedgerEntry[] = [
      { ...mkExpense("2024-06-01", "외식", 100_000), kind: "income" },
      { ...mkExpense("2024-06-02", "외식", 100_000), kind: "transfer" },
    ];
    const r = forecastNextMonth(ledger, [], "2024-06");
    expect(r.byCategory).toEqual([]);
  });

  it("amount가 0 이하인 항목은 무시", () => {
    const ledger: LedgerEntry[] = [
      mkExpense("2024-06-01", "외식", 0),
      mkExpense("2024-06-02", "외식", -100),
    ];
    const r = forecastNextMonth(ledger, [], "2024-06");
    expect(r.byCategory).toEqual([]);
  });

  it("weekly/yearly 반복지출은 (현재 정책상) recurringByCat에 미포함", () => {
    const recurring = [
      mkRecurring("월간", 10_000, "monthly"),
      mkRecurring("주간", 7_000, "weekly"),
      mkRecurring("연간", 12_000, "yearly"),
    ];
    const r = forecastNextMonth([], recurring, "2024-06");
    expect(r.byCategory).toHaveLength(1);
    expect(r.byCategory[0].category).toBe("월간");
    expect(r.byCategory[0].recurringAmount).toBe(10_000);
  });

  it("totalForecast = byCategory.forecast 합", () => {
    const recurring = [mkRecurring("A", 10_000), mkRecurring("B", 20_000)];
    const r = forecastNextMonth([], recurring, "2024-06");
    expect(r.totalForecast).toBe(30_000);
  });

  it("결과는 forecast 내림차순 정렬", () => {
    const recurring = [
      mkRecurring("작음", 1_000),
      mkRecurring("큼", 100_000),
      mkRecurring("중간", 50_000),
    ];
    const r = forecastNextMonth([], recurring, "2024-06");
    expect(r.byCategory.map((c) => c.category)).toEqual(["큼", "중간", "작음"]);
  });
});
