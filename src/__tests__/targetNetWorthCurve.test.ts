/**
 * 목표 자산 곡선 → 월별 목표값(만원) 변환(buildTargetNetWorthSeries) 테스트 —
 * 첫 목표일 이전 null·선형 보간·마지막 값 유지·손상 키 무시·원→만원 반올림.
 */
import { describe, expect, it } from "vitest";
import { buildTargetNetWorthSeries } from "../features/dashboard/targetNetWorthCurve";

const MONTHS = ["2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05"];

describe("buildTargetNetWorthSeries", () => {
  it("빈 곡선/undefined → 전부 null (길이 유지)", () => {
    expect(buildTargetNetWorthSeries({}, MONTHS)).toEqual(MONTHS.map(() => null));
    expect(buildTargetNetWorthSeries(undefined, MONTHS)).toEqual(MONTHS.map(() => null));
    expect(buildTargetNetWorthSeries(null, [])).toEqual([]);
  });

  it("단일 목표일: 이전 달 null, 해당 달(말일 기준)부터 마지막 값 유지 · 원→만원", () => {
    const out = buildTargetNetWorthSeries({ "2026-03-15": 50_000_000 }, MONTHS);
    expect(out).toEqual([null, null, null, 5000, 5000, 5000]);
  });

  it("두 목표일 사이는 일 단위 선형 보간, 이후는 마지막 값 유지", () => {
    const out = buildTargetNetWorthSeries(
      { "2026-03-31": 30_000_000, "2026-01-31": 10_000_000 }, // 키 순서 무관
      MONTHS
    );
    // 2월 말(02-28)은 01-31로부터 28일 / 전체 59일 → 10,000,000 + 20,000,000*28/59 = 19,491,525 → 1,949만
    expect(out).toEqual([null, 1000, 1949, 3000, 3000, 3000]);
  });

  it("목표일이 월말 직후면 그 달은 이전 구간값(보간)으로 계산된다", () => {
    // 03-31이 아닌 04-01이 키 → 3월 말은 아직 구간 안 → 보간
    const out = buildTargetNetWorthSeries({ "2026-01-31": 0, "2026-04-01": 60_000_000 }, ["2026-03", "2026-04"]);
    // 01-31 → 03-31: 59일 / 전체 60일 → 59,000,000 → 5,900만
    expect(out).toEqual([5900, 6000]);
  });

  it("잘못된 날짜 키·비유한 값은 무시하고, 유효 항목이 없으면 전부 null", () => {
    expect(
      buildTargetNetWorthSeries({ "2026-02-30": 5_000_000, abc: 1_000_000, "2026-01-31": Number.NaN }, MONTHS)
    ).toEqual(MONTHS.map(() => null));
    // 손상 키와 유효 키 혼재 → 유효 키만 사용
    expect(
      buildTargetNetWorthSeries({ "2026-02-30": 5_000_000, "2026-04-30": 20_000_000 }, MONTHS)
    ).toEqual([null, null, null, null, 2000, 2000]);
  });

  it("만원 미만은 반올림, 형식이 아닌 월 키는 null", () => {
    expect(buildTargetNetWorthSeries({ "2026-01-01": 12_345 }, ["2026-01"])).toEqual([1]);
    expect(buildTargetNetWorthSeries({ "2026-01-01": 15_000 }, ["2026-01"])).toEqual([2]);
    expect(buildTargetNetWorthSeries({ "2026-01-01": 15_000 }, ["1월", ""])).toEqual([null, null]);
  });

  it("음수 목표(순자산 마이너스)도 그대로 보간된다", () => {
    const out = buildTargetNetWorthSeries({ "2026-01-31": -10_000_000, "2026-03-31": 10_000_000 }, ["2026-01", "2026-03"]);
    expect(out).toEqual([-1000, 1000]);
  });
});
