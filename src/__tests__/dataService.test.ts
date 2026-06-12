import { describe, it, expect, beforeEach } from "vitest";
import { toUserDataJson, loadData, saveData, normalizeImportedData } from "../services/dataService";
import { STORAGE_KEYS } from "../constants/config";
import type { AppData, DailyBudgetConfig } from "../types";

function makeAppData(overrides: Partial<AppData> = {}): AppData {
  return {
    accounts: [],
    ledger: [],
    trades: [],
    prices: [],
    categoryPresets: { income: [], expense: [], transfer: [] },
    recurringExpenses: [],
    budgetGoals: [],
    customSymbols: [],
    ...overrides,
  };
}

describe("toUserDataJson", () => {
  it("API 캐시(prices/tickerDatabase/historicalDailyCloses)를 결과에서 제거", () => {
    const data = makeAppData({
      prices: [{ ticker: "AAPL", price: 100 }],
      tickerDatabase: [{ ticker: "AAPL", name: "Apple", market: "US" as const }],
      historicalDailyCloses: [{ ticker: "AAPL", date: "2026-01-01", close: 100 }],
    });
    const parsed = JSON.parse(toUserDataJson(data));
    expect(parsed.prices).toBeUndefined();
    expect(parsed.tickerDatabase).toBeUndefined();
    expect(parsed.historicalDailyCloses).toBeUndefined();
  });

  it("사용자 데이터(accounts/ledger/trades 등)는 보존", () => {
    const data = makeAppData({
      accounts: [{ id: "a1", name: "주거래", institution: "은행", type: "checking" as const, initialBalance: 100 }],
      ledger: [{ id: "l1", date: "2026-01-01", kind: "expense" as const, category: "식비", description: "점심", amount: 10000 }],
      trades: [{ id: "t1", date: "2026-01-01", accountId: "a1", ticker: "AAPL", name: "Apple", side: "buy" as const, quantity: 1, price: 100, fee: 0, totalAmount: 100, cashImpact: -100 }],
    });
    const parsed = JSON.parse(toUserDataJson(data));
    expect(parsed.accounts).toHaveLength(1);
    expect(parsed.accounts[0].name).toBe("주거래");
    expect(parsed.ledger).toHaveLength(1);
    expect(parsed.ledger[0].category).toBe("식비");
    expect(parsed.trades).toHaveLength(1);
    expect(parsed.trades[0].ticker).toBe("AAPL");
  });

  it("round-trip: 캐시 제거를 제외하면 JSON.stringify와 동일", () => {
    const data = makeAppData({
      accounts: [{ id: "a1", name: "X", institution: "Y", type: "checking" as const, initialBalance: 0 }],
      prices: [{ ticker: "X", price: 1 }],
    });
    const userJson = toUserDataJson(data);
    const reparsed = JSON.parse(userJson) as AppData;
    expect(reparsed.accounts).toEqual(data.accounts);
    expect(reparsed.ledger).toEqual([]);
    expect(reparsed.prices).toBeUndefined();
  });

  it("빈 AppData도 유효 JSON 반환", () => {
    const json = toUserDataJson(makeAppData());
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.accounts).toEqual([]);
    expect(parsed.ledger).toEqual([]);
  });

  it("investmentGoals(대시보드 목표)도 export에 포함 — gist 동기화 누락 회귀 방지", () => {
    const data = makeAppData({
      investmentGoals: {
        annualDepositTarget: 12_000_000,
        finalTotalAssetTarget: 1_000_000_000,
        targetAnnualDividend: 6_000_000,
        investmentStartDate: "2020-01-01",
      },
    });
    const parsed = JSON.parse(toUserDataJson(data));
    expect(parsed.investmentGoals).toEqual({
      annualDepositTarget: 12_000_000,
      finalTotalAssetTarget: 1_000_000_000,
      targetAnnualDividend: 6_000_000,
      investmentStartDate: "2020-01-01",
    });
  });

  it("선택 필드(targetPortfolios/loans 등)도 보존", () => {
    const data = makeAppData({
      targetPortfolios: [{ id: "p1", name: "ISA", accountId: null, items: [] }],
      loans: [{
        id: "L1",
        institution: "은행",
        loanName: "주담대",
        loanAmount: 100000000,
        annualInterestRate: 4.5,
        repaymentMethod: "equal_payment",
        loanDate: "2026-01-01",
        maturityDate: "2056-01-01",
      }],
    });
    const parsed = JSON.parse(toUserDataJson(data));
    expect(parsed.targetPortfolios).toHaveLength(1);
    expect(parsed.loans).toHaveLength(1);
    expect(parsed.loans[0].loanName).toBe("주담대");
  });
});

