import { describe, it, expect } from "vitest";
import {
  computeTransferSavingsRate,
  computeRealSavingsRate,
  isCarryOverIncomeEntry,
  computeMonthlyRealFlows,
} from "../utils/savingsRate";
import { generateComprehensiveMonthlyReport } from "../utils/reportGenerator";
import type { Account, LedgerEntry } from "../types";

function entry(o: Partial<LedgerEntry> & { id: string; amount: number }): LedgerEntry {
  return {
    date: "2026-01-15",
    kind: "expense",
    category: "기타",
    description: "",
    ...o,
  } as LedgerEntry;
}

describe("computeTransferSavingsRate (이체 기준 — 대시보드 SavingsRatioCard)", () => {
  it("수입 0 이하 → null (분모 0 방어)", () => {
    expect(computeTransferSavingsRate(0, 100_000)).toBeNull();
    expect(computeTransferSavingsRate(-1, 100_000)).toBeNull();
  });

  it("재테크 이체 / 수입 × 100", () => {
    expect(computeTransferSavingsRate(1_000_000, 300_000)).toBe(30);
    expect(computeTransferSavingsRate(1_000_000, 0)).toBe(0);
  });
});

describe("computeRealSavingsRate (실질 기준 — 인사이트·보고서)", () => {
  it("실질수입 0 이하 → null", () => {
    expect(computeRealSavingsRate(0, 100)).toBeNull();
    expect(computeRealSavingsRate(-100, 0)).toBeNull();
  });

  it("(실질수입 − 실질지출) / 실질수입 × 100 — 적자면 음수", () => {
    expect(computeRealSavingsRate(1_000_000, 600_000)).toBe(40);
    expect(computeRealSavingsRate(100, 150)).toBe(-50);
  });
});

describe("isCarryOverIncomeEntry", () => {
  it("'이월'·'원래 보유 자산' 정확 일치 + 부분일치 모두 매칭", () => {
    expect(isCarryOverIncomeEntry(entry({ id: "1", amount: 1, kind: "income", category: "이월" }))).toBe(true);
    expect(isCarryOverIncomeEntry(entry({ id: "2", amount: 1, kind: "income", subCategory: "원래 보유 자산" }))).toBe(true);
    expect(isCarryOverIncomeEntry(entry({ id: "3", amount: 1, kind: "income", subCategory: "3월 이월" }))).toBe(true);
    expect(isCarryOverIncomeEntry(entry({ id: "4", amount: 1, kind: "income", category: "보유 자산 정리" }))).toBe(true);
  });

  it("일반 수입은 매칭 안 됨", () => {
    expect(isCarryOverIncomeEntry(entry({ id: "1", amount: 1, kind: "income", subCategory: "급여" }))).toBe(false);
  });
});

