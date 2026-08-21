/**
 * FIRE 투영(projectFire·requiredMonthlySavingForYear·buildFireScenarios) 테스트 —
 * 복리 경로·인플레 0·분모 0(SWR)·크로스오버 없음/즉시·시나리오 단조성·필요 월 저축 역산·기본값 채움.
 */
import { describe, expect, it } from "vitest";
import {
  projectFire,
  requiredMonthlySavingForYear,
  buildFireScenarios,
  DEFAULT_HORIZON_YEARS,
  DEFAULT_INFLATION_PCT,
  DEFAULT_WITHDRAWAL_RATE_PCT,
} from "../utils/fireProjection";

const MAN = 10_000;

describe("projectFire — 순자산 경로(복리)", () => {
  it("수익률 0이면 선형 누적, 10%면 연말 적립 복리 NW[y+1] = NW[y]·1.1 + 12s", () => {
    const baseline = { netWorthKRW: 0, annualRealExpense: 2_400 * MAN };
    const flat = projectFire({ baseline, assumptions: { returnPct: 0, monthlySaving: 100 * MAN, horizonYears: 5 } });
    expect(flat.years).toEqual([0, 1, 2, 3, 4, 5]);
    expect(flat.netWorth).toEqual([0, 1200, 2400, 3600, 4800, 6000].map((v) => v * MAN));

    const comp = projectFire({ baseline, assumptions: { returnPct: 10, monthlySaving: 100 * MAN, horizonYears: 3 } });
    expect(comp.netWorth[1]).toBeCloseTo(1200 * MAN, 6);
    expect(comp.netWorth[2]).toBeCloseTo(1200 * MAN * 1.1 + 1200 * MAN, 6);
    expect(comp.netWorth[3]).toBeCloseTo((1200 * MAN * 1.1 + 1200 * MAN) * 1.1 + 1200 * MAN, 6);
  });

  it("기본값: 인플레 2.5·인출률 4·40년·은퇴 지출 = baseline.annualRealExpense", () => {
    const p = projectFire({ baseline: { netWorthKRW: 1_000 * MAN, annualRealExpense: 3_000 * MAN }, assumptions: { returnPct: 5, monthlySaving: 0 } });
    expect(p.assumptions.inflationPct).toBe(DEFAULT_INFLATION_PCT);
    expect(p.assumptions.withdrawalRatePct).toBe(DEFAULT_WITHDRAWAL_RATE_PCT);
    expect(p.assumptions.horizonYears).toBe(DEFAULT_HORIZON_YEARS);
    expect(p.assumptions.retireSpendingAnnual).toBe(3_000 * MAN);
    expect(p.years).toHaveLength(DEFAULT_HORIZON_YEARS + 1);
    expect(p.fireNumberToday).toBeCloseTo((3_000 * MAN) / 0.04, 6);
    expect(p.fireNumberByYear[1]).toBeCloseTo(((3_000 * MAN) / 0.04) * 1.025, 6);
  });
});

