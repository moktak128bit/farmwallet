/** 배당 '모으는 재미' 스토리 파생값 (buildDividendStory) */
import { describe, expect, it } from "vitest";
import { buildDividendStory, type DividendGrowthData } from "../utils/dividendGrowth";

const pt = (over: Partial<DividendGrowthData["points"][number]>): DividendGrowthData["points"][number] => ({
  month: "2026-01",
  label: "26.01",
  received: 0,
  perShare: null,
  price: null,
  monthlyYield: null,
  monthlyYoc: null,
  shares: 0,
  avgCost: null,
  ...over,
});

const data: DividendGrowthData = {
  ticker: "458730",
  name: "TIGER 미국배당다우존스",
  recordCount: 2,
  points: [
    pt({ month: "2026-01", received: 1000, perShare: 10, price: 1000, monthlyYield: 1.0, monthlyYoc: 1.0, shares: 100, avgCost: 1000 }),
    pt({ month: "2026-02", received: 2200, perShare: 11, price: 1100, monthlyYield: 1.0, monthlyYoc: 1.1, shares: 200, avgCost: 1000 }),
  ],
  current: {
    shares: 200, avgCost: 1000, price: 1100,
    lastMonthReceived: 2200, lastMonthPerShare: 11, lastMonthYield: 1.0, lastMonthYoc: 1.1,
    annualPerShare: 132, marketYield: 12, yoc: 13.2,
  },
};

describe("buildDividendStory", () => {
  it("누적 눈덩이·연환산 YOC·런레이트를 파생한다", () => {
    const s = buildDividendStory(data);
    // 누적
    expect(s.points[0].cumulativeReceived).toBe(1000);
    expect(s.points[1].cumulativeReceived).toBe(3200);
    expect(s.totalReceived).toBe(3200);
    // 연환산 YOC = 월 YOC × 12
    expect(s.points[0].annualYoc).toBeCloseTo(12, 6);
    expect(s.points[1].annualYoc).toBeCloseTo(13.2, 6);
    // 런레이트 = 보유 × 연환산 주당분배금
    expect(s.points[0].runRate).toBeCloseTo(100 * 10 * 12, 6);
    expect(s.points[1].runRate).toBeCloseTo(200 * 11 * 12, 6);
    // YOC 여정
    expect(s.startYoc).toBeCloseTo(12, 6);
    expect(s.nowYoc).toBeCloseTo(13.2, 6);
    expect(s.yocGainPp).toBeCloseTo(1.2, 6);
    // 현재 연간 런레이트
    expect(s.annualRunRate).toBeCloseTo(200 * 132, 6);
    expect(s.monthlyRunRate).toBeCloseTo((200 * 132) / 12, 6);
  });

  it("perShare 모르는 달은 직전 값을 캐리포워드해 런레이트 유지", () => {
    const d2: DividendGrowthData = {
      ...data,
      points: [
        pt({ month: "2026-01", received: 1000, perShare: 10, shares: 100, monthlyYoc: 1.0, avgCost: 1000 }),
        pt({ month: "2026-02", received: 0, perShare: null, shares: 150, monthlyYoc: null, avgCost: 1000 }), // 분배 없음
      ],
    };
    const s = buildDividendStory(d2);
    expect(s.points[1].runRate).toBeCloseTo(150 * 10 * 12, 6); // 직전 주당분배금 10 유지
    expect(s.points[1].annualYoc).toBeNull(); // YOC는 그 달 값이 없으면 null
  });

  it("배당 기록이 비면 모두 null/0", () => {
    const empty: DividendGrowthData = { ...data, points: [], current: { ...data.current, annualPerShare: null } };
    const s = buildDividendStory(empty);
    expect(s.totalReceived).toBe(0);
    expect(s.startYoc).toBeNull();
    expect(s.annualRunRate).toBeNull();
  });
});
