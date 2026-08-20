import { describe, it, expect } from "vitest";
import {
  classifyExpenseNature,
  computeExpenseNatureTotals,
  computeExpenseNatureSeries,
} from "../utils/fixedExpense";
import { buildFixedCategorySet, isFixedExpense } from "../utils/expenseClassification";
import { classifyLedgerFlow } from "../features/dashboard/summaryMath";
import { getCategoryType, isSavingsExpenseEntry, isCreditPayment } from "../utils/category";
import { toKrwByRate } from "../utils/currency";
import type { Account, CategoryPresets, LedgerEntry } from "../types";

/** 기본 프리셋(dataService.getDefaultCategoryPresets)과 같은 모양의 축약본 */
const presets: CategoryPresets = {
  income: ["급여", "배당"],
  expense: ["식비", "데이트비", "의류미용비", "문화생활비", "유흥오락비", "주거비", "통신비", "구독비", "생활용품비", "재테크"],
  transfer: ["저축이체", "투자이체", "계좌이체", "카드결제이체"],
  expenseDetails: [
    { main: "식비", subs: ["시장/마트", "외식/배달", "간식", "술/회식", "카페", "편의점", "기타식비"] },
    { main: "데이트비", subs: ["식사", "카페", "이동"] },
    { main: "주거비", subs: ["재산세", "월세", "주담대이자", "관리비"] },
    { main: "통신비", subs: ["핸드폰", "인터넷"] },
    { main: "구독비", subs: ["유튜브", "넷플릭스"] },
    { main: "생활용품비", subs: ["가구/가전", "멤버십"] },
    { main: "재테크", subs: ["투자손실", "수수료"] },
  ],
  categoryTypes: {
    fixed: ["주거비", "통신비", "구독비"],
    savings: [],
    transfer: ["저축이체", "투자이체", "계좌이체", "카드결제이체"],
  },
};

let seq = 0;
function entry(o: Partial<LedgerEntry> & { amount: number }): LedgerEntry {
  seq += 1;
  return {
    id: `L${seq}`,
    date: "2026-07-10",
    kind: "expense",
    category: "지출",
    description: "",
    ...o,
  } as LedgerEntry;
}

/** 표준 스키마: category="지출", subCategory=대분류, detailCategory=소분류 */
const std = (main: string, detail: string | undefined, amount: number, extra: Partial<LedgerEntry> = {}) =>
  entry({ category: "지출", subCategory: main, detailCategory: detail, amount, ...extra });
/** 레거시: category=대분류 직접, subCategory=소분류 */
const legacy = (main: string, sub: string | undefined, amount: number, extra: Partial<LedgerEntry> = {}) =>
  entry({ category: main, subCategory: sub, amount, ...extra });

// ─────────────────────────────────────────────────────────────────────────────
// DividendCoverageCard가 쓰던 인라인 고정비 산식(교체 전 원본 복제) — 숫자 불변 회귀 기준
// ─────────────────────────────────────────────────────────────────────────────
function legacyCardFixedByMonth(
  ledger: LedgerEntry[],
  accounts: Account[],
  categoryPresets: CategoryPresets,
  fxRate: number | null,
  months: string[]
): Map<string, number> {
  const monthSet = new Set(months);
  const toKrw = (e: LedgerEntry) => toKrwByRate(e.amount, e.currency, fxRate);
  const fixedByMonth = new Map<string, number>();
  for (const e of ledger) {
    const month = e.date?.slice(0, 7);
    if (!month || !monthSet.has(month)) continue;
    if (e.kind !== "expense") continue;
    if (isCreditPayment(e)) continue;
    if (isSavingsExpenseEntry(e, accounts, categoryPresets)) continue;
    const categoryType = getCategoryType(e.category, e.subCategory, e.kind, categoryPresets, e, accounts);
    if (categoryType === "fixed" || e.isFixedExpense) {
      fixedByMonth.set(month, (fixedByMonth.get(month) ?? 0) + toKrw(e));
    }
  }
  return fixedByMonth;
}

/** 인사이트가 쓰던 expenseClassification.classifyExpenses 산식(교체 전 원본 복제, 액면 합산) — 회귀 기준 */
function legacyClassifyExpenses(fExp: LedgerEntry[], p: CategoryPresets | undefined) {
  const fixedCats = buildFixedCategorySet(p);
  let fixedExpense = 0;
  let variableExpense = 0;
  for (const l of fExp) {
    const amount = Number(l.amount);
    if (isFixedExpense(l, fixedCats)) fixedExpense += amount;
    else variableExpense += amount;
  }
  return { fixedExpense, variableExpense };
}

const MONTHS = ["2026-05", "2026-06", "2026-07"];
const FX = 1350;

