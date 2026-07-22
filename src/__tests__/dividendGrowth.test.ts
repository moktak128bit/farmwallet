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

  it("보유주식 미기재 지급월은 월말 보유 수량으로 주당 분배금을 추정한다 (0으로 섞이지도, 제외되지도 않음)", () => {
    const noNote = { ...div("2026-05-06", "458730", "TIGER 미국배당다우존스", 1000, 1), note: undefined };
    const ledger = [
      div("2026-04-02", "458730", "TIGER 미국배당다우존스", 400, 10), // 주당 40
      noNote, // 5월: 수령 1,000원, 보유주식 미기재 → 월말 보유 10주로 추정 = 주당 100
      div("2026-06-02", "458730", "TIGER 미국배당다우존스", 500, 10), // 주당 50
    ];
    const r = buildDividendGrowth({
      ticker: "458730",
      ledger,
      trades: [buy("2026-03-15", "458730", 10, 10000)],
      prices: [],
      currentMonth: "2026-06",
    });
    // (40+100+50)/3 × 12 = 760 — 5월을 0으로 섞은 360도, 제외한 540도 아님
    expect(r!.current.annualPerShare).toBeCloseTo(760);
  });

  it("다계좌 동일 지급일: 주당 분배금은 '금액 합 ÷ 계좌별 보유 합'으로 한 번만 (이중 계상 방지)", () => {
    const ledger = [
      { ...div("2026-05-06", "458730", "TIGER 미국배당다우존스", 25_000, 100), toAccountId: "A" },
      { ...div("2026-05-06", "458730", "TIGER 미국배당다우존스", 12_500, 50), toAccountId: "B" },
    ];
    const r = buildDividendGrowth({
      ticker: "458730",
      ledger,
      trades: [buy("2026-04-15", "458730", 150, 10000)],
      prices: [],
      currentMonth: "2026-05",
    });
    const may = r!.points.find((p) => p.month === "2026-05")!;
    expect(may.received).toBe(37_500);
    expect(may.perShare).toBeCloseTo(250); // 37,500/150 — 기록별 합산(250+250=500)이 아님
  });

  it("같은 계좌·같은 날 복수 기록(정규+특별)은 보유를 한 번만 세어 주당 분배금이 합산된다", () => {
    const ledger = [
      { ...div("2026-05-06", "458730", "TIGER 미국배당다우존스", 25_000, 100), toAccountId: "A" },
      { ...div("2026-05-06", "458730", "TIGER 미국배당다우존스", 50_000, 100), toAccountId: "A" },
    ];
    const r = buildDividendGrowth({
      ticker: "458730",
      ledger,
      trades: [buy("2026-04-15", "458730", 100, 10000)],
      prices: [],
      currentMonth: "2026-05",
    });
    // 75,000 / 100주 = 750 — 보유를 이중 합산(75,000/200=375)하지 않음
    expect(r!.points.find((p) => p.month === "2026-05")!.perShare).toBeCloseTo(750);
  });

  it("전량 매도~재매수 갭(보유 0 무지급 달)은 연환산 분모에서 제외된다", () => {
    const mk = (d: string) => div(d, "458730", "TIGER 미국배당다우존스", 1000, 10); // 주당 100
    const ledger = [mk("2026-01-05"), mk("2026-02-05"), mk("2026-03-05"), mk("2026-07-05"), mk("2026-08-05"), mk("2026-09-05")];
    const trades = [
      buy("2025-12-15", "458730", 10, 10000),
      { ...buy("2026-03-20", "458730", 10, 11000), side: "sell" as const }, // 전량 매도
      buy("2026-07-01", "458730", 10, 11000), // 재매수
    ];
    const r = buildDividendGrowth({ ticker: "458730", ledger, trades, prices: [], currentMonth: "2026-09" });
    // 창 = 1~9월(9개월), 지급 6회 각 주당 100, 4~6월은 보유 0 → 분모 9−3=6 → 100×12=1,200
    expect(r!.current.annualPerShare).toBeCloseTo(1200);
  });

  it("분기배당: 무분배 달을 0으로 포함해 연환산한다 ('지급 달 평균×12'로 3배 부풀지 않음)", () => {
    // 분기마다 주당 750원 (연 3,000원) — 최근 12개월 창(2025-10~2026-09)에 지급 4회
    const ledger = ["2025-09-02", "2025-12-02", "2026-03-02", "2026-06-02", "2026-09-02"]
      .map((d) => div(d, "005930", "삼성전자", 7500, 10));
    const r = buildDividendGrowth({
      ticker: "005930",
      ledger,
      trades: [buy("2025-08-15", "005930", 10, 60000)],
      prices: [],
      currentMonth: "2026-09",
    })!;
    expect(r.current.annualPerShare).toBeCloseTo(3000); // 750×12=9,000이 아님
    expect(r.current.yoc).toBeCloseTo((3000 / 60000) * 100); // 5%
  });

  it("진행 중인 이번 달이 아직 미지급이면 창에서 제외한다 (지급일 전 과소 방지)", () => {
    const ledger = [
      div("2026-04-02", "458730", "TIGER 미국배당다우존스", 1000, 10), // 주당 100
      div("2026-05-06", "458730", "TIGER 미국배당다우존스", 1000, 10),
      div("2026-06-02", "458730", "TIGER 미국배당다우존스", 1000, 10),
    ];
    const r = buildDividendGrowth({
      ticker: "458730",
      ledger,
      trades: [buy("2026-03-15", "458730", 10, 10000)],
      prices: [],
      currentMonth: "2026-07", // 7월 지급 전
    })!;
    expect(r.current.annualPerShare).toBeCloseTo(1200); // 100×12 — 7월 0을 섞은 900이 아님
  });

  it("USD 매수 원가는 매입 당시 환율(fxRateAtTrade) — 현재 환율로 소급 재환산하지 않는다", () => {
    const ledger: LedgerEntry[] = [
      { id: "ud2", date: "2026-06-03", kind: "income", category: "수입", subCategory: "배당", description: "SCHD - Schwab US Dividend 배당", amount: 5200, note: "보유주식: 10" },
    ];
    const trades: StockTrade[] = [
      { id: "ut2", date: "2026-05-02", accountId: "a1", ticker: "SCHD", name: "SCHD", side: "buy", quantity: 10, price: 80, fee: 0, totalAmount: 800, cashImpact: 0, fxRateAtTrade: 1300 },
    ];
    const r = buildDividendGrowth({ ticker: "SCHD", ledger, trades, prices: [], currentMonth: "2026-06", fxRate: 1430 })!;
    const jun = r.points.find((p) => p.month === "2026-06")!;
    expect(jun.avgCost).toBeCloseTo(80 * 1300); // 104,000 — 80×1430=114,400 아님
    // 분배금(수령 시점 환산 KRW 저장)과 원가(매입 환율)가 모두 고정 → YOC가 현재 환율에 흔들리지 않음
    expect(jun.monthlyYoc).toBeCloseTo((520 / (80 * 1300)) * 100, 4);
  });

  it("분배금 기록이 없으면 null", () => {
    expect(
      buildDividendGrowth({ ticker: "005930", ledger: [], trades: [buy("2026-01-02", "005930", 1, 60000)], prices: [], currentMonth: "2026-06" })
    ).toBeNull();
  });

  it("USD 종목: fxRate로 분배금·주가·평단을 KRW로 정규화 (비율은 보존)", () => {
    const ledger: LedgerEntry[] = [
      { id: "ud", date: "2026-06-03", kind: "income", category: "수입", subCategory: "배당", description: "SCHD - Schwab US Dividend 배당", amount: 4, note: "보유주식: 10", currency: "USD" },
    ];
    const trades: StockTrade[] = [
      { id: "ut", date: "2026-05-02", accountId: "a1", ticker: "SCHD", name: "SCHD", side: "buy", quantity: 10, price: 80, fee: 0, totalAmount: 800, cashImpact: 0, fxRateAtTrade: 1300 },
    ];
    const r = buildDividendGrowth({
      ticker: "SCHD",
      ledger,
      trades,
      prices: [{ ticker: "SCHD", price: 85 }],
      currentMonth: "2026-06",
      fxRate: 1300,
    })!;
    const jun = r.points.find((p) => p.month === "2026-06")!;
    expect(jun.received).toBe(4 * 1300); // 분배금 USD → KRW
    expect(jun.price).toBe(85 * 1300); // 주가 USD → KRW
    expect(jun.avgCost).toBeCloseTo(80 * 1300); // 평단 USD → KRW
    // YoC = 주당분배금/평단 = (0.4×1300)/(80×1300) = 0.4/80 → 비율은 환율 무관하게 보존
    expect(jun.monthlyYoc).toBeCloseTo((0.4 / 80) * 100, 4);
  });

  it("USD 종목인데 환율 없으면 null (왜곡 방지)", () => {
    const ledger: LedgerEntry[] = [
      { id: "ud", date: "2026-06-03", kind: "income", category: "수입", subCategory: "배당", description: "SCHD - Schwab 배당", amount: 4, note: "보유주식: 10", currency: "USD" },
    ];
    const r = buildDividendGrowth({
      ticker: "SCHD",
      ledger,
      trades: [{ id: "ut", date: "2026-05-02", accountId: "a1", ticker: "SCHD", name: "SCHD", side: "buy", quantity: 10, price: 80, fee: 0, totalAmount: 800, cashImpact: 0 }],
      prices: [],
      currentMonth: "2026-06",
    });
    expect(r).toBeNull();
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
