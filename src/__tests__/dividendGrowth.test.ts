/**
 * 배당 성장 추적(utils/dividendGrowth) 테스트 — "버핏의 코카콜라" 위젯 데이터.
 * 실데이터 형식 그대로: 배당 기록 description "TICKER - 이름 배당", note "보유주식: N".
 */
import { describe, expect, it } from "vitest";
import type { LedgerEntry, StockTrade } from "../types";
import { buildDividendGrowth, resolveTrackedTickers } from "../utils/dividendGrowth";

let seq = 0;
const div = (date: string, ticker: string, name: string, amount: number, shares: number): LedgerEntry => ({
  id: `d${++seq}`,
  date,
  kind: "income",
  category: "수입",
  subCategory: "배당",
  description: `${ticker} - ${name} 배당`,
  amount,
  note: `보유주식: ${shares}`,
});
const buy = (date: string, ticker: string, qty: number, price: number): StockTrade => ({
  id: `t${++seq}`,
  date,
  accountId: "a1",
  ticker,
  name: ticker,
  side: "buy",
  quantity: qty,
  price,
  fee: 0,
  totalAmount: qty * price,
  cashImpact: -qty * price,
});

describe("buildDividendGrowth", () => {
  it("월별 수령액·주당 분배금·분배율·YOC를 계산한다 (모아가는 시나리오)", () => {
    const ledger = [
      div("2026-04-02", "458730", "TIGER 미국배당다우존스", 320, 8),   // 주당 40원
      div("2026-05-06", "458730", "TIGER 미국배당다우존스", 450, 10),  // 주당 45원
      div("2026-06-02", "458730", "TIGER 미국배당다우존스", 1500, 30), // 주당 50원
    ];
    const trades = [
      buy("2026-03-15", "458730", 8, 10000),
      buy("2026-04-20", "458730", 2, 11000),
      buy("2026-05-20", "458730", 20, 12000),
    ];
    const r = buildDividendGrowth({
      ticker: "458730",
      ledger,
      trades,
      prices: [{ ticker: "458730", price: 12500 }],
      currentMonth: "2026-06",
    });
    expect(r).not.toBeNull();
    expect(r!.name).toBe("TIGER 미국배당다우존스");
    expect(r!.points.map((p) => p.month)).toEqual(["2026-03", "2026-04", "2026-05", "2026-06"]);

    const jun = r!.points[3];
    expect(jun.received).toBe(1500);
    expect(jun.perShare).toBeCloseTo(50);
    expect(jun.shares).toBe(30);
    // 평단 = (8×1만 + 2×1.1만 + 20×1.2만) / 30 = 11,400
    expect(jun.avgCost).toBeCloseTo(11400);
    // 이번 달 주가 = 현재 시세 폴백(12500), 월 분배율(주가 대비) = 50/12500 = 0.4%
    expect(jun.price).toBe(12500);
    expect(jun.monthlyYield).toBeCloseTo(0.4);
    // 월 분배율(내 매입금 대비) = 50/11400 ≈ 0.4386% — 주가 대비보다 높음 (싸게 산 만큼)
    expect(jun.monthlyYoc).toBeCloseTo(0.4386, 3);
    // 수령액 막대가 우상향
    expect(r!.points.map((p) => p.received)).toEqual([0, 320, 450, 1500]);
  });

  it("주가 폴백: 그 달 종가 없으면 마지막 거래가 → 스냅샷 순", () => {
    const ledger = [div("2026-05-04", "0167B0", "SOL 200타겟위클리커버드콜", 2000, 8)];
    const trades = [buy("2026-04-10", "0167b0", 8, 9800)]; // 소문자 티커도 canonical 매칭
    const r = buildDividendGrowth({
      ticker: "0167B0",
      ledger,
      trades,
      prices: [],
      historicalDailyCloses: [{ ticker: "0167B0", date: "2026-05-28", close: 9900 }],
      marketEnvSnapshots: [
        { date: "2026-04-15", fxRate: 1400, prices: [{ ticker: "0167B0", price: 9750 }], recordedAt: "" },
      ],
      currentMonth: "2026-05",
    });
    expect(r).not.toBeNull();
    const [apr, may] = r!.points;
    expect(apr.price).toBe(9800);  // 종가 없음 → 그 달 거래가 (스냅샷보다 우선)
    expect(may.price).toBe(9900);  // 월말 종가
    expect(may.perShare).toBeCloseTo(250);
  });

  it("분배금 기록이 없으면 null", () => {
    expect(
      buildDividendGrowth({ ticker: "005930", ledger: [], trades: [buy("2026-01-02", "005930", 1, 60000)], prices: [], currentMonth: "2026-06" })
    ).toBeNull();
  });

  it("매도 시 평단 유지·원가 비례 차감 (이동평균법)", () => {
    const ledger = [div("2026-06-01", "458730", "TIGER 미국배당다우존스", 100, 5)];
    const trades = [
      buy("2026-05-02", "458730", 10, 10000),
      { ...buy("2026-05-20", "458730", 5, 13000), side: "sell" as const },
    ];
    const r = buildDividendGrowth({ ticker: "458730", ledger, trades, prices: [], currentMonth: "2026-06" });
    const may = r!.points.find((p) => p.month === "2026-05")!;
    expect(may.shares).toBe(5);
    expect(may.avgCost).toBeCloseTo(10000); // 매도해도 평단 불변
  });
});

describe("resolveTrackedTickers", () => {
  const ledger = [
    div("2026-06-02", "458730", "TIGER 미국배당다우존스", 1152, 32),
    div("2026-05-06", "458730", "TIGER 미국배당다우존스", 99, 3),
    div("2026-06-01", "0167B0", "SOL 200타겟위클리커버드콜", 7595, 35),
    div("2026-05-04", "0167B0", "SOL 200타겟위클리커버드콜", 2000, 8),
    div("2026-05-08", "379800", "KODEX 미국S&P500", 3540, 30), // 기록 1건 → 자동 보충 제외
  ];
  const trades = [
    buy("2026-01-02", "458730", 120, 10000),
    buy("2026-03-02", "0167b0", 130, 9800),
    buy("2026-02-02", "379800", 30, 20000),
  ];

  it("설정 티커 우선 + 2개 미만이면 최근 수령 순으로 자동 보충 (사용자 시나리오)", () => {
    // 설정 = "458730" 하나 → SOL(분배 기록 2건, 최근 수령)이 자동 보충됨
    expect(resolveTrackedTickers("458730", ledger, trades)).toEqual(["458730", "0167B0"]);
  });

  it("쉼표 구분 복수 설정을 그대로 사용한다", () => {
    expect(resolveTrackedTickers("458730, 0167b0", ledger, trades)).toEqual(["458730", "0167B0"]);
  });

  it("설정이 비어 있으면 자동 감지 상위 2개", () => {
    expect(resolveTrackedTickers(undefined, ledger, trades)).toEqual(["458730", "0167B0"]);
  });

  it("보유 0 종목은 자동 보충 대상에서 제외", () => {
    const sold = [...trades, { ...buy("2026-06-01", "0167B0", 130, 9900), side: "sell" as const }];
    expect(resolveTrackedTickers(undefined, ledger, sold)).toEqual(["458730"]);
  });
});
