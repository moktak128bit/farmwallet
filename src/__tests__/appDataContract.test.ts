// @vitest-environment jsdom
/**
 * AppData 계약 테스트 — 필드 누락 = 영구 유실 트랩을 자동 감지한다.
 *
 * 배경: AppData(types.ts)에 키를 추가할 때 dataService.buildAppDataFromMigrated(parsedData)·getEmptyData·
 * tableDataBackup(build/import)·toUserDataJson 중 하나라도 빠지면 저장/복원/동기화 경로에서 데이터가 사라진다.
 * (investmentGoals·dailyBudget 유실 회귀가 실제로 2번 있었다.)
 *
 * 가드 구조:
 *  1. `FULL: Required<AppData>` — AppData에 새 키가 생기면 여기서 **tsc가 실패**한다(컴파일 가드).
 *     그러면 새 키에 샘플을 채워야 하고, 아래 왕복 루프가 자동으로 그 키를 검증한다.
 *  2. 왕복 3경로에서 `Object.keys(FULL)` 전수 deep-equal:
 *     (a) saveData → loadData(localStorage + 캐시 분리 키)
 *     (b) buildTableBackupFile → appDataFromTableBackupPayload → normalizeImportedData
 *     (c) JSON.parse(toUserDataJson) → normalizeImportedData (Gist 동기화 경로)
 *     정규화로 값이 바뀌거나 의도적으로 제외되는 키는 경로별 allowlist에 사유와 함께 등록하고,
 *     allowlist 키도 "존재는 한다" 수준으로 검증한다.
 *  3. getEmptyData()가 필수 키를 전부 포함 + 테이블 백업 tables 키 집합 스냅샷(새 테이블 누락 감지).
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { AppData } from "../types";
import { getEmptyData, loadData, normalizeImportedData, saveData, toUserDataJson } from "../services/dataService";
import { appDataFromTableBackupPayload, buildTableBackupFile } from "../utils/tableDataBackup";
import { STORAGE_KEYS } from "../constants/config";

type AppDataKey = keyof AppData;

/**
 * 모든 키에 "비어 있지 않은" 현실적 샘플. 각 타입의 필수 필드는 전부 채우고,
 * 정규화(normalize*)가 값을 바꾸지 않도록 이미 정규형으로 작성한다:
 *  - 시계열은 날짜 오름차순·날짜당 1건, 숫자는 유한값, 티커는 대문자
 *  - 한국 종목 이름은 한글(applyKoreanStockNames가 덮어쓰지 않음)
 *  - categoryPresets는 mergeCategoryPresets의 방어적 정정이 no-op이 되는 형태
 *    (income에 "데이트통장", transfer에 "저축이체"+"투자이체", "대출상환"에 원금/이자상환, "신용카드" 없음)
 *  - undefined 값 금지(JSON 왕복에서 키가 사라져 deep-equal을 흐린다)
 */
