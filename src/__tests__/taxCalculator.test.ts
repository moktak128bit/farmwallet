import { describe, it, expect } from "vitest";
import {
  summarizeTaxYear,
  SEPARATE_TAX_RATE,
  COMPREHENSIVE_TAX_THRESHOLD,
} from "../utils/taxCalculator";
import type { LedgerEntry } from "../types";

const mkEntry = (overrides: Partial<LedgerEntry>): LedgerEntry => ({
  id: Math.random().toString(36).slice(2),
  date: "2024-06-01",
  kind: "income",
  category: "배당",
  description: "test",
  amount: 0,
  ...overrides,
});

describe("summarizeTaxYear", () => {
  it("빈 ledger는 0으로 채워진 결과 반환", () => {
    const r = summarizeTaxYear([], 2024);
    expect(r.year).toBe(2024);
    expect(r.dividendGross).toBe(0);
    expect(r.interestGross).toBe(0);
    expect(r.totalGross).toBe(0);
    expect(r.separateTax).toBe(0);
    expect(r.netIncome).toBe(0);
    expect(r.exceedsThreshold).toBe(false);
    expect(r.amountOverThreshold).toBe(0);
  });

  it("배당과 이자만 합산하고, 다른 카테고리는 무시", () => {
    const ledger: LedgerEntry[] = [
      mkEntry({ category: "배당", amount: 1_000_000 }),
      mkEntry({ category: "이자", amount: 500_000 }),
      mkEntry({ category: "급여", amount: 5_000_000 }), // 무시
      mkEntry({ category: "투자수익", amount: 9_999_999 }), // 무시
    ];
    const r = summarizeTaxYear(ledger, 2024);
    expect(r.dividendGross).toBe(1_000_000);
    expect(r.interestGross).toBe(500_000);
    expect(r.totalGross).toBe(1_500_000);
  });

  it("subCategory가 정확히 '배당'인 항목 인식", () => {
    const ledger: LedgerEntry[] = [
      mkEntry({ category: "수입", subCategory: "배당", amount: 200_000 }),
    ];
    const r = summarizeTaxYear(ledger, 2024);
    expect(r.dividendGross).toBe(200_000);
  });

  it("'-배당'/'-이자' suffix 패턴(예: '수입-배당')도 인식", () => {
    const ledger: LedgerEntry[] = [
      mkEntry({ category: "수입-배당", amount: 100_000 }),
      mkEntry({ category: "수입-이자", amount: 50_000 }),
    ];
    const r = summarizeTaxYear(ledger, 2024);
    expect(r.dividendGross).toBe(100_000);
    expect(r.interestGross).toBe(50_000);
  });

  it("'비배당주식'·'배당금' 같은 substring 위양성은 제외", () => {
    const ledger: LedgerEntry[] = [
      mkEntry({ category: "비배당주식", amount: 9_999_999 }),
      mkEntry({ category: "배당금", amount: 9_999_999 }), // 정확히 '배당'이 아님
      mkEntry({ category: "세금감면-배당", amount: 100_000 }), // suffix는 OK
    ];
    const r = summarizeTaxYear(ledger, 2024);
    expect(r.dividendGross).toBe(100_000); // 위양성 2건 제외
  });

  it("expense는 배당 카테고리여도 무시 (kind=income만)", () => {
    const ledger: LedgerEntry[] = [
      mkEntry({ kind: "expense", category: "배당", amount: 99_999 }),
    ];
    const r = summarizeTaxYear(ledger, 2024);
    expect(r.dividendGross).toBe(0);
    expect(r.totalGross).toBe(0);
  });

  it("다른 연도 항목은 제외", () => {
    const ledger: LedgerEntry[] = [
      mkEntry({ date: "2023-12-31", category: "배당", amount: 100_000 }),
      mkEntry({ date: "2024-01-01", category: "배당", amount: 200_000 }),
      mkEntry({ date: "2025-01-01", category: "배당", amount: 300_000 }),
    ];
    const r = summarizeTaxYear(ledger, 2024);
    expect(r.dividendGross).toBe(200_000);
  });

  it("분리과세 세액 = totalGross * 15.4%", () => {
    const ledger: LedgerEntry[] = [
      mkEntry({ category: "배당", amount: 1_000_000 }),
    ];
    const r = summarizeTaxYear(ledger, 2024);
    expect(r.separateTax).toBeCloseTo(1_000_000 * SEPARATE_TAX_RATE, 5);
    expect(r.netIncome).toBeCloseTo(1_000_000 * (1 - SEPARATE_TAX_RATE), 5);
  });

  it("종합과세 임계 이하면 exceedsThreshold=false, 추가세=0", () => {
    const ledger: LedgerEntry[] = [
      mkEntry({ category: "배당", amount: COMPREHENSIVE_TAX_THRESHOLD }),
    ];
    const r = summarizeTaxYear(ledger, 2024);
    expect(r.exceedsThreshold).toBe(false);
    expect(r.amountOverThreshold).toBe(0);
    expect(r.estimatedAdditionalTaxIfComprehensive).toBe(0);
  });

  it("종합과세 임계 초과하면 추가세 계산", () => {
    const over = 5_000_000;
    const ledger: LedgerEntry[] = [
      mkEntry({ category: "배당", amount: COMPREHENSIVE_TAX_THRESHOLD + over }),
    ];
    const r = summarizeTaxYear(ledger, 2024);
    expect(r.exceedsThreshold).toBe(true);
    expect(r.amountOverThreshold).toBe(over);
    // 초과분에 (24% - 15.4%) = 8.6% 적용
    expect(r.estimatedAdditionalTaxIfComprehensive).toBeCloseTo(over * (0.24 - SEPARATE_TAX_RATE), 5);
  });

  it("date 누락 항목은 안전하게 무시", () => {
    const ledger: LedgerEntry[] = [
      mkEntry({ date: "", category: "배당", amount: 100_000 }),
    ];
    const r = summarizeTaxYear(ledger, 2024);
    expect(r.totalGross).toBe(0);
  });
});
