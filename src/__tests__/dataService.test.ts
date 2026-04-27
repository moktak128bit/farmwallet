import { describe, it, expect, beforeEach } from "vitest";
import { toUserDataJson, loadData, saveData } from "../services/dataService";
import { STORAGE_KEYS } from "../constants/config";
import type { AppData } from "../types";

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