describe("loadData round-trip — investmentGoals 보존", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("save → load 후 investmentGoals 유지 (회귀: 이전엔 loadData가 필드 누락해서 매번 초기화됨)", () => {
    const data = makeAppData({
      investmentGoals: {
        annualDepositTarget: 12_000_000,
        finalTotalAssetTarget: 500_000_000,
        targetAnnualDividend: 3_600_000,
        investmentStartDate: "2021-03-15",
      },
    });
    saveData(data);
    const loaded = loadData();
    expect(loaded.investmentGoals).toEqual(data.investmentGoals);
  });

  it("부분 설정도 보존 (annualDepositTarget만)", () => {
    const data = makeAppData({ investmentGoals: { annualDepositTarget: 6_000_000 } });
    saveData(data);
    const loaded = loadData();
    expect(loaded.investmentGoals).toEqual({ annualDepositTarget: 6_000_000 });
  });

  it("investmentGoals 미설정 시 undefined 유지", () => {
    saveData(makeAppData());
    const loaded = loadData();
    expect(loaded.investmentGoals).toBeUndefined();
  });

  it("손상된 값(NaN/문자열)이 섞이면 그 필드만 떨군다 — 부분 복원", () => {
    // 직접 localStorage에 손상 데이터 주입 (saveData는 정상 데이터만 받기 때문)
    const corrupt = {
      ...makeAppData(),
      investmentGoals: {
        annualDepositTarget: NaN,                   // 떨굼
        finalTotalAssetTarget: "1000" as unknown,    // 떨굼 (문자열)
        targetAnnualDividend: 2_400_000,            // 통과
        investmentStartDate: "",                     // 떨굼 (빈 문자열)
      },
    };
    window.localStorage.setItem(STORAGE_KEYS.DATA, JSON.stringify(corrupt));
    const loaded = loadData();
    expect(loaded.investmentGoals).toEqual({ targetAnnualDividend: 2_400_000 });
  });

  it("마이그레이션: 직전 버전 targetMonthlyDividend가 있으면 ×12로 연 환산해서 targetAnnualDividend로 저장", () => {
    const oldFormatData = {
      ...makeAppData(),
      investmentGoals: {
        annualDepositTarget: 6_000_000,
        targetMonthlyDividend: 200_000,  // 월 20만 → 연 240만으로 환산되어야 함
      },
    };
    window.localStorage.setItem(STORAGE_KEYS.DATA, JSON.stringify(oldFormatData));
    const loaded = loadData();
    expect(loaded.investmentGoals).toEqual({
      annualDepositTarget: 6_000_000,
      targetAnnualDividend: 2_400_000,
    });
  });

  it("마이그레이션 우선순위: 새 필드(targetAnnualDividend)가 있으면 구 필드는 무시", () => {
    const data = {
      ...makeAppData(),
      investmentGoals: {
        targetAnnualDividend: 5_000_000,
        targetMonthlyDividend: 999_999,  // 무시되어야 함
      },
    };
    window.localStorage.setItem(STORAGE_KEYS.DATA, JSON.stringify(data));
    const loaded = loadData();
    expect(loaded.investmentGoals).toEqual({ targetAnnualDividend: 5_000_000 });
  });

  it("회귀: 구버전 retirementDate 필드가 남아있어도 무시되어 정상 로드 — 마이그레이션 안전망", () => {
    const oldFormatData = {
      ...makeAppData(),
      investmentGoals: {
        annualDepositTarget: 6_000_000,
        retirementDate: "2050-01-01",  // 더 이상 사용 안 하는 필드 — 조용히 폐기
      },
    };
    window.localStorage.setItem(STORAGE_KEYS.DATA, JSON.stringify(oldFormatData));
    const loaded = loadData();
    expect(loaded.investmentGoals).toEqual({ annualDepositTarget: 6_000_000 });
    // retirementDate는 새 타입에 없음 — 폐기됐는지 확인
    expect((loaded.investmentGoals as Record<string, unknown>).retirementDate).toBeUndefined();
  });
});

