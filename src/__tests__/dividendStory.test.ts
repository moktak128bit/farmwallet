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
  it("누적 눈덩이 + 이동평균 연환산 YOC·런레이트를 파생한다", () => {
    const s = buildDividendStory(data);
    // 월 배당금 + 누적
    expect(s.points[0].received).toBe(1000);
    expect(s.points[1].received).toBe(2200);
    expect(s.points[0].cumulativeReceived).toBe(1000);
    expect(s.points[1].cumulativeReceived).toBe(3200);
    expect(s.totalReceived).toBe(3200);
    // 보유 평가액 = 보유주식 × 월 주가
    expect(s.points[0].marketValue).toBe(100 * 1000);
    expect(s.points[1].marketValue).toBe(200 * 1100);
    // 이동평균 연환산 주당분배금: m1 = 10×12=120, m2 = avg(10,11)×12 = 126
    // 연환산 YOC = annualPerShare / 평단 × 100
    expect(s.points[0].annualYoc).toBeCloseTo(12, 6); // 120/1000
    expect(s.points[1].annualYoc).toBeCloseTo(12.6, 6); // 126/1000
    // 런레이트 = 보유 × 이동평균 연환산 주당분배금
    expect(s.points[0].runRate).toBeCloseTo(100 * 120, 6);
    expect(s.points[1].runRate).toBeCloseTo(200 * 126, 6);
    // YOC 여정 (매끄러운 추세)
    expect(s.startYoc).toBeCloseTo(12, 6);
    expect(s.nowYoc).toBeCloseTo(12.6, 6);
    expect(s.yocGainPp).toBeCloseTo(0.6, 6);
    // 현재 연간 런레이트 = current.shares × current.annualPerShare (KPI 일치)
    expect(s.annualRunRate).toBeCloseTo(200 * 132, 6);
    expect(s.monthlyRunRate).toBeCloseTo((200 * 132) / 12, 6);
  });

  it("분배 없는 달도 직전 이동평균 연환산으로 런레이트·YOC 곡선을 잇는다", () => {
    const d2: DividendGrowthData = {
      ...data,
      points: [
        pt({ month: "2026-01", received: 1000, perShare: 10, shares: 100, avgCost: 1000 }),
        pt({ month: "2026-02", received: 0, perShare: null, shares: 150, avgCost: 1000 }), // 분배 없음
      ],
    };
    const s = buildDividendStory(d2);
    // 직전 연환산 주당분배금 120 유지 → 보유 150주 반영해 상승
    expect(s.points[1].runRate).toBeCloseTo(150 * 120, 6);
    expect(s.points[1].annualYoc).toBeCloseTo(12, 6); // 매끄럽게 이어짐 (null 아님)
  });

  it("배당 기록이 비면 모두 null/0", () => {
    const empty: DividendGrowthData = { ...data, points: [], current: { ...data.current, annualPerShare: null } };
    const s = buildDividendStory(empty);
    expect(s.totalReceived).toBe(0);
    expect(s.startYoc).toBeNull();
    expect(s.annualRunRate).toBeNull();
  });
});
