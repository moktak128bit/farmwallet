import { describe, it, expect } from "vitest";
import { calcTrend, mTotalsFor, computePeriodScope } from "../utils/insightsHelpers";
import type { LedgerEntry } from "../types";

describe("calcTrend", () => {
  it("빈 배열: flat/0/nonZero 빈/avg 0", () => {
    const r = calcTrend([]);
    expect(r.monthTrend).toBe("flat");
    expect(r.mom).toBe(0);
    expect(r.nonZero).toEqual([]);
    expect(r.monthAvg).toBe(0);
  });

  it("마지막 두 달 10% 이상 증가 → up", () => {
    expect(calcTrend([100, 200]).monthTrend).toBe("up");
    expect(calcTrend([100, 200]).mom).toBe(100);
  });

  it("마지막 두 달 10% 이상 감소 → down", () => {
    expect(calcTrend([100, 80]).monthTrend).toBe("down");
    expect(calcTrend([100, 80]).mom).toBe(-20);
  });

  it("5% 변화는 flat (임계값 10%)", () => {
    expect(calcTrend([100, 105]).monthTrend).toBe("flat");
  });

  it("monthAvg는 0 제외", () => {
    expect(calcTrend([0, 100, 0, 200]).monthAvg).toBe(150);
    expect(calcTrend([0, 100, 0, 200]).nonZero).toEqual([100, 200]);
  });
});

describe("mTotalsFor", () => {
  const ledger: LedgerEntry[] = [
    { id: "1", date: "2026-01-15", kind: "expense", category: "x", description: "a", amount: 100 },
    { id: "2", date: "2026-01-20", kind: "expense", category: "x", description: "b", amount: 200 },
    { id: "3", date: "2026-02-01", kind: "expense", category: "y", description: "c", amount: 300 },
    { id: "4", date: "2026-02-10", kind: "income", category: "z", description: "d", amount: 999 },
  ];

  it("match에 맞는 월별 합계", () => {
    const result = mTotalsFor(["2026-01", "2026-02"], ledger, (l) => l.kind === "expense");
    expect(result).toEqual([300, 300]);
  });

  it("모든 항목 포함 match", () => {
    const result = mTotalsFor(["2026-01", "2026-02"], ledger, () => true);
    expect(result).toEqual([300, 1299]);
  });

  it("요청한 월에 데이터 없으면 0", () => {
    const result = mTotalsFor(["2026-03"], ledger, () => true);
    expect(result).toEqual([0]);
  });
});

describe("computePeriodScope", () => {
  const months = ["2026-01", "2026-02", "2026-03", "2026-04"];
  const ml: Record<string, string> = {
    "2026-01": "1월",
    "2026-02": "2월",
    "2026-03": "3월",
    "2026-04": "4월",
  };

  it("selMonth 없을 때: monthSpan = months.length, accumLabel = 'N개월 누적'", () => {
    const r = computePeriodScope(null, months, ml);
    expect(r.monthSpan).toBe(4);
    expect(r.accumLabel).toBe("4개월 누적");
  });

  it("selMonth 설정 시: monthSpan = 1, accumLabel = 그 달 라벨", () => {
    const r = computePeriodScope("2026-04", months, ml);
    expect(r.monthSpan).toBe(1);
    expect(r.accumLabel).toBe("4월");
  });

  it("months 비어있으면 monthSpan은 최소 1로 보정 (NaN 방지)", () => {
    const r = computePeriodScope(null, [], {});
    expect(r.monthSpan).toBe(1);
    expect(r.accumLabel).toBe("0개월 누적");
  });

  it("ml에 키 없을 때 selMonth: accumLabel은 selMonth 자체로 폴백", () => {
    const r = computePeriodScope("2099-12", months, ml);
    expect(r.monthSpan).toBe(1);
    expect(r.accumLabel).toBe("2099-12");
  });

  it("회귀: 4월 합계를 monthSpan으로 나누면 4월 합 그대로 (1로 나눠짐)", () => {
    // ExpenseTab subAvg 버그 회귀 방지: 필터된 합 ÷ months.length(과거 버그) 였던 것을
    // ÷ monthSpan으로 바꾼 동작이 살아있는지 검증.
    const aprilSubAmount = 50000;
    const { monthSpan } = computePeriodScope("2026-04", months, ml);
    expect(Math.round(aprilSubAmount / monthSpan)).toBe(50000);
  });
});