describe("computeMonthlyRealFlows", () => {
  const NO_OPTS = { fxRate: null, dateAccountId: null } as const;

  it("이월 수입은 부분일치까지 완전 제외 (settlement/temp에도 안 잡힘)", () => {
    const flows = computeMonthlyRealFlows(
      [
        entry({ id: "1", amount: 1_000_000, kind: "income", subCategory: "급여" }),
        entry({ id: "2", amount: 500_000, kind: "income", subCategory: "3월 이월" }),
      ],
      NO_OPTS
    );
    const rf = flows.get("2026-01")!;
    expect(rf.realIncome).toBe(1_000_000);
    expect(rf.settlementTotal).toBe(0);
    expect(rf.tempIncomeTotal).toBe(0);
  });

  it("정산은 부분일치로 settlementTotal, 일시소득(용돈)은 tempIncomeTotal — 실질수입에서 제외", () => {
    const flows = computeMonthlyRealFlows(
      [
        entry({ id: "1", amount: 2_000_000, kind: "income", subCategory: "급여" }),
        entry({ id: "2", amount: 80_000, kind: "income", subCategory: "데이트정산" }),
        entry({ id: "3", amount: 50_000, kind: "income", subCategory: "용돈" }),
      ],
      NO_OPTS
    );
    const rf = flows.get("2026-01")!;
    expect(rf.settlementTotal).toBe(80_000);
    expect(rf.tempIncomeTotal).toBe(50_000);
    expect(rf.realIncome).toBe(2_000_000);
  });

  it("환전·신용결제·재테크(저축성지출 포함)는 실질지출 제외, 투자손실은 포함", () => {
    const flows = computeMonthlyRealFlows(
      [
        entry({ id: "1", amount: 100_000, category: "식비" }),
        entry({ id: "2", amount: 999_999, category: "환전" }),
        entry({ id: "3", amount: 888_888, category: "신용결제" }),
        entry({ id: "4", amount: 777_777, category: "재테크", subCategory: "저축" }),
        entry({ id: "5", amount: 666_666, category: "저축성지출" }),
        entry({ id: "6", amount: 30_000, category: "재테크", subCategory: "투자손실" }),
      ],
      NO_OPTS
    );
    expect(flows.get("2026-01")!.realExpense).toBe(100_000 + 30_000);
  });

  it("데이트 계좌 지출의 50%는 상대 부담분으로 차감", () => {
    const flows = computeMonthlyRealFlows(
      [
        entry({ id: "1", amount: 100_000, category: "데이트비", fromAccountId: "DATE" }),
        entry({ id: "2", amount: 40_000, category: "식비", fromAccountId: "A" }),
      ],
      { fxRate: null, dateAccountId: "DATE" }
    );
    const rf = flows.get("2026-01")!;
    expect(rf.dateAccountSpend).toBe(100_000);
    expect(rf.datePartnerShare).toBe(50_000);
    expect(rf.realExpense).toBe(140_000 - 50_000);
  });

  it("USD 항목은 환율로 정규화 — 정산 차감도 환산 금액 기준 (불일치 방지)", () => {
    const flows = computeMonthlyRealFlows(
      [
        entry({ id: "1", amount: 100, kind: "income", subCategory: "급여", currency: "USD" }),
        entry({ id: "2", amount: 10, kind: "income", subCategory: "정산", currency: "USD" }),
        entry({ id: "3", amount: 20, category: "식비", currency: "USD" }),
      ],
      { fxRate: 1_000, dateAccountId: null }
    );
    const rf = flows.get("2026-01")!;
    expect(rf.realIncome).toBe(100_000);
    expect(rf.settlementTotal).toBe(10_000);
    expect(rf.realExpense).toBe(20_000);
  });

  it("fxRate=null이면 raw 금액 폴백 (환산 없이 합산)", () => {
    const flows = computeMonthlyRealFlows(
      [
        entry({ id: "1", amount: 100, kind: "income", subCategory: "급여", currency: "USD" }),
        entry({ id: "2", amount: 20, category: "식비", currency: "USD" }),
      ],
      NO_OPTS
    );
    const rf = flows.get("2026-01")!;
    expect(rf.realIncome).toBe(100);
    expect(rf.realExpense).toBe(20);
  });

  it("월 버킷 분리 — 항목이 각자 발생 월에만 집계", () => {
    const flows = computeMonthlyRealFlows(
      [
        entry({ id: "1", amount: 1_000, kind: "income", subCategory: "급여", date: "2026-01-31" }),
        entry({ id: "2", amount: 2_000, kind: "income", subCategory: "급여", date: "2026-02-01" }),
        entry({ id: "3", amount: 500, category: "식비", date: "2026-02-15" }),
      ],
      NO_OPTS
    );
    expect(flows.get("2026-01")).toMatchObject({ realIncome: 1_000, realExpense: 0 });
    expect(flows.get("2026-02")).toMatchObject({ realIncome: 2_000, realExpense: 500 });
  });

  it("startMonth/endMonth 경계 — 범위 밖 skip, 경계 월 포함, date 없는 항목 skip", () => {
    const flows = computeMonthlyRealFlows(
      [
        entry({ id: "0", amount: 9_999, kind: "income", subCategory: "급여", date: "2025-12-31" }),
        entry({ id: "1", amount: 1_000, kind: "income", subCategory: "급여", date: "2026-01-01" }),
        entry({ id: "2", amount: 2_000, kind: "income", subCategory: "급여", date: "2026-02-28" }),
        entry({ id: "3", amount: 8_888, kind: "income", subCategory: "급여", date: "2026-03-01" }),
        entry({ id: "4", amount: 7_777, kind: "income", subCategory: "급여", date: "" }),
      ],
      { fxRate: null, dateAccountId: null, startMonth: "2026-01", endMonth: "2026-02" }
    );
    expect(flows.has("2025-12")).toBe(false);
    expect(flows.has("2026-03")).toBe(false);
    expect(flows.get("2026-01")!.realIncome).toBe(1_000);
    expect(flows.get("2026-02")!.realIncome).toBe(2_000);
    expect(flows.size).toBe(2);
  });
});

