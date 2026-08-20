/** 0-4 — 종합과세 트래커/세금 보고서 세전(gross-up) 환산 옵션 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  summarizeTaxYear,
  buildComprehensiveTaxTracker,
  SEPARATE_TAX_RATE,
  US_DIVIDEND_WITHHOLDING_RATE,
  COMPREHENSIVE_TAX_THRESHOLD
} from "../utils/taxCalculator";
import { readTaxGrossUp, writeTaxGrossUp } from "../hooks/useTaxGrossUp";
import { STORAGE_KEYS } from "../constants/config";
import type { LedgerEntry } from "../types";

const mk = (over: Partial<LedgerEntry>): LedgerEntry => ({
  id: Math.random().toString(36).slice(2),
  date: "2026-03-01",
  kind: "income",
  category: "배당",
  description: "t",
  amount: 0,
  ...over
});

const FX = 1300;
const mixed: LedgerEntry[] = [
  mk({ category: "배당", amount: 846_000 }), // 국내 배당(세후) → 세전 1,000,000
  mk({ category: "이자", amount: 423_000 }), // 국내 이자(세후) → 세전 500,000
  mk({ category: "배당", amount: 85, currency: "USD" }), // 해외 배당(세후 $85) → 세전 $100 = 130,000원
  mk({ category: "이자", amount: 84.6, currency: "USD" }), // USD 이자 → 국내율 15.4% → 세전 $100 = 130,000원
  mk({ category: "급여", amount: 5_000_000 }) // 무시
];

describe("grossUp — summarizeTaxYear", () => {
  it("옵션 생략/false는 기존 결과와 완전히 동일 (grossUpApplied=false, netTotal===grossTotal)", () => {
    const base = summarizeTaxYear(mixed, 2026, FX);
    const off = summarizeTaxYear(mixed, 2026, FX, { grossUp: false });
    const noOpt = summarizeTaxYear(mixed, 2026, FX, {});
    expect(off).toEqual(base);
    expect(noOpt).toEqual(base);
    expect(base.grossUpApplied).toBe(false);
    expect(base.netTotal).toBe(base.grossTotal);
    expect(base.grossTotal).toBe(base.totalGross);
    expect(base.dividendGross).toBeCloseTo(846_000 + 85 * FX, 6);
    expect(base.interestGross).toBeCloseTo(423_000 + 84.6 * FX, 6);
  });

  it("grossUp=true — 국내 ÷(1−0.154), USD 배당 ÷(1−0.15), USD 이자는 국내율", () => {
    const r = summarizeTaxYear(mixed, 2026, FX, { grossUp: true });
    expect(r.grossUpApplied).toBe(true);
    expect(r.dividendGross).toBeCloseTo(1_000_000 + 100 * FX, 4);
    expect(r.interestGross).toBeCloseTo(500_000 + 100 * FX, 4);
    expect(r.totalGross).toBeCloseTo(1_500_000 + 200 * FX, 4);
    expect(r.grossTotal).toBe(r.totalGross);
    // 환산 전 입금액 합계는 그대로 노출
    const base = summarizeTaxYear(mixed, 2026, FX);
    expect(r.netTotal).toBeCloseTo(base.totalGross, 6);
    expect(r.netTotal).toBeLessThan(r.grossTotal);
    // 분리과세/실수령은 환산된 세전 기준으로 재계산
    expect(r.separateTax).toBeCloseTo(r.totalGross * SEPARATE_TAX_RATE, 4);
    expect(r.netIncome).toBeCloseTo(r.totalGross * (1 - SEPARATE_TAX_RATE), 4);
  });

  it("USD 배당 역산율 상수 = 15%", () => {
    expect(US_DIVIDEND_WITHHOLDING_RATE).toBe(0.15);
    const r = summarizeTaxYear([mk({ amount: 85, currency: "USD" })], 2026, FX, { grossUp: true });
    expect(r.dividendGross).toBeCloseTo((85 / (1 - US_DIVIDEND_WITHHOLDING_RATE)) * FX, 4);
  });

  it("세후 입금 합계가 임계 바로 아래라도 세전 환산하면 임계 초과로 경고", () => {
    // 세후 1,800만(국내 배당) → 세전 ≈ 2,127만 > 2,000만
    const ledger = [mk({ amount: 18_000_000 })];
    expect(summarizeTaxYear(ledger, 2026).exceedsThreshold).toBe(false);
    const r = summarizeTaxYear(ledger, 2026, null, { grossUp: true });
    expect(r.exceedsThreshold).toBe(true);
    expect(r.totalGross).toBeCloseTo(18_000_000 / (1 - SEPARATE_TAX_RATE), 4);
    expect(r.amountOverThreshold).toBeCloseTo(r.totalGross - COMPREHENSIVE_TAX_THRESHOLD, 4);
  });

  it("환율 미로드 시 USD는 액면 폴백(기존 정책) 후 역산", () => {
    const r = summarizeTaxYear([mk({ amount: 85, currency: "USD" })], 2026, null, { grossUp: true });
    expect(r.dividendGross).toBeCloseTo(100, 6);
  });
});

describe("grossUp — buildComprehensiveTaxTracker", () => {
  it("옵션 생략/false는 기존 결과와 동일", () => {
    const base = buildComprehensiveTaxTracker(mixed, "2026-07-01", FX);
    const off = buildComprehensiveTaxTracker(mixed, "2026-07-01", FX, { grossUp: false });
    expect(off).toEqual(base);
    expect(base.grossUpApplied).toBe(false);
    expect(base.netTotal).toBe(base.grossTotal);
    expect(base.grossTotal).toBe(base.ytdGross);
  });

  it("grossUp=true — ytdGross·remaining·pct·예상일이 세전 기준으로 바뀐다", () => {
    const off = buildComprehensiveTaxTracker(mixed, "2026-07-01", FX);
    const on = buildComprehensiveTaxTracker(mixed, "2026-07-01", FX, { grossUp: true });
    expect(on.grossUpApplied).toBe(true);
    expect(on.ytdGross).toBeCloseTo(1_500_000 + 200 * FX, 4);
    expect(on.grossTotal).toBe(on.ytdGross);
    expect(on.netTotal).toBeCloseTo(off.ytdGross, 6);
    expect(on.remainingToThreshold).toBeCloseTo(COMPREHENSIVE_TAX_THRESHOLD - on.ytdGross, 4);
    expect(on.pctOfThreshold).toBeGreaterThan(off.pctOfThreshold);
    expect(on.projectedYearEndGross).toBeGreaterThan(off.projectedYearEndGross);
  });

  it("세후 합계가 임계 미만이어도 세전 환산으로 exceeded=true가 될 수 있다", () => {
    const ledger = [mk({ date: "2026-02-01", amount: 17_500_000 })];
    expect(buildComprehensiveTaxTracker(ledger, "2026-07-01").exceeded).toBe(false);
    const on = buildComprehensiveTaxTracker(ledger, "2026-07-01", null, { grossUp: true });
    expect(on.exceeded).toBe(true);
    expect(on.remainingToThreshold).toBe(0);
    expect(on.projectedThresholdDate).toBeNull();
  });

  it("기간 필터(미래·전년도 제외)는 grossUp과 무관하게 유지", () => {
    const ledger = [
      mk({ date: "2026-03-01", amount: 846_000 }),
      mk({ date: "2026-12-01", amount: 10_000_000 }),
      mk({ date: "2025-12-31", amount: 10_000_000 })
    ];
    const on = buildComprehensiveTaxTracker(ledger, "2026-07-01", null, { grossUp: true });
    expect(on.ytdGross).toBeCloseTo(1_000_000, 4);
    expect(on.netTotal).toBe(846_000);
  });
});

describe("세전 환산 토글 저장 (localStorage)", () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEYS.TAX_GROSS_UP);
  });

  it("기본 off", () => {
    expect(readTaxGrossUp()).toBe(false);
  });

  it("write(true) → read true, write(false) → 키 제거·read false", () => {
    writeTaxGrossUp(true);
    expect(localStorage.getItem(STORAGE_KEYS.TAX_GROSS_UP)).toBe("true");
    expect(readTaxGrossUp()).toBe(true);
    writeTaxGrossUp(false);
    expect(localStorage.getItem(STORAGE_KEYS.TAX_GROSS_UP)).toBeNull();
    expect(readTaxGrossUp()).toBe(false);
  });

  it("STORAGE_KEYS.TAX_GROSS_UP 키 값 고정", () => {
    expect(STORAGE_KEYS.TAX_GROSS_UP).toBe("fw-tax-gross-up");
  });
});
