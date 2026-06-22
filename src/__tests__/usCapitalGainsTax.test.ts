/** B3 — 미국주식 양도소득세(250만 공제, 22%) + 손실수확 */
import { describe, expect, it } from "vitest";
import type { PositionRow, StockTrade } from "../types";
import {
  FOREIGN_CG_BASIC_DEDUCTION,
  buildForeignCapitalGainsTax,
  realizedForeignGainKRW,
} from "../utils/usCapitalGainsTax";

let tid = 0;
const buy = (ticker: string, date: string, qty: number, usdTotal: number, fx: number): StockTrade => ({
  id: `b${tid++}`, date, accountId: "sec1", ticker, name: ticker, side: "buy",
  quantity: qty, price: usdTotal / qty, fee: 0, totalAmount: usdTotal, cashImpact: -usdTotal, fxRateAtTrade: fx,
});
const sell = (ticker: string, date: string, qty: number, usdTotal: number, fx: number): StockTrade => ({
  id: `s${tid++}`, date, accountId: "sec1", ticker, name: ticker, side: "sell",
  quantity: qty, price: usdTotal / qty, fee: 0, totalAmount: usdTotal, cashImpact: usdTotal, fxRateAtTrade: fx,
});
const usdPos = (ticker: string, costUsd: number, costKRW: number, marketUsd: number): PositionRow => ({
  accountId: "sec1", accountName: "증권", ticker, name: ticker, quantity: 1,
  avgPrice: costUsd, totalBuyAmount: costUsd, totalBuyAmountKRW: costKRW,
  marketPrice: marketUsd, marketValue: marketUsd, marketCurrency: "USD", pnl: 0, pnlRate: 0,
});

describe("realizedForeignGainKRW", () => {
  it("매입·매도 각 시점 환율로 KRW 양도차익", () => {
    // 매입 $1000 × 1300 = 130만, 매도 $1200 × 1350 = 162만 → +32만
    const g = realizedForeignGainKRW(
      [buy("AAPL", "2026-02-01", 10, 1000, 1300), sell("AAPL", "2026-06-01", 10, 1200, 1350)],
      2026,
      []
    );
    expect(g).toBeCloseTo(320_000, 0);
  });

  it("해당 연도 매도분만 합산", () => {
    const trades = [
      buy("AAPL", "2025-02-01", 10, 1000, 1300),
      sell("AAPL", "2025-06-01", 5, 600, 1350), // 전년도 → 제외
      sell("AAPL", "2026-03-01", 5, 700, 1400), // 올해 → 포함
    ];
    // 2026 매도: 5주 원가 = $500 × 1300 = 65만, 매도 $700 × 1400 = 98만 → +33만
    expect(realizedForeignGainKRW(trades, 2026, [])).toBeCloseTo(330_000, 0);
  });

  it("KRW 종목은 양도세 대상 아님 (제외)", () => {
    expect(
      realizedForeignGainKRW(
        [buy("005930", "2026-01-01", 10, 1_000_000, 1), sell("005930", "2026-06-01", 10, 1_200_000, 1)],
        2026,
        []
      )
    ).toBe(0);
  });

  it("손익통산 — 이익과 손실이 상쇄", () => {
    const trades = [
      buy("AAPL", "2026-01-01", 10, 1000, 1300),
      sell("AAPL", "2026-02-01", 10, 1500, 1300), // +$500 = +65만
      buy("TSLA", "2026-01-01", 10, 1000, 1300),
      sell("TSLA", "2026-02-01", 10, 600, 1300), // -$400 = -52만
    ];
    expect(realizedForeignGainKRW(trades, 2026, [])).toBeCloseTo(650_000 - 520_000, 0);
  });

  it("fxRateAtTrade 없으면 fxHistory/fallback로 환산", () => {
    const b = { ...buy("AAPL", "2026-01-01", 10, 1000, 1300), fxRateAtTrade: undefined };
    const s = { ...sell("AAPL", "2026-06-01", 10, 1200, 1350), fxRateAtTrade: undefined };
    const g = realizedForeignGainKRW([b, s], 2026, [
      { date: "2026-01-01", rate: 1300 },
      { date: "2026-06-01", rate: 1350 },
    ]);
    expect(g).toBeCloseTo(320_000, 0);
  });
});

describe("buildForeignCapitalGainsTax", () => {
  it("공제 미만이면 세금 0·공제 여유 표시", () => {
    const r = buildForeignCapitalGainsTax({
      trades: [buy("AAPL", "2026-02-01", 10, 1000, 1300), sell("AAPL", "2026-06-01", 10, 1200, 1350)],
      positions: [],
      year: 2026,
      fxHistory: [],
      fxRate: 1350,
    });
    expect(r.realizedGainKRW).toBeCloseTo(320_000, 0);
    expect(r.taxableGain).toBe(0);
    expect(r.estimatedTax).toBe(0);
    expect(r.deductionRemaining).toBeCloseTo(FOREIGN_CG_BASIC_DEDUCTION - 320_000, 0);
  });

  it("공제 초과분에 22% 과세", () => {
    // 매입 $10,000×1300=1,300만 / 매도 $15,000×1350=2,025만 → +725만
    const r = buildForeignCapitalGainsTax({
      trades: [buy("AAPL", "2026-02-01", 100, 10_000, 1300), sell("AAPL", "2026-06-01", 100, 15_000, 1350)],
      positions: [],
      year: 2026,
      fxHistory: [],
      fxRate: 1350,
    });
    expect(r.realizedGainKRW).toBeCloseTo(7_250_000, 0);
    expect(r.taxableGain).toBeCloseTo(7_250_000 - 2_500_000, 0);
    expect(r.estimatedTax).toBeCloseTo((7_250_000 - 2_500_000) * 0.22, 0);
  });

  it("손실수확: 평가손실 종목을 실현하면 절세액 계산", () => {
    // 실현차익 725만(과세 475만, 세금 104.5만). 평가손실 300만 실현 시 과세 175만 → 세금 38.5만, 절감 66만
    const r = buildForeignCapitalGainsTax({
      trades: [buy("AAPL", "2026-02-01", 100, 10_000, 1300), sell("AAPL", "2026-06-01", 100, 15_000, 1350)],
      positions: [usdPos("TSLA", 10_000, 13_000_000, 7_407.4)], // 원가 1,300만, 평가 $7407.4×1350≈1,000만 → 손실 300만
      year: 2026,
      fxHistory: [],
      fxRate: 1350,
    });
    expect(r.harvestCandidates).toHaveLength(1);
    expect(r.harvestableLossKRW).toBeCloseTo(3_000_000, -3); // 약 300만
    expect(r.taxSavingIfHarvestAll).toBeGreaterThan(600_000);
  });

  it("이익 종목은 손실수확 후보가 아니다", () => {
    const r = buildForeignCapitalGainsTax({
      trades: [],
      positions: [usdPos("NVDA", 1000, 1_300_000, 1200)], // 평가 $1200×1350 > 원가 130만 → 이익
      year: 2026,
      fxHistory: [],
      fxRate: 1350,
    });
    expect(r.harvestCandidates).toHaveLength(0);
  });
});
