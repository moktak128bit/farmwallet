import { describe, it, expect } from "vitest";
import { computeBudgetPace } from "../utils/budgetPace";
import { computeBudgetGoalSpent } from "../utils/budgetUsage";
import { BUDGET_ALL_CATEGORY } from "../types";
import type { BudgetGoal, LedgerEntry } from "../types";

const goal = (o: Partial<BudgetGoal> & { category: string }): BudgetGoal => ({
  id: "b1",
  monthlyLimit: 300_000,
  ...o,
});

const e = (o: Partial<LedgerEntry> & { id: string; date: string }): LedgerEntry =>
  ({ kind: "expense", category: "지출", subCategory: "식비", description: "", amount: 10_000, ...o } as LedgerEntry);

const FOOD = goal({ category: "식비" });

describe("computeBudgetGoalSpent — dayCap 옵션", () => {
  it("dayCap 지정 시 1~dayCap일만 합산, 미지정(기본)은 달 전체", () => {
    const ledger = [
      e({ id: "1", date: "2026-07-05", amount: 10_000 }),
      e({ id: "2", date: "2026-07-10", amount: 20_000 }),
      e({ id: "3", date: "2026-07-11", amount: 40_000 }),
    ];
    expect(computeBudgetGoalSpent(FOOD, ledger, "2026-07")).toBe(70_000);
    expect(computeBudgetGoalSpent(FOOD, ledger, "2026-07", { dayCap: 10 })).toBe(30_000);
    expect(computeBudgetGoalSpent(FOOD, ledger, "2026-07", { dayCap: null })).toBe(70_000);
  });
});

describe("computeBudgetPace — 경과일·남은 일수·선형 예상(이력 없음)", () => {
  it("8월 10일, 10일간 100,000원 → 선형 월말 310,000원(한도 +3%), 남은 21일 하루 허용액", () => {
    const ledger = [e({ id: "1", date: "2026-08-03", amount: 60_000 }), e({ id: "2", date: "2026-08-09", amount: 40_000 })];
    const p = computeBudgetPace(FOOD, ledger, "2026-08", "2026-08-10");
    expect(p.spent).toBe(100_000);
    expect(p.elapsedDays).toBe(10);
    expect(p.totalDays).toBe(31);
    expect(p.remainingDays).toBe(21);
    expect(p.projectedMonthEnd).toBeCloseTo(310_000, 5);
    expect(p.projectedVsLimitPct).toBeCloseTo((10_000 / 300_000) * 100, 5);
    expect(p.dailyAllowanceRemaining).toBeCloseTo(200_000 / 21, 5);
    expect(p.status).toBe("over-pace");
    expect(p.message).toContain("월말 310,000원");
    expect(p.message).toContain("한도 +3%");
    expect(p.message).toContain("남은 21일 하루 9,524원");
  });

  it("월초(1일) 경계 — 경과일 1, 남은 30일, 전월 동기(1~1일)", () => {
    const ledger = [e({ id: "1", date: "2026-08-01", amount: 5_000 }), e({ id: "p", date: "2026-07-01", amount: 7_000 })];
    const p = computeBudgetPace(FOOD, ledger, "2026-08", "2026-08-01");
    expect(p.elapsedDays).toBe(1);
    expect(p.remainingDays).toBe(30);
    expect(p.prevSamePeriodSpent).toBe(7_000);
    expect(p.prevSamePeriodLabel).toBe("동기(1~1일)");
    expect(p.dailyAllowanceRemaining).toBeCloseTo(295_000 / 30, 5);
  });

  it("월말(마지막 날) 경계 — 남은 0일, 허용액 분모 1(오늘), 예상 = 실적", () => {
    const ledger = [e({ id: "1", date: "2026-08-15", amount: 200_000 })];
    const p = computeBudgetPace(FOOD, ledger, "2026-08", "2026-08-31");
    expect(p.elapsedDays).toBe(31);
    expect(p.remainingDays).toBe(0);
    expect(p.projectedMonthEnd).toBe(200_000);
    expect(p.dailyAllowanceRemaining).toBe(100_000);
    expect(p.status).toBe("ok");
    expect(p.message).toContain("오늘 100,000원 남음");
  });

  it("2월(28일) 총일수·윤년 2월(29일)", () => {
    expect(computeBudgetPace(FOOD, [], "2026-02", "2026-02-14").totalDays).toBe(28);
    expect(computeBudgetPace(FOOD, [], "2028-02", "2028-02-14").totalDays).toBe(29);
  });

  it("지난 달을 보면 경과=총일수, 예상=실적, 전월 비교는 '전월 전체'(dayCap 없음)", () => {
    const ledger = [
      e({ id: "1", date: "2026-06-15", amount: 100_000 }),
      e({ id: "2", date: "2026-05-31", amount: 30_000 }), // 5월 31일 — dayCap 30이었다면 빠졌을 항목
      e({ id: "3", date: "2026-05-02", amount: 20_000 }),
    ];
    const p = computeBudgetPace(FOOD, ledger, "2026-06", "2026-08-20");
    expect(p.elapsedDays).toBe(30);
    expect(p.remainingDays).toBe(0);
    expect(p.projectedMonthEnd).toBe(100_000);
    expect(p.prevSamePeriodSpent).toBe(50_000);
    expect(p.prevSamePeriodLabel).toBe("전월 전체");
    expect(p.message).toContain("마감");
  });

  it("아직 안 온 달 — 경과일 0, 전월 동기 0, 예상은 최근 3개월 평균(이력 가중 1.0)", () => {
    const ledger = [e({ id: "1", date: "2026-07-10", amount: 90_000 }), e({ id: "2", date: "2026-06-10", amount: 30_000 })];
    const p = computeBudgetPace(FOOD, ledger, "2026-09", "2026-08-20");
    expect(p.elapsedDays).toBe(0);
    expect(p.remainingDays).toBe(30);
    expect(p.prevSamePeriodSpent).toBe(0);
    expect(p.projectedMonthEnd).toBeCloseTo(60_000, 5); // (90k + 30k)/2
    expect(p.dailyAllowanceRemaining).toBeCloseTo(300_000 / 30, 5);
  });
});

