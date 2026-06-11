import { describe, it, expect } from "vitest";
import {
  computeAccountTimelineRows,
  buildAdjustedPrices,
  buildTimelineMonthRange,
} from "../utils/accountTimeline";
import { computeAccountBalances, computePositions, computeTotalNetWorth } from "../calculations";
import type { Account, LedgerEntry, Loan, StockPrice, StockTrade } from "../types";

function acc(o: Partial<Account> & { id: string; name: string }): Account {
  return { type: "checking", institution: "", initialBalance: 0, ...o };
}

function entry(o: Partial<LedgerEntry> & { id: string; amount: number }): LedgerEntry {
  return {
    date: "2026-01-15",
    kind: "expense",
    category: "기타",
    description: "",
    ...o,
  } as LedgerEntry;
}

function trade(o: Partial<StockTrade> & { id: string }): StockTrade {
  return {
    date: "2026-01-10",
    accountId: "SEC",
    ticker: "005930",
    name: "삼성전자",
    side: "buy",
    quantity: 1,
    price: 10_000,
    fee: 0,
    totalAmount: 10_000,
    cashImpact: -10_000,
    ...o,
  } as StockTrade;
}

function loan(o: Partial<Loan> & { id: string; loanName: string; loanAmount: number }): Loan {
  return {
    institution: "은행",
    annualInterestRate: 3,
    repaymentMethod: "bullet",
    loanDate: "2026-01-10",
    maturityDate: "2030-01-01",
    ...o,
  };
}

/** 기본 파라미터 — 각 테스트에서 필요한 필드만 덮어쓴다 */
function run(over: Partial<Parameters<typeof computeAccountTimelineRows>[0]>) {
  return computeAccountTimelineRows({
    accounts: [],
    ledger: [],
    trades: [],
    adjustedPrices: [],
    fxRate: null,
    currentMonth: "2026-02",
    monthRange: ["2026-01", "2026-02"],
    loans: [],
    ...over,
  });
}

