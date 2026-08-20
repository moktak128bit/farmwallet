import { describe, it, expect } from "vitest";
import { buildAllocationXray, XRAY_LABEL } from "../utils/allocationXray";
import type { Account, AccountBalanceRow, PositionRow, TickerInfo } from "../types";

function pos(o: Partial<PositionRow> & { accountId: string; ticker: string }): PositionRow {
  return {
    accountName: "",
    name: o.ticker,
    quantity: 1,
    avgPrice: 0,
    totalBuyAmount: 0,
    marketPrice: 0,
    marketValue: 0,
    pnl: 0,
    pnlRate: 0,
    ...o,
  } as PositionRow;
}
function acct(o: Partial<Account> & { id: string; type: Account["type"] }): Account {
  return { name: o.id, institution: "", initialBalance: 0, ...o } as Account;
}
function bal(account: Account, currentBalance: number, usdTransferNet = 0): AccountBalanceRow {
  return { account, incomeSum: 0, expenseSum: 0, transferNet: 0, usdTransferNet, tradeCashImpact: 0, currentBalance };
}

const FX = 1300;
const sec = acct({ id: "sec", type: "securities", usdBalance: 100 }); // 예수금 KRW 200,000 + $100
const pen = acct({ id: "pen", type: "securities", isPension: true });
const cry = acct({ id: "cry", type: "crypto" });
const bank = acct({ id: "bank", type: "checking", usdBalance: 999 }); // 비증권 → 제외 (의도 설계)
const accounts = [sec, pen, cry, bank];
const tickerDatabase: TickerInfo[] = [
  { ticker: "005930", name: "삼성전자", market: "KR" },
  { ticker: "AAPL", name: "Apple", market: "US" },
  { ticker: "bitcoin", name: "Bitcoin", market: "CRYPTO" },
];

const positions: PositionRow[] = [
  pos({ accountId: "sec", ticker: "005930", name: "삼성전자", quantity: 10, marketValue: 800_000, marketCurrency: "KRW" }),
  pos({ accountId: "sec", ticker: "102110", name: "TIGER 200", quantity: 5, marketValue: 200_000, marketCurrency: "KRW" }),
  pos({ accountId: "sec", ticker: "AAPL", name: "Apple", quantity: 2, marketValue: 400, marketCurrency: "USD" }), // 520,000 KRW
  pos({ accountId: "pen", ticker: "360750", name: "TIGER 미국S&P500", quantity: 3, marketValue: 300_000, marketCurrency: "KRW" }),
  pos({ accountId: "cry", ticker: "bitcoin", name: "Bitcoin", quantity: 0.01, marketValue: 1_000_000, marketCurrency: "KRW" }),
];
const balances = [bal(sec, 200_000), bal(pen, 50_000), bal(cry, 0), bal(bank, 5_000_000, 0)];

const sumAxis = (x: ReturnType<typeof buildAllocationXray>, key: string) =>
  x.axes.find((a) => a.key === key)!.items.reduce((s, i) => s + i.valueKRW, 0);
const item = (x: ReturnType<typeof buildAllocationXray>, key: string, label: string) =>
  x.axes.find((a) => a.key === key)!.items.find((i) => i.label === label);

