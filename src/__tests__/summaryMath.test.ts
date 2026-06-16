/**
 * 대시보드 공용 집계(summaryMath) 테스트 — 단일 분류 기준(classifyLedgerFlow)과
 * USD 환산(toKrwAmount), 월 합계(computeLedgerSummary)의 회귀 방지.
 */
import { describe, expect, it } from "vitest";
import type { CategoryPresets, LedgerEntry } from "../types";
import {
  classifyLedgerFlow,
  computeLedgerSummary,
  isWealthBuildingEntry,
  toKrwAmount,
} from "../features/dashboard/summaryMath";

let seq = 0;
function entry(partial: Partial<LedgerEntry>): LedgerEntry {
  seq += 1;
  return {
    id: `t${seq}`,
    date: "2026-06-05",
    kind: "expense",
    category: "식비",
    description: "",
    amount: 10000,
    ...partial,
  };
}

describe("toKrwAmount", () => {
  it("KRW 항목은 액면 그대로", () => {
    expect(toKrwAmount(entry({ amount: 5000 }), 1400)).toBe(5000);
  });

  it("USD 항목은 환율 곱해 환산", () => {
    expect(toKrwAmount(entry({ amount: 10, currency: "USD" }), 1400)).toBe(14000);
  });

  it("환율 없으면(null) USD도 액면 그대로 (대시보드 공통 정책)", () => {
    expect(toKrwAmount(entry({ amount: 10, currency: "USD" }), null)).toBe(10);
  });
});

describe("classifyLedgerFlow — 단일 분류 기준", () => {
  it("수입 → income", () => {
    expect(classifyLedgerFlow(entry({ kind: "income", category: "급여" }))).toBe("income");
  });

  it("일반 지출 → expense", () => {
    expect(classifyLedgerFlow(entry({ kind: "expense", category: "식비" }))).toBe("expense");
  });

  it("신용결제(레거시)는 이중계상 방지 위해 제외(null)", () => {
    expect(classifyLedgerFlow(entry({ kind: "expense", category: "신용결제" }))).toBeNull();
    expect(classifyLedgerFlow(entry({ kind: "expense", category: "식비", subCategory: "신용결제" }))).toBeNull();
  });

  it("레거시 저축성지출(재테크 expense) → investing", () => {
    expect(classifyLedgerFlow(entry({ kind: "expense", category: "재테크", subCategory: "저축" }))).toBe("investing");
  });

  it("재테크 중 투자손실은 실소비 → expense", () => {
    expect(classifyLedgerFlow(entry({ kind: "expense", category: "재테크", subCategory: "투자손실" }))).toBe("expense");
  });

  it("저축이체/투자이체 transfer → investing (구버전 저축/투자 포함)", () => {
    for (const sub of ["저축이체", "투자이체", "저축", "투자"]) {
      expect(classifyLedgerFlow(entry({ kind: "transfer", category: "이체", subCategory: sub }))).toBe("investing");
    }
  });

  it("재테크 아닌 일반 이체(카드결제이체 등)는 제외(null)", () => {
    expect(classifyLedgerFlow(entry({ kind: "transfer", category: "이체", subCategory: "카드결제이체" }))).toBeNull();
  });

  it("categoryPresets의 커스텀 저축성 카테고리도 investing 인식", () => {
    const presets = { categoryTypes: { savings: ["내집마련"] } } as unknown as CategoryPresets;
    expect(classifyLedgerFlow(entry({ kind: "expense", category: "내집마련" }), presets)).toBe("investing");
  });
});

describe("isWealthBuildingEntry — '재테크' 단일 정의", () => {
  it("저축·투자 이체와 레거시 저축성지출 모두 true", () => {
    expect(isWealthBuildingEntry(entry({ kind: "transfer", category: "이체", subCategory: "저축이체" }))).toBe(true);
    expect(isWealthBuildingEntry(entry({ kind: "expense", category: "재테크", subCategory: "저축" }))).toBe(true);
  });

  it("일반 지출·수입은 false", () => {
    expect(isWealthBuildingEntry(entry({ kind: "expense", category: "식비" }))).toBe(false);
    expect(isWealthBuildingEntry(entry({ kind: "income", category: "급여" }))).toBe(false);
  });
});

describe("computeLedgerSummary", () => {
  const ledger: LedgerEntry[] = [
    entry({ kind: "income", category: "급여", amount: 3_000_000, date: "2026-06-25" }),
    entry({ kind: "expense", category: "식비", amount: 200_000, date: "2026-06-10" }),
    entry({ kind: "expense", category: "신용결제", amount: 999_999, date: "2026-06-11" }), // 제외
    entry({ kind: "expense", category: "재테크", subCategory: "저축", amount: 100_000, date: "2026-06-12" }), // 재테크
    entry({ kind: "transfer", category: "이체", subCategory: "투자이체", amount: 500_000, date: "2026-06-13" }),
    entry({ kind: "transfer", category: "이체", subCategory: "카드결제이체", amount: 777_777, date: "2026-06-14" }), // 제외
    entry({ kind: "expense", category: "식비", amount: 10, currency: "USD", date: "2026-06-15" }), // USD 환산
    entry({ kind: "expense", category: "식비", amount: 50_000, date: "2026-05-31" }), // 다른 달
  ];

  it("월 prefix 필터 + 신용결제 제외 + USD 환산 + 재테크 통합 정의", () => {
    const s = computeLedgerSummary(ledger, 1400, "2026-06");
    expect(s.income).toBe(3_000_000);
    expect(s.expense).toBe(200_000 + 10 * 1400);
    expect(s.investing).toBe(100_000 + 500_000);
  });

  it("monthPrefix=null이면 전체 기간", () => {
    const s = computeLedgerSummary(ledger, 1400, null);
    expect(s.expense).toBe(200_000 + 10 * 1400 + 50_000);
  });

  it("excludedExpenseNames: 지출 박스 '제외 후' 합계 — subCategory/detailCategory/category로 매칭", () => {
    const withDataFee: LedgerEntry[] = [
      entry({ kind: "expense", category: "식비", amount: 200_000, date: "2026-06-10" }),
      entry({ kind: "expense", category: "지출", subCategory: "데이터비", amount: 30_000, date: "2026-06-11" }),
      entry({ kind: "expense", category: "지출", subCategory: "통신비", detailCategory: "데이터비", amount: 20_000, date: "2026-06-12" }),
    ];
    const s = computeLedgerSummary(withDataFee, 1400, "2026-06", undefined, undefined, ["데이터비"]);
    expect(s.expense).toBe(250_000);
    expect(s.excludedExpense).toBe(50_000); // 데이터비 = 30,000 + 20,000
    // 제외 후 지출 = 250,000 − 50,000 = 200,000
    expect(s.expense - s.excludedExpense).toBe(200_000);
  });

  it("excludedExpenseNames 미지정이면 excludedExpense=0", () => {
    const s = computeLedgerSummary(ledger, 1400, "2026-06");
    expect(s.excludedExpense).toBe(0);
  });
});
