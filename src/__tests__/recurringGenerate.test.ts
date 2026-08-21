import { describe, it, expect } from "vitest";
import type { CategoryPresets, LedgerEntry, RecurringExpense } from "../types";
import {
  filterDuplicateOccurrences,
  generateOccurrencesForMonthFromRecurring,
  getDefaultExpenseCategory
} from "../utils/recurringGenerate";

const DEFAULT_CAT = "생활비";

function rec(o: Partial<RecurringExpense> & { id: string; title: string; amount: number }): RecurringExpense {
  return {
    category: "구독비",
    frequency: "monthly",
    startDate: "2026-01-15",
    ...o
  } as RecurringExpense;
}

function entry(o: Partial<LedgerEntry> & { id: string; amount: number; date: string }): LedgerEntry {
  return {
    kind: "expense",
    category: "지출",
    description: "",
    ...o
  } as LedgerEntry;
}

const gen = (list: RecurringExpense[], month: string) =>
  generateOccurrencesForMonthFromRecurring(list, month, DEFAULT_CAT);

describe("getDefaultExpenseCategory", () => {
  it("프리셋 없음 → (고정지출)", () => {
    expect(getDefaultExpenseCategory(undefined)).toBe("(고정지출)");
    expect(getDefaultExpenseCategory({ income: [], expense: [], transfer: [] })).toBe("(고정지출)");
  });
  it("재테크는 건너뛰고 첫 지출 대분류", () => {
    const presets: CategoryPresets = { income: [], expense: ["재테크", "식비", "교통"], transfer: [] };
    expect(getDefaultExpenseCategory(presets)).toBe("식비");
  });
  it("재테크뿐이면 재테크 폴백", () => {
    const presets: CategoryPresets = { income: [], expense: ["재테크"], transfer: [] };
    expect(getDefaultExpenseCategory(presets)).toBe("재테크");
  });
});

describe("generateOccurrencesForMonthFromRecurring — 생성 스키마", () => {
  it("expense: kind=expense, category=지출, subCategory=r.category, detailCategory=description=title, isFixedExpense", () => {
    const occ = gen([rec({ id: "r1", title: "넷플릭스", amount: 17_000, fromAccountId: "A1" })], "2026-06");
    expect(occ).toHaveLength(1);
    const e = occ[0].entry;
    expect(occ[0].frequency).toBe("monthly");
    expect(e.id.startsWith("L")).toBe(true);
    expect(e.date).toBe("2026-06-15");
    expect(e.kind).toBe("expense");
    expect(e.category).toBe("지출");
    expect(e.subCategory).toBe("구독비");
    expect(e.detailCategory).toBe("넷플릭스");
    expect(e.description).toBe("넷플릭스");
    expect(e.amount).toBe(17_000);
    expect(e.fromAccountId).toBe("A1");
    expect(e.toAccountId).toBeUndefined();
    expect(e.isFixedExpense).toBe(true);
  });

  it("toAccountId 있으면 transfer/이체, 카테고리 공란이면 저축성지출", () => {
    const occ = gen([rec({ id: "r1", title: "적금", amount: 300_000, category: "", toAccountId: "S1", fromAccountId: "A1" })], "2026-06");
    const e = occ[0].entry;
    expect(e.kind).toBe("transfer");
    expect(e.category).toBe("이체");
    expect(e.subCategory).toBe("저축성지출");
    expect(e.toAccountId).toBe("S1");
  });

  it("expense + 카테고리 공란이면 주입된 기본 지출 대분류", () => {
    const occ = gen([rec({ id: "r1", title: "x", amount: 1000, category: "  " })], "2026-06");
    expect(occ[0].entry.subCategory).toBe(DEFAULT_CAT);
  });

  it("title 공란이면 detailCategory undefined", () => {
    const occ = gen([rec({ id: "r1", title: "", amount: 1000 })], "2026-06");
    expect(occ[0].entry.detailCategory).toBeUndefined();
  });

  it("startDate 공란/파싱 실패는 건너뜀", () => {
    expect(gen([rec({ id: "r1", title: "a", amount: 1, startDate: "" })], "2026-06")).toHaveLength(0);
    expect(gen([rec({ id: "r2", title: "a", amount: 1, startDate: "   " })], "2026-06")).toHaveLength(0);
    expect(gen([rec({ id: "r3", title: "a", amount: 1, startDate: "garbage" })], "2026-06")).toHaveLength(0);
  });

  it("매 호출마다 새 id (재생성 시 id 충돌 없음)", () => {
    const r = rec({ id: "r1", title: "a", amount: 1 });
    const a = gen([r], "2026-06")[0].entry.id;
    const b = gen([r], "2026-06")[0].entry.id;
    expect(a).not.toBe(b);
  });
});

