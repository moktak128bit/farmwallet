import { describe, it, expect } from "vitest";
import { computePositions, computeRealizedPnlByTradeId, isInterestRepayment, computeLoanBalanceAt } from "../calculations";
import type { Account, LedgerEntry, Loan, StockTrade } from "../types";

function makeTrade(overrides: Partial<StockTrade> & { id: string; side: "buy" | "sell" }): StockTrade {
  return {
    date: "2026-01-01",
    accountId: "acc1",
    ticker: "AAPL",
    name: "Apple",
    quantity: 1,
    price: 100,
    fee: 0,
    totalAmount: 100,
    cashImpact: 0,
    ...overrides,
  };
}

describe("computeRealizedPnlByTradeId (FIFO)", () => {
  it("매수만 있으면 실현손익 없음", () => {
    const trades = [makeTrade({ id: "b1", side: "buy", quantity: 10, price: 100, totalAmount: 1000 })];
    const result = computeRealizedPnlByTradeId(trades);
    expect(result.get("b1")).toBeUndefined();
  });

  it("매수 후 매도 시 FIFO 실현손익 계산", () => {
    const trades = [
      makeTrade({ id: "b1", side: "buy", date: "2026-01-01", quantity: 10, price: 100, totalAmount: 1000 }),
      makeTrade({ id: "s1", side: "sell", date: "2026-02-01", quantity: 10, price: 150, totalAmount: 1500 }),
    ];
    const result = computeRealizedPnlByTradeId(trades);
    expect(result.get("s1")).toBe(500); // (150-100) * 10
  });

  it("부분 매도 시 정확한 손익", () => {
    const trades = [
      makeTrade({ id: "b1", side: "buy", date: "2026-01-01", quantity: 10, price: 100, totalAmount: 1000 }),
      makeTrade({ id: "s1", side: "sell", date: "2026-02-01", quantity: 5, price: 120, totalAmount: 600 }),
    ];
    const result = computeRealizedPnlByTradeId(trades);
    expect(result.get("s1")).toBe(100); // (120-100) * 5
  });

  it("손실 매도", () => {
    const trades = [
      makeTrade({ id: "b1", side: "buy", date: "2026-01-01", quantity: 10, price: 100, totalAmount: 1000 }),
      makeTrade({ id: "s1", side: "sell", date: "2026-02-01", quantity: 10, price: 80, totalAmount: 800 }),
    ];
    const result = computeRealizedPnlByTradeId(trades);
    expect(result.get("s1")).toBe(-200); // (80-100) * 10
  });
});

function makeRepayment(overrides: Partial<LedgerEntry> & { id: string }): LedgerEntry {
  return {
    date: "2026-01-15",
    kind: "expense",
    category: "지출",
    description: "주담대 상환",
    amount: 100_000,
    ...overrides,
  } as LedgerEntry;
}

describe("computePositions — price=0 시세는 '시세 없음'으로 취급 (-100% 오표시 방지)", () => {
  const accounts = [{ id: "acc1", name: "증권" }] as Account[];
  const buyTrades = [
    makeTrade({ id: "b1", side: "buy", ticker: "0180V0", quantity: 598, price: 13235, totalAmount: 7914530 })
  ];

  it("price=0 + priceFallback:'cost'면 평균단가로 폴백한다 (손익 0)", () => {
    const positions = computePositions(buyTrades, [{ ticker: "0180V0", price: 0 }], accounts, {
      priceFallback: "cost"
    });
    expect(positions).toHaveLength(1);
    expect(positions[0].marketPrice).toBeCloseTo(7914530 / 598);
    expect(positions[0].pnlRate).toBeCloseTo(0);
  });

  it("폴백 미지정이면 marketPrice=0 — 호출부(주식 탭)가 '시세 없음'으로 표시한다", () => {
    const positions = computePositions(buyTrades, [{ ticker: "0180V0", price: 0 }], accounts);
    expect(positions[0].marketPrice).toBe(0);
  });
});

