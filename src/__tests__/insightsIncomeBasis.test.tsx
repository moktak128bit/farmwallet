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

/**
 * 인사이트 ↔ 대시보드 정의 통일 회귀 (2026-07-22 감사).
 * 예전 버그: ① USD를 환산 없이 원본 합산(투자이체 $1,000 → 1,000원) ② 지출 정의가
 * 문자열 하드코딩이라 저축성지출이 지출로 계상 + 투자손익이 지출/수입에 가산(확정 정책 위반)
 * ③ 전월 비교만 재테크 제외가 빠져 허위 개선률 표시.
 */
describe("인사이트 ↔ 대시보드 정의 통일", () => {
  it("USD 투자이체는 환율로 환산되어 재테크에 잡힌다", () => {
    const led = [
      entry({ id: "t1", amount: 1000, kind: "transfer", category: "이체", subCategory: "투자이체", currency: "USD", toAccountId: "sec1", date: "2026-01-05" }),
    ];
    const accts = [acct({ id: "sec1", name: "증권", type: "securities" })];
    const d = renderHook(() =>
      useInsightsData(led, [], [], accts, [], null, undefined, undefined, null, 1400, [], led)
    ).result.current;
    // 예전: 1,000원(액면) — 대시보드 140만원과 1,400배 어긋남
    expect(d.pInvest).toBe(1_400_000);
    expect(d.monthly["2026-01"].investment).toBe(1_400_000);
  });

  it("투자수익·투자손실은 수입/지출이 아니라 재테크 순액으로 (확정 정책)", () => {
    const led = [
      entry({ id: "inc", amount: 500_000, kind: "income", category: "수입", subCategory: "투자수익", date: "2026-01-10" }),
      entry({ id: "loss", amount: 300_000, kind: "expense", category: "재테크", subCategory: "투자손실", date: "2026-01-11" }),
      entry({ id: "food", amount: 100_000, kind: "expense", category: "지출", subCategory: "식비", date: "2026-01-12" }),
    ];
    const d = renderHook(() =>
      useInsightsData(led, [], [], accounts, [], null, undefined, undefined, null, null, [], led)
    ).result.current;
    expect(d.pExpense).toBe(100_000);          // 투자손실 미포함 (예전: 40만)
    expect(d.pIncome).toBe(0);                  // 투자수익 미포함 (예전: 50만)
    expect(d.pInvest).toBe(500_000 - 300_000);  // 재테크 순액 +20만
  });

  it("저축성지출은 지출이 아니라 재테크로 (대시보드 classifyLedgerFlow와 동일)", () => {
    const led = [
      entry({ id: "sav", amount: 500_000, kind: "expense", category: "저축성지출", date: "2026-01-10" }),
      entry({ id: "food", amount: 1_000_000, kind: "expense", category: "지출", subCategory: "식비", date: "2026-01-12" }),
    ];
    const d = renderHook(() =>
      useInsightsData(led, [], [], accounts, [], null, undefined, undefined, null, null, [], led)
    ).result.current;
    expect(d.pExpense).toBe(1_000_000);  // 예전: 150만 (저축성지출 포함)
    expect(d.pInvest).toBe(500_000);
  });

  it("전월 비교는 당월과 같은 기준 — 레거시 재테크 저축이 전월 지출에 섞이지 않는다", () => {
    const led = [
      // 전월(1월): 소비 150만 + 레거시 재테크 저축 200만
      entry({ id: "e1", amount: 1_500_000, kind: "expense", category: "지출", subCategory: "식비", date: "2026-01-15" }),
      entry({ id: "s1", amount: 2_000_000, kind: "expense", category: "재테크", subCategory: "저축", date: "2026-01-20" }),
      // 당월(2월): 소비 150만
      entry({ id: "e2", amount: 1_500_000, kind: "expense", category: "지출", subCategory: "식비", date: "2026-02-15" }),
    ];
    const d = renderHook(() =>
      useInsightsData(led, [], [], accounts, [], "2026-02", undefined, undefined, null, null, [], led)
    ).result.current;
    // 예전: prev.expense = 350만 → "-57% 개선" 허위 배지. 실제 변화 없음(150만 = 150만).
    expect(d.prev?.expense).toBe(1_500_000);
    expect(d.pExpense).toBe(1_500_000);
  });
});