describe("generateOccurrencesForMonthFromRecurring — kind='income'(정기 수입, 3-4)", () => {
  it("kind=income + toAccountId 있으면 kind=income, category=수입, subCategory=r.category", () => {
    const occ = gen(
      [rec({ id: "r1", title: "월급", amount: 3_000_000, kind: "income", category: "월급", toAccountId: "A1" })],
      "2026-06"
    );
    expect(occ).toHaveLength(1);
    const e = occ[0].entry;
    expect(e.kind).toBe("income");
    expect(e.category).toBe("수입");
    expect(e.subCategory).toBe("월급");
    expect(e.detailCategory).toBe("월급");
    expect(e.toAccountId).toBe("A1");
    expect(e.isFixedExpense).toBe(false); // "고정 지출" 플래그는 수입에 세우지 않음
  });

  it("kind=income인데 toAccountId 없으면 생성하지 않음 (입금계좌 필수 가드)", () => {
    const occ = gen(
      [rec({ id: "r1", title: "월급", amount: 3_000_000, kind: "income", category: "월급" })],
      "2026-06"
    );
    expect(occ).toHaveLength(0);
  });

  it("kind=income + category 공란이면 '월급' 기본값", () => {
    const occ = gen(
      [rec({ id: "r1", title: "부수입", amount: 100_000, kind: "income", category: "", toAccountId: "A1" })],
      "2026-06"
    );
    expect(occ[0].entry.subCategory).toBe("월급");
  });

  it("kind 미지정(기존 데이터)은 여전히 toAccountId 유무로 transfer/expense 판정(레거시 동작 유지)", () => {
    const occTransfer = gen([rec({ id: "r1", title: "적금", amount: 1, toAccountId: "S1" })], "2026-06");
    expect(occTransfer[0].entry.kind).toBe("transfer");
    const occExpense = gen([rec({ id: "r2", title: "월세", amount: 1 })], "2026-06");
    expect(occExpense[0].entry.kind).toBe("expense");
  });
});

describe("generateOccurrencesForMonthFromRecurring — monthly", () => {
  it("시작 일자가 그 달에 발생, 말일 클램프(31일 시작 → 4월 30일, 2월 28일)", () => {
    const r = rec({ id: "r1", title: "월세", amount: 500_000, startDate: "2026-01-31" });
    expect(gen([r], "2026-04").map((o) => o.entry.date)).toEqual(["2026-04-30"]);
    expect(gen([r], "2026-02").map((o) => o.entry.date)).toEqual(["2026-02-28"]);
    expect(gen([r], "2026-03").map((o) => o.entry.date)).toEqual(["2026-03-31"]);
  });
  it("윤년 2월은 29일로 클램프", () => {
    const r = rec({ id: "r1", title: "월세", amount: 1, startDate: "2027-01-30" });
    expect(gen([r], "2028-02").map((o) => o.entry.date)).toEqual(["2028-02-29"]);
  });
  it("시작일 이전 달·시작 월의 시작일 이전은 생성하지 않음", () => {
    const r = rec({ id: "r1", title: "a", amount: 1, startDate: "2026-06-15" });
    expect(gen([r], "2026-05")).toHaveLength(0);
    expect(gen([r], "2026-06")).toHaveLength(1); // 시작일 당일은 포함
  });
  it("종료일 경계: 종료일 당일 포함, 다음 달 제외, 종료일이 발생일보다 앞서면 그 달 제외", () => {
    const r = rec({ id: "r1", title: "a", amount: 1, startDate: "2026-01-15", endDate: "2026-06-15" });
    expect(gen([r], "2026-06")).toHaveLength(1);
    expect(gen([r], "2026-07")).toHaveLength(0);
    const r2 = rec({ id: "r2", title: "a", amount: 1, startDate: "2026-01-15", endDate: "2026-06-14" });
    expect(gen([r2], "2026-06")).toHaveLength(0);
    expect(gen([r2], "2026-05")).toHaveLength(1);
  });
});

