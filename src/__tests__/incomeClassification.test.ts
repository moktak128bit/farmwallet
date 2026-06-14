import { describe, it, expect } from "vitest";
import { computeIncomeNatureKeys } from "../utils/incomeClassification";
import { computeLedgerSummary } from "../features/dashboard/summaryMath";
import { computeRealIncome, classifyIncomeNature } from "../utils/realIncome";
import type { Account, LedgerEntry } from "../types";

function entry(o: Partial<LedgerEntry> & { id: string; amount: number }): LedgerEntry {
  return { date: "2026-01-15", kind: "income", category: "수입", description: "", ...o } as LedgerEntry;
}
function acct(o: Partial<Account> & { id: string; name: string }): Account {
  return { institution: "", type: "checking", initialBalance: 0, ...o } as Account;
}

const MONTHS = ["2026-01", "2026-02", "2026-03"];

describe("computeIncomeNatureKeys — 근로소득/패시브 자동 감지 (인사이트·대시보드 공용)", () => {
  // 급여·프리랜서는 매월(3/3), 배당·캐시백도 매월, 정산은 1회, 보너스금은 1회.
  // 분배금은 증권계좌 입금(투자 계좌 기반 패시브 감지 경로).
  const ledger: LedgerEntry[] = [
    ...MONTHS.map((m, i) => entry({ id: `sal${i}`, amount: 3_000_000, subCategory: "급여", date: `${m}-25` })),
    ...MONTHS.map((m, i) => entry({ id: `free${i}`, amount: 500_000, subCategory: "프리랜서", date: `${m}-20` })),
    ...MONTHS.map((m, i) => entry({ id: `div${i}`, amount: 100_000, subCategory: "배당", date: `${m}-10` })),
    ...MONTHS.map((m, i) => entry({ id: `cash${i}`, amount: 5_000, subCategory: "캐시백", date: `${m}-11` })),
    entry({ id: "settle", amount: 400_000, subCategory: "정산", date: "2026-02-05" }),
    entry({ id: "bonusOnce", amount: 200_000, subCategory: "보너스금", date: "2026-02-06" }),
    entry({ id: "dist", amount: 80_000, subCategory: "분배금", date: "2026-03-15", toAccountId: "sec1" }),
  ];
  const accounts = [acct({ id: "sec1", name: "증권", type: "securities" })];

  it("근로소득: 매월 등장 중분류 + 명시 급여 — 단, 비근로 목록은 제외", () => {
    const { salaryKeys } = computeIncomeNatureKeys(ledger, accounts);
    expect(salaryKeys.has("급여")).toBe(true);       // ALWAYS_SALARY
    expect(salaryKeys.has("프리랜서")).toBe(true);   // 3/3개월 빈도 감지
    expect(salaryKeys.has("배당")).toBe(false);      // NEVER_SALARY
    expect(salaryKeys.has("캐시백")).toBe(false);    // 매월 등장해도 NEVER_SALARY
    expect(salaryKeys.has("정산")).toBe(false);      // 비실질
    expect(salaryKeys.has("보너스금")).toBe(false);  // 1회 발생 → 빈도 미달
  });

  it("패시브: 명시 배당 + 투자계좌 입금 중분류, 급여성은 제외", () => {
    const { investIncKeys } = computeIncomeNatureKeys(ledger, accounts);
    expect(investIncKeys.has("배당")).toBe(true);    // ALWAYS_INVEST_INCOME
    expect(investIncKeys.has("분배금")).toBe(true);  // 증권계좌 입금 감지
    expect(investIncKeys.has("급여")).toBe(false);
  });
});

