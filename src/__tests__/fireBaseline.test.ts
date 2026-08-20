/**
 * FIRE 기준선(buildFireBaseline) 테스트 — 창(완료월만)·투자손익 제외·USD 환산·고정비 단일소스 동일값·
 * 12개월 환산 분모·기대수익률 캡/플로어/기본값·배당수익률.
 */
import { describe, expect, it } from "vitest";
import {
  buildFireBaseline,
  fireBaselineWindow,
  DEFAULT_RETURN_PCT,
  RETURN_CAP_PCT,
  RETURN_FLOOR_PCT,
} from "../utils/fireBaseline";
import { computeExpenseNatureSeries } from "../utils/fixedExpense";
import type { CategoryPresets, LedgerEntry } from "../types";

const presets: CategoryPresets = {
  income: ["급여", "배당", "투자수익"],
  expense: ["식비", "주거비", "통신비", "재테크"],
  transfer: ["저축이체", "투자이체", "계좌이체", "카드결제이체"],
  expenseDetails: [
    { main: "식비", subs: ["시장/마트", "외식/배달"] },
    { main: "주거비", subs: ["월세", "관리비"] },
    { main: "통신비", subs: ["핸드폰"] },
    { main: "재테크", subs: ["투자손실"] },
  ],
  categoryTypes: {
    fixed: ["주거비", "통신비"],
    savings: [],
    transfer: ["저축이체", "투자이체", "계좌이체", "카드결제이체"],
  },
};

let seq = 0;
function entry(o: Partial<LedgerEntry> & { amount: number; date: string }): LedgerEntry {
  seq += 1;
  return {
    id: `L${seq}`,
    kind: "expense",
    category: "지출",
    subCategory: "식비",
    detailCategory: "시장/마트",
    description: "",
    fromAccountId: "A1",
    ...o,
  } as LedgerEntry;
}

const TODAY = "2026-08-21";
/** 창 = 2025-08 ~ 2026-07 (12개 완료월) */
const WINDOW = fireBaselineWindow(TODAY, 12);

/** 창의 모든 달에 같은 패턴을 깐다 */
function everyMonth(make: (month: string) => LedgerEntry[]): LedgerEntry[] {
  return WINDOW.flatMap((m) => make(m));
}

describe("fireBaselineWindow", () => {
  it("이번 달을 제외한 직전 N개 완료월을 오름차순으로 만든다 (연도 경계 포함)", () => {
    expect(WINDOW).toHaveLength(12);
    expect(WINDOW[0]).toBe("2025-08");
    expect(WINDOW[11]).toBe("2026-07");
    expect(fireBaselineWindow("2026-01-05", 3)).toEqual(["2025-10", "2025-11", "2025-12"]);
  });
});

describe("buildFireBaseline — 월 저축(재테크 유입)", () => {
  it("저축·투자이체 transfer 월평균이며 투자수익/투자손실(실현손익)은 제외한다", () => {
    const ledger = [
      ...everyMonth((m) => [
        entry({ date: `${m}-25`, kind: "transfer", category: "이체", subCategory: "저축이체", amount: 1_000_000, toAccountId: "S1" }),
        entry({ date: `${m}-25`, kind: "transfer", category: "이체", subCategory: "투자이체", amount: 500_000, toAccountId: "B1" }),
        entry({ date: `${m}-10`, amount: 300_000 }),
      ]),
      // 실현손익 — 이미 순자산에 반영된 결과이므로 '넣은 돈'이 아니다
      entry({ date: "2026-03-15", kind: "income", category: "수입", subCategory: "투자수익", amount: 5_000_000, toAccountId: "B1" }),
      entry({ date: "2026-04-15", kind: "expense", category: "재테크", subCategory: "투자손실", amount: 2_000_000 }),
      // 일반 계좌이체는 재테크가 아님
      entry({ date: "2026-05-02", kind: "transfer", category: "이체", subCategory: "계좌이체", amount: 9_000_000, toAccountId: "A2" }),
    ];
    const b = buildFireBaseline({ ledger, todayIso: TODAY, categoryPresets: presets, fxRate: 1400, netWorthKRW: 100_000_000 });
    expect(b.coveredMonths).toBe(12);
    expect(b.monthlySavingKRW).toBeCloseTo(1_500_000, 6);
    // 실질 지출은 식비 30만 × 12 — 투자손실 200만은 생활비가 아니므로(순자산에 이미 반영) 제외
    expect(b.annualRealExpense).toBeCloseTo(3_600_000, 6);
  });

  it("이번 달(진행 중)과 창 밖의 항목은 무시한다", () => {
    const ledger = [
      ...everyMonth((m) => [entry({ date: `${m}-25`, kind: "transfer", category: "이체", subCategory: "저축이체", amount: 1_000_000, toAccountId: "S1" })]),
      entry({ date: "2026-08-01", kind: "transfer", category: "이체", subCategory: "저축이체", amount: 50_000_000, toAccountId: "S1" }),
      entry({ date: "2025-07-31", kind: "transfer", category: "이체", subCategory: "저축이체", amount: 50_000_000, toAccountId: "S1" }),
      entry({ date: "2026-08-01", amount: 50_000_000 }),
    ];
    const b = buildFireBaseline({ ledger, todayIso: TODAY, categoryPresets: presets, fxRate: null, netWorthKRW: 0 });
    expect(b.monthlySavingKRW).toBeCloseTo(1_000_000, 6);
    expect(b.annualRealExpense).toBe(0);
  });
});