describe("computeBudgetPace — 이력 혼합(고정비성 1회 결제 과대추정 완화)", () => {
  it("1일 월세형 결제: 선형만이면 30배, 이력 혼합으로 누른다", () => {
    // 최근 3개월 매달 1일 100,000원 단발 지출, 이후 없음. 8월 2일 기준.
    const ledger = [
      e({ id: "a", date: "2026-08-01", amount: 100_000 }),
      e({ id: "b", date: "2026-07-01", amount: 100_000 }),
      e({ id: "c", date: "2026-06-01", amount: 100_000 }),
      e({ id: "d", date: "2026-05-01", amount: 100_000 }),
    ];
    const p = computeBudgetPace(goal({ category: "식비", monthlyLimit: 150_000 }), ledger, "2026-08", "2026-08-02");
    const linear = (100_000 / 2) * 31; // 1,550,000
    const history = 100_000 + 0; // 이력상 2일 이후 추가 지출 0
    const w = 2 / 31;
    const expected = w * linear + (1 - w) * history;
    expect(p.projectedMonthEnd).toBeCloseTo(expected, 5);
    expect(p.projectedMonthEnd).toBeLessThan(linear / 5);
    expect(p.status).toBe("over-pace"); // 그래도 한도 150k는 넘을 예상 → 조기 경고
  });

  it("이력에 경과일 이후 지출이 있으면 그만큼 더해진다 (월말 공과금)", () => {
    // 7월: 1~10일 50,000 + 25일 100,000. 8월 10일 현재 50,000.
    const ledger = [
      e({ id: "a", date: "2026-08-05", amount: 50_000 }),
      e({ id: "b", date: "2026-07-05", amount: 50_000 }),
      e({ id: "c", date: "2026-07-25", amount: 100_000 }),
    ];
    const p = computeBudgetPace(FOOD, ledger, "2026-08", "2026-08-10");
    const linear = (50_000 / 10) * 31; // 155,000
    const history = 50_000 + 100_000; // 150,000
    const w = 10 / 31;
    expect(p.projectedMonthEnd).toBeCloseTo(w * linear + (1 - w) * history, 5);
  });

  it("최근 3개월 밖(4개월 전) 이력은 무시하고, 지출 없는 달은 평균 분모에서 제외", () => {
    const ledger = [
      e({ id: "a", date: "2026-08-05", amount: 50_000 }),
      e({ id: "old", date: "2026-04-20", amount: 900_000 }), // 4개월 전 — 제외
      e({ id: "b", date: "2026-07-20", amount: 60_000 }), // 7월만 이력 (6·5월은 0 → 제외)
    ];
    const p = computeBudgetPace(FOOD, ledger, "2026-08", "2026-08-10");
    const linear = (50_000 / 10) * 31;
    const history = 50_000 + 60_000;
    const w = 10 / 31;
    expect(p.projectedMonthEnd).toBeCloseTo(w * linear + (1 - w) * history, 5);
  });
});

