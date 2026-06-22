/** A3 — 리스크 지표: 변동성·최대낙폭·샤프·베타 */
import { describe, expect, it } from "vitest";
import type { TwrPoint } from "../utils/twr";
import { computeBeta, computeRiskMetrics, maxDrawdown } from "../utils/riskMetrics";

const p = (date: string, returnIndex: number, dailyReturn: number): TwrPoint => ({
  date,
  returnIndex,
  dailyReturn,
});

describe("maxDrawdown", () => {
  it("고점 대비 최대 하락폭(양수)", () => {
    expect(maxDrawdown([100, 120, 90, 110])).toBeCloseTo(0.25, 6); // 120→90 = -25%
    expect(maxDrawdown([100, 110, 120])).toBe(0); // 단조 상승 → 0
    expect(maxDrawdown([])).toBe(0);
  });
});

describe("computeRiskMetrics", () => {
  it("변동성·관측치·낙폭 계산 (periodsPerYear=1로 연율화 검증 단순화)", () => {
    const twr = [
      p("d0", 100, 0),
      p("d1", 110, 0.1),
      p("d2", 99, -0.1),
      p("d3", 108.9, 0.1),
      p("d4", 98.01, -0.1),
    ];
    const m = computeRiskMetrics(twr, { periodsPerYear: 1 });
    expect(m.observations).toBe(4);
    // 수익률 [0.1,-0.1,0.1,-0.1] mean 0, 표본분산 = 0.04/3 → sd ≈ 0.11547, ppy=1
    expect(m.volatilityPct).toBeCloseTo(0.11547, 4);
    // 지수 [100,110,99,108.9,98.01] 고점 110 → 최저 98.01 → (110-98.01)/110
    expect(m.maxDrawdownPct).toBeCloseTo(0.10899, 4);
    expect(m.sharpe).not.toBeNull();
    expect(m.sharpe!).toBeLessThan(0); // 총수익 음수
  });

  it("변동성 0이면 샤프는 null", () => {
    const twr = [p("d0", 100, 0), p("d1", 100, 0), p("d2", 100, 0)];
    const m = computeRiskMetrics(twr);
    expect(m.volatilityPct).toBe(0);
    expect(m.sharpe).toBeNull();
  });

  it("관측치 없으면 0/null", () => {
    expect(computeRiskMetrics([])).toMatchObject({ volatilityPct: 0, sharpe: null, observations: 0 });
  });
});

describe("computeBeta", () => {
  it("포트가 시장과 동일하면 베타 1", () => {
    const r = [0.01, -0.02, 0.03, -0.01];
    expect(computeBeta(r, r)).toBeCloseTo(1, 6);
  });

  it("포트가 시장의 2배로 움직이면 베타 2", () => {
    const b = [0.01, -0.02, 0.03, -0.01];
    const port = b.map((x) => x * 2);
    expect(computeBeta(port, b)).toBeCloseTo(2, 6);
  });

  it("시장 변동이 없으면(분산 0) null", () => {
    expect(computeBeta([0.01, 0.02], [0.0, 0.0])).toBeNull();
    expect(computeBeta([0.01], [0.01])).toBeNull(); // 관측치 < 2
  });
});
