import { describe, it, expect } from "vitest";
import { computeRealizedPnlByTradeId } from "../calculations";
import type { StockTrade } from "../types";

function makeTrade(overrides: Partial<StockTrade> & { id: string; side: "buy" | "sell" }): StockTrade {
  return {
    date: "2026-01-01",
    accountId: "acc1",
    ticker: "AAPL",
    name: "Apple",
    quantity: 1,
    price: 100,
    fee: 0,
    totalAmount: 100,
    cashImpact: 0,
    ...overrides,
  };
}

describe("computeRealizedPnlByTradeId (FIFO)", () => {
  it("매수만 있으면 실현손익 없음", () => {
    const trades = [makeTrade({ id: "b1", side: "buy", quantity: 10, price: 100, totalAmount: 1000 })];
    const result = computeRealizedPnlByTradeId(trades);
    expect(result.get("b1")).toBeUndefined();
  });

  it("매수 후 매도 시 FIFO 실현손익 계산", () => {
    const trades = [
      makeTrade({ id: "b1", side: "buy", date: "2026-01-01", quantity: 10, price: 100, totalAmount: 1000 }),
      makeTrade({ id: "s1", side: "sell", date: "2026-02-01", quantity: 10, price: 150, totalAmount: 1500 }),
    ];
    const result = computeRealizedPnlByTradeId(trades);
    expect(result.get("s1")).toBe(500); // (150-100) * 10
  });

  it("부분 매도 시 정확한 손익", () => {
    const trades = [
      makeTrade({ id: "b1", side: "buy", date: "2026-01-01", quantity: 10, price: 100, totalAmount: 1000 }),
      makeTrade({ id: "s1", side: "sell", date: "2026-02-01", quantity: 5, price: 120, totalAmount: 600 }),
    ];
    const result = computeRealizedPnlByTradeId(trades);
    expect(result.get("s1")).toBe(100); // (120-100) * 5
  });

  it("손실 매도", () => {
    const trades = [
      makeTrade({ id: "b1", side: "buy", date: "2026-01-01", quantity: 10, price: 100, totalAmount: 1000 }),
      makeTrade({ id: "s1", side: "sell", date: "2026-02-01", quantity: 10, price: 80, totalAmount: 800 }),
    ];
    const result = computeRealizedPnlByTradeId(trades);
    expect(result.get("s1")).toBe(-200); // (80-100) * 10
  });
});