/** 두 기존 정의가 모두 다루던 현실적 케이스 모음 (3개월, 표준+레거시, USD, 비-실소비 섞임) */
function buildFixture(): LedgerEntry[] {
  return [
    // 2026-05
    std("주거비", "월세", 500_000, { date: "2026-05-01" }),                       // 고정(표준)
    std("통신비", "핸드폰", 55_000, { date: "2026-05-05" }),                      // 고정(표준)
    legacy("구독비", "넷플릭스", 17_000, { date: "2026-05-06" }),                 // 고정(레거시)
    std("식비", "시장/마트", 120_000, { date: "2026-05-08" }),                    // 변동
    std("식비", "외식/배달", 45_000, { date: "2026-05-09" }),                     // 재량(소분류)
    std("데이트비", "식사", 80_000, { date: "2026-05-10" }),                      // 재량(대분류)
    std("생활용품비", "멤버십", 30_000, { date: "2026-05-11", isFixedExpense: true }), // 고정(플래그)
    std("식비", "기타식비", 20, { date: "2026-05-12", currency: "USD" }),         // 변동 USD
    std("구독비", "ChatGPT", 20, { date: "2026-05-13", currency: "USD" }),        // 고정 USD
    // 비-실소비 — 모두 제외돼야 함
    entry({ category: "신용결제", amount: 900_000, date: "2026-05-14" }),                          // 레거시 신용결제
    entry({ category: "지출", subCategory: "신용결제", amount: 10_000, date: "2026-05-14" }),
    entry({ category: "재테크", subCategory: "저축", amount: 300_000, date: "2026-05-15" }),        // 저축성지출(레거시)
    entry({ category: "재테크", subCategory: "투자손실", amount: 50_000, date: "2026-05-16" }),    // 투자손실 → 재테크
    entry({ kind: "transfer", category: "이체", subCategory: "저축이체", amount: 1_000_000, date: "2026-05-17" }),
    entry({ kind: "income", category: "수입", subCategory: "배당", amount: 30_000, date: "2026-05-18" }),
    // 2026-06
    std("주거비", "관리비", 150_000, { date: "2026-06-02" }),                      // 고정
    legacy("주거비", "주담대이자", 400_000, { date: "2026-06-03" }),              // 고정(레거시 특례 + 고정 목록)
    std("의류미용비", "의류", 90_000, { date: "2026-06-04" }),                     // 재량
    std("유흥오락비", "복권", 5_000, { date: "2026-06-05" }),                      // 재량
    legacy("식비", "카페", 6_000, { date: "2026-06-06" }),                         // 재량(레거시 소분류)
    std("생활용품비", "가구/가전", 250_000, { date: "2026-06-07" }),               // 변동
    // 2026-07 (비어있는 달 — 0으로 채워져야)
    // 범위 밖
    std("주거비", "월세", 500_000, { date: "2026-04-01" }),
    std("주거비", "월세", 500_000, { date: "2026-08-01" }),
  ];
}

describe("fixedExpense — 회귀: DividendCoverageCard 인라인 고정비 산식과 숫자 불변", () => {
  it("3개월 고정비 합이 기존 카드 산식과 월별로 정확히 같다 (표준·레거시·USD·플래그·제외 항목 혼합)", () => {
    const ledger = buildFixture();
    const legacyMap = legacyCardFixedByMonth(ledger, [], presets, FX, MONTHS);
    const series = computeExpenseNatureSeries(ledger, MONTHS, presets, FX);
    for (const m of MONTHS) {
      expect(series[m].fixed).toBeCloseTo(legacyMap.get(m) ?? 0, 6);
    }
    // 절대값도 못박음 — 5월: 500000+55000+17000+30000+20*1350 / 6월: 150000+400000
    expect(series["2026-05"].fixed).toBe(500_000 + 55_000 + 17_000 + 30_000 + 20 * FX);
    expect(series["2026-06"].fixed).toBe(550_000);
    expect(series["2026-07"].fixed).toBe(0);
  });

  it("환율 미로드(null)여도 기존 카드 산식과 동일 (USD 액면 그대로)", () => {
    const ledger = buildFixture();
    const legacyMap = legacyCardFixedByMonth(ledger, [], presets, null, MONTHS);
    const series = computeExpenseNatureSeries(ledger, MONTHS, presets, null);
    for (const m of MONTHS) expect(series[m].fixed).toBe(legacyMap.get(m) ?? 0);
  });

  it("주거비/주담대이자 특례: 주거비가 고정 목록에서 빠져도 고정비 (구 getCategoryType 동작 보존)", () => {
    const noHousing: CategoryPresets = { ...presets, categoryTypes: { ...presets.categoryTypes, fixed: ["통신비"] } };
    const ledger = [
      legacy("주거비", "주담대이자", 400_000, { date: "2026-06-03" }),
      std("주거비", "주담대이자", 100_000, { date: "2026-06-04" }),
      std("주거비", "월세", 500_000, { date: "2026-06-05" }),
    ];
    const legacyMap = legacyCardFixedByMonth(ledger, [], noHousing, FX, ["2026-06"]);
    const series = computeExpenseNatureSeries(ledger, ["2026-06"], noHousing, FX);
    // 레거시 형태(category=주거비, sub=주담대이자)는 카드 산식도 잡았다 → 동일
    expect(legacyMap.get("2026-06")).toBe(400_000);
    // 새 모듈은 표준 형태(det=주담대이자)도 특례로 잡는다(상위 호환) — 월세는 변동
    expect(series["2026-06"].fixed).toBe(500_000);
    expect(series["2026-06"].variable).toBe(500_000);
  });
});

