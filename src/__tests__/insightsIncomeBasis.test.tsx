import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useInsightsData } from "../features/insights/useInsightsData";
import type { Account, LedgerEntry } from "../types";

/**
 * 인사이트 "수입" 3종 정의가 정확히 갈리는지 고정하는 회귀 테스트.
 *  - 장부 수입(pIncome): kind=income 전부 (이월 제외)
 *  - 실질 수입(realIncome): 장부 − 정산 − 일시소득(용돈 등)  → 배당·이자는 포함
 *  - 근로소득(pSalary/salaryMonthly): 월급·수당·상여만        → 배당·정산·용돈 전부 제외
 *
 * 수입 추세·흐름·지표(incomeStability·incomeGrowth·cumIE·netCashFlow·expToIncRatio)는
 * 근로소득 기준이어야 한다 — 정산·용돈·배당이 섞여도 결과가 흔들리지 않는지 검증.
 */

function entry(o: Partial<LedgerEntry> & { id: string; amount: number }): LedgerEntry {
  return { date: "2026-01-15", kind: "expense", category: "기타", description: "", ...o } as LedgerEntry;
}
function acct(o: Partial<Account> & { id: string; name: string }): Account {
  return { institution: "", type: "checking", initialBalance: 0, ...o } as Account;
}

// 3개월(2026-01~03, 모두 완결 월 — 현재월 아님)에 걸친 픽스처.
// 급여는 매월 300만 고정, 배당은 매월 10만, 정산·용돈은 2월에만 발생.
const MONTHS = ["2026-01", "2026-02", "2026-03"];
const ledger: LedgerEntry[] = [
  ...MONTHS.map((m, i) => entry({ id: `sal${i}`, amount: 3_000_000, kind: "income", category: "수입", subCategory: "급여", date: `${m}-25` })),
  ...MONTHS.map((m, i) => entry({ id: `div${i}`, amount: 100_000, kind: "income", category: "수입", subCategory: "배당", date: `${m}-10` })),
  entry({ id: "settle", amount: 500_000, kind: "income", category: "수입", subCategory: "정산", date: "2026-02-05" }),
  entry({ id: "allow", amount: 200_000, kind: "income", category: "수입", subCategory: "용돈", date: "2026-02-06" }),
  ...MONTHS.map((m, i) => entry({ id: `exp${i}`, amount: 1_000_000, kind: "expense", category: "식비", subCategory: "외식", date: `${m}-15` })),
];
const accounts = [acct({ id: "a1", name: "급여통장" })];

function render() {
  return renderHook(() =>
    // (ledger, rawTrades, allTrades, accounts, prices, selMonth, presets, budgetGoals, dateAccountId, fxRate, timelineRows, allLedger)
    useInsightsData(ledger, [], [], accounts, [], null, undefined, undefined, null, null, [], ledger)
  ).result.current;
}

describe("인사이트 수입 3종 정의", () => {
  it("장부 > 실질 > 근로소득 순으로 정확히 분리된다", () => {
    const d = render();
    // 장부 = 급여900 + 배당30 + 정산50 + 용돈20 = 1,000만
    expect(d.pIncome).toBe(10_000_000);
    // 실질 = 장부 − 정산50 − 용돈20 = 930만 (배당은 실질에 포함)
    expect(d.realIncome).toBe(9_300_000);
    // 근로소득 = 급여만 = 900만 (배당·정산·용돈 전부 제외)
    expect(d.pSalary).toBe(9_000_000);
  });

  it("salaryMonthly는 정산·용돈이 낀 달에도 급여만 잡는다", () => {
    const d = render();
    // 2월은 정산·용돈이 추가됐지만 근로소득은 그대로 300만
    expect(d.salaryMonthly["2026-02"]).toBe(3_000_000);
    expect(MONTHS.every((m) => d.salaryMonthly[m] === 3_000_000)).toBe(true);
  });
});

describe("수입 추세·지표는 근로소득 기준", () => {
  it("근로소득 안정성 — 급여 고정이면 100% (장부 기준이면 2월 변동으로 낮아짐)", () => {
    const d = render();
    expect(d.incomeStability).toBe(100);
  });

  it("성장률 MoM — 급여 동일이면 0% (장부 기준이면 2월 정산 때문에 음수)", () => {
    const d = render();
    expect(d.incomeGrowth.mom).toBe(0);
  });

  it("누적수입 마지막 값 = 누적 근로소득(900만), 누적 장부(1,000만) 아님", () => {
    const d = render();
    expect(d.cumIE[d.cumIE.length - 1]["누적수입"]).toBe(9_000_000);
  });

  it("순현금흐름·지출비율 분모는 근로소득", () => {
    const d = render();
    // 순현금흐름 = 근로소득900 − 지출300 − 투자0 = 600만
    expect(d.netCashFlow).toBe(6_000_000);
    // 지출/근로소득 = 300 / 900 = 33.3%
    expect(d.expToIncRatio).toBeCloseTo(33.33, 1);
  });
});