describe("generateOccurrencesForMonthFromRecurring — yearly", () => {
  it("시작 월과 같은 달에만, 시작 연도 이후", () => {
    const r = rec({ id: "r1", title: "보험", amount: 100_000, frequency: "yearly", startDate: "2025-03-10" });
    expect(gen([r], "2026-03").map((o) => o.entry.date)).toEqual(["2026-03-10"]);
    expect(gen([r], "2026-04")).toHaveLength(0);
    expect(gen([r], "2025-03")).toHaveLength(1);
    expect(gen([r], "2024-03")).toHaveLength(0);
  });
  it("2/29 시작 → 평년 2/28로 클램프(3/1로 밀리지 않음)", () => {
    const r = rec({ id: "r1", title: "a", amount: 1, frequency: "yearly", startDate: "2024-02-29" });
    expect(gen([r], "2025-02").map((o) => o.entry.date)).toEqual(["2025-02-28"]);
    expect(gen([r], "2025-03")).toHaveLength(0);
    expect(gen([r], "2028-02").map((o) => o.entry.date)).toEqual(["2028-02-29"]);
  });
  it("종료일 지나면 생성 안 함", () => {
    const r = rec({ id: "r1", title: "a", amount: 1, frequency: "yearly", startDate: "2024-03-10", endDate: "2025-12-31" });
    expect(gen([r], "2026-03")).toHaveLength(0);
  });
});

describe("generateOccurrencesForMonthFromRecurring — weekly", () => {
  it("시작일부터 7일 간격, 월 범위 내 모든 발생", () => {
    const r = rec({ id: "r1", title: "헬스", amount: 10_000, frequency: "weekly", startDate: "2026-05-20" }); // 수요일
    expect(gen([r], "2026-06").map((o) => o.entry.date)).toEqual(["2026-06-03", "2026-06-10", "2026-06-17", "2026-06-24"]);
    expect(gen([r], "2026-05").map((o) => o.entry.date)).toEqual(["2026-05-20", "2026-05-27"]);
  });
  it("월 중 종료일이면 그 뒤 주는 제외", () => {
    const r = rec({ id: "r1", title: "헬스", amount: 1, frequency: "weekly", startDate: "2026-05-20", endDate: "2026-06-10" });
    expect(gen([r], "2026-06").map((o) => o.entry.date)).toEqual(["2026-06-03", "2026-06-10"]);
  });
  it("시작 월 이전엔 없음, 5주 있는 달은 5건", () => {
    const r = rec({ id: "r1", title: "a", amount: 1, frequency: "weekly", startDate: "2026-07-01" }); // 수요일
    expect(gen([r], "2026-06")).toHaveLength(0);
    expect(gen([r], "2026-07")).toHaveLength(5); // 7/1,8,15,22,29
  });
  it("모든 occurrence의 frequency는 weekly", () => {
    const r = rec({ id: "r1", title: "a", amount: 1, frequency: "weekly", startDate: "2026-06-01" });
    expect(gen([r], "2026-06").every((o) => o.frequency === "weekly")).toBe(true);
  });
});

