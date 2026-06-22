/** A2 — 시간가중수익률(TWR): 현금흐름 제거 수익률 + 일자별 순현금흐름 집계 */
import { describe, expect, it } from "vitest";
import type { StockTrade } from "../types";
import type { DailyPortfolioPoint } from "../utils/portfolioHistory";
import { buildDailyNetFlowKRW, buildTwrReturnSeries, summarizeTwr } from "../utils/twr";

const v = (date: string, valueKRW: number, costKRW = valueKRW): DailyPortfolioPoint => ({
  date,
  valueKRW,
  costKRW,
  pnlKRW: valueKRW - costKRW,
});

describe("buildTwrReturnSeries", () => {
  it("현금흐름이 없으면 일별 수익률을 연쇄곱한다 (+10% → +5% = +15.5%)", () => {
    const series = [v("2026-01-01", 100), v("2026-01-02", 110), v("2026-01-03", 115.5)];
    const twr = buildTwrReturnSeries(series, new Map());
    expect(twr[twr.length - 1].returnIndex).toBeCloseTo(115.5, 5);
    expect(summarizeTwr(twr).returnPct).toBeCloseTo(0.155, 5);
  });

  it("입금일에는 수익률이 0 — 입금이 수익으로 잡히지 않는다", () => {
    // 100 → (+10%) 110 → 입금 100(평가 210, 가격변화 없음) → 5% 상승 220.5
    const series = [v("2026-01-01", 100), v("2026-01-02", 110), v("2026-01-03", 210), v("2026-01-04", 220.5)];
    const flows = new Map<string, number>([["2026-01-03", 100]]);
    const twr = buildTwrReturnSeries(series, flows);
    expect(twr[2].dailyReturn).toBeCloseTo(0, 6); // 입금일 r=0
    expect(twr[3].dailyReturn).toBeCloseTo(0.05, 6); // 그 다음날 +5%
    // 누적: 1.1 × 1.0 × 1.05 = 1.155
    expect(summarizeTwr(twr).returnPct).toBeCloseTo(0.155, 5);
  });

  it("DCA 함정: 입금으로 평가액이 2배가 돼도 가격이 그대로면 TWR ≈ 0", () => {
    // 매일 100씩 입금, 가격 변화 없음 → 평가액은 100→200→300이지만 수익은 0이어야 함
    const series = [v("2026-01-01", 100), v("2026-01-02", 200), v("2026-01-03", 300)];
    const flows = new Map<string, number>([
      ["2026-01-02", 100],
      ["2026-01-03", 100],
    ]);
    const twr = buildTwrReturnSeries(series, flows);
    expect(summarizeTwr(twr).returnPct).toBeCloseTo(0, 6);
  });

  it("전량 청산 후 재매수: 청산 구간은 지수 유지, 재진입은 수익 아님", () => {
    // 100 →(+10%) 110 → 전량 매도(출금 110) 평가 0 → 재매수(입금 50) 평가 50 →(+20%) 60
    const series = [v("2026-01-01", 100), v("2026-01-02", 110), v("2026-01-03", 0), v("2026-01-04", 50), v("2026-01-05", 60)];
    const flows = new Map<string, number>([
      ["2026-01-03", -110],
      ["2026-01-04", 50],
    ]);
    const twr = buildTwrReturnSeries(series, flows);
    expect(twr[2].dailyReturn).toBeCloseTo(0, 6); // 청산: 시세 그대로 팔면 수익 0
    expect(twr[3].dailyReturn).toBeCloseTo(0, 6); // 재진입(평가0→50): 입금은 수익 아님
    expect(twr[4].dailyReturn).toBeCloseTo(0.2, 6); // +20%
    // 누적: 1.1 × 1.2 = 1.32
    expect(summarizeTwr(twr).returnPct).toBeCloseTo(0.32, 5);
  });

  it("빈 시계열은 빈 결과", () => {
    expect(buildTwrReturnSeries([], new Map())).toEqual([]);
    expect(summarizeTwr([])).toMatchObject({ returnPct: 0, days: 0, annualizedPct: null });
  });
});

describe("buildDailyNetFlowKRW", () => {
  const mk = (over: Partial<StockTrade>): StockTrade => ({
    id: `t${over.id ?? "1"}`,
    date: "2026-01-02",
    accountId: "a1",
    ticker: "005930",
    name: "x",
    side: "buy",
    quantity: 1,
    price: 1000,
    fee: 0,
    totalAmount: 1000,
    cashImpact: -1000,
    ...over,
  });

  it("KRW 매수는 +, 매도는 − (원화 그대로)", () => {
    const flows = buildDailyNetFlowKRW(
      [mk({ id: "1", side: "buy", totalAmount: 1000, date: "2026-01-02" }), mk({ id: "2", side: "sell", totalAmount: 400, date: "2026-01-03" })],
      []
    );
    expect(flows.get("2026-01-02")).toBe(1000);
    expect(flows.get("2026-01-03")).toBe(-400);
  });

  it("USD 매수는 매입 당시 환율로, 매도는 그날 환율로 환산", () => {
    const flows = buildDailyNetFlowKRW(
      [
        mk({ id: "1", ticker: "AAPL", side: "buy", totalAmount: 500, fxRateAtTrade: 1300, date: "2026-01-02" }),
        mk({ id: "2", ticker: "AAPL", side: "sell", totalAmount: 200, date: "2026-02-01" }),
      ],
      [{ date: "2026-02-01", rate: 1350 }]
    );
    expect(flows.get("2026-01-02")).toBe(500 * 1300); // 650,000
    expect(flows.get("2026-02-01")).toBe(-200 * 1350); // -270,000
  });

  it("같은 날 여러 거래는 합산", () => {
    const flows = buildDailyNetFlowKRW(
      [mk({ id: "1", side: "buy", totalAmount: 1000 }), mk({ id: "2", side: "sell", totalAmount: 300 })],
      []
    );
    expect(flows.get("2026-01-02")).toBe(700);
  });
});
