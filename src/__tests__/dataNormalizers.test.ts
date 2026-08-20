import { describe, it, expect } from "vitest";
import {
  normalizeAssetSnapshots,
  normalizeMarketEnvSnapshots,
  normalizeHistoricalDailyFx,
  normalizeInvestmentGoals,
  normalizeDailyBudget,
  normalizeHistoricalDailyCloses,
} from "../services/dataNormalizers";
import { DEFAULT_DAILY_BUDGET } from "../utils/dailyBudget";

/**
 * 손상·구버전 입력에 대한 정규화 계약.
 *  - 배열이 아닌 최상위 값 → 빈 배열(또는 undefined)
 *  - 배열 안의 비객체/필수필드 누락 항목은 건너뛰고 나머지는 복원(부분 복원)
 *  - 숫자 필드: 쉼표 포함 문자열 허용, "-"/빈 문자열/NaN/Infinity → null
 *  - 날짜는 YYYY-MM-DD 정규식 엄격 검사
 *  - 멱등성: 정규화 결과를 다시 넣어도 동일
 */

const GARBAGE_TOPLEVEL: unknown[] = [undefined, null, 0, "", "[]", {}, { length: 1 }, true];

describe("dataNormalizers — normalizeAssetSnapshots", () => {
  it("배열이 아닌 입력은 전부 빈 배열", () => {
    for (const g of GARBAGE_TOPLEVEL) expect(normalizeAssetSnapshots(g)).toEqual([]);
  });

  it("비객체 항목·날짜 형식 오류 항목은 건너뛰고 나머지는 복원", () => {
    const out = normalizeAssetSnapshots([
      null,
      42,
      "2026-01-01",
      { date: "2026/01/01", totalAssetEvaluationAmount: 1 },
      { date: "2026-1-1", totalAssetEvaluationAmount: 1 },
      { date: " 2026-02-01 ", totalAssetEvaluationAmount: 100 }, // trim 허용
      { date: "2026-01-15", totalAssetEvaluationAmount: 50 },
    ]);
    expect(out.map((r) => r.date)).toEqual(["2026-01-15", "2026-02-01"]); // 날짜순 정렬
    expect(out[1].totalAssetEvaluationAmount).toBe(100);
  });

  it("숫자 필드: 쉼표 문자열 파싱, '-'/빈문자/NaN/Infinity/객체 → null", () => {
    const [row] = normalizeAssetSnapshots([
      {
        date: "2026-03-01",
        installmentSavings: "1,234,567",
        termDeposit: "-",
        pensionPrincipal: "",
        pensionEvaluation: NaN,
        investmentBuyAmount: Infinity,
        investmentEvaluationAmount: { v: 1 },
        cryptoAssets: "12.5",
        dividendInterestCumulative: 0,
        totalAssetBuyAmount: "abc",
        totalAssetEvaluationAmount: -5,
        investmentPerformance: true,
      },
    ]);
    expect(row).toMatchObject({
      installmentSavings: 1_234_567,
      termDeposit: null,
      pensionPrincipal: null,
      pensionEvaluation: null,
      investmentBuyAmount: null,
      investmentEvaluationAmount: null,
      cryptoAssets: 12.5,
      dividendInterestCumulative: 0,
      totalAssetBuyAmount: null,
      totalAssetEvaluationAmount: -5,
      investmentPerformance: null,
    });
  });

  it("누락 필드는 null로 채워지고 accountBreakdown은 항상 배열", () => {
    const [row] = normalizeAssetSnapshots([{ date: "2026-03-01" }]);
    expect(row.installmentSavings).toBeNull();
    expect(row.totalAssetEvaluationAmount).toBeNull();
    expect(row.accountBreakdown).toEqual([]);
  });

  it("accountBreakdown: accountId 없음·금액 누락 행 제거, accountName 폴백=accountId", () => {
    const [row] = normalizeAssetSnapshots([
      {
        date: "2026-03-01",
        accountBreakdown: [
          null,
          { accountId: "", buyAmount: 1, evaluationAmount: 1 },
          { accountId: "A1", buyAmount: "1,000", evaluationAmount: 1200 },
          { accountId: "A2", accountName: "  ", buyAmount: 10, evaluationAmount: 10 },
          { accountId: "A3", accountName: "증권", buyAmount: 10 }, // evaluationAmount 누락 → 제거
          { accountId: "A4", accountName: "코인", buyAmount: "-", evaluationAmount: 5 }, // buyAmount null → 제거
        ],
      },
    ]);
    expect(row.accountBreakdown).toEqual([
      { accountId: "A1", accountName: "A1", buyAmount: 1000, evaluationAmount: 1200 },
      { accountId: "A2", accountName: "A2", buyAmount: 10, evaluationAmount: 10 },
    ]);
    // 비배열 breakdown → []
    expect(normalizeAssetSnapshots([{ date: "2026-03-01", accountBreakdown: "x" }])[0].accountBreakdown).toEqual([]);
  });

  it("멱등성: 정규화 결과를 다시 넣으면 deep-equal", () => {
    const once = normalizeAssetSnapshots([
      { date: "2026-03-01", installmentSavings: "1,000", accountBreakdown: [{ accountId: "A", buyAmount: 1, evaluationAmount: 2 }] },
      { date: "2026-01-01" },
    ]);
    expect(normalizeAssetSnapshots(once)).toEqual(once);
  });
});