describe("filterDuplicateOccurrences — dedup 규칙", () => {
  const netflix = rec({ id: "r1", title: "넷플릭스", amount: 17_000, startDate: "2026-01-15" });

  it("monthly: 같은 달에 소분류 일치 + 금액 ±100원 미만이면 날짜 달라도 중복", () => {
    const occ = gen([netflix], "2026-06");
    const ledger = [entry({ id: "L1", date: "2026-06-03", amount: 17_050, subCategory: "구독비", detailCategory: "넷플릭스" })];
    expect(filterDuplicateOccurrences(occ, ledger, "2026-06")).toHaveLength(0);
  });
  it("monthly: 금액 차 100원 이상이면 중복 아님", () => {
    const occ = gen([netflix], "2026-06");
    const ledger = [entry({ id: "L1", date: "2026-06-15", amount: 17_100, subCategory: "구독비", detailCategory: "넷플릭스" })];
    expect(filterDuplicateOccurrences(occ, ledger, "2026-06")).toHaveLength(1);
  });
  it("monthly: 설명에 title 포함이면 중복(소분류 없어도)", () => {
    const occ = gen([netflix], "2026-06");
    const ledger = [entry({ id: "L1", date: "2026-06-20", amount: 17_000, description: "[반복] 넷플릭스", subCategory: "기타" })];
    expect(filterDuplicateOccurrences(occ, ledger, "2026-06")).toHaveLength(0);
  });
  it("monthly: 소분류 공란 수동 입력은 중분류+금액만으로 중복 인정", () => {
    const occ = gen([netflix], "2026-06");
    const ledger = [entry({ id: "L1", date: "2026-06-01", amount: 17_000, subCategory: "구독비" })];
    expect(filterDuplicateOccurrences(occ, ledger, "2026-06")).toHaveLength(0);
  });
  it("monthly: 중분류 같고 소분류가 다른 항목(다른 구독)은 중복 아님", () => {
    const occ = gen([netflix], "2026-06");
    const ledger = [entry({ id: "L1", date: "2026-06-01", amount: 17_000, subCategory: "구독비", detailCategory: "왓챠" })];
    expect(filterDuplicateOccurrences(occ, ledger, "2026-06")).toHaveLength(1);
  });
  it("다른 달 항목은 무시", () => {
    const occ = gen([netflix], "2026-06");
    const ledger = [entry({ id: "L1", date: "2026-05-15", amount: 17_000, subCategory: "구독비", detailCategory: "넷플릭스" })];
    expect(filterDuplicateOccurrences(occ, ledger, "2026-06")).toHaveLength(1);
  });
  it("yearly: monthly와 같은 규칙(같은 달 + 분류 + ±100원)", () => {
    const r = rec({ id: "r1", title: "보험", amount: 100_000, frequency: "yearly", startDate: "2025-03-10", category: "보험료" });
    const occ = gen([r], "2026-03");
    const ledger = [entry({ id: "L1", date: "2026-03-02", amount: 100_000, subCategory: "보험료", detailCategory: "보험" })];
    expect(filterDuplicateOccurrences(occ, ledger, "2026-03")).toHaveLength(0);
  });
  it("weekly: 날짜까지 같아야 중복 — 같은 달 다른 주는 남는다", () => {
    const r = rec({ id: "r1", title: "헬스", amount: 10_000, frequency: "weekly", startDate: "2026-05-20", category: "운동" });
    const occ = gen([r], "2026-06"); // 6/3, 6/10, 6/17, 6/24
    const ledger = [entry({ id: "L1", date: "2026-06-10", amount: 10_000, subCategory: "운동", detailCategory: "헬스" })];
    const result = filterDuplicateOccurrences(occ, ledger, "2026-06");
    expect(result.map((e) => e.date)).toEqual(["2026-06-03", "2026-06-17", "2026-06-24"]);
  });
  it("여러 항목 중 중복만 제외하고 순서 유지", () => {
    const r2 = rec({ id: "r2", title: "왓챠", amount: 7_900 });
    const occ = gen([netflix, r2], "2026-06");
    const ledger = [entry({ id: "L1", date: "2026-06-15", amount: 17_000, subCategory: "구독비", detailCategory: "넷플릭스" })];
    const result = filterDuplicateOccurrences(occ, ledger, "2026-06");
    expect(result.map((e) => e.description)).toEqual(["왓챠"]);
  });
  it("amount가 문자열로 저장된 레거시 항목도 Number 비교", () => {
    const occ = gen([netflix], "2026-06");
    const ledger = [entry({ id: "L1", date: "2026-06-15", amount: "17000" as unknown as number, subCategory: "구독비", detailCategory: "넷플릭스" })];
    expect(filterDuplicateOccurrences(occ, ledger, "2026-06")).toHaveLength(0);
  });
});