describe("fixedExpense — 회귀: expenseClassification.classifyExpenses(인사이트 ExpenseTab)와 불변", () => {
  it("fExp(classifyLedgerFlow=expense) 입력 시 fixed 동일, 옛 variable = 새 variable + discretionary (KRW)", () => {
    const ledger = buildFixture().filter((l) => l.currency !== "USD");
    const fExp = ledger.filter((l) => Number(l.amount) > 0 && classifyLedgerFlow(l, presets) === "expense");
    const old = legacyClassifyExpenses(fExp, presets);
    const next = computeExpenseNatureTotals(fExp, presets, FX);
    expect(next.fixed).toBe(old.fixedExpense);
    expect(next.variable + next.discretionary).toBe(old.variableExpense);
    expect(next.fixed + next.variable + next.discretionary).toBe(old.fixedExpense + old.variableExpense);
  });

  it("게이트 내장: 걸러지지 않은 전체 ledger를 넣어도 fExp를 넣은 것과 같은 결과", () => {
    const ledger = buildFixture();
    const fExp = ledger.filter((l) => Number(l.amount) > 0 && classifyLedgerFlow(l, presets) === "expense");
    expect(computeExpenseNatureTotals(ledger, presets, FX)).toEqual(computeExpenseNatureTotals(fExp, presets, FX));
  });

  it("USD 항목은 원화 환산 — 기존 classifyExpenses는 액면 합산이었던 불일치를 고친다", () => {
    const fExp = [std("구독비", "ChatGPT", 20, { currency: "USD" }), std("식비", "기타식비", 10, { currency: "USD" })];
    const next = computeExpenseNatureTotals(fExp, presets, FX);
    expect(next.fixed).toBe(20 * FX);
    expect(next.variable).toBe(10 * FX);
    const old = legacyClassifyExpenses(fExp, presets);
    expect(old.fixedExpense).toBe(20); // 옛 정의(액면) — 의도된 차이
  });
});

