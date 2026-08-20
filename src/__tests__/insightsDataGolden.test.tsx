// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useInsightsData } from "../features/insights/useInsightsData";
import type { Account, CategoryPresets, LedgerEntry, StockPrice, StockTrade } from "../types";
import type { AccountTimelineRow } from "../utils/accountTimeline";

/**
 * useInsightsData 골든 스냅샷 — 2단 분층(buildInsightsBase + sliceInsightsForMonth) 리팩터의
 * 동작 불변 증거. 실데이터 모양(3세대 지출 스키마·USD·주식거래·정산·데이트 계좌·레거시 신용결제/재테크)을
 * 담은 픽스처로 D 객체 전체(숫자 전부)를 파일 스냅샷에 고정한다.
 *
 * ⚠ 픽스처 날짜는 전부 과거(2025-01~04)라 getTodayKST() 의존 항목(진행 중인 달 캡·무지출일 분모)이
 *   시간이 흘러도 흔들리지 않는다. 스냅샷이 깨지면 "숫자가 바뀐 이유"를 반드시 설명할 것.
 */

function entry(o: Partial<LedgerEntry> & { id: string; amount: number; date: string }): LedgerEntry {
  return { kind: "expense", category: "지출", description: "", ...o } as LedgerEntry;
}
function acct(o: Partial<Account> & { id: string; name: string; type: Account["type"] }): Account {
  return { institution: "", initialBalance: 0, ...o } as Account;
}
function trade(o: Partial<StockTrade> & { id: string; date: string; accountId: string; ticker: string; side: StockTrade["side"]; quantity: number; price: number }): StockTrade {
  const fee = o.fee ?? 0;
  const total = o.totalAmount ?? o.quantity * o.price + fee;
  return { name: o.ticker, fee, totalAmount: total, cashImpact: o.side === "buy" ? -total : total, ...o } as StockTrade;
}

const accounts: Account[] = [
  acct({ id: "a1", name: "급여통장", type: "checking", initialBalance: 1_000_000 }),
  acct({ id: "a2", name: "데이트 모임통장", type: "checking", initialBalance: 50_000 }),
  acct({ id: "a3", name: "해외증권", type: "securities", initialBalance: 0, usdBalance: 120, cashAdjustment: 10_000 }),
  acct({ id: "a4", name: "신용카드", type: "card", initialBalance: 0 }),
  acct({ id: "a5", name: "코인지갑", type: "crypto", initialBalance: 0 }),
  acct({ id: "a6", name: "적금", type: "savings", initialBalance: 5_000_000, savings: 100_000 }),
  acct({ id: "a7", name: "연금저축", type: "securities", isPension: true, initialBalance: 2_000_000 }),
];

const MONTHS = ["2025-01", "2025-02", "2025-03", "2025-04"];

