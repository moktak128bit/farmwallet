import { describe, it, expect } from "vitest";
import {
  buildClosedTradeRecords,
  summarizeRecords,
  groupByYear,
  groupByMonth,
  groupByHoldingBucket,
  filterByPeriod,
  holdingRange,
} from "../utils/investmentRecord";
import type { StockTrade, Account } from "../types";

const acc: Account = {
  id: "acc1",
  name: "증권",
  type: "securities",
  institution: "",
  initialBalance: 0,
};

function t(o: Partial<StockTrade> & { id: string; side: "buy" | "sell"; date: string; quantity: number; totalAmount: number }): StockTrade {
  return {
    accountId: "acc1",
    ticker: "005930",
    name: "삼성전자",
    price: o.totalAmount / o.quantity,
    fee: 0,
    cashImpact: 0,
    ...o,
  };
}

describe("buildClosedTradeRecords", () => {
  it("매수만 있으면 기록 없음", () => {
    const r = buildClosedTradeRecords([t({ id: "b1", side: "buy", date: "2026-01-01", quantity: 10, totalAmount: 1000 })], [acc]);
    expect(r).toHaveLength(0);
  });

  it("단순 매수→매도 FIFO 실현손익", () => {
    const r = buildClosedTradeRecords(
      [
        t({ id: "b1", side: "buy", date: "2026-01-01", quantity: 10, totalAmount: 1000 }),
        t({ id: "s1", side: "sell", date: "2026-02-01", quantity: 10, totalAmount: 1500 }),
      ],
      [acc]
    );
    expect(r).toHaveLength(1);
    expect(r[0].realizedPnlKRW).toBe(500);
    expect(r[0].costBasisKRW).toBe(1000);
    expect(r[0].proceedsKRW).toBe(1500);
    expect(r[0].holdingDays).toBe(31);
    expect(r[0].buyDateWeighted).toBe("2026-01-01");
  });

  it("여러 매수 로트 FIFO — 가중평균 매수일 계산", () => {
    const r = buildClosedTradeRecords(
      [
        t({ id: "b1", side: "buy", date: "2026-01-01", quantity: 10, totalAmount: 1000 }),
        t({ id: "b2", side: "buy", date: "2026-01-11", quantity: 10, totalAmount: 1200 }),
        t({ id: "s1", side: "sell", date: "2026-02-01", quantity: 15, totalAmount: 2100 }),
      ],
      [acc]
    );
    expect(r).toHaveLength(1);
    // cost = 1000 (10×100) + 600 (5×120) = 1600
    expect(r[0].costBasisKRW).toBe(1600);
    expect(r[0].realizedPnlKRW).toBe(500);
    // 가중평균: (10×2026-01-01 + 5×2026-01-11) / 15 = 2026-01-04 (±1일)
    expect(r[0].buyDateWeighted >= "2026-01-03").toBe(true);
    expect(r[0].buyDateWeighted <= "2026-01-05").toBe(true);
  });

  it("부분 매도 후 잔량 매도", () => {
    const r = buildClosedTradeRecords(
      [
        t({ id: "b1", side: "buy", date: "2026-01-01", quantity: 10, totalAmount: 1000 }),
        t({ id: "s1", side: "sell", date: "2026-02-01", quantity: 4, totalAmount: 600 }),
        t({ id: "s2", side: "sell", date: "2026-03-01", quantity: 6, totalAmount: 900 }),
      ],
      [acc]
    );
    expect(r).toHaveLength(2);
    const s1 = r.find((x) => x.tradeId === "s1")!;
    const s2 = r.find((x) => x.tradeId === "s2")!;
    expect(s1.costBasisKRW).toBe(400);
    expect(s1.realizedPnlKRW).toBe(200);
    expect(s2.costBasisKRW).toBe(600);
    expect(s2.realizedPnlKRW).toBe(300);
  });

  it("USD 종목: fxRateAtTrade로 환산", () => {
    const r = buildClosedTradeRecords(
      [
        t({ id: "b1", side: "buy", date: "2026-01-01", ticker: "AAPL", quantity: 10, totalAmount: 1000, fxRateAtTrade: 1300 }),
        t({ id: "s1", side: "sell", date: "2026-02-01", ticker: "AAPL", quantity: 10, totalAmount: 1200, fxRateAtTrade: 1400 }),
      ],
      [acc]
    );
    expect(r).toHaveLength(1);
    expect(r[0].costBasisKRW).toBe(1_300_000);
    expect(r[0].proceedsKRW).toBe(1_680_000);
    expect(r[0].realizedPnlKRW).toBe(380_000);
    expect(r[0].isUsd).toBe(true);
  });

  it("USD 종목 fxRateAtTrade 없으면 0 가드", () => {
    const r = buildClosedTradeRecords(
      [
        t({ id: "b1", side: "buy", date: "2026-01-01", ticker: "AAPL", quantity: 10, totalAmount: 1000 }),
        t({ id: "s1", side: "sell", date: "2026-02-01", ticker: "AAPL", quantity: 10, totalAmount: 1200 }),
      ],
      [acc]
    );
    expect(r[0].costBasisKRW).toBe(0);
    expect(r[0].proceedsKRW).toBe(0);
  });
});