describe("loadData round-trip — 필드 보존 (dailyBudget 포함)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  const sampleDailyBudget: DailyBudgetConfig = {
    enabled: true,
    dailyLimit: 25_000,
    mode: "weekly",
    excludedCategories: ["이체", "수입"],
    excludedSubCategories: ["통신비"],
    warnOnExceed: false,
  };

  it("save → load 후 dailyBudget 유지 (회귀: loadData 필드 누락으로 새로고침마다 유실)", () => {
    const data = makeAppData({ dailyBudget: sampleDailyBudget });
    saveData(data);
    const loaded = loadData();
    expect(loaded.dailyBudget).toEqual(sampleDailyBudget);
  });

  it("dailyBudget 미설정 시 undefined 유지", () => {
    saveData(makeAppData());
    const loaded = loadData();
    expect(loaded.dailyBudget).toBeUndefined();
  });

  it("dailyLimit이 손상(NaN/문자열)되면 설정 전체를 미설정으로 처리", () => {
    const corrupt = {
      ...makeAppData(),
      dailyBudget: { enabled: true, dailyLimit: "abc", mode: "daily" },
    };
    window.localStorage.setItem(STORAGE_KEYS.DATA, JSON.stringify(corrupt));
    const loaded = loadData();
    expect(loaded.dailyBudget).toBeUndefined();
  });

  it("주요 사용자 필드 전수 왕복 보존 (ledger/trades/loans/workoutWeeks/dailyBudget/investmentGoals 등)", () => {
    const data = makeAppData({
      accounts: [{ id: "a1", name: "주거래", institution: "은행", type: "checking" as const, initialBalance: 100 }],
      ledger: [{ id: "l1", date: "2026-01-01", kind: "expense" as const, category: "식비", description: "점심", amount: 10000 }],
      trades: [{ id: "t1", date: "2026-01-01", accountId: "a1", ticker: "AAPL", name: "Apple", side: "buy" as const, quantity: 1, price: 100, fee: 0, totalAmount: 100, cashImpact: -100 }],
      recurringExpenses: [{ id: "r1", title: "넷플", amount: 17000, category: "구독비", frequency: "monthly" as const, startDate: "2026-01-01" }],
      budgetGoals: [{ id: "b1", category: "식비", monthlyLimit: 300000 }],
      loans: [{ id: "L1", institution: "은행", loanName: "주담대", loanAmount: 1, annualInterestRate: 4, repaymentMethod: "equal_payment" as const, loanDate: "2026-01-01", maturityDate: "2056-01-01" }],
      workoutWeeks: [{ id: "w1", weekStart: "2026-01-05", entries: [] }],
      customExercises: [{ name: "케이블 크런치", bodyPart: "코어" as const, addedAt: "2026-01-01T00:00:00.000Z" }],
      targetNetWorthCurve: { "2026-12-31": 100000000 },
      dividendTrackingTicker: "005930",
      investmentGoals: { annualDepositTarget: 12_000_000 },
      dailyBudget: sampleDailyBudget,
    } as Partial<AppData>);
    saveData(data);
    const loaded = loadData();
    expect(loaded.accounts).toHaveLength(1);
    expect(loaded.ledger).toEqual(data.ledger);
    expect(loaded.trades).toEqual(data.trades);
    expect(loaded.recurringExpenses).toEqual(data.recurringExpenses);
    expect(loaded.budgetGoals).toEqual(data.budgetGoals);
    expect(loaded.loans).toEqual(data.loans);
    expect(loaded.workoutWeeks).toEqual(data.workoutWeeks);
    expect(loaded.customExercises).toEqual(data.customExercises);
    expect(loaded.targetNetWorthCurve).toEqual(data.targetNetWorthCurve);
    expect(loaded.dividendTrackingTicker).toBe("005930");
    expect(loaded.investmentGoals).toEqual(data.investmentGoals);
    expect(loaded.dailyBudget).toEqual(sampleDailyBudget);
  });

  it("workoutRoutines: 빈 배열로 '존재'하면 시드 재주입 없이 빈 배열 유지 (사용자의 전부 삭제 존중)", () => {
    const data = { ...makeAppData(), workoutRoutines: [] };
    window.localStorage.setItem(STORAGE_KEYS.DATA, JSON.stringify(data));
    const loaded = loadData();
    expect(loaded.workoutRoutines).toEqual([]);
  });

  it("workoutRoutines: 필드가 '부재'하면 기본 시드 주입", () => {
    window.localStorage.setItem(STORAGE_KEYS.DATA, JSON.stringify(makeAppData()));
    const loaded = loadData();
    expect((loaded.workoutRoutines ?? []).length).toBeGreaterThan(0);
  });
});

