import { describe, it, expect } from "vitest";
import { computeEntryOutliers, computePatternStats } from "../utils/insightsPatterns";
import type { LedgerEntry } from "../types";

/** useInsightsData에서 분리한 소비 패턴 2종(단건 이상치·스트릭)의 회귀 테스트. */
function e(o: Partial<LedgerEntry> & { id: string; amount: number }): LedgerEntry {
  return { date: "2026-01-15", kind: "expense", category: "지출", description: "", ...o } as LedgerEntry;
}

describe("computeEntryOutliers", () => {
  it("중분류 내 z-score |z|≥2 단건 이상치", () => {
    const fExp = [
      e({ id: "o1", amount: 10_000, subCategory: "외식", description: "김밥", date: "2026-01-01" }),
      e({ id: "o2", amount: 10_000, subCategory: "외식", description: "김밥", date: "2026-01-02" }),
      e({ id: "o3", amount: 10_000, subCategory: "외식", description: "김밥", date: "2026-01-03" }),
      e({ id: "o4", amount: 10_000, subCategory: "외식", description: "김밥", date: "2026-01-04" }),
      e({ id: "o5", amount: 100_000, subCategory: "외식", description: "한우", date: "2026-01-05" }),
    ];
    const r = computeEntryOutliers(fExp);
    expect(r).toHaveLength(1);
    expect(r[0].amount).toBe(100_000);
    expect(r[0].sub).toBe("외식");
    expect(r[0].avg).toBe(28_000); // (10*4 + 100)/5 만
    expect(r[0].zScore).toBeCloseTo(2, 5);
    expect(r[0].desc).toBe("한우");
  });

  it("표본 4건 미만 카테고리는 건너뜀", () => {
    const fExp = [
      e({ id: "a", amount: 1_000, subCategory: "카페" }),
      e({ id: "b", amount: 1_000, subCategory: "카페" }),
      e({ id: "c", amount: 99_999, subCategory: "카페" }),
    ];
    expect(computeEntryOutliers(fExp)).toHaveLength(0);
  });

  it("신용결제 카테고리는 제외", () => {
    const fExp = Array.from({ length: 5 }, (_, i) =>
      e({ id: `cc${i}`, amount: i === 4 ? 100_000 : 10_000, category: "신용결제", subCategory: "신용결제" })
    );
    expect(computeEntryOutliers(fExp)).toHaveLength(0);
  });

  it("표준편차 0(전부 동일액)이면 이상치 없음", () => {
    const fExp = Array.from({ length: 5 }, (_, i) => e({ id: `s${i}`, amount: 10_000, subCategory: "교통" }));
    expect(computeEntryOutliers(fExp)).toHaveLength(0);
  });
});

describe("computePatternStats", () => {
  it("스트릭·월별 무지출일·평균 간격 — 오늘(todayIso)로 미래 캡", () => {
    const fExp = [
      e({ id: "d1", amount: 5_000, date: "2026-01-02" }),
      e({ id: "d2", amount: 5_000, date: "2026-01-05" }),
    ];
    const r = computePatternStats({ fExp, months: ["2026-01"], ml: { "2026-01": "1월" }, todayIso: "2026-01-10" });
    // 01-01~01-10 구간(말일 31 → 오늘 10으로 캡): 지출일 02,05
    expect(r.longestSpendStreak).toBe(1);
    expect(r.longestZeroStreak).toBe(5); // 06~10
    expect(r.currentStreakType).toBe("zero"); // 10일은 무지출
    expect(r.currentStreakDays).toBe(5);
    expect(r.zeroDaysPerMonth).toEqual([{ month: "2026-01", label: "1월", zeroDays: 8, totalDays: 10 }]);
    expect(r.avgIntervalDays).toBe(3); // 02→05 = 3일
  });

  it("오늘이 지출일이면 currentStreakType=spend", () => {
    const fExp = [e({ id: "t", amount: 5_000, date: "2026-02-03" })];
    const r = computePatternStats({ fExp, months: ["2026-02"], ml: { "2026-02": "2월" }, todayIso: "2026-02-03" });
    expect(r.currentStreakType).toBe("spend");
    expect(r.currentStreakDays).toBe(1);
  });

  it("months 비면 빈 통계", () => {
    expect(computePatternStats({ fExp: [], months: [], ml: {}, todayIso: "2026-01-10" })).toEqual({
      longestSpendStreak: 0,
      longestZeroStreak: 0,
      currentStreakType: "none",
      currentStreakDays: 0,
      zeroDaysPerMonth: [],
      avgIntervalDays: 0,
    });
  });
});