const FULL: Required<AppData> = {
  accounts: [
    {
      id: "A1",
      name: "주거래통장",
      institution: "국민은행",
      type: "checking",
      initialBalance: 1_000_000,
      debt: 0,
      savings: 0,
      currency: "KRW",
      note: "급여 계좌",
      archived: false,
    },
    {
      id: "A2",
      name: "증권계좌",
      institution: "키움증권",
      type: "securities",
      initialBalance: 0,
      debt: 0,
      savings: 0,
      cashAdjustment: 1_000,
      initialCashBalance: 50_000,
      currency: "USD",
      usdBalance: 1_200.5,
      krwBalance: 300_000,
      isPension: false,
      taxShelter: "isa",
    },
    {
      id: "A3",
      name: "신용카드",
      institution: "현대카드",
      type: "card",
      initialBalance: 0,
      debt: 250_000,
      savings: 0,
      billingCycleStart: 13,
      paymentDay: 25,
    },
  ],
  ledger: [
    {
      id: "L1",
      date: "2026-01-05",
      kind: "income",
      category: "수입",
      subCategory: "월급",
      description: "1월 급여",
      amount: 3_000_000,
      toAccountId: "A1",
      tags: ["급여"],
    },
    {
      id: "L2",
      date: "2026-01-10",
      kind: "expense",
      category: "지출",
      subCategory: "식비",
      detailCategory: "외식",
      description: "점심",
      amount: 11_000,
      currency: "KRW",
      discountAmount: 1_000,
      fromAccountId: "A1",
      isFixedExpense: false,
      note: "회사 근처",
      tags: ["점심", "회사"],
    },
    {
      id: "L3",
      date: "2026-01-15",
      kind: "transfer",
      category: "이체",
      subCategory: "투자이체",
      description: "증권 입금",
      amount: 500_000,
      fromAccountId: "A1",
      toAccountId: "A2",
    },
    {
      id: "L4",
      date: "2026-01-20",
      kind: "expense",
      category: "지출",
      subCategory: "대출상환",
      detailCategory: "이자상환",
      description: "디딤돌 이자",
      amount: 120_000,
      fromAccountId: "A1",
      loanId: "LN1",
    },
    {
      id: "L5",
      date: "2026-01-25",
      kind: "income",
      category: "데이트통장",
      description: "1월 정산",
      amount: 40_000,
      toAccountId: "A1",
      settledLedgerIds: ["L2"],
    },
  ],
  trades: [
    {
      id: "T1",
      date: "2026-01-16",
      accountId: "A2",
      ticker: "AAPL",
      name: "Apple",
      side: "buy",
      quantity: 2,
      price: 180,
      fee: 1,
      totalAmount: 361,
      cashImpact: -361,
      fxRateAtTrade: 1_320,
    },
    {
      id: "T2",
      date: "2026-02-01",
      accountId: "A2",
      ticker: "005930",
      name: "삼성전자",
      side: "sell",
      quantity: 10,
      price: 70_000,
      fee: 100,
      totalAmount: 699_900,
      cashImpact: 699_900,
    },
  ],
  prices: [
    { ticker: "AAPL", name: "Apple", price: 185, currency: "USD", change: 1.5, changePercent: 0.8, updatedAt: "2026-02-01T09:00:00+09:00" },
    { ticker: "005930", name: "삼성전자", price: 71_000, currency: "KRW" },
  ],
  categoryPresets: {
    income: ["월급", "배당금", "데이트통장", "기타수입"],
    expense: ["식비", "재테크", "대출상환"],
    expenseDetails: [
      { main: "식비", subs: ["외식", "식재료"] },
      { main: "재테크", subs: ["투자손실", "수수료"] },
      { main: "대출상환", subs: ["원금상환", "이자상환"] },
    ],
    transfer: ["저축이체", "투자이체", "카드결제이체"],
    categoryTypes: {
      fixed: ["주거비"],
      savings: ["적금"],
      transfer: ["저축이체"],
      salary: ["월급"],
      passive: ["배당금"],
      nonRealIncome: ["데이트통장"],
    },
  },
  recurringExpenses: [
    {
      id: "R1",
      title: "월세",
      amount: 500_000,
      category: "주거비",
      frequency: "monthly",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      fromAccountId: "A1",
      toAccountId: "A2",
    },
  ],
  budgetGoals: [
    {
      id: "B1",
      category: "전체",
      monthlyLimit: 1_500_000,
      note: "생활비",
      excludeCategories: ["데이트비"],
      excludeAccountIds: ["A2"],
    },
  ],
  customSymbols: [{ ticker: "SCHD", name: "Schwab US Dividend Equity ETF" }],
  usTickers: ["AAPL", "SCHD"],
  tickerDatabase: [
    { ticker: "AAPL", name: "Apple Inc.", market: "US", exchange: "NASDAQ", lastUpdated: "2026-01-01" },
    { ticker: "005930", name: "삼성전자", market: "KR", exchange: "KOSPI" },
  ],
  ledgerTemplates: [
    {
      id: "LT1",
      name: "점심",
      kind: "expense",
      mainCategory: "식비",
      subCategory: "외식",
      description: "점심",
      amount: 10_000,
      fromAccountId: "A1",
      toAccountId: "A2",
      lastUsed: "2026-01-10",
    },
  ],
  stockPresets: [
    { id: "SP1", name: "애플 매수", accountId: "A2", ticker: "AAPL", stockName: "Apple", quantity: 1, fee: 0.5, lastUsed: "2026-01-16" },
  ],
  targetPortfolios: [
    {
      id: "TP1",
      name: "배당형",
      accountId: "A2",
      items: [
        { ticker: "AAPL", targetPercent: 60, alias: "애플" },
        { ticker: "SCHD", targetPercent: 40, alias: "슈드" },
      ],
      updatedAt: "2026-01-20T00:00:00.000Z",
    },
    {
      id: "TP2",
      name: "전체 기준",
      accountId: null,
      items: [{ ticker: "005930", targetPercent: 100, alias: "삼전" }],
      updatedAt: "2026-01-21T00:00:00.000Z",
    },
  ],
  loans: [
    {
      id: "LN1",
      institution: "주택금융공사",
      loanName: "디딤돌",
      subCategory: "주담대원금",
      loanAmount: 100_000_000,
      annualInterestRate: 3.2,
      repaymentMethod: "equal_payment",
      loanDate: "2024-01-01",
      maturityDate: "2054-01-01",
      gracePeriodYears: 1,
    },
  ],
  workoutWeeks: [
    {
      id: "W1",
      weekStart: "2026-01-04",
      entries: [
        {
          id: "D1",
          date: "2026-01-04",
          type: "workout",
          dayLabel: "Day 1 (상체)",
          exercises: [
            {
              id: "E1",
              name: "벤치프레스",
              bodyPart: "가슴",
              sets: [
                { weightKg: 60, reps: 10, done: true, targetWeightKg: 60, targetReps: 10, restSec: 90, completedAt: "2026-01-04T09:10:00+09:00" },
                { weightKg: 62.5, reps: 8, done: false, targetRepsRange: "8~10", note: "오른쪽 어깨 시큰함" },
              ],
              note: "컨디션 좋음",
              warmupNote: "빈 바 × 10",
              cueNote: "견갑 고정",
            },
          ],
          cardio: "트레드밀",
          cardioMinutes: 15,
          cardioDistanceKm: 2.5,
          startedAt: "2026-01-04T09:00:00+09:00",
          endedAt: "2026-01-04T10:00:00+09:00",
        },
        { id: "D2", date: "2026-01-05", type: "rest", restNotes: "수면 7시간" },
      ],
    },
  ],
  workoutRoutines: [
    {
      id: "RT1",
      name: "푸시 데이",
      exercises: [
        {
          id: "RE1",
          name: "벤치프레스",
          bodyPart: "가슴",
          targetSets: 4,
          targetReps: 8,
          targetWeightKg: 60,
          targetRepsRange: "8~10",
          restSec: 90,
          warmupNote: "빈 바 × 10",
          cueNote: "가슴 수축",
        },
      ],
      cardioNote: "트레드밀 15분",
      weekday: 0,
      restDay: false,
      note: "상체 A",
    },
  ],
  customExercises: [{ name: "케이블 크로스오버", bodyPart: "가슴", addedAt: "2026-01-01T00:00:00.000Z" }],
  targetNetWorthCurve: { "2026-01-01": 10_000_000, "2026-12-31": 20_000_000 },
  assetSnapshots: [
    {
      date: "2026-01-15",
      installmentSavings: 1_000_000,
      termDeposit: 2_000_000,
      pensionPrincipal: 3_000_000,
      pensionEvaluation: 3_100_000,
      investmentBuyAmount: 4_000_000,
      investmentEvaluationAmount: 4_200_000,
      cryptoAssets: 100_000,
      dividendInterestCumulative: 50_000,
      totalAssetBuyAmount: 10_100_000,
      totalAssetEvaluationAmount: 10_450_000,
      investmentPerformance: 5.2,
      accountBreakdown: [{ accountId: "A2", accountName: "증권계좌", buyAmount: 4_000_000, evaluationAmount: 4_200_000 }],
    },
    {
      date: "2026-02-01",
      installmentSavings: 1_100_000,
      termDeposit: 2_000_000,
      pensionPrincipal: 3_100_000,
      pensionEvaluation: 3_250_000,
      investmentBuyAmount: 4_100_000,
      investmentEvaluationAmount: 4_400_000,
      cryptoAssets: 90_000,
      dividendInterestCumulative: 60_000,
      totalAssetBuyAmount: 10_300_000,
      totalAssetEvaluationAmount: 10_740_000,
      investmentPerformance: 6.1,
      accountBreakdown: [{ accountId: "A2", accountName: "증권계좌", buyAmount: 4_100_000, evaluationAmount: 4_400_000 }],
    },
  ],
  marketEnvSnapshots: [
    {
      date: "2026-01-15",
      fxRate: 1_320.5,
      prices: [
        { ticker: "AAPL", price: 185, currency: "USD" },
        { ticker: "005930", price: 71_000, currency: "KRW" },
      ],
      recordedAt: "2026-01-15T00:00:00.000Z",
    },
  ],
  historicalDailyCloses: [
    { ticker: "AAPL", date: "2026-01-14", close: 184, currency: "USD" },
    { ticker: "AAPL", date: "2026-01-15", close: 185, currency: "USD" },
  ],
  historicalDailyFx: [
    { date: "2026-01-14", rate: 1_318 },
    { date: "2026-01-15", rate: 1_320.5 },
  ],
  benchmarkDailyCloses: [
    { ticker: "^GSPC", date: "2026-01-15", close: 4_800, currency: "USD" },
    { ticker: "^KS11", date: "2026-01-15", close: 2_600, currency: "KRW" },
  ],
  dividendTrackingTicker: "SCHD",
  isaPortfolio: [
    { ticker: "458730", name: "TIGER 미국배당다우존스", weight: 50, label: "배당" },
    { ticker: "360750", name: "TIGER 미국S&P500", weight: 50, label: "성장" },
  ],
  investmentGoals: {
    annualDepositTarget: 12_000_000,
    finalTotalAssetTarget: 1_000_000_000,
    targetAnnualDividend: 3_000_000,
    investmentStartDate: "2024-01-01",
  },
  dailyBudget: {
    enabled: true,
    dailyLimit: 30_000,
    mode: "weekly",
    excludedCategories: ["재테크", "이체"],
    excludedSubCategories: ["통신비"],
    warnOnExceed: false,
  },
};

