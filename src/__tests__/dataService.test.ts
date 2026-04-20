import { describe, it, expect } from "vitest";
import { toUserDataJson } from "../services/dataService";
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
