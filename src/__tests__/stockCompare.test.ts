import { describe, expect, it } from "vitest";
import {
  buildCompareRows,
  computeCommonStart,
  downsampleRows,
  latestMultiple,
  type CompareRow,
  type CompareSeries
} from "../utils/stockCompare";

const series = (ticker: string, points: Array<[string, number]>): CompareSeries => ({
  ticker,
  closes: points.map(([date, close]) => ({ date, close }))
});

describe("computeCommonStart", () => {
  it("각 시리즈 첫 거래일 중 가장 늦은 날을 반환한다", () => {
    const s = [
      series("A", [["2020-01-02", 100], ["2020-01-03", 110]]),
      series("B", [["2021-05-03", 50], ["2021-05-04", 55]])
    ];
    expect(computeCommonStart(s)).toBe("2021-05-03");
  });

  it("빈 시리즈가 섞이면 공통 구간이 없으므로 null", () => {
    expect(computeCommonStart([series("A", [["2020-01-02", 100]]), series("B", [])])).toBeNull();
  });

  it("시리즈가 없으면 null", () => {
    expect(computeCommonStart([])).toBeNull();
  });
});

describe("buildCompareRows", () => {
  it("공통 시작일부터 각 시리즈를 자기 첫 종가=1로 정규화한다", () => {
    const s = [
      series("A", [["2020-01-02", 100], ["2020-01-03", 110], ["2020-01-06", 120]]),
      series("B", [["2020-01-03", 50], ["2020-01-06", 55]])
    ];
    const { rows, bases, commonStart } = buildCompareRows(s);
    expect(commonStart).toBe("2020-01-03");
    // A의 공통 시작일 이전(01-02) 데이터는 제외
    expect(rows.map((r) => r.date)).toEqual(["2020-01-03", "2020-01-06"]);
    expect(bases.A).toEqual({ date: "2020-01-03", close: 110 });
    expect(bases.B).toEqual({ date: "2020-01-03", close: 50 });
    expect(rows[0].A).toBe(1);
    expect(rows[0].B).toBe(1);
    expect(rows[1].A).toBeCloseTo(120 / 110, 10);
    expect(rows[1].B).toBeCloseTo(1.1, 10);
  });

  it("휴장일 어긋남: 공통 시작일에 거래가 없는 시리즈는 그 이후 첫 거래일이 기준", () => {
    // A는 01-03 휴장 (한국·미국 캘린더 차이)
    const s = [
      series("A", [["2020-01-02", 200], ["2020-01-06", 210]]),
      series("B", [["2020-01-03", 50], ["2020-01-06", 60]])
    ];
    const { rows, bases, commonStart } = buildCompareRows(s);
    expect(commonStart).toBe("2020-01-03");
    expect(bases.A).toEqual({ date: "2020-01-06", close: 210 });
    // 01-03 행에는 B만 존재 (A 키 없음 → recharts connectNulls 대상)
    expect(rows[0]).toEqual({ date: "2020-01-03", B: 1 });
    expect(rows[1].A).toBe(1);
    expect(rows[1].B).toBeCloseTo(1.2, 10);
  });

  it("합집합 날짜를 오름차순으로 정렬한다", () => {
    const s = [
      series("A", [["2020-01-02", 100], ["2020-01-06", 105]]),
      series("B", [["2020-01-02", 10], ["2020-01-03", 11]])
    ];
    const { rows } = buildCompareRows(s);
    expect(rows.map((r) => r.date)).toEqual(["2020-01-02", "2020-01-03", "2020-01-06"]);
  });

  it("기준 종가가 0 이하인 시리즈는 제외한다 (0으로 나누기 방지)", () => {
    const s = [
      series("A", [["2020-01-02", 0], ["2020-01-03", 10]]),
      series("B", [["2020-01-02", 50], ["2020-01-03", 55]])
    ];
    const { rows, bases } = buildCompareRows(s);
    expect(bases.A).toBeUndefined();
    expect(bases.B).toBeDefined();
    expect(rows.every((r) => !("A" in r))).toBe(true);
  });

  it("빈 시리즈는 무시하고 나머지로 계산한다", () => {
    const s = [series("A", []), series("B", [["2020-01-02", 50], ["2020-01-03", 55]])];
    const { rows, commonStart } = buildCompareRows(s);
    expect(commonStart).toBe("2020-01-02");
    expect(rows).toHaveLength(2);
  });

  it("전부 비어 있으면 빈 결과", () => {
    expect(buildCompareRows([])).toEqual({ rows: [], bases: {}, commonStart: null });
    expect(buildCompareRows([series("A", [])])).toEqual({ rows: [], bases: {}, commonStart: null });
  });
});

describe("downsampleRows", () => {
  it("maxPoints 이하면 그대로 반환한다", () => {
    const rows = [1, 2, 3];
    expect(downsampleRows(rows, 3)).toBe(rows);
  });

  it("초과하면 균등 샘플링하되 첫 행과 마지막 행을 유지한다", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => i);
    const out = downsampleRows(rows, 300);
    expect(out.length).toBeLessThanOrEqual(301);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(999);
  });
});

describe("latestMultiple", () => {
  it("해당 티커 값이 있는 가장 최근 행에서 읽는다 (마지막 행에 값이 없어도)", () => {
    const rows: CompareRow[] = [
      { date: "2020-01-02", A: 1, B: 1 },
      { date: "2020-01-03", A: 1.1 } // B는 휴장
    ];
    expect(latestMultiple(rows, "A")).toBe(1.1);
    expect(latestMultiple(rows, "B")).toBe(1);
  });

  it("티커가 아예 없으면 null", () => {
    expect(latestMultiple([{ date: "2020-01-02", A: 1 }], "C")).toBeNull();
    expect(latestMultiple([], "A")).toBeNull();
  });
});
