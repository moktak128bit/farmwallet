/**
 * 배당 포트폴리오 집계(dividendPortfolio) 테스트.
 * 실데이터에서 실제로 총 배당률을 틀리게 만들었던 두 경우를 회귀로 못 박는다.
 *  - 전량 매도 종목: 원가 0이라 분모엔 없는데 연배당은 분자에 남아 총 배당률이 부풀었다
 *  - 1회 수령 종목: 12배 연환산해서 YOC 5.83%로 2위에 올라왔다
 */
import { describe, expect, it } from "vitest";
import { buildDividendPortfolio } from "../utils/dividendPortfolio";
import type { LedgerEntry, StockTrade } from "../types";

let seq = 0;
function div(ticker: string, name: string, date: string, amount: number, currency?: "USD"): LedgerEntry {
  seq += 1;
  return {
    id: `d${seq}`,
    date,
    kind: "income",
    category: "수입",
    subCategory: "배당",
    description: `${ticker} - ${name} 배당`,
    amount,
    toAccountId: "S1",
    ...(currency ? { currency } : {}),
  };
}

function buy(ticker: string, date: string, quantity: number, total: number, fxRateAtTrade?: number): StockTrade {
  seq += 1;
  return {
    id: `t${seq}`,
    date,
    accountId: "S1",
    ticker,
    name: ticker,
    side: "buy",
    quantity,
    price: total / quantity,
    fee: 0,
    totalAmount: total,
    cashImpact: -total,
    ...(fxRateAtTrade ? { fxRateAtTrade } : {}),
  };
}

function sell(ticker: string, date: string, quantity: number, total: number): StockTrade {
  seq += 1;
  return {
    id: `t${seq}`,
    date,
    accountId: "S1",
    ticker,
    name: ticker,
    side: "sell",
    quantity,
    price: total / quantity,
    fee: 0,
    totalAmount: total,
    cashImpact: total,
  };
}

const MONTHS_2026 = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];

describe("buildDividendPortfolio — 총 배당률", () => {
  it("12개월 내내 받은 종목: 연환산 = 실수령 합, YOC = 합 ÷ 원가", () => {
    const trades = [buy("458730", "2025-06-01", 100, 1_000_000)];
    const ledger = [];
    for (let m = 7; m <= 12; m += 1) ledger.push(div("458730", "TIGER 미국배당다우존스", `2025-${String(m).padStart(2, "0")}-02`, 1000));
    for (let m = 1; m <= 6; m += 1) ledger.push(div("458730", "TIGER 미국배당다우존스", `2026-${String(m).padStart(2, "0")}-02`, 1000));

    const p = buildDividendPortfolio({ ledger, trades, currentMonth: "2026-07" });
    expect(p).not.toBeNull();
    // 창 12개월 · 월 1000원 → 연 12,000원, 원가 100만 → 1.2%
    expect(Math.round(p!.annualTotal)).toBe(12_000);
    expect(p!.yoc).toBeCloseTo(1.2, 5);
    expect(p!.totalCost).toBe(1_000_000);
  });

  it("전량 매도한 종목은 분자·분모 모두에서 빠진다 (총 배당률 부풀림 방지)", () => {
    const trades = [
      buy("458730", "2025-06-01", 100, 1_000_000),
      buy("BITX", "2025-06-01", 10, 500_000),
      sell("BITX", "2025-12-01", 10, 600_000), // 전량 매도 → 원가 0
    ];
    const ledger: LedgerEntry[] = [];
    for (const m of MONTHS_2026) {
      ledger.push(div("458730", "TIGER", `${m}-02`, 1000));
      ledger.push(div("BITX", "비트코인 전략 2배", `${m}-02`, 5000));
    }

    const p = buildDividendPortfolio({ ledger, trades, currentMonth: "2026-07" })!;
    const bitx = p.tickers.find((t) => t.ticker === "BITX")!;
    expect(bitx.excluded).toBe("sold");
    expect(bitx.yoc).toBeNull();
    // 매도 종목의 연배당(연 60,000)이 총계에 섞이지 않는다
    expect(Math.round(p.annualTotal)).toBe(12_000);
    expect(p.totalCost).toBe(1_000_000);
    expect(p.excludedCount).toBe(1);
    // 누적 수령은 사실이므로 매도 종목도 포함
    expect(Math.round(p.receivedTotal)).toBe(6 * 1000 + 6 * 5000);
  });

  it("관측 3개월 미만은 연환산을 신뢰하지 않고 총계에서 제외한다", () => {
    const trades = [buy("0111P0", "2026-05-01", 10, 1_000_000)];
    const ledger = [div("0111P0", "1Q 미국나스닥100", "2026-06-03", 6264)];

    const p = buildDividendPortfolio({ ledger, trades, currentMonth: "2026-07" })!;
    const t = p.tickers[0];
    expect(t.months).toBe(1);
    expect(t.excluded).toBe("tooShort");
    expect(t.yoc).toBeNull();
    expect(p.yoc).toBeNull(); // 집계 대상이 하나도 없음
    expect(p.annualTotal).toBe(0);
  });

  it("보유 5개월 종목은 5개월 창으로 연환산한다 (12로 나눠 과소평가하지 않음)", () => {
    const trades = [buy("0167B0", "2026-04-01", 100, 4_000_000)];
    const ledger = ["2026-05", "2026-06", "2026-07", "2026-08"].map((m) =>
      div("0167B0", "SOL 200타겟위클리커버드콜", `${m}-04`, 30_000)
    );

    const p = buildDividendPortfolio({ ledger, trades, currentMonth: "2026-09" })!;
    const t = p.tickers[0];
    expect(t.months).toBe(4); // 2026-05 ~ 2026-08 (이번 달 09는 미완료라 제외)
    expect(Math.round(t.annual)).toBe(360_000); // 120,000 / 4 × 12
    expect(t.yoc).toBeCloseTo(9, 5); // 360,000 / 4,000,000
  });
});