const ledger: LedgerEntry[] = [
  // ── 수입: 급여(매월)·배당(매월, 3월은 USD 1건 추가)·정산·용돈·투자수익·이월
  ...MONTHS.map((m, i) => entry({ id: `sal${i}`, date: `${m}-25`, amount: 3_000_000, kind: "income", category: "수입", subCategory: "급여", toAccountId: "a1", description: "월급" })),
  ...MONTHS.map((m, i) => entry({ id: `div${i}`, date: `${m}-10`, amount: 80_000 + i * 5_000, kind: "income", category: "수입", subCategory: "배당", toAccountId: "a3", description: "배당금" })),
  entry({ id: "divUsd", date: "2025-03-12", amount: 12.5, currency: "USD", kind: "income", category: "수입", subCategory: "배당", toAccountId: "a3", description: "AAPL 배당" }),
  entry({ id: "settle", date: "2025-02-05", amount: 180_000, kind: "income", category: "수입", subCategory: "데이트통장", toAccountId: "a2", description: "정산 입금", settledLedgerIds: ["dt1", "dt2"] }),
  entry({ id: "allow", date: "2025-02-06", amount: 150_000, kind: "income", category: "수입", subCategory: "용돈", toAccountId: "a1", description: "어머니" }),
  entry({ id: "bonus", date: "2025-03-20", amount: 1_000_000, kind: "income", category: "수입", subCategory: "상여", toAccountId: "a1", description: "성과급" }),
  entry({ id: "invInc", date: "2025-03-15", amount: 50_000, kind: "income", category: "수입", subCategory: "투자수익", toAccountId: "a3", description: "매도차익" }),
  entry({ id: "carry", date: "2025-01-01", amount: 9_000_000, kind: "income", category: "이월", toAccountId: "a1", description: "원래 보유" }),
  entry({ id: "cashback", date: "2025-04-02", amount: 3_200, kind: "income", category: "수입", subCategory: "캐시백", toAccountId: "a4", description: "카드 캐시백" }),
  // ── 지출 3세대: 현행(지출/대분류/소분류)
  ...MONTHS.flatMap((m, i) => [
    entry({ id: `rent${i}`, date: `${m}-01`, amount: 500_000, subCategory: "주거비", detailCategory: "월세", description: "월세", fromAccountId: "a1", isFixedExpense: true }),
    entry({ id: `food${i}a`, date: `${m}-03`, amount: 12_000 + i * 1_000, subCategory: "식비", detailCategory: "외식", description: "김밥천국", fromAccountId: "a4" }),
    entry({ id: `food${i}b`, date: `${m}-11`, amount: 45_000, subCategory: "식비", detailCategory: "외식", description: "삼겹살집", fromAccountId: "a4" }),
    entry({ id: `food${i}c`, date: `${m}-18`, amount: 6_500, subCategory: "식비", detailCategory: "카페", description: "스타벅스", fromAccountId: "a4" }),
    entry({ id: `sub${i}`, date: `${m}-05`, amount: 17_000, subCategory: "구독", detailCategory: "OTT", description: "넷플릭스", fromAccountId: "a4" }),
    entry({ id: `tr${i}`, date: `${m}-08`, amount: 55_000, subCategory: "교통", detailCategory: "대중교통", description: "교통카드 충전", fromAccountId: "a1" }),
  ]),
  entry({ id: "big1", date: "2025-02-15", amount: 1_350_000, subCategory: "쇼핑", detailCategory: "전자기기", description: "노트북", fromAccountId: "a4" }),
  entry({ id: "big2", date: "2025-04-19", amount: 220_000, subCategory: "의료", detailCategory: "병원", description: "치과", fromAccountId: "a1" }),
  entry({ id: "wk1", date: "2025-03-01", amount: 38_000, subCategory: "식비", detailCategory: "외식", description: "주말 브런치", fromAccountId: "a4" }), // 토요일
  entry({ id: "wk2", date: "2025-03-02", amount: 28_000, subCategory: "여가", detailCategory: "영화", description: "CGV", fromAccountId: "a4" }), // 일요일
  entry({ id: "usdExp", date: "2025-04-07", amount: 30, currency: "USD", subCategory: "쇼핑", detailCategory: "해외직구", description: "아마존", fromAccountId: "a3" }),
  entry({ id: "dis", date: "2025-04-08", amount: 9_000, discountAmount: 1_000, subCategory: "식비", detailCategory: "배달", description: "배민", fromAccountId: "a4" }),
  // 레거시 2세대: category=대분류, subCategory=소분류
  entry({ id: "leg2a", date: "2025-01-20", amount: 32_000, category: "식비", subCategory: "카페", description: "투썸", fromAccountId: "a4" }),
  entry({ id: "leg2b", date: "2025-02-20", amount: 8_900, category: "생활", subCategory: "편의점", description: "GS25", fromAccountId: "a1" }),
  // 레거시 1세대: category만
  entry({ id: "leg1a", date: "2025-01-22", amount: 4_500, category: "교통", description: "버스", fromAccountId: "a1" }),
  entry({ id: "leg1b", date: "2025-03-22", amount: 0, category: "기타", description: "0원 항목", fromAccountId: "a1" }),
  // 레거시 신용결제(이중계상 → 제외)·환전(제외)·재테크 expense(저축/투자손실)
  entry({ id: "credit", date: "2025-02-25", amount: 400_000, category: "신용결제", description: "카드대금", fromAccountId: "a1" }),
  entry({ id: "fx", date: "2025-03-03", amount: 140_000, category: "지출", subCategory: "환전", description: "달러 환전", fromAccountId: "a1" }),
  entry({ id: "legSav", date: "2025-01-27", amount: 200_000, category: "재테크", subCategory: "저축", description: "적금", fromAccountId: "a1" }),
  entry({ id: "legLoss", date: "2025-03-27", amount: 30_000, category: "재테크", subCategory: "투자손실", description: "손절", fromAccountId: "a3" }),
  entry({ id: "legInv", date: "2025-02-27", amount: 300_000, category: "재테크", subCategory: "투자", description: "ETF", fromAccountId: "a1" }),
  // 데이트(모임통장/개인통장 혼합) — 정산 대상
  entry({ id: "dt1", date: "2025-01-14", amount: 64_000, subCategory: "데이트", detailCategory: "식사", description: "파스타집", fromAccountId: "a2" }),
  entry({ id: "dt2", date: "2025-01-14", amount: 22_000, subCategory: "데이트", detailCategory: "카페", description: "디저트카페", fromAccountId: "a1" }),
  entry({ id: "dt3", date: "2025-02-14", amount: 150_000, subCategory: "데이트", detailCategory: "선물", description: "발렌타인 선물", fromAccountId: "a1" }),
  entry({ id: "dt4", date: "2025-03-08", amount: 48_000, subCategory: "데이트", detailCategory: "식사", description: "초밥", fromAccountId: "a2" }),
  entry({ id: "dt5", date: "2025-04-12", amount: 30_000, subCategory: "데이트", detailCategory: "영화", description: "메가박스", fromAccountId: "a2" }),
  // ── 이체: 투자이체(증권)·계좌이체(코인)·USD 투자이체·저축이체·카드결제이체·모임통장 입금
  ...MONTHS.map((m, i) => entry({ id: `inv${i}`, date: `${m}-26`, amount: 1_000_000, kind: "transfer", category: "이체", subCategory: "투자이체", fromAccountId: "a1", toAccountId: "a3", description: "증권 입금" })),
  ...MONTHS.map((m, i) => entry({ id: `sav${i}`, date: `${m}-26`, amount: 300_000, kind: "transfer", category: "이체", subCategory: "저축이체", fromAccountId: "a1", toAccountId: "a6", description: "적금 자동이체" })),
  entry({ id: "coin", date: "2025-02-10", amount: 500_000, kind: "transfer", category: "이체", subCategory: "계좌이체", fromAccountId: "a1", toAccountId: "a5", description: "업비트 입금" }),
  entry({ id: "usdInv", date: "2025-03-04", amount: 100, currency: "USD", kind: "transfer", category: "이체", subCategory: "투자이체", fromAccountId: "a1", toAccountId: "a3", description: "달러 입금" }),
  entry({ id: "cardPay", date: "2025-02-25", amount: 400_000, kind: "transfer", category: "이체", subCategory: "카드결제이체", fromAccountId: "a1", toAccountId: "a4", description: "카드대금" }),
  ...MONTHS.map((m, i) => entry({ id: `moimIn${i}`, date: `${m}-02`, amount: 100_000, kind: "transfer", category: "이체", subCategory: "계좌이체", fromAccountId: "a1", toAccountId: "a2", description: "모임통장 입금" })),
  entry({ id: "pension", date: "2025-04-26", amount: 250_000, kind: "transfer", category: "이체", subCategory: "투자이체", fromAccountId: "a1", toAccountId: "a7", description: "연금저축 납입" }),
];