describe("computeBudgetPace — 전체 예산·제외 조합·USD·상태", () => {
  it("전체 예산: excludeCategories·excludeAccountIds가 사용액·전월 동기·이력 모두에 동일 적용", () => {
    const ledger = [
      e({ id: "1", date: "2026-08-03", subCategory: "식비", amount: 100_000 }),
      e({ id: "2", date: "2026-08-03", subCategory: "데이트비", amount: 80_000 }), // 제외 대분류
      e({ id: "3", date: "2026-08-04", subCategory: "통신비", fromAccountId: "moim", amount: 60_000 }), // 제외 계좌
      e({ id: "4", date: "2026-07-03", subCategory: "식비", amount: 40_000 }),
      e({ id: "5", date: "2026-07-03", subCategory: "데이트비", amount: 999_000 }),
      e({ id: "6", date: "2026-07-20", subCategory: "식비", amount: 20_000 }),
    ];
    const g = goal({
      category: BUDGET_ALL_CATEGORY,
      monthlyLimit: 500_000,
      excludeCategories: ["데이트비"],
      excludeAccountIds: ["moim"],
    });
    const p = computeBudgetPace(g, ledger, "2026-08", "2026-08-10");
    expect(p.spent).toBe(100_000);
    expect(p.prevSamePeriodSpent).toBe(40_000);
    const linear = (100_000 / 10) * 31;
    const history = 100_000 + 20_000; // 7월 10일 이후 식비 20,000만 (데이트비 제외)
    const w = 10 / 31;
    expect(p.projectedMonthEnd).toBeCloseTo(w * linear + (1 - w) * history, 5);
  });

  it("USD 지출은 환율로 환산해 사용액·예상·허용액을 계산한다", () => {
    const ledger = [
      e({ id: "1", date: "2026-08-05", amount: 100, currency: "USD" } as Partial<LedgerEntry> & { id: string; date: string }),
    ];
    const p = computeBudgetPace(FOOD, ledger, "2026-08", "2026-08-10", { fxRate: 1_300 });
    expect(p.spent).toBe(130_000);
    expect(p.projectedMonthEnd).toBeCloseTo(13_000 * 31, 5);
    expect(p.dailyAllowanceRemaining).toBeCloseTo(170_000 / 21, 5);
  });

  it("상태: exceeded(사용≥한도) > over-pace(예상>한도) > watch(예상≥한도 90%) > ok", () => {
    const lim = goal({ category: "식비", monthlyLimit: 310_000 });
    // 8/10, 31일 → 선형 = spent×3.1
    const mk = (amt: number) =>
      computeBudgetPace(lim, [e({ id: "1", date: "2026-08-02", amount: amt })], "2026-08", "2026-08-10");
    expect(mk(310_000).status).toBe("exceeded");
    expect(mk(101_000).status).toBe("over-pace"); // 313,100
    expect(mk(95_000).status).toBe("watch"); // 294,500 ≥ 279,000
    expect(mk(50_000).status).toBe("ok"); // 155,000
    expect(mk(310_000).message).toContain("한도 0원 초과");
  });

  it("한도 0이면 ok·예상 대비 null·'한도 미설정'", () => {
    const p = computeBudgetPace(
      goal({ category: "식비", monthlyLimit: 0 }),
      [e({ id: "1", date: "2026-08-02" })],
      "2026-08",
      "2026-08-10"
    );
    expect(p.status).toBe("ok");
    expect(p.projectedVsLimitPct).toBeNull();
    expect(p.message).toBe("한도 미설정");
  });

  it("전월 동기 분모 — 전월의 1~N일만 (N일 이후 전월 지출은 제외)", () => {
    const ledger = [
      e({ id: "1", date: "2026-08-10", amount: 10_000 }),
      e({ id: "2", date: "2026-07-10", amount: 30_000 }),
      e({ id: "3", date: "2026-07-11", amount: 500_000 }), // 동기 밖
    ];
    const p = computeBudgetPace(FOOD, ledger, "2026-08", "2026-08-10");
    expect(p.prevSamePeriodSpent).toBe(30_000);
    expect(p.prevSamePeriodLabel).toBe("동기(1~10일)");
  });
});