describe("projectFire — FIRE 숫자·인플레·분모 0", () => {
  it("인플레 0이면 FIRE 숫자가 수평선이다", () => {
    const p = projectFire({ baseline: { netWorthKRW: 0, annualRealExpense: 2_400 * MAN }, assumptions: { returnPct: 5, monthlySaving: 100 * MAN, inflationPct: 0, horizonYears: 10 } });
    const fn = (2_400 * MAN) / 0.04;
    expect(p.fireNumberToday).toBeCloseTo(fn, 6);
    for (const v of p.fireNumberByYear) expect(v).toBeCloseTo(fn, 6);
  });

  it("인플레 양수면 FIRE 숫자가 매년 (1+π)배로 오른다", () => {
    const p = projectFire({ baseline: { netWorthKRW: 0, annualRealExpense: 1_200 * MAN }, assumptions: { returnPct: 5, monthlySaving: 0, inflationPct: 3, horizonYears: 3 } });
    expect(p.fireNumberByYear[3]).toBeCloseTo(p.fireNumberByYear[0] * Math.pow(1.03, 3), 6);
  });

  it("인출률 0(분모 0)이면 FIRE 숫자·크로스오버·달성률·필요 저축이 모두 null", () => {
    const params = { baseline: { netWorthKRW: 5_000 * MAN, annualRealExpense: 2_400 * MAN }, assumptions: { returnPct: 5, monthlySaving: 100 * MAN, withdrawalRatePct: 0, horizonYears: 10 } };
    const p = projectFire(params);
    expect(p.fireNumberToday).toBeNull();
    expect(p.fireNumberByYear).toEqual([]);
    expect(p.crossoverYear).toBeNull();
    expect(p.progressRatio).toBeNull();
    expect(p.netWorth).toHaveLength(11);
    expect(requiredMonthlySavingForYear(params, 10)).toBeNull();
  });

  it("은퇴 지출 0이면 FIRE 숫자 0 → 즉시 달성(크로스오버 0), 달성률은 분모 0이라 null", () => {
    const p = projectFire({ baseline: { netWorthKRW: 100, annualRealExpense: 0 }, assumptions: { returnPct: 5, monthlySaving: 0, horizonYears: 2 } });
    expect(p.fireNumberToday).toBe(0);
    expect(p.crossoverYear).toBe(0);
    expect(p.progressRatio).toBeNull();
  });
});

describe("projectFire — 크로스오버", () => {
  it("저축 0·수익률 0·순자산 부족이면 크로스오버 없음(null)", () => {
    const p = projectFire({ baseline: { netWorthKRW: 1_000 * MAN, annualRealExpense: 2_400 * MAN }, assumptions: { returnPct: 0, monthlySaving: 0, horizonYears: 40 } });
    expect(p.crossoverYear).toBeNull();
    expect(p.progressRatio).toBeCloseTo((1_000 * MAN) / ((2_400 * MAN) / 0.04), 9);
  });

  it("이미 FIRE 숫자 이상이면 크로스오버 0", () => {
    const p = projectFire({ baseline: { netWorthKRW: 100_000 * MAN, annualRealExpense: 2_400 * MAN }, assumptions: { returnPct: 0, monthlySaving: 0, horizonYears: 5 } });
    expect(p.crossoverYear).toBe(0);
    expect(p.progressRatio).toBeGreaterThanOrEqual(1);
  });

  it("크로스오버 해는 NW ≥ FN이 처음 성립하는 해이며 그 직전 해는 미만이다", () => {
    const p = projectFire({ baseline: { netWorthKRW: 0, annualRealExpense: 1_200 * MAN }, assumptions: { returnPct: 5, monthlySaving: 200 * MAN, inflationPct: 0, horizonYears: 40 } });
    // FN = 3억. s=2400만/년·5% → 10년쯤
    const y = p.crossoverYear;
    expect(y).not.toBeNull();
    expect(p.netWorth[y!]).toBeGreaterThanOrEqual(p.fireNumberByYear[y!]);
    expect(p.netWorth[y! - 1]).toBeLessThan(p.fireNumberByYear[y! - 1]);
  });

  it("수익률이 높을수록·저축이 많을수록 크로스오버가 빠르거나 같다", () => {
    const baseline = { netWorthKRW: 1_000 * MAN, annualRealExpense: 2_400 * MAN };
    const slow = projectFire({ baseline, assumptions: { returnPct: 3, monthlySaving: 250 * MAN } });
    const fast = projectFire({ baseline, assumptions: { returnPct: 7, monthlySaving: 250 * MAN } });
    const saver = projectFire({ baseline, assumptions: { returnPct: 3, monthlySaving: 400 * MAN } });
    expect(slow.crossoverYear).not.toBeNull();
    expect(fast.crossoverYear!).toBeLessThanOrEqual(slow.crossoverYear!);
    expect(saver.crossoverYear!).toBeLessThanOrEqual(slow.crossoverYear!);
  });
});