describe("classifyExpenseNature — 단일 항목 판정", () => {
  it("표준 스키마 고정 대분류(sub) → fixed", () => {
    expect(classifyExpenseNature(std("통신비", "인터넷", 30_000), presets)).toBe("fixed");
  });
  it("레거시 스키마 고정 대분류(category) → fixed", () => {
    expect(classifyExpenseNature(legacy("통신비", "인터넷", 30_000), presets)).toBe("fixed");
  });
  it("isFixedExpense 플래그는 카테고리보다 우선 — 재량 대분류여도 fixed", () => {
    expect(classifyExpenseNature(std("데이트비", "식사", 10_000, { isFixedExpense: true }), presets)).toBe("fixed");
  });
  it("재량 대분류(데이트비·의류미용비·문화생활비·유흥오락비·놀이) → discretionary", () => {
    for (const main of ["데이트비", "의류미용비", "문화생활비", "유흥오락비", "놀이"]) {
      expect(classifyExpenseNature(std(main, undefined, 1_000), presets)).toBe("discretionary");
      expect(classifyExpenseNature(legacy(main, undefined, 1_000), presets)).toBe("discretionary");
    }
  });
  it("식비 하위 외식/배달·술/회식·카페·간식 → discretionary, 시장/마트·편의점 → variable", () => {
    expect(classifyExpenseNature(std("식비", "외식/배달", 1_000), presets)).toBe("discretionary");
    expect(classifyExpenseNature(std("식비", "술/회식", 1_000), presets)).toBe("discretionary");
    expect(classifyExpenseNature(legacy("식비", "카페", 1_000), presets)).toBe("discretionary");
    expect(classifyExpenseNature(std("식비", "간식", 1_000), presets)).toBe("discretionary");
    expect(classifyExpenseNature(std("식비", "시장/마트", 1_000), presets)).toBe("variable");
    expect(classifyExpenseNature(std("식비", "편의점", 1_000), presets)).toBe("variable");
  });
  it("비-실소비(신용결제·환전·저축성지출·투자손실·이체·수입) → null", () => {
    expect(classifyExpenseNature(entry({ category: "신용결제", amount: 1 }), presets)).toBeNull();
    expect(classifyExpenseNature(entry({ category: "지출", subCategory: "환전", amount: 1 }), presets)).toBeNull();
    expect(classifyExpenseNature(entry({ category: "재테크", subCategory: "저축", amount: 1 }), presets)).toBeNull();
    expect(classifyExpenseNature(entry({ category: "재테크", subCategory: "투자손실", amount: 1 }), presets)).toBeNull();
    expect(classifyExpenseNature(entry({ kind: "transfer", category: "이체", subCategory: "카드결제이체", amount: 1 }), presets)).toBeNull();
    expect(classifyExpenseNature(entry({ kind: "income", category: "수입", subCategory: "급여", amount: 1 }), presets)).toBeNull();
  });
  it("플래그가 있어도 비-실소비면 null (환전에 고정 플래그가 붙은 오입력 방어)", () => {
    expect(classifyExpenseNature(entry({ category: "환전", amount: 1, isFixedExpense: true }), presets)).toBeNull();
  });
  it("presets 없으면 플래그·특례 없는 한 variable/discretionary만", () => {
    expect(classifyExpenseNature(std("주거비", "월세", 1), undefined)).toBe("variable");
    expect(classifyExpenseNature(std("주거비", "주담대이자", 1), undefined)).toBe("fixed");
    expect(classifyExpenseNature(std("데이트비", "식사", 1), undefined)).toBe("discretionary");
  });
  it("좌우 공백은 trim 후 매칭", () => {
    expect(classifyExpenseNature(std(" 통신비 ", undefined, 1), presets)).toBe("fixed");
    expect(classifyExpenseNature(std("데이트비 ", undefined, 1), presets)).toBe("discretionary");
  });
});

describe("computeExpenseNatureSeries — 월별·dayCap·빈 달", () => {
  it("months에 있는 달은 항목이 없어도 0으로 채우고, 범위 밖 달은 무시", () => {
    const series = computeExpenseNatureSeries(buildFixture(), MONTHS, presets, FX);
    expect(Object.keys(series).sort()).toEqual(MONTHS);
    expect(series["2026-07"]).toEqual({ fixed: 0, variable: 0, discretionary: 0 });
    // 6월: 고정 550000 / 재량 90000+5000+6000 / 변동 250000
    expect(series["2026-06"]).toEqual({ fixed: 550_000, discretionary: 101_000, variable: 250_000 });
  });

  it("dayCap: 모든 달에서 1~N일만 합산 (진행 중인 달 동기 비교)", () => {
    const ledger = [
      std("주거비", "월세", 500_000, { date: "2026-06-01" }),
      std("식비", "외식/배달", 30_000, { date: "2026-06-10" }),
      std("식비", "시장/마트", 70_000, { date: "2026-06-11" }),
      std("주거비", "관리비", 150_000, { date: "2026-06-25" }),
      std("주거비", "월세", 500_000, { date: "2026-07-01" }),
      std("주거비", "관리비", 150_000, { date: "2026-07-25" }),
    ];
    const capped = computeExpenseNatureSeries(ledger, ["2026-06", "2026-07"], presets, FX, { dayCap: 10 });
    expect(capped["2026-06"]).toEqual({ fixed: 500_000, discretionary: 30_000, variable: 0 });
    expect(capped["2026-07"]).toEqual({ fixed: 500_000, discretionary: 0, variable: 0 });
    const full = computeExpenseNatureSeries(ledger, ["2026-06", "2026-07"], presets, FX, { dayCap: null });
    expect(full["2026-06"]).toEqual({ fixed: 650_000, discretionary: 30_000, variable: 70_000 });
    expect(full["2026-07"].fixed).toBe(650_000);
  });

  it("월 말일 경계: 31일 항목은 dayCap 30에 빠지고 31에 들어간다", () => {
    const ledger = [std("통신비", "핸드폰", 50_000, { date: "2026-07-31" })];
    expect(computeExpenseNatureSeries(ledger, ["2026-07"], presets, FX, { dayCap: 30 })["2026-07"].fixed).toBe(0);
    expect(computeExpenseNatureSeries(ledger, ["2026-07"], presets, FX, { dayCap: 31 })["2026-07"].fixed).toBe(50_000);
  });

  it("date 없는 항목은 무시", () => {
    const ledger = [{ ...std("통신비", "핸드폰", 50_000), date: "" }];
    expect(computeExpenseNatureSeries(ledger, ["2026-07"], presets, FX)["2026-07"].fixed).toBe(0);
  });
});
