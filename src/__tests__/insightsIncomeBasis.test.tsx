// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
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

  it("divTrend(패시브 시리즈)는 패시브 KPI와 같은 모집단 — 투자수익이 배당률을 부풀리지 않는다", () => {
    const led = [
      entry({ id: "d1", amount: 100_000, kind: "income", category: "수입", subCategory: "배당", date: "2026-01-10" }),
      entry({ id: "i1", amount: 50_000, kind: "income", category: "수입", subCategory: "이자", date: "2026-01-11" }),
      entry({ id: "pnl", amount: 1_000_000, kind: "income", category: "수입", subCategory: "투자수익", date: "2026-01-12" }),
    ];
    const d = renderHook(() =>
      useInsightsData(led, [], [], accounts, [], null, undefined, undefined, null, null, [], led)
    ).result.current;
    // 예전: divTrend가 투자수익 100만을 포함 → '배당/이자 수입' KPI·연환산 배당률이 7.7배 부풀고
    // 같은 화면의 패시브 KPI(passiveIncome, 15만)와 어긋났다.
    expect(d.divTrend[0].amount).toBe(150_000);
    expect(d.passiveIncome).toBe(150_000);
    expect(d.pInvest).toBe(1_000_000); // 투자수익은 재테크 순집계로만
  });

  it("퇴직연금(제외 수입)이 투자계좌로 들어와도 divTrend에 잡히지 않는다", () => {
    const led = [
      entry({ id: "d1", amount: 100_000, kind: "income", category: "수입", subCategory: "배당", date: "2026-01-10", toAccountId: "sec1" }),
      entry({ id: "pens", amount: 500_000, kind: "income", category: "수입", subCategory: "퇴직연금", date: "2026-01-15", toAccountId: "sec1" }),
    ];
    const accts = [acct({ id: "sec1", name: "증권", type: "securities" })];
    const d = renderHook(() =>
      useInsightsData(led, [], [], accts, [], null, undefined, undefined, null, null, [], led)
    ).result.current;
    // 퇴직연금은 자동감지로 investIncKeys에 편입될 수 있지만, 모든 수입 지표에서 제외되는 돈이
    // 배당/이자 차트에만 나타나면 안 된다 (isExcludedIncomeEntry 게이트).
    expect(d.divTrend[0].amount).toBe(100_000);
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

/**
 * 인사이트 감사 2026-10-02 (I2~I10) 회귀.
 * 진행 중인 달 의존 항목은 KST 2026-10-02 12:00으로 시계를 고정한다.
 */
describe("인사이트 감사 2026-10-02", () => {
  const TODAY = new Date("2026-10-02T03:00:00Z"); // KST 2026-10-02 12:00
  const freeze = () => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(TODAY); };
  afterEach(() => { vi.useRealTimers(); });
  const exp = (id: string, amount: number, date: string, o: Partial<LedgerEntry> = {}) =>
    entry({ id, amount, date, kind: "expense", category: "지출", subCategory: "식비", ...o });
  const run = (led: LedgerEntry[], sel: string | null = null, accts = accounts, all = led) =>
    renderHook(() => useInsightsData(led, [], [], accts, [], sel, undefined, undefined, null, 1400, [], all)).result.current;

  it("I2 지출 관성 — 진행 중인 달 기준선도 USD 환산·환전/투자손실 제외 (같은 소비면 0%)", () => {
    freeze();
    const led = [
      ...["2026-07", "2026-08", "2026-09", "2026-10"].flatMap((m, i) => [
        exp(`f${i}`, 100_000, `${m}-01`),
        exp(`u${i}`, 100, `${m}-02`, { currency: "USD", subCategory: "쇼핑" }),
      ]),
      exp("fx", 500_000, "2026-08-01", { subCategory: "환전" }),
      exp("loss", 300_000, "2026-09-01", { category: "재테크", subCategory: "투자손실" }),
    ];
    const si = run(led).spendingInertia!;
    expect(si.partialDay).toBe(2);
    expect(si.curExp).toBe(240_000);
    expect(si.avg).toBe(240_000);
    expect(si.deviation).toBe(0);
  });

  it("I3 환전 쌍의 도착 다리·투자계좌 간 이체는 재테크(증권 유입)가 아니다", () => {
    const accts = [acct({ id: "a1", name: "급여통장" }), acct({ id: "sec", name: "해외증권", type: "securities" }), acct({ id: "sec2", name: "국내증권", type: "securities" })];
    const led = [
      entry({ id: "sal", amount: 3_000_000, kind: "income", category: "수입", subCategory: "급여", date: "2026-01-25" }),
      // 해외증권 안에서 ₩1,450,000 → $1,000 (FxFormSection 쌍: -from엔 출발만, -to엔 도착만)
      entry({ id: "fx1-from", amount: 1_450_000, kind: "transfer", category: "이체", subCategory: "환전이체", fromAccountId: "sec", date: "2026-01-10" }),
      entry({ id: "fx1-to", amount: 1000, currency: "USD", kind: "transfer", category: "이체", subCategory: "환전이체", toAccountId: "sec", date: "2026-01-10" }),
      entry({ id: "mv", amount: 500_000, kind: "transfer", category: "이체", subCategory: "계좌이체", fromAccountId: "sec", toAccountId: "sec2", date: "2026-01-11" }),
    ];
    const d = run(led, null, accts);
    expect(d.pInvest).toBe(0);
    expect(d.monthly["2026-01"].investment).toBe(0);
    expect(d.investTrend[0].amount).toBe(0);
    expect(d.netCashFlow).toBe(3_000_000);
    // 은행 → 증권 환전(다른 계좌 모드)·일반 입금은 여전히 증권 유입
    const led2 = [
      entry({ id: "fx2-from", amount: 1_400_000, kind: "transfer", category: "이체", subCategory: "환전이체", fromAccountId: "a1", date: "2026-01-10" }),
      entry({ id: "fx2-to", amount: 1000, currency: "USD", kind: "transfer", category: "이체", subCategory: "환전이체", toAccountId: "sec", date: "2026-01-10" }),
      entry({ id: "dep", amount: 200_000, kind: "transfer", category: "이체", subCategory: "계좌이체", fromAccountId: "a1", toAccountId: "sec", date: "2026-01-12" }),
    ];
    expect(run(led2, null, accts).pInvest).toBe(1_600_000);
  });

  it("I4 이상감지·카테고리 성장률·단건 이상치는 USD를 원화로 환산해 비교한다", () => {
    const led = [
      exp("s1", 100_000, "2026-01-05", { subCategory: "쇼핑" }),
      exp("s2", 120_000, "2026-02-05", { subCategory: "쇼핑" }),
      exp("s3", 110_000, "2026-03-05", { subCategory: "쇼핑" }),
      ...Array.from({ length: 9 }, (_, i) => exp(`a${i}`, 10_000, `2026-04-0${i + 1}`, { subCategory: "쇼핑" })),
      exp("usd", 1000, "2026-04-10", { subCategory: "쇼핑", currency: "USD" }), // ₩1,400,000
    ];
    const d = run(led, "2026-04");
    expect(d.topAnomaly?.category).toBe("쇼핑");
    expect(d.topAnomaly?.currentMonthAmount).toBe(1_490_000);
    expect(d.categoryGrowth.up.find((r) => r.sub === "쇼핑")?.cur).toBe(1_490_000);
    expect(d.entryOutliers[0].amount).toBe(1_400_000);
  });

  it("I6 이번 달을 고르면 '전월 대비'는 전월 동기(1~오늘 일)와 비교", () => {
    freeze();
    const led = [
      exp("p1", 50_000, "2026-09-01"),
      exp("p2", 900_000, "2026-09-20"),
      entry({ id: "ps", amount: 3_000_000, kind: "income", category: "수입", subCategory: "급여", date: "2026-09-25" }),
      exp("c1", 50_000, "2026-10-01"),
    ];
    const cur = run(led, "2026-10").prev!;
    expect(cur.partialDay).toBe(2);
    expect(cur.expense).toBe(50_000);   // 예전: 950,000 → "지출 감소 — 좋은 흐름" 허위
    expect(cur.salary).toBe(0);         // 예전: 3,000,000 → "근로소득 −100%"
  });

  it("I7 누적 지출 곡선(cumSpend)은 monthly 지출과 같은 분류 — 레거시 신용결제·투자손실·저축성지출 제외, USD 환산", () => {
    const led = [
      exp("f", 100_000, "2026-01-03"),
      exp("u", 10, "2026-01-04", { currency: "USD" }),
      entry({ id: "cc", amount: 400_000, kind: "expense", category: "신용결제", date: "2026-01-25" }),
      exp("loss", 50_000, "2026-01-26", { category: "재테크", subCategory: "투자손실" }),
      entry({ id: "sav", amount: 200_000, kind: "expense", category: "저축성지출", date: "2026-01-27" }),
    ];
    const d = run(led);
    expect(d.cumSpend["2026-01"][30]).toBe(114_000);
    expect(d.cumSpend["2026-01"][30]).toBe(d.monthly["2026-01"].expense);
  });

  it("I8 재정 활주로 월평균 지출은 완결 월만 — 진행 중인 달·기간 필터로 잘린 첫 달 제외", () => {
    freeze();
    const all = [
      exp("j1", 500_000, "2026-07-03"),
      exp("j2", 500_000, "2026-07-20"),
      exp("a", 1_000_000, "2026-08-10"),
      exp("s", 1_000_000, "2026-09-10"),
      exp("o", 100_000, "2026-10-01"),
    ];
    expect(run(all).avgMonthExp).toBe(1_000_000);            // 예전: 3.1M/4 = 775,000
    const filtered = all.filter((l) => l.date >= "2026-07-15"); // 기간 필터 cutoff 07-15
    expect(run(filtered, null, accounts, all).avgMonthExp).toBe(1_000_000); // 예전: 2.6M/4 = 650,000
  });

  it("I10 실질 수입이 0이면 저축률은 0%가 아니라 N/A(null)", () => {
    const d = run([exp("e", 100_000, "2026-01-10")]);
    expect(d.realSavRate).toBeNull();
    expect(d.savRateTrend[0].rate).toBeNull();
    expect(d.savRateTrend[0].cumRate).toBeNull();
  });
});