describe("buildAllocationXray", () => {
  const x = buildAllocationXray({ positions, balances, accounts, tickerDatabase, fxRate: FX });

  it("합계 = 포지션 평가액(USD 환산) + 증권·코인계좌 현금(KRW + USD×환율); 은행 USD는 제외", () => {
    // 포지션 800k + 200k + 520k + 300k + 1,000k = 2,820k ; 현금 200k + 130k + 50k = 380k
    expect(x.totalKRW).toBe(3_200_000);
    expect(x.cashKRW).toBe(380_000);
    expect(x.cashPct).toBeCloseTo((380_000 / 3_200_000) * 100, 6);
    expect(x.excludedCount).toBe(0);
  });

  it("모든 축의 항목 합계 = 총자산, pct 합 = 100", () => {
    for (const key of ["currency", "market", "assetClass"]) {
      expect(sumAxis(x, key)).toBeCloseTo(3_200_000, 6);
      const pctSum = x.axes.find((a) => a.key === key)!.items.reduce((s, i) => s + i.pct, 0);
      expect(pctSum).toBeCloseTo(100, 6);
    }
  });

  it("통화 축: USD = AAPL 환산 + 달러 예수금, 나머지 KRW(현금 포함)", () => {
    expect(item(x, "currency", XRAY_LABEL.USD)?.valueKRW).toBe(520_000 + 130_000);
    expect(item(x, "currency", XRAY_LABEL.KRW)?.valueKRW).toBe(3_200_000 - 650_000);
  });

  it("시장 축: tickerDatabase.market 기준 KR/US/CRYPTO + 현금", () => {
    expect(item(x, "market", XRAY_LABEL.KR)?.valueKRW).toBe(800_000 + 200_000 + 300_000);
    expect(item(x, "market", XRAY_LABEL.US)?.valueKRW).toBe(520_000);
    expect(item(x, "market", XRAY_LABEL.CRYPTO)?.valueKRW).toBe(1_000_000);
    expect(item(x, "market", XRAY_LABEL.CASH)?.valueKRW).toBe(380_000);
    // 표시 순서 고정
    expect(x.axes[1].items.map((i) => i.label)).toEqual(["KR", "US", "CRYPTO", "현금"]);
  });

  it("자산군 축: 연금계좌 보유종목은 ETF명이어도 '연금'으로 분리, 코인은 계좌 타입, ETF는 종목명", () => {
    expect(item(x, "assetClass", XRAY_LABEL.PENSION)?.valueKRW).toBe(300_000);
    expect(item(x, "assetClass", XRAY_LABEL.ETF)?.valueKRW).toBe(200_000);
    expect(item(x, "assetClass", XRAY_LABEL.COIN)?.valueKRW).toBe(1_000_000);
    expect(item(x, "assetClass", XRAY_LABEL.STOCK)?.valueKRW).toBe(800_000 + 520_000);
    expect(item(x, "assetClass", XRAY_LABEL.CASH)?.valueKRW).toBe(380_000);
  });

  it("집중도: 축별 maxItem + 전체 최대 단일 비중", () => {
    const cur = x.axes.find((a) => a.key === "currency")!;
    expect(cur.maxItem?.label).toBe("KRW");
    expect(x.concentration).toEqual({ axisTitle: "통화", label: "KRW", pct: expect.closeTo((2_550_000 / 3_200_000) * 100, 6) });
  });

  it("tickerDatabase에 없는 종목은 티커 규칙으로 시장 추정 (1~5자 영문=US, 6자리=KR, 코인계좌=CRYPTO)", () => {
    const y = buildAllocationXray({
      positions: [
        pos({ accountId: "sec", ticker: "MSFT", quantity: 1, marketValue: 100, marketCurrency: "USD" }),
        pos({ accountId: "sec", ticker: "000660", quantity: 1, marketValue: 100_000, marketCurrency: "KRW" }),
        pos({ accountId: "cry", ticker: "solana", quantity: 1, marketValue: 50_000, marketCurrency: "KRW" }),
      ],
      balances: [],
      accounts,
      tickerDatabase: [],
      fxRate: 1000,
    });
    expect(item(y, "market", "US")?.valueKRW).toBe(100_000);
    expect(item(y, "market", "KR")?.valueKRW).toBe(100_000);
    expect(item(y, "market", "CRYPTO")?.valueKRW).toBe(50_000);
    expect(item(y, "assetClass", "코인")?.valueKRW).toBe(50_000);
  });

  it("환율 미로드: USD 포지션·달러 예수금은 0으로 빠지고 excludedCount로 보고 (KRW 액면 오염 금지)", () => {
    const y = buildAllocationXray({ positions, balances, accounts, tickerDatabase, fxRate: null });
    expect(y.totalKRW).toBe(3_200_000 - 520_000 - 130_000);
    expect(y.excludedCount).toBe(1);
    expect(item(y, "currency", XRAY_LABEL.USD)).toBeUndefined();
  });

  it("시세 미로드(marketValue 0) 전부면 빈 결과", () => {
    const y = buildAllocationXray({
      positions: positions.map((p) => ({ ...p, marketValue: 0 })),
      balances: [bal(cry, 0)],
      accounts,
      tickerDatabase,
      fxRate: FX,
    });
    expect(y.totalKRW).toBe(0);
    expect(y.axes).toEqual([]);
    expect(y.concentration).toBeNull();
    expect(y.excludedCount).toBe(positions.length);
  });

  it("현금만 있으면 모든 축이 현금/KRW 100%", () => {
    const y = buildAllocationXray({ positions: [], balances: [bal(sec, 1_000_000)], accounts, fxRate: null });
    expect(y.totalKRW).toBe(1_000_000 + 0); // usdBalance 100 but fx null → 0
    expect(y.cashPct).toBe(100);
    expect(item(y, "currency", "KRW")?.pct).toBe(100);
    expect(item(y, "market", "현금")?.pct).toBe(100);
    expect(item(y, "assetClass", "현금")?.pct).toBe(100);
  });

  it("음수 예수금(마이너스 잔고)은 0으로 클램프 — 비중이 음수가 되지 않음", () => {
    const y = buildAllocationXray({
      positions: [pos({ accountId: "sec", ticker: "005930", quantity: 1, marketValue: 100_000, marketCurrency: "KRW" })],
      balances: [bal(acct({ id: "sec", type: "securities" }), -50_000)],
      accounts: [acct({ id: "sec", type: "securities" })],
      fxRate: FX,
    });
    expect(y.totalKRW).toBe(100_000);
    expect(y.cashKRW).toBe(0);
    expect(y.axes.every((a) => a.items.every((i) => i.pct >= 0))).toBe(true);
  });

  it("dust 수량 포지션은 제외·미집계", () => {
    const y = buildAllocationXray({
      positions: [pos({ accountId: "sec", ticker: "005930", quantity: 1e-12, marketValue: 100_000, marketCurrency: "KRW" })],
      balances: [],
      accounts,
      fxRate: FX,
    });
    expect(y.totalKRW).toBe(0);
    expect(y.excludedCount).toBe(0);
  });
});
