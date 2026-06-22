/** B1 — 종합과세 YTD 트래커 (buildComprehensiveTaxTracker) */
import { describe, expect, it } from "vitest";
import { buildComprehensiveTaxTracker } from "../utils/taxCalculator";
import type { LedgerEntry } from "../types";

const mk = (over: Partial<LedgerEntry>): LedgerEntry => ({
  id: Math.random().toString(36).slice(2),
  date: "2026-03-01",
  kind: "income",
  category: "배당",
  description: "t",
  amount: 0,
  ...over,
});

describe("buildComprehensiveTaxTracker", () => {
  it("올해 누적만 합산 — 미래일·전년도 제외", () => {
    const r = buildComprehensiveTaxTracker(
      [
        mk({ category: "배당", date: "2026-03-01", amount: 5_000_000 }),
        mk({ category: "이자", date: "2026-06-01", amount: 3_000_000 }),
        mk({ category: "배당", date: "2026-12-01", amount: 10_000_000 }), // 미래 → 제외
        mk({ category: "배당", date: "2025-12-01", amount: 9_000_000 }), // 전년도 → 제외
      ],
      "2026-07-01"
    );
    expect(r.dividendGross).toBe(5_000_000);
    expect(r.interestGross).toBe(3_000_000);
    expect(r.ytdGross).toBe(8_000_000);
    expect(r.remainingToThreshold).toBe(12_000_000);
    expect(r.exceeded).toBe(false);
    expect(r.pctOfThreshold).toBeCloseTo(0.4, 6);
  });

  it("임계 초과 시 remaining 0·exceeded true·예상일 null", () => {
    const r = buildComprehensiveTaxTracker(
      [mk({ category: "배당", date: "2026-02-01", amount: 25_000_000 })],
      "2026-07-01"
    );
    expect(r.exceeded).toBe(true);
    expect(r.remainingToThreshold).toBe(0);
    expect(r.projectedThresholdDate).toBeNull();
  });

  it("YTD 페이스가 임계를 넘길 전망이면 도달 예상일 제공", () => {
    // 반년(183일)에 1,100만 → 연말 약 2,190만 > 2,000만 → 올해 안 도달 예상
    const r = buildComprehensiveTaxTracker(
      [mk({ category: "배당", date: "2026-06-30", amount: 11_000_000 })],
      "2026-07-02"
    );
    expect(r.projectedYearEndGross).toBeGreaterThan(20_000_000);
    expect(r.projectedThresholdDate).not.toBeNull();
    expect(r.projectedThresholdDate!.startsWith("2026-")).toBe(true);
  });

  it("페이스가 낮으면 도달 예상일 null", () => {
    const r = buildComprehensiveTaxTracker(
      [mk({ category: "배당", date: "2026-06-30", amount: 1_000_000 })],
      "2026-07-02"
    );
    expect(r.projectedYearEndGross).toBeLessThan(20_000_000);
    expect(r.projectedThresholdDate).toBeNull();
  });

  it("USD 배당은 환율로 환산", () => {
    const r = buildComprehensiveTaxTracker(
      [mk({ category: "배당", date: "2026-03-01", amount: 1_000, currency: "USD" })],
      "2026-07-01",
      1_300
    );
    expect(r.ytdGross).toBe(1_300_000);
  });

  it("소득이 없으면 0·예상일 null", () => {
    const r = buildComprehensiveTaxTracker([], "2026-07-01");
    expect(r.ytdGross).toBe(0);
    expect(r.remainingToThreshold).toBe(20_000_000);
    expect(r.projectedThresholdDate).toBeNull();
  });
});