// 기간 필터 전 전체 가계부 — 2024년 항목이 더 있다(계좌 잔액 누적에만 영향)
const allLedger: LedgerEntry[] = [
  entry({ id: "old1", date: "2024-12-20", amount: 77_000, subCategory: "식비", detailCategory: "외식", description: "작년 회식", fromAccountId: "a1" }),
  entry({ id: "old2", date: "2024-12-25", amount: 3_000_000, kind: "income", category: "수입", subCategory: "급여", toAccountId: "a1", description: "월급" }),
  ...ledger,
];

const trades: StockTrade[] = [
  trade({ id: "t1", date: "2025-01-10", accountId: "a3", ticker: "AAPL", name: "Apple", side: "buy", quantity: 10, price: 150, fee: 1, fxRateAtTrade: 1_380 }),
  trade({ id: "t2", date: "2025-02-03", accountId: "a3", ticker: "005930", name: "삼성전자", side: "buy", quantity: 10, price: 70_000, fee: 100 }),
  trade({ id: "t3", date: "2025-03-05", accountId: "a3", ticker: "AAPL", name: "Apple", side: "sell", quantity: 4, price: 170, fee: 1, fxRateAtTrade: 1_420 }),
  trade({ id: "t4", date: "2025-03-18", accountId: "a5", ticker: "BTC", name: "Bitcoin", side: "buy", quantity: 0.01, price: 60_000, fxRateAtTrade: 1_400 }),
  trade({ id: "t5", date: "2025-04-09", accountId: "a3", ticker: "005930", name: "삼성전자", side: "sell", quantity: 5, price: 65_000, fee: 100 }),
  trade({ id: "t6", date: "2025-04-21", accountId: "a7", ticker: "360750", name: "TIGER 미국S&P500", side: "buy", quantity: 20, price: 12_500 }),
  trade({ id: "t7", date: "2025-04-22", accountId: "a3", ticker: "MSFT", name: "Microsoft", side: "buy", quantity: 2, price: 400, fxRateAtTrade: 1_410 }),
];
// 기간 필터 전 전체 거래 — 2024년 매수 1건(FIFO 원가 소진에 영향)
const allTrades: StockTrade[] = [
  trade({ id: "t0", date: "2024-12-15", accountId: "a3", ticker: "AAPL", name: "Apple", side: "buy", quantity: 2, price: 120, fxRateAtTrade: 1_350 }),
  ...trades,
];

