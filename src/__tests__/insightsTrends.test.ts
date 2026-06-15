import { describe, it, expect } from "vitest";
import { computeIncomeGrowth, computeSpendingInertia, computeCategoryGrowth } from "../utils/insightsTrends";
import type { LedgerEntry } from "../types";

/**
 * useInsightsData에서 분리한 추세 3종(수입성장률·지출관성·카테고리성장률)의 회귀 테스트.
 * 핵심: 진행 중인 이번 달이 대상이면 전월·전년도 "같은 기간(1~오늘 일)"만 비교 — 월중 왜곡 방지.
 */
function e(o: Partial<LedgerEntry> & { id: string; amount: number }): LedgerEntry {
  return { date: "2026-01-15", kind: "expense", category: "기타", description: "", ...o } as LedgerEntry;
}

describe("computeIncomeGrowth", () => {
  it("완결 월 — full-month MoM 시계열·avg3MoM·targetInc/prevInc", () => {
    const months = ["2026-01", "2026-02", "2026-03"];
    const ml = { "2026-01": "1월", "2026-02": "2월", "2026-03": "3월" };
    const salaryMonthly = { "2026-01": 1_000_000, "2026-02": 1_200_000, "2026-03": 1_500_000 };
    const r = computeIncomeGrowth({
      ledger: [], months, ml, salaryMonthly, salaryKeys: new Set(["급여"]),
      curMonthStr: "2026-09", anomalyTargetMonth: "2026-03", todayDayNum: 9,
    });
    expect(r.series.map((s) => s.momPct)).toEqual([null, 20, 25]);
    expect(r.mom).toBe(25);
    expect(r.avg3MoM).toBe(22.5);
    expect(r.yoy).toBeNull();
    expect(r.partialDay).toBeNull();
    expect(r.targetInc).toBe(1_500_000);
    expect(r.prevInc).toBe(1_200_000);
  });

  it("진행 중인 달 — 전월·전년 같은 기간(1~오늘 일)만 비교 (full-month 아님)", () => {
    const months = ["2026-05", "2026-06"];
    const ml = { "2026-05": "5월", "2026-06": "6월" };
    // full-month: 05=1.5M, 06=1.2M (full로 비교하면 -20%)
    const salaryMonthly = { "2026-05": 1_500_000, "2026-06": 1_200_000 };
    const ledger = [
      e({ id: "s1", amount: 1_000_000, kind: "income", category: "수입", subCategory: "급여", date: "2026-05-10" }),
      e({ id: "s2", amount: 500_000, kind: "income", category: "수입", subCategory: "급여", date: "2026-05-20" }), // 15일 이후 → 제외
      e({ id: "s3", amount: 1_200_000, kind: "income", category: "수입", subCategory: "급여", date: "2026-06-10" }),
      e({ id: "y1", amount: 1_000_000, kind: "income", category: "수입", subCategory: "급여", date: "2025-06-05" }), // YoY 동기
    ];
    const r = computeIncomeGrowth({
      ledger, months, ml, salaryMonthly, salaryKeys: new Set(["급여"]),
      curMonthStr: "2026-06", anomalyTargetMonth: "2026-06", todayDayNum: 15,
    });
    expect(r.partialDay).toBe(15);
    // 1~15일: 06=1.2M, 05=1.0M(05-20 제외) → +20% (full-month -20% 아님)
    expect(r.targetInc).toBe(1_200_000);
    expect(r.prevInc).toBe(1_000_000);
    expect(r.mom).toBe(20);
    // YoY: 2025-06 동기(1~15) = 1.0M → +20%
    expect(r.yoy).toBe(20);
    // 진행 중인 달·첫 달 → 시계열 momPct는 둘 다 null → avg3MoM null
    expect(r.series.map((s) => s.momPct)).toEqual([null, null]);
    expect(r.avg3MoM).toBeNull();
  });

  it("이월/원래보유 수입은 incomeUpTo에서 제외", () => {
    const months = ["2026-05", "2026-06"];
    const ml = { "2026-05": "5월", "2026-06": "6월" };
    const salaryMonthly = { "2026-05": 1_000_000, "2026-06": 1_000_000 };
    const ledger = [
      e({ id: "s1", amount: 1_000_000, kind: "income", category: "수입", subCategory: "급여", date: "2026-05-10" }),
      e({ id: "s2", amount: 1_000_000, kind: "income", category: "수입", subCategory: "급여", date: "2026-06-10" }),
      e({ id: "co", amount: 9_000_000, kind: "income", category: "이월", subCategory: "급여", date: "2026-06-09" }), // 이월 → 제외
    ];
    const r = computeIncomeGrowth({
      ledger, months, ml, salaryMonthly, salaryKeys: new Set(["급여"]),
      curMonthStr: "2026-06", anomalyTargetMonth: "2026-06", todayDayNum: 15,
    });
    // 이월 9M이 끼어도 06 동기 = 1.0M → MoM 0%
    expect(r.targetInc).toBe(1_000_000);
    expect(r.mom).toBe(0);
  });
});