describe("computeAccountTimelineRows — 러닝밸런스", () => {
  it("수입은 가산, 지출은 차감되어 월별로 누적된다", () => {
    const rows = run({
      accounts: [acc({ id: "A", name: "주거래", initialBalance: 1_000_000 })],
      ledger: [
        entry({ id: "1", amount: 500_000, kind: "income", toAccountId: "A", date: "2026-01-05" }),
        entry({ id: "2", amount: 200_000, kind: "expense", fromAccountId: "A", date: "2026-02-10" }),
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ month: "2026-01", total: 1_500_000, asset: 1_500_000, debt: 0 });
    expect(rows[1]).toMatchObject({ month: "2026-02", total: 1_300_000 });
  });

  it("KRW 이체는 계좌 간 이동 — 순자산 합계 불변, 저축성지출(toAccountId)은 받는 계좌에 가산", () => {
    const rows = run({
      accounts: [
        acc({ id: "A", name: "주거래", initialBalance: 1_000_000 }),
        acc({ id: "B", name: "저축", type: "savings", initialBalance: 0 }),
      ],
      ledger: [
        entry({ id: "1", amount: 300_000, kind: "transfer", fromAccountId: "A", toAccountId: "B", date: "2026-01-05" }),
        // 저축성지출: from 차감 + to 가산 → 합계 불변
        entry({ id: "2", amount: 100_000, kind: "expense", fromAccountId: "A", toAccountId: "B", date: "2026-02-01" }),
      ],
    });
    expect(rows[0].total).toBe(1_000_000);
    expect(rows[0].savings).toBe(300_000); // savings 계좌 잔액
    expect(rows[1].total).toBe(1_000_000);
    expect(rows[1].savings).toBe(400_000);
  });
});

describe("computeAccountTimelineRows — 월말 시세 컷오프·currentMonth 최신가", () => {
  const accounts = [acc({ id: "SEC", name: "증권", type: "securities", initialBalance: 0, initialCashBalance: 50_000 })];
  const trades = [trade({ id: "t1", date: "2026-01-10" })]; // 1주 @10,000 매수
  const prices: StockPrice[] = [
    { ticker: "005930", price: 20_000, currency: "KRW", updatedAt: "2026-02-10T09:00:00" },
  ];

  it("과거 월은 월말 이전 시세만 사용 — 없으면 매입원가 폴백", () => {
    const rows = run({ accounts, trades, adjustedPrices: prices });
    // 1월: 2026-02-10 시세는 1월 말 이후 → 제외 → 원가 10,000으로 평가
    expect(rows[0].stock).toBe(10_000);
    expect(rows[0].total).toBe(40_000 + 10_000); // 현금 50,000−10,000 + 주식 10,000
  });

  it("currentMonth는 최신가 전부 사용", () => {
    const rows = run({ accounts, trades, adjustedPrices: prices });
    expect(rows[1].stock).toBe(20_000);
    expect(rows[1].total).toBe(40_000 + 20_000);
  });
});

describe("computeAccountTimelineRows — USD 이체·현금 환산", () => {
  it("USD 이체는 증권계좌 usdTransferNet으로 추적되어 환율로 환산, 일반계좌 KRW 잔액은 불변", () => {
    const rows = run({
      accounts: [
        acc({ id: "A", name: "주거래", initialBalance: 500_000 }),
        acc({ id: "SEC", name: "증권", type: "securities", initialBalance: 0, usdBalance: 100 }),
      ],
      ledger: [
        entry({ id: "1", amount: 50, kind: "transfer", currency: "USD", fromAccountId: "A", toAccountId: "SEC", date: "2026-01-20" }),
      ],
      fxRate: 1_000,
      currentMonth: "2026-01",
      monthRange: ["2026-01"],
    });
    // SEC usdCash = 100 + 50 = 150 → 150,000원. A의 KRW 잔액은 USD 이체에 영향받지 않음.
    expect(rows[0].total).toBe(500_000 + 150_000);
    expect(rows[0].asset).toBe(650_000);
  });
});

describe("computeAccountTimelineRows — 대출 잔금 차감", () => {
  it("대출 개시 월부터 잔금만큼 차감, 원금 상환 시 잔금 감소 (이중 차감 없음)", () => {
    const rows = run({
      accounts: [acc({ id: "A", name: "주거래", initialBalance: 1_000_000 })],
      ledger: [
        entry({ id: "1", amount: 30_000, kind: "expense", category: "대출상환", description: "주담대 원금상환", fromAccountId: "A", date: "2026-02-05" }),
      ],
      loans: [loan({ id: "l1", loanName: "주담대", loanAmount: 100_000 })],
    });
    // 1월: 현금 1,000,000 − 대출 100,000
    expect(rows[0]).toMatchObject({ debt: 100_000, total: 900_000 });
    // 2월: 현금 970,000 − 잔금 70,000 = 900,000 (원금 상환은 자산→부채 이동이라 순자산 불변)
    expect(rows[1]).toMatchObject({ debt: 70_000, total: 900_000 });
  });
});

describe("computeAccountTimelineRows — 마지막 행 ≒ computeTotalNetWorth (골든)", () => {
  it("currentMonth 행 total이 대시보드 현재 순자산과 일치", () => {
    const accounts = [
      acc({ id: "A", name: "주거래", initialBalance: 1_000_000, debt: 50_000 }),
      acc({ id: "SEC", name: "증권", type: "securities", initialBalance: 0, initialCashBalance: 200_000, usdBalance: 10 }),
    ];
    const ledger = [
      entry({ id: "1", amount: 700_000, kind: "income", toAccountId: "A", date: "2026-01-03" }),
      entry({ id: "2", amount: 150_000, kind: "expense", fromAccountId: "A", date: "2026-01-12" }),
      entry({ id: "3", amount: 100_000, kind: "transfer", fromAccountId: "A", toAccountId: "SEC", date: "2026-01-15" }),
      entry({ id: "4", amount: 5, kind: "transfer", currency: "USD", fromAccountId: "A", toAccountId: "SEC", date: "2026-02-01" }),
      entry({ id: "5", amount: 20_000, kind: "expense", category: "대출상환", description: "주담대 상환", fromAccountId: "A", date: "2026-02-10" }),
    ];
    const trades = [trade({ id: "t1", date: "2026-01-20", quantity: 2, totalAmount: 20_000, cashImpact: -20_000 })];
    const fxRate = 1_300;
    const adjustedPrices = buildAdjustedPrices(
      [{ ticker: "005930", price: 15_000, currency: "KRW", updatedAt: "2026-02-05T09:00:00" }],
      fxRate
    );
    const loans = [loan({ id: "l1", loanName: "주담대", loanAmount: 80_000 })];

    const rows = run({ accounts, ledger, trades, adjustedPrices, fxRate, loans });
    const lastTotal = rows[rows.length - 1].total;

    const balances = computeAccountBalances(accounts, ledger, trades);
    const positions = computePositions(trades, adjustedPrices, accounts, { fxRate, priceFallback: "cost" });
    const expected = computeTotalNetWorth(balances, positions, fxRate, loans, ledger);

    expect(lastTotal).toBeCloseTo(expected, 6);
  });
});

describe("buildAdjustedPrices", () => {
  it("fxRate 없으면 동일 참조 반환 (memo 계약)", () => {
    const prices: StockPrice[] = [{ ticker: "VOO", price: 500, currency: "USD" }];
    expect(buildAdjustedPrices(prices, null)).toBe(prices);
  });

  it("USD 시세만 원화 환산하고 currency를 KRW로 바꾼다", () => {
    const prices: StockPrice[] = [
      { ticker: "VOO", price: 500, currency: "USD" },
      { ticker: "005930", price: 70_000, currency: "KRW" },
    ];
    const out = buildAdjustedPrices(prices, 1_000);
    expect(out[0]).toMatchObject({ price: 500_000, currency: "KRW" });
    expect(out[1]).toMatchObject({ price: 70_000, currency: "KRW" });
  });
});

describe("buildTimelineMonthRange", () => {
  it("장부·거래 첫 월부터 currentMonth까지 갭 없이 연속 생성", () => {
    const ledger = [entry({ id: "1", amount: 1, date: "2025-11-20" })];
    const trades = [trade({ id: "t1", date: "2026-01-05" })];
    expect(buildTimelineMonthRange(ledger, trades, "2026-02")).toEqual([
      "2025-11", "2025-12", "2026-01", "2026-02",
    ]);
  });

  it("기록이 없으면 currentMonth 한 달만", () => {
    expect(buildTimelineMonthRange([], [], "2026-06")).toEqual(["2026-06"]);
  });
});