describe("normalizeImportedData — 순수 함수 (localStorage 부작용 없음)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("호출 전후 localStorage(DATA/CACHE/스키마 버전)가 변하지 않는다", () => {
    window.localStorage.setItem(STORAGE_KEYS.DATA, '{"ledger":[]}');
    window.localStorage.setItem(STORAGE_KEYS.DATA_SCHEMA_VERSION, "12");
    window.localStorage.setItem(STORAGE_KEYS.CACHE, '{"prices":[]}');

    const imported = makeAppData({
      ledger: [{ id: "x1", date: "2026-01-01", kind: "expense" as const, category: "식비", description: "a", amount: 1000 }],
    });
    const result = normalizeImportedData(imported);

    expect(result.ledger).toHaveLength(1);
    expect(window.localStorage.getItem(STORAGE_KEYS.DATA)).toBe('{"ledger":[]}');
    expect(window.localStorage.getItem(STORAGE_KEYS.DATA_SCHEMA_VERSION)).toBe("12");
    expect(window.localStorage.getItem(STORAGE_KEYS.CACHE)).toBe('{"prices":[]}');
  });

  it("schemaVersion이 있으면 그 버전 기준으로 마이그레이션 (v9 백업: income 데이트비 → 데이트통장)", () => {
    const oldBackup = {
      ...makeAppData(),
      schemaVersion: 9,
      ledger: [
        { id: "i1", date: "2026-03-30", kind: "income", category: "데이트비", description: "", amount: 300_000 },
      ],
    };
    const result = normalizeImportedData(oldBackup);
    expect(result.ledger[0].category).toBe("데이트통장");
  });

  it("schemaVersion이 없으면 보수적으로 현 버전 취급 — 추정 마이그레이션으로 데이터를 건드리지 않음", () => {
    const backup = {
      ...makeAppData(),
      ledger: [
        { id: "i1", date: "2026-03-30", kind: "income", category: "데이트비", description: "", amount: 300_000 },
      ],
    };
    const result = normalizeImportedData(backup);
    expect(result.ledger[0].category).toBe("데이트비");
  });

  it("dailyBudget을 포함한 가져오기 데이터가 보존된다", () => {
    const imported = makeAppData({
      dailyBudget: {
        enabled: true,
        dailyLimit: 30_000,
        mode: "daily" as const,
        excludedCategories: [],
        excludedSubCategories: [],
        warnOnExceed: true,
      },
    });
    const result = normalizeImportedData(imported);
    expect(result.dailyBudget?.enabled).toBe(true);
    expect(result.dailyBudget?.dailyLimit).toBe(30_000);
  });

  it("배열이어야 할 필드가 배열이 아니면 throw (검증 유지)", () => {
    expect(() => normalizeImportedData({ ledger: "oops" })).toThrow();
    expect(() => normalizeImportedData(null)).toThrow();
    expect(() => normalizeImportedData([1, 2])).toThrow();
  });
});

describe("v10 migration: 데이트 입금 카테고리 통일", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("kind=income, category='데이트비'를 '데이트통장'으로 변경", () => {
    const oldData = {
      ...makeAppData(),
      ledger: [
        { id: "i1", date: "2026-03-30", kind: "income", category: "데이트비", description: "", amount: 300_000 },
        { id: "i2", date: "2026-05-01", kind: "income", category: "데이트통장", description: "", amount: 300_000 },
      ],
    };
    window.localStorage.setItem(STORAGE_KEYS.DATA, JSON.stringify(oldData));
    // 직전 schema 버전을 9로 강제 → v10 migration 트리거
    window.localStorage.setItem(STORAGE_KEYS.DATA_SCHEMA_VERSION, "9");
    const loaded = loadData();
    expect(loaded.ledger[0].category).toBe("데이트통장");
    expect(loaded.ledger[1].category).toBe("데이트통장");
  });

  it("kind=expense의 '데이트비'는 그대로 유지 (지출 카테고리는 정상 사용)", () => {
    const oldData = {
      ...makeAppData(),
      ledger: [
        { id: "e1", date: "2026-04-01", kind: "expense", category: "데이트비", description: "저녁", amount: 50_000 },
        { id: "i1", date: "2026-04-01", kind: "income", category: "데이트비", description: "", amount: 300_000 },
      ],
    };
    window.localStorage.setItem(STORAGE_KEYS.DATA, JSON.stringify(oldData));
    window.localStorage.setItem(STORAGE_KEYS.DATA_SCHEMA_VERSION, "9");
    const loaded = loadData();
    expect(loaded.ledger.find((l) => l.id === "e1")?.category).toBe("데이트비");
    expect(loaded.ledger.find((l) => l.id === "i1")?.category).toBe("데이트통장");
  });

  it("loadData 후 income preset에 '데이트통장' 보장 (mergeCategoryPresets 방어선)", () => {
    const oldData = {
      ...makeAppData({
        categoryPresets: { income: ["급여", "기타수입"], expense: [], transfer: [] }
      }),
    };
    window.localStorage.setItem(STORAGE_KEYS.DATA, JSON.stringify(oldData));
    const loaded = loadData();
    expect(loaded.categoryPresets.income).toContain("데이트통장");
    // "기타수입" 직전에 삽입됐는지 확인
    const idx = loaded.categoryPresets.income.indexOf("데이트통장");
    const otherIdx = loaded.categoryPresets.income.indexOf("기타수입");
    expect(idx).toBeLessThan(otherIdx);
  });
});
