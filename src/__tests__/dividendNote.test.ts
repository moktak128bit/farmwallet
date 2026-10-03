import { describe, it, expect } from "vitest";
import { parseQuantityFromNote, parseExDateFromNote, buildDividendNote, buildMonthlyDividendSeries } from "../utils/dividend";

describe("parseQuantityFromNote", () => {
  it("기본 형식을 읽는다", () => {
    expect(parseQuantityFromNote("보유주식: 254")).toBe(254);
    expect(parseQuantityFromNote("보유주식:254\n배당락일:2026-03-31")).toBe(254);
  });

  it("회귀: 콤마가 든 수량을 잘라 읽지 않는다", () => {
    // 입력 킷이 "1,000"으로 포맷한 값이 note에 남을 수 있다. \d+ 만 보면 1로 읽혔다.
    expect(parseQuantityFromNote("보유주식: 1,000")).toBe(1000);
    expect(parseQuantityFromNote("보유주식: 12,345")).toBe(12345);
  });

  it("소수 수량(미국주식 소수점 매수)도 읽는다", () => {
    expect(parseQuantityFromNote("보유주식: 10.5")).toBe(10.5);
  });

  it("없거나 형식이 다르면 null", () => {
    expect(parseQuantityFromNote(undefined)).toBeNull();
    expect(parseQuantityFromNote("배당락일:2026-03-31")).toBeNull();
  });
});

describe("배당 note 생성/파싱 왕복", () => {
  it("buildDividendNote가 만든 note를 그대로 되읽는다", () => {
    const note = buildDividendNote(1000, "2026-03-31");
    expect(note).toBeDefined();
    expect(parseQuantityFromNote(note)).toBe(1000);
    expect(parseExDateFromNote(note)).toBe("2026-03-31");
  });
});

describe("buildMonthlyDividendSeries — 빈 달 0 채움 (감사 V2)", () => {
  // 분기배당 10만 × 13회 (2023-09 ~ 2026-09), 이번 달 2026-10
  const totals: Array<{ month: string; total: number }> = [];
  for (let y = 2023; y <= 2026; y += 1) {
    for (const mm of ["03", "06", "09", "12"]) {
      const month = `${y}-${mm}`;
      if (month >= "2023-09" && month <= "2026-09") totals.push({ month, total: 100_000 });
    }
  }

  it("최근 12개월 합계는 달력 12개월 (수령한 12회가 아님) — 대시보드 received12와 같은 40만", () => {
    expect(totals).toHaveLength(13);
    const { chart, stats } = buildMonthlyDividendSeries(totals, "2026-10");
    expect(stats.last12Total).toBe(400_000);
    expect(stats.last12Count).toBe(12);
    expect(stats.recentSixTotal).toBe(200_000);
    expect(stats.priorSixTotal).toBe(200_000);
    expect(stats.completedMonths).toBe(37); // 2023-09 ~ 2026-09
    expect(stats.completedAvg).toBeCloseTo(1_300_000 / 37, 6);
    // 3개월 이동평균도 빈 달 0 포함 → 분기배당이면 항상 10만/3
    const sep = chart.find((r) => r.month === "2026-09")!;
    expect(sep.movingAvg).toBeCloseTo(100_000 / 3, 6);
    // 이번 달은 미수령이어도 진행 중 막대(0)로 남고 완료월 지표엔 안 들어간다
    expect(chart[chart.length - 1]).toMatchObject({ month: "2026-10", total: 0, isPartial: true });
  });

  it("기록이 없으면 빈 차트", () => {
    expect(buildMonthlyDividendSeries([], "2026-10").chart).toEqual([]);
  });
});
