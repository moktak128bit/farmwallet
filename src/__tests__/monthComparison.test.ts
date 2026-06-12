/**
 * compareMonths 테스트 — summaryMath와 동일 분류 기준(신용결제 제외, 재테크 분리,
 * USD 환산)과 "신규"(pct=null) 처리 회귀 방지.
 */
import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "../types";
import { compareMonths } from "../utils/monthComparison";

let seq = 0;
function entry(partial: Partial<LedgerEntry>): LedgerEntry {
  seq += 1;
  return {
    id: `m${seq}`,
    date: "2026-06-05",
    kind: "expense",
    category: "식비",
    description: "",
    amount: 10000,
    ...partial,
  };
}

describe("compareMonths — 지출 비교", () => {
  it("현재/전월/전년 동월을 나눠 집계하고 증감률을 계산한다", () => {
    const ledger = [
      entry({ date: "2026-06-10", amount: 120_000 }),
      entry({ date: "2026-05-10", amount: 100_000 }),
      entry({ date: "2025-06-10", amount: 80_000 }),
    ];
    const r = compareMonths(ledger, "2026-06", "expense");
    expect(r.current).toBe(120_000);
    expect(r.previousMonth).toBe(100_000);
    expect(r.previousYearSameMonth).toBe(80_000);
    expect(r.diffPrevMonthPct).toBeCloseTo(20);
    expect(r.diffPrevYearPct).toBeCloseTo(50);
  });

  it("신용결제(레거시)는 이중계상 방지 위해 제외한다", () => {
    const ledger = [
      entry({ date: "2026-06-10", amount: 100_000 }),
      entry({ date: "2026-06-11", category: "신용결제", amount: 999_999 }),
      entry({ date: "2026-05-10", category: "신용결제", amount: 888_888 }),
      entry({ date: "2026-05-11", amount: 50_000 }),
    ];
    const r = compareMonths(ledger, "2026-06", "expense");
    expect(r.current).toBe(100_000);
    expect(r.previousMonth).toBe(50_000);
  });

  it("레거시 저축성지출(재테크)은 지출 비교에서 제외한다", () => {
    const ledger = [
      entry({ date: "2026-06-10", amount: 100_000 }),
      entry({ date: "2026-06-11", category: "재테크", subCategory: "저축", amount: 500_000 }),
    ];
    const r = compareMonths(ledger, "2026-06", "expense");
    expect(r.current).toBe(100_000);
  });

  it("USD 항목은 fxRate로 원화 환산한다", () => {
    const ledger = [
      entry({ date: "2026-06-10", amount: 10, currency: "USD" }),
      entry({ date: "2026-05-10", amount: 100_000 }),
    ];
    const r = compareMonths(ledger, "2026-06", "expense", 1400);
    expect(r.current).toBe(14_000);
    expect(r.previousMonth).toBe(100_000);
  });

  it("전월 0 + 현재 > 0이면 pct는 null('신규' 표시용), 둘 다 0이면 0%", () => {
    const onlyCurrent = [entry({ date: "2026-06-10", amount: 100_000 })];
    const r1 = compareMonths(onlyCurrent, "2026-06", "expense");
    expect(r1.diffPrevMonthPct).toBeNull();
    expect(r1.diffPrevYearPct).toBeNull();

    const r2 = compareMonths([], "2026-06", "expense");
    expect(r2.diffPrevMonthPct).toBe(0);
    expect(r2.diffPrevYearPct).toBe(0);
  });
});

describe("compareMonths — 수입 비교", () => {
  it("income만 집계하고 expense/transfer는 무시한다", () => {
    const ledger = [
      entry({ date: "2026-06-10", kind: "income", category: "급여", amount: 3_000_000 }),
      entry({ date: "2026-06-11", amount: 200_000 }),
      entry({ date: "2026-06-12", kind: "transfer", category: "이체", subCategory: "저축이체", amount: 500_000 }),
      entry({ date: "2026-05-25", kind: "income", category: "급여", amount: 2_000_000 }),
    ];
    const r = compareMonths(ledger, "2026-06", "income");
    expect(r.current).toBe(3_000_000);
    expect(r.previousMonth).toBe(2_000_000);
    expect(r.diffPrevMonthPct).toBeCloseTo(50);
  });
});

describe("compareMonths — dayCap (진행 중인 달의 동기 비교)", () => {
  it("dayCap을 넘기면 전월·전년 동월도 1~dayCap일만 합산한다 (월급 25일 시나리오)", () => {
    const ledger = [
      // 이번 달(진행 중, 오늘 = 12일): 용돈성 수입만
      entry({ date: "2026-06-05", kind: "income", category: "기타수입", amount: 100_000 }),
      // 전월: 같은 기간의 수입 + 25일 월급 (dayCap=12면 월급은 비교에서 빠져야 함)
      entry({ date: "2026-05-03", kind: "income", category: "기타수입", amount: 90_000 }),
      entry({ date: "2026-05-25", kind: "income", category: "급여", amount: 3_000_000 }),
      // 전년 동월도 동일 구조
      entry({ date: "2025-06-02", kind: "income", category: "기타수입", amount: 80_000 }),
      entry({ date: "2025-06-25", kind: "income", category: "급여", amount: 2_800_000 }),
    ];
    // dayCap 없이: 부분 월 vs 완전한 월 → -90%대 (기존 왜곡)
    const wrong = compareMonths(ledger, "2026-06", "income");
    expect(wrong.diffPrevMonthPct!).toBeLessThan(-90);
    // dayCap=12: 같은 기간끼리 비교 → +11.1%
    const r = compareMonths(ledger, "2026-06", "income", null, undefined, 12);
    expect(r.current).toBe(100_000);
    expect(r.previousMonth).toBe(90_000);
    expect(r.previousYearSameMonth).toBe(80_000);
    expect(r.diffPrevMonthPct).toBeCloseTo(11.111, 2);
    expect(r.dayCap).toBe(12);
  });

  it("dayCap 미지정 시 기존 동작(전체 월 합산) 그대로 + dayCap=null", () => {
    const ledger = [
      entry({ date: "2026-06-10", amount: 120_000 }),
      entry({ date: "2026-05-25", amount: 100_000 }),
    ];
    const r = compareMonths(ledger, "2026-06", "expense");
    expect(r.previousMonth).toBe(100_000);
    expect(r.dayCap).toBeNull();
  });
});
