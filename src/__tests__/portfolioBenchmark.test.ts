/** A1 — 벤치마크 비교: TWR 지수 vs 시장지수, 공통 기간 정규화 + 초과수익(alpha) */
import { describe, expect, it } from "vitest";
import type { TwrPoint } from "../utils/twr";
import { buildBenchmarkComparison } from "../utils/portfolioBenchmark";

const twr = (date: string, returnIndex: number): TwrPoint => ({ date, returnIndex, dailyReturn: 0 });

describe("buildBenchmarkComparison", () => {
  it("같은 기간 정규화 + 초과수익(포트가 시장을 이긴 경우)", () => {
    // 포트 +20% (100→120), 지수 +10% (1000→1100) → alpha +10%
    const series = buildBenchmarkComparison({
      twr: [twr("2026-01-01", 100), twr("2026-01-02", 110), twr("2026-01-03", 120)],
      benchmarkCloses: [
        { date: "2026-01-01", close: 1000 },
        { date: "2026-01-02", close: 1050 },
        { date: "2026-01-03", close: 1100 },
      ],
      benchmarkLabel: "KOSPI",
    })!;
    expect(series.portfolioReturnPct).toBeCloseTo(0.2, 5);
    expect(series.benchmarkReturnPct).toBeCloseTo(0.1, 5);
    expect(series.excessReturnPct).toBeCloseTo(0.1, 5);
    expect(series.series[0].portfolio).toBeCloseTo(100, 6);
    expect(series.series[0].benchmark).toBeCloseTo(100, 6);
    expect(series.series[2].portfolio).toBeCloseTo(120, 6);
    expect(series.series[2].benchmark).toBeCloseTo(110, 6);
  });

  it("포트가 시장에 진 경우 초과수익은 음수", () => {
    const r = buildBenchmarkComparison({
      twr: [twr("2026-01-01", 100), twr("2026-01-02", 105)],
      benchmarkCloses: [
        { date: "2026-01-01", close: 1000 },
        { date: "2026-01-02", close: 1100 },
      ],
      benchmarkLabel: "S&P500",
    })!;
    expect(r.excessReturnPct).toBeCloseTo(0.05 - 0.1, 5);
  });

  it("지수 데이터가 늦게 시작하면 공통 시작일부터 둘 다 100으로 리베이스", () => {
    // 포트는 01-01부터, 지수는 01-03부터 → 공통 시작 01-03
    const r = buildBenchmarkComparison({
      twr: [twr("2026-01-01", 100), twr("2026-01-02", 110), twr("2026-01-03", 121), twr("2026-01-04", 133.1)],
      benchmarkCloses: [
        { date: "2026-01-03", close: 2000 },
        { date: "2026-01-04", close: 2200 },
      ],
      benchmarkLabel: "KOSPI",
    })!;
    expect(r.startDate).toBe("2026-01-03");
    expect(r.series[0]).toMatchObject({ date: "2026-01-03", portfolio: 100, benchmark: 100 });
    // 포트 01-03→01-04: 121→133.1 = +10%, 지수 2000→2200 = +10% → alpha 0
    expect(r.series[1].portfolio).toBeCloseTo(110, 4);
    expect(r.series[1].benchmark).toBeCloseTo(110, 4);
    expect(r.excessReturnPct).toBeCloseTo(0, 5);
  });

  it("휴장일은 직전 종가로 보정(as-of)", () => {
    const r = buildBenchmarkComparison({
      twr: [twr("2026-01-01", 100), twr("2026-01-02", 110), twr("2026-01-03", 120)],
      benchmarkCloses: [
        { date: "2026-01-01", close: 1000 },
        // 01-02 휴장 → 직전 1000 사용
        { date: "2026-01-03", close: 1200 },
      ],
      benchmarkLabel: "KOSPI",
    })!;
    expect(r.series[1].benchmark).toBeCloseTo(100, 4); // 01-02은 직전 종가 → 100 유지
    expect(r.series[2].benchmark).toBeCloseTo(120, 4);
  });

  it("벤치마크 데이터가 없으면 null", () => {
    expect(
      buildBenchmarkComparison({ twr: [twr("2026-01-01", 100)], benchmarkCloses: [], benchmarkLabel: "X" })
    ).toBeNull();
  });

  it("TWR가 비면 null", () => {
    expect(
      buildBenchmarkComparison({ twr: [], benchmarkCloses: [{ date: "2026-01-01", close: 1 }], benchmarkLabel: "X" })
    ).toBeNull();
  });
});