const ALL_KEYS = Object.keys(FULL) as AppDataKey[];

/**
 * 필수(non-optional) 키 — 컴파일 가드: AppData의 필수 키 집합과 정확히 같아야 tsc가 통과한다.
 * (필수 키가 새로 생기면 `_requiredKeysCovered`가 never가 되어 실패, 키가 optional로 바뀌면 배열 타입이 실패)
 */
type RequiredKeys<T> = {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- `{} extends Pick<T,K>` 관용구(optional 판별)
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K;
}[keyof T];
const REQUIRED_KEYS = [
  "accounts",
  "ledger",
  "trades",
  "prices",
  "categoryPresets",
  "recurringExpenses",
  "budgetGoals",
  "customSymbols",
] as const satisfies readonly RequiredKeys<AppData>[];
type MissingRequired = Exclude<RequiredKeys<AppData>, (typeof REQUIRED_KEYS)[number]>;
const _requiredKeysCovered: [MissingRequired] extends [never] ? true : never = true;
void _requiredKeysCovered;

function isNonEmptySample(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  if (typeof value === "string") return value.length > 0;
  return true;
}

/** allowlist 키는 "존재는 한다"(undefined 아님, 배열이면 배열) 수준으로 검증 */
function expectPresent(loaded: AppData, key: AppDataKey): void {
  expect(loaded, `${key}: 키가 존재해야 함`).toHaveProperty(key);
  const v = loaded[key];
  expect(v, `${key}: undefined면 안 됨`).not.toBeUndefined();
  if (Array.isArray(FULL[key])) {
    expect(Array.isArray(v), `${key}: 배열이어야 함`).toBe(true);
  }
}