describe("dataNormalizers — normalizeMarketEnvSnapshots", () => {
  it("배열이 아닌 입력은 빈 배열", () => {
    for (const g of GARBAGE_TOPLEVEL) expect(normalizeMarketEnvSnapshots(g)).toEqual([]);
  });

  it("날짜 형식 오류·fxRate 0 이하/비수치 항목은 제거", () => {
    const out = normalizeMarketEnvSnapshots([
      { date: "2026-01", fxRate: 1300, prices: [], recordedAt: "2026-01-01T00:00:00Z" },
      { date: "2026-01-01", fxRate: 0, prices: [], recordedAt: "2026-01-01T00:00:00Z" },
      { date: "2026-01-01", fxRate: -1, prices: [], recordedAt: "2026-01-01T00:00:00Z" },
      { date: "2026-01-01", fxRate: "abc", prices: [], recordedAt: "2026-01-01T00:00:00Z" },
      { date: "2026-01-15", fxRate: "1,350.5", prices: [], recordedAt: "2026-01-15T00:00:00Z" },
    ]);
    expect(out).toEqual([{ date: "2026-01-15", fxRate: 1350.5, prices: [], recordedAt: "2026-01-15T00:00:00Z" }]);
  });

  it("prices: 비배열 → [], 티커 없음/가격 비수치 행 제거, currency는 문자열일 때만", () => {
    const [row] = normalizeMarketEnvSnapshots([
      {
        date: "2026-01-01",
        fxRate: 1300,
        recordedAt: "2026-01-01T00:00:00Z",
        prices: [
          null,
          { ticker: "", price: 1 },
          { ticker: "AAPL", price: "190.5", currency: "USD" },
          { ticker: "005930", price: 70000, currency: 123 },
          { ticker: "TSLA", price: "n/a" },
        ],
      },
      { date: "2026-01-15", fxRate: 1300, recordedAt: "2026-01-15T00:00:00Z", prices: "oops" },
    ]);
    expect(row.prices).toEqual([
      { ticker: "AAPL", price: 190.5, currency: "USD" },
      { ticker: "005930", price: 70000, currency: undefined },
    ]);
    expect(normalizeMarketEnvSnapshots([{ date: "2026-01-15", fxRate: 1300, recordedAt: "x", prices: "oops" }])[0].prices).toEqual([]);
  });

  it("recordedAt 누락 시 ISO 문자열로 채움", () => {
    const [row] = normalizeMarketEnvSnapshots([{ date: "2026-01-01", fxRate: 1300, prices: [] }]);
    expect(typeof row.recordedAt).toBe("string");
    expect(Number.isNaN(Date.parse(row.recordedAt))).toBe(false);
  });

  it("같은 날짜 중복은 recordedAt이 가장 늦은 것만 남기고 날짜순 정렬", () => {
    const out = normalizeMarketEnvSnapshots([
      { date: "2026-02-01", fxRate: 1400, prices: [], recordedAt: "2026-02-01T09:00:00Z" },
      { date: "2026-01-01", fxRate: 1300, prices: [], recordedAt: "2026-01-01T00:00:00Z" },
      { date: "2026-02-01", fxRate: 1410, prices: [], recordedAt: "2026-02-01T12:00:00Z" },
      { date: "2026-02-01", fxRate: 1390, prices: [], recordedAt: "2026-02-01T01:00:00Z" },
    ]);
    expect(out.map((r) => [r.date, r.fxRate])).toEqual([
      ["2026-01-01", 1300],
      ["2026-02-01", 1410],
    ]);
  });

  it("멱등성", () => {
    const once = normalizeMarketEnvSnapshots([
      { date: "2026-02-01", fxRate: "1,400", prices: [{ ticker: "AAPL", price: "1" }], recordedAt: "2026-02-01T09:00:00Z" },
      { date: "2026-01-01", fxRate: 1300, prices: [], recordedAt: "2026-01-01T00:00:00Z" },
    ]);
    expect(normalizeMarketEnvSnapshots(once)).toEqual(once);
  });
});

