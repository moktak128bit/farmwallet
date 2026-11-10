/**
 * 리포트 신뢰 수정 회귀 (실장부 감사 2026-11-10):
 *  - xirr 큰 손실 종목 이분법 폴백
 *  - 계좌 요약 변동률 분모 하한 / 증권 예수금 표시
 *  - 리포트 수입 게이트(대출·퇴직연금·이월 제외) 단일 소스
 *  - 투자 정산: 퇴직연금 이전은 원금(입금), 성과 아님
 *  - 종합 월간: 캐시백·기타수입은 근로소득 아님(부수입)
 */
import { describe, expect, it } from "vitest";
import type { Account, LedgerEntry } from "../types";
import { xirr } from "../utils/irr";
import {
  computeInvestmentReconciliation,
  generateAccountPerformanceBreakdown,
  generateAccountReport,
  generateComprehensiveMonthlyReport,
  generateConsumptionImpactMonthlyReport,
  generateMonthlyReport,
} from "../utils/reportGenerator";
import { isPrincipalLikeIncomeEntry, isReportIncomeEntry } from "../utils/reports/shared";

let seq = 0;
const e = (o: Partial<LedgerEntry> & { date: string; amount: number }): LedgerEntry => {
  seq += 1;
  return { id: `L${seq}`, kind: "expense", category: "지출", subCategory: "식비", description: "", ...o } as LedgerEntry;
};
const acc = (o: Partial<Account> & { id: string; type: Account["type"] }): Account =>
  ({ name: o.id, institution: "", initialBalance: 0, ...o } as Account);

describe("xirr — Newton 미수렴 시 이분법 폴백", () => {
  it("1년 뒤 원금의 10%만 남은 종목도 IRR −90%를 낸다 (예전엔 '-')", () => {
    const r = xirr([
      { date: "2025-01-01", amount: -1_000_000 },
      { date: "2026-01-01", amount: 100_000 },
    ], 0.1);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(-0.9, 2);
  });
});

describe("계좌 요약 — 변동률·예수금", () => {
  it("초기잔액이 10만 원 미만이면 변동률 null, 증권·코인은 예수금만이라는 표시", () => {
    const accounts = [acc({ id: "bank", type: "checking", initialBalance: 1 }), acc({ id: "sec", type: "securities", initialBalance: 1_000_000 })];
    const ledger = [e({ date: "2026-01-02", kind: "income", category: "수입", subCategory: "급여", amount: 264_606, toAccountId: "bank" })];
    const rows = generateAccountReport(accounts, ledger, []);
    expect(rows.find((r) => r.accountId === "bank")!.changeRate).toBeNull();
    expect(rows.find((r) => r.accountId === "sec")!.cashOnly).toBe(true);
    expect(rows.find((r) => r.accountId === "sec")!.changeRate).toBe(0);
  });
});

describe("리포트 수입 게이트 — 대출·퇴직연금·이월은 수입이 아니다", () => {
  const ledger = [
    e({ date: "2026-09-25", kind: "income", category: "수입", subCategory: "급여", amount: 3_000_000 }),
    e({ date: "2026-09-18", kind: "income", category: "수입", subCategory: "대출", amount: 20_000_000 }),
    e({ date: "2026-09-10", kind: "income", category: "수입", subCategory: "퇴직연금", amount: 4_252_080 }),
  ];
  it("isReportIncomeEntry", () => {
    expect(ledger.map(isReportIncomeEntry)).toEqual([true, false, false]);
  });
  it("월별 리포트·소비 영향 리포트 수입 = 급여만", () => {
    expect(generateMonthlyReport(ledger, "2026-09", "2026-09")[0].income).toBe(3_000_000);
    expect(generateConsumptionImpactMonthlyReport(ledger, [], "2026-09", "2026-09")[0].income).toBe(3_000_000);
  });
});

describe("투자 정산 — 퇴직연금 이전은 원금(입금)", () => {
  it("투자계좌로 들어온 퇴직연금은 입금으로 잡혀 총성과(평가액 − 순투입)에 섞이지 않는다", () => {
    const accounts = [acc({ id: "irp", type: "securities" })];
    const ledger = [e({ date: "2026-03-02", kind: "income", category: "수입", subCategory: "퇴직연금", amount: 4_252_080, toAccountId: "irp" })];
    expect(isPrincipalLikeIncomeEntry(ledger[0])).toBe(true);
    const perf = generateAccountPerformanceBreakdown(accounts, ledger, [], []);
    const rec = computeInvestmentReconciliation(accounts, ledger, [], [], perf);
    expect(rec.deposits).toBe(4_252_080);
    expect(rec.totalReturn).toBeCloseTo(0, 6);
    expect(rec.residualBreakdown.nonDividendIncome).toBe(0);
  });
});

describe("종합 월간 — 근로소득은 incomeClassification 단일 소스", () => {
  it("캐시백·기타수입은 부수입(otherIncome), 급여만 근로소득", () => {
    const ledger = [
      e({ date: "2026-10-25", kind: "income", category: "수입", subCategory: "급여", amount: 3_000_000 }),
      e({ date: "2026-10-05", kind: "income", category: "수입", subCategory: "캐시백", amount: 20_000 }),
      e({ date: "2026-10-06", kind: "income", category: "수입", subCategory: "기타수입", amount: 50_000 }),
    ];
    const [row] = generateComprehensiveMonthlyReport(ledger, [], [], "2026-10", "2026-10");
    expect(row.earnedIncome).toBe(3_000_000);
    expect(row.otherIncome).toBe(70_000);
  });
});