/**
 * 경로별 deep-equal 전수 검증. allowlist 키는 존재만 확인한다.
 * 새 AppData 키는 FULL(컴파일 가드)에 샘플을 넣는 순간 자동으로 이 루프에 포함된다.
 */
function expectRoundTrip(loaded: AppData, allowlist: Partial<Record<AppDataKey, string>>): void {
  for (const key of ALL_KEYS) {
    if (key in allowlist) {
      expectPresent(loaded, key);
      continue;
    }
    // toEqual: 정규화가 덧붙이는 `currency: undefined` 같은 undefined 프로퍼티는 무시(JSON 왕복과 동등)
    expect(loaded[key], `AppData.${key} 왕복 불일치 — 저장/복원 경로에서 누락·변형됨`).toEqual(FULL[key]);
  }
}

describe("AppData 계약 — FULL 샘플 자체 검증", () => {
  it("FULL의 모든 키가 비어 있지 않은 샘플을 가진다 (빈 샘플은 누락을 숨긴다)", () => {
    for (const key of ALL_KEYS) {
      expect(isNonEmptySample(FULL[key]), `FULL.${key} 샘플이 비어 있음`).toBe(true);
    }
  });

  it("FULL은 JSON 왕복에서 그대로 보존된다 (undefined 값 없음)", () => {
    expect(JSON.parse(JSON.stringify(FULL))).toEqual(FULL);
  });

  it("필수 키 목록이 FULL의 부분집합이다", () => {
    for (const key of REQUIRED_KEYS) {
      expect(ALL_KEYS).toContain(key);
    }
  });
});