describe("dataNormalizers — normalizeHistoricalDailyFx", () => {
  it("배열이 아닌 입력은 빈 배열", () => {
    for (const g of GARBAGE_TOPLEVEL) expect(normalizeHistoricalDailyFx(g)).toEqual([]);
  });

  it("날짜 형식·rate(0 이하/비수치) 검증, 날짜당 1건(뒤가 이김), 날짜순 정렬", () => {
    const out = normalizeHistoricalDailyFx([
      { date: "2026-01-02", rate: 1310 },
      { date: "2026-01-01", rate: 1300 },
      { date: "2026-01-01", rate: "1,305" }, // 같은 날짜 → 덮어씀
      { date: "2026-01-03", rate: 0 },
      { date: "2026-01-04", rate: -10 },
      { date: "2026-01-05", rate: "x" },
      { date: "20260106", rate: 1300 },
      "garbage",
      null,
    ]);
    expect(out).toEqual([
      { date: "2026-01-01", rate: 1305 },
      { date: "2026-01-02", rate: 1310 },
    ]);
  });

  it("멱등성", () => {
    const once = normalizeHistoricalDailyFx([{ date: "2026-01-02", rate: 1310 }, { date: "2026-01-01", rate: "1,300" }]);
    expect(normalizeHistoricalDailyFx(once)).toEqual(once);
  });
});

describe("dataNormalizers — normalizeInvestmentGoals", () => {
  it("비객체/빈 객체/유효 필드 없음 → undefined", () => {
    expect(normalizeInvestmentGoals(undefined)).toBeUndefined();
    expect(normalizeInvestmentGoals(null)).toBeUndefined();
    expect(normalizeInvestmentGoals("x")).toBeUndefined();
    expect(normalizeInvestmentGoals(0)).toBeUndefined();
    expect(normalizeInvestmentGoals({})).toBeUndefined();
    expect(normalizeInvestmentGoals({ annualDepositTarget: "1000", finalTotalAssetTarget: NaN, investmentStartDate: "" })).toBeUndefined();
  });

  it("잘못된 타입 필드만 떨구고 나머지는 부분 복원", () => {
    expect(
      normalizeInvestmentGoals({
        annualDepositTarget: 12_000_000,
        finalTotalAssetTarget: "5억", // 문자열 → 제거
        targetAnnualDividend: Infinity, // 비유한 → 제거
        investmentStartDate: "2020-01-01",
        unknownField: 1,
      }),
    ).toEqual({ annualDepositTarget: 12_000_000, investmentStartDate: "2020-01-01" });
  });

  it("구버전 targetMonthlyDividend → targetAnnualDividend(×12) 마이그레이션, 연 목표가 있으면 연 목표 우선", () => {
    expect(normalizeInvestmentGoals({ targetMonthlyDividend: 100_000 })).toEqual({ targetAnnualDividend: 1_200_000 });
    expect(normalizeInvestmentGoals({ targetMonthlyDividend: 100_000, targetAnnualDividend: 500_000 })).toEqual({ targetAnnualDividend: 500_000 });
    // 월 목표가 비수치면 무시
    expect(normalizeInvestmentGoals({ targetMonthlyDividend: "10만" })).toBeUndefined();
  });

  it("멱등성", () => {
    const once = normalizeInvestmentGoals({ annualDepositTarget: 1, targetMonthlyDividend: 2, investmentStartDate: "2021-05-05" });
    expect(normalizeInvestmentGoals(once)).toEqual(once);
  });
});

