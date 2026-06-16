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

  it("monthly: 마감일 전이면 due 아님", () => {
    const r = findOverdueRecurring([rec({ id: "r1", title: "넷플릭스", amount: 17_000, startDate: "2026-01-15" })], [], "2026-06-14");
    expect(r).toHaveLength(0);
  });

  it("monthly: 마감일이 지나도 그 달 안에선 미등록으로 계속 알림 (하루 결근 누락 방지)", () => {
    // 과거 버그: 마감 당일(5일)에만 떴고, 6일에 켜면 영영 사라짐
    const r = rec({ id: "r1", title: "월세", amount: 500_000, startDate: "2026-01-05" });
    const res = findOverdueRecurring([r], [], "2026-06-16");
    expect(res).toHaveLength(1);
    expect(res[0].dueDate).toBe("2026-06-05");
  });

  it("monthly: 마감 한 달 이상 지나면 알림 종료 (다음 달 마감은 미래라 자연 종료)", () => {
    const r = rec({ id: "r1", title: "월세", amount: 500_000, startDate: "2026-01-05" });
    // 7-04는 7월 마감(7-05)이 아직 미래라 6월 누락이 잡히지 않음
    expect(findOverdueRecurring([r], [], "2026-07-04")).toHaveLength(0);
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

  it("weekly: 마감 요일에 due, 같은 주 며칠간은 미등록이면 계속 알림", () => {
    // 2026-06-01은 월요일 → 2026-06-15(월) 마감
    const recurring = [rec({ id: "r1", title: "주간회비", amount: 5_000, frequency: "weekly", startDate: "2026-06-01" })];
    expect(findOverdueRecurring(recurring, [], "2026-06-15")[0].dueDate).toBe("2026-06-15");
    // 화요일에도 미등록이면 계속(같은 주 마감일 06-15)
    const tue = findOverdueRecurring(recurring, [], "2026-06-16");
    expect(tue).toHaveLength(1);
    expect(tue[0].dueDate).toBe("2026-06-15");
    // 다음 주 월요일은 새 마감일
    expect(findOverdueRecurring(recurring, [], "2026-06-22")[0].dueDate).toBe("2026-06-22");
  });

  it("yearly: 기념일에 due, 약 한 달까지 미등록 알림 후 종료", () => {
    const recurring = [rec({ id: "r1", title: "연회비", amount: 30_000, frequency: "yearly", startDate: "2025-06-15" })];
    expect(findOverdueRecurring(recurring, [], "2026-06-15")).toHaveLength(1);
    // 기념일 5일 후 미등록이면 계속 알림
    expect(findOverdueRecurring(recurring, [], "2026-06-20")).toHaveLength(1);
    // 기념일 전이면 아직 아님
    expect(findOverdueRecurring(recurring, [], "2026-06-10")).toHaveLength(0);
    // 한 달 이상 지나면 종료(과도한 알림 방지)
    expect(findOverdueRecurring(recurring, [], "2026-07-20")).toHaveLength(0);
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

  it("마감 윈도우(마감일~오늘) 밖 기록은 무시 — 이전 달 기록은 미기록", () => {
    const ledger = [
      entry({ id: "l1", date: "2026-05-15", kind: "expense", category: "지출", subCategory: "구독비", detailCategory: "넷플릭스", amount: 17_000 }),
    ];
    const r = findOverdueRecurring([netflix], ledger, "2026-06-15");
    expect(r[0].alreadyLogged).toBe(false);
  });

  it("마감일에 기록했으면 며칠 뒤 조회에서도 alreadyLogged (마감일~오늘 구간 검사)", () => {
    const rent = rec({ id: "r1", title: "월세", amount: 500_000, category: "주거비", startDate: "2026-01-05" });
    const ledger = [
      entry({ id: "l1", date: "2026-06-05", kind: "expense", category: "지출", subCategory: "주거비", detailCategory: "월세", amount: 500_000 }),
    ];
    const r = findOverdueRecurring([rent], ledger, "2026-06-16");
    expect(r).toHaveLength(1);
    expect(r[0].alreadyLogged).toBe(true);
  });
});