describe("summarizeRecords", () => {
  const accs = [acc];

  it("빈 배열 가드", () => {
    const s = summarizeRecords([]);
    expect(s.totalPnl).toBe(0);
    expect(s.tradeCount).toBe(0);
    expect(s.winRate).toBe(0);
    expect(s.profitLossRatio).toBe(0);
  });

  it("승률·손익비 계산", () => {
    const trades = [
      t({ id: "b1", side: "buy", date: "2026-01-01", quantity: 10, totalAmount: 1000 }),
      t({ id: "s1", side: "sell", date: "2026-02-01", quantity: 5, totalAmount: 600 }),   // +100
      t({ id: "s2", side: "sell", date: "2026-03-01", quantity: 5, totalAmount: 400 }),   // -100
    ];
    const r = buildClosedTradeRecords(trades, accs);
    const s = summarizeRecords(r);
    expect(s.tradeCount).toBe(2);
    expect(s.winCount).toBe(1);
    expect(s.lossCount).toBe(1);
    expect(s.winRate).toBe(0.5);
    expect(s.avgWin).toBe(100);
    expect(s.avgLoss).toBe(-100);
    expect(s.profitLossRatio).toBe(1);
  });
});

describe("groupByYear / groupByMonth", () => {
  it("연·월별 버킷 정상 분리", () => {
    const trades = [
      t({ id: "b1", side: "buy", date: "2025-06-01", quantity: 10, totalAmount: 1000 }),
      t({ id: "s1", side: "sell", date: "2025-12-15", quantity: 5, totalAmount: 600 }),
      t({ id: "s2", side: "sell", date: "2026-03-10", quantity: 5, totalAmount: 400 }),
    ];
    const r = buildClosedTradeRecords(trades, [acc]);
    const byYear = groupByYear(r);
    expect(byYear.get("2025")!.totalPnl).toBe(100);
    expect(byYear.get("2026")!.totalPnl).toBe(-100);

    const byMonth = groupByMonth(r);
    expect(byMonth.get("2025-12")!.tradeCount).toBe(1);
    expect(byMonth.get("2026-03")!.tradeCount).toBe(1);
  });
});

describe("groupByHoldingBucket + holdingRange", () => {
  it("보유기간 버킷 분류", () => {
    const trades = [
      t({ id: "b1", side: "buy", date: "2026-01-01", quantity: 30, totalAmount: 3000 }),
      t({ id: "s1", side: "sell", date: "2026-01-05", quantity: 10, totalAmount: 1100 }),  // 4일 → 1주 이하
      t({ id: "s2", side: "sell", date: "2026-02-15", quantity: 10, totalAmount: 1100 }),  // 45일 → 1~3개월
      t({ id: "s3", side: "sell", date: "2026-06-20", quantity: 10, totalAmount: 1100 }),  // 170일 → 3~12개월
    ];
    const r = buildClosedTradeRecords(trades, [acc]);
    const buckets = groupByHoldingBucket(r);
    expect(buckets.get("1주 이하")!.tradeCount).toBe(1);
    expect(buckets.get("1~3개월")!.tradeCount).toBe(1);
    expect(buckets.get("3~12개월")!.tradeCount).toBe(1);

    const range = holdingRange(r);
    expect(range.min).toBe(4);
    expect(range.max).toBeGreaterThanOrEqual(170);
  });
});

describe("filterByPeriod", () => {
  const trades = [
    t({ id: "b1", side: "buy", date: "2025-06-01", quantity: 20, totalAmount: 2000 }),
    t({ id: "s1", side: "sell", date: "2025-12-15", quantity: 10, totalAmount: 1100 }),
    t({ id: "s2", side: "sell", date: "2026-03-10", quantity: 10, totalAmount: 1100 }),
  ];
  const r = buildClosedTradeRecords(trades, [acc]);

  it("kind=all → 전체", () => {
    expect(filterByPeriod(r, { kind: "all" })).toHaveLength(2);
  });

  it("kind=year → 해당 연도", () => {
    expect(filterByPeriod(r, { kind: "year", year: 2025 })).toHaveLength(1);
    expect(filterByPeriod(r, { kind: "year", year: 2026 })).toHaveLength(1);
  });

  it("kind=month → 해당 연월", () => {
    expect(filterByPeriod(r, { kind: "month", year: 2025, month: 12 })).toHaveLength(1);
    expect(filterByPeriod(r, { kind: "month", year: 2026, month: 3 })).toHaveLength(1);
    expect(filterByPeriod(r, { kind: "month", year: 2026, month: 1 })).toHaveLength(0);
  });
});
