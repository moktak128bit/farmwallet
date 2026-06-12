import { describe, it, expect } from "vitest";
import { tradeAmountKRW, isUSDStock, getCurrentHoldingsTickers, cryptoDisplaySymbol, extractTickerFromText } from "../utils/finance";

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

  it("회귀: isUSDStock — 5자 티커(GOOGL)·클래스 접미사(BRK.B)도 USD", () => {
    expect(isUSDStock("GOOGL")).toBe(true);
    expect(isUSDStock("BRK.B")).toBe(true);
    expect(isUSDStock("AAPL")).toBe(true);
    // 한국 6자 코드는 KRW
    expect(isUSDStock("005930")).toBe(false);
    // 암호화폐(CoinGecko ID)는 isCryptoStock 우선 — USD 주식 아님
    expect(isUSDStock("bitcoin")).toBe(false);
    expect(isUSDStock("solana")).toBe(false);
    // 1자 미국 티커(F, T)도 USD 유지
    expect(isUSDStock("F")).toBe(true);
  });

  it("회귀: 5자 USD 티커 환산 — GOOGL이 KRW로 잘못 합산되지 않음", () => {
    expect(tradeAmountKRW({ ticker: "GOOGL", totalAmount: 100, fxRateAtTrade: 1400 })).toBe(140_000);
    expect(tradeAmountKRW({ ticker: "BRK.B", totalAmount: 100 }, 1400)).toBe(140_000);
  });
});

describe("extractTickerFromText", () => {
  it("6자리 한국 코드 우선 추출", () => {
    expect(extractTickerFromText("005930 - 삼성전자 배당")).toBe("005930");
  });

  it("영문 티커 추출", () => {
    expect(extractTickerFromText("AAPL - Apple 배당")).toBe("AAPL");
  });

  it("회귀: 숫자-only 토큰('2024')을 티커로 오인하지 않음", () => {
    expect(extractTickerFromText("2024 결산 이자")).toBeNull();
    expect(extractTickerFromText("이자 (이율: 3.5%)")).toBeNull();
    expect(extractTickerFromText("2024 AAPL 배당")).toBe("AAPL");
  });
});

describe("getCurrentHoldingsTickers", () => {
  it("매수 후 미매도 → 포함", () => {
    const trades = [{ ticker: "MSFT", quantity: 10, side: "buy" as const }];
    expect(getCurrentHoldingsTickers(trades)).toEqual(["MSFT"]);
  });

  it("매수 == 매도(완전 청산) → 제외", () => {
    const trades = [
      { ticker: "MSFT", quantity: 10, side: "buy" as const },
      { ticker: "MSFT", quantity: 10, side: "sell" as const },
    ];
    expect(getCurrentHoldingsTickers(trades)).toEqual([]);
  });

  it("일부 매도 후 잔량 있음 → 포함", () => {
    const trades = [
      { ticker: "MSFT", quantity: 10, side: "buy" as const },
      { ticker: "MSFT", quantity: 3, side: "sell" as const },
    ];
    expect(getCurrentHoldingsTickers(trades)).toEqual(["MSFT"]);
  });

  it("여러 종목 — 청산된 것만 제외", () => {
    const trades = [
      { ticker: "MSFT", quantity: 10, side: "buy" as const },
      { ticker: "AAPL", quantity: 5, side: "buy" as const },
      { ticker: "AAPL", quantity: 5, side: "sell" as const },
      { ticker: "RKLB", quantity: 20, side: "buy" as const },
    ];
    expect(getCurrentHoldingsTickers(trades).sort()).toEqual(["MSFT", "RKLB"]);
  });

  it("코인 잔량 — 1e-8 이하는 0으로 간주 (부동소수점 미세 오차 보호)", () => {
    const trades = [
      { ticker: "SOLANA", quantity: 1.5, side: "buy" as const },
      { ticker: "SOLANA", quantity: 1.4999999999, side: "sell" as const },
    ];
    expect(getCurrentHoldingsTickers(trades)).toEqual([]);
  });

  it("잘못된 quantity (NaN/Infinity)는 무시", () => {
    const trades = [
      { ticker: "MSFT", quantity: NaN, side: "buy" as const },
      { ticker: "AAPL", quantity: 5, side: "buy" as const },
    ];
    expect(getCurrentHoldingsTickers(trades)).toEqual(["AAPL"]);
  });

  it("매도가 매수보다 많아 음수 잔량 → 제외", () => {
    const trades = [
      { ticker: "MSFT", quantity: 5, side: "buy" as const },
      { ticker: "MSFT", quantity: 10, side: "sell" as const },
    ];
    expect(getCurrentHoldingsTickers(trades)).toEqual([]);
  });

  it("빈 배열", () => {
    expect(getCurrentHoldingsTickers([])).toEqual([]);
  });

  it("회귀: cryptoDisplaySymbol — CoinGecko ID 풀네임 → short symbol", () => {
    // 사용자 데이터: ticker='solana' 인데 업비트 표기는 'SOL' — 표시 시 변환
    expect(cryptoDisplaySymbol("solana")).toBe("SOL");
    expect(cryptoDisplaySymbol("ethereum")).toBe("ETH");
    expect(cryptoDisplaySymbol("bitcoin")).toBe("BTC");
    // 대소문자 무관
    expect(cryptoDisplaySymbol("SOLANA")).toBe("SOL");
    expect(cryptoDisplaySymbol("Ethereum")).toBe("ETH");
    // 매핑에 없으면 원본 유지 (주식 ticker는 영향 X)
    expect(cryptoDisplaySymbol("MSFT")).toBe("MSFT");
    expect(cryptoDisplaySymbol("005930")).toBe("005930");
    expect(cryptoDisplaySymbol("0167B0")).toBe("0167B0");
  });

  it("회귀: 청산 종목이 자동 갱신 대상에서 제외 (yahoo API 호출 감소)", () => {
    // 사용자 데이터 시뮬: RKLB 모두 매도, 0167B0 보유 중
    const trades = [
      { ticker: "RKLB", quantity: 47, side: "buy" as const },
      { ticker: "RKLB", quantity: 47, side: "sell" as const },
      { ticker: "0167B0", quantity: 55, side: "buy" as const },
    ];
    const holdings = getCurrentHoldingsTickers(trades);
    expect(holdings).toContain("0167B0");
    expect(holdings).not.toContain("RKLB");
  });
});
