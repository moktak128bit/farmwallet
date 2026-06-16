import { describe, it, expect } from "vitest";
import { detectSpendAnomalies } from "../utils/anomaly";
import type { LedgerEntry } from "../types";

let seq = 0;
const exp = (date: string, amount: number, sub = "식비"): LedgerEntry => ({
  id: `e${++seq}`,
  date,
  kind: "expense",
  category: "지출",
  subCategory: sub,
  description: "",
  amount,
});

describe("detectSpendAnomalies — dayCap 부분-월 공정 비교", () => {
  // 과거 6개월: 매달 3일에 ~100,000(변동) + 25일에 500,000 (완결 월 ~600,000)
  const day3 = [95_000, 100_000, 105_000, 98_000, 102_000, 100_000];
  const ledger: LedgerEntry[] = [];
  ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"].forEach((mo, i) => {
    ledger.push(exp(`${mo}-03`, day3[i]));
    ledger.push(exp(`${mo}-25`, 500_000));
  });
  // 현재월(2026-07) 5일차까지: 3일에 150,000 — 1~5일 기준으론 과다, 완결월 기준으론 과소
  ledger.push(exp("2026-07-03", 150_000));

  it("dayCap 없으면 부분-월 current(150k)가 완결월 평균(~600k)보다 낮아 이상치 아님", () => {
    const r = detectSpendAnomalies(ledger, "2026-07", 6).find((a) => a.category === "식비");
    expect(r?.isAnomaly).toBe(false);
  });

  it("dayCap=5면 1~5일끼리 비교 → 평균 100k 대비 150k로 이상치 감지", () => {
    const r = detectSpendAnomalies(ledger, "2026-07", 6, 5).find((a) => a.category === "식비");
    expect(r?.isAnomaly).toBe(true);
    expect(r!.zScore).toBeGreaterThan(2);
  });
});
