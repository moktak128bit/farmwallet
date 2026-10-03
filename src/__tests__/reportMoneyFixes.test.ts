import { describe, it, expect } from "vitest";
import { computeBalanceAtDateForAccounts } from "../calculations";
import {
  computeInvestmentReconciliation,
  generateAccountPerformanceBreakdown,
  generateAccountReport,
  generateDailyReport,
  generateStockPerformanceReport
} from "../utils/reportGenerator";
import { computeOriginalAssets } from "../utils/realIncome";
import type { Account, StockPrice, StockTrade } from "../types";

/**
 * 2026-10-02 돈 계산 감사 회귀 — 과거 시점 USD 롤백(A1)·시세 미로드 중립(A3)·
 * 종목 IRR 흐름(K7)·계좌 리포트 시작금액(A5).
 */
const account = (o: Partial<Account> & { id: string }): Account =>
  ({ name: o.id, institution: "", type: "checking", initialBalance: 0, ...o } as Account);

const trade = (o: Partial<StockTrade> & { id: string }): StockTrade =>
  ({ accountId: "sec", name: o.ticker ?? "", side: "buy", fee: 0, price: 0, quantity: 1, totalAmount: 0, cashImpact: 0, ...o } as StockTrade);

describe("A1 과거 시점 USD 잔액 — 이후 잔액모드 거래분 롤백", () => {
  // $1,000 보유 → 2/10 AAPL $1,000 잔액모드 매수 → 현재 usdBalance 0. 1/31 시점엔 아직 $1,000 현금.
  const accounts = [account({ id: "sec", type: "securities", usdBalance: 0 })];
  const trades = [
    trade({ id: "t1", date: "2026-02-10", ticker: "AAPL", quantity: 10, price: 100, totalAmount: 1000, cashImpact: 0, fxRateAtTrade: 1300 })
  ];

  it("computeBalanceAtDateForAccounts: 1/31 = $1,000 × 1300", () => {
    const v = computeBalanceAtDateForAccounts(accounts, [], trades, "2026-01-31", new Set(["sec"]), [], { fxRate: 1300 });
    expect(v).toBe(1_300_000);
  });

  it("generateDailyReport: 1/31 총자산 = 1,300,000 (현재 usdBalance 0을 그대로 쓰지 않음)", () => {
    const [row] = generateDailyReport(accounts, [], trades, [], "2026-01-31", "2026-01-31", 1300);
    expect(row.totalAsset).toBe(1_300_000);
  });

  it("매수 이후 시점은 롤백 없음 — 현재 usdBalance 0 + 보유 AAPL", () => {
    const prices = [{ ticker: "AAPL", price: 100, currency: "USD", updatedAt: "2026-02-10T00:00:00Z" }] as StockPrice[];
    const v = computeBalanceAtDateForAccounts(accounts, [], trades, "2026-02-10", new Set(["sec"]), prices, { fxRate: 1300 });
    expect(v).toBe(1_300_000);
  });
});

describe("A3 리포트 — 시세 없는 보유 종목은 원가로 중립 (−100% 금지)", () => {
  const accounts = [account({ id: "sec", type: "securities", initialCashBalance: 1_000_000 })];
  const trades = [
    trade({ id: "t1", date: "2026-01-10", ticker: "005930", quantity: 10, price: 70_000, totalAmount: 700_000, cashImpact: -700_000 })
  ];

  it("일별 리포트 총자산 = 대차 1,000,000 (예수금 30만 + 원가 70만)", () => {
    const [row] = generateDailyReport(accounts, [], trades, [], "2026-01-10", "2026-01-10");
    expect(row.totalAsset).toBe(1_000_000);
  });

  it("종목 성과 리포트 — 손익 0, 수익률 0", () => {
    const [row] = generateStockPerformanceReport(trades, [], accounts);
    expect(row.currentValue).toBe(700_000);
    expect(row.pnl).toBe(0);
    expect(row.pnlRate).toBe(0);
  });

  it("투자 정산 — 미실현 0, 평가손실 종목 없음, 평가액 1,000,000", () => {
    const perf = generateAccountPerformanceBreakdown(accounts, [], trades, []);
    const rec = computeInvestmentReconciliation(accounts, [], trades, [], perf);
    expect(rec.unrealizedPnl).toBe(0);
    expect(rec.losingPositions).toHaveLength(0);
    expect(rec.currentValue).toBe(1_000_000);
  });
});

describe("K7 종목 IRR — 잔액모드 매수도 원화 유출로 잡는다", () => {
  it("원화모드 10주 + 잔액모드 10주, 주가·환율 무변동 → IRR ≈ 0", () => {
    const accounts = [account({ id: "sec", type: "securities" })];
    const trades = [
      trade({ id: "t1", date: "2025-10-01", ticker: "AAPL", quantity: 10, price: 100, totalAmount: 1000, cashImpact: -1_300_000, fxRateAtTrade: 1300 }),
      trade({ id: "t2", date: "2025-10-01", ticker: "AAPL", quantity: 10, price: 100, totalAmount: 1000, cashImpact: 0, fxRateAtTrade: 1300 })
    ];
    const prices = [{ ticker: "AAPL", price: 100, currency: "USD", updatedAt: "2026-10-01T00:00:00Z" }] as StockPrice[];
    const [row] = generateStockPerformanceReport(trades, prices, accounts, 1300);
    expect(row.currentValue).toBe(2_600_000);
    expect(row.irr).toBeCloseTo(0, 6);
  });
});

describe("A5 계좌 리포트 시작금액 — baseBalanceForAccount + 보정 + savings", () => {
  it("증권 initialBalance 500만 + initialCashBalance 100만, 활동 없음 → 초기 100만·변동 0", () => {
    const accounts = [account({ id: "sec", type: "securities", initialBalance: 5_000_000, initialCashBalance: 1_000_000 })];
    const [row] = generateAccountReport(accounts, [], []);
    expect(row.initialBalance).toBe(1_000_000);
    expect(row.change).toBe(0);
  });

  it("savings 값도 시작금액에 포함 — 활동 없으면 변동 0", () => {
    const accounts = [account({ id: "sv", type: "savings", initialBalance: 100_000, savings: 50_000 })];
    const [row] = generateAccountReport(accounts, [], []);
    expect(row.initialBalance).toBe(150_000);
    expect(row.change).toBe(0);
  });

  it("computeOriginalAssets — 증권은 initialCashBalance 우선 (이중계상 금지)", () => {
    const accounts = [account({ id: "sec", type: "securities", initialBalance: 5_000_000, initialCashBalance: 1_000_000 })];
    expect(computeOriginalAssets(accounts).originalAssets).toBe(1_000_000);
  });
});