describe("AppData 계약 — 왕복 (a) saveData → loadData", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("모든 키가 localStorage(DATA + CACHE 분리 키) 왕복 후 deep-equal", () => {
    saveData(FULL);
    const loaded = loadData();
    // 캐시 3종은 CACHE 키로 분리 저장되지만 loadData가 다시 합쳐 돌려준다 — allowlist 없음
    expectRoundTrip(loaded, {});
  });

  it("Account.taxShelter(ISA·연금저축·IRP 세제 성격, 4-1)가 saveData→loadData 왕복에서 보존된다", () => {
    saveData(FULL);
    const loaded = loadData();
    expect(loaded.accounts.find((a) => a.id === "A2")?.taxShelter).toBe("isa");
    expect(loaded.accounts.find((a) => a.id === "A1")?.taxShelter).toBeUndefined();
  });

  it("DATA 키(사용자 데이터)에는 캐시 3종이 빠지고 CACHE 키에 들어간다 (용량 분리 계약)", () => {
    saveData(FULL);
    const userRaw = JSON.parse(window.localStorage.getItem(STORAGE_KEYS.DATA) ?? "{}") as Record<string, unknown>;
    const cacheRaw = JSON.parse(window.localStorage.getItem(STORAGE_KEYS.CACHE) ?? "{}") as Record<string, unknown>;
    for (const key of ["prices", "tickerDatabase", "historicalDailyCloses"] as const) {
      expect(userRaw, `DATA 키에 ${key}가 있으면 안 됨`).not.toHaveProperty(key);
      expect(cacheRaw[key], `CACHE 키에 ${key}가 있어야 함`).toEqual(FULL[key]);
    }
    // 캐시 3종을 뺀 나머지 키는 전부 DATA 키에 있어야 함
    for (const key of ALL_KEYS) {
      if (key === "prices" || key === "tickerDatabase" || key === "historicalDailyCloses") continue;
      expect(userRaw, `DATA 키에 ${key} 누락`).toHaveProperty(key);
    }
  });
});

describe("AppData 계약 — 왕복 (b) 테이블 백업 build → import → normalizeImportedData", () => {
  it("모든 키가 테이블 백업 왕복 후 deep-equal", () => {
    const file = buildTableBackupFile(FULL);
    // 실제 파일 저장/읽기와 동일하게 JSON 직렬화를 한 번 거친다
    const reparsed = JSON.parse(JSON.stringify(file)) as unknown;
    const imported = normalizeImportedData(appDataFromTableBackupPayload(reparsed));
    expectRoundTrip(imported, {});
  });

  it("appDataFromTableBackupPayload 단독 결과에도 모든 키가 존재한다 (정규화 전 단계 누락 감지)", () => {
    const file = buildTableBackupFile(FULL);
    const raw = appDataFromTableBackupPayload(JSON.parse(JSON.stringify(file)) as unknown);
    for (const key of ALL_KEYS) {
      expect(raw, `테이블 백업 import 결과에 ${key} 누락`).toHaveProperty(key);
      expect(raw[key], `테이블 백업 import 결과 ${key}가 undefined`).not.toBeUndefined();
    }
  });
});