describe("generateComprehensiveMonthlyReport — 실질 저축률 = computeMonthlyRealFlows 동일월 값", () => {
  function acc(o: Partial<Account> & { id: string; name: string }): Account {
    return { type: "checking", institution: "", initialBalance: 0, ...o };
  }

  it("월별 realIncome/realExpense/realSavingsRate가 단일 소스와 일치 (실질수입 0 월은 null)", () => {
    const accounts = [acc({ id: "A", name: "주거래" }), acc({ id: "DATE", name: "데이트통장" })];
    const ledger: LedgerEntry[] = [
      // 1월: 급여 + 정산 + 데이트 지출 + 투자손실
      entry({ id: "1", amount: 2_000_000, kind: "income", subCategory: "급여", toAccountId: "A", date: "2026-01-05" }),
      entry({ id: "2", amount: 100_000, kind: "income", subCategory: "정산", toAccountId: "A", date: "2026-01-10" }),
      entry({ id: "3", amount: 500_000, category: "데이트비", fromAccountId: "DATE", date: "2026-01-12" }),
      entry({ id: "4", amount: 50_000, category: "재테크", subCategory: "투자손실", fromAccountId: "A", date: "2026-01-20" }),
      // 2월: 급여 + USD 지출
      entry({ id: "5", amount: 1_000_000, kind: "income", subCategory: "급여", toAccountId: "A", date: "2026-02-03" }),
      entry({ id: "6", amount: 300_000, category: "식비", fromAccountId: "A", date: "2026-02-08" }),
      entry({ id: "7", amount: 10, category: "식비", currency: "USD", fromAccountId: "A", date: "2026-02-09" }),
      // 3월: 지출만 (실질수입 0 → 저축률 null)
      entry({ id: "8", amount: 70_000, category: "식비", fromAccountId: "A", date: "2026-03-02" }),
    ];
    const fxRate = 1_300;
    const dateAccountId = "DATE";

    const report = generateComprehensiveMonthlyReport(ledger, [], accounts, "2026-01", "2026-03", fxRate, dateAccountId);
    const flows = computeMonthlyRealFlows(ledger, { fxRate, dateAccountId, startMonth: "2026-01", endMonth: "2026-03" });

    expect(report).toHaveLength(3);
    for (const row of report) {
      const rf = flows.get(row.month);
      expect(row.realIncome).toBe(rf?.realIncome ?? 0);
      expect(row.realExpense).toBe(rf?.realExpense ?? 0);
      expect(row.realNet).toBe(row.realIncome - row.realExpense);
      expect(row.realSavingsRate).toBe(computeRealSavingsRate(row.realIncome, row.realExpense));
    }
    // 스폿 체크: 1월 = (2,000,000) / (500,000×0.5 + 50,000)
    const jan = report[0];
    expect(jan.realIncome).toBe(2_000_000);
    expect(jan.realExpense).toBe(300_000);
    // 3월: 실질수입 0 → null
    expect(report[2].realSavingsRate).toBeNull();
  });
});