const prices: StockPrice[] = [
  { ticker: "AAPL", price: 180, currency: "USD", updatedAt: "2025-04-30" },
  { ticker: "005930", price: 66_000, currency: "KRW", updatedAt: "2025-04-30" },
  { ticker: "BTC", price: 55_000, currency: "USD", updatedAt: "2025-04-30" },
  { ticker: "360750", price: 13_100, currency: "KRW", updatedAt: "2025-04-30" },
  // MSFT 시세 없음 → priceFallback:"cost" 경로
];

const timelineRows: AccountTimelineRow[] = [
  { month: "2024-12", stock: 300_000, savings: 5_000_000, asset: 9_500_000, debt: 0, total: 9_500_000, pension: 2_000_000 },
  { month: "2025-01", stock: 2_400_000, savings: 5_300_000, asset: 12_000_000, debt: 120_000, total: 11_880_000, pension: 2_000_000 },
  { month: "2025-02", stock: 3_100_000, savings: 5_600_000, asset: 12_900_000, debt: 90_000, total: 12_810_000, pension: 2_000_000 },
  { month: "2025-03", stock: 3_000_000, savings: 5_900_000, asset: 14_200_000, debt: 60_000, total: 14_140_000, pension: 2_000_000 },
  { month: "2025-04", stock: 3_600_000, savings: 6_200_000, asset: 15_100_000, debt: 30_000, total: 15_070_000, pension: 2_250_000 },
];

const presets: CategoryPresets = {
  income: ["급여", "상여", "배당", "용돈", "데이트통장", "투자수익", "캐시백"],
  expense: ["식비", "주거비", "교통", "구독", "쇼핑", "의료", "여가", "데이트", "생활", "기타"],
  transfer: ["투자이체", "저축이체", "계좌이체", "카드결제이체"],
  categoryTypes: {
    fixed: ["주거비", "구독"],
    savings: ["재테크"],
    nonRealIncome: ["용돈"],
    salary: ["급여", "상여"],
    passive: ["배당"],
  },
};

const FX = 1_400;

function run(selMonth: string | null, opts: { fxRate?: number | null; dateAccountId?: string | null; presets?: CategoryPresets | undefined } = {}) {
  const fxRate = opts.fxRate === undefined ? FX : opts.fxRate;
  const dateAccountId = opts.dateAccountId === undefined ? "a2" : opts.dateAccountId;
  const cp = "presets" in opts ? opts.presets : presets;
  return renderHook(() =>
    useInsightsData(ledger, trades, allTrades, accounts, prices, selMonth, cp, undefined, dateAccountId, fxRate, timelineRows, allLedger)
  ).result.current;
}

