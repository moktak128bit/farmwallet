import { describe, it, expect } from "vitest";
import { tradeAmountKRW, isUSDStock } from "../utils/finance";

describe("tradeAmountKRW", () => {
  it("KRW 종목은 totalAmount 그대로 (환율 무시)", () => {
    expect(tradeAmountKRW({ ticker: "005930", totalAmount: 70000, fxRateAtTrade: 1500 }, 1500)).toBe(70000);
  });

  it("USD 종목 + fxRateAtTrade 있음 → 환산", () => {
    expect(tradeAmountKRW({ ticker: "MSFT", totalAmount: 100, fxRateAtTrade: 1500 })).toBe(150_000);
  });

  it("USD 종목 + fxRateAtTrade 누락 → fallback fxRate 사용 (회귀: 이전엔 USD 금액 그대로 합산되던 버그)", () => {
    expect(tradeAmountKRW({ ticker: "RKLB", totalAmount: 100 }, 1400)).toBe(140_000);
  });

  it("USD 종목 + fxRateAtTrade 0 → fallback 사용", () => {
    expect(tradeAmountKRW({ ticker: "AAPL", totalAmount: 100, fxRateAtTrade: 0 }, 1300)).toBe(130_000);
  });

  it("USD 종목인데 fxRateAtTrade도 없고 fallback도 없으면 0 — USD/KRW 단위 섞임 방지", () => {
    expect(tradeAmountKRW({ ticker: "RKLB", totalAmount: 100 })).toBe(0);
    expect(tradeAmountKRW({ ticker: "RKLB", totalAmount: 100 }, null)).toBe(0);
    expect(tradeAmountKRW({ ticker: "RKLB", totalAmount: 100 }, 0)).toBe(0);
  });

  it("fxRateAtTrade가 fallback보다 우선", () => {
    expect(tradeAmountKRW({ ticker: "MSFT", totalAmount: 100, fxRateAtTrade: 1500 }, 1400)).toBe(150_000);
  });

  it("실제 사용자 데이터 회귀 — RKLB sell 4131.78 USD without fxRateAtTrade", () => {
    // 이전 버그: 4131.78이 그대로 KRW 합계에 들어가 sellTotal 망가짐.
    // 수정 후: fallback 환율로 환산 OR 0
    expect(tradeAmountKRW({ ticker: "RKLB", totalAmount: 4131.78 }, 1500)).toBeCloseTo(6_197_670, 0);
  });

  it("isUSDStock 판정 일관성 — KRW 6자 코드는 KRW", () => {
    expect(isUSDStock("005930")).toBe(false);
    expect(isUSDStock("0048J0")).toBe(false);
  });

  it("isUSDStock 판정 — 짧은 영문 ticker는 USD", () => {
    expect(isUSDStock("MSFT")).toBe(true);
    expect(isUSDStock("AAPL")).toBe(true);
    expect(isUSDStock("RKLB")).toBe(true);
  });
});