describe("computeSpendingInertia", () => {
  it("완결 월 — 최근 3개월 full-month 평균 대비 편차", () => {
    const months = ["2026-01", "2026-02", "2026-03", "2026-04"];
    const monthly = {
      "2026-01": { income: 0, expense: 1_000_000, investment: 0 },
      "2026-02": { income: 0, expense: 1_200_000, investment: 0 },
      "2026-03": { income: 0, expense: 800_000, investment: 0 },
      "2026-04": { income: 0, expense: 2_000_000, investment: 0 },
    };
    const r = computeSpendingInertia({
      ledger: [], months, monthly, curMonthStr: "2026-09", anomalyTargetMonth: "2026-04", todayDayNum: 10,
    });
    expect(r).not.toBeNull();
    expect(r!.curExp).toBe(2_000_000);
    expect(r!.avg).toBe(1_000_000); // (1.0+1.2+0.8)/3
    expect(r!.deviation).toBe(100);
    expect(r!.lookbackMonths).toBe(3);
    expect(r!.partialDay).toBeNull();
  });

  it("진행 중인 달 — 과거 3개월도 같은 기간(1~오늘 일)만 합산", () => {
    const months = ["2026-05", "2026-06"];
    const monthly = {
      "2026-05": { income: 0, expense: 3_000_000, investment: 0 }, // full
      "2026-06": { income: 0, expense: 1_000_000, investment: 0 },
    };
    const ledger = [
      e({ id: "x1", amount: 1_000_000, kind: "expense", category: "식비", subCategory: "외식", date: "2026-05-05" }),
      e({ id: "x2", amount: 2_000_000, kind: "expense", category: "식비", subCategory: "외식", date: "2026-05-25" }), // 15일 이후 → 제외
    ];
    const r = computeSpendingInertia({
      ledger, months, monthly, curMonthStr: "2026-06", anomalyTargetMonth: "2026-06", todayDayNum: 15,
    });
    // 05도 1~15일만 → 1.0M (full 3.0M 아님), 06=1.0M → deviation 0
    expect(r!.avg).toBe(1_000_000);
    expect(r!.curExp).toBe(1_000_000);
    expect(r!.deviation).toBe(0);
    expect(r!.partialDay).toBe(15);
  });

  it("lookback 없으면(첫 달이 대상) null", () => {
    const r = computeSpendingInertia({
      ledger: [], months: ["2026-01"], monthly: { "2026-01": { income: 0, expense: 5, investment: 0 } },
      curMonthStr: "2026-09", anomalyTargetMonth: "2026-01", todayDayNum: 10,
    });
    expect(r).toBeNull();
  });
});

describe("computeCategoryGrowth", () => {
  const mk = (id: string, sub: string, amount: number, date: string) =>
    e({ id, amount, kind: "expense", category: "지출", subCategory: sub, date });

  it("완결 월 — 신규(Infinity·isNew)·급증·급감 분류", () => {
    const months = ["2026-01", "2026-02", "2026-03", "2026-04"];
    const ledger = [
      mk("a1", "외식", 100_000, "2026-01-10"),
      mk("a2", "외식", 100_000, "2026-02-10"),
      mk("a3", "외식", 100_000, "2026-03-10"),
      mk("a4", "외식", 300_000, "2026-04-10"), // +200%
      mk("c4", "카페", 60_000, "2026-04-12"),  // 신규 (avg3=0)
      mk("t1", "교통", 200_000, "2026-01-11"),
      mk("t2", "교통", 200_000, "2026-02-11"),
      mk("t3", "교통", 200_000, "2026-03-11"),
      mk("t4", "교통", 50_000, "2026-04-11"),   // -75%
    ];
    const r = computeCategoryGrowth({ ledger, months, curMonthStr: "2026-09", anomalyTargetMonth: "2026-04", todayDayNum: 30 });
    expect(r.partialDay).toBeNull();
    // up: 카페(Infinity, isNew) 먼저
    expect(r.up[0].sub).toBe("카페");
    expect(r.up[0].isNew).toBe(true);
    expect(r.up[0].pctChange).toBe(Number.POSITIVE_INFINITY);
    const sik = r.up.find((x) => x.sub === "외식")!;
    expect(sik.pctChange).toBe(200);
    expect(sik.cur).toBe(300_000);
    expect(sik.avg3).toBe(100_000);
    // down: avg3>50000만 → 교통(-75%) 먼저, 카페(avg3=0)는 제외
    expect(r.down[0].sub).toBe("교통");
    expect(r.down[0].pctChange).toBe(-75);
    expect(r.down.some((x) => x.sub === "카페")).toBe(false);
  });

  it("진행 중인 달 — 같은 기간(1~오늘 일) 이후 지출은 제외", () => {
    const months = ["2026-05", "2026-06"];
    const ledger = [
      mk("p1", "외식", 100_000, "2026-05-10"),
      mk("p2", "외식", 80_000, "2026-06-10"),
      mk("p3", "외식", 1_000_000, "2026-06-25"), // 15일 이후 → 제외
    ];
    const r = computeCategoryGrowth({ ledger, months, curMonthStr: "2026-06", anomalyTargetMonth: "2026-06", todayDayNum: 15 });
    expect(r.partialDay).toBe(15);
    const sik = [...r.up, ...r.down].find((x) => x.sub === "외식")!;
    // 06-25 1M 제외 → cur=80k, avg3(05)=100k → -20%
    expect(sik.cur).toBe(80_000);
    expect(sik.avg3).toBe(100_000);
    expect(sik.pctChange).toBe(-20);
  });

  it("anomalyTargetMonth 없으면 빈 결과", () => {
    const r = computeCategoryGrowth({ ledger: [], months: ["2026-01"], curMonthStr: "2026-09", anomalyTargetMonth: null, todayDayNum: 10 });
    expect(r).toEqual({ up: [], down: [], partialDay: null });
  });
});