describe("useInsightsData 골든 스냅샷 (동작 불변 리팩터 기준선)", () => {
  it("전체 기간(selMonth=null) — 키 순서·값 전부 고정", () => {
    const d = run(null);
    expect(Object.keys(d)).toMatchSnapshot("keys");
    expect(d).toMatchSnapshot("full");
  });

  it("월 선택(selMonth=2025-02, 정산·노트북·코인이체 포함 달)", () => {
    const d = run("2025-02");
    expect(d).toMatchSnapshot();
  });

  it("월 선택(selMonth=2025-03, USD 배당·매도·환전 포함 달)", () => {
    const d = run("2025-03");
    expect(d).toMatchSnapshot();
  });

  it("환율 미로드(fxRate=null)·데이트 계좌 미설정·프리셋 없음 — 폴백 경로", () => {
    const d = run(null, { fxRate: null, dateAccountId: null, presets: undefined });
    expect(d).toMatchSnapshot();
  });

  it("가계부·거래 비어 있음 — 빈 상태 안전", () => {
    const d = renderHook(() =>
      useInsightsData([], [], [], accounts, [], null, presets, undefined, "a2", FX, [], [])
    ).result.current;
    expect(d).toMatchSnapshot();
  });

  it("월 선택만 바뀌면 전기간 base(월별 맵·추세·포지션·계좌 잔액)는 재계산 없이 같은 참조를 재사용한다", () => {
    const hook = renderHook(
      ({ sel }: { sel: string | null }) =>
        useInsightsData(ledger, trades, allTrades, accounts, prices, sel, presets, undefined, "a2", FX, timelineRows, allLedger),
      { initialProps: { sel: null as string | null } },
    );
    const before = hook.result.current;
    hook.rerender({ sel: "2025-02" });
    const after = hook.result.current;
    expect(after).not.toBe(before);
    expect(after.selMonth).toBe("2025-02");
    // 전기간 파생은 base 참조 그대로 (예전 단일 useMemo 구조에선 매번 새 객체였다)
    expect(after.monthly).toBe(before.monthly);
    expect(after.months).toBe(before.months);
    expect(after.savRateTrend).toBe(before.savRateTrend);
    expect(after.cumSpend).toBe(before.cumSpend);
    expect(after.netWorthByMonth).toBe(before.netWorthByMonth);
    expect(after.accountBalances).toBe(before.accountBalances);
    expect(after.portfolio).toBe(before.portfolio);
    expect(after.stockTrends).toBe(before.stockTrends);
    expect(after.moimFlow).toBe(before.moimFlow);
    // 선택월 파생은 새로 계산
    expect(after.pExpense).not.toBe(before.pExpense);
    // 다시 전체 기간으로 돌아오면 골든과 동일 값
    hook.rerender({ sel: null });
    expect(hook.result.current).toEqual(before);
  });

  it("월 선택 변경 시 전기간 파생(monthly·trend·계좌 잔액)은 전체 기간 결과와 동일 참조/값", () => {
    const all = run(null);
    const feb = run("2025-02");
    // 전기간 집계는 selMonth와 무관 — 값 동일 (참조 동일은 훅 재렌더 간에만 성립하므로 값으로 비교)
    expect(feb.monthly).toEqual(all.monthly);
    expect(feb.savRateTrend).toEqual(all.savRateTrend);
    expect(feb.salaryTrend).toEqual(all.salaryTrend);
    expect(feb.cumIE).toEqual(all.cumIE);
    expect(feb.netWorthByMonth).toEqual(all.netWorthByMonth);
    expect(feb.accountBalances).toEqual(all.accountBalances);
    expect(feb.portfolio).toEqual(all.portfolio);
    expect(feb.realPL).toEqual(all.realPL);
    expect(feb.investBreakdown).toEqual(all.investBreakdown);
    expect(feb.stockTrends).toEqual(all.stockTrends);
  });
});
