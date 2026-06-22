/** C1 — 선행 배당 캘린더 (buildForwardDividends) */
import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "../types";
import { buildForwardDividends } from "../utils/forwardDividends";

const div = (date: string, amount: number, currency?: "USD"): LedgerEntry => ({
  id: Math.random().toString(36).slice(2),
  date,
  kind: "income",
  category: "배당",
  description: "배당",
  amount,
  ...(currency ? { currency } : {}),
});

const find = (months: { month: string; amountKRW: number }[], ym: string) =>
  months.find((m) => m.month === ym)!;

describe("buildForwardDividends", () => {
  it("최근 12개월 배당을 같은 달에 향후로 투영한다", () => {
    // today 2026-06-15, trailing window [2025-06-15, 2026-06-15]
    const r = buildForwardDividends(
      [
        div("2025-08-10", 80_000), // 8월
        div("2026-02-10", 100_000), // 2월
        div("2026-05-10", 50_000), // 5월
        div("2024-05-10", 999_999), // 윈도우 밖 → 제외
      ],
      "2026-06-15"
    );
    expect(r.months).toHaveLength(12);
    expect(r.months[0].month).toBe("2026-07"); // 다음 달부터
    expect(find(r.months, "2026-08").amountKRW).toBe(80_000);
    expect(find(r.months, "2027-02").amountKRW).toBe(100_000);
    expect(find(r.months, "2027-05").amountKRW).toBe(50_000);
    expect(find(r.months, "2026-09").amountKRW).toBe(0);
    expect(r.annualTotalKRW).toBe(230_000);
    expect(r.trailing12KRW).toBe(230_000);
  });

  it("USD 배당은 환율로 환산", () => {
    const r = buildForwardDividends([div("2026-03-10", 100, "USD")], "2026-06-15", 1_300);
    expect(r.trailing12KRW).toBe(130_000);
    expect(find(r.months, "2027-03").amountKRW).toBe(130_000);
  });

  it("배당이 아닌 수입은 무시", () => {
    const r = buildForwardDividends(
      [{ id: "x", date: "2026-03-10", kind: "income", category: "급여", description: "월급", amount: 3_000_000 }],
      "2026-06-15"
    );
    expect(r.trailing12KRW).toBe(0);
    expect(r.annualTotalKRW).toBe(0);
  });

  it("배당 기록이 없으면 모두 0", () => {
    const r = buildForwardDividends([], "2026-06-15");
    expect(r.months).toHaveLength(12);
    expect(r.annualTotalKRW).toBe(0);
  });
});
