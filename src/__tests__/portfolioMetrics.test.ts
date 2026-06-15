import { describe, it, expect } from "vitest";
import { computePortfolioMetrics, computeUnrealizedPL } from "../utils/portfolioMetrics";
import type { Account, PositionRow } from "../types";

function pos(o: Partial<PositionRow> & { accountId: string; name: string }): PositionRow {
  return {
    accountName: "",
    ticker: "",
    quantity: 1,
    avgPrice: 0,
    totalBuyAmount: 0,
    marketPrice: 0,
    marketValue: 0,
    marketCurrency: "KRW",
    pnl: 0,
    pnlRate: 0,
    ...o,
  } as PositionRow;
}
function acct(o: Partial<Account> & { id: string; type: Account["type"] }): Account {
  return { name: o.id, institution: "", initialBalance: 0, ...o } as Account;
}

const FX = 1300;
const accounts = [
  acct({ id: "a1", type: "securities" }),
  acct({ id: "a2", type: "securities" }),
  acct({ id: "c1", type: "crypto" }),
];
const positions: PositionRow[] = [
  pos({ accountId: "a1", name: "삼성전자", ticker: "005930", quantity: 10, totalBuyAmount: 700_000, marketValue: 800_000, marketCurrency: "KRW" }),
  pos({ accountId: "a2", name: "삼성전자", ticker: "005930", quantity: 5, totalBuyAmount: 350_000, marketValue: 400_000, marketCurrency: "KRW" }), // 같은 종목 다른 계좌
  pos({ accountId: "a1", name: "TIGER 200", ticker: "102110", quantity: 5, totalBuyAmount: 180_000, marketValue: 175_000, marketCurrency: "KRW" }),
  pos({ accountId: "a2", name: "AAPL", ticker: "AAPL", quantity: 2, totalBuyAmount: 300, totalBuyAmountKRW: 390_000, marketValue: 400, marketCurrency: "USD" }),
  pos({ accountId: "c1", name: "BTC", ticker: "BTC", quantity: 0.1, totalBuyAmount: 5_000_000, marketValue: 6_000_000, marketCurrency: "KRW" }),
  pos({ accountId: "a1", name: "DUST", ticker: "000000", quantity: 1e-10, totalBuyAmount: 999, marketValue: 999, marketCurrency: "KRW" }), // dust → 제외
];

describe("computePortfolioMetrics", () => {
  const m = computePortfolioMetrics(positions, accounts, FX);

  it("종목별 FIFO 보유원가 — 같은 종목 합산, USD는 원화 환산, cost 내림차순", () => {
    expect(m.holdingsByStock).toEqual([
      { name: "BTC", costKRW: 5_000_000, valueKRW: 6_000_000 },
      { name: "삼성전자", costKRW: 1_050_000, valueKRW: 1_200_000 }, // 700k+350k / 800k+400k
      { name: "AAPL", costKRW: 390_000, valueKRW: 520_000 },         // totalBuyAmountKRW / 400×1300
      { name: "TIGER 200", costKRW: 180_000, valueKRW: 175_000 },
    ]);
  });

  it("총 보유원가 = 보유분 원가 합 (dust 제외)", () => {
    expect(m.totalHoldingsCost).toBe(6_620_000);
  });

  it("자산 유형별 배분 — crypto 계좌=암호화폐, TIGER=ETF, 그 외=개별주식, 평가액 내림차순", () => {
    expect(m.portfolio).toEqual([
      { name: "암호화폐", value: 6_000_000 },
      { name: "개별주식", value: 1_720_000 }, // 삼성 800k+400k + AAPL 520k
      { name: "ETF", value: 175_000 },
    ]);
  });

  it("dust(미세 잔량) 포지션은 제외", () => {
    expect(m.holdingsByStock.find((h) => h.name === "DUST")).toBeUndefined();
  });

  it("환율 없으면 USD 평가액은 0, KRW만 집계 (방어적)", () => {
    const noFx = computePortfolioMetrics(positions, accounts, null);
    // AAPL(USD)은 환율 0 → cost는 totalBuyAmountKRW로 유지되지만 value 0
    const aapl = noFx.holdingsByStock.find((h) => h.name === "AAPL");
    expect(aapl?.valueKRW).toBe(0);
  });
});

describe("computeUnrealizedPL", () => {
  it("미실현 손익 — 보유분 (현재가−평단) KRW 합, 손실은 양의 절대값, qty≤0 제외", () => {
    const ps: PositionRow[] = [
      pos({ accountId: "a1", name: "삼성", quantity: 10, totalBuyAmount: 700_000, marketValue: 800_000, marketCurrency: "KRW" }), // +100k
      pos({ accountId: "a1", name: "ETF", quantity: 5, totalBuyAmount: 180_000, marketValue: 175_000, marketCurrency: "KRW" }),    // -5k
      pos({ accountId: "a2", name: "AAPL", quantity: 2, totalBuyAmount: 300, totalBuyAmountKRW: 390_000, marketValue: 400, marketCurrency: "USD" }), // 400×1300=520k − 390k = +130k
      pos({ accountId: "a1", name: "ZERO", quantity: 0, totalBuyAmount: 5_000, marketValue: 9_999, marketCurrency: "KRW" }),       // qty 0 → 제외
    ];
    const r = computeUnrealizedPL(ps, 1300);
    expect(r.unrealizedGain).toBe(230_000); // 삼성 +100k + AAPL +130k
    expect(r.unrealizedLoss).toBe(5_000);   // ETF -5k
  });

  it("환율 null이면 USD 평가액 0 → 평단만큼 미실현 손실 (방어적, 원본 동작 보존)", () => {
    const ps: PositionRow[] = [
      pos({ accountId: "a2", name: "AAPL", quantity: 2, totalBuyAmount: 300, totalBuyAmountKRW: 390_000, marketValue: 400, marketCurrency: "USD" }),
    ];
    const r = computeUnrealizedPL(ps, null);
    expect(r.unrealizedGain).toBe(0);
    expect(r.unrealizedLoss).toBe(390_000); // costKrw 390k − marketKrw 0
  });
});
