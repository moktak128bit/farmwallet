/** A0 키스톤 — 일별 포트폴리오 평가액 시계열 (utils/portfolioHistory) */
import { describe, expect, it } from "vitest";
import type { Account, HistoricalDailyClose, StockTrade } from "../types";
import { buildDailyPortfolioValueSeries, firstTradeDate, fxAsOf } from "../utils/portfolioHistory";

const accounts: Account[] = [
  { id: "sec1", name: "증권", institution: "", type: "securities", initialBalance: 0 },
];

let tid = 0;
const buy = (
  ticker: string,
  date: string,
  qty: number,
  price: number,
  fxRateAtTrade?: number
): StockTrade => ({
  id: `t${tid++}`,
  date,
  accountId: "sec1",
  ticker,
  name: ticker,
  side: "buy",
  quantity: qty,
  price,
  fee: 0,
  totalAmount: qty * price,
  cashImpact: -(qty * price),
  ...(fxRateAtTrade != null ? { fxRateAtTrade } : {}),
});
const sell = (ticker: string, date: string, qty: number, price: number): StockTrade => ({
  id: `t${tid++}`,
  date,
  accountId: "sec1",
  ticker,
  name: ticker,
  side: "sell",
  quantity: qty,
  price,
  fee: 0,
  totalAmount: qty * price,
  cashImpact: qty * price,
});
const close = (
  ticker: string,
  date: string,
  c: number,
  currency?: string
): HistoricalDailyClose => ({ ticker, date, close: c, currency });

const at = <T extends { date: string }>(series: T[], date: string): T =>
  series.find((p) => p.date === date)!;

describe("buildDailyPortfolioValueSeries", () => {
  it("KRW 종목: 일별 평가액이 그날의 종가를 따라간다", () => {
    const trades = [buy("005930", "2026-01-02", 10, 1000)];
    const closes = [close("005930", "2026-01-02", 1000), close("005930", "2026-01-03", 1200)];
    const series = buildDailyPortfolioValueSeries({
      trades,
      accounts,
      historicalDailyCloses: closes,
      fxHistory: [],
      endDate: "2026-01-03",
    });
    expect(series).toHaveLength(2);
    expect(at(series, "2026-01-02")).toMatchObject({ valueKRW: 10000, costKRW: 10000, pnlKRW: 0 });
    expect(at(series, "2026-01-03")).toMatchObject({ valueKRW: 12000, costKRW: 10000, pnlKRW: 2000 });
  });

  it("첫 거래일 이전은 평가액 0", () => {
    const trades = [buy("005930", "2026-01-02", 10, 1000)];
    const series = buildDailyPortfolioValueSeries({
      trades,
      accounts,
      historicalDailyCloses: [close("005930", "2026-01-02", 1000)],
      fxHistory: [],
      startDate: "2026-01-01",
      endDate: "2026-01-02",
    });
    expect(at(series, "2026-01-01")).toMatchObject({ valueKRW: 0, costKRW: 0 });
    expect(at(series, "2026-01-02").valueKRW).toBe(10000);
  });

  it("해당일 종가가 아직 없으면 매입원가로 중립 처리(priceFallback=cost)", () => {
    const trades = [buy("005930", "2026-01-02", 10, 1000)];
    // 종가는 다음날부터만 존재 → 매수일 당일은 cost로
    const closes = [close("005930", "2026-01-03", 1200)];
    const series = buildDailyPortfolioValueSeries({
      trades,
      accounts,
      historicalDailyCloses: closes,
      fxHistory: [],
      endDate: "2026-01-03",
    });
    expect(at(series, "2026-01-02")).toMatchObject({ valueKRW: 10000, pnlKRW: 0 });
    expect(at(series, "2026-01-03").valueKRW).toBe(12000);
  });

  it("매도하면 보유수량이 줄어 평가액에 반영된다 (FIFO)", () => {
    const trades = [buy("005930", "2026-01-02", 10, 1000), sell("005930", "2026-01-04", 4, 1500)];
    const closes = [close("005930", "2026-01-02", 1000), close("005930", "2026-01-05", 1300)];
    const series = buildDailyPortfolioValueSeries({
      trades,
      accounts,
      historicalDailyCloses: closes,
      fxHistory: [],
      endDate: "2026-01-05",
    });
    // 01-05: 보유 6주 × 1300 = 7800, 원가 6주 × 1000 = 6000
    expect(at(series, "2026-01-05")).toMatchObject({ valueKRW: 7800, costKRW: 6000, pnlKRW: 1800 });
  });

  it("USD 종목: 그날의 환율로 환산, 원가는 매입 당시 환율로", () => {
    const trades = [buy("AAPL", "2026-01-02", 5, 100, 1300)];
    const closes = [close("AAPL", "2026-01-03", 110, "USD")];
    const series = buildDailyPortfolioValueSeries({
      trades,
      accounts,
      historicalDailyCloses: closes,
      fxHistory: [{ date: "2026-01-03", rate: 1350 }],
      fallbackFxRate: 1300,
      endDate: "2026-01-03",
    });
    // 평가 = 5 × 110 × 1350 = 742,500 / 원가 = 5 × 100 × 1300 = 650,000
    expect(at(series, "2026-01-03")).toMatchObject({ valueKRW: 742500, costKRW: 650000 });
  });

  it("환율 이력이 없으면 fallbackFxRate로 환산", () => {
    const trades = [buy("AAPL", "2026-01-02", 5, 100, 1300)];
    const closes = [close("AAPL", "2026-01-03", 110, "USD")];
    const series = buildDailyPortfolioValueSeries({
      trades,
      accounts,
      historicalDailyCloses: closes,
      fxHistory: [],
      fallbackFxRate: 1400,
      endDate: "2026-01-03",
    });
    expect(at(series, "2026-01-03").valueKRW).toBe(5 * 110 * 1400);
  });

  it("weekly 샘플링은 7일 간격으로 점을 만든다", () => {
    const trades = [buy("005930", "2026-01-02", 10, 1000)];
    const closes = [close("005930", "2026-01-02", 1000)];
    const series = buildDailyPortfolioValueSeries({
      trades,
      accounts,
      historicalDailyCloses: closes,
      fxHistory: [],
      endDate: "2026-01-16",
      step: "weekly",
    });
    expect(series.map((p) => p.date)).toEqual(["2026-01-02", "2026-01-09", "2026-01-16"]);
  });

  it("거래가 없으면 빈 배열", () => {
    expect(
      buildDailyPortfolioValueSeries({
        trades: [],
        accounts,
        historicalDailyCloses: [],
        fxHistory: [],
        endDate: "2026-01-03",
      })
    ).toEqual([]);
  });
});

describe("firstTradeDate / fxAsOf", () => {
  it("firstTradeDate는 가장 이른 거래일", () => {
    expect(
      firstTradeDate([buy("A", "2026-03-01", 1, 1), buy("B", "2026-01-15", 1, 1)])
    ).toBe("2026-01-15");
    expect(firstTradeDate([])).toBeNull();
  });

  it("fxAsOf는 date 이전(포함) 가장 최근 환율, 없으면 fallback", () => {
    const fx = [
      { date: "2026-01-01", rate: 1300 },
      { date: "2026-02-01", rate: 1350 },
    ];
    expect(fxAsOf(fx, "2026-01-20")).toBe(1300);
    expect(fxAsOf(fx, "2026-02-05")).toBe(1350);
    expect(fxAsOf(fx, "2025-12-01", 1280)).toBe(1280);
    expect(fxAsOf([], "2026-01-01")).toBeNull();
  });
});