describe("computeLedgerSummary — salaryKeys 지정 시 수입 = 근로소득", () => {
  const ledger: LedgerEntry[] = [
    entry({ id: "sal", amount: 3_000_000, subCategory: "급여", date: "2026-02-25" }),
    entry({ id: "div", amount: 100_000, subCategory: "배당", date: "2026-02-10" }),
    entry({ id: "settle", amount: 500_000, subCategory: "정산", date: "2026-02-05" }),
    entry({ id: "food", amount: 1_000_000, kind: "expense", category: "식비", date: "2026-02-15" }),
  ];
  const salaryKeys = new Set(["급여"]);

  it("salaryKeys 미지정(레거시) → 모든 income 합산 (하위호환)", () => {
    const s = computeLedgerSummary(ledger, null, "2026-02", undefined);
    expect(s.income).toBe(3_600_000); // 급여300 + 배당10 + 정산50
    expect(s.expense).toBe(1_000_000);
  });

  it("salaryKeys 지정 → 근로소득만 (정산·배당 제외)", () => {
    const s = computeLedgerSummary(ledger, null, "2026-02", undefined, salaryKeys);
    expect(s.income).toBe(3_000_000); // 급여만
    expect(s.expense).toBe(1_000_000); // 지출은 영향 없음
  });
});

describe("computeIncomeNatureKeys — 사용자 지정(override)이 자동감지를 덮어씀", () => {
  const ledger: LedgerEntry[] = [
    entry({ id: "s1", amount: 3_000_000, subCategory: "본봉", date: "2026-01-25" }), // 1회 → 빈도 미달
    entry({ id: "x1", amount: 200_000, subCategory: "부수입", date: "2026-01-10" }),
    entry({ id: "x2", amount: 200_000, subCategory: "부수입", date: "2026-02-10" }), // 2/2개월 → 자동 근로소득
  ];

  it("salary 지정 → 빈도로는 못 잡는 카테고리도 근로소득", () => {
    const { salaryKeys } = computeIncomeNatureKeys(ledger, [], { salary: ["본봉"] });
    expect(salaryKeys.has("본봉")).toBe(true);
  });

  it("nonRealIncome 지정 → 자동 근로소득이던 카테고리도 양쪽에서 제외", () => {
    expect(computeIncomeNatureKeys(ledger, []).salaryKeys.has("부수입")).toBe(true); // 자동 감지
    const ov = computeIncomeNatureKeys(ledger, [], { nonRealIncome: ["부수입"] });
    expect(ov.salaryKeys.has("부수입")).toBe(false);
    expect(ov.investIncKeys.has("부수입")).toBe(false);
  });

  it("passive 지정 → investIncKeys로 이동, salaryKeys에서 제외", () => {
    const { salaryKeys, investIncKeys } = computeIncomeNatureKeys(ledger, [], { passive: ["부수입"] });
    expect(investIncKeys.has("부수입")).toBe(true);
    expect(salaryKeys.has("부수입")).toBe(false);
  });
});

describe("computeRealIncome — 사용자 비실질(extraNonReal) 실질수입 제외", () => {
  const fInc: LedgerEntry[] = [
    entry({ id: "s", amount: 3_000_000, subCategory: "급여" }),
    entry({ id: "p", amount: 500_000, subCategory: "부모님지원" }), // 하드코딩 비실질 아님
  ];

  it("미지정: 부모님지원은 실질수입에 포함", () => {
    expect(computeRealIncome(fInc, 3_500_000).realIncome).toBe(3_500_000);
  });

  it("extraNonReal 지정 시 실질수입에서 제외", () => {
    const r = computeRealIncome(fInc, 3_500_000, new Set(["부모님지원"]));
    expect(r.realIncome).toBe(3_000_000);
    expect(r.tempIncomeTotal).toBe(500_000);
  });
});

describe("classifyIncomeNature — 키(자동+지정)가 하드코딩 기본보다 우선", () => {
  it("nonRealKeys로 지정한 카테고리는 비실질(일시)", () => {
    expect(classifyIncomeNature("부수입", { nonRealKeys: new Set(["부수입"]) })).toBe("일시");
  });
  it("기본 분류는 그대로 (정산→환급, 용돈→일시, 대출→부채)", () => {
    expect(classifyIncomeNature("정산")).toBe("환급");
    expect(classifyIncomeNature("용돈")).toBe("일시");
    expect(classifyIncomeNature("대출")).toBe("부채");
  });
});
