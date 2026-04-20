import { describe, it, expect } from "vitest";
import { mergeCacheIntoAppData, type CacheData } from "../services/cacheStore";
import type { AppData } from "../types";

function makeData(overrides: Partial<AppData> = {}): AppData {
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

describe("mergeCacheIntoAppData", () => {
  it("캐시가 비어 있으면 원본 유지", () => {
    const data = makeData({ prices: [{ ticker: "X", price: 1 }] });
    const empty: CacheData = { prices: [], tickerDatabase: [], historicalDailyCloses: [] };
    const merged = mergeCacheIntoAppData(data, empty);
    expect(merged.prices).toEqual(data.prices);
    expect(merged.prices).toBe(data.prices); // reference 유지
  });

  it("캐시에 prices 있으면 교체", () => {
    const data = makeData({ prices: [] });
    const cache: CacheData = {
      prices: [{ ticker: "AAPL", price: 150 }],
      tickerDatabase: [],
      historicalDailyCloses: [],
    };
    const merged = mergeCacheIntoAppData(data, cache);
    expect(merged.prices).toEqual([{ ticker: "AAPL", price: 150 }]);
  });

  it("캐시에 tickerDatabase 있으면 교체", () => {
    const data = makeData();
    const cache: CacheData = {
      prices: [],
      tickerDatabase: [{ ticker: "AAPL", name: "Apple", market: "US" }],
      historicalDailyCloses: [],
    };
    const merged = mergeCacheIntoAppData(data, cache);
    expect(merged.tickerDatabase).toHaveLength(1);
    expect(merged.tickerDatabase?.[0].ticker).toBe("AAPL");
  });

  it("사용자 데이터(accounts/ledger)는 영향 없음", () => {
    const data = makeData({
      accounts: [{ id: "a1", name: "x", institution: "y", type: "checking", initialBalance: 0 }],
      ledger: [{ id: "l1", date: "2026-01-01", kind: "expense", category: "x", description: "n", amount: 1 }],
    });
    const cache: CacheData = {
      prices: [{ ticker: "X", price: 1 }],
      tickerDatabase: [],
      historicalDailyCloses: [],
    };
    const merged = mergeCacheIntoAppData(data, cache);
    expect(merged.accounts).toBe(data.accounts);
    expect(merged.ledger).toBe(data.ledger);
    expect(merged.prices).not.toBe(data.prices);
  });
});