describe("requiredMonthlySavingForYear", () => {
  it("역산한 월 저축을 넣으면 T년 후 순자산이 정확히 FIRE 숫자와 같다", () => {
    const baseline = { netWorthKRW: 3_000 * MAN, annualRealExpense: 2_400 * MAN };
    for (const T of [5, 10, 20]) {
      for (const r of [0, 4, 7.5]) {
        const params = { baseline, assumptions: { returnPct: r, monthlySaving: 0 } };
        const s = requiredMonthlySavingForYear(params, T);
        expect(s).not.toBeNull();
        expect(s!).toBeGreaterThan(0);
        const p = projectFire({ baseline, assumptions: { returnPct: r, monthlySaving: s!, horizonYears: T } });
        expect(p.netWorth[T] / p.fireNumberByYear[T]).toBeCloseTo(1, 9);
        expect(p.crossoverYear).toBe(T);
      }
    }
  });

  it("이미 충분하면 0, T ≤ 0 이면 null", () => {
    const baseline = { netWorthKRW: 1_000_000 * MAN, annualRealExpense: 1_200 * MAN };
    const params = { baseline, assumptions: { returnPct: 5, monthlySaving: 0 } };
    expect(requiredMonthlySavingForYear(params, 10)).toBe(0);
    expect(requiredMonthlySavingForYear(params, 0)).toBeNull();
    expect(requiredMonthlySavingForYear(params, -3)).toBeNull();
  });

  it("목표 해가 멀수록 필요 월 저축은 줄어든다(단조 감소)", () => {
    const params = { baseline: { netWorthKRW: 0, annualRealExpense: 2_400 * MAN }, assumptions: { returnPct: 5, monthlySaving: 0 } };
    const s10 = requiredMonthlySavingForYear(params, 10)!;
    const s20 = requiredMonthlySavingForYear(params, 20)!;
    const s30 = requiredMonthlySavingForYear(params, 30)!;
    expect(s10).toBeGreaterThan(s20);
    expect(s20).toBeGreaterThan(s30);
  });
});

describe("buildFireScenarios — 결정론·단조성", () => {
  const params = { baseline: { netWorthKRW: 2_000 * MAN, annualRealExpense: 2_400 * MAN }, assumptions: { returnPct: 5, monthlySaving: 100 * MAN, horizonYears: 30 } };

  it("보수 ≤ 기준 ≤ 낙관이 모든 해에서 성립하고 FIRE 숫자는 공통", () => {
    const s = buildFireScenarios(params);
    expect(s.conservative.assumptions.returnPct).toBe(3);
    expect(s.optimistic.assumptions.returnPct).toBe(7);
    expect(s.conservative.assumptions.monthlySaving).toBeCloseTo(90 * MAN, 6);
    expect(s.optimistic.assumptions.monthlySaving).toBeCloseTo(110 * MAN, 6);
    for (let y = 0; y <= 30; y += 1) {
      expect(s.conservative.netWorth[y]).toBeLessThanOrEqual(s.base.netWorth[y] + 1e-6);
      expect(s.base.netWorth[y]).toBeLessThanOrEqual(s.optimistic.netWorth[y] + 1e-6);
      expect(s.conservative.fireNumberByYear[y]).toBeCloseTo(s.base.fireNumberByYear[y], 6);
      expect(s.optimistic.fireNumberByYear[y]).toBeCloseTo(s.base.fireNumberByYear[y], 6);
    }
    if (s.base.crossoverYear != null) {
      expect(s.optimistic.crossoverYear!).toBeLessThanOrEqual(s.base.crossoverYear);
      expect(s.conservative.crossoverYear == null || s.conservative.crossoverYear >= s.base.crossoverYear).toBe(true);
    }
  });

  it("같은 입력이면 같은 출력(결정론, 난수 없음)", () => {
    const a = buildFireScenarios(params);
    const b = buildFireScenarios(params);
    expect(a).toEqual(b);
  });
});
