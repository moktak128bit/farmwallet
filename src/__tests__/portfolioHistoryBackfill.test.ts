import { describe, expect, it } from "vitest";
import type { HistoricalDailyClose, StockTrade } from "../types";
import { mergePortfolioHistory, portfolioHistoryRequests } from "../utils/portfolioHistoryBackfill";
import { upsertDailyCloses } from "../utils/dailyCloses";
import { buildPortfolioPerformance } from "../utils/portfolioPerformance";

const trade = (ticker: string, date: string, side: "buy" | "sell" = "buy"): StockTrade => ({
  id: `${ticker}-${date}-${side}`, accountId: "a", name: ticker, ticker, date, side,
  quantity: 10, price: 1000, fee: 0, totalAmount: 10000, cashImpact: side === "buy" ? -10000 : 10000,
});

describe("일별 포트폴리오 시세 보강", () => {
  it("청산한 종목의 과거 기간과 코인의 원화 시세도 요청한다", () => {
    const targets = portfolioHistoryRequests([
      trade("005930", "2025-01-02"), trade("005930", "2025-03-03", "sell"),
      trade("aapl", "2026-01-02"), trade("bitcoin", "2024-01-02"),
      trade("MSFT", "2027-01-01"),
    ], "2026-10-21");
    expect(targets).toEqual([
      { ticker: "005930", symbol: "005930", currency: "KRW", startDate: "2025-01-02", endDate: "2025-03-03", range: "2y" },
      { ticker: "AAPL", symbol: "AAPL", currency: "USD", startDate: "2026-01-02", endDate: "2026-10-21", range: "1y" },
      { ticker: "bitcoin", symbol: "BTC-KRW", currency: "KRW", startDate: "2024-01-02", endDate: "2026-10-21", range: "5y" },
    ]);
  });

  it("장중에 적립했던 과거 가격은 종가로 바꾸고, 오늘·다른 종목의 가격은 보존한다", () => {
    const old: HistoricalDailyClose[] = [
      { ticker: "005930", date: "2026-10-19", close: 900, currency: "KRW" },
      { ticker: "005930", date: "2026-10-21", close: 1200, currency: "KRW" },
      { ticker: "AAPL", date: "2026-10-19", close: 200, currency: "USD" },
    ];
    const result = mergePortfolioHistory(old, { ticker: "005930", currency: "KRW", startDate: "2026-10-19", endDate: "2026-10-21" }, [
      { date: "2026-10-18", close: 999 }, { date: "2026-10-19", close: 1000 },
      { date: "2026-10-20", close: 1100 }, { date: "2026-10-21", close: 1 },
      { date: "2026-10-22", close: 999 }, { date: "20261020", close: 800 },
      { date: "2026-10-20", close: NaN },
    ], "2026-10-21");
    expect(result.changed).toBe(2);
    expect(result.next).toEqual([
      { ticker: "005930", date: "2026-10-19", close: 1000, currency: "KRW" },
      old[2], { ticker: "005930", date: "2026-10-20", close: 1100, currency: "KRW" }, old[1],
    ]);
    expect(old[0].close).toBe(900);
  });

  it("보강 후 현재 시세를 갱신해도 120일 이전의 실제 일별 수익률과 기준선 100을 유지한다", () => {
    const trades = [trade("005930", "2025-10-20")];
    const merged = mergePortfolioHistory([], { ticker: "005930", currency: "KRW", startDate: "2025-10-20", endDate: "2026-10-21" }, [
      { date: "2025-10-20", close: 1000 }, { date: "2025-10-21", close: 800 }, { date: "2025-10-22", close: 1100 },
    ], "2026-10-21");
    const daily = upsertDailyCloses(merged.next, [{ ticker: "005930", price: 1200, updatedAt: "2026-10-21T15:30:00+09:00" }], trades, "2026-10-21")!;
    expect(daily.filter(c => c.date.startsWith("2025-10"))).toHaveLength(3);
    const perf = buildPortfolioPerformance({ data: {
      trades, accounts: [{ id: "a", name: "증권", institution: "", type: "securities", initialBalance: 0 }],
      historicalDailyCloses: daily, historicalDailyFx: [], marketEnvSnapshots: [],
      benchmarkDailyCloses: [
        { ticker: "^KS11", date: "2025-10-20", close: 2000 },
        { ticker: "^KS11", date: "2025-10-21", close: 2040 },
        { ticker: "^KS11", date: "2025-10-22", close: 2020 },
      ],
    }, fxRate: null, benchmarkTicker: "^KS11", period: "ALL", endDate: "2025-10-22" })!;
    expect(perf.benchmark!.series.map(p => Math.round(p.portfolio))).toEqual([100, 80, 110]);
    expect(perf.benchmark!.series.map(p => Math.round(p.benchmark))).toEqual([100, 102, 101]);
  });
});