describe("buildFireBaseline — 지출·USD·12개월 환산", () => {
  it("USD 지출은 환율로 환산해 연 실질 지출에 넣는다", () => {
    const ledger = everyMonth((m) => [
      entry({ date: `${m}-10`, amount: 100, currency: "USD" }),
      entry({ date: `${m}-11`, amount: 10_000 }),
    ]);
    const b = buildFireBaseline({ ledger, todayIso: TODAY, categoryPresets: presets, fxRate: 1400, netWorthKRW: 0 });
    expect(b.annualRealExpense).toBeCloseTo((140_000 + 10_000) * 12, 6);
  });

  it("장부가 창의 일부(3개월)만 있으면 그 달 수로 나눠 12개월 환산한다", () => {
    const ledger = ["2026-05", "2026-06", "2026-07"].map((m) => entry({ date: `${m}-10`, amount: 200_000 }));
    const b = buildFireBaseline({ ledger, todayIso: TODAY, categoryPresets: presets, fxRate: null, netWorthKRW: 0 });
    expect(b.coveredMonths).toBe(3);
    expect(b.annualRealExpense).toBeCloseTo(200_000 * 12, 6);
  });

  it("장부가 없으면 모두 0이고 coveredMonths 0", () => {
    const b = buildFireBaseline({ ledger: [], todayIso: TODAY, categoryPresets: presets, fxRate: null, netWorthKRW: 1 });
    expect(b.coveredMonths).toBe(0);
    expect(b.annualRealExpense).toBe(0);
    expect(b.annualFixedExpense).toBe(0);
    expect(b.monthlySavingKRW).toBe(0);
  });

  it("고정비는 fixedExpense.computeExpenseNatureSeries와 같은 값(단일 소스)이며 실질 지출에 포함된다", () => {
    const ledger = everyMonth((m) => [
      entry({ date: `${m}-01`, subCategory: "주거비", detailCategory: "월세", amount: 600_000 }),
      entry({ date: `${m}-05`, subCategory: "통신비", detailCategory: "핸드폰", amount: 50, currency: "USD" }),
      entry({ date: `${m}-12`, subCategory: "식비", detailCategory: "외식/배달", amount: 150_000 }),
    ]);
    const fx = 1400;
    const series = computeExpenseNatureSeries(ledger, WINDOW, presets, fx);
    const fixedSum = WINDOW.reduce((s, m) => s + series[m].fixed, 0);
    const b = buildFireBaseline({ ledger, todayIso: TODAY, categoryPresets: presets, fxRate: fx, netWorthKRW: 0 });
    expect(b.annualFixedExpense).toBeCloseTo(fixedSum, 6);
    expect(b.annualFixedExpense).toBeCloseTo((600_000 + 70_000) * 12, 6);
    expect(b.annualRealExpense).toBeCloseTo((600_000 + 70_000 + 150_000) * 12, 6);
    expect(b.annualFixedExpense).toBeLessThanOrEqual(b.annualRealExpense);
  });
});

describe("buildFireBaseline — 기대수익률·배당수익률", () => {
  const base = { ledger: [] as LedgerEntry[], todayIso: TODAY, categoryPresets: presets, fxRate: 1400 };

  it("TWR + 배당수익률(순자산 대비)을 더하고 출처를 twr로 표시한다", () => {
    const b = buildFireBaseline({ ...base, netWorthKRW: 100_000_000, twrAnnualPct: 6, dividendAnnualKRW: 2_000_000 });
    expect(b.dividendYieldPct).toBeCloseTo(2, 9);
    expect(b.expectedReturnPct).toBeCloseTo(8, 9);
    expect(b.returnSource).toBe("twr");
  });

  it("TWR이 없으면 기본값(DEFAULT_RETURN_PCT)을 쓰고 출처는 default", () => {
    const b = buildFireBaseline({ ...base, netWorthKRW: 100_000_000, twrAnnualPct: null, dividendAnnualKRW: 1_000_000 });
    expect(b.returnSource).toBe("default");
    expect(b.expectedReturnPct).toBeCloseTo(DEFAULT_RETURN_PCT + 1, 9);
  });

  it("상한/하한으로 클램프한다 (단기 TWR 급등·급락의 장기 투영 방지)", () => {
    expect(buildFireBaseline({ ...base, netWorthKRW: 1, twrAnnualPct: 48 }).expectedReturnPct).toBe(RETURN_CAP_PCT);
    expect(buildFireBaseline({ ...base, netWorthKRW: 1, twrAnnualPct: -33 }).expectedReturnPct).toBe(RETURN_FLOOR_PCT);
  });

  it("순자산 ≤ 0 이거나 배당 없음이면 배당수익률 0 (분모 0 보호)", () => {
    expect(buildFireBaseline({ ...base, netWorthKRW: 0, twrAnnualPct: 5, dividendAnnualKRW: 1_000_000 }).dividendYieldPct).toBe(0);
    expect(buildFireBaseline({ ...base, netWorthKRW: -5, twrAnnualPct: 5, dividendAnnualKRW: 1_000_000 }).dividendYieldPct).toBe(0);
    expect(buildFireBaseline({ ...base, netWorthKRW: 100, twrAnnualPct: 5, dividendAnnualKRW: null }).dividendYieldPct).toBe(0);
    expect(buildFireBaseline({ ...base, netWorthKRW: NaN, twrAnnualPct: 5 }).netWorthKRW).toBe(0);
  });
});
