import { describe, it, expect } from "vitest";
import { buildMissingMarketEnvSnapshots } from "../utils/marketEnvBackfill";
import type { HistoricalDailyClose, MarketEnvSnapshot, StockTrade } from "../types";
import type { FxPoint } from "../utils/portfolioHistory";

const trade = (o: Partial<StockTrade> & { id: string }): StockTrade =>
  ({
    date: "2026-06-20",
    accountId: "SEC",
    ticker: "005930",
    name: "삼성전자",
    side: "buy",
    quantity: 10,
    price: 70_000,
    fee: 0,
    totalAmount: 700_000,
    cashImpact: -700_000,
    ...o,
  } as StockTrade);

const close = (ticker: string, date: string, c: number, currency?: string): HistoricalDailyClose =>
  ({ ticker, date, close: c, currency });

const fx = (date: string, rate: number): FxPoint => ({ date, rate });

const snap = (date: string, fxRate = 1300): MarketEnvSnapshot =>
  ({ date, fxRate, prices: [{ ticker: "005930", price: 70_000 }], recordedAt: `${date}T09:00:00+09:00` });

const NOW = "2026-07-22T10:00:00+09:00";

const run = (over: Partial<Parameters<typeof buildMissingMarketEnvSnapshots>[0]>) =>
  buildMissingMarketEnvSnapshots({
    trades: [trade({ id: "t1" })],
    historicalDailyCloses: [close("005930", "2026-07-01", 75_000)],
    fxHistory: [fx("2026-07-01", 1310)],
    existingSnapshots: [],
    fallbackFxRate: 1400,
    today: "2026-07-22",
    nowIso: NOW,
    ...over,
  });

describe("buildMissingMarketEnvSnapshots — 놓친 1일·15일 소급 박제", () => {
  it("결번 날짜를 그 날짜의 실측 종가·환율로 박제한다", () => {
    const added = run({});
    const jul1 = added.find((s) => s.date === "2026-07-01")!;
    expect(jul1.prices).toEqual([{ ticker: "005930", price: 75_000, currency: undefined }]);
    expect(jul1.fxRate).toBe(1310); // 이력 우선 — 폴백(1400) 아님
    expect(jul1.recordedAt).toBe(NOW); // 소급 여부는 recordedAt-date 간격으로 감사 가능
  });

  it("기존 박제는 절대 덮어쓰지 않고, 오늘은 정시 기록기 몫으로 남긴다", () => {
    const added = run({
      existingSnapshots: [snap("2026-07-01")],
      historicalDailyCloses: [
        close("005930", "2026-07-01", 99_999), // 기존 박제(70,000)와 다른 값 — 무시돼야 함
        close("005930", "2026-07-15", 76_000),
        close("005930", "2026-07-22", 77_000), // 오늘 — 제외돼야 함
      ],
      today: "2026-07-22",
    });
    expect(added.some((s) => s.date === "2026-07-01")).toBe(false);
    expect(added.some((s) => s.date === "2026-07-22")).toBe(false);
    expect(added.find((s) => s.date === "2026-07-15")?.prices[0].price).toBe(76_000);
  });

  it("정확한 날짜 종가가 없으면 이전 가장 가까운 종가 사용 (주말·미접속일 커버)", () => {
    // 7/15가 주말이라 7/13 종가만 있는 경우
    const added = run({
      historicalDailyCloses: [close("005930", "2026-07-13", 74_000)],
    });
    const jul15 = added.find((s) => s.date === "2026-07-15")!;
    expect(jul15.prices[0].price).toBe(74_000);
  });

  it("45일보다 낡은 종가로는 박제하지 않는다 — 거짓 박제 방지", () => {
    const added = run({
      trades: [trade({ id: "t1", date: "2026-01-10" })],
      historicalDailyCloses: [close("005930", "2026-01-12", 71_000)],
      fxHistory: [fx("2026-01-12", 1300)],
    });
    // 1/15는 3일 전 종가로 박제 가능, 3/15는 62일 전이라 불가
    expect(added.some((s) => s.date === "2026-01-15")).toBe(true);
    expect(added.some((s) => s.date === "2026-03-15")).toBe(false);
  });

  it("그 시점에 보유하지 않은 종목은 박제에 넣지 않는다", () => {
    const added = run({
      trades: [
        trade({ id: "t1", date: "2026-06-20", ticker: "005930" }),
        trade({ id: "sell", date: "2026-06-25", ticker: "005930", side: "sell", quantity: 10, totalAmount: 750_000 }),
        trade({ id: "t2", date: "2026-07-05", ticker: "000660", name: "SK하이닉스", quantity: 5, totalAmount: 900_000 }),
      ],
      historicalDailyCloses: [
        close("005930", "2026-07-01", 75_000),
        close("000660", "2026-07-14", 190_000),
      ],
      fxHistory: [fx("2026-07-01", 1310)],
    });
    // 7/1: 전량 매도 후라 보유 없음 → 박제할 근거 없음(prices 비어 스킵)
    expect(added.some((s) => s.date === "2026-07-01")).toBe(false);
    // 7/15: 000660만 보유 → 그 종목만
    const jul15 = added.find((s) => s.date === "2026-07-15")!;
    expect(jul15.prices.map((p) => p.ticker)).toEqual(["000660"]);
  });

  it("환율 이력이 대상일 이전에 없으면 폴백(현재 환율) 사용, 그마저 없으면 보류", () => {
    const withFallback = run({ fxHistory: [] });
    expect(withFallback.find((s) => s.date === "2026-07-01")?.fxRate).toBe(1400);
    const noFx = run({ fxHistory: [], fallbackFxRate: null });
    expect(noFx).toEqual([]);
  });

  it("소급 박제 결과가 스냅샷 카드의 과거 점을 고정한다 (통합)", async () => {
    const { buildStockCostSnapshots } = await import("../utils/stockCostSnapshots");
    const added = run({});
    const points = buildStockCostSnapshots({
      trades: [trade({ id: "t1" })],
      accounts: [{ id: "SEC", name: "증권", institution: "", type: "securities", initialBalance: 0 } as never],
      prices: [{ ticker: "005930", price: 90_000, updatedAt: "2026-07-22T00:00:00Z" } as never],
      marketEnvSnapshots: added,
      fxRate: 1400,
      today: "2026-07-22",
    });
    const jul1 = points.find((p) => p.date === "2026-07-01")!;
    expect(jul1.market).toBe(75_000 * 10); // 소급 박제 종가 — 현재가 9만 아님
    expect(jul1.fxSource).toBe("snapshot");
  });
});
