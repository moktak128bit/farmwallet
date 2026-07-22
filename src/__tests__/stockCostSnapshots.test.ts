import { describe, it, expect } from "vitest";
import { buildStockCostSnapshots } from "../utils/stockCostSnapshots";
import type { Account, MarketEnvSnapshot, StockPrice, StockTrade } from "../types";

const acc = (o: Partial<Account> & { id: string }): Account =>
  ({ name: o.id, institution: "", type: "securities", initialBalance: 0, ...o } as Account);

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

const price = (ticker: string, p: number, currency?: string): StockPrice =>
  ({ ticker, price: p, currency, updatedAt: "2026-07-22T00:00:00Z" } as StockPrice);

const snap = (date: string, fxRate: number, prices: Array<{ ticker: string; price: number; currency?: string }>): MarketEnvSnapshot =>
  ({ date, fxRate, prices, recordedAt: `${date}T09:00:00+09:00` });

const accounts = [acc({ id: "SEC" })];

describe("buildStockCostSnapshots — 진짜 스냅샷 (과거 점 불변)", () => {
  it("각 날짜는 그 시점 보유 종목으로 구성된다 — 1일에 A·B, 15일에 B·C", () => {
    const trades = [
      trade({ id: "a", date: "2026-06-20", ticker: "005930", totalAmount: 700_000 }), // A
      trade({ id: "b", date: "2026-06-25", ticker: "000660", name: "SK하이닉스", quantity: 5, totalAmount: 900_000 }), // B
      // 7/1 이후: A 전량 매도, C 매수
      trade({ id: "sellA", date: "2026-07-05", ticker: "005930", side: "sell", quantity: 10, totalAmount: 800_000 }),
      trade({ id: "c", date: "2026-07-10", ticker: "035420", name: "NAVER", quantity: 3, totalAmount: 600_000 }), // C
    ];
    const points = buildStockCostSnapshots({
      trades, accounts, prices: [], marketEnvSnapshots: [], fxRate: null, today: "2026-07-22",
    });
    const at = (d: string) => points.find((p) => p.date === d)!;
    expect(at("2026-07-01").holdings.map((h) => h.ticker).sort()).toEqual(["000660", "005930"]); // A·B
    expect(at("2026-07-15").holdings.map((h) => h.ticker).sort()).toEqual(["000660", "035420"]); // B·C
    // 7/1 점의 매입액은 이후 매도의 영향을 받지 않는다
    expect(at("2026-07-01").cost).toBe(700_000 + 900_000);
    expect(at("2026-07-15").cost).toBe(900_000 + 600_000);
  });

  it("박제가 있는 날짜의 평가액은 박제 시세로 고정된다 — 현재 시세가 움직여도 과거 점 불변", () => {
    const trades = [trade({ id: "a", date: "2026-06-20" })];
    const run = (currentPrice: number) =>
      buildStockCostSnapshots({
        trades,
        accounts,
        prices: [price("005930", currentPrice)],
        marketEnvSnapshots: [snap("2026-07-01", 1300, [{ ticker: "005930", price: 75_000 }])],
        fxRate: null,
        today: "2026-07-22",
      });
    const before = run(80_000).find((p) => p.date === "2026-07-01")!;
    const after = run(90_000).find((p) => p.date === "2026-07-01")!;
    // 박제 75,000원 × 10주 — 현재가가 8만→9만으로 움직여도 그대로
    expect(before.market).toBe(750_000);
    expect(after.market).toBe(750_000);
    expect(before.fxSource).toBe("snapshot");
    expect(before.holdings[0].priceSource).toBe("snapshot");
    // 박제 없는 최근 점(7/15)은 현재가를 따라 움직인다
    const jul15After = run(90_000).find((p) => p.date === "2026-07-15")!;
    expect(jul15After.market).toBe(900_000);
    expect(jul15After.fxSource).toBe("current");
  });

  it("USD 종목은 박제 환율로 평가된다 — 현재 환율 변동이 과거 점을 흔들지 않는다", () => {
    const trades = [
      trade({ id: "u", date: "2026-06-20", ticker: "AAPL", name: "Apple", quantity: 10, price: 100, totalAmount: 1000, fxRateAtTrade: 1250 }),
    ];
    const run = (currentFx: number) =>
      buildStockCostSnapshots({
        trades,
        accounts,
        prices: [price("AAPL", 120, "USD")],
        marketEnvSnapshots: [snap("2026-07-01", 1300, [{ ticker: "AAPL", price: 110, currency: "USD" }])],
        fxRate: currentFx,
        today: "2026-07-22",
      });
    const jul1 = run(1400).find((p) => p.date === "2026-07-01")!;
    // 평가: $110 × 10 × 박제환율 1300 (현재환율 1400 아님)
    expect(jul1.market).toBe(110 * 10 * 1300);
    // 원가: 로트 환율 1250 고정
    expect(jul1.cost).toBe(1000 * 1250);
    // 현재 환율이 1400→1500으로 바뀌어도 과거 점은 동일
    expect(run(1500).find((p) => p.date === "2026-07-01")!.market).toBe(110 * 10 * 1300);
  });

  it("박제가 없는 날짜는 현재 시세 폴백 (TotalAssetTrendCard와 동일 정책, 출처 표시)", () => {
    const trades = [trade({ id: "a", date: "2026-06-20" })];
    const points = buildStockCostSnapshots({
      trades, accounts, prices: [price("005930", 80_000)], marketEnvSnapshots: [], fxRate: null, today: "2026-07-22",
    });
    const jul1 = points.find((p) => p.date === "2026-07-01")!;
    expect(jul1.market).toBe(800_000);
    expect(jul1.fxSource).toBe("current");
    expect(jul1.holdings[0].priceSource).toBe("current");
  });

  it("박제에 없는 종목만 현재가 폴백 — 같은 점 안에서 출처가 종목별로 갈릴 수 있다", () => {
    const trades = [
      trade({ id: "a", date: "2026-06-20", ticker: "005930" }),
      trade({ id: "b", date: "2026-06-21", ticker: "000660", name: "SK하이닉스", quantity: 5, totalAmount: 900_000 }),
    ];
    const points = buildStockCostSnapshots({
      trades,
      accounts,
      prices: [price("005930", 80_000), price("000660", 200_000)],
      // 박제에 005930만 있음
      marketEnvSnapshots: [snap("2026-07-01", 1300, [{ ticker: "005930", price: 75_000 }])],
      fxRate: null,
      today: "2026-07-22",
    });
    const jul1 = points.find((p) => p.date === "2026-07-01")!;
    const srcByTicker = new Map(jul1.holdings.map((h) => [h.ticker, h.priceSource]));
    expect(srcByTicker.get("005930")).toBe("snapshot");
    expect(srcByTicker.get("000660")).toBe("current");
    expect(jul1.market).toBe(75_000 * 10 + 200_000 * 5);
  });

  it("시세가 아예 없으면 평가액 = 원가 (손익 0)", () => {
    const trades = [trade({ id: "a", date: "2026-06-20" })];
    const points = buildStockCostSnapshots({
      trades, accounts, prices: [], marketEnvSnapshots: [], fxRate: null, today: "2026-07-22",
    });
    const last = points[points.length - 1];
    expect(last.market).toBe(last.cost);
    expect(last.holdings[0].priceSource).toBe("none");
  });

  it("연금 제외 옵션 — 연금계좌 보유분이 매입·평가에서 빠진다", () => {
    const accts = [acc({ id: "SEC" }), acc({ id: "PEN", isPension: true })];
    const trades = [
      trade({ id: "a", date: "2026-06-20", accountId: "SEC" }),
      trade({ id: "p", date: "2026-06-20", accountId: "PEN", ticker: "000660", name: "SK하이닉스", quantity: 5, totalAmount: 900_000 }),
    ];
    const withPension = buildStockCostSnapshots({
      trades, accounts: accts, prices: [], marketEnvSnapshots: [], fxRate: null, today: "2026-07-22",
    });
    const without = buildStockCostSnapshots({
      trades, accounts: accts, prices: [], marketEnvSnapshots: [], fxRate: null, today: "2026-07-22", excludePension: true,
    });
    const lastWith = withPension[withPension.length - 1];
    const lastWithout = without[without.length - 1];
    expect(lastWith.cost).toBe(700_000 + 900_000);
    expect(lastWithout.cost).toBe(700_000);
    expect(lastWithout.holdings.every((h) => h.accountName !== "PEN")).toBe(true);
  });

  it("부분 매도는 FIFO — 남은 로트의 원가만 매입액에 남는다", () => {
    const trades = [
      trade({ id: "b1", date: "2026-06-01", quantity: 10, totalAmount: 700_000 }), // 평단 7만
      trade({ id: "b2", date: "2026-06-10", quantity: 10, totalAmount: 800_000 }), // 평단 8만
      trade({ id: "s1", date: "2026-07-05", side: "sell", quantity: 15, totalAmount: 1_300_000 }),
    ];
    const points = buildStockCostSnapshots({
      trades, accounts, prices: [], marketEnvSnapshots: [], fxRate: null, today: "2026-07-22",
    });
    const jul15 = points.find((p) => p.date === "2026-07-15")!;
    // FIFO: 첫 로트 10주 전량 + 둘째 로트 5주 소진 → 남은 5주 × 8만 = 40만
    expect(jul15.cost).toBe(400_000);
    expect(jul15.holdings[0].quantity).toBe(5);
    // 매도 이전 점(7/1)은 여전히 20주 · 150만
    const jul1 = points.find((p) => p.date === "2026-07-01")!;
    expect(jul1.cost).toBe(1_500_000);
  });
});
