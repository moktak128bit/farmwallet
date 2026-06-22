/** A1 글루 — buildPortfolioPerformance(A0~A3 조합) + 벤치마크 upsert + 과거종가 파서 */
import { describe, expect, it } from "vitest";
import type { Account, HistoricalDailyClose, StockTrade } from "../types";
import { buildPortfolioPerformance, performanceStartDate, upsertBenchmarkCloses } from "../utils/portfolioPerformance";
import { parseHistoricalCloses } from "../utils/yahooChartParse";

const accounts: Account[] = [{ id: "sec1", name: "증권", institution: "", type: "securities", initialBalance: 0 }];
const buy = (ticker: string, date: string, qty: number, price: number): StockTrade => ({
  id: `t-${ticker}-${date}`,
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
});
const c = (ticker: string, date: string, close: number): HistoricalDailyClose => ({ ticker, date, close });

describe("buildPortfolioPerformance — 엔드투엔드", () => {
  it("TWR 수익률 + 벤치마크 초과수익 + 리스크를 조합한다", () => {
    const perf = buildPortfolioPerformance({
      data: {
        trades: [buy("005930", "2026-01-02", 10, 1000)],
        accounts,
        historicalDailyCloses: [c("005930", "2026-01-02", 1000), c("005930", "2026-01-05", 1100)],
        historicalDailyFx: [],
        marketEnvSnapshots: [],
        benchmarkDailyCloses: [c("^KS11", "2026-01-02", 2000), c("^KS11", "2026-01-05", 2040)],
      },
      fxRate: 1380,
      benchmarkTicker: "^KS11",
      benchmarkLabel: "KOSPI",
      period: "ALL",
      endDate: "2026-01-05",
    })!;
    // 포트 +10% (1000→1100, 매수 후 현금흐름 없음)
    expect(perf.twrReturnPct).toBeCloseTo(0.1, 5);
    // 벤치마크 +2%, 초과수익 +8%
    expect(perf.benchmark).not.toBeNull();
    expect(perf.benchmark!.benchmarkReturnPct).toBeCloseTo(0.02, 5);
    expect(perf.benchmark!.excessReturnPct).toBeCloseTo(0.08, 5);
    // 베타: 활성일에 포트가 시장의 5배(10% vs 2%) 움직임 → ≈5
    expect(perf.beta).toBeCloseTo(5, 1);
    expect(perf.risk.observations).toBeGreaterThan(0);
  });

  it("거래가 없으면 null", () => {
    expect(
      buildPortfolioPerformance({
        data: { trades: [], accounts, historicalDailyCloses: [], historicalDailyFx: [], marketEnvSnapshots: [], benchmarkDailyCloses: [] },
        fxRate: 1380,
      })
    ).toBeNull();
  });

  it("벤치마크 티커가 없으면 benchmark/beta는 null이지만 성과는 계산", () => {
    const perf = buildPortfolioPerformance({
      data: {
        trades: [buy("005930", "2026-01-02", 10, 1000)],
        accounts,
        historicalDailyCloses: [c("005930", "2026-01-02", 1000), c("005930", "2026-01-05", 1100)],
        historicalDailyFx: [],
        marketEnvSnapshots: [],
        benchmarkDailyCloses: [],
      },
      fxRate: 1380,
      period: "ALL",
      endDate: "2026-01-05",
    })!;
    expect(perf.benchmark).toBeNull();
    expect(perf.beta).toBeNull();
    expect(perf.twrReturnPct).toBeCloseTo(0.1, 5);
  });
});

describe("performanceStartDate", () => {
  it("기간이 첫 거래일보다 길면 첫 거래일로 클램프", () => {
    expect(performanceStartDate("1Y", "2026-06-22", "2026-05-01")).toBe("2026-05-01");
    expect(performanceStartDate("3M", "2026-06-22", "2025-01-01")).toBe("2026-03-24");
    expect(performanceStartDate("ALL", "2026-06-22", "2025-01-01")).toBe("2025-01-01");
  });
});

describe("upsertBenchmarkCloses", () => {
  it("같은 티커는 통째 교체, 다른 티커는 보존", () => {
    const existing: HistoricalDailyClose[] = [
      { ticker: "^KS11", date: "2026-01-01", close: 2000 },
      { ticker: "^GSPC", date: "2026-01-01", close: 5000 },
    ];
    const next = upsertBenchmarkCloses(existing, "^ks11", [
      { date: "2026-02-01", close: 2100 },
      { date: "2026-02-02", close: 2120 },
    ]);
    // ^KS11은 새 2건으로 교체, ^GSPC 보존
    expect(next.filter((x) => x.ticker === "^KS11")).toHaveLength(2);
    expect(next.find((x) => x.ticker === "^KS11")!.date).toBe("2026-02-01");
    expect(next.filter((x) => x.ticker === "^GSPC")).toHaveLength(1);
  });
});

describe("parseHistoricalCloses", () => {
  it("timestamp+close를 일별 종가로, null/0은 건너뛴다", () => {
    const t0 = 1767312000; // 2026-01-02 00:00 UTC 근처
    const data = {
      chart: {
        result: [
          {
            timestamp: [t0, t0 + 86400, t0 + 2 * 86400],
            indicators: { quote: [{ close: [100, null, 110] }] },
          },
        ],
      },
    };
    const out = parseHistoricalCloses(data);
    expect(out).toHaveLength(2);
    expect(out[0].close).toBe(100);
    expect(out[1].close).toBe(110);
    expect(out[0].date < out[1].date).toBe(true);
  });

  it("빈 응답은 빈 배열", () => {
    expect(parseHistoricalCloses({})).toEqual([]);
  });
});
