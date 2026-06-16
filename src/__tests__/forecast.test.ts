import { describe, it, expect } from "vitest";
import { forecastNextMonth, expenseMainTotalsForMonth } from "../utils/forecast";
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
  freq: "monthly" | "weekly" | "yearly" = "monthly",
  startDate = "2024-01-01",
  endDate?: string
): RecurringExpense => ({
  id: Math.random().toString(36).slice(2),
  title: "test",
  amount,
  category,
  frequency: freq,
  startDate,
  endDate,
});

describe("expenseMainTotalsForMonth — 현재월 실적은 expenseMainName 키 + 예측과 동일 제외", () => {
  it("현행 스키마(category='지출', subCategory=대분류)를 대분류 키로 집계 (l.category로 뭉뚱그려 0% 되던 회귀 방지)", () => {
    const ledger: LedgerEntry[] = [
      { id: "a", date: "2026-06-03", kind: "expense", category: "지출", subCategory: "식비", detailCategory: "외식", description: "", amount: 30_000 },
      { id: "b", date: "2026-06-04", kind: "expense", category: "지출", subCategory: "식비", description: "", amount: 20_000 },
      { id: "c", date: "2026-06-05", kind: "expense", category: "지출", subCategory: "교통", description: "", amount: 10_000 },
      // 제외 대상: 신용결제·환전·다른 달
      { id: "d", date: "2026-06-06", kind: "expense", category: "환전", description: "", amount: 999_999 },
      { id: "e", date: "2026-05-30", kind: "expense", category: "지출", subCategory: "식비", description: "", amount: 5_000 },
    ];
    const m = expenseMainTotalsForMonth(ledger, "2026-06");
    expect(m.get("식비")).toBe(50_000); // 외식+식비, 대분류로 합쳐짐
    expect(m.get("교통")).toBe(10_000);
    expect(m.get("환전")).toBeUndefined();
    expect([...m.values()].reduce((s, v) => s + v, 0)).toBe(60_000);
  });
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

  it("variableAverage: 완결된 과거 lookback 개월의 expense 평균 (현재 월 제외)", () => {
    const ledger: LedgerEntry[] = [
      mkExpense("2024-01-15", "외식", 100_000),
      mkExpense("2024-02-15", "외식", 200_000),
      mkExpense("2024-03-15", "외식", 300_000),
      mkExpense("2024-04-15", "외식", 100_000),
      mkExpense("2024-05-15", "외식", 200_000),
      mkExpense("2024-06-15", "외식", 300_000),
    ];
    // currentMonth=2024-07, lookback=6 → 2024-01..2024-06 (직전 6개 완결 월)
    const r = forecastNextMonth(ledger, [], "2024-07", 6);
    const c = r.byCategory.find((x) => x.category === "외식");
    expect(c).toBeDefined();
    expect(c!.variableAverage).toBe(200_000); // (100+200+300+100+200+300)/6
    expect(c!.basedOnMonths).toBe(6);
  });

  it("진행 중인 현재 월은 lookback에서 제외 — 월초의 작은 합계가 평균을 끌어내리지 않음", () => {
    const ledger: LedgerEntry[] = [
      mkExpense("2024-05-15", "외식", 300_000), // 완결 월
      mkExpense("2024-06-02", "외식", 10_000),  // 진행 중인 현재 월 (월초)
    ];
    const r = forecastNextMonth(ledger, [], "2024-06", 1);
    const c = r.byCategory.find((x) => x.category === "외식")!;
    // lookback=1 → 2024-05만 사용. 2024-06의 1만원은 평균에 미포함.
    expect(c.variableAverage).toBe(300_000);
    expect(c.basedOnMonths).toBe(1);
  });

  it("forecast = max(recurring, variableAverage)", () => {
    const ledger: LedgerEntry[] = [
      mkExpense("2024-05-01", "통신비", 30_000),
    ];
    const recurring = [mkRecurring("통신비", 50_000)];
    const r = forecastNextMonth(ledger, recurring, "2024-06");
    const c = r.byCategory.find((x) => x.category === "통신비")!;
    expect(c.forecast).toBe(50_000); // recurring이 더 큼
  });

  it("std로 인한 신뢰구간: lower는 0 미만으로 안 떨어짐", () => {
    const ledger: LedgerEntry[] = [
      mkExpense("2024-05-01", "기타", 1000),
      // 다른 달은 0
    ];
    const r = forecastNextMonth(ledger, [], "2024-06", 6);
    const c = r.byCategory.find((x) => x.category === "기타")!;
    expect(c.lower).toBeGreaterThanOrEqual(0);
    expect(c.upper).toBeGreaterThanOrEqual(c.forecast);
  });

  it("expense 외 kind는 제외 (income, transfer 무시)", () => {
    const ledger: LedgerEntry[] = [
      { ...mkExpense("2024-05-01", "외식", 100_000), kind: "income" },
      { ...mkExpense("2024-05-02", "외식", 100_000), kind: "transfer" },
    ];
    const r = forecastNextMonth(ledger, [], "2024-06");
    expect(r.byCategory).toEqual([]);
  });

  it("amount가 0 이하인 항목은 무시", () => {
    const ledger: LedgerEntry[] = [
      mkExpense("2024-05-01", "외식", 0),
      mkExpense("2024-05-02", "외식", -100),
    ];
    const r = forecastNextMonth(ledger, [], "2024-06");
    expect(r.byCategory).toEqual([]);
  });

  it("weekly 반복은 예측 월 발생 횟수로 월 환산 포함, yearly는 미포함", () => {
    const recurring = [
      mkRecurring("월간", 10_000, "monthly"),
      // 2024-01-01은 월요일 — 2024년 7월 월요일: 1, 8, 15, 22, 29 → 5회
      mkRecurring("주간", 7_000, "weekly", "2024-01-01"),
      mkRecurring("연간", 12_000, "yearly"),
    ];
    const r = forecastNextMonth([], recurring, "2024-06");
    expect(r.forecastMonth).toBe("2024-07");
    expect(r.byCategory.map((c) => c.category).sort()).toEqual(["월간", "주간"]);
    expect(r.byCategory.find((c) => c.category === "월간")!.recurringAmount).toBe(10_000);
    expect(r.byCategory.find((c) => c.category === "주간")!.recurringAmount).toBe(7_000 * 5);
  });

  it("weekly: 예측 월 중간에 시작하면 시작일 이후 발생만 카운트", () => {
    // 2024-07-20(토) 시작 — 7월 토요일 중 20, 27 → 2회
    const recurring = [mkRecurring("주간", 5_000, "weekly", "2024-07-20")];
    const r = forecastNextMonth([], recurring, "2024-06");
    expect(r.byCategory).toHaveLength(1);
    expect(r.byCategory[0].recurringAmount).toBe(5_000 * 2);
  });

  it("weekly: endDate 이후 발생은 제외", () => {
    // 2024-01-01(월) 시작, 2024-07-10 종료 — 7월 월요일 중 1, 8만 포함 (15 이후 제외)
    const recurring = [mkRecurring("주간", 5_000, "weekly", "2024-01-01", "2024-07-10")];
    const r = forecastNextMonth([], recurring, "2024-06");
    expect(r.byCategory).toHaveLength(1);
    expect(r.byCategory[0].recurringAmount).toBe(5_000 * 2);
  });

  it("weekly: 예측 월 이후 시작이면 미포함", () => {
    const recurring = [mkRecurring("주간", 5_000, "weekly", "2024-09-01")];
    const r = forecastNextMonth([], recurring, "2024-06");
    expect(r.byCategory).toEqual([]);
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

  it("현행 스키마(category='지출')는 subCategory 대분류로 분리 (한 버킷 붕괴 방지)", () => {
    const cur = (date: string, sub: string, amount: number): LedgerEntry =>
      ({ id: Math.random().toString(36).slice(2), date, kind: "expense", category: "지출", subCategory: sub, description: "", amount });
    const ledger = [
      cur("2024-05-10", "식비", 100_000), cur("2024-04-10", "식비", 100_000),
      cur("2024-05-11", "교통", 50_000), cur("2024-04-11", "교통", 50_000),
    ];
    const r = forecastNextMonth(ledger, [], "2024-06", 6);
    expect(r.byCategory.map((c) => c.category).sort()).toEqual(["교통", "식비"]);
  });

  it("신용결제·재테크(저축/투자)·환전은 지출 예측에서 제외", () => {
    const ex = (cat: string, sub: string): LedgerEntry =>
      ({ id: Math.random().toString(36).slice(2), date: "2024-05-10", kind: "expense", category: cat, subCategory: sub, description: "", amount: 500_000 });
    const ledger = [ex("신용결제", "신용결제"), ex("재테크", "투자"), ex("환전", "환전수수료")];
    const r = forecastNextMonth(ledger, [], "2024-06", 6);
    expect(r.byCategory).toEqual([]);
    expect(r.totalForecast).toBe(0);
  });
});