describe("AppData 계약 — 왕복 (c) toUserDataJson(Gist) → normalizeImportedData", () => {
  it("캐시 3종을 제외한 모든 키가 deep-equal, 캐시 3종은 빈 배열로 존재", () => {
    const imported = normalizeImportedData(JSON.parse(toUserDataJson(FULL)));
    expectRoundTrip(imported, {
      // toUserDataJson은 API로 재수집 가능한 캐시 3종을 의도적으로 제외한다(Gist 용량·속도).
      // 가져오기 쪽은 빈 배열로 복원하므로 값 비교 대신 존재만 확인.
      prices: "Gist 동기화에서 의도적으로 제외되는 API 캐시",
      tickerDatabase: "Gist 동기화에서 의도적으로 제외되는 API 캐시",
      historicalDailyCloses: "Gist 동기화에서 의도적으로 제외되는 API 캐시",
    });
    expect(imported.prices).toEqual([]);
    expect(imported.tickerDatabase).toEqual([]);
    expect(imported.historicalDailyCloses).toEqual([]);
  });

  it("toUserDataJson 결과에 캐시 3종 외 모든 키가 들어 있다", () => {
    const json = JSON.parse(toUserDataJson(FULL)) as Record<string, unknown>;
    for (const key of ALL_KEYS) {
      if (key === "prices" || key === "tickerDatabase" || key === "historicalDailyCloses") {
        expect(json, `toUserDataJson에 캐시 ${key}가 포함되면 안 됨`).not.toHaveProperty(key);
        continue;
      }
      expect(json[key], `toUserDataJson에 ${key} 누락`).toEqual(FULL[key]);
    }
  });
});

describe("AppData 계약 — getEmptyData / 테이블 백업 tables 키 집합", () => {
  it("getEmptyData()는 필수 키를 모두 포함하고, 모든 키는 AppData 키 집합 안에 있다", () => {
    const empty = getEmptyData();
    const emptyKeys = Object.keys(empty) as AppDataKey[];
    for (const key of REQUIRED_KEYS) {
      expect(emptyKeys, `getEmptyData()에 필수 키 ${key} 누락`).toContain(key);
    }
    for (const key of emptyKeys) {
      expect(ALL_KEYS, `getEmptyData()의 ${key}는 AppData 키가 아님`).toContain(key);
    }
  });

  it("getEmptyData()는 타입 힌트가 필요한 옵션 키도 빈 컬렉션으로 채운다 (UI가 undefined 가드 없이 쓰는 키)", () => {
    const empty = getEmptyData();
    // 현재 getEmptyData가 채우는 옵션 키 — 빠지면 초기 상태 UI가 깨지므로 회귀 감지용으로 고정
    for (const key of [
      "loans", "usTickers", "tickerDatabase", "ledgerTemplates", "stockPresets", "targetPortfolios",
      "workoutWeeks", "workoutRoutines", "customExercises", "targetNetWorthCurve", "assetSnapshots",
      "historicalDailyCloses", "dividendTrackingTicker", "isaPortfolio",
    ] as const) {
      expect(empty[key], `getEmptyData().${key}가 undefined`).not.toBeUndefined();
    }
  });

  it("테이블 백업 tables 키 집합 스냅샷 — 새 AppData 키의 테이블 누락·이름 변경 감지", () => {
    const file = buildTableBackupFile(FULL);
    expect(Object.keys(file.tables).sort()).toEqual(
      [
        "accounts",
        "asset_snapshot_breakdowns",
        "asset_snapshots",
        "benchmark_daily_closes",
        "budget_goals",
        "category_preset_income",
        "category_preset_transfer",
        "category_type_fixed",
        "category_type_non_real_income",
        "category_type_passive",
        "category_type_salary",
        "category_type_savings",
        "category_type_transfer",
        "custom_exercises",
        "custom_symbols",
        "daily_budget",
        "expense_detail_groups",
        "expense_detail_subs",
        "historical_daily_closes",
        "historical_daily_fx",
        "investment_goals",
        "isa_portfolio_items",
        "ledger_entries",
        "ledger_templates",
        "loans",
        "market_env_snapshots",
        "meta_kv",
        "net_worth_curve",
        "recurring_expenses",
        "stock_presets",
        "stock_prices",
        "stock_trades",
        "target_portfolio_items",
        "target_portfolios",
        "ticker_database",
        "us_ticker_order",
        "workout_data_json",
        "workout_day_entries",
        "workout_exercises",
        "workout_routines",
        "workout_sets",
        "workout_weeks",
      ].sort()
    );
    // 테이블 파일 루트 메타
    expect(file.format).toBe("farmwallet-table-backup-v1");
    expect(typeof file.schemaVersion).toBe("number");
    expect(typeof file.exportedAt).toBe("string");
  });
});