describe("dataNormalizers — normalizeDailyBudget", () => {
  it("비객체·배열·dailyLimit 비정상(문자열/0/음수/NaN/누락) → undefined (설정 전체 미설정)", () => {
    expect(normalizeDailyBudget(undefined)).toBeUndefined();
    expect(normalizeDailyBudget(null)).toBeUndefined();
    expect(normalizeDailyBudget([])).toBeUndefined();
    expect(normalizeDailyBudget("30000")).toBeUndefined();
    expect(normalizeDailyBudget({})).toBeUndefined();
    expect(normalizeDailyBudget({ dailyLimit: "30000" })).toBeUndefined();
    expect(normalizeDailyBudget({ dailyLimit: 0 })).toBeUndefined();
    expect(normalizeDailyBudget({ dailyLimit: -1 })).toBeUndefined();
    expect(normalizeDailyBudget({ dailyLimit: NaN })).toBeUndefined();
  });

  it("dailyLimit만 있으면 나머지는 기본값(제외 목록은 DEFAULT 복사본, warnOnExceed=true, mode=daily, enabled=false)", () => {
    const out = normalizeDailyBudget({ dailyLimit: 20_000 })!;
    expect(out).toEqual({
      enabled: false,
      dailyLimit: 20_000,
      mode: "daily",
      excludedCategories: DEFAULT_DAILY_BUDGET.excludedCategories,
      excludedSubCategories: DEFAULT_DAILY_BUDGET.excludedSubCategories,
      warnOnExceed: true,
    });
    // 기본값 배열은 복사본이어야 한다 (DEFAULT 오염 방지)
    expect(out.excludedCategories).not.toBe(DEFAULT_DAILY_BUDGET.excludedCategories);
    expect(out.excludedSubCategories).not.toBe(DEFAULT_DAILY_BUDGET.excludedSubCategories);
  });

  it("enabled는 정확히 true일 때만, mode는 'weekly'만 인정, warnOnExceed는 false일 때만 꺼짐, 제외 목록은 문자열로 강제", () => {
    expect(
      normalizeDailyBudget({
        dailyLimit: 10_000,
        enabled: "true",
        mode: "monthly",
        warnOnExceed: 0,
        excludedCategories: ["식비", 123, null],
        excludedSubCategories: [],
      }),
    ).toEqual({
      enabled: false,
      dailyLimit: 10_000,
      mode: "daily",
      excludedCategories: ["식비", "123", "null"],
      excludedSubCategories: [],
      warnOnExceed: true,
    });
    expect(normalizeDailyBudget({ dailyLimit: 10_000, enabled: true, mode: "weekly", warnOnExceed: false })).toMatchObject({
      enabled: true,
      mode: "weekly",
      warnOnExceed: false,
    });
  });

  it("멱등성", () => {
    const once = normalizeDailyBudget({ dailyLimit: 15_000, enabled: true, mode: "weekly", excludedCategories: ["식비"] });
    expect(normalizeDailyBudget(once)).toEqual(once);
  });
});

describe("dataNormalizers — normalizeHistoricalDailyCloses", () => {
  it("배열이 아닌 입력은 빈 배열", () => {
    for (const g of GARBAGE_TOPLEVEL) expect(normalizeHistoricalDailyCloses(g)).toEqual([]);
  });

  it("ticker 대문자화·trim, 날짜/close 검증, currency는 문자열일 때만, 순서 보존(정렬·dedup 없음)", () => {
    const out = normalizeHistoricalDailyCloses([
      { ticker: " aapl ", date: "2026-01-02", close: "190.5", currency: "USD" },
      { ticker: "005930", date: "2026-01-01", close: 70000, currency: 7 },
      { ticker: "", date: "2026-01-01", close: 1 },
      { ticker: "X", date: "2026-01", close: 1 },
      { ticker: "X", date: "2026-01-01", close: "-" },
      { ticker: "X", date: "2026-01-01", close: NaN },
      { ticker: "Y", date: "2026-01-01", close: 0 }, // 0은 유효 숫자
      { ticker: "005930", date: "2026-01-01", close: 70000 }, // 중복은 그대로 보존
      null,
      7,
    ]);
    expect(out).toEqual([
      { ticker: "AAPL", date: "2026-01-02", close: 190.5, currency: "USD" },
      { ticker: "005930", date: "2026-01-01", close: 70000, currency: undefined },
      { ticker: "Y", date: "2026-01-01", close: 0, currency: undefined },
      { ticker: "005930", date: "2026-01-01", close: 70000, currency: undefined },
    ]);
  });

  it("멱등성", () => {
    const once = normalizeHistoricalDailyCloses([{ ticker: "tsla", date: "2026-01-02", close: "1,000" }]);
    expect(normalizeHistoricalDailyCloses(once)).toEqual(once);
  });
});