describe("buildDividendPortfolio — 진행 중인 달", () => {
  it("이번 달은 추세선에서 빠지고 partial로 표시된다", () => {
    const trades = [buy("458730", "2025-06-01", 100, 1_000_000)];
    const ledger = [...MONTHS_2026, "2026-07"].map((m) => div("458730", "TIGER", `${m}-02`, 1000));

    const p = buildDividendPortfolio({ ledger, trades, currentMonth: "2026-07" })!;
    const last = p.months[p.months.length - 1];
    expect(last.month).toBe("2026-07");
    expect(last.partial).toBe(true);
    expect(last.rolling).toBeNull();
    expect(last.total).toBe(1000); // 금액 자체는 막대로 보여준다
  });

  it("누적 수령에는 진행 중인 달도 들어간다 (연환산 창만 완료월 기준)", () => {
    const trades = [buy("458730", "2025-06-01", 100, 1_000_000)];
    const ledger = [
      div("458730", "TIGER", "2026-05-02", 1000),
      div("458730", "TIGER", "2026-06-02", 1000),
      div("458730", "TIGER", "2026-07-02", 5000), // 진행 중인 달 — 누적엔 포함
    ];
    const p = buildDividendPortfolio({ ledger, trades, currentMonth: "2026-07" })!;
    expect(p.receivedTotal).toBe(7000);
    expect(p.tickers[0].total).toBe(7000);
    // 연환산 창은 완료월(2026-06)까지만 본다 — 진행 중인 달이 연환산을 부풀리면 안 된다
    expect(p.months[p.months.length - 1].partial).toBe(true);
  });

  it("월 배당은 최근 완료 3개월 평균 (이번 달 제외)", () => {
    const trades = [buy("458730", "2025-06-01", 100, 1_000_000)];
    const ledger = [
      div("458730", "TIGER", "2026-04-02", 10_000),
      div("458730", "TIGER", "2026-05-02", 20_000),
      div("458730", "TIGER", "2026-06-02", 30_000),
      div("458730", "TIGER", "2026-07-02", 999_999), // 진행 중 — 평균에 들어가면 안 됨
    ];

    const p = buildDividendPortfolio({ ledger, trades, currentMonth: "2026-07" })!;
    expect(Math.round(p.monthlyAvg)).toBe(20_000);
    expect(p.lastMonth).toEqual({ month: "2026-06", amount: 30_000 });
  });
});

describe("buildDividendPortfolio — 통화·원가", () => {
  it("USD 배당은 환율로 KRW 환산하고, 원가는 매입 당시 환율을 쓴다", () => {
    // 매입 당시 1,300원, 현재 1,400원 — 원가가 현재 환율로 계산되면 YOC가 환율 따라 흔들린다
    const trades = [buy("SCHD", "2025-06-01", 100, 1000, 1300)];
    const ledger = MONTHS_2026.map((m) => div("SCHD", "슈드", `${m}-02`, 10, "USD"));

    const p = buildDividendPortfolio({ ledger, trades, currentMonth: "2026-07", fxRate: 1400 })!;
    expect(p.totalCost).toBe(1000 * 1300); // 매입 당시 환율
    const t = p.tickers[0];
    expect(Math.round(t.total)).toBe(6 * 10 * 1400); // 배당은 현재 환율로 환산
  });

  it("환율이 없으면 USD 배당 기록은 집계하지 않는다 (환율배수만큼 왜곡 방지)", () => {
    const trades = [buy("SCHD", "2025-06-01", 100, 1000, 1300)];
    const ledger = MONTHS_2026.map((m) => div("SCHD", "슈드", `${m}-02`, 10, "USD"));
    expect(buildDividendPortfolio({ ledger, trades, currentMonth: "2026-07" })).toBeNull();
  });

  it("배당 기록이 없으면 null", () => {
    expect(buildDividendPortfolio({ ledger: [], trades: [], currentMonth: "2026-07" })).toBeNull();
  });
});
