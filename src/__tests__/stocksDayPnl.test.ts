import { describe, expect, it } from "vitest";
import { dayChangePerShare, dayPnlPercent } from "../features/stocks/dayPnl";

describe("주식 탭 일일손익 (실장부 감사 2026-11)", () => {
  it("change가 있으면 그대로", () => {
    expect(dayChangePerShare({ price: 100, change: -3, changePercent: -2.9 })).toBe(-3);
  });

  it("업비트처럼 changePercent만 있으면 전일가를 역산 — 솔라나 −2.30%가 0으로 빠지지 않는다", () => {
    // 현재가 97.7, −2.30% → 전일가 100
    expect(dayChangePerShare({ price: 97.7, changePercent: -2.3 })).toBeCloseTo(-2.3, 6);
  });

  it("둘 다 없거나 시세가 없으면 0", () => {
    expect(dayChangePerShare({ price: 100 })).toBe(0);
    expect(dayChangePerShare(undefined)).toBe(0);
    expect(dayChangePerShare({ price: 0, changePercent: 5 })).toBe(0);
  });

  it("일일 수익률 분모는 전일 평가액(오늘 평가액 − 일일손익)", () => {
    expect(dayPnlPercent(1_100_000, 100_000)).toBeCloseTo(10, 6); // 100만 → 110만 = +10%
    expect(dayPnlPercent(0, 0)).toBeNull();
  });
});
