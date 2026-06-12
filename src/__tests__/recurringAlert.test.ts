import { describe, it, expect } from "vitest";
import { findOverdueRecurring } from "../utils/recurringAlert";
import type { LedgerEntry, RecurringExpense } from "../types";

function entry(o: Partial<LedgerEntry> & { id: string; amount: number }): LedgerEntry {
  return {
    date: "2026-06-15",
    kind: "expense",
    category: "지출",
    description: "",
    ...o,
  } as LedgerEntry;
}

function rec(o: Partial<RecurringExpense> & { id: string; title: string; amount: number }): RecurringExpense {
  return {
    category: "구독비",
    frequency: "monthly",
    startDate: "2026-01-15",
    ...o,
  } as RecurringExpense;
}

describe("findOverdueRecurring — 만기 판정", () => {
  it("monthly: 시작일과 같은 일자에 due", () => {
    const r = findOverdueRecurring([rec({ id: "r1", title: "넷플릭스", amount: 17_000, startDate: "2026-01-15" })], [], "2026-06-15");
    expect(r).toHaveLength(1);
    expect(r[0].dueDate).toBe("2026-06-15");
  });

  it("monthly: 일자가 다르면 due 아님", () => {
    const r = findOverdueRecurring([rec({ id: "r1", title: "넷플릭스", amount: 17_000, startDate: "2026-01-15" })], [], "2026-06-14");
    expect(r).toHaveLength(0);
  });

  it("monthly 29/30/31일 반복: 짧은 달에는 월말로 클램프되어 알림 발생", () => {
    const recurring = [rec({ id: "r1", title: "월세", amount: 500_000, startDate: "2026-01-31" })];
    // 2026-02는 28일까지 — 31일이 존재하지 않으므로 2/28에 due
    const r = findOverdueRecurring(recurring, [], "2026-02-28");
    expect(r).toHaveLength(1);
    expect(r[0].dueDate).toBe("2026-02-28");
    // 31일이 있는 달은 그대로 31일에 due
    expect(findOverdueRecurring(recurring, [], "2026-03-31")).toHaveLength(1);
    expect(findOverdueRecurring(recurring, [], "2026-03-28")).toHaveLength(0);
  });

  it("시작일이 미래면 due 아님", () => {
    const r = findOverdueRecurring([rec({ id: "r1", title: "넷플릭스", amount: 17_000, startDate: "2026-07-15" })], [], "2026-06-15");
    expect(r).toHaveLength(0);
  });

  it("endDate 지난 반복은 due 아님", () => {
    const r = findOverdueRecurring([rec({ id: "r1", title: "넷플릭스", amount: 17_000, startDate: "2026-01-15", endDate: "2026-05-31" })], [], "2026-06-15");
    expect(r).toHaveLength(0);
  });

  it("weekly: 시작 요일과 같은 요일에 due", () => {
    // 2026-06-01은 월요일 → 2026-06-15(월) due, 2026-06-16(화) 아님
    const recurring = [rec({ id: "r1", title: "주간회비", amount: 5_000, frequency: "weekly", startDate: "2026-06-01" })];
    expect(findOverdueRecurring(recurring, [], "2026-06-15")).toHaveLength(1);
    expect(findOverdueRecurring(recurring, [], "2026-06-16")).toHaveLength(0);
  });

  it("yearly: 같은 월·일에만 due", () => {
    const recurring = [rec({ id: "r1", title: "연회비", amount: 30_000, frequency: "yearly", startDate: "2025-06-15" })];
    expect(findOverdueRecurring(recurring, [], "2026-06-15")).toHaveLength(1);
    expect(findOverdueRecurring(recurring, [], "2026-07-15")).toHaveLength(0);
  });
});

describe("findOverdueRecurring — alreadyLogged (실제 생성 스키마와 매칭)", () => {
  const netflix = rec({ id: "r1", title: "넷플릭스", amount: 17_000, category: "구독비", startDate: "2026-01-15" });

  it("생성 스키마(kind=expense, category=지출, subCategory=r.category)와 매칭", () => {
    const ledger = [
      entry({ id: "l1", date: "2026-06-15", kind: "expense", category: "지출", subCategory: "구독비", detailCategory: "넷플릭스", amount: 17_000 }),
    ];
    const r = findOverdueRecurring([netflix], ledger, "2026-06-15");
    expect(r).toHaveLength(1);
    expect(r[0].alreadyLogged).toBe(true);
  });

  it("description '[반복] 제목' 형태로도 매칭", () => {
    const ledger = [
      entry({ id: "l1", date: "2026-06-15", kind: "expense", category: "지출", subCategory: "기타", description: "[반복] 넷플릭스", amount: 17_000 }),
    ];
    const r = findOverdueRecurring([netflix], ledger, "2026-06-15");
    expect(r[0].alreadyLogged).toBe(true);
  });

  it("금액이 다르면 미기록으로 판정", () => {
    const ledger = [
      entry({ id: "l1", date: "2026-06-15", kind: "expense", category: "지출", subCategory: "구독비", amount: 9_000 }),
    ];
    const r = findOverdueRecurring([netflix], ledger, "2026-06-15");
    expect(r[0].alreadyLogged).toBe(false);
  });

  it("kind 검사: 저축성(toAccountId 있음) 반복은 transfer 기록과만 매칭", () => {
    const savings = rec({ id: "r2", title: "적금", amount: 300_000, category: "저축성지출", startDate: "2026-01-15", toAccountId: "acc-save" });
    const expenseOnly = [
      entry({ id: "l1", date: "2026-06-15", kind: "expense", category: "지출", subCategory: "저축성지출", amount: 300_000 }),
    ];
    expect(findOverdueRecurring([savings], expenseOnly, "2026-06-15")[0].alreadyLogged).toBe(false);
    const transferLogged = [
      entry({ id: "l2", date: "2026-06-15", kind: "transfer", category: "이체", subCategory: "저축성지출", detailCategory: "적금", amount: 300_000, toAccountId: "acc-save" }),
    ];
    expect(findOverdueRecurring([savings], transferLogged, "2026-06-15")[0].alreadyLogged).toBe(true);
  });

  it("다른 날짜의 기록은 무시 (오늘 기록만 검사)", () => {
    const ledger = [
      entry({ id: "l1", date: "2026-05-15", kind: "expense", category: "지출", subCategory: "구독비", detailCategory: "넷플릭스", amount: 17_000 }),
    ];
    const r = findOverdueRecurring([netflix], ledger, "2026-06-15");
    expect(r[0].alreadyLogged).toBe(false);
  });
});