describe("computePositions — 같은 날 매수·매도 정렬 (id순이 매도 먼저여도 보유수량 안 부풀려짐)", () => {
  const accounts = [{ id: "acc1", name: "증권" }] as Account[];
  it("같은 날 전량 매수+매도면 보유수량 0 (id상 매도가 먼저여도)", () => {
    // 배열 순서·id 모두 매도가 먼저(a-sell < z-buy) → 옛 id정렬은 매도 먼저 처리해 오버셀 무시→매수 lot 잔존(수량 10 오류)
    const trades = [
      makeTrade({ id: "a-sell", side: "sell", date: "2026-03-01", quantity: 10, price: 150, totalAmount: 1500 }),
      makeTrade({ id: "z-buy", side: "buy", date: "2026-03-01", quantity: 10, price: 100, totalAmount: 1000 }),
    ];
    const positions = computePositions(trades, [{ ticker: "AAPL", price: 150 }], accounts);
    // 매수 먼저 처리 → 매도가 전량 소진 → 잔여 0 (포지션 없음 또는 수량 0)
    const total = positions.reduce((s, p) => s + p.quantity, 0);
    expect(total).toBe(0);
  });

  it("같은 날 매수10·매도4면 보유수량 6", () => {
    const trades = [
      makeTrade({ id: "a-sell", side: "sell", date: "2026-03-01", quantity: 4, price: 150, totalAmount: 600 }),
      makeTrade({ id: "z-buy", side: "buy", date: "2026-03-01", quantity: 10, price: 100, totalAmount: 1000 }),
    ];
    const positions = computePositions(trades, [{ ticker: "AAPL", price: 150 }], accounts);
    expect(positions.reduce((s, p) => s + p.quantity, 0)).toBe(6);
  });
});

describe("isInterestRepayment — 카테고리 구조 세대별 이자 판정", () => {
  it("현재 구조: detailCategory에 '이자' 포함이면 이자 상환", () => {
    const entry = makeRepayment({ id: "1", category: "지출", subCategory: "대출상환", detailCategory: "이자상환" });
    expect(isInterestRepayment(entry)).toBe(true);
  });

  it("현재 구조: detailCategory가 '원금상환'이면 원금 상환", () => {
    const entry = makeRepayment({ id: "2", category: "지출", subCategory: "대출상환", detailCategory: "원금상환" });
    expect(isInterestRepayment(entry)).toBe(false);
  });

  it("2세대 구조: (category='대출상환', subCategory='이자상환')도 이자 상환으로 판정", () => {
    const entry = makeRepayment({ id: "3", category: "대출상환", subCategory: "이자상환" });
    expect(isInterestRepayment(entry)).toBe(true);
  });

  it("2세대 구조: (category='대출상환', subCategory='원금상환')은 원금 상환", () => {
    const entry = makeRepayment({ id: "4", category: "대출상환", subCategory: "원금상환" });
    expect(isInterestRepayment(entry)).toBe(false);
  });

  it("현재 구조의 subCategory='대출상환' 자체는 이자로 오판하지 않는다", () => {
    const entry = makeRepayment({ id: "5", category: "지출", subCategory: "대출상환" });
    expect(isInterestRepayment(entry)).toBe(false);
  });
});

describe("computeLoanBalanceAt — 2세대 이자 상환은 잔금에서 차감하지 않음", () => {
  const loans: Loan[] = [{
    id: "l1",
    institution: "은행",
    loanName: "주담대",
    loanAmount: 1_000_000,
    annualInterestRate: 3,
    repaymentMethod: "bullet",
    loanDate: "2026-01-01",
    maturityDate: "2030-01-01",
  }];

  it("2세대 이자상환 엔트리는 원금 잔금을 줄이지 않는다", () => {
    const ledger: LedgerEntry[] = [
      makeRepayment({ id: "1", category: "대출상환", subCategory: "이자상환", amount: 50_000 }),
      makeRepayment({ id: "2", category: "대출상환", subCategory: "원금상환", amount: 200_000 }),
    ];
    // 이자 50,000은 무시, 원금 200,000만 차감
    expect(computeLoanBalanceAt(loans, ledger)).toBe(800_000);
  });
});
